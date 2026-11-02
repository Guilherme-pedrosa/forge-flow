import { describe, expect, it } from "vitest";
import type { ImportedComponent, ImportedComposition } from "./imported-composition";
import { modelPricingFromComposition, modelPricingFromMakerWorld, printerMachineHourCost, printerMatchesSliceModels, recommendFilamentsForEstimate, recommendPrinterForEstimate } from "./model-pricing";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";

function plate(index: number, grams = 20, seconds = 1800): ImportedComponent {
  return {
    index, label: `Placa ${index}`, photo_url: null, units_per_plate: 99,
    weight_grams: grams, time_seconds: seconds,
    parts: [{ source_key: "body", name: "Corpo", photo_url: null, quantity_per_plate: 20, quantity_per_product: 2, name_source: "file" }],
    slicer_estimates: {
      source: "3mf_slice_info", slicer_version: "02.08.02.61", printer_model_id: "Bambu Lab A1", nozzle_diameters: "0.4",
      filaments: [{ id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: grams, length_meters: null }],
    },
  };
}
function composition(...plates: ImportedComponent[]): ImportedComposition {
  return { profile_id: "local", enabled: true, plates };
}

describe("native model pricing estimates", () => {
  it("adds whole-plate times and material consumption without inferring finished quantity", () => {
    const result = modelPricingFromComposition(composition(plate(1), plate(2, 30, 5400)));
    expect(result).toMatchObject({ hours: 2, timeSeconds: 7200, weightGrams: 50, plateCount: 2, partCount: 40, printerModelIds: ["Bambu Lab A1"], nozzleDiameters: ["0.4"] });
    expect(result.materials).toEqual([{ key: JSON.stringify([1, "PLA", "#FF0000"]), slotId: 1, materialCode: "PLA", colorHex: "#FF0000", grams: 50, plateIndices: [1, 2], name: "PLA · slot 1 · #FF0000" }]);
    expect(result).not.toHaveProperty("quantity");
  });

  it("preserves an unknown physical part count without changing complete native time and weight", () => {
    const unknown = plate(2); unknown.parts[0].quantity_per_plate = null;
    expect(modelPricingFromComposition(composition(plate(1), unknown))).toMatchObject({ partCount: null, hours: 1, weightGrams: 40 });
  });

  it("preserves separate slots and material/color changes across plates", () => {
    const first = plate(1), second = plate(2);
    first.slicer_estimates!.filaments = [
      { id: 1, material_code: "pla", color_hex: "#ff0000", weight_grams: 12, length_meters: null },
      { id: 2, material_code: "PLA", color_hex: "#FF0000", weight_grams: 8, length_meters: null },
    ];
    second.slicer_estimates!.filaments[0].color_hex = "#00FF00";
    expect(modelPricingFromComposition(composition(first, second)).materials.map(m => [m.slotId, m.colorHex, m.grams])).toEqual([
      [1, "#FF0000", 12], [2, "#FF0000", 8], [1, "#00FF00", 20],
    ]);
  });

  it("rejects any unfatiated or incomplete plate instead of using partial totals", () => {
    const missing = plate(2); delete missing.slicer_estimates;
    expect(() => modelPricingFromComposition(composition(plate(1), missing))).toThrow(/placa 2 precisa ser fatiada/);
    for (const value of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalid = plate(1); invalid.time_seconds = value;
      expect(() => modelPricingFromComposition(composition(invalid))).toThrow(/tempo e peso completos/);
    }
    const noGrams = plate(1); noGrams.slicer_estimates!.filaments[0].weight_grams = null;
    expect(() => modelPricingFromComposition(composition(noGrams))).toThrow(/gramas do filamento 1/);
    const noFilaments = plate(1); noFilaments.slicer_estimates!.filaments = [];
    expect(() => modelPricingFromComposition(composition(noFilaments))).toThrow(/consumo por filamento/);
  });

  it("accepts native rounding but rejects hidden or inconsistent material consumption", () => {
    const rounded = plate(1); rounded.slicer_estimates!.filaments[0].weight_grams = 19.99;
    expect(modelPricingFromComposition(composition(rounded)).materials[0].grams).toBe(19.99);
    const inconsistent = plate(1); inconsistent.slicer_estimates!.filaments[0].weight_grams = 10;
    expect(() => modelPricingFromComposition(composition(inconsistent))).toThrow(/não confere/);
  });

  it("rejects duplicate plates/slots and supports explicit unused slots", () => {
    expect(() => modelPricingFromComposition(composition())).toThrow(/não contém placas/);
    expect(() => modelPricingFromComposition(composition(plate(1), plate(1)))).toThrow(/placas inválidos ou repetidos/);
    const duplicate = plate(1); duplicate.slicer_estimates!.filaments.push({ ...duplicate.slicer_estimates!.filaments[0] });
    expect(() => modelPricingFromComposition(composition(duplicate))).toThrow(/slots inválidos ou repetidos/);
    const unused = plate(1); unused.slicer_estimates!.filaments.push({ id: 2, material_code: null, color_hex: null, weight_grams: 0, length_meters: null });
    expect(modelPricingFromComposition(composition(unused)).materials).toHaveLength(1);
  });
});

