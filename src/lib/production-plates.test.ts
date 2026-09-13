import { describe, expect, it } from "vitest";
import { productionPlatePlan, type ProductionPlate } from "./production-plates";

const base = { id: "base", product_id: "sku", source_id: "file", plate_index: 1, label: "Base", units_per_plate: 2, material_id: "PLA", printer_id: "P1S", est_grams: 200, est_time_seconds: 3600, est_cost_per_unit: 10, is_active: true } satisfies ProductionPlate;
const lid = { ...base, id: "lid", plate_index: 2, label: "Tampa", units_per_plate: 1, material_id: "PETG", printer_id: "A1", est_grams: 60, est_time_seconds: 1800, est_cost_per_unit: 4 };

describe("planejamento das placas de um SKU", () => {
  it("três conjuntos planejam duas execuções de bases e três de tampas", () => {
    const plan = productionPlatePlan([base, lid], 3);
    expect(plan.map(plate => plate.runs)).toEqual([2, 3]);
    expect(plan.reduce((sum, plate) => sum + plate.totalGrams!, 0)).toBe(580);
    expect(plan.reduce((sum, plate) => sum + plate.totalCost!, 0)).toBe(52);
    expect(plan.map(plate => plate.material_id)).toEqual(["PLA", "PETG"]);
    expect(plan.map(plate => plate.printer_id)).toEqual(["P1S", "A1"]);
  });
  it("não transforma uma placa sem custo em custo zero", () => {
    expect(productionPlatePlan([{ ...base, est_cost_per_unit: null }], 1)[0].totalCost).toBeNull();
  });
  it("não fabrica placas arquivadas", () => expect(productionPlatePlan([{ ...base, is_active: false }, lid], 2)).toHaveLength(1));
  it.each([0, -1, 1.5, Infinity])("rejeita quantidade inválida %s", qty => expect(() => productionPlatePlan([base, lid], qty)).toThrow());
});
