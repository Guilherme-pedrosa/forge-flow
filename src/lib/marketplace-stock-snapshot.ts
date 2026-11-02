import { z } from "zod";
import { marketplaceRpc } from "./marketplace-orders";
import { previewMarketplaceStock, type ExternalPaidStockOrder, type ForgeFinishedAvailability, type MarketplaceListingStockSnapshot } from "./marketplace-stock-preview";

const id = z.string().min(1).max(200), units = z.number().int().min(0).max(1e9), at = z.string().datetime({ offset: true });
const binding = z.object({ bindingId: id, accountId: id, productId: id, itemId: z.string().max(160), variationId: z.string().max(160), sku: z.string().max(160),
  channel: id, sellerId: id.nullable(), sourceBound: z.boolean(), bridgeId: id.nullable().optional(), connectionState: z.string().optional() });
const snapshotSchema = z.object({ tenantId: id, accountId: id, sellerId: id, bridgeId: id, snapshotAt: at, revision: id,
  products: z.array(z.object({ productId: id, name: z.string(), stockItemId: id.nullable(), stockUnit: z.string().nullable(), available: units.nullable(), stockComplete: z.boolean(),
    basePrice: z.number().finite().nonnegative().nullable(), acceptedMlPrice: z.object({ unitPrice: z.number().finite().min(.01), quantity: units.min(1), acceptanceId: id,
      costRevision: id, policyRevision: id, updatedAt: at, revision: id }).nullable(), priceComplete: z.boolean(),
    unitConversion: z.object({ kind: z.literal("one_finished_unit"), factor: z.literal(1) }).nullable(), missing: z.array(z.string()), revision: id })).max(500),
  finishedAvailability: z.array(z.object({ tenantId: id, productId: id, available: units.nullable(), snapshotAt: at, revision: id })).max(500),
  bindings: z.array(binding), competingBindings: z.array(binding),
  externalPaidOrders: z.array(z.object({ tenantId: id, sellerId: id, accountId: id, channel: id, externalOrderId: id, externalLineId: id, productId: id.nullable(),
    state: z.enum(["paid", "shipped", "delivered", "awaiting_payment", "cancelled", "unknown"]), quantity: units.min(1), quantityAlreadyAccounted: units.nullable(), snapshotAt: at,
    sourceObservedAt: at, externalUpdatedAt: at, needsReview: z.boolean() })),
  localInboxComplete: z.boolean(), requiresRemoteOrderRead: z.literal(true), missing: z.array(z.string()), previewOnly: z.literal(true), writesEnabled: z.literal(false),
});
export type MarketplaceStockSnapshot = z.infer<typeof snapshotSchema>;

/** The caller retains tenant/account scope while the authenticated request is in flight. */
export async function readMarketplaceStockSnapshot(tenantId: string, accountId: string, productIds: string[]): Promise<MarketplaceStockSnapshot> {
  if (!tenantId || !accountId || !productIds.length || productIds.length > 500 || new Set(productIds).size !== productIds.length) throw new Error("Selecione os produtos vinculados desta conta.");
  const raw = await marketplaceRpc("marketplace_stock_preview_snapshot", { p_account_id: accountId, p_product_ids: productIds });
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) throw new Error("O Forge não confirmou o snapshot completo de estoque e preços.");
  const snapshot = parsed.data, expected = [...productIds].sort();
  if (snapshot.tenantId !== tenantId || snapshot.accountId !== accountId || JSON.stringify(snapshot.products.map(row => row.productId).sort()) !== JSON.stringify(expected)
    || snapshot.finishedAvailability.some(row => row.tenantId !== tenantId) || JSON.stringify(snapshot.finishedAvailability.map(row => row.productId).sort()) !== JSON.stringify(expected))
    throw new Error("O snapshot pertence a outra sessão, conta ou conjunto de produtos.");
  return snapshot;
}

/** Missing remote completeness or another unconfirmed stock owner blocks increases.
 * No current/source quantity is fabricated from the Forge product's base sale price. */
export function previewMarketplaceStockSnapshot(snapshot: MarketplaceStockSnapshot, listings: MarketplaceListingStockSnapshot[], options: {
  now: string; maxAgeMs: number; remoteOrdersComplete?: boolean;
}) {
  const bindings = [...snapshot.bindings, ...snapshot.competingBindings];
  for (const listing of listings) {
    if (!bindings.some(binding => binding.accountId === listing.accountId && binding.productId === listing.productId && binding.itemId === listing.itemId && binding.variationId === listing.variationId))
      throw new Error("O anúncio não corresponde aos vínculos confirmados do snapshot.");
  }
  const coverage = bindings.every(binding => !!binding.itemId && listings.some(listing => listing.accountId === binding.accountId && listing.productId === binding.productId && listing.itemId === binding.itemId && listing.variationId === binding.variationId));
  const owned = snapshot.competingBindings.every(binding => binding.sourceBound && binding.bridgeId === snapshot.bridgeId);
  const ordersComplete = options.remoteOrdersComplete === true && snapshot.localInboxComplete && coverage && owned;
  // Map the validated fields explicitly: Zod's inferred object keys become optional
  // when this application's strictNullChecks setting is disabled.
  const finishedAvailability: ForgeFinishedAvailability[] = snapshot.finishedAvailability.map(row => ({
    tenantId: row.tenantId, productId: row.productId, available: row.available, snapshotAt: row.snapshotAt, revision: row.revision,
  }));
  const externalPaidOrders: ExternalPaidStockOrder[] = snapshot.externalPaidOrders.map(row => ({
    tenantId: row.tenantId, sellerId: row.sellerId, channel: row.channel, externalOrderId: row.externalOrderId,
    externalLineId: row.externalLineId, productId: row.productId, state: row.state, quantity: row.quantity,
    quantityAlreadyAccounted: row.quantityAlreadyAccounted, snapshotAt: row.snapshotAt,
  }));
  const result = previewMarketplaceStock({ tenantId: snapshot.tenantId, now: options.now, maxAgeMs: options.maxAgeMs, ordersComplete,
    finishedAvailability, externalPaidOrders, listings });
  if (!coverage || !owned) result.issues = [...new Set([...result.issues, ...(!coverage ? ["competing_listing_snapshot_missing"] : []), ...(!owned ? ["competing_stock_owner_unconfirmed"] : [])])];
  return result;
}
