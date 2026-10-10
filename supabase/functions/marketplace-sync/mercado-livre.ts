// Pure translation of documented Orders + Shipment SLA resources; no database side effects.
type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectData : {};
export function externalId(value: unknown, required = false): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Identificador numérico sem precisão. Consulte a origem como texto.");
  const id = value == null ? "" : String(value);
  if (id.length > 160 || (required && !id)) throw new Error("Identificador externo inválido.");
  return id;
}
function money(value: unknown, optional = false): number | null {
  if (value == null && optional) return null;
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error("Valor monetário inválido no canal.");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000000) throw new Error("Valor monetário fora do limite.");
  return number;
}
function timestamp(value: unknown, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== "string" || !/T.+(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Data com fuso ausente ou inválida no canal.");
  return value;
}
export function normalizeMercadoLivreOrder(rawValue: unknown, slaValue: unknown, sellerId: string) {
  const raw = object(rawValue), seller = object(raw.seller), shipping = object(raw.shipping), sla = object(slaValue);
  if (externalId(seller.id, true) !== sellerId) throw new Error("O pedido pertence a outro vendedor.");
  if (raw.currency_id !== "BRL") throw new Error("Somente pedidos em BRL são aceitos nesta entrega.");
  if (!Array.isArray(raw.order_items) || raw.order_items.length < 1 || raw.order_items.length > 500) throw new Error("Pedido sem itens válidos.");
  const status = String(raw.status ?? "unknown");
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  const normalized_state = ["cancelled", "pending_cancel"].includes(status) ? "cancelled" :
    status === "paid" ? tags.includes("delivered") ? "delivered" : tags.includes("shipped") ? "shipped" : "paid" : ["confirmed", "payment_required", "payment_in_process", "partially_paid"].includes(status) ? "awaiting_payment" : "unknown";
  // partially_refunded requires reconciliation; fraud risk must never release production.
  const fraud = tags.includes("fraud_risk_detected");
  const items = raw.order_items.map((lineValue, index) => {
    const line = object(lineValue), item = object(line.item);
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw new Error("Quantidade inválida no pedido.");
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 500) throw new Error("Descrição inválida no pedido.");
    return { external_line_id: String(index + 1), external_item_id: externalId(item.id, true),
      external_variant_id: externalId(item.variation_id), external_sku: externalId(item.seller_sku ?? item.seller_custom_field),
      description: title, quantity, unit_price: money(line.unit_price) };
  });
  return { external_order_id: externalId(raw.id, true), external_pack_id: externalId(raw.pack_id),
    external_shipment_id: externalId(shipping.id), external_status: fraud ? `${status}:fraud_risk_detected` : status,
    normalized_state: fraud ? "unknown" : normalized_state,
    external_updated_at: timestamp(raw.date_last_updated ?? raw.last_updated, true),
    shipping_deadline_at: timestamp(sla.expected_date), deadline_source: "Mercado Livre · shipment SLA expected_date",
    currency: "BRL", shipping_amount: money(raw.shipping_cost ?? 0), discount_amount: 0,
    reported_total: money(raw.total_amount), seller_fees: null, items };
}
