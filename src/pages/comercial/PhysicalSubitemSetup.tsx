import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assemblyKeys,
  assemblyRows,
  assemblyRpc,
  readAssemblyStatus,
  type PhysicalSubitem,
} from "@/lib/assembly";
import { positiveInteger } from "@/lib/production";
import { orderRequest } from "@/lib/sales-order";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import {
  PieceSpecFields,
  PieceTechnicalSheet,
  PieceTechnicalSummary,
} from "@/components/production/PieceTechnicalSheet";
import {
  pieceDraft,
  piecePayload,
  type PieceDraft,
} from "@/lib/piece-technical";

type Draft = {
  id: string | null;
  mode: "new" | "existing";
  child: string;
  name: string;
  sku: string;
  quantity: string;
  stock: string;
  cost: string;
  plate: string;
  yield: string;
  technical: PieceDraft;
};
const emptyDraft = (): Draft => ({
  id: null,
  mode: "new",
  child: "",
  name: "",
  sku: "",
  quantity: "1",
  stock: "0",
  cost: "",
  plate: "",
  yield: "",
  technical: pieceDraft(),
});

export default function PhysicalSubitemSetup({
  productId,
  tenantId,
  onBusyChange,
  onDraftChange,
}: {
  productId: string;
  tenantId: string;
  onBusyChange?: (value: boolean) => void;
  onDraftChange?: (value: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [unlink, setUnlink] = useState<PhysicalSubitem | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const status = useQuery({
    queryKey: ["assembly_status", tenantId, productId, "setup"],
    queryFn: () => readAssemblyStatus(productId, 1),
  });
  const plates = useQuery({
    queryKey: ["product_print_plates", tenantId, productId, "subitems"],
    queryFn: () =>
      assemblyRows<{ id: string; label: string; plate_index: number }>(
        "product_print_plates",
        "id,label,plate_index",
        { product_id: productId, tenant_id: tenantId, is_active: true },
      ),
  });
  const catalogue = useQuery({
    queryKey: ["products", tenantId, "subitem-options"],
    queryFn: () =>
      assemblyRows<{
        id: string;
        name: string;
        sku: string | null;
        assembly_enabled: boolean;
        category: string;
      }>(
        "products",
        "id,name,sku,assembly_enabled,category",
        { tenant_id: tenantId, is_active: true },
        "name",
      ),
  });
  const parts = status.data?.individual_stock
    ? (status.data.components as PhysicalSubitem[])
    : [];
  const change = (field: keyof Draft, value: string) =>
    setDraft((current) => (current ? { ...current, [field]: value } : null));
  const refresh = () =>
    Promise.all(
      [...assemblyKeys, "inventory_movements"].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
  const operation = useMutation({
    mutationFn: async (kind: "save" | "unlink") => {
      if (kind === "unlink" && unlink)
        return assemblyRpc("remove_product_subitem", {
          p_subitem_id: unlink.id,
        });
      if (!draft) throw new Error("Abra o cadastro do subitem.");
      const quantity = draft.quantity.trim()
        ? positiveInteger(draft.quantity, "Quantidade por produto", 10000)
        : null;
      const yieldCount = draft.yield.trim()
        ? positiveInteger(draft.yield, "Peças por impressão", 10000)
        : null;
      const initialStock = Number(draft.stock.replace(",", "."));
      const cost = draft.cost.trim()
        ? Number(draft.cost.replace(",", "."))
        : null;
      if (
        !Number.isInteger(initialStock) ||
        initialStock < 0 ||
        (cost !== null && (!Number.isFinite(cost) || cost < 0))
      )
        throw new Error("Informe estoque inteiro e custo válido.");
      if (!draft.id && draft.mode === "new" && !draft.name.trim())
        throw new Error("Informe o nome da peça.");
      if (draft.mode === "existing" && !draft.child)
        throw new Error("Selecione o produto que será usado como subitem.");
      const data = {
        name: draft.name.trim(),
        sku: draft.sku.trim() || null,
        component_product_id: draft.mode === "existing" ? draft.child : null,
        quantity_per_product: quantity,
        plate_id: draft.plate || null,
        quantity_per_plate: yieldCount,
        initial_stock: initialStock,
        unit_cost: cost,
        ...(!draft.id &&
        draft.mode === "new" &&
        (draft.technical.minutes.trim() ||
          draft.technical.materials.some(
            (m) => m.grams.trim() || m.material.trim() || m.item_id,
          ))
          ? { technical: piecePayload(draft.technical) }
          : {}),
      };
      request.current = orderRequest(
        request.current,
        JSON.stringify([productId, draft.id, data]),
      );
      return assemblyRpc("save_product_subitem", {
        p_product_id: productId,
        p_subitem_id: draft.id,
        p_data: data,
        p_request_id: request.current.id,
      });
    },
    onSuccess: async (_, kind) => {
      setDraft(null);
      setUnlink(null);
      request.current = null;
      await refresh();
      toast({
        title:
          kind === "unlink"
            ? "Subitem retirado da composição"
            : "Subitem salvo",
        description:
          kind === "unlink"
            ? "O cadastro da peça, seu saldo e histórico foram preservados."
            : "O subitem tem cadastro e estoque próprios no catálogo.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Não foi possível salvar o subitem",
        description: e.message,
        variant: "destructive",
      }),
  });
  useEffect(() => {
    onBusyChange?.(operation.isPending);
    return () => onBusyChange?.(false);
  }, [operation.isPending, onBusyChange]);
  useEffect(() => {
    onDraftChange?.(!!draft || !!unlink);
    return () => onDraftChange?.(false);
  }, [draft, unlink, onDraftChange]);
  return (
    <section
      aria-label="Subitens com estoque próprio"
      className="space-y-4 rounded-lg border bg-muted/20 p-4"
    >
      <div>
        <h3 className="font-semibold">Subitens e montagem</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada peça tem seu cadastro, SKU, custo e estoque. Defina quantas
          unidades de cada peça entram no produto final. A montagem baixa essas
          peças e dá entrada no produto pronto.
        </p>
      </div>
      {status.error && (
        <p role="alert" className="text-destructive">
          {status.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={operation.isPending}
          onClick={() => {
            setDraft(emptyDraft());
            request.current = null;
          }}
        >
          Cadastrar subitem
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={operation.isPending}
          onClick={() => {
            setDraft({ ...emptyDraft(), mode: "existing" });
            request.current = null;
          }}
        >
          Usar produto já cadastrado
        </Button>
        {!!parts.length && (
          <Button variant="outline" asChild>
            <Link to={`/producao/componentes?produto=${productId}`}>
              Estoque dos subitens e montagem
            </Link>
          </Button>
        )}
      </div>
      {status.data && !parts.length && (
        <p className="rounded-md border bg-background p-3 text-sm">
          Ainda não há peças com cadastro individual nesta composição.{" "}
          {status.data.components.length > 0 &&
            "As placas existentes são configurações de impressão; cada peça precisa de um subitem vinculado."}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {parts.map((part) => (
          <article
            key={part.id}
            className="min-w-0 space-y-3 rounded-lg border bg-background p-3"
          >
            <div>
              <h4 className="font-medium">{part.label}</h4>
              <p className="text-xs text-muted-foreground">{part.sku}</p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Por produto final</dt>
                <dd className="font-semibold">
                  {part.quantity_per_product == null
                    ? "A confirmar"
                    : `${part.quantity_per_product} un`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estoque da peça</dt>
                <dd className="font-semibold">
                  {Number(part.balance).toLocaleString("pt-BR")} un
                </dd>
              </div>
            </dl>
            <PieceTechnicalSummary spec={part.technical} />
            <PieceTechnicalSheet
              productId={part.component_product_id}
              name={part.label}
              tenantId={tenantId}
            />
            <p className="text-xs text-muted-foreground">
              {part.plate_label || "Placa de impressão ainda não vinculada"}
              {part.quantity_per_plate != null
                ? ` · ${part.quantity_per_plate} peças por impressão`
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={operation.isPending}
                onClick={() => {
                  setDraft({
                    ...emptyDraft(),
                    id: part.id,
                    name: part.label,
                    quantity: part.quantity_per_product?.toString() || "",
                    plate: part.plate_id || "",
                    yield: part.quantity_per_plate?.toString() || "",
                  });
                  request.current = null;
                }}
              >
                Editar composição
              </Button>
              <Button type="button" size="sm" variant="ghost" asChild>
                <Link
                  to={`/comercial/produtos?produto=${part.component_product_id}`}
                >
                  Abrir cadastro da peça
                </Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={operation.isPending}
                onClick={() => setUnlink(part)}
              >
                Retirar da composição
              </Button>
            </div>
          </article>
        ))}
      </div>
      {draft && (
        <div
          className="space-y-3 rounded-lg border bg-background p-4"
          aria-label="Cadastro do subitem"
        >
          <h4 className="font-medium">
            {draft.id
              ? `Composição: ${draft.name}`
              : draft.mode === "new"
                ? "Novo subitem com estoque próprio"
                : "Vincular peça do catálogo"}
          </h4>
          {!draft.id && draft.mode === "new" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="subitem-name">Nome da peça</Label>
                <Input
                  id="subitem-name"
                  value={draft.name}
                  onChange={(e) => change("name", e.target.value)}
                  placeholder="Ex.: metade da maçã, caule, folha"
                />
              </div>
              <div>
                <Label htmlFor="subitem-sku">SKU (opcional)</Label>
                <Input
                  id="subitem-sku"
                  value={draft.sku}
                  onChange={(e) => change("sku", e.target.value)}
                  placeholder="Gerado automaticamente"
                />
              </div>
              <div>
                <Label htmlFor="subitem-stock">Estoque inicial da peça</Label>
                <Input
                  id="subitem-stock"
                  type="number"
                  min={0}
                  step={1}
                  value={draft.stock}
                  onChange={(e) => change("stock", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="subitem-cost">Custo por peça (R$)</Label>
                <Input
                  id="subitem-cost"
                  inputMode="decimal"
                  value={draft.cost}
                  onChange={(e) => change("cost", e.target.value)}
                  placeholder="Pode preencher depois"
                />
              </div>
            </div>
          )}
          {!draft.id && draft.mode === "existing" && (
            <SearchableItemSelect
              label="Produto usado como subitem"
              value={draft.child}
              onChange={(v) => change("child", v)}
              emptyLabel="Digite para encontrar a peça"
              options={(catalogue.data || [])
                .filter(
                  (c) =>
                    c.id !== productId &&
                    !c.assembly_enabled &&
                    c.category !== "service" &&
                    !parts.some((p) => p.component_product_id === c.id),
                )
                .map((c) => ({
                  id: c.id,
                  label: c.name,
                  description: c.sku || undefined,
                }))}
            />
          )}
          {!draft.id && draft.mode === "new" && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Filamento, tempo e ficha técnica da peça
              </summary>
              <div className="mt-3">
                <PieceSpecFields
                  value={draft.technical}
                  onChange={(technical) =>
                    setDraft((current) =>
                      current ? { ...current, technical } : null,
                    )
                  }
                  tenantId={tenantId}
                  prefix="new-subitem"
                />
              </div>
            </details>
          )}
          <div>
            <Label htmlFor="subitem-quantity">
              Quantas unidades desta peça formam um produto?
            </Label>
            <Input
              id="subitem-quantity"
              type="number"
              min={1}
              step={1}
              value={draft.quantity}
              onChange={(e) => change("quantity", e.target.value)}
              placeholder="A confirmar"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Exemplo: 2 metades iguais, 1 caule e 1 folha. Peças com formas
              diferentes devem ter cadastros separados.
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Vincular à impressão (opcional para cadastrar e movimentar
              estoque)
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Placa que imprime esta peça</Label>
                <SearchableItemSelect
                  label="Placa do subitem"
                  value={draft.plate}
                  onChange={(v) => change("plate", v)}
                  emptyLabel="Preparar depois"
                  options={(plates.data || []).map((p) => ({
                    id: p.id,
                    label: p.label,
                    description: `Placa ${p.plate_index}`,
                  }))}
                />
              </div>
              <div>
                <Label htmlFor="subitem-yield">
                  Quantas peças saem nesta placa?
                </Label>
                <Input
                  id="subitem-yield"
                  type="number"
                  min={1}
                  step={1}
                  value={draft.yield}
                  onChange={(e) => change("yield", e.target.value)}
                  placeholder="Ex.: 20 caules"
                />
              </div>
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={operation.isPending}
              onClick={() => operation.mutate("save")}
            >
              {operation.isPending ? "Salvando…" : "Salvar subitem"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={operation.isPending}
              onClick={() => setDraft(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {unlink && (
        <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm">
          <p>
            Retirar <strong>{unlink.label}</strong> desta composição? O cadastro
            e o estoque da peça serão preservados. Ordens já liberadas mantêm a
            composição aprovada.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={operation.isPending}
              onClick={() => operation.mutate("unlink")}
            >
              Retirar vínculo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={operation.isPending}
              onClick={() => setUnlink(null)}
            >
              Voltar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
