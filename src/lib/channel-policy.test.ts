import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { applyProductChannelPricing, channelAssumptionKeys, readCatalogChannelPricingDraft, readChannelPolicy,
  readProductChannelPrices, readProductChannelPricing, saveChannelPolicy, type CatalogChannelPricingDraft, type ChannelAssumptions } from "./channel-policy";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const assumptions: ChannelAssumptions = { commission_percent: 10, tax_percent: 5, fixed_fee_per_order: 4, fixed_fee_per_item: 0,
  seller_shipping_per_order: 12, advertising_per_order: 2, other_cost_per_order: 0, target_margin: 20 };
const draft = (): CatalogChannelPricingDraft => ({ channel: "mercado_livre", quantity: 3, assumptions: { ...assumptions }, expected_policy_revision: "policy-revision", quoted_unit_cost: 10, unit_price: 30 });
beforeEach(() => mock.rpc.mockReset());
describe("channel policy API and handoff validation", () => {
  it("keeps absent defaults explicitly unconfigured and unknown, without inventing zeros", async () => {
    const blank = { channel: "direct", configured: false, revision: "missing-policy", assumptions: Object.fromEntries(channelAssumptionKeys.map(key => [key, null])) };
    mock.rpc.mockResolvedValue({ data: blank, error: null });
    expect(await readChannelPolicy("direct")).toEqual(blank);
    expect(mock.rpc).toHaveBeenCalledWith("channel_pricing_policy", { p_channel: "direct" });
    expect(mock.rpc.mock.contexts[0]).toBe(supabase);
  });
  it("saves company defaults only through the explicit versioned policy operation", async () => {
    mock.rpc.mockResolvedValue({ data: "policy-id", error: null });
    expect(await saveChannelPolicy("shopee", assumptions, "revision", "request")).toBe("policy-id");
    expect(mock.rpc).toHaveBeenCalledWith("save_channel_pricing_policy", { p_channel: "shopee", p_assumptions: assumptions, p_expected_revision: "revision", p_request_id: "request" });
    expect(mock.rpc.mock.calls[0][1]).not.toHaveProperty("orderQuantity");
  });
  it("sends production context and order quantity separately and preserves all apply revisions", async () => {
    mock.rpc.mockResolvedValue({ data: "accepted-id", error: null });
    const selection = { productId: "product", channel: "mercado_livre" as const, quantity: 1, overrides: { fixed_fee_per_item: 2 }, unitPrice: 30,
      costContext: { quantity: 100, overrides: { cost_basis: "exclusive_lot" as const }, expectedRevision: "manufacturing-revision" } };
    await readProductChannelPricing(selection);
    expect(mock.rpc.mock.calls[0]).toEqual(["product_channel_pricing_preview", { p_product_id: "product", p_channel: "mercado_livre", p_quantity: 1,
      p_overrides: { fixed_fee_per_item: 2 }, p_unit_price: 30,
      p_cost_context: { quantity: 100, overrides: { cost_basis: "exclusive_lot" }, expected_revision: "manufacturing-revision" } }]);
    await applyProductChannelPricing({ ...selection, expectedCostRevision: "cost", expectedPolicyRevision: "policy", expectedRevision: "preview", requestId: "request" });
    expect(mock.rpc.mock.calls[1][0]).toBe("apply_product_channel_pricing");
    expect(mock.rpc.mock.calls[1][1]).toMatchObject({ p_quantity: 1, p_expected_cost_revision: "cost", p_expected_policy_revision: "policy", p_expected_revision: "preview", p_request_id: "request" });
    expect(mock.rpc.mock.calls.every(([name]) => !/save_product_with_photos|apply_product_pricing$/.test(name))).toBe(true);
  });
  it("reads saved per-channel prices and reports backend failures instead of fabricating a policy", async () => {
    mock.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await readProductChannelPrices("product")).toEqual([]);
    expect(mock.rpc).toHaveBeenLastCalledWith("product_channel_price_catalog", { p_product_id: "product" });
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "Os custos mudaram" } });
    await expect(readChannelPolicy("other")).rejects.toThrow("Os custos mudaram");
    mock.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(readChannelPolicy("other")).rejects.toThrow(/não foram confirmados/);
  });
  it("validates and clones the catalog draft, preserving explicit zero and null assumptions", () => {
    const value = draft();
    expect(readCatalogChannelPricingDraft(value)).toEqual(value);
    expect(readCatalogChannelPricingDraft(value)).not.toBe(value);
    expect(readCatalogChannelPricingDraft({ ...value, unit_price: null, assumptions: { ...value.assumptions, fixed_fee_per_item: null } })).not.toBeNull();
  });
  it("rejects invalid routes, quantities, unknown keys, prices and impossible assumptions", () => {
    const value = draft();
    for (const bad of [null, [], { ...value, channel: "factory" }, { ...value, channel: Object("direct") }, { ...value, quantity: 0 }, { ...value, quantity: 1.5 },
      { ...value, quantity: 10001 }, { ...value, expected_policy_revision: "" }, { ...value, quoted_unit_cost: Infinity },
      { ...value, quoted_unit_cost: -1 }, { ...value, unit_price: 0 }, { ...value, unit_price: 0.001 }, { ...value, unit_price: 1e10 },
      { ...value, arbitrary: 1 }, { ...value, assumptions: { ...assumptions, api_key: "unexpected" } },
      { ...value, assumptions: { ...assumptions, tax_percent: "5" } }, { ...value, assumptions: { ...assumptions, commission_percent: 80 } }])
      expect(readCatalogChannelPricingDraft(bad)).toBeNull();
    const missing = { ...assumptions } as Partial<ChannelAssumptions>; delete missing.fixed_fee_per_item;
    expect(readCatalogChannelPricingDraft({ ...value, assumptions: missing })).toBeNull();
  });
});
