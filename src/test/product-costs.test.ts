import { describe, expect, it } from "vitest";
import { calculateProductCost, suggestedProductPrice, type ProductCostInput } from "@/lib/product-costs";

const input = (overrides: Partial<ProductCostInput> = {}): ProductCostInput => ({
  grams: 200, printHours: 4, postMinutes: 30, printsPerPlate: 4,
  material: { avg_cost: 100, unit: "kg", loss_coefficient: 0 },
  printer: { name: "Máquina A", power_watts: 200, depreciation_per_hour: 1, maintenance_cost_per_hour: 0.5, acquisition_cost: 10000, useful_life_hours: 1000 },
  settings: { energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 10, target_margin: 40 },
  extras: [{ cost: 2 }], ...overrides,
});

describe("product cost per plate and unit", () => {
  it("converts kilograms and divides plate costs once, keeping extras per unit", () => {
    const result = calculateProductCost(input());
    expect(result.materialCost).toBe(5);
    expect(result.energyCost).toBeCloseTo(0.2);
    expect(result.machineCost).toBe(1.5);
    expect(result.laborCost).toBe(2.5);
    expect(result.overhead).toBeCloseTo(0.92);
    expect(result.totalPlate).toBeCloseTo(40.48);
    expect(result.total).toBeCloseTo(12.12);
    expect(result.suggestedPrice).toBeCloseTo(20.2);
  });
  it("uses average acquisition cost without inventing a second freight surcharge", () => {
    const result = calculateProductCost(input({ material: { avg_cost: 0.1, unit: "g", loss_coefficient: 0 } }));
    expect(result.materialCost).toBe(5);
  });
  it("preserves an explicit zero loss, margin, energy rate and machine rate", () => {
    const result = calculateProductCost(input({
      printer: { name: "Máquina B", power_watts: 0, depreciation_per_hour: 0, maintenance_cost_per_hour: 0, acquisition_cost: 10000, useful_life_hours: 1000 },
      settings: { energy_cost_kwh: 0, labor_cost_hour: 0, overhead_percent: 0, target_margin: 0 }, extras: [],
    }));
    expect(result.materialCost).toBe(5);
    expect(result.machineCost).toBe(0);
    expect(result.energyCost).toBe(0);
    expect(result.suggestedPrice).toBe(5);
  });
  it("requires an explicit printer when calculating machine time", () => {
    expect(() => calculateProductCost(input({ printer: undefined }))).toThrow("Selecione a impressora");
  });
  it("refuses to treat units or liters as grams", () => {
    expect(() => calculateProductCost(input({ material: { avg_cost: 15, unit: "un", loss_coefficient: 0 } }))).toThrow("gramas");
  });
  it.each([0, -1, 1.5, "abc"])("rejects invalid pieces per plate: %s", count => {
    expect(() => calculateProductCost(input({ printsPerPlate: count }))).toThrow("Peças por placa");
  });
  it.each([100, 150, -10, NaN])("rejects impossible target margin: %s", margin => {
    expect(() => suggestedProductPrice(10, margin)).toThrow("margem desejada");
  });
  it("rejects negative material and extras costs", () => {
    expect(() => calculateProductCost(input({ grams: -1 }))).toThrow("Peso");
    expect(() => calculateProductCost(input({ extras: [{ cost: -2 }] }))).toThrow("extras");
  });
});
