import { describe, expect, it, vi } from "vitest";
import { fetchPrintSourceImport, getPrintSourceImportIdentity, PrintSourceImportError, resolvePrintSourceImport } from "@/lib/print-source-import";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";

const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/makerworld-import", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/makerworld-import")>(), fetchMakerWorldModel: mock.fetch }));
// Public API shape from design1403296; only identity and slicer metadata retained.
const plate = (index: number, weight: number, prediction: number) => ({ index, name: "", weight, prediction, objects: [], filaments: [{ id: "1", type: "PLA", color: "#A7A9AA", usedG: String(weight) }] });
const model = () => normalizeMakerWorldDesign({ id: 1403296, modelId: "US43322ca98eb5f0", title: "Wheel", defaultInstanceId: 1455750, instances: [
  { id: 1455750, profileId: 297891629, title: "Wheel All Plates 0.2mm layer", weight: 139, prediction: 15526,
    extention: { modelInfo: { compatibility: { devProductName: "A1", nozzleDiameter: .4 }, plates: [plate(1, 57, 6370), plate(2, 65, 5796), plate(3, 17, 3360)] },
      otherCompatibilityModelInfo: [{ profileId: 807375095, weight: 139, prediction: 14142, modelInfo: { compatibility: { devProductName: "P1S" }, plates: [plate(1, 57, 5458), plate(2, 65, 5618), plate(3, 17, 3066)] } }] } },
  { id: 2830598, profileId: 677129091, title: "Different five-plate version", extention: { modelInfo: { plates: [plate(1, 57, 5104), plate(2, 65, 5347), plate(3, 19, 2946), plate(4, 24, 2813), plate(5, 8, 1387)] } } },
] });
const source = () => ({ design_id: "1403296", instance_id: "1455750", model_id: "US43322ca98eb5f0", profile_id: "297891629", plate_index: 3 });
const task = () => ({ id: "public-task", bambu_task_id: "1242663615", status: "2", weight_grams: "16.78", cost_time_seconds: 3046,
  raw_data: { designId: 1403296, instanceId: 1455750, modelId: "US43322ca98eb5f0", profileId: 297891629, plateIndex: 3,
    amsDetailMapping: [{ filamentType: "PLA", sourceColor: "A7A9AAFF", targetColor: "FFFFFFFF", weight: 16.78 }] } });
const code = (action: () => unknown) => { try { action(); } catch (error) { expect(error).toBeInstanceOf(PrintSourceImportError); return (error as PrintSourceImportError).code; } throw new Error("Expected rejection"); };

