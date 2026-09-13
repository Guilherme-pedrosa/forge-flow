/** Calendar dates never pass through UTC: business dates must not jump a day. */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDate(date) === value;
}

export function money(value: number | string): number {
  let normalized: number | string = value;
  if (typeof value === "string") {
    const text = value.trim();
    const valid = text.includes(",") ? /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text) : /^-?\d+(?:\.\d+)?$/.test(text);
    if (!valid) throw new Error("Informe um valor válido.");
    normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  }
  const n = normalized === "" ? NaN : Number(normalized);
  if (!Number.isFinite(n) || Math.abs(n) > 999999999999.99) throw new Error("Informe um valor válido.");
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
}

export function positiveMoney(value: number | string): number {
  const amount = money(value);
  if (amount <= 0) throw new Error("O valor deve ser maior que zero.");
  return amount;
}

export const currency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
export const displayDate = (value?: string | null) => value && validDate(value) ? value.split("-").reverse().join("/") : "—";

export interface FinancialTitle {
  amount: number;
  amount_paid?: number;
  amount_received?: number;
  due_date: string;
  status: string;
}

export const settledAmount = (title: FinancialTitle) => money(title.amount_paid ?? title.amount_received ?? 0);
export const outstandingAmount = (title: FinancialTitle) => Math.max(0, money(title.amount - settledAmount(title)));
export const isCancelled = (title: FinancialTitle) => ["cancelled", "reversed"].includes(title.status);
export function effectiveStatus(title: FinancialTitle, today = localDate()): "cancelled" | "settled" | "overdue" | "partial" | "open" {
  if (isCancelled(title)) return "cancelled";
  if (outstandingAmount(title) === 0) return "settled";
  if (title.due_date < today) return "overdue";
  return settledAmount(title) > 0 ? "partial" : "open";
}

export function validateSettlement(title: FinancialTitle, amount: number | string, date: string, today = localDate()): number {
  if (isCancelled(title) || outstandingAmount(title) === 0) throw new Error("Este título não tem saldo disponível para baixa.");
  const value = positiveMoney(amount);
  if (value > outstandingAmount(title)) throw new Error("O valor supera o saldo em aberto.");
  if (!validDate(date) || date > today) throw new Error("Informe uma data válida, até hoje.");
  return value;
}

export function monthlyInstallments(total: number, count: number, firstDate: string) {
  const cents = Math.round(positiveMoney(total) * 100);
  if (!Number.isInteger(count) || count < 1 || count > 120 || cents < count) throw new Error("Quantidade de parcelas inválida para este valor.");
  if (!validDate(firstDate)) throw new Error("Informe o vencimento da primeira parcela.");
  const [year, month, day] = firstDate.split("-").map(Number);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => {
    const lastDay = new Date(year, month + i, 0, 12).getDate();
    return { amount: (base + (i < cents % count ? 1 : 0)) / 100, due_date: localDate(new Date(year, month - 1 + i, Math.min(day, lastDay), 12)) };
  });
}

/** Supabase defaults to a row cap; fetch every page before showing financial totals. */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await page(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
