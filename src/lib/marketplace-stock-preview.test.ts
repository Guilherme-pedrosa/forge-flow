import { describe, expect, it, vi } from "vitest";
import { marketplaceStockBucketKey, previewMarketplaceStock, type ExternalPaidStockOrder, type MarketplaceListingStockSnapshot, type MarketplaceStockPreviewInput } from "./marketplace-stock-preview";

const now = "2026-11-02T18:00:00Z", recent = "2026-11-02T17:59:00Z";
const listing = (itemId: string, changes: Partial<MarketplaceListingStockSnapshot> = {}): MarketplaceListingStockSnapshot => ({ tenantId: "tenant", accountId: "account", sellerId: "seller", productId: "product", itemId, variationId: "", userProductId: null,
  currentQuantity: 2, state: "active", snapshotAt: recent, warehouse: { state: "not_applicable", id: null, version: null, externalLogisticsStock: false }, ...changes });
const order = (externalOrderId: string, changes: Partial<ExternalPaidStockOrder> = {}): ExternalPaidStockOrder => ({ tenantId: "tenant", sellerId: "seller", productId: "product", externalOrderId, externalLineId: "line", state: "paid", quantity: 2, quantityAlreadyAccounted: 0, snapshotAt: recent, ...changes });
const input = (changes: Partial<MarketplaceStockPreviewInput> = {}): MarketplaceStockPreviewInput => ({ tenantId: "tenant", now, maxAgeMs: 300000, ordersComplete: true,
  finishedAvailability: [{ tenantId: "tenant", productId: "product", available: 10, snapshotAt: recent, revision: "ledger-net-1" }], externalPaidOrders: [], listings: [listing("A")], ...changes });