describe("printer pricing defaults", () => {
  const printer = { depreciation_per_hour: null, acquisition_cost: 4000, useful_life_hours: 10000, maintenance_cost_per_hour: 0.1 };
  it("loads the saved printer costs when no pricing tariff is configured", () => {
    expect(printerMachineHourCost(printer)).toBe(0.5);
    expect(printerMachineHourCost({ ...printer, depreciation_per_hour: 0.25 })).toBe(0.35);
    expect(printerMachineHourCost({ ...printer, depreciation_per_hour: 0, maintenance_cost_per_hour: 0 })).toBe(0);
  });
  it("prioritizes explicit printer and company tariffs, including zero", () => {
    expect(printerMachineHourCost(printer, 2, 3)).toBe(2);
    expect(printerMachineHourCost(printer, "", 3)).toBe(3);
    expect(printerMachineHourCost(printer, 0, 3)).toBe(0);
    expect(printerMachineHourCost(printer, undefined, 0)).toBe(0);
    expect(printerMachineHourCost(printer, "1,5")).toBe(1.5);
  });
  it("does not convert missing or invalid cost components into zero", () => {
    expect(printerMachineHourCost({ ...printer, maintenance_cost_per_hour: null })).toBeNull();
    expect(printerMachineHourCost({ ...printer, useful_life_hours: 0 })).toBeNull();
    expect(printerMachineHourCost({ ...printer, acquisition_cost: null })).toBeNull();
    expect(printerMachineHourCost(printer, -1)).toBeNull();
  });
});

describe("sliced printer compatibility", () => {
  it("compares machine model rather than loose substrings", () => {
    expect(printerMatchesSliceModels({ brand: "Bambu Lab", model: "A1" }, ["Bambu Lab A1 0.4 nozzle"])).toBe(true);
    expect(printerMatchesSliceModels({ model: "A1" }, ["N2S"])).toBe(true);
    expect(printerMatchesSliceModels({ model: "A1 mini" }, ["Bambu Lab A1"])).toBe(false);
    expect(printerMatchesSliceModels({ model: "A1", name: "A1 mini" }, ["N1"])).toBe(false);
    expect(printerMatchesSliceModels({ model: "X1C" }, ["BL-P001"])).toBe(true);
    expect(printerMatchesSliceModels({ model: "P1S" }, ["C12", "Bambu Lab P1S"])).toBe(true);
    expect(printerMatchesSliceModels({ model: "P1S" }, ["C12", "Bambu Lab P1P"])).toBe(false);
    expect(printerMatchesSliceModels({ brand: "Other", model: "A1" }, ["N2S"])).toBe(false);
  });
  it("returns unknown when the file or registered printer has no verifiable model", () => {
    expect(printerMatchesSliceModels({ model: "A1" }, [])).toBeNull();
    expect(printerMatchesSliceModels({ name: "Impressora 1" }, ["N2S"])).toBeNull();
    expect(printerMatchesSliceModels({ model: "A1" }, ["unknown"])).toBeNull();
  });
});

function makerWorldReference() {
  return normalizeMakerWorldDesign({ id: 123, title: "Produto de duas placas", instances: [{
    id: 10, profileId: 20, title: "PLA A1", extention: { modelInfo: { compatibility: { devProductName: "A1", devModelName: "N2S", nozzleDiameter: 0.4 }, plates: [
      { index: 1, weight: 40, prediction: 1800, objects: [{ id: 1, name: "Corpo", quantity: 1 }], filaments: [{ id: "red", type: "PLA", color: "#FF0000", usedG: 40 }] },
      { index: 2, weight: 60, prediction: 5400, objects: [{ id: 2, name: "Tampa", quantity: 1 }], filaments: [{ id: "green", type: "PLA", color: "#00FF00", usedG: 60 }] },
    ] } },
  }] });
}

