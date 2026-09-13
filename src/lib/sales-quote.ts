import { positiveInteger, nonNegative } from "./production";
import { roundMoney } from "./sales-order";

export type QuoteStatus = "draft" | "issued" | "approved" | "rejected";
export const quoteStatus: Record<QuoteStatus, string> = { draft: "Rascunho", issued: "Emitido", approved: "Aprovado", rejected: "Rejeitado" };
export interface QuoteSnapshot { schema_version?: number; complete?: boolean; cost_per_unit?: number | null; missing?: string[]; product?: { name?: string; sku?: string | null }; requirements?: unknown[]; plates?: unknown[]; components?: unknown[]; [key: string]: unknown }
export interface QuoteRow extends Record<string, unknown> {
  id: string; tenant_id: string; code: string; status: QuoteStatus; revision: number;
  customer_id: string | null; customer_snapshot: { name?: string; document?: string; email?: string; phone?: string; address?: unknown } | null;
  valid_until: string | null; due_date: string | null; payment_due_date: string | null;
  subtotal: number | null; discount: number; shipping: number; total: number | null;
  notes: string | null; rejection_reason: string | null; order_id: string | null;
  issued_at: string | null; approved_at: string | null; rejected_at: string | null; converted_at: string | null; created_at: string; updated_at: string;
}
export interface QuoteItem extends Record<string, unknown> {
  id: string; tenant_id: string; quote_id: string; line_index: number; product_id: string; description: string;
  quantity: number; unit_price: number | null; total: number | null; notes: string | null;
  estimated_unit_cost: number | null; estimated_total_cost: number | null; product_snapshot: QuoteSnapshot;
}
export interface QuoteDraftLine { key: string; product_id: string; description: string; quantity: string; unit_price: string; notes: string }
export const quoteMoney = (value: number | null | undefined) => value == null ? "Pendente" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function prepareQuote(lines: QuoteDraftLine[], freight: string, discount: string) {
  if (!lines.length || lines.length > 500) throw new Error("Inclua entre 1 e 500 produtos.");
  const items = lines.map((line, index) => {
    if (!line.product_id) throw new Error(`Selecione o produto do item ${index + 1}.`);
    if (!line.description.trim()) throw new Error(`Informe a descrição do item ${index + 1}.`);
    const quantity = positiveInteger(line.quantity, `Quantidade do item ${index + 1}`, 500);
    const unit_price = line.unit_price.trim() === "" ? null : roundMoney(nonNegative(line.unit_price, `Preço do item ${index + 1}`));
    return { product_id: line.product_id, description: line.description.trim(), quantity, unit_price, total: unit_price == null ? null : roundMoney(quantity * unit_price), notes: line.notes.trim() || null };
  });
  const shipping = roundMoney(nonNegative(freight || "0", "Frete"));
  const discountValue = roundMoney(nonNegative(discount || "0", "Desconto"));
  const subtotal = items.some(item => item.total == null) ? null : roundMoney(items.reduce((sum, item) => sum + item.total!, 0));
  if (subtotal != null && discountValue > subtotal) throw new Error("O desconto não pode superar o subtotal.");
  return { items, shipping, discount: discountValue, subtotal, total: subtotal == null ? null : roundMoney(subtotal - discountValue + shipping) };
}
export function quoteCostSummary(items: QuoteItem[], quote: Pick<QuoteRow, "subtotal" | "discount">) {
  const incomplete = !items.length || items.some(item => item.product_snapshot.complete !== true || item.estimated_total_cost == null || !Number.isFinite(Number(item.estimated_total_cost)) || Number(item.estimated_total_cost) < 0);
  const cost = incomplete ? null : roundMoney(items.reduce((sum, item) => sum + Number(item.estimated_total_cost), 0));
  const revenue = quote.subtotal == null ? null : roundMoney(quote.subtotal - quote.discount);
  const result = cost == null || revenue == null ? null : roundMoney(revenue - cost);
  return { incomplete, cost, result, margin: result == null || revenue == null || revenue <= 0 ? null : result / revenue * 100 };
}

/** Time is a preparation requirement separate from BOM/cost completeness. */
export function quoteSnapshotTimeIssues(snapshot: unknown, depth = 0): string[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || depth > 20) return ["Complete a composição de produção."];
  const value = snapshot as Record<string, unknown>;
  if (Array.isArray(value.components) && value.components.length) return [...new Set(value.components.flatMap(component => quoteSnapshotTimeIssues((component as { snapshot?: unknown })?.snapshot, depth + 1)))];
  if (Array.isArray(value.plates) && value.plates.length) return value.plates.flatMap(plate => {
    const row = plate as { label?: string; est_time_seconds?: number | null }; const seconds = Number(row?.est_time_seconds);
    return Number.isFinite(seconds) && seconds > 0 ? [] : [`Informe o tempo por impressão da placa ${row?.label || "sem nome"}.`];
  });
  const product = value.product as { name?: string; est_time_minutes?: number | null } | undefined; const minutes = Number(product?.est_time_minutes);
  return Number.isInteger(minutes) && minutes > 0 ? [] : [`Informe o tempo por impressão de ${product?.name || "cada produto"}.`];
}
