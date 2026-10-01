import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assemblyKeys, assemblyRows, assemblyRpc } from "@/lib/assembly";
import {
  pieceDraft,
  changePieceBasis,
  pieceNumber,
  piecePayload,
  pieceTime,
  type PieceDraft,
  type PieceTechnical,
} from "@/lib/piece-technical";
import { orderRequest } from "@/lib/sales-order";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PieceTechnicalSummary({ spec }: { spec?: PieceTechnical }) {
  return (
    <div className="space-y-2 text-sm">
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-muted-foreground">Filamento por peça</dt>
          <dd className="font-medium">{pieceNumber(spec?.grams, " g")}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Impressão por peça</dt>
          <dd className="font-medium">{pieceTime(spec?.print_seconds)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Acabamento por peça</dt>
          <dd>{pieceTime(spec?.finishing_seconds)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Custo técnico por peça</dt>
          <dd>
            {spec?.estimated_cost == null
              ? "A completar"
              : Number(spec.estimated_cost).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
          </dd>
        </div>
      </dl>
      {!!spec?.materials.length && (
        <p className="text-xs text-muted-foreground">
          {spec.materials
            .map(
              (m) =>
                `${m.material || "Material a definir"}${m.color ? ` / ${m.color}` : ""}: ${pieceNumber(m.grams, " g")}`,
            )
            .join(" · ")}
        </p>
      )}
      {spec?.source === "plate" && (
        <p className="text-xs text-muted-foreground">
          Estimativa automática: total da placa ÷ peças iguais na placa.
        </p>
      )}
      {spec?.source === "unknown" && spec.plate && (
        <p className="text-xs text-muted-foreground">
          Total de {spec.plate.label}: {pieceNumber(spec.plate.grams, " g")} /{" "}
          {pieceTime(spec.plate.seconds)}. O consumo individual ainda precisa
          ser identificado.
        </p>
      )}
    </div>
  );
}

export function PieceSpecFields({
  value: d,
  onChange,
  tenantId,
  prefix = "piece",
}: {
  value: PieceDraft;
  onChange: (v: PieceDraft) => void;
  tenantId: string;
  prefix?: string;
}) {
  const materials = useQuery({
    queryKey: ["inventory_items", tenantId, "piece-spec"],
    queryFn: () =>
      assemblyRows<{
        id: string;
        name: string;
        material_code: string | null;
        color: string | null;
        unit: string;
        avg_cost: number;
      }>(
        "inventory_items",
        "id,name,material_code,color,unit,avg_cost",
        { tenant_id: tenantId, is_active: true },
        "name",
      ),
  });
  const change = (k: keyof PieceDraft, v: string) => onChange({ ...d, [k]: v });
  const row = (
    index: number,
    changes: Partial<PieceDraft["materials"][number]>,
  ) =>
    onChange({
      ...d,
      materials: d.materials.map((m, i) =>
        i === index ? { ...m, ...changes } : m,
      ),
    });
  const field = (
    key: "units" | "minutes" | "finishing" | "machine" | "labor" | "extra",
    label: string,
  ) => (
    <div>
      <Label htmlFor={`${prefix}-${key}`}>{label}</Label>
      <Input
        id={`${prefix}-${key}`}
        inputMode="decimal"
        value={d[key]}
        onChange={(e) => change(key, e.target.value)}
        placeholder="Não informado"
      />
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-basis`}>
            Peso e tempo informados para
          </Label>
          <select
            id={`${prefix}-basis`}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={d.basis}
            onChange={(e) =>
              onChange(
                changePieceBasis(d, e.target.value as PieceDraft["basis"]),
              )
            }
          >
            <option value="piece">Uma peça</option>
            <option value="plate">Uma placa de peças iguais</option>
          </select>
        </div>
        {field("units", "Peças iguais por placa (opcional)")}
      </div>
      <p className="text-xs text-muted-foreground">
        {d.basis === "plate"
          ? "Informe peso e tempo totais da placa. O sistema divide pela quantidade de peças iguais. Para placas com peças diferentes, informe cada peça separadamente."
          : "Valores de uma unidade deste subitem. Inclua a parcela de suporte e purga no consumo estimado."}
      </p>
      {materials.error && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os filamentos do estoque. Você pode informar
          material e cor abaixo.
        </p>
      )}
      {d.materials.map((m, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Filamento {i + 1}</h4>
            {d.materials.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...d,
                    materials: d.materials.filter((_, idx) => idx !== i),
                  })
                }
              >
                Remover filamento {i + 1}
              </Button>
            )}
          </div>
          <SearchableItemSelect
            label={`Filamento ${i + 1} do estoque`}
            value={m.item_id}
            onChange={(id) => {
              const selected = materials.data?.find((x) => x.id === id);
              row(i, {
                item_id: id,
                material: selected?.material_code || selected?.name || "",
                color: selected?.color || "",
                cost_per_kg: "",
              });
            }}
            emptyLabel="Buscar filamento cadastrado (opcional)"
            options={(materials.data || [])
              .filter((x) => ["g", "kg"].includes(x.unit))
              .map((x) => ({
                id: x.id,
                label: x.name,
                description: x.color || undefined,
              }))}
          />
          {m.item_id && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => row(i, { item_id: "" })}
            >
              Informar material sem vínculo de estoque
            </Button>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${prefix}-material-${i}`}>Material</Label>
              <Input
                id={`${prefix}-material-${i}`}
                value={m.material}
                maxLength={120}
                onChange={(e) => row(i, { material: e.target.value })}
                placeholder="Ex.: PLA"
              />
            </div>
            <div>
              <Label htmlFor={`${prefix}-color-${i}`}>Cor</Label>
              <Input
                id={`${prefix}-color-${i}`}
                value={m.color}
                maxLength={120}
                onChange={(e) => row(i, { color: e.target.value })}
                placeholder="Ex.: vermelho"
              />
            </div>
            <div>
              <Label htmlFor={`${prefix}-grams-${i}`}>
                Filamento {d.basis === "plate" ? "da placa" : "por peça"} (g)
              </Label>
              <Input
                id={`${prefix}-grams-${i}`}
                inputMode="decimal"
                value={m.grams}
                onChange={(e) => row(i, { grams: e.target.value })}
                placeholder="Não informado"
              />
            </div>
            <div>
              <Label htmlFor={`${prefix}-kg-${i}`}>
                Custo do filamento (R$/kg)
              </Label>
              <Input
                id={`${prefix}-kg-${i}`}
                inputMode="decimal"
                value={m.cost_per_kg}
                onChange={(e) => row(i, { cost_per_kg: e.target.value })}
                placeholder={
                  m.item_id ? "Usar custo do estoque" : "Não informado"
                }
              />
            </div>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={d.materials.length >= 16}
        onClick={() =>
          onChange({
            ...d,
            materials: [
              ...d.materials,
              {
                item_id: "",
                material: "",
                color: "",
                grams: "",
                cost_per_kg: "",
              },
            ],
          })
        }
      >
        Adicionar filamento / cor
      </Button>
      <div className="grid gap-3 sm:grid-cols-2">
        {field(
          "minutes",
          `Impressão ${d.basis === "plate" ? "da placa" : "por peça"} (min)`,
        )}
        {field("finishing", "Acabamento por peça (min)")}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Custos de máquina, acabamento e outros
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {field("machine", "Máquina + energia (R$/h)")}
          {field("labor", "Mão de obra de acabamento (R$/h)")}
          {field("extra", "Outros custos por peça (R$)")}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Custo técnico = filamentos + tempo de impressão × máquina + acabamento
          × mão de obra + outros. Não altera o custo histórico do estoque.
        </p>
      </details>
      <div>
        <Label htmlFor={`${prefix}-notes`}>Observações técnicas</Label>
        <Input
          id={`${prefix}-notes`}
          value={d.notes}
          maxLength={3000}
          onChange={(e) => change("notes", e.target.value)}
          placeholder="Ex.: camada 0,2 mm, preenchimento 15%, bico 0,4 mm"
        />
      </div>
    </div>
  );
}

export function PieceTechnicalSheet({
  productId,
  name,
  tenantId,
  showSummary = false,
}: {
  productId: string;
  name: string;
  tenantId: string;
  showSummary?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<PieceDraft | null>(null);
  const qc = useQueryClient(),
    { toast } = useToast();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const query = useQuery({
    queryKey: ["piece_spec", tenantId, productId],
    queryFn: () =>
      assemblyRpc<PieceTechnical>("product_piece_spec", {
        p_product_id: productId,
      }),
    enabled: open || showSummary,
  });
  useEffect(() => {
    if (open && query.data && !draft && !query.isFetching)
      setDraft(pieceDraft(query.data));
  }, [open, query.data, query.isFetching, draft]);
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Aguarde a ficha técnica.");
      const data = piecePayload(draft);
      request.current = orderRequest(
        request.current,
        JSON.stringify([productId, data]),
      );
      return assemblyRpc("save_product_piece_spec", {
        p_product_id: productId,
        p_data: data,
        p_request_id: request.current.id,
      });
    },
    onSuccess: async () => {
      setOpen(false);
      setDraft(null);
      request.current = null;
      await Promise.all(
        [...assemblyKeys, "piece_spec"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast({
        title: "Ficha técnica salva",
        description:
          "Peso, tempo e custos desta peça atualizados em todas as composições.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Não foi possível salvar a ficha",
        description: e.message,
        variant: "destructive",
      }),
  });
  return (
    <div className="space-y-3">
      {showSummary && (
        <>
          <h3 className="font-semibold">Ficha técnica da peça</h3>
          <PieceTechnicalSummary spec={query.data} />
        </>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setDraft(null);
          setOpen(true);
          void qc.invalidateQueries({
            queryKey: ["piece_spec", tenantId, productId],
          });
        }}
      >
        Ficha técnica
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!save.isPending) {
            setOpen(v);
            if (!v) setDraft(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[90dvh] max-w-2xl overflow-y-auto"
          closeDisabled={save.isPending}
        >
          <DialogHeader>
            <DialogTitle>Ficha técnica — {name}</DialogTitle>
            <DialogDescription>
              Consumo, tempo e custo de uma unidade deste subitem. Preencha o
              que já souber; os demais dados ficam como não informados.
            </DialogDescription>
          </DialogHeader>
          {query.error && (
            <p role="alert" className="text-destructive">
              {query.error.message}
            </p>
          )}
          {!draft && !query.error && <p>Carregando ficha técnica…</p>}
          {draft && (
            <PieceSpecFields
              value={draft}
              onChange={setDraft}
              tenantId={tenantId}
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              disabled={!draft || !!query.error || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Salvando…" : "Salvar ficha técnica"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
