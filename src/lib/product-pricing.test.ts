import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyProductPricing, previewProductPricing, pricingNumber, pricingProductionRows, readProductPricingPreview, saveProductPricingPlan, type ProductPricingPreview } from "./product-pricing";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const costs = { material: 8, energy: 1, machine: 2, handling: 1, finishing: 1, assembly: 2, extras: 3, overhead: 2, total_lot: 20, unit_cost: 10 };
const fixture = (): ProductPricingPreview => ({
  product_id: "product", product_name: "Kit", quantity: 2, complete: true, missing: [], revision: "quote-1", plan_revision: "plan-1", plan: {}, cost_basis: "unit",
  components: [], plates: [], runs: [], breakdown: { ...costs }, production_breakdown: { ...costs, total_lot: 30, unit_cost: 15 },
  margin_percent: 50, suggested_unit_price: 20, manual_cost_reference: 12,
});
beforeEach(() => mock.rpc.mockReset());

describe("saved-product pricing contract", () => {
  it("keeps the selected breakdown in lot units and the production estimate separate", () => {
    const result = readProductPricingPreview(fixture());
    expect(result.breakdown.total_lot).toBe(20);
    expect(result.breakdown.unit_cost).toBe(10);
    expect(result.production_breakdown.total_lot).toBe(30);
  });
  it("never replaces missing amounts with zero or accepts a final price with pending costs", () => {
    const pending = { ...fixture(), complete: false, missing: ["Tarifa pendente"], breakdown: { ...costs, total_lot: null, unit_cost: null }, suggested_unit_price: null };
    expect(readProductPricingPreview(pending).breakdown.unit_cost).toBeNull();
    expect(() => readProductPricingPreview({ ...pending, suggested_unit_price: 0 })).toThrow(/pendências/);
    expect(() => readProductPricingPreview({ ...fixture(), breakdown: { ...costs, total_lot: null } })).toThrow(/todos os custos/);
    expect(() => readProductPricingPreview({ ...fixture(), breakdown: { ...costs, energy: true } })).toThrow(/custos retornados/);
  });
  it("flattens nested production for display without averaging tariffs or duplicating costs", () => {
    const parent = fixture(); const child = fixture();
    child.runs = [{ plate_id: "child-plate", label: "Folhas", required_runs: .2, full_runs: 1, surplus_units: 8 }];
    parent.components = [{ component_product_id: "child", required_quantity: 2, pricing: child }];
    const rows = pricingProductionRows(parent);
    expect(rows.runs[0].full_runs).toBe(1);
    expect(parent.breakdown).toEqual(costs);
  });
  it("preserves an explicitly confirmed zero and accepts Brazilian decimal input", () => {
    expect(pricingNumber("", "Custo")).toBeNull();
    expect(pricingNumber("0", "Custo")).toBe(0);
    expect(pricingNumber("1.234,50", "Custo")).toBe(1234.5);
    for (const raw of ["true", "-1", "1e3", "1,2,3", "NaN"]) expect(() => pricingNumber(raw, "Custo")).toThrow();
  });
  it("binds the Supabase RPC receiver and submits only explicit preview/apply parameters", async () => {
    mock.rpc.mockImplementation(function (name: string) {
      return Promise.resolve({ data: name === "product_pricing_preview" ? fixture() : "acceptance-id", error: null });
    });
    await previewProductPricing("product", 2, { cost_basis: "unit" });
    await saveProductPricingPlan("product", { handling_minutes_per_plate: 3, consumables: [{ item_id: "box", quantity: 1 }] }, "plan-1", "request-plan");
    await applyProductPricing("product", 2, { cost_basis: "unit" }, "quote-1", 20, "request-apply");
    expect(mock.rpc.mock.contexts.every(context => (context as { rpc?: unknown } | undefined)?.rpc === mock.rpc)).toBe(true);
    expect(mock.rpc).toHaveBeenLastCalledWith("apply_product_pricing", { p_product_id: "product", p_quantity: 2, p_overrides: { cost_basis: "unit" }, p_expected_revision: "quote-1", p_unit_price: 20, p_request_id: "request-apply" });
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual(["product_pricing_preview", "save_product_pricing_plan", "apply_product_pricing"]);
  });
  it.each([null, undefined, "", "  ", 0, {}])("rejects missing or invalid write confirmations (%j) for both pricing operations", async data => {
    mock.rpc.mockResolvedValue({ data, error: null });
    await expect(saveProductPricingPlan("product", {}, "plan-1", "request-plan")).rejects.toThrow(/não foi confirmado/);
    await expect(applyProductPricing("product", 2, {}, "preview-1", 20, "request-apply")).rejects.toThrow(/não foi confirmado/);
  });
});
