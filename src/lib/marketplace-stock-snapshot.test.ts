import { beforeEach, describe, expect, it, vi } from "vitest";
import { readMarketplaceStockSnapshot, previewMarketplaceStockSnapshot, type MarketplaceStockSnapshot } from "./marketplace-stock-snapshot";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./marketplace-orders", () => ({ marketplaceRpc: mock.rpc }));
const at = "2026-11-02T18:00:00Z";
function snapshot(): MarketplaceStockSnapshot { return { tenantId: "tenant", accountId: "account", sellerId: "381", bridgeId: "bridge", snapshotAt: at, revision: "r1", products: [{ productId: "product", name: "Caneca", stockItemId: "stock", stockUnit: "un", available: 10, stockComplete: true, basePrice: 25,
  acceptedMlPrice: { unitPrice: 33.33, quantity: 1, acceptanceId: "acceptance", costRevision: "cost", policyRevision: "policy", updatedAt: at, revision: "price" }, priceComplete: true, unitConversion: { kind: "one_finished_unit", factor: 1 }, missing: [], revision: "product-r" }],
  finishedAvailability: [{ tenantId: "tenant", productId: "product", available: 10, snapshotAt: at, revision: "stock-r" }],
  bindings: [{ bindingId: "binding", accountId: "account", productId: "product", itemId: "MLB1", variationId: "", sku: "CAN", channel: "mercado_livre", sellerId: "381", sourceBound: true }], competingBindings: [], externalPaidOrders: [],
  localInboxComplete: true, requiresRemoteOrderRead: true, missing: [], previewOnly: true, writesEnabled: false }; }
const listing = { tenantId: "tenant", accountId: "account", sellerId: "381", productId: "product", itemId: "MLB1", variationId: "", userProductId: null, currentQuantity: 2, state: "active" as const, snapshotAt: at,
  warehouse: { state: "not_applicable" as const, id: null, version: null, externalLogisticsStock: false } };
beforeEach(() => mock.rpc.mockReset());
describe("coherent Forge marketplace stock snapshot", () => {
  it("reads only the scoped snapshot RPC and keeps accepted ML price separate from base price", async () => {
    mock.rpc.mockResolvedValue(snapshot()); const result = await readMarketplaceStockSnapshot("tenant", "account", ["product"]);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("marketplace_stock_preview_snapshot", { p_account_id: "account", p_product_ids: ["product"] });
    expect(result.products[0]).toMatchObject({ basePrice: 25, acceptedMlPrice: { unitPrice: 33.33 } });
  });
  it("rejects a late/malformed response from another tenant, account or product selection", async () => {
    for (const changes of [{ tenantId: "foreign" }, { accountId: "other-account" }, { products: [] }, { finishedAvailability: [] }, { writesEnabled: true }]) {
      mock.rpc.mockResolvedValue({ ...snapshot(), ...changes }); await expect(readMarketplaceStockSnapshot("tenant", "account", ["product"])).rejects.toThrow(/snapshot/i);
    }
  });
  it("does not equate a complete local inbox with fresh remote order/listing evidence", () => {
    expect(previewMarketplaceStockSnapshot(snapshot(), [listing], { now: at, maxAgeMs: 300000 }).buckets[0]).toMatchObject({ safeToIncrease: false, proposedQuantity: 2 });
    expect(previewMarketplaceStockSnapshot(snapshot(), [listing], { now: at, maxAgeMs: 300000, remoteOrdersComplete: true }).buckets[0]).toMatchObject({ safeToIncrease: true, proposedQuantity: 10 });
  });
  it("blocks increases until every competing listing/owner is confirmed and rejects an unbound listing", () => {
    const source = snapshot(); source.competingBindings.push({ ...source.bindings[0], bindingId: "other", accountId: "other-account", itemId: "MLB2", sourceBound: false });
    const result = previewMarketplaceStockSnapshot(source, [listing], { now: at, maxAgeMs: 300000, remoteOrdersComplete: true });
    expect(result.buckets[0].safeToIncrease).toBe(false); expect(result.issues).toContain("competing_stock_owner_unconfirmed"); expect(result.issues).toContain("competing_listing_snapshot_missing");
    expect(() => previewMarketplaceStockSnapshot(snapshot(), [{ ...listing, itemId: "UNBOUND" }], { now: at, maxAgeMs: 300000 })).toThrow(/vínculos/);
  });
});