describe("read-only company finished stock budget", () => {
  it("uses Forge available stock once and subtracts only uncovered paid quantities, including partial coverage", () => {
    const data = input({ externalPaidOrders: [order("already-stock-posted", { quantity: 5, quantityAlreadyAccounted: 5 }), order("not-imported", { quantity: 3 }),
      order("partly-allocated", { quantity: 4, quantityAlreadyAccounted: 2 }), order("waiting", { state: "awaiting_payment", quantity: 20 }), order("cancelled", { state: "cancelled", quantity: 10 })] });
    expect(previewMarketplaceStock(data).products[0]).toMatchObject({ available: 10, unaccountedPaidQuantity: 5, budget: 5, allocatedQuantity: 5, complete: true });
  });
  it("shares one product budget across listings and seller accounts deterministically instead of copying the whole stock to each", () => {
    const result = previewMarketplaceStock(input({ listings: [listing("C", { accountId: "account-2", sellerId: "seller-2" }), listing("B"), listing("A")] }));
    expect(result.buckets.map(bucket => bucket.allocatedQuantity).sort()).toEqual([3, 3, 4]);
    expect(result.buckets.reduce((sum, bucket) => sum + bucket.allocatedQuantity, 0)).toBe(10);
    expect(previewMarketplaceStock(input({ listings: [listing("A"), listing("B"), listing("C", { accountId: "account-2", sellerId: "seller-2" })] }))).toEqual(result);
  });
  it("counts shared user_product stock once across item/account aliases, without adding duplicate available quantities", () => {
    const warehouse = { state: "single" as const, id: "warehouse-1", version: "version-7", externalLogisticsStock: false };
    const sharedA = listing("A", { userProductId: "UP-1", currentQuantity: 7, warehouse }), sharedB = listing("B", { userProductId: "UP-1", accountId: "alias-account", currentQuantity: 7, warehouse });
    expect(marketplaceStockBucketKey(sharedA)).toBe(marketplaceStockBucketKey(sharedB));
    const result = previewMarketplaceStock(input({ listings: [sharedA, sharedB, listing("C", { currentQuantity: 3 })] }));
    expect(result.buckets).toHaveLength(2); expect(result.buckets.reduce((sum, bucket) => sum + bucket.currentQuantity!, 0)).toBe(10);
    expect(result.buckets.find(bucket => bucket.userProductId)?.accountIds).toEqual(["account", "alias-account"]);
    expect(result.products[0].allocatedQuantity).toBe(10);
  });
  it("deduplicates the same external seller/order/line and preserves a separate seller's real demand", () => {
    const paid = order("O");
    const reordered = Object.fromEntries(Object.entries(paid).reverse()) as ExternalPaidStockOrder;
    const result = previewMarketplaceStock(input({ externalPaidOrders: [paid, reordered, order("O", { sellerId: "other-seller" }), order("O", { channel: "shopee" })] }));
    expect(result.products[0].unaccountedPaidQuantity).toBe(6); expect(result.products[0].budget).toBe(4);
  });
  it("blocks increases for unknown coverage or a paid order not bound to a Forge product", () => {
    const unknown = previewMarketplaceStock(input({ externalPaidOrders: [order("unknown", { quantityAlreadyAccounted: null })] }));
    expect(unknown.products[0]).toMatchObject({ budget: 8, complete: false }); expect(unknown.buckets[0]).toMatchObject({ safeToIncrease: false, proposedQuantity: 2 });
    expect(unknown.issues).toContain("external_order_stock_coverage_unknown");
    const unbound = previewMarketplaceStock(input({ externalPaidOrders: [order("unbound", { productId: null })] }));
    expect(unbound.buckets[0].safeToIncrease).toBe(false); expect(unbound.issues).toContain("paid_external_order_unbound");
  });
  it("never treats stale or conflicting snapshots as authority for a stock increase", () => {
    for (const data of [input({ ordersComplete: false }), input({ listings: [listing("A", { snapshotAt: "2026-11-01T00:00:00Z" })] }),
      input({ finishedAvailability: [{ tenantId: "tenant", productId: "product", available: 10, snapshotAt: "2026-11-02T18:01:00Z", revision: "future" }] }),
      input({ externalPaidOrders: [order("same"), order("same", { quantity: 3 })] })]) {
      const result = previewMarketplaceStock(data); expect(result.complete).toBe(false); expect(result.buckets.every(bucket => !bucket.safeToIncrease)).toBe(true);
      expect(result.buckets[0].proposedQuantity).toBeLessThanOrEqual(2);
    }
  });
  it.each(["unknown", "multiple"] as const)("requires a confirmed single/versioned warehouse before proposing %s-warehouse stock", state => {
    const result = previewMarketplaceStock(input({ listings: [listing("A", { userProductId: "UP", warehouse: { state, id: null, version: null, externalLogisticsStock: false } })] }));
    expect(result.complete).toBe(false); expect(result.buckets[0]).toMatchObject({ proposedQuantity: null, safeToIncrease: false, requiresReview: true });
  });
  it("rejects shared-resource disagreement, multiple warehouse identities, missing versions and mixed logistics stock", () => {
    const warehouse = { state: "single" as const, id: "W1", version: "v1", externalLogisticsStock: false };
    for (const listings of [[listing("A", { userProductId: "UP", warehouse }), listing("B", { userProductId: "UP", warehouse, currentQuantity: 4 })],
      [listing("A", { userProductId: "UP", warehouse }), listing("B", { userProductId: "UP", warehouse: { ...warehouse, id: "W2" } })],
      [listing("A", { userProductId: "UP", warehouse: { ...warehouse, version: null } })], [listing("A", { warehouse: { ...warehouse, externalLogisticsStock: true } })]]) {
      const result = previewMarketplaceStock(input({ listings })); expect(result.complete).toBe(false); expect(result.buckets.every(bucket => !bucket.safeToIncrease)).toBe(true);
    }
  });
  it("preserves manual/moderation pauses and does not turn an out-of-stock preview into an activation request", () => {
    const result = previewMarketplaceStock(input({ listings: [listing("manual", { state: "paused_manual" }), listing("moderation", { state: "paused_moderation" }), listing("empty", { state: "paused_no_stock", currentQuantity: 0 })] }));
    for (const bucket of result.buckets.filter(bucket => bucket.itemIds[0] !== "empty")) {
      expect(bucket).toMatchObject({ proposedQuantity: null, allocatedQuantity: 0, safeToIncrease: false, preserveStatus: true });
      expect(bucket.issues).toContain("manual_or_moderation_pause_preserved");
    }
    expect(result.buckets.find(bucket => bucket.itemIds[0] === "empty")).toMatchObject({ allocatedQuantity: 10, preserveStatus: true });
    expect(result.buckets.every(bucket => !("newStatus" in bucket) && !("resume" in bucket))).toBe(true);
  });
  it("requires mapping/availability coherence for a shared stock resource and isolates every company's input", () => {
    const warehouse = { state: "single" as const, id: "W", version: "v1", externalLogisticsStock: false };
    const conflict = previewMarketplaceStock(input({ listings: [listing("A", { userProductId: "UP", warehouse }), listing("B", { userProductId: "UP", productId: "other-product", warehouse })] }));
    expect(conflict.complete).toBe(false); expect(conflict.buckets[0].proposedQuantity).toBeNull(); expect(conflict.issues).toContain("shared_stock_product_conflict");
    for (const data of [input({ listings: [listing("A", { tenantId: "foreign" })] }), input({ externalPaidOrders: [order("O", { tenantId: "foreign" })] }), input({ finishedAvailability: [{ tenantId: "foreign", productId: "product", available: 10, snapshotAt: recent, revision: "r" }] })])
      expect(() => previewMarketplaceStock(data)).toThrow(/outra empresa/);
  });
  it("keeps oversold budget at zero and validates impossible quantities instead of manufacturing stock", () => {
    const result = previewMarketplaceStock(input({ externalPaidOrders: [order("larger", { quantity: 20 })] }));
    expect(result.products[0]).toMatchObject({ budget: 0, allocatedQuantity: 0 }); expect(result.buckets[0].proposedQuantity).toBe(0);
    expect(() => previewMarketplaceStock(input({ externalPaidOrders: [order("bad", { quantityAlreadyAccounted: 3 })] }))).toThrow(/cobertura/);
    expect(() => previewMarketplaceStock(input({ listings: [listing("A", { currentQuantity: -1 })] }))).toThrow(/Quantidade/);
    expect(previewMarketplaceStock(input({ ordersComplete: false, finishedAvailability: [], listings: [] })).complete).toBe(false);
  });
  it("is deterministic and has no network, mutable input or write side effects", () => {
    const fetch = vi.fn(() => { throw new Error("No network"); }); vi.stubGlobal("fetch", fetch);
    const data = input(), before = structuredClone(data), first = previewMarketplaceStock(data);
    expect(previewMarketplaceStock(data)).toEqual(first); expect(data).toEqual(before); expect(fetch).not.toHaveBeenCalled();
    expect(first).toMatchObject({ previewOnly: true, writesEnabled: false }); vi.unstubAllGlobals();
  });
});
