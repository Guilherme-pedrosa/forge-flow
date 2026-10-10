// API v2 contracts cross-checked against the public Shopee SDK schemas.
// ship_by_date is an absolute Unix deadline; days_to_ship is never used as a cutoff.
type Data = Record<string, unknown>;
export const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
export const SHOPEE_HOSTS = { BR: "https://openplatform.shopee.com.br", GLOBAL: "https://partner.shopeemobile.com" } as const;
export type ShopeeConfig = { partnerId: string; partnerKey: string; redirect: string; host: string };

export function numericId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Identificação da loja inválida.");
  const text = String(value);
  if (!/^[1-9]\d{0,15}$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error("Identificação numérica sem precisão ou inválida.");
  return text;
}
function textId(value: unknown, required = false): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Identificador externo sem precisão.");
  if (value != null && typeof value !== "number" && typeof value !== "string") throw new Error("Identificador externo inválido.");
  const text = value == null ? "" : String(value);
  if (text !== text.trim() || text.length > 160 || (required && !text)) throw new Error("Identificador externo inválido.");
  return text;
}
export function orderId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Número do pedido Shopee inválido.");
  return value;
}
export async function signShopeeRequest(partnerKey: string, partnerId: string, path: string, timestamp: number, token = "", shopId = "") {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(partnerKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${partnerId}${path}${timestamp}${token}${shopId}`));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function signedShopeeUrl(config: ShopeeConfig, path: string, params: Record<string, string> = {}, credentials?: { token: string; shopId: string }, timestamp = Math.floor(Date.now() / 1000)) {
  // Only fixed API paths used by this connector are allowed; there is no arbitrary URL ingress.
  if (!/^\/api\/v2\/(?:shop\/(?:auth_partner|get_shop_info)|auth\/(?:token\/get|access_token\/get)|order\/(?:get_order_list|get_order_detail))$/.test(path)) throw new Error("Recurso Shopee não permitido.");
  const url = new URL(path, config.host);
  const query = new URLSearchParams(params);
  query.set("partner_id", config.partnerId); query.set("timestamp", String(timestamp));
  if (credentials) { query.set("access_token", credentials.token); query.set("shop_id", credentials.shopId); }
  query.set("sign", await signShopeeRequest(config.partnerKey, config.partnerId, path, timestamp, credentials?.token, credentials?.shopId));
  url.search = query.toString(); return url;
}
function epoch(value: unknown, required = false): string | null {
  if (value == null || value === 0 || value === "0") { if (required) throw new Error("Horário oficial ausente no pedido Shopee."); return null; }
  const number = Number(value);
  if ((typeof value !== "number" && typeof value !== "string") || !Number.isSafeInteger(number) || number <= 0 || number > 253402300799) throw new Error("Horário Unix inválido no pedido Shopee.");
  return new Date(number * 1000).toISOString();
}
function money(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error("Valor monetário inválido no pedido Shopee.");
  const number = Number(value); if (!Number.isFinite(number) || number > 100000000) throw new Error("Valor monetário fora do limite."); return number;
}
export function normalizeShopeeOrder(value: unknown) {
  const raw = object(value);
  if (raw.currency !== "BRL" || raw.region !== "BR") throw new Error("Somente lojas e pedidos Shopee Brasil em BRL são aceitos.");
  if (!Array.isArray(raw.item_list) || raw.item_list.length < 1 || raw.item_list.length > 500) throw new Error("Pedido Shopee sem itens válidos.");
  const status = String(raw.order_status ?? "UNKNOWN");
  // total_amount is optional before payment. Missing commercial value is a review state,
  // never a reason to hide an unpaid/cancelled update from a mixed API page.
  const reported_total = raw.total_amount == null ? null : money(raw.total_amount);
  const pending = raw.pending_terms != null && (!Array.isArray(raw.pending_terms) || raw.pending_terms.length > 0);
  const paid = epoch(raw.pay_time) != null && raw.cod === false && reported_total != null && !pending;
  // IN_CANCEL is a cancellation request which the seller can accept or reject.
  const normalized_state = status === "CANCELLED" ? "cancelled" : status === "UNPAID" ? "awaiting_payment" :
    ["SHIPPED", "TO_CONFIRM_RECEIVE"].includes(status) ? "shipped" : status === "COMPLETED" ? "delivered" :
    ["READY_TO_SHIP", "PROCESSED"].includes(status) && paid ? "paid" : "unknown";
  const items = raw.item_list.map(entry => {
    const line = object(entry), quantity = Number(line.model_quantity_purchased);
    const title = typeof line.item_name === "string" ? line.item_name.trim() : "";
    const model = typeof line.model_name === "string" ? line.model_name.trim() : "";
    const description = model ? `${title} · ${model}` : title;
    if (!title || description.length > 500 || !Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw new Error("Descrição ou quantidade inválida no pedido Shopee.");
    return { external_line_id: "", external_item_id: textId(line.item_id, true),
      external_variant_id: textId(line.model_id),
      external_sku: textId(line.model_sku || line.item_sku), description, quantity,
      // A zero discounted price can be intentional for bundles; never replace it with list price.
      unit_price: money(line.model_discounted_price ?? line.model_original_price) };
  });
  // The API does not promise item_list ordering, and order_item_id can repeat in a bundle.
  // Stable multiset ordering prevents a harmless reordering from looking like a commercial edit.
  const lineKey = (line: typeof items[number]) => JSON.stringify([line.external_item_id, line.external_variant_id, line.external_sku, line.description, line.quantity, line.unit_price]);
  items.sort((a, b) => lineKey(a) < lineKey(b) ? -1 : lineKey(a) > lineKey(b) ? 1 : 0);
  items.forEach((line, index) => { line.external_line_id = String(index + 1); });
  const packages = Array.isArray(raw.package_list) ? raw.package_list : [];
  const deadline = epoch(raw.ship_by_date);
  return { external_order_id: orderId(raw.order_sn), external_pack_id: "", external_shipment_id: packages.length === 1 ? textId(object(packages[0]).package_number) : "",
    external_status: status, normalized_state, external_updated_at: epoch(raw.update_time, true), shipping_deadline_at: deadline,
    deadline_source: deadline ? "Shopee · v2.order.get_order_detail ship_by_date (Unix)" : "Shopee não retornou horário absoluto de despacho; confira no canal",
    currency: "BRL", shipping_amount: 0, discount_amount: 0, reported_total, seller_fees: null, items };
  // estimated_shipping_fee and actual_shipping_fee are not buyer freight nor settled seller fees.
  // Any difference against reported_total remains a visible reconciliation block in the inbox.
}
