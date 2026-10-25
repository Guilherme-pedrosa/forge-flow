import { describe, expect, it, vi } from "vitest";
import { emptyPricingPolicyDraft, pricingPolicyDraft, pricingPolicyNumber, pricingPolicyPayload, type PricingPolicy } from "./pricing-policy";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
describe("pricing policy inputs", () => {
  it("keeps an unknown rate distinct from an explicit zero", () => {
    expect(pricingPolicyNumber("", "tarifa")).toBeNull();
    expect(pricingPolicyNumber("0", "tarifa")).toBe(0);
    expect(pricingPolicyNumber("2,75", "tarifa")).toBe(2.75);
    expect(pricingPolicyNumber("2.75", "tarifa")).toBe(2.75);
  });
  it.each(["-1", "NaN", "Infinity", "2,5,1", "1e2"])("rejects invalid configuration %s", value => expect(() => pricingPolicyNumber(value, "tarifa")).toThrow());
  it("validates margin as a share of revenue", () => {
    expect(pricingPolicyNumber("99,9", "margem", true)).toBe(99.9);
    expect(() => pricingPolicyNumber("100", "margem", true)).toThrow(/menos de 100/);
  });
  it("clears an exception with blank input and preserves a zero-rate printer", () => {
    const draft = emptyPricingPolicyDraft(); draft.values.machine_hour_cost = "3,5"; draft.printerHours = { printerA: "", printerB: "0", printerC: "4,5" };
    const payload = pricingPolicyPayload(draft);
    expect(payload.machine_hour_cost).toBe(3.5); expect(payload.energy_cost_kwh).toBeNull();
    expect(payload.printer_hour_costs).toEqual([{ printer_id: "printerB", hour_cost: 0 }, { printer_id: "printerC", hour_cost: 4.5 }]);
  });
  it("roundtrips loaded rates without inventing missing or legacy values", () => {
    const value = { ...pricingPolicyPayload(emptyPricingPolicyDraft()), revision: "revision", machine_rate_scope: "commercial_excludes_energy", energy_cost_kwh: 1.15, finishing_minutes_per_piece: 0, printer_hour_costs: [{ printer_id: "printerA", hour_cost: 2.5 }] } as PricingPolicy;
    const draft = pricingPolicyDraft(value);
    expect(draft.values.energy_cost_kwh).toBe("1,15"); expect(draft.values.labor_cost_hour).toBe(""); expect(draft.values.finishing_minutes_per_piece).toBe("0");
    const { revision: _r, machine_rate_scope: _s, ...payload } = value;
    expect(pricingPolicyPayload(draft)).toEqual(payload);
  });
});