describe("print source to operational import identities", () => {
  it("resolves the exact linked A1 profile and retains all three plates, without using another public profile", () => {
    const reference = resolvePrintSourceImport(model(), source(), task());
    expect(reference).toMatchObject({ selected_profile_id: "1455750", selected_variant_profile_id: "297891629", source_url: "https://makerworld.com/en/models/1403296#profileId-1455750" });
    expect(reference.profiles[0].plate_details.map(p => [p.index, p.weight_grams, p.time_seconds])).toEqual([[1, 57, 6370], [2, 65, 5796], [3, 17, 3360]]);
    expect(reference.profiles[0].plate_details.every(p => p.units_per_plate === null)).toBe(true);
  });
  it("keeps original gray filament and estimated plate values separate from historical white material and task consumption", () => {
    const reference = resolvePrintSourceImport(model(), source(), task());
    expect(reference.profiles[0].plate_details[2].filaments[0]).toMatchObject({ type: "PLA", color: "#A7A9AA", grams: 17 });
    expect(reference.profiles[0].plate_details[2].time_seconds).toBe(3360);
    expect(reference.profiles[0].plate_details[2]).not.toHaveProperty("item_id");
  });
  it("finds the observed technical variant even when it is not the first printer option", () => {
    const reference = resolvePrintSourceImport(model(), { ...source(), profile_id: "807375095" });
    expect(reference.selected_variant_profile_id).toBe("807375095");
    expect(reference.profiles[0].variants[0].plate_details[2].time_seconds).toBe(3066);
  });
  it("uses the exact task IDs when the uploaded file has no public IDs of its own", () => {
    expect(resolvePrintSourceImport(model(), { source_url: null }, task()).selected_variant_profile_id).toBe("297891629");
  });
  it("never silently chooses A1 or P1S when a source identifies only a public instance with multiple configurations", () => {
    expect(code(() => resolvePrintSourceImport(model(), { source_url: "https://makerworld.com/en/models/1403296#profileId-1455750" }))).toBe("profile_choice_required");
    expect(code(() => resolvePrintSourceImport(model(), { design_id: "1403296" }))).toBe("profile_choice_required");
    const fetched = model();
    try { resolvePrintSourceImport(fetched, { design_id: "1403296" }); } catch (error) { expect((error as PrintSourceImportError).model).toBe(fetched); }
  });
  it("requires the source and task to agree on each observed identity and does not shift a plate index", () => {
    for (const mismatch of [{ design_id: "99" }, { instance_id: "2830598" }, { model_id: "OTHER" }, { profile_id: "807375095" }]) {
      expect(code(() => resolvePrintSourceImport(model(), { ...source(), ...mismatch }, task()))).toBe("identity_mismatch");
    }
    expect(code(() => resolvePrintSourceImport(model(), { ...source(), plate_index: 0 }))).toBe("identity_mismatch");
    expect(code(() => resolvePrintSourceImport(model(), { ...source(), source_url: "https://makerworld.com/en/models/1403296#profileId-2830598" }))).toBe("identity_mismatch");
  });
  it("accepts another plate from the same complete profile and exposes its observed index without changing it", () => {
    const history = task(); history.raw_data.plateIndex = 1;
    expect(getPrintSourceImportIdentity(source(), history)).toMatchObject({ design_id: "1403296", profile_id: "297891629", plate_index: 1 });
    const reference = resolvePrintSourceImport(model(), source(), history);
    expect(reference.profiles[0].plate_details.map(plate => plate.index)).toEqual([1, 2, 3]);
  });
  it("refuses unknown IDs, duplicate indexes, absent plate details or incomplete plate coverage", () => {
    expect(code(() => resolvePrintSourceImport(model(), { ...source(), profile_id: "999" }))).toBe("metadata_unavailable");
    for (const type of ["duplicate", "missing", "partial"]) {
      const value = model(); const profile = value.profiles[0];
      if (type === "duplicate") profile.plate_details[1].index = 1;
      else if (type === "missing") profile.plate_details = [];
      else profile.plate_details.pop();
      expect(code(() => resolvePrintSourceImport(value, source()))).toBe("metadata_unavailable");
    }
  });
  it("keeps a failed task's full slicer estimate out of any actual usage calculation", () => {
    const history = { ...task(), status: "3", weight_grams: "16.49" };
    const reference = resolvePrintSourceImport(model(), source(), history);
    expect(reference.profiles[0].plate_details[2].weight_grams).toBe(17);
    expect(reference).not.toHaveProperty("actual_grams"); expect(reference).not.toHaveProperty("produced_quantity");
  });
  it("fetches only a canonical public design URL and does not fetch for a task without MakerWorld identity", async () => {
    mock.fetch.mockReset(); mock.fetch.mockResolvedValue(model());
    await fetchPrintSourceImport({ source_url: "https://storage.example.test/private.3mf" }, task());
    expect(mock.fetch).toHaveBeenCalledWith("https://makerworld.com/en/models/1403296#profileId-1455750", undefined);
    mock.fetch.mockClear();
    await expect(fetchPrintSourceImport({ source_url: "https://storage.example.test/private.3mf" }, { raw_data: { modelId: "PRIVATE", profileId: 50, plateIndex: 1 } })).rejects.toMatchObject({ code: "metadata_unavailable" });
    expect(mock.fetch).not.toHaveBeenCalled();
  });
});