describe("MakerWorld pricing estimates", () => {
  it("uses one selected configuration's plate totals and material consumption without inventing slots or product yield", () => {
    const reference = makerWorldReference();
    reference.profiles[0].weight_grams = 999; // A profile total is never added to its plates.
    const result = modelPricingFromMakerWorld(reference);
    expect(result).toMatchObject({ source: "makerworld", hours: 2, timeSeconds: 7200, weightGrams: 100, plateCount: 2, partCount: 2, printerModelIds: ["A1"], nozzleDiameters: ["0.4"] });
    expect(result.materials.map(material => [material.slotId, material.materialCode, material.colorHex, material.grams, material.plateIndices])).toEqual([
      [null, "PLA", "#FF0000", 40, [1]], [null, "PLA", "#00FF00", 60, [2]],
    ]);
    expect(result).not.toHaveProperty("quantity");
  });

  it("uses published aggregate material grams when plate-level material splits are absent", () => {
    const reference = makerWorldReference();
    reference.profiles[0].plate_details.forEach(entry => { entry.filaments = []; });
    const result = modelPricingFromMakerWorld(reference);
    expect(result.materials.map(material => [material.grams, material.plateIndices])).toEqual([[40, []], [60, []]]);
    expect(result.weightGrams).toBe(100);
  });

  it("can apply complete totals to exactly one explicit material, but never divides unknown multicolor consumption", () => {
    const reference = makerWorldReference();
    reference.profiles[0].plate_details.forEach(entry => { entry.filaments = []; });
    reference.profiles[0].filaments = [{ id: null, type: "PLA", color: "#FF0000", grams: null, meters: null }];
    expect(modelPricingFromMakerWorld(reference).materials).toMatchObject([{ slotId: null, materialCode: "PLA", grams: 100 }]);
    reference.profiles[0].filaments.push({ id: null, type: "PLA", color: "#00FF00", grams: null, meters: null });
    expect(() => modelPricingFromMakerWorld(reference)).toThrow(/gramas de cada material/);
  });

  it("does not use a single declared profile material to erase an unknown multicolor plate split", () => {
    const reference = makerWorldReference();
    reference.profiles[0].plate_details[0].filaments.push({ id: "green", type: "PLA", color: "#00FF00", grams: null, meters: null });
    reference.profiles[0].filaments = [{ id: null, type: "PLA", color: "#FF0000", grams: null, meters: null }];
    expect(() => modelPricingFromMakerWorld(reference)).toThrow(/gramas de cada material/);
    reference.profiles[0].filaments[0].grams = 100;
    expect(() => modelPricingFromMakerWorld(reference)).toThrow(/materiais das placas diferem/);
  });

  it("uses complete declared profile totals only when the plate count is known and no detailed plates are available", () => {
    const reference = makerWorldReference(); reference.profiles[0].plate_details = [];
    expect(modelPricingFromMakerWorld(reference)).toMatchObject({ hours: 2, weightGrams: 100, plateCount: 2, partCount: null });
    reference.profiles[0].plates = null;
    expect(() => modelPricingFromMakerWorld(reference)).toThrow(/placas completos/);
  });

  it("rejects incomplete plates, inconsistent material weights, unavailable selections and unselected alternatives", () => {
    const incomplete = makerWorldReference(); incomplete.profiles[0].plate_details[1].time_seconds = null;
    expect(() => modelPricingFromMakerWorld(incomplete)).toThrow(/todas as placas/);
    const inconsistent = makerWorldReference(); inconsistent.profiles[0].plate_details[0].filaments[0].grams = 1;
    expect(() => modelPricingFromMakerWorld(inconsistent)).toThrow(/não confere/);
    const multiple = makerWorldReference(); multiple.profiles.push({ ...multiple.profiles[0], instance_id: "11", profile_id: "21" });
    expect(() => modelPricingFromMakerWorld(multiple)).toThrow(/configuração/);
    multiple.selected_instance_id = "11"; multiple.selected_variant_profile_id = "21";
    expect(modelPricingFromMakerWorld(multiple).weightGrams).toBe(100);
    multiple.selected_variant_profile_id = "missing";
    expect(() => modelPricingFromMakerWorld(multiple)).toThrow(/impressora da configuração/);
  });
});

describe("minimal-question resource suggestions", () => {
  const estimate = () => modelPricingFromComposition(composition(plate(1)));
  it("defaults to a compatible active printer and distinguishes A1 mini", () => {
    const printers = [{ id: "mini", name: "A1 Mini", model: "A1 mini" }, { id: "offline", name: "A", model: "A1", is_active: false }, { id: "a1-b", name: "B", model: "A1" }, { id: "a1-a", name: "A", model: "A1" }];
    expect(recommendPrinterForEstimate(estimate(), printers)?.id).toBe("a1-a");
    expect(recommendPrinterForEstimate({ ...estimate(), printerModelIds: [] }, printers)).toBeNull();
  });

  it("selects a unique exact material/color, normalizing opaque alpha, without choosing among competing prices", () => {
    const stock = [{ id: "red", material_code: " pla ", color_hex: "#ff0000ff" }, { id: "green", material_code: "PLA", color_hex: "#00FF00" }];
    const key = estimate().materials[0].key;
    expect(recommendFilamentsForEstimate(estimate(), stock)).toEqual({ [key]: "red" });
    expect(recommendFilamentsForEstimate(estimate(), [...stock, { ...stock[0], id: "red-costlier" }])).toEqual({});
  });

  it("uses the only matching material type when exact color is unavailable and otherwise asks for a choice", () => {
    const key = estimate().materials[0].key;
    const only = { id: "green", material_code: "PLA", color_hex: "#00FF00" };
    expect(recommendFilamentsForEstimate(estimate(), [only])).toEqual({ [key]: "green" });
    expect(recommendFilamentsForEstimate(estimate(), [only, { ...only, id: "blue", color_hex: "#0000FF" }])).toEqual({});
    expect(recommendFilamentsForEstimate(estimate(), [{ ...only, is_active: false }])).toEqual({});
    expect(recommendFilamentsForEstimate(estimate(), [{ ...only, material_code: "PETG" }])).toEqual({});
  });
});
