import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { unitCommission } from "@/lib/consignment";
type Item = {
  product_id: string;
  name: string;
  current_qty: number;
  unit_price: number;
};
export type ReconciliationLine = {
  product_id: string;
  expected_qty: number;
  unit_price: number;
  sold: number;
  returned: number;
};
const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function ConsignmentReconciliation({
  items,
  commission,
  onClose,
  onSave,
}: {
  items: Item[];
  commission: number;
  onClose: () => void;
  onSave: (
    items: ReconciliationLine[],
    commission: number,
    notes: string,
  ) => Promise<unknown>;
}) {
  const [snapshot] = useState({ items, commission });
  const [lines, setLines] = useState(
    items.map((i) => ({ ...i, sold: "0", returned: "0" })),
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const summary = useMemo(() => {
    let gross = 0,
      fees = 0,
      returns = 0;
    for (const line of lines) {
      if (
        !/^\d+$/.test(line.sold) ||
        !/^\d+$/.test(line.returned) ||
        Number(line.sold) + Number(line.returned) > line.current_qty
      )
        return {
          error: `Revise vendas e devoluções de ${line.name}.`,
          gross: 0,
          fees: 0,
          returns: 0,
        };
      if (Number(line.sold) > 0 && line.unit_price <= 0)
        return {
          error: `Informe o preço de ${line.name} no ponto antes de vender.`,
          gross: 0,
          fees: 0,
          returns: 0,
        };
      gross += Number(line.sold) * line.unit_price;
      fees +=
        Number(line.sold) *
        unitCommission(line.unit_price, snapshot.commission);
      returns += Number(line.returned);
    }
    return { gross, fees, returns, error: "" };
  }, [lines, snapshot]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] w-[96vw] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b p-5 pr-12">
          <DialogTitle>Conferir vendas e devoluções</DialogTitle>
          <DialogDescription>
            Informe o que foi vendido e o que está recolhendo. O restante
            permanece no ponto.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          {lines.map((line, i) => (
            <article
              key={line.product_id}
              className="space-y-3 rounded-lg border p-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="break-words">{line.name}</strong>
                <span className="text-sm">
                  Saldo: {line.current_qty} · {money(line.unit_price)} / un.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`reconcile-sold-${i}`}>Vendidas</Label>
                  <Input
                    id={`reconcile-sold-${i}`}
                    disabled={busy}
                    min={0}
                    max={line.current_qty}
                    type="number"
                    value={line.sold}
                    onChange={(e) =>
                      setLines(
                        lines.map((l, j) =>
                          j === i ? { ...l, sold: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`reconcile-return-${i}`}>
                    Recolher ao estoque
                  </Label>
                  <Input
                    id={`reconcile-return-${i}`}
                    disabled={busy}
                    min={0}
                    max={line.current_qty}
                    type="number"
                    value={line.returned}
                    onChange={(e) =>
                      setLines(
                        lines.map((l, j) =>
                          j === i ? { ...l, returned: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Permanecem no ponto:{" "}
                {Math.max(
                  0,
                  line.current_qty - Number(line.sold) - Number(line.returned),
                )}
              </p>
            </article>
          ))}
          <div className="grid gap-3 rounded-lg bg-muted p-4 text-sm sm:grid-cols-3">
            <div>
              Vendas brutas
              <strong className="block text-lg">{money(summary.gross)}</strong>
            </div>
            <div>
              Comissão ({snapshot.commission}%)
              <strong className="block text-lg">{money(summary.fees)}</strong>
            </div>
            <div>
              Repasse a receber
              <strong className="block text-lg">
                {money(summary.gross - summary.fees)}
              </strong>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            As devoluções retornam ao estoque vinculado. O repasse fica em
            contas a receber; confirme o pagamento quando ele ocorrer.
          </p>
          <Label htmlFor="reconcile-notes">Observações da conferência</Label>
          <Textarea
            id="reconcile-notes"
            value={notes}
            disabled={busy}
            onChange={(e) => setNotes(e.target.value)}
          />
          {(error || summary.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || summary.error}
            </p>
          )}
        </div>
        <DialogFooter className="border-t p-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Voltar
          </Button>
          <Button
            disabled={
              busy || !!summary.error || (!summary.gross && !summary.returns)
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSave(
                  lines
                    .filter((l) => Number(l.sold) + Number(l.returned) > 0)
                    .map((l) => ({
                      product_id: l.product_id,
                      expected_qty: l.current_qty,
                      unit_price: l.unit_price,
                      sold: Number(l.sold),
                      returned: Number(l.returned),
                    })),
                  snapshot.commission,
                  notes.trim(),
                );
                onClose();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Registrando…" : "Confirmar conferência"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
