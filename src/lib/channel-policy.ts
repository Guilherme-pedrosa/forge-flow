import { supabase } from "@/integrations/supabase/client";
import type { priceChannel } from "./channel-pricing";
import type { PricingPlan } from "./product-pricing";

export type ChannelKey = "direct" | "mercado_livre" | "shopee" | "tiktok" | "other";
export const channelAssumptionKeys = ["commission_percent", "tax_percent", "fixed_fee_per_order", "fixed_fee_per_item",
  "seller_shipping_per_order", "advertising_per_order", "other_cost_per_order", "target_margin"] as const;
export type ChannelAssumptions = Record<typeof channelAssumptionKeys[number], number | null>;
export type ChannelPolicy = { channel: ChannelKey; configured: boolean; revision: string; assumptions: ChannelAssumptions };
export type CatalogChannelPricingDraft = { channel: ChannelKey; quantity: number; assumptions: ChannelAssumptions;
  expected_policy_revision: string; quoted_unit_cost: number; unit_price: number | null };
export type ProductChannelPricingPreview = {
  product_id: string; channel: ChannelKey; quantity: number; complete: boolean; missing: string[];
  assumptions: ChannelAssumptions; policy: ChannelPolicy; cost_source: "manual" | "composition" | "simulation"; unit_cost: number | null;
  cost_revision: string; policy_revision: string; revision: string; result: ReturnType<typeof priceChannel> | null;
  cost_snapshot: Record<string, unknown>;
};
export type ProductChannelPricingSelection = { productId: string; channel: ChannelKey; quantity: number;
  overrides?: Partial<ChannelAssumptions>; unitPrice?: number | null;
  costContext?: { quantity: number; overrides: PricingPlan; expectedRevision?: string } };
export type ProductChannelPricingAcceptance = ProductChannelPricingSelection & { expectedCostRevision: string;
  expectedPolicyRevision: string; expectedRevision: string; requestId: string };
export type ProductChannelPrice = { channel: ChannelKey; acceptance_id: string; unit_price: number; unit_cost: number;
  quantity: number; assumptions: ChannelAssumptions; cost_revision: string; policy_revision: string; updated_at: string };
export function readCatalogChannelPricingDraft(value: unknown): CatalogChannelPricingDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = ["channel", "quantity", "assumptions", "expected_policy_revision", "quoted_unit_cost", "unit_price"];
  if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !(key in row))
    || typeof row.channel !== "string" || !["direct", "mercado_livre", "shopee", "tiktok", "other"].includes(row.channel)
    || typeof row.quantity !== "number" || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 10000
    || typeof row.expected_policy_revision !== "string" || !row.expected_policy_revision.trim() || row.expected_policy_revision.length > 200
    || typeof row.quoted_unit_cost !== "number" || !Number.isFinite(row.quoted_unit_cost) || row.quoted_unit_cost < 0 || row.quoted_unit_cost > 1e9
    || row.unit_price !== null && (typeof row.unit_price !== "number" || !Number.isFinite(row.unit_price) || row.unit_price < .01 || row.unit_price > 1e9 || row.unit_price !== Math.round(row.unit_price * 100) / 100)
    || !row.assumptions || typeof row.assumptions !== "object" || Array.isArray(row.assumptions)) return null;
  const assumptions = row.assumptions as Record<string, unknown>;
  if (Object.keys(assumptions).some(key => !(channelAssumptionKeys as readonly string[]).includes(key))
    || channelAssumptionKeys.some(key => !(key in assumptions) || assumptions[key] !== null && (typeof assumptions[key] !== "number"
      || !Number.isFinite(assumptions[key]) || assumptions[key] < 0 || assumptions[key] > 1e9
      || ["commission_percent", "tax_percent", "target_margin"].includes(key) && assumptions[key] >= 100))) return null;
  if (Number(assumptions.commission_percent ?? 0) + Number(assumptions.tax_percent ?? 0) + Number(assumptions.target_margin ?? 0) >= 100) return null;
  return structuredClone(row) as CatalogChannelPricingDraft;
}
async function channelRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const call = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { message: string } | null }>;
  const result = await call(name, args);
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error("Os dados do canal não foram confirmados. Atualize a simulação e tente novamente.");
  return result.data;
}
export const readChannelPolicy = (channel: ChannelKey) => channelRpc<ChannelPolicy>("channel_pricing_policy", { p_channel: channel });
export const saveChannelPolicy = (channel: ChannelKey, assumptions: ChannelAssumptions, revision: string, requestId: string) =>
  channelRpc<string>("save_channel_pricing_policy", { p_channel: channel, p_assumptions: assumptions, p_expected_revision: revision, p_request_id: requestId });
export const readProductChannelPrices = (productId: string) => channelRpc<ProductChannelPrice[]>("product_channel_price_catalog", { p_product_id: productId });
const costContextPayload = (context: ProductChannelPricingSelection["costContext"]) => context
  ? { quantity: context.quantity, overrides: context.overrides, expected_revision: context.expectedRevision ?? null } : null;
export const readProductChannelPricing = ({ productId, channel, quantity, overrides = {}, unitPrice = null, costContext }: ProductChannelPricingSelection) =>
  channelRpc<ProductChannelPricingPreview>("product_channel_pricing_preview", { p_product_id: productId, p_channel: channel,
    p_quantity: quantity, p_overrides: overrides, p_unit_price: unitPrice, p_cost_context: costContextPayload(costContext) });
export const applyProductChannelPricing = ({ productId, channel, quantity, overrides = {}, unitPrice = null,
  expectedCostRevision, expectedPolicyRevision, expectedRevision, requestId, costContext }: ProductChannelPricingAcceptance) =>
  channelRpc<string>("apply_product_channel_pricing", { p_product_id: productId, p_channel: channel, p_quantity: quantity,
    p_overrides: overrides, p_expected_cost_revision: expectedCostRevision, p_expected_policy_revision: expectedPolicyRevision,
    p_expected_revision: expectedRevision, p_request_id: requestId, p_unit_price: unitPrice, p_cost_context: costContextPayload(costContext) });
