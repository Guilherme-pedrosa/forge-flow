/** Read-only planning. The Forge ledger and server-side channel checks remain authoritative. */
export type ForgeFinishedAvailability = {
  tenantId: string; productId: string; available: number | null; snapshotAt: string; revision: string;
};
export type ExternalPaidStockOrder = {
  tenantId: string; sellerId: string; externalOrderId: string; externalLineId: string; productId: string | null;
  channel?: string;
  state: "paid" | "shipped" | "delivered" | "awaiting_payment" | "cancelled" | "unknown";
  quantity: number;
  /** Units already represented by a Forge reservation OR posted stock allocation, counted once.
   * An imported draft/internal_order_id alone is not evidence of stock coverage. Null is unknown. */
  quantityAlreadyAccounted: number | null;
  snapshotAt: string;
};
export type MarketplaceListingStockSnapshot = {
  tenantId: string; accountId: string; sellerId: string; productId: string; itemId: string; variationId: string;
  userProductId: string | null; currentQuantity: number | null; snapshotAt: string;
  state: "active" | "paused_no_stock" | "paused_manual" | "paused_moderation" | "closed" | "unknown";
  warehouse: { state: "single" | "not_applicable" | "multiple" | "unknown"; id: string | null; version: string | null; externalLogisticsStock: boolean | null };
};
export type MarketplaceStockPreviewInput = {
  tenantId: string; now: string; maxAgeMs: number; ordersComplete: boolean;
  /** Read availability and external coverage in one consistent server snapshot.
   * Already net of ledger debits and finished_stock_free assembly/storefront holds; never pass raw stock.
   * Browser timestamps alone do not prove that a concurrently allocated order is covered. */
  finishedAvailability: ForgeFinishedAvailability[];
  externalPaidOrders: ExternalPaidStockOrder[];
  listings: MarketplaceListingStockSnapshot[];
};
export type MarketplaceStockBucketPreview = {
  key: string; productId: string; sellerId: string; accountIds: string[]; itemIds: string[]; userProductId: string | null;
  currentQuantity: number | null; proposedQuantity: number | null; allocatedQuantity: number;
  safeToIncrease: boolean; preserveStatus: true; requiresReview: boolean; issues: string[];
};
export type MarketplaceProductStockPreview = {
  productId: string; available: number | null; unaccountedPaidQuantity: number; budget: number | null;
  allocatedQuantity: number; unallocatedQuantity: number | null; complete: boolean; issues: string[];
};
export type MarketplaceStockPreview = {
  tenantId: string; previewOnly: true; writesEnabled: false; complete: boolean;
  products: MarketplaceProductStockPreview[]; buckets: MarketplaceStockBucketPreview[]; issues: string[];
};
const unique = (values: string[]) => [...new Set(values)].sort();
function identifier(value: string, label: string) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 200 || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error(`Identificador inválido: ${label}.`);
}
function quantity(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1e9) throw new Error(`Quantidade inválida: ${label}.`);
}
const compareKeys = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function timestamp(value: string): number | null {
  if (typeof value !== "string" || !/T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const result = Date.parse(value); return Number.isFinite(result) ? result : null;
}
/** A user_product stock resource belongs to a seller, even if that seller appears under two local account records. */
export function marketplaceStockBucketKey(listing: MarketplaceListingStockSnapshot): string {
  return JSON.stringify([listing.tenantId, listing.sellerId, ...(listing.userProductId ? ["user_product", listing.userProductId] : ["item", listing.itemId, listing.variationId])]);
}
function distribute(budget: number, caps: number[]): number[] {
  const result = caps.map(() => 0); let remaining = budget, open = caps.map((_, index) => index).filter(index => caps[index] > 0);
  while (remaining > 0 && open.length) {
    const share = Math.max(1, Math.floor(remaining / open.length));
    for (const index of open) {
      const granted = Math.min(share, caps[index] - result[index], remaining);
      result[index] += granted; remaining -= granted;
    }
    open = open.filter(index => result[index] < caps[index]);
  }
  return result;
}

/** One finished-product budget, shared across every seller/listing stock bucket.
 * It never sends stock, activates a listing, reads credentials, or treats requested data as a confirmed remote write. */
export function previewMarketplaceStock(input: MarketplaceStockPreviewInput): MarketplaceStockPreview {
  identifier(input.tenantId, "empresa");
  const now = timestamp(input.now);
  if (now === null || !Number.isSafeInteger(input.maxAgeMs) || input.maxAgeMs <= 0 || typeof input.ordersComplete !== "boolean")
    throw new Error("Informe o momento e o limite de validade dos snapshots e a completude dos pedidos.");
  const fresh = (at: string) => { const time = timestamp(at); return time !== null && time <= now && now - time <= input.maxAgeMs; };
  for (const row of [...input.finishedAvailability, ...input.externalPaidOrders, ...input.listings])
    if (row.tenantId !== input.tenantId) throw new Error("O snapshot contém dados de outra empresa.");
  type ProductWork = { available: number | null; paid: number; issues: string[] };
  const work = new Map<string, ProductWork>();
  const product = (id: string) => { identifier(id, "produto"); if (!work.has(id)) work.set(id, { available: null, paid: 0, issues: ["finished_availability_missing"] }); return work.get(id)!; };
  const availabilityIds = new Set<string>();
  for (const row of input.finishedAvailability) {
    identifier(row.productId, "produto"); if (availabilityIds.has(row.productId)) throw new Error("Há mais de um saldo Forge para o mesmo produto.");
    availabilityIds.add(row.productId);
    if (row.available !== null) quantity(row.available, "saldo disponível Forge");
    const issues = [...(!fresh(row.snapshotAt) ? ["finished_availability_stale"] : []), ...(!row.revision?.trim() ? ["finished_revision_missing"] : []), ...(row.available === null ? ["finished_availability_missing"] : [])];
    work.set(row.productId, { available: row.available, paid: 0, issues });
  }
  const globalIssues = input.ordersComplete ? [] : ["external_orders_incomplete"];
  const orders = new Map<string, ExternalPaidStockOrder>();
  for (const row of input.externalPaidOrders) {
    identifier(row.sellerId, "vendedor"); identifier(row.externalOrderId, "pedido externo"); identifier(row.externalLineId, "linha externa");
    quantity(row.quantity, "quantidade do pedido externo");
    if (row.quantity === 0 || !["paid", "shipped", "delivered", "awaiting_payment", "cancelled", "unknown"].includes(row.state)) throw new Error("Quantidade ou estado externo inválido.");
    if (row.quantityAlreadyAccounted !== null) { quantity(row.quantityAlreadyAccounted, "quantidade já coberta pelo Forge"); if (row.quantityAlreadyAccounted > row.quantity) throw new Error("A cobertura do Forge supera a quantidade externa."); }
    const key = JSON.stringify([row.tenantId, row.channel ?? "mercado_livre", row.sellerId, row.externalOrderId, row.externalLineId]), previous = orders.get(key);
    if (previous) {
      const signature = (value: ExternalPaidStockOrder) => JSON.stringify([value.productId, value.state, value.quantity, value.quantityAlreadyAccounted, value.snapshotAt]);
      if (signature(previous) !== signature(row)) {
        if (previous.productId) product(previous.productId).issues.push("external_order_line_conflict");
        if (row.productId) product(row.productId).issues.push("external_order_line_conflict");
        if (!row.productId || !previous.productId) globalIssues.push("unbound_external_order_conflict");
      }
      continue;
    }
    orders.set(key, row);
  }
  for (const row of orders.values()) {
    if (row.state === "cancelled" || row.state === "awaiting_payment") continue;
    if (!row.productId) { globalIssues.push("paid_external_order_unbound"); continue; }
    const target = product(row.productId);
    if (!fresh(row.snapshotAt)) target.issues.push("external_order_stale");
    if (row.state === "unknown") { target.issues.push("external_order_state_unknown"); continue; }
    if (row.quantityAlreadyAccounted === null) target.issues.push("external_order_stock_coverage_unknown");
    // Unknown coverage conservatively holds the whole line and blocks increases.
    target.paid += row.quantity - (row.quantityAlreadyAccounted ?? 0);
  }
  const grouped = new Map<string, MarketplaceListingStockSnapshot[]>();
  for (const row of input.listings) {
    identifier(row.productId, "produto vinculado"); identifier(row.accountId, "conta"); identifier(row.sellerId, "vendedor"); identifier(row.itemId, "anúncio");
    if (row.userProductId !== null) identifier(row.userProductId, "user_product");
    if (row.currentQuantity !== null) quantity(row.currentQuantity, "saldo do canal");
    if (!["active", "paused_no_stock", "paused_manual", "paused_moderation", "closed", "unknown"].includes(row.state)
      || !["single", "not_applicable", "multiple", "unknown"].includes(row.warehouse.state)) throw new Error("Estado do anúncio ou armazém inválido.");
    product(row.productId);
    const key = marketplaceStockBucketKey(row); grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  type BucketWork = { result: MarketplaceStockBucketPreview; participating: boolean; protectedPause: boolean; warehouseUsable: boolean };
  const buckets: BucketWork[] = [];
  for (const [key, rows] of [...grouped].sort(([a], [b]) => compareKeys(a, b))) {
    const first = rows[0], issues: string[] = [];
    const productIds = unique(rows.map(row => row.productId));
    if (productIds.length !== 1) issues.push("shared_stock_product_conflict");
    const current = rows.every(row => row.currentQuantity !== null && row.currentQuantity === first.currentQuantity) ? first.currentQuantity : null;
    if (current === null) issues.push("remote_quantity_unknown_or_conflicting");
    if (rows.some(row => !fresh(row.snapshotAt))) issues.push("remote_snapshot_stale");
    if (rows.some(row => row.state === "unknown")) issues.push("remote_status_unknown");
    const locations = unique(rows.flatMap(row => row.warehouse.id ? [row.warehouse.id] : []));
    const warehouseUsable = !rows.some(row => row.warehouse.state === "unknown" || row.warehouse.state === "multiple" || row.warehouse.externalLogisticsStock !== false
      || row.warehouse.state === "single" && !row.warehouse.id?.trim()
      || row.userProductId && (row.warehouse.state !== "single" || !row.warehouse.id?.trim() || !row.warehouse.version?.trim())) && locations.length <= 1;
    if (!warehouseUsable) issues.push("warehouse_or_version_unconfirmed");
    for (const id of productIds) product(id).issues.push(...issues);
    const protectedPause = rows.some(row => ["paused_manual", "paused_moderation"].includes(row.state));
    buckets.push({ result: { key, productId: first.productId, sellerId: first.sellerId, accountIds: unique(rows.map(row => row.accountId)), itemIds: unique(rows.map(row => row.itemId)), userProductId: first.userProductId,
      currentQuantity: current, proposedQuantity: null, allocatedQuantity: 0, safeToIncrease: false, preserveStatus: true, requiresReview: issues.length > 0 || protectedPause,
      issues: unique([...issues, ...(protectedPause ? ["manual_or_moderation_pause_preserved"] : [])]) },
      participating: rows.some(row => ["active", "paused_no_stock", "unknown"].includes(row.state)),
      protectedPause, warehouseUsable: warehouseUsable && productIds.length === 1 });
  }
  const products: MarketplaceProductStockPreview[] = [];
  for (const [productId, state] of [...work].sort(([a], [b]) => compareKeys(a, b))) {
    const issues = unique([...globalIssues, ...state.issues]);
    const budget = state.available === null ? null : Math.max(0, state.available - state.paid);
    const targets = buckets.filter(bucket => bucket.result.productId === productId && bucket.participating && bucket.warehouseUsable);
    const caps = targets.map(bucket => issues.length || bucket.protectedPause ? bucket.result.currentQuantity ?? 0 : budget ?? 0);
    const allocations = distribute(budget ?? 0, caps);
    targets.forEach((bucket, index) => {
      bucket.result.allocatedQuantity = allocations[index];
      bucket.result.proposedQuantity = bucket.result.currentQuantity === null ? null : allocations[index];
      bucket.result.safeToIncrease = issues.length === 0 && !bucket.protectedPause;
      bucket.result.requiresReview ||= issues.length > 0 || bucket.protectedPause;
      bucket.result.issues = unique([...bucket.result.issues, ...issues, ...(bucket.protectedPause ? ["manual_or_moderation_pause_preserved"] : [])]);
    });
    const allocated = allocations.reduce((sum, value) => sum + value, 0);
    products.push({ productId, available: state.available, unaccountedPaidQuantity: state.paid, budget,
      allocatedQuantity: allocated, unallocatedQuantity: budget === null ? null : budget - allocated, complete: issues.length === 0, issues });
  }
  return { tenantId: input.tenantId, previewOnly: true, writesEnabled: false, complete: globalIssues.length === 0 && products.every(row => row.complete),
    products, buckets: buckets.map(bucket => bucket.result), issues: unique([...globalIssues, ...products.flatMap(row => row.issues)]) };
}
