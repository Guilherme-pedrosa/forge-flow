import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { currency, localDate, monthlyInstallments, money, positiveMoney, validDate } from "@/lib/finance";

export type PaymentPart = { amount: string; due_date: string };
export function generateParts(total: number, count: number, firstDate: string, days: string): PaymentPart[] {
  const rows = monthlyInstallments(total, count, firstDate);
  if (days && (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365)) throw new Error("Informe um intervalo de 1 a 365 dias.");
  return rows.map((part, i) => {
    const date = new Date(firstDate + "T12:00:00");
    if (days) date.setDate(date.getDate() + i * Number(days));
    return { amount: part.amount.toFixed(2), due_date: days ? localDate(date) : part.due_date };
  });
}
export function validateParts(parts: PaymentPart[], total: number) {
  if (!parts.length || parts.length > 120) throw new Error("Gere as parcelas antes de salvar.");
  const values = parts.map(part => {
    if (!validDate(part.due_date)) throw new Error("Revise os vencimentos das parcelas.");
    return { amount: positiveMoney(part.amount), due_date: part.due_date };
  });
  if (money(values.reduce((sum, part) => sum + part.amount, 0)) !== money(total)) throw new Error("A soma das parcelas deve ser igual ao total. Ajuste os valores ou gere novamente.");
  return values;
}
export function InstallmentEditor({ total, firstDate, count, days, parts, onFirstDate, onCount, onDays, onParts, disabled = false }: {
  total: number; firstDate: string; count: string; days: string; parts: PaymentPart[];
  onFirstDate: (v: string) => void; onCount: (v: string) => void; onDays: (v: string) => void; onParts: (v: PaymentPart[]) => void; disabled?: boolean;
}) {
  let preview: PaymentPart[] = []; let error = "";
  try { preview = generateParts(total, Number(count), firstDate, days); } catch (e) { error = (e as Error).message; }
  const rows = parts.length ? parts : preview;
  const sum = rows.reduce((s, p) => s + Number(p.amount.replace(",", ".")), 0);
  let balanced = false; try { balanced = money(sum) === money(total); } catch { /* incomplete input */ }
  const update = (i: number, key: keyof PaymentPart, value: string) => onParts(rows.map((p, idx) => idx === i ? { ...p, [key]: value } : p));
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Parcelas do pagamento">
    <div><h3 className="font-semibold">Pagamento</h3><p className="text-sm text-muted-foreground">Confira valores e vencimentos antes de salvar. Uma parcela corresponde ao pagamento à vista.</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><Label htmlFor="payment-count">Número de parcelas</Label><Input id="payment-count" type="number" min="1" max="120" value={count} disabled={disabled} onChange={e => { onCount(e.target.value); onParts([]); }} /></div>
      <div><Label htmlFor="payment-first">Primeiro vencimento</Label><Input id="payment-first" type="date" value={firstDate} disabled={disabled} onChange={e => { onFirstDate(e.target.value); onParts([]); }} /></div>
      <div><Label htmlFor="payment-days">Intervalo em dias</Label><Input id="payment-days" inputMode="numeric" placeholder="Mensal no mesmo dia" value={days} disabled={disabled} onChange={e => { onDays(e.target.value); onParts([]); }} /></div>
    </div>
    <Button type="button" variant="outline" disabled={disabled || !!error} onClick={() => onParts(preview)}>Gerar parcelas</Button>
    {rows.length > 0 && <div className="space-y-2">{rows.map((p, i) => <div key={i} className="grid grid-cols-[2rem_1fr_1fr] items-center gap-3"><span className="text-sm">{i + 1}/{rows.length}</span><Input aria-label={`Vencimento da parcela ${i + 1}`} type="date" value={p.due_date} disabled={disabled} onChange={e => update(i, "due_date", e.target.value)} /><Input aria-label={`Valor da parcela ${i + 1}`} inputMode="decimal" value={p.amount} disabled={disabled} onChange={e => update(i, "amount", e.target.value)} /></div>)}</div>}
    <p className="text-sm">Total das parcelas: <strong>{currency(Number.isFinite(sum) ? sum : 0)}</strong> · Total da operação: <strong>{currency(total)}</strong></p>
    {rows.length > 0 && !balanced && <p role="alert" className="text-sm text-destructive">O total mudou. Ajuste as parcelas ou clique em Gerar parcelas.</p>}
    {error && !rows.length && <p className="text-sm text-muted-foreground">Informe valor, vencimento e quantidade de parcelas válidos para gerar o pagamento.</p>}
  </section>;
}
