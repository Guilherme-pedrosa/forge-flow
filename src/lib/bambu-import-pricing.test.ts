import { describe, expect, it } from "vitest";
import { bambuProjectPricing, bambuTaskPricing } from "./bambu-import-pricing";

const task = () => ({ weight_grams: "100", cost_time_seconds: 7200, status: "2", bambu_devices: { model: "A1" }, raw_data: {
  amsDetailMapping: [
    { filamentType: "PLA", sourceColor: "FF0000FF", targetFilamentType: "PETG", targetColor: "00FF00FF", weight: "60" },
    { filamentType: "PETG", sourceColor: "0000FFFF", weight: 40 },
  ],
} });
const plate = (weight = 20, seconds = 3600) => ({ weight, prediction: seconds, filaments: [{ type: "PLA", color: "#FFFFFF", used_g: weight }] });

describe("Bambu imported pricing plans", () => {
  it("preserves native planned grams/time, each material and explicit target identity", () => {
    const result = bambuTaskPricing(task());
    expect(result.error).toBe("");
    expect(result.requiresSingleMaterialConfirmation).toBe(false);
    expect(result.estimate).toMatchObject({ hours: 2, weightGrams: 100, timeSeconds: 7200, plateCount: 1, partCount: null, printerModelIds: ["A1"] });
    expect(result.estimate!.materials).toMatchObject([
      { materialCode: "PETG", colorHex: "#00FF00", grams: 60 },
      { materialCode: "PETG", colorHex: "#0000FF", grams: 40 },
    ]);
  });

  it("does not call planned estimates actual measurements even for failed tasks", () => {
    const value = { ...task(), status: "3", start_time: "2026-01-01T00:00:00Z", end_time: "2026-01-01T00:01:00Z" };
    expect(bambuTaskPricing(value).estimate?.timeSeconds).toBe(7200);
    expect(bambuTaskPricing(value).estimate).not.toHaveProperty("actual_grams");
    expect(bambuTaskPricing(value).estimate).not.toHaveProperty("produced_quantity");
  });

  it("unknown mapping yields only an unconfirmed single-material placeholder", () => {
    const result = bambuTaskPricing({ weight_grams: 100, cost_time_seconds: 7200, raw_data: {} });
    expect(result.requiresSingleMaterialConfirmation).toBe(true);
    expect(result.estimate!.materials).toEqual([expect.objectContaining({ grams: 100, materialCode: null, slotId: null, colorHex: null })]);
    expect(result.estimate!.printerModelIds).toEqual([]);
  });

  it("uses the reported raw totals if normalized task totals are absent", () => {
    const result = bambuTaskPricing({ raw_data: { weight: "16.78", costTime: 3046 } }, { printerModel: "Bambu Lab A1" });
    expect(result.estimate).toMatchObject({ weightGrams: 16.78, timeSeconds: 3046, printerModelIds: ["Bambu Lab A1"] });
  });

  it("can use the one known total for one explicitly mapped filament missing its mass", () => {
    const result = bambuTaskPricing({ ...task(), raw_data: { amsDetailMapping: [{ filamentType: "PLA", sourceColor: "FFFFFFFF" }] } });
    expect(result.estimate!.materials).toMatchObject([{ grams: 100, materialCode: "PLA", colorHex: "#FFFFFF" }]);
  });

  it.each(["missing", "negative", "overflow", "mismatch", "unknown-type"])("rejects incomplete or inconsistent multicolor mapping: %s", kind => {
    const value = task();
    if (kind === "missing") delete (value.raw_data.amsDetailMapping[1] as { weight?: unknown }).weight;
    if (kind === "negative") value.raw_data.amsDetailMapping[1].weight = -1;
    if (kind === "overflow") value.raw_data.amsDetailMapping[1].weight = 1_000_001;
    if (kind === "mismatch") value.raw_data.amsDetailMapping[1].weight = 30;
    if (kind === "unknown-type") value.raw_data.amsDetailMapping[1].filamentType = "";
    expect(bambuTaskPricing(value).estimate).toBeNull();
    expect(bambuTaskPricing(value).error).not.toBe("");
  });

  it("does not turn a known multicolor count into the single-filament placeholder", () => {
    expect(bambuTaskPricing({ weight_grams: 100, cost_time_seconds: 7200, raw_data: { numColors: 2 } }).estimate).toBeNull();
  });

  it.each([null, 0, -1, NaN, Infinity, "errado"])("requires a valid complete task total instead of zero for %s", weight => {
    expect(bambuTaskPricing({ weight_grams: weight, cost_time_seconds: 7200 }).estimate).toBeNull();
    expect(bambuTaskPricing({ weight_grams: 100, cost_time_seconds: weight }).estimate).toBeNull();
  });

  it("refuses legacy project aggregates that may sum alternate printer profiles", () => {
    const result = bambuProjectPricing({ project_id: "project", total_weight_grams: 100, total_time_seconds: 7200,
      filaments: [{ type: "PLA", color: "#FFFFFF", grams: 100 }] });
    expect(result.estimate).toBeNull();
    expect(result.error).toMatch(/único perfil/);
  });

  it("uses only the selected detailed profile and never adds alternate profiles", () => {
    const value = { profiles: [
      { profile_id: "a1", printer_model: "A1", context: { plates: [plate(20, 3600), plate(30, 7200)] } },
      { profile_id: "p1s", printer_model: "P1S", context: { plates: [plate(20, 1800)] } },
    ] };
    expect(bambuProjectPricing(value).estimate).toBeNull();
    const chosen = bambuProjectPricing(value, { profileId: "a1" });
    expect(chosen.estimate).toMatchObject({ weightGrams: 50, timeSeconds: 10800, plateCount: 2, printerModelIds: ["A1"] });
    expect(chosen.estimate!.materials.map(row => row.grams)).toEqual([20, 30]);
    expect(bambuProjectPricing(value, { profileId: "unknown" }).estimate).toBeNull();
  });

  it("accepts a sole detailed profile without asking a second question", () => {
    const result = bambuProjectPricing({ profiles: [{ context: { plates: [plate()] } }] });
    expect(result.estimate).toMatchObject({ weightGrams: 20, timeSeconds: 3600, plateCount: 1 });
  });

  it("refuses incomplete plates and unknown multi-material distribution", () => {
    for (const broken of [
      { ...plate(), prediction: null },
      { ...plate(), filaments: [] },
      { ...plate(), filaments: [{ type: "PLA", used_g: 10 }] },
      { ...plate(), filaments: [{ type: "PLA" }, { type: "PETG" }] },
    ]) expect(bambuProjectPricing({ profiles: [{ context: { plates: [broken] } }] }).estimate).toBeNull();
  });
});
