import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import * as modelFile from "./model-file";
import { modelPricingFromComposition, modelPricingFromMakerWorld } from "./model-pricing";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";
import type { ProductExternalImport } from "./makerworld-import";
import type { PricingInput } from "./print-pricing";
import { consumePricingSourceTransfer, createPricingSourceTransfer, discardPricingSourceTransfer,
  MAX_PRICING_TRANSFER_FILE_BYTES, PRICING_SOURCE_TRANSFER_TTL_MS, type PricingSourceTransferInput } from "./pricing-source-transfer";

const scope = { tenantId: "tenant-a", userId: "user-a" };
const pricingInput: PricingInput = { quantity: 2, hours: 1, watts: 100, kwh: 1, machineHour: 2,
  laborMinutes: 0, laborHour: 20, overhead: 0, failure: 0, margin: 30, target: 0,
  materials: [{ name: "PLA", grams: 100, kgPrice: 80 }], extras: [{ name: "Embalagem especial", cost: 3.75, basis: "unit" }] };
const accepted = { name: "Peça pronta", cost: 17.1234, price: 34.9, quantity: 7, quote: true };
const mesh = '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
function native() {
  const bytes = zipSync({
    "3D/3dmodel.model": strToU8(`<model><resources><object id="1" name="Corpo">${mesh}</object></resources><build><item objectid="1"/></build></model>`),
    "Metadata/slice_info.config": strToU8('<config><header><header_item key="X-BBL-Client-Version" value="02.08.02.61"/></header><plate><metadata key="index" value="1"/><metadata key="prediction" value="14645"/><metadata key="weight" value="61.13"/><metadata key="printer_model_id" value="Bambu Lab A1"/><filament id="1" type="PLA" color="#FF0000" used_g="25.99" used_m="8.71"/><filament id="2" type="PLA" color="#00FF00" used_g="35.14" used_m="11.78"/></plate></config>'),
  });
  const file = new File([bytes], "retorno-real-do-fatiador.3mf", { type: "model/3mf" });
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: vi.fn(async () => bytes.slice().buffer) });
  const parsed = modelFile.parseModelFile(bytes, file.name);
  const estimate = modelPricingFromComposition(parsed.composition);
  modelFile.disposeModel(parsed.group);
  const input: PricingSourceTransferInput = { sourceFile: file, externalImport: null, estimate,
    calculated: { printerId: "a1-escolhida", quantity: 2, materialSelections: Object.fromEntries(estimate.materials.map((material, index) => [material.key, `estoque-${index + 1}`])) },
    pricingInput: structuredClone(pricingInput), accepted: { ...accepted } };
  return { input, file, bytes };
}
function maker(): PricingSourceTransferInput {
  const normalized = normalizeMakerWorldDesign({ id: 123, title: "Peça", instances: [{ id: 10, profileId: 20, title: "Perfil A1",
    extention: { modelInfo: { compatibility: { devProductName: "A1" }, plates: [{ index: 1, weight: 40, prediction: 1800,
      objects: [{ id: 1, name: "Corpo", quantity: 1 }], filaments: [{ id: "red", type: "PLA", color: "#FF0000", usedG: 40 }] }] } } }] });
  const reference: ProductExternalImport = { ...normalized, provider: "makerworld", source_url: "https://makerworld.com/models/123",
    selected_profile_id: "10", selected_instance_id: "10", selected_variant_profile_id: "20", fetched_at: "2026-11-02T12:00:00Z" };
  const estimate = modelPricingFromMakerWorld(reference);
  return { sourceFile: null, externalImport: reference, estimate,
    calculated: { printerId: "a1-escolhida", quantity: 2, materialSelections: { [estimate.materials[0].key]: "estoque-vermelho" } },
    pricingInput: structuredClone(pricingInput), accepted: { ...accepted } };
}
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); discardPricingSourceTransfer(); });
afterEach(() => { discardPricingSourceTransfer(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ephemeral pricing source transfers", () => {
  it("retains the actual sliced File and exact plan without serializing it or recalculating accepted values", async () => {
    const { input, file, bytes } = native();
    const parse = vi.spyOn(modelFile, "parseModelFile"), dispose = vi.spyOn(modelFile, "disposeModel");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const token = await createPricingSourceTransfer(scope, input);
    expect(token).toMatch(/^[\da-f-]{36}$/i);
    const context = consumePricingSourceTransfer(token, scope)!;
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(context.sourceFile).toBe(file);
    expect(context.composition).toMatchObject({ profile_id: `local:${hash}`, file_sha256: hash, file_name: file.name });
    expect(context.plan).toMatchObject({ printer_id: "a1-escolhida", quantity: 2, source_file_sha256: hash,
      plates: [{ index: 1, units_per_plate: 2, lines: [{ item_id: "estoque-1", grams: 25.99 }, { item_id: "estoque-2", grams: 35.14 }] }] });
    expect(context.accepted).toEqual(accepted);
    expect(context.accepted.quantity).toBe(7); // commercial quantity differs from physical profile yield
    expect(context.pricingInput.extras).toEqual(pricingInput.extras);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalledTimes(1);
    expect(storage).not.toHaveBeenCalled();
    expect(consumePricingSourceTransfer(token, scope)).toBeNull();
  });
  it("scopes consumption to both tenant and user and never exposes another session's File", async () => {
    const token = await createPricingSourceTransfer(scope, native().input);
    expect(consumePricingSourceTransfer(token, { ...scope, tenantId: "tenant-b" })).toBeNull();
    expect(consumePricingSourceTransfer(token, { ...scope, userId: "user-b" })).toBeNull();
    expect(consumePricingSourceTransfer(null, scope)).toBeNull();
    expect(consumePricingSourceTransfer(token, scope)?.sourceFile).toBeInstanceOf(File);
  });
  it("automatically releases an expired transfer and retains at most one pending source", async () => {
    vi.useFakeTimers();
    const first = await createPricingSourceTransfer(scope, maker());
    const second = await createPricingSourceTransfer(scope, maker());
    expect(consumePricingSourceTransfer(first, scope)).toBeNull();
    discardPricingSourceTransfer(first); // stale navigation cannot erase its replacement
    expect(consumePricingSourceTransfer(second, scope)).not.toBeNull();
    const expired = await createPricingSourceTransfer(scope, maker());
    vi.advanceTimersByTime(PRICING_SOURCE_TRANSFER_TTL_MS);
    expect(consumePricingSourceTransfer(expired, scope)).toBeNull();
  });
  it("preserves the selected MakerWorld variant and supports explicit manual opt-out", async () => {
    const input = maker(), token = await createPricingSourceTransfer(scope, input);
    const context = consumePricingSourceTransfer(token, scope)!;
    expect(context.sourceFile).toBeNull();
    expect(context.externalImport?.selected_variant_profile_id).toBe("20");
    expect(context.composition.profile_id).toBe("20");
    expect(context.plan.plates[0].lines).toEqual([{ item_id: "estoque-vermelho", grams: 40 }]);
    const discarded = await createPricingSourceTransfer(scope, maker());
    discardPricingSourceTransfer();
    expect(consumePricingSourceTransfer(discarded, scope)).toBeNull();
  });
  it("rejects stale metrics or unmapped materials instead of transferring a prepared-looking product", async () => {
    const changed = native().input;
    changed.estimate.weightGrams += 1;
    await expect(createPricingSourceTransfer(scope, changed)).rejects.toThrow(/mudou desde o cálculo/);
    const wrongPrinter = native().input;
    wrongPrinter.estimate.printerModelIds = ["Bambu Lab P1S"];
    await expect(createPricingSourceTransfer(scope, wrongPrinter)).rejects.toThrow(/mudou desde o cálculo/);
    const missing = native().input;
    missing.calculated.materialSelections = {};
    await expect(createPricingSourceTransfer(scope, missing)).rejects.toThrow(/Confirme cada filamento/);
  });
  it("bounds the retained file and refuses geometry-only or missing source context", async () => {
    const input = maker();
    const oversized = new File(["x"], "grande.3mf");
    Object.defineProperty(oversized, "size", { value: MAX_PRICING_TRANSFER_FILE_BYTES + 1 });
    for (const file of [oversized, new File(["geometry"], "original.stl")])
      await expect(createPricingSourceTransfer(scope, { ...input, externalImport: null, sourceFile: file })).rejects.toThrow(/3MF fatiado/);
    await expect(createPricingSourceTransfer(scope, { ...input, externalImport: null })).rejects.toThrow(/Escolha um arquivo/);
    await expect(createPricingSourceTransfer({ ...scope, userId: "" }, input)).rejects.toThrow(/sessão expirou/);
  });
  it("does not let a slower previous file replace a newer source or survive manual opt-out", async () => {
    const first = native();
    let resolve!: (value: ArrayBuffer) => void;
    Object.defineProperty(first.file, "arrayBuffer", { configurable: true, value: () => new Promise<ArrayBuffer>(done => { resolve = done; }) });
    const preparing = createPricingSourceTransfer(scope, first.input);
    const second = await createPricingSourceTransfer(scope, maker());
    resolve(first.bytes.slice().buffer);
    await expect(preparing).rejects.toThrow(/origem da impressão mudou/);
    expect(consumePricingSourceTransfer(second, scope)?.externalImport).not.toBeNull();
  });
});
