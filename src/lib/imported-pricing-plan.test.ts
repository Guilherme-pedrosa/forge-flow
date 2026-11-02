import { describe, expect, it } from "vitest";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";
import { importedComposition, validateImportedComposition, type ImportedComponent, type ImportedComposition } from "./imported-composition";
import { buildImportedPricingPlan, savedPlatesToComposition } from "./imported-pricing-plan";
import type { ProductExternalImport } from "./makerworld-import";
import { modelPricingFromComposition, modelPricingFromMakerWorld, type ModelPricingEstimate } from "./model-pricing";

const hash = "a".repeat(64);
function nativePlate(index: number, grams = 40): ImportedComponent {
  return { index, label: `Placa ${index}`, photo_url: null, units_per_plate: 99, weight_grams: grams, time_seconds: 1800,
    parts: [{ source_key: "body", name: "Corpo", photo_url: null, name_source: "file", quantity_per_plate: 99, quantity_per_product: null }],
    slicer_estimates: { source: "3mf_slice_info", slicer_version: "02.08", printer_model_id: "Bambu Lab A1", nozzle_diameters: "0.4",
      filaments: [{ id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: grams, length_meters: null }] } };
}
function native(...plates: ImportedComponent[]): ImportedComposition {
  return { profile_id: `local:${hash}`, file_sha256: hash, enabled: plates.length > 1, plates };
}
function calculation(estimate: ModelPricingEstimate, quantity = 2) {
  return { printerId: "chosen-printer", quantity, materialSelections: Object.fromEntries(estimate.materials.map((material, index) => [material.key, `stock-${index + 1}`])) };
}
function makerReference(): ProductExternalImport {
  const model = normalizeMakerWorldDesign({ id: 123, title: "Produto de duas placas", instances: [{
    id: 10, profileId: 20, title: "PLA A1", extention: { modelInfo: { compatibility: { devProductName: "A1", devModelName: "N2S", nozzleDiameter: 0.4 }, plates: [
      { index: 1, weight: 40, prediction: 1800, objects: [{ id: 1, name: "Corpo", quantity: 1 }], filaments: [{ id: "red", type: "PLA", color: "#FF0000", usedG: 40 }] },
      { index: 2, weight: 60, prediction: 5400, objects: [{ id: 2, name: "Tampa", quantity: 1 }], filaments: [{ id: "green", type: "PLA", color: "#00FF00", usedG: 60 }] },
    ] } },
  }] });
  return { ...model, provider: "makerworld", source_url: "https://makerworld.com/en/models/123", selected_profile_id: "10", selected_instance_id: "10", selected_variant_profile_id: "20", fetched_at: "2026-11-02T12:00:00Z" };
}

