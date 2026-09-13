import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { downloadJobPrintFile, verifyPrintFileBlob, filePreparationHint, prepareJobPrintFile, readJobProduction, platesWithRecipe, jobRecipeMaterialCount, type ProductionPrintFile } from "./production-files";
import type { ProductionPlate } from "./production-plates";
import type { ProductMaterialSnapshot } from "./product-material-recipe";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), signed: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.signed }) } } }));
const file: ProductionPrintFile = { id: "source", file_path: "tenant/job/model.3mf", file_name: "model.3mf", file_sha256: null };
beforeEach(() => { mocks.rpc.mockReset(); mocks.signed.mockReset(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("private production files", () => {
  it("rejects a different tenant before requesting a signed URL", async () => {
    await expect(downloadJobPrintFile(file, "other")).rejects.toThrow("não pertence");
    await expect(downloadJobPrintFile({ ...file, file_path: "tenant/../other.3mf" }, "tenant")).rejects.toThrow("não pertence");
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("checks SHA256 before release, rejects changed content and validates missing-hash files", async () => {
    const blob = new NodeBlob(["abc"]) as unknown as Blob;
    const verified = { ...file, file_sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
    await expect(verifyPrintFileBlob(verified, blob)).resolves.toBeUndefined();
    await expect(verifyPrintFileBlob({ ...verified, file_sha256: "a".repeat(64) }, blob)).rejects.toThrow("difere da versão");
    await expect(verifyPrintFileBlob({ ...file, file_sha256: "bad" }, blob)).rejects.toThrow("integridade");
    await expect(verifyPrintFileBlob(file, new NodeBlob([]) as unknown as Blob)).rejects.toThrow("vazio");
    await expect(verifyPrintFileBlob({ ...file, file_name: "payload.exe" }, blob)).rejects.toThrow("STL, 3MF ou GCODE");
  });
  it("uses an expiring private URL and surfaces download failures", async () => {
    mocks.signed.mockResolvedValue({ data: { signedUrl: "https://storage.example.test/private" }, error: null });
    const fetcher = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal("fetch", fetcher);
    await expect(downloadJobPrintFile(file, "tenant")).rejects.toThrow("Não foi possível baixar");
    expect(mocks.signed).toHaveBeenCalledWith(file.file_path, 60);
    expect(fetcher).toHaveBeenCalledWith("https://storage.example.test/private", { credentials: "omit" });
  });
  it("does not present an STL or generic 3MF as ready to dispatch", () => {
    expect(filePreparationHint("part.STL")).toContain("fatie");
    expect(filePreparationHint("part.3mf")).toContain("não confirma");
    expect(filePreparationHint("part.gcode.3mf")).toContain("bico");
  });
  it("preparation uses a bound RPC receiver, validates input and preserves supplied request ID", async () => {
    mocks.rpc.mockImplementation(function (this: { storage?: unknown }, name: string) {
      if (!this?.storage) throw new Error("lost RPC receiver");
      return Promise.resolve({ data: name === "job_production_review" ? { job_id: "job" } : "job", error: null });
    });
    await expect(prepareJobPrintFile("job", "source", "printer", "   ", "request")).rejects.toThrow("justificativa");
    expect(mocks.rpc).not.toHaveBeenCalled();
    await prepareJobPrintFile("job", "source", "printer", " Conferido ", "request");
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_job_print_file", { p_job_id: "job", p_source_id: "source", p_printer_id: "printer", p_reason: "Conferido", p_request_id: "request" });
    expect(await readJobProduction("job")).toMatchObject({ job_id: "job" });
  });
});
describe("recipe-backed production preview", () => {
  it("replaces stale plate cost/weight with all exact colors, preserving unknown cost", () => {
    const plates = [{ id: "plate", est_grams: 999, est_cost_per_unit: 999 }] as ProductionPlate[];
    const snapshot = { plates: [{ id: "plate", recipe: { cost_per_unit: 7, lines: [{ item_id: "red", name: "PLA", color_code: "RED", grams_per_print: 10 }, { item_id: "blue", name: "PLA", color_code: "BLUE", grams_per_print: 20 }] } }] } as ProductMaterialSnapshot;
    expect(platesWithRecipe(plates, snapshot)[0]).toMatchObject({ est_grams: 30, est_cost_per_unit: 7, inventory_items: { name: "PLA · RED / PLA · BLUE" } });
    snapshot.plates[0].recipe!.cost_per_unit = null;
    expect(platesWithRecipe(plates, snapshot)[0].est_cost_per_unit).toBeNull();
    expect(plates[0].est_grams).toBe(999);
  });
  it("counts unique exact materials on this plate only", () => {
    const snapshot = { requirements: [{ plate_id: "a", item_id: "red" }, { plate_id: "a", item_id: "blue" }, { plate_id: "b", item_id: "green" }, { plate_id: "a", item_id: "red" }] };
    expect(jobRecipeMaterialCount({ production_snapshot: snapshot, print_plate_id: "a" })).toBe(2);
    expect(jobRecipeMaterialCount({ production_snapshot: null })).toBe(0);
  });
});
