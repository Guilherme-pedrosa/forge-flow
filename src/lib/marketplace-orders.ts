import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export type MarketplaceChannel = "mercado_livre" | "shopee" | "tiktok_shop";
export const marketplaceLabels: Record<MarketplaceChannel, string> = { mercado_livre: "Mercado Livre", shopee: "Shopee", tiktok_shop: "TikTok Shop" };
export const marketplaceStateLabels: Record<string, string> = { paid: "Pago", awaiting_payment: "Aguardando pagamento", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado", unknown: "Revisar situação" };
const identifier = z.string().trim().min(1).max(160);
const optionalIdentifier = z.string().trim().max(160).default("");
const money = z.preprocess(value => typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Number(value) : value,
  z.number().finite().min(0).max(100000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Use até duas casas decimais"));
const timestamp = z.string().datetime({ offset: true, message: "Informe data e hora com fuso (ex.: 2026-10-10T18:00:00-03:00)" });
const lineSchema = z.object({
  external_line_id: identifier,
  external_item_id: optionalIdentifier,
  external_variant_id: optionalIdentifier,
  external_sku: optionalIdentifier,
  description: z.string().trim().min(1).max(500),
  quantity: z.preprocess(value => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value, z.number().int().min(1).max(500)),
  unit_price: money,
}).refine(line => line.external_sku || line.external_item_id, "Informe SKU ou ID do anúncio");
const orderSchema = z.object({
  external_order_id: identifier,
  external_pack_id: optionalIdentifier,
  external_shipment_id: optionalIdentifier,
  external_status: z.string().trim().min(1).max(80),
  normalized_state: z.enum(["paid", "awaiting_payment", "shipped", "delivered", "cancelled", "unknown"]),
  external_updated_at: timestamp,
  shipping_deadline_at: timestamp.nullable().default(null),
  deadline_source: z.string().trim().max(120).default("importação conferida"),
  currency: z.literal("BRL").default("BRL"),
  shipping_amount: money.default(0),
  discount_amount: money.default(0),
  reported_total: money.nullable().default(null),
  seller_fees: money.nullable().default(null),
  items: z.array(lineSchema).min(1).max(500),
}).superRefine((order, ctx) => {
  const ids = new Set<string>();
  for (const [i, line] of order.items.entries()) {
    if (ids.has(line.external_line_id)) ctx.addIssue({ code: "custom", path: ["items", i, "external_line_id"], message: "ID de linha repetido no pedido" });
    ids.add(line.external_line_id);
  }
  const subtotal = order.items.reduce((sum, line) => sum + line.quantity * Math.round(line.unit_price * 100), 0);
  if (Math.round(order.discount_amount * 100) > subtotal) ctx.addIssue({ code: "custom", path: ["discount_amount"], message: "Desconto maior que os itens" });
});
export type CanonicalMarketplaceOrder = z.infer<typeof orderSchema>;
export type MarketplaceAccount = { id: string; channel: MarketplaceChannel; name: string; external_seller_id: string | null; connection_state: string; last_sync_at: string | null };
export type MarketplaceOrderLine = z.infer<typeof lineSchema> & { id: string; product_id: string | null };
export type MarketplaceInboxOrder = Omit<CanonicalMarketplaceOrder, "items"> & { id: string; internal_order_id: string | null; needs_review: boolean; review_reason: string | null; items: MarketplaceOrderLine[]; total: number };
export const marketplaceBindingKey = (line: Pick<MarketplaceOrderLine, "external_item_id" | "external_variant_id" | "external_sku">) => JSON.stringify([line.external_item_id, line.external_variant_id, line.external_sku]);

/** One CSV row per order line. Repeated order fields must agree; IDs stay strings. */
function csvRecords(input: string): Record<string, string>[] {
  const firstLine = input.split(/\r?\n/, 1)[0];
  const separator = firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, afterQuote = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else field += c;
    } else if (c === separator || c === "\n" || c === "\r") {
      row.push(field); field = ""; afterQuote = false;
      if (c !== separator) { if (row.some(Boolean)) rows.push(row); row = []; if (c === "\r" && input[i + 1] === "\n") i++; }
    } else if (c === '"' && !field && !afterQuote) quoted = true;
    else { if (afterQuote || c === '"') throw new Error("CSV com aspas inválidas."); field += c; }
  }
  if (quoted) throw new Error("CSV com aspas não fechadas.");
  row.push(field); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map(value => value.trim()) ?? [];
  if (new Set(headers).size !== headers.length || headers.some(value => !value)) throw new Error("Cabeçalhos do CSV inválidos ou repetidos.");
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Linha ${index + 2}: quantidade de colunas diferente do cabeçalho.`);
    return Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
  });
}

export function parseMarketplaceImport(input: string, format: "json" | "csv"): CanonicalMarketplaceOrder[] {
  if (new TextEncoder().encode(input).length > 1024 * 1024) throw new Error("Importe arquivos de até 1 MB.");
  const text = input.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Selecione um arquivo ou cole os pedidos.");
  let values: unknown;
  if (format === "json") {
    try { values = JSON.parse(text); } catch { throw new Error("JSON inválido. Use o modelo disponível."); }
    if (!Array.isArray(values)) values = [values];
  } else {
    const grouped = new Map<string, Record<string, unknown>>();
    const orderFields = ["external_pack_id", "external_shipment_id", "external_status", "normalized_state", "external_updated_at", "shipping_deadline_at", "deadline_source", "currency", "shipping_amount", "discount_amount", "reported_total", "seller_fees"];
    for (const row of csvRecords(text)) {
      const id = row.external_order_id;
      if (!id) throw new Error("CSV precisa da coluna external_order_id em todas as linhas.");
      const fields = Object.fromEntries(orderFields.filter(key => row[key] !== undefined && row[key] !== "").map(key => [key, row[key]]));
      const existing = grouped.get(id);
      if (existing && JSON.stringify(existing.fields) !== JSON.stringify(fields)) throw new Error(`Pedido ${id}: campos de pedido divergentes entre linhas.`);
      const entry = existing ?? { external_order_id: id, ...fields, fields, items: [] };
      (entry.items as unknown[]).push(Object.fromEntries(["external_line_id", "external_item_id", "external_variant_id", "external_sku", "description", "quantity", "unit_price"].map(key => [key, row[key] ?? ""])));
      grouped.set(id, entry);
    }
    values = [...grouped.values()];
  }
  const parsed = z.array(orderSchema).min(1).max(100).safeParse(values);
  if (!parsed.success) {
    const error = parsed.error.issues[0];
    throw new Error(`Pedido ${Number(error.path[0]) + 1}, ${error.path.slice(1).join(".") || "dados"}: ${error.message}`);
  }
  if (new Set(parsed.data.map(order => order.external_order_id)).size !== parsed.data.length) throw new Error("ID de pedido repetido no arquivo.");
  return parsed.data;
}

// Keep new RPC/table types local until the deployed database regenerates typegen.
export const marketplaceDb = supabase as unknown as import("@supabase/supabase-js").SupabaseClient;
export async function marketplaceRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await marketplaceDb.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export const marketplaceImportExample = JSON.stringify([{
  external_order_id: "PEDIDO-EXEMPLO", external_status: "paid", normalized_state: "paid", external_updated_at: "2026-10-10T12:00:00-03:00",
  shipping_deadline_at: "2026-10-13T17:00:00-03:00", deadline_source: "prazo conferido no pedido", currency: "BRL", shipping_amount: 0, discount_amount: 0,
  items: [{ external_line_id: "LINHA-1", external_item_id: "ANUNCIO-1", external_variant_id: "", external_sku: "SKU-INTERNO", description: "Produto vendido", quantity: 1, unit_price: 49.9 }],
}], null, 2);