describe("persisted choices from imported pricing", () => {
  it("keeps the selected stock, printer and confirmed finished quantity with exact native grams on each plate", () => {
    const first = nativePlate(1), second = nativePlate(2, 60);
    first.slicer_estimates!.filaments = [
      { id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: 12, length_meters: null },
      { id: 2, material_code: "PLA", color_hex: "#00FF00", weight_grams: 28, length_meters: null },
    ];
    second.slicer_estimates!.filaments = [
      { id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: 58, length_meters: null },
      { id: 2, material_code: "PLA", color_hex: "#00FF00", weight_grams: 2, length_meters: null },
    ];
    const composition = native(first, second), estimate = modelPricingFromComposition(composition), choices = calculation(estimate);
    const plan = buildImportedPricingPlan(estimate, composition, { ...choices, sourceId: "saved-source" });
    expect(plan).toMatchObject({ version: 1, printer_id: "chosen-printer", quantity: 2, source_id: "saved-source", source_profile_id: `local:${hash}`, source_file_sha256: hash });
    expect(plan.materials).toEqual([
      { source_key: estimate.materials[0].key, item_id: "stock-1", material_code: "PLA", color_hex: "#FF0000", slot_id: 1 },
      { source_key: estimate.materials[1].key, item_id: "stock-2", material_code: "PLA", color_hex: "#00FF00", slot_id: 2 },
    ]);
    expect(plan.plates).toEqual([
      { index: 1, units_per_plate: 2, lines: [{ item_id: "stock-1", grams: 12 }, { item_id: "stock-2", grams: 28 }] },
      { index: 2, units_per_plate: 2, lines: [{ item_id: "stock-1", grams: 58 }, { item_id: "stock-2", grams: 2 }] },
    ]);
    expect(first.units_per_plate).toBe(99);
    expect(first.parts[0].quantity_per_plate).toBe(99);
  });

  it("combines native slots only after each slot's explicit stock choice, preserving decimal grams", () => {
    const plate = nativePlate(1, 3.63);
    plate.slicer_estimates!.filaments = [
      { id: 1, material_code: "pla", color_hex: "#ff0000ff", weight_grams: 1.21, length_meters: null },
      { id: 2, material_code: "PLA", color_hex: "#FF0000", weight_grams: 2.42, length_meters: null },
      { id: 3, material_code: null, color_hex: null, weight_grams: 0, length_meters: null },
    ];
    const composition = native(plate), estimate = modelPricingFromComposition(composition);
    const choices = { ...calculation(estimate), materialSelections: Object.fromEntries(estimate.materials.map(material => [material.key, "same-stock"])) };
    expect(buildImportedPricingPlan(estimate, composition, choices).plates[0].lines).toEqual([{ item_id: "same-stock", grams: 3.63 }]);
  });

  it("rejects missing choices and invalid finished quantity instead of saving a partial preparation", () => {
    const composition = native(nativePlate(1)), estimate = modelPricingFromComposition(composition), choices = calculation(estimate);
    expect(() => buildImportedPricingPlan(estimate, composition, { ...choices, printerId: "" })).toThrow(/Selecione a impressora/);
    expect(() => buildImportedPricingPlan(estimate, composition, { ...choices, materialSelections: {} })).toThrow(/Confirme cada filamento/);
    for (const quantity of [0, 1.5, 10001]) expect(() => buildImportedPricingPlan(estimate, composition, { ...choices, quantity })).toThrow(/produtos completos/);
  });

  it("rejects changed plates, slots, times and weights after the user priced the file", () => {
    const composition = native(nativePlate(1)), estimate = modelPricingFromComposition(composition), choices = calculation(estimate);
    const changed = structuredClone(composition); changed.plates[0].slicer_estimates!.filaments[0].id = 2;
    expect(() => buildImportedPricingPlan(estimate, changed, choices)).toThrow(/não corresponde ao cálculo/);
    const unknown = structuredClone(composition); unknown.plates[0].slicer_estimates!.filaments[0].weight_grams = null;
    expect(() => buildImportedPricingPlan(estimate, unknown, choices)).toThrow(/gramas de cada filamento/);
    const unsliced = structuredClone(composition); delete unsliced.plates[0].slicer_estimates;
    expect(() => buildImportedPricingPlan(estimate, unsliced, choices)).toThrow(/3MF fatiado/);
    const missing = structuredClone(composition); missing.plates = [];
    expect(() => buildImportedPricingPlan(estimate, missing, choices)).toThrow(/não correspondem/);
    const changedTime = structuredClone(composition); changedTime.plates[0].time_seconds = 1801;
    expect(() => buildImportedPricingPlan(estimate, changedTime, choices)).toThrow(/mudaram desde o cálculo/);
    const changedGrams = structuredClone(composition); changedGrams.plates[0].slicer_estimates!.filaments[0].weight_grams = 20;
    expect(() => buildImportedPricingPlan(estimate, changedGrams, choices)).toThrow(/peso da placa/);
    expect(() => buildImportedPricingPlan(estimate, { ...composition, file_sha256: "b".repeat(64) }, choices)).toThrow(/corresponder ao arquivo/);
  });

  it("uses MakerWorld's per-plate color distribution without applying aggregate totals to every plate", () => {
    const reference = makerReference(), composition = importedComposition(reference)!, estimate = modelPricingFromMakerWorld(reference);
    expect(buildImportedPricingPlan(estimate, composition, calculation(estimate, 1), reference).plates).toEqual([
      { index: 1, units_per_plate: 1, lines: [{ item_id: "stock-1", grams: 40 }] },
      { index: 2, units_per_plate: 1, lines: [{ item_id: "stock-2", grams: 60 }] },
    ]);
  });

  it("can assign known plate weights to one explicit material when MakerWorld omitted plate filaments", () => {
    const reference = makerReference();
    reference.profiles[0].plate_details.forEach(plate => { plate.filaments = []; });
    reference.profiles[0].filaments = [{ id: null, type: "PLA", color: "#FF0000", grams: 100, meters: null }];
    const composition = importedComposition(reference)!, estimate = modelPricingFromMakerWorld(reference);
    expect(buildImportedPricingPlan(estimate, composition, calculation(estimate), reference).plates.map(plate => plate.lines)).toEqual([
      [{ item_id: "stock-1", grams: 40 }], [{ item_id: "stock-1", grams: 60 }],
    ]);
  });

  it("does not guess an aggregate mixed-color split across MakerWorld plates", () => {
    const reference = makerReference(); reference.profiles[0].plate_details.forEach(plate => { plate.filaments = []; });
    const composition = importedComposition(reference)!, estimate = modelPricingFromMakerWorld(reference);
    expect(estimate.materials).toHaveLength(2);
    expect(() => buildImportedPricingPlan(estimate, composition, calculation(estimate), reference)).toThrow(/distribuir os materiais/);
  });

  it("does not override mixed-color observations with a global single-material default", () => {
    const reference = makerReference();
    reference.profiles[0].plate_details[0].filaments[0].grams = null;
    reference.profiles[0].plate_details[0].filaments.push({ id: "green", type: "PLA", color: "#00FF00", grams: null, meters: null });
    const estimate = modelPricingFromMakerWorld(makerReference());
    estimate.materials = [{ ...estimate.materials[0], grams: 100, plateIndices: [1, 2] }];
    expect(() => buildImportedPricingPlan(estimate, importedComposition(reference)!, calculation(estimate), reference)).toThrow(/gramas de cada cor por placa/);
  });

  it("keeps per-plate single-material identity even if the source omitted its grams", () => {
    const reference = makerReference(); reference.profiles[0].plate_details.forEach(plate => { plate.filaments[0].grams = null; });
    const estimate = modelPricingFromMakerWorld(reference);
    expect(buildImportedPricingPlan(estimate, importedComposition(reference)!, calculation(estimate), reference).plates.map(plate => plate.lines)).toEqual([
      [{ item_id: "stock-1", grams: 40 }], [{ item_id: "stock-2", grams: 60 }],
    ]);
  });

  it("rejects a different selected profile or a plate outside a material's known source indices", () => {
    const reference = makerReference(), composition = importedComposition(reference)!, estimate = modelPricingFromMakerWorld(reference);
    expect(() => buildImportedPricingPlan(estimate, { ...composition, profile_id: "21" }, calculation(estimate), reference)).toThrow(/perfis diferentes/);
    reference.profiles[0].plate_details[0].filaments = [];
    estimate.materials = [{ ...estimate.materials[0], grams: 100, plateIndices: [2] }];
    expect(() => buildImportedPricingPlan(estimate, composition, calculation(estimate), reference)).toThrow(/não corresponde ao cálculo/);
  });
});

