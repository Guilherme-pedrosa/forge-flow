import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  assemblyRpc,
  type AssemblyHistory,
  type AssemblyStatus,
  type ComponentJob,
  type PhysicalSubitem,
} from "@/lib/assembly";
import { orderRequest } from "@/lib/sales-order";
import { positiveInteger } from "@/lib/production";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PieceTechnicalSheet,
  PieceTechnicalSummary,
} from "./PieceTechnicalSheet";
import { pieceForecast, pieceNumber, pieceTime } from "@/lib/piece-technical";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Action =
  | { kind: "entry" | "loss" | "batch"; part: PhysicalSubitem }
  | { kind: "assemble" }
  | { kind: "quality"; job: ComponentJob };
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function PhysicalSubitemWorkspace({
  data,
  productId,
  tenantId,
  itemId,
  target,
  onTarget,
  refresh,
  jobs,
  history,
}: {
  data: AssemblyStatus;
  productId: string;
  tenantId: string;
  itemId?: string;
  target: string;
  onTarget: (value: string) => void;
  refresh: () => Promise<unknown>;
  jobs: ComponentJob[];
  history: AssemblyHistory[];
}) {
  const { toast } = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("0");
  const [notes, setNotes] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const request = useRef<{ signature: string; id: string } | null>(null);
  const parts = data.components as PhysicalSubitem[];
  const qualityJobs = jobs.filter(
    (j) =>
      j.production_snapshot?.individual_stock &&
      j.production_snapshot.physical_outputs?.length,
  );
  const open = (next: Action) => {
    setAction(next);
    setNotes("");
    setCost("0");
    request.current = null;
    setQuantity(
      next.kind === "assemble"
        ? String(Math.max(1, Math.min(data.required, data.ready_to_assemble)))
        : next.kind === "batch"
          ? String(Math.max(1, next.part.to_print))
          : "1",
    );
    setCounts(
      next.kind === "quality"
        ? Object.fromEntries(
            (next.job.production_snapshot?.physical_outputs || []).map((c) => [
              c.component_product_id,
              String(c.quantity),
            ]),
          )
        : {},
    );
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error("Selecione a operação.");
      const money = Number(cost.replace(",", "."));
      if (!Number.isFinite(money) || money < 0)
        throw new Error("Informe um custo válido.");
      const qty =
        action.kind === "quality"
          ? 0
          : positiveInteger(quantity, "Quantidade de peças", 10000);
      const outputs =
        action.kind === "quality"
          ? (action.job.production_snapshot?.physical_outputs || []).map(
              (c) => {
                const good = Number(counts[c.component_product_id]);
                if (
                  !Number.isInteger(good) ||
                  good < 0 ||
                  good > c.quantity ||
                  counts[c.component_product_id]?.trim() === ""
                )
                  throw new Error(`Confira a quantidade boa de ${c.name}.`);
                return {
                  component_product_id: c.component_product_id,
                  good_quantity: good,
                };
              },
            )
          : [];
      request.current = orderRequest(
        request.current,
        JSON.stringify([action, qty, money, notes, outputs]),
      );
      const shared = { p_request_id: request.current.id };
      if (action.kind === "quality")
        return assemblyRpc("confirm_subitem_output", {
          ...shared,
          p_job_id: action.job.id,
          p_outputs: outputs,
          p_reason: notes,
        });
      if (action.kind === "assemble")
        return assemblyRpc("assemble_product", {
          ...shared,
          p_product_id: productId,
          p_quantity: qty,
          p_item_id: itemId || null,
          p_finishing_cost: money,
          p_notes: notes,
        });
      if (action.kind === "batch")
        return assemblyRpc("plan_subitem_batch", {
          ...shared,
          p_subitem_id: action.part.id,
          p_quantity: qty,
          p_item_id: itemId || null,
        });
      return assemblyRpc("move_subitem_stock", {
        ...shared,
        p_component_product_id: action.part.component_product_id,
        p_quantity: qty,
        p_kind: action.kind,
        p_unit_cost: money,
        p_notes: notes,
      });
    },
    onSuccess: async () => {
      const kind = action?.kind;
      setAction(null);
      await refresh();
      toast({
        title:
          kind === "assemble"
            ? "Montagem registrada: subitens consumidos"
            : kind === "batch"
              ? "Placa enviada à fila de impressão"
              : "Estoque individual atualizado",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Não foi possível concluir",
        description: error.message,
        variant: "destructive",
      }),
  });
  const title = !action
    ? ""
    : action.kind === "assemble"
      ? "Montar produto final"
      : action.kind === "quality"
        ? `Conferir peças de ${action.job.code}`
        : `${action.kind === "entry" ? "Entrada" : action.kind === "loss" ? "Perda" : "Produzir"}: ${action.part.label}`;
  const printParts =
    action?.kind === "batch"
      ? parts.filter((p) => p.plate_id === action.part.plate_id)
      : [];
  const runs =
    action?.kind === "batch" && action.part.quantity_per_plate
      ? Math.ceil(Number(quantity) / action.part.quantity_per_plate)
      : 0;
  const forecast = pieceForecast(parts);
  const totalEstimate = (key: "grams" | "seconds" | "cost") =>
    forecast.some((p) => p[key] == null)
      ? null
      : forecast.reduce((sum, p) => sum + p[key]!, 0);
  return (
    <section className="space-y-4" aria-label="Estoque individual e montagem">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{data.name}</h2>
          <p className="text-sm text-muted-foreground">
            Controle cada peça separadamente. A composição informa o que será
            consumido para montar o produto final.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={refresh}>
          Atualizar saldos
        </Button>
      </div>
      {!itemId && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="subitem-target">
              Quantos produtos quero montar?
            </Label>
            <Input
              id="subitem-target"
              className="w-44"
              type="number"
              min={1}
              max={10000}
              value={target}
              onChange={(e) => onTarget(e.target.value)}
            />
          </div>
          <Button variant="outline" asChild>
            <Link to={`/comercial/produtos?produto=${productId}`}>
              Editar composição e subitens
            </Link>
          </Button>
        </div>
      )}
      {!!data.issues?.length && (
        <div
          role="status"
          className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-950"
        >
          {data.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-lg border bg-emerald-50 p-4 text-emerald-950">
          <p className="text-sm">É possível montar agora</p>
          <strong className="text-3xl">{data.ready_to_assemble}</strong>
          <p className="text-xs">
            Considerando o saldo e a quantidade de cada peça.
          </p>
        </article>
        <article className="rounded-lg border bg-card p-4">
          <p className="text-sm">
            {itemId ? "Montados nesta OP" : "Produtos finais em estoque"}
          </p>
          <strong className="text-3xl">
            {itemId ? data.assembled : Number(data.finished_stock)}
          </strong>
        </article>
        <article className="rounded-lg border bg-card p-4">
          <p className="text-sm">Faltam para a meta</p>
          <strong className="text-3xl">
            {Math.max(0, data.required - data.ready_to_assemble)}
          </strong>
          <p className="text-xs text-muted-foreground">
            Confira abaixo qual subitem precisa de reposição.
          </p>
        </article>
      </div>
      <section
        className="space-y-2 rounded-lg border bg-muted/30 p-4"
        aria-label="Previsão técnica de produção"
      >
        <h3 className="font-semibold">Filamento e tempo para repor as peças</h3>
        <p className="text-sm text-muted-foreground">
          Desconta estoque e peças já na fila. Arredonda pelas quantidades por
          placa conhecidas e inclui as sobras.
        </p>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">
              Filamento previsto
            </dt>
            <dd className="font-semibold">
              {pieceNumber(totalEstimate("grams"), " g")}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Tempo equivalente de impressão
            </dt>
            <dd className="font-semibold">
              {pieceTime(totalEstimate("seconds"))}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Custo técnico previsto
            </dt>
            <dd className="font-semibold">
              {totalEstimate("cost") == null
                ? "A completar"
                : brl(totalEstimate("cost")!)}
            </dd>
          </div>
        </dl>
        {forecast.some((p) => p.grams == null || p.seconds == null) && (
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Complete as fichas abaixo para calcular o total. Dados ausentes não
            contam como consumo zero.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Estimativa com base nas fichas das peças; o tempo do lote deve ser
          conferido no fatiador. Impressoras em paralelo e mudanças no
          preenchimento alteram o prazo.
        </p>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {parts.map((part) => (
          <article
            key={part.id}
            className="min-w-0 space-y-3 rounded-lg border bg-card p-4"
            aria-label={`Estoque de ${part.label}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="break-words font-semibold">{part.label}</h3>
                <p className="text-xs text-muted-foreground">{part.sku}</p>
              </div>
              <span className="shrink-0 rounded bg-muted px-2 py-1 text-xs">
                {part.quantity_per_product == null
                  ? "Quantidade a confirmar"
                  : `${part.quantity_per_product} un por produto`}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Em estoque</dt>
                <dd className="text-xl font-semibold">
                  {Number(part.balance)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Disponíveis</dt>
                <dd className="text-xl font-semibold">{part.available}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Faltam peças</dt>
                <dd
                  className={`text-xl font-semibold ${part.missing > 0 ? "text-amber-800" : "text-emerald-700"}`}
                >
                  {part.quantity_per_product == null ? "—" : part.missing}
                </dd>
              </div>
            </dl>
            <p className="text-sm">
              Para {data.required} produto(s):{" "}
              <strong>
                {part.required == null
                  ? "quantidade a confirmar"
                  : `${part.required} peças necessárias`}
              </strong>
              .
            </p>
            <p className="text-xs text-muted-foreground">
              {part.reserved} reservadas · {part.pending} na fila ou conferência
              {part.plate_label ? ` · ${part.plate_label}` : ""}
              {part.quantity_per_plate
                ? ` · ${part.quantity_per_plate} peças por impressão`
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <PieceTechnicalSheet
                productId={part.component_product_id}
                name={part.label}
                tenantId={tenantId}
              />
              <Button
                type="button"
                size="sm"
                disabled={save.isPending}
                onClick={() => open({ kind: "entry", part })}
              >
                Entrada de peças
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!part.prepared || save.isPending}
                onClick={() => open({ kind: "batch", part })}
              >
                Produzir lote
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Number(part.balance) <= 0 || save.isPending}
                onClick={() => open({ kind: "loss", part })}
              >
                Registrar perda
              </Button>
            </div>
            <div className="space-y-3 border-t pt-3">
              <PieceTechnicalSummary spec={part.technical} />
              {(() => {
                const f = forecast.find((p) => p.id === part.id)!;
                return (
                  <p className="rounded-md bg-muted p-2 text-xs">
                    Reposição prevista:{" "}
                    <strong>{pieceNumber(f.count, " peças")}</strong> ·{" "}
                    {pieceNumber(f.grams, " g")} · {pieceTime(f.seconds)}
                    {f.surplus ? ` · ${f.surplus} peças de sobra` : ""}
                  </p>
                );
              })()}
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              <Link
                className="underline"
                to={`/comercial/produtos?produto=${part.component_product_id}`}
              >
                Cadastro, custo e preço da peça
              </Link>
              <Link
                className="underline"
                to={`/estoque/movimentacoes?item=${part.stock_item_id}&historico=1`}
              >
                Movimentações
              </Link>
              {!part.prepared && (
                <Link
                  className="underline"
                  to={`/comercial/produtos?produto=${productId}`}
                >
                  Preparar placa para impressão
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={
            !parts.length ||
            !data.ready_to_assemble ||
            (itemId && !data.required) ||
            save.isPending
          }
          onClick={() => open({ kind: "assemble" })}
        >
          Montar produto final
        </Button>
        <Button variant="outline" asChild>
          <Link to="/producao/jobs">Acompanhar impressões</Link>
        </Button>
      </div>
      {!!qualityJobs.length && (
        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">Conferir peças impressas</h3>
          {qualityJobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"
            >
              <span>
                {job.code} ·{" "}
                {job.production_snapshot?.physical_outputs
                  ?.map((p) => `${p.quantity} × ${p.name}`)
                  .join(" + ")}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => open({ kind: "quality", job })}
              >
                Conferir {job.code}
              </Button>
            </div>
          ))}
        </section>
      )}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Histórico de montagem
        </summary>
        <ul className="mt-3 space-y-2 text-sm">
          {history
            .filter((h) => !itemId || h.item_id === itemId)
            .slice()
            .reverse()
            .map((h) => (
              <li className="border-t pt-2" key={h.id}>
                {new Date(h.created_at).toLocaleString("pt-BR")} · {h.quantity}{" "}
                produto(s) · custo{" "}
                {brl(Number(h.component_cost) + Number(h.finishing_cost))}
                {h.notes && <p className="text-muted-foreground">{h.notes}</p>}
              </li>
            ))}
          {!history.length && <li>Nenhuma montagem registrada.</li>}
        </ul>
      </details>
      <Dialog
        open={!!action}
        onOpenChange={(v) => {
          if (!v && !save.isPending) setAction(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          closeDisabled={save.isPending}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {action?.kind === "quality"
                ? "Informe a quantidade boa de cada peça. Somente as unidades aprovadas entram no estoque do respectivo subitem."
                : action?.kind === "assemble"
                  ? itemId
                    ? "Os subitens serão consumidos e os produtos montados ficarão destinados a esta ordem."
                    : "Os subitens serão consumidos e os produtos montados entrarão no estoque de produtos finais."
                  : action?.kind === "batch"
                    ? "A impressão produz todas as peças que estão nesta placa. Confira a previsão antes de enviar à fila."
                    : action?.kind === "entry"
                      ? "Informe as unidades físicas desta peça. Não é necessário preparar uma impressora para dar entrada no estoque."
                      : "Registre somente as peças perdidas. As outras peças do produto mantêm seus saldos."}
            </DialogDescription>
          </DialogHeader>
          {action?.kind === "quality" ? (
            <div className="space-y-3">
              {action.job.production_snapshot?.physical_outputs?.map((c) => (
                <div key={c.component_product_id}>
                  <Label htmlFor={`quality-${c.component_product_id}`}>
                    {c.name} — boas de {c.quantity} previstas
                  </Label>
                  <Input
                    id={`quality-${c.component_product_id}`}
                    type="number"
                    min={0}
                    max={c.quantity}
                    step={1}
                    value={counts[c.component_product_id] ?? ""}
                    onChange={(e) =>
                      setCounts((v) => ({
                        ...v,
                        [c.component_product_id]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                O custo total apurado desta placa será dividido entre as peças
                aprovadas.
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="physical-quantity">
                {action?.kind === "assemble"
                  ? "Produtos finais a montar"
                  : "Quantidade de peças"}
              </Label>
              <Input
                id="physical-quantity"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          )}
          {action?.kind === "assemble" && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium">Peças que serão consumidas</p>
              <ul>
                {parts.map((p) => (
                  <li key={p.id}>
                    {Number(quantity) * (p.quantity_per_product || 0)} ×{" "}
                    {p.label}{" "}
                    <span className="text-muted-foreground">
                      (disponível: {p.available})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {action?.kind === "batch" && runs > 0 && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium">{runs} impressão(ões):</p>
              <ul>
                {printParts.map((p) => (
                  <li key={p.id}>
                    {p.quantity_per_plate ? runs * p.quantity_per_plate : "?"} ×{" "}
                    {p.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2">As sobras ficam no estoque de cada peça.</p>
            </div>
          )}
          {(action?.kind === "entry" || action?.kind === "assemble") && (
            <div>
              <Label htmlFor="physical-cost">
                {action.kind === "entry"
                  ? "Custo por peça (R$)"
                  : "Custo adicional total de montagem (R$)"}
              </Label>
              <Input
                id="physical-cost"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </div>
          )}
          {action?.kind !== "batch" && (
            <div>
              <Label htmlFor="physical-notes">
                {action?.kind === "quality"
                  ? "Motivo das rejeições (se houver)"
                  : action?.kind === "assemble"
                    ? "Observações"
                    : "Motivo da movimentação"}
              </Label>
              <Input
                id="physical-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => setAction(null)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? "Salvando…"
                : action?.kind === "assemble"
                  ? "Confirmar montagem"
                  : action?.kind === "batch"
                    ? "Criar lote de impressão"
                    : "Confirmar peças"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
