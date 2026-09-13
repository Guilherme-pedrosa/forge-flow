import { describe, expect, it } from "vitest";
import { optionalPlateNumber, sumProductPlateReferences, type ProductPrintPlateValues } from "@/lib/product-print-plate";
const plate = (overrides: Partial<ProductPrintPlateValues> = {}): ProductPrintPlateValues => ({
  units_per_plate: 1, est_grams: null, est_time_seconds: null, est_cost_per_unit: null,
  actual_grams_per_unit: 10, actual_seconds_per_unit: 600, actual_cost_per_unit: 10,
  actual_sample_units: 4, is_active: true, ...overrides,
});
describe("a product requiring several printing plates", () => {
  it("adds base and lid costs instead of averaging the plates", () => {
    expect(sumProductPlateReferences([plate(), plate({ actual_cost_per_unit: 8, actual_seconds_per_unit: 300 })]))
      .toMatchObject({ count: 2, cost: 18, seconds: 900, grams: 20, usesEstimate: false, incomplete: false });
  });
  it("divides estimated print totals by units once; per-unit costs are already normalized", () => {
    expect(sumProductPlateReferences([plate({ actual_sample_units: 0, units_per_plate: 4, est_grams: 100, est_time_seconds: 3600, est_cost_per_unit: 8 })]))
      .toMatchObject({ cost: 8, seconds: 900, grams: 25, usesEstimate: true });
  });
  it("does not divide an accounted per-unit cost by plate capacity again", () => {
    expect(sumProductPlateReferences([plate({ units_per_plate: 8 })]).cost).toBe(10);
  });
  it("does not present partial sums as the complete product cost", () => {
    const sum = sumProductPlateReferences([plate(), plate({ actual_sample_units: 0 })]);
    expect(sum.cost).toBeNull(); expect(sum.seconds).toBeNull(); expect(sum.incomplete).toBe(true);
  });
  it("excludes archived plates and retains valid zero references", () => {
    expect(sumProductPlateReferences([plate({ is_active: false }), plate({ actual_cost_per_unit: 0, actual_seconds_per_unit: 0, actual_grams_per_unit: 0 })]))
      .toMatchObject({ count: 1, cost: 0, seconds: 0, grams: 0 });
  });
  it("validates optional manual estimates without turning missing values into zero", () => {
    expect(optionalPlateNumber("", "Peso")).toBeNull();
    expect(optionalPlateNumber("0", "Peso")).toBe(0);
    expect(optionalPlateNumber("12,5", "Peso")).toBe(12.5);
    expect(() => optionalPlateNumber("-1", "Peso")).toThrow();
    expect(() => optionalPlateNumber("Infinity", "Peso")).toThrow();
  });
  it("retains unknown yield without inventing a one-piece plate or complete unit totals", () => {
    expect(sumProductPlateReferences([plate({ units_per_plate: null, actual_sample_units: 0, est_grams: 100, est_time_seconds: 3600 })]))
      .toMatchObject({ count: 1, unconfirmedUnits: 1, grams: null, seconds: null, cost: null, incomplete: true, printGrams: 100, printSeconds: 3600 });
  });
});