describe("restoring saved native source metadata for pricing repair", () => {
  it("reconstructs native slicer values and file identity, without deriving finished quantity from object count", () => {
    const plate = nativePlate(1);
    const composition = savedPlatesToComposition({ id: "source", profile_id: `local:${hash}`, file_sha256: hash, file_path: "tenant/file.3mf", file_name: "file.3mf" }, [{
      source_id: "source", plate_index: 1, label: "Corpo", est_grams: 40, est_time_seconds: 1800, units_per_plate: null,
      imported_plate_metadata: { file_profile_id: `local:${hash}`, local_file_hash: `local:${hash}`, file_sha256: hash, slicer_estimates: plate.slicer_estimates,
        plate: { parts: [{ source_key: "body", name: "Corpo", quantity_per_plate: 20 }] } },
    }]);
    expect(composition).toMatchObject({ profile_id: `local:${hash}`, file_sha256: hash, file_path: "tenant/file.3mf", file_name: "file.3mf", plates: [{ units_per_plate: null, weight_grams: 40, time_seconds: 1800, slicer_estimates: plate.slicer_estimates, parts: [{ name: "Corpo", quantity_per_plate: 20, quantity_per_product: null }] }] });
    expect(modelPricingFromComposition(composition)).toMatchObject({ weightGrams: 40, timeSeconds: 1800, partCount: 20 });
    expect(() => validateImportedComposition(composition)).not.toThrow();
  });

  it("uses the actually saved MakerWorld metadata when the source's profile_id was not populated", () => {
    const composition = savedPlatesToComposition({ id: "maker", profile_id: null }, [{
      source_id: "maker", plate_index: 1, label: "Conjunto", est_grams: 119, est_time_seconds: 16372,
      imported_plate_metadata: { provider: "makerworld", profile_id: "1039458610", printer_model: "A1", printer_code: "N2S",
        plate: { index: 1, weight_grams: 119, time_seconds: 16372, filaments: [{ id: "1", type: "PLA", color: "#FCECD6", grams: 119 }], objects: [] } },
    }, { source_id: "other", plate_index: 2, imported_plate_metadata: { profile_id: "different" } }]);
    expect(composition).toMatchObject({ profile_id: "1039458610", plates: [{ weight_grams: 119, time_seconds: 16372, units_per_plate: null, parts: [{ quantity_per_plate: null, quantity_per_product: null, name_source: "unknown" }] }] });
    expect(composition.plates).toHaveLength(1);
    expect(composition.plates[0]).not.toHaveProperty("slicer_estimates");
  });

  it("restores immutable native and MakerWorld totals ahead of later manual plate estimates", () => {
    const native = savedPlatesToComposition({ profile_id: `local:${hash}`, file_sha256: hash }, [{
      plate_index: 1, est_grams: 999, est_time_seconds: 99999,
      imported_plate_metadata: { file_profile_id: `local:${hash}`, file_sha256: hash, slicer_weight_grams: 40, slicer_time_seconds: 1800, slicer_estimates: nativePlate(1).slicer_estimates },
    }]);
    expect(native.plates[0]).toMatchObject({ weight_grams: 40, time_seconds: 1800 });
    expect(modelPricingFromComposition(native)).toMatchObject({ weightGrams: 40, timeSeconds: 1800 });
    const maker = savedPlatesToComposition({ profile_id: "profile" }, [{ plate_index: 1, est_grams: 999, est_time_seconds: 99999,
      imported_plate_metadata: { profile_id: "profile", plate: { weight_grams: 119, time_seconds: 16372 } } }]);
    expect(maker.plates[0]).toMatchObject({ weight_grams: 119, time_seconds: 16372 });
  });

  it("rejects absent, conflicting profile or conflicting file identities", () => {
    expect(() => savedPlatesToComposition({ id: "source" }, [{ source_id: "source", plate_index: 1 }])).toThrow(/único perfil/);
    expect(() => savedPlatesToComposition({ profile_id: "profile" }, [{ plate_index: 1, imported_plate_metadata: { profile_id: "different" } }])).toThrow(/único perfil/);
    expect(() => savedPlatesToComposition({ profile_id: "profile", file_sha256: hash }, [{ plate_index: 1, imported_plate_metadata: { profile_id: "profile", file_sha256: "b".repeat(64) } }])).toThrow(/mesmo arquivo/);
    expect(() => savedPlatesToComposition({ id: "source" }, [{ source_id: "source", plate_index: 1, is_active: false }])).toThrow(/não possui placas/);
  });

  it("preserves explicit positive part counts and leaves malformed counts unknown", () => {
    const restored = savedPlatesToComposition({ profile_id: "profile" }, [{ plate_index: 1, imported_plate_metadata: { profile_id: "profile", plate: { objects: [
      { id: "body", name: "Corpo", quantity: 3 }, { id: "lid", name: "Tampa", quantity: 0 },
    ] } } }]);
    expect(restored.plates[0].parts.map(part => [part.quantity_per_plate, part.quantity_per_product])).toEqual([[3, null], [null, null]]);
    expect(() => validateImportedComposition(restored)).not.toThrow();
  });
});
