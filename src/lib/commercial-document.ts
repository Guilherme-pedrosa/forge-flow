import { quoteSnapshotMaterials } from "@/components/comercial/QuoteSnapshotSummary";
import type { QuoteItem, QuoteRow } from "./sales-quote";

export interface DocumentCustomer { name?: string | null; document?: string | null; phone?: string | null; email?: string | null; address?: unknown }
export interface DocumentCompany { name: string; logo_url?: string | null; settings?: unknown }
export interface DocumentItem {
  description: string; quantity: number; unitPrice: number | null; total: number | null;
  details?: string; imageUrl?: string | null;
}
export interface CommercialDocument {
  kind: "quote" | "order"; code: string; status: string; date?: string | null;
  customer: DocumentCustomer; items: DocumentItem[];
  subtotal: number | null; discount: number; shipping: number; total: number | null;
  validUntil?: string | null; dueDate?: string | null; paymentDueDate?: string | null;
  payments?: { amount: number; due_date: string }[];
  notes?: string | null; deliveryAddress?: string;
}
interface OrderSource {
  code: string; status: string; created_at: string; due_date?: string | null;
  payment_due_date?: string | null; discount?: number | null; shipping?: number | null;
  total: number; notes?: string | null; customers?: DocumentCustomer | null;
}
interface OrderItemSource {
  description: string; quantity: number; unit_price: number | null; total: number | null;
  notes?: string | null; product_snapshot?: unknown; products?: { photo_url?: string | null } | null;
}
const statuses: Record<string, string> = {
  draft: "Rascunho", issued: "Emitido", approved: "Aprovado", rejected: "Rejeitado", cancelled: "Cancelado",
  in_production: "Em produção", ready: "Pronto", shipped: "Enviado", delivered: "Entregue",
};
export const documentStatus = (status: string) => statuses[status] || status;
const details = (item: OrderItemSource) => [
  [...new Set(quoteSnapshotMaterials(item.product_snapshot).map(value => `${value.material} · ${value.color}`))].join("; "),
  item.notes,
].filter(Boolean).join("\n");

export function orderDocument(order: OrderSource, items: OrderItemSource[]): CommercialDocument {
  const delivery = (order.notes || "").match(/^📍 Entrega: (.+?)(?:\n|$)/);
  return {
    kind: order.status === "draft" && /^ORC[-\s]/i.test(order.code) ? "quote" : "order",
    code: order.code, status: order.status, date: order.created_at, customer: order.customers || {},
    items: items.map(item => ({ description: item.description, quantity: item.quantity, unitPrice: item.unit_price,
      total: item.total, details: details(item), imageUrl: item.products?.photo_url })),
    subtotal: items.some(item => item.total == null) ? null : Math.round(items.reduce((sum, item) => sum + Number(item.total), 0) * 100) / 100,
    discount: Number(order.discount || 0), shipping: Number(order.shipping || 0), total: order.total,
    dueDate: order.due_date, paymentDueDate: order.payment_due_date,
    deliveryAddress: delivery?.[1], notes: delivery ? order.notes!.replace(delivery[0], "").trim() : order.notes,
  };
}

export function quoteDocument(quote: QuoteRow, items: QuoteItem[]): CommercialDocument {
  return {
    kind: "quote", code: quote.code, status: quote.status, date: quote.issued_at || quote.created_at,
    customer: quote.customer_snapshot || {},
    items: items.map(item => ({ description: item.description, quantity: item.quantity,
      unitPrice: item.unit_price, total: item.total, details: details(item) })),
    subtotal: quote.subtotal, discount: quote.discount, shipping: quote.shipping, total: quote.total,
    validUntil: quote.valid_until, dueDate: quote.due_date, paymentDueDate: quote.payment_due_date,
    payments: quote.payment_schedule?.map(part => ({ amount: part.amount, due_date: part.due_date })), notes: quote.notes,
  };
}

export function documentAddress(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const a = value as Record<string, unknown>;
  const parts = [a.street, a.number, a.complement, a.neighborhood, [a.city, a.state].filter(Boolean).join(" / "), a.zip ? `CEP ${String(a.zip).replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : ""];
  return parts.filter(value => typeof value === "string" || typeof value === "number").filter(Boolean).join(", ");
}

export function documentDate(value?: string | null): string {
  if (!value) return "A combinar";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "A combinar" : date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
export const documentMoney = (value: number | null | undefined) => value == null ? "A definir" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
export function documentFilename(document: Pick<CommercialDocument, "kind" | "code">): string {
  const code = document.code.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "documento";
  return `${document.kind === "quote" ? "Orcamento" : "Pedido"}-${code}.pdf`;
}
