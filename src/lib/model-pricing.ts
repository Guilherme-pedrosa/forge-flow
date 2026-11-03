import type { ImportedComposition } from "./imported-composition";
import type { MakerWorldFilament, MakerWorldModel } from "../../supabase/functions/_shared/makerworld";

export type ModelPricingMaterial = {
  key: string;
  slotId: number | null;
  materialCode: string | null;
  colorHex: string | null;
  grams: number;
  plateIndices: number[];
  name: string;
};

export type ModelPricingEstimate = {
  source?: "3mf" | "makerworld";
  hours: number;
  timeSeconds: number;
  weightGrams: number;
  plateCount: number;
  partCount: number | null;
  printerModelIds: string[];
  nozzleDiameters: string[];
  needAms?: boolean | null;
  materials: ModelPricingMaterial[];
};

type Rate = string | number | null | undefined;
const hasRate = (value: Rate) => value != null && (typeof value !== "string" || value.trim() !== "");
function knownRate(value: Rate): number | null {
  if (!hasRate(value)) return null;
  const parsed = typeof value === "string" ? Number(value.trim().replace(",", ".")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Explicit pricing tariffs take priority. Otherwise use the printer's saved
 * depreciation and maintenance; an absent component stays unknown. */
export function printerMachineHourCost(
  printer: { depreciation_per_hour?: Rate; acquisition_cost?: Rate; useful_life_hours?: Rate; maintenance_cost_per_hour?: Rate },
  configuredRate?: Rate,
  companyRate?: Rate,
): number | null {
  if (hasRate(configuredRate)) return knownRate(configuredRate);
  if (hasRate(companyRate)) return knownRate(companyRate);
  let depreciation = knownRate(printer.depreciation_per_hour);
  if (!hasRate(printer.depreciation_per_hour)) {
    const acquisition = knownRate(printer.acquisition_cost), life = knownRate(printer.useful_life_hours);
    depreciation = acquisition != null && life != null && life > 0 ? acquisition / life : null;
  }
  const maintenance = knownRate(printer.maintenance_cost_per_hour);
  return depreciation != null && maintenance != null ? depreciation + maintenance : null;
}

type PrinterIdentity = { brand?: string | null; model?: string | null; name?: string };
const normalizedPrinterModel = (value: string) => value.trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
function bambuModel(value: string): string | null {
  const normalized = normalizedPrinterModel(value);
  // Codes and labels captured together in the MakerWorld reference fixtures.
  const codes: Record<string, string> = { N1: "A1 MINI", N2S: "A1", C11: "P1P", C12: "P1S", C13: "X1E", "BL P001": "X1 CARBON", "BL P002": "X1", O1D: "H2D", O1E: "H2D PRO", O1C2: "H2C" };
  if (codes[normalized]) return codes[normalized];
  const match = normalized.match(/\b(A1\s+MINI|A1|A2L|P1P|P1S|X1\s+CARBON|X1C|X1E|X1|H2D\s+PRO|H2D|H2C)\b/);
  return match ? match[1] === "X1C" ? "X1 CARBON" : match[1] : null;
}

/** Compare model identity, never a printer's friendly label alone when its
 * model is supplied. Unknown metadata requires confirmation by the caller. */
export function printerMatchesSliceModels(printer: PrinterIdentity, models: string[]): boolean | null {
  if (!models.length) return null;
  const selected = bambuModel(printer.model?.trim() || "");
  const matches = models.map(model => {
    const sliced = bambuModel(model);
    if (sliced) {
      if (printer.brand?.trim() && !/bambu/i.test(printer.brand)) return false;
      if (selected) return sliced === selected;
      if (printer.model?.trim()) return false;
    }
    if (printer.model?.trim() && normalizedPrinterModel(printer.model) === normalizedPrinterModel(model)) return true;
    return null;
  });
  if (matches.includes(false)) return false;
  return matches.includes(null) ? null : true;
}

/** Operators choose a registered model. Preserve a saved physical printer as
 * that model's cost representative, without presenting the fleet's nicknames. */
export function printerModelOptions<T extends PrinterIdentity & { id: string; is_active?: boolean }>(
  printers: T[], preferredId?: string | null,
): { id: string; label: string; description?: string }[] {
  const groups = new Map<string, { label: string; printers: T[] }>();
  for (const printer of printers) {
    if (printer.is_active === false || !printer.model?.trim()) continue;
    const label = bambuModel(printer.model) || normalizedPrinterModel(printer.model);
    const key = label;
    const group = groups.get(key);
    if (group) group.printers.push(printer);
    else groups.set(key, { label, printers: [printer] });
  }
  return [...groups.values()].map(group => ({
    id: group.printers.find(printer => printer.id === preferredId)?.id || group.printers.map(printer => printer.id).sort()[0],
    label: group.label,
  })).sort((left, right) => left.label.localeCompare(right.label, "pt-BR") || left.id.localeCompare(right.id));
}

/** Defaults stay visible and editable. Never choose a different machine model
 * merely because its cost or friendly name appears similar. */
export function recommendPrinterForEstimate<T extends PrinterIdentity & { id: string; is_active?: boolean }>(estimate: ModelPricingEstimate, printers: T[]): T | null {
  return printers.filter(printer => printer.is_active !== false && printerMatchesSliceModels(printer, estimate.printerModelIds) === true)
    .sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id, "pt-BR") || left.id.localeCompare(right.id))[0] ?? null;
}

function normalizedColor(value: string | null | undefined): string | null {
  const color = value?.trim().toUpperCase();
  if (!color) return null;
  return /^#[0-9A-F]{6}FF$/.test(color) ? color.slice(0, 7) : color;
}

export function recommendFilamentsForEstimate(
  estimate: ModelPricingEstimate,
  items: { id: string; material_code?: string | null; color_hex?: string | null; is_active?: boolean }[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const multipleColors = new Set(estimate.materials.map(material => normalizedColor(material.colorHex)).filter(Boolean)).size > 1;
  for (const material of estimate.materials) {
    const code = material.materialCode?.trim().toUpperCase();
    if (!code) continue;
    const candidates = items.filter(item => item.is_active !== false && item.material_code?.trim().toUpperCase() === code);
    const color = normalizedColor(material.colorHex);
    const exact = color ? candidates.filter(item => normalizedColor(item.color_hex) === color) : [];
    if (exact.length === 1) result[material.key] = exact[0].id;
    else if (!multipleColors && !exact.length && candidates.length === 1) result[material.key] = candidates[0].id;
  }
  return result;
}

type MakerWorldPricingReference = Pick<MakerWorldModel, "profiles" | "selected_instance_id" | "selected_variant_profile_id"> & { selected_profile_id?: string | null };

/** Published estimates belong to one MakerWorld configuration. Plate and
 * profile totals describe the same job and are never added together. */
export function modelPricingFromMakerWorld(reference: MakerWorldPricingReference): ModelPricingEstimate {
  const selectedId = reference.selected_profile_id ?? reference.selected_instance_id;
  const profile = selectedId ? reference.profiles.find(entry => entry.instance_id === selectedId) : reference.profiles.length === 1 ? reference.profiles[0] : null;
  if (!profile) throw new Error("Escolha a configuração de impressão do MakerWorld.");
  const variants = [profile, ...profile.variants];
  const variant = reference.selected_variant_profile_id ? variants.find(entry => entry.profile_id === reference.selected_variant_profile_id)
    : !profile.variants.length ? profile : null;
  if (!variant) throw new Error("Escolha a impressora da configuração do MakerWorld.");
  const positive = (value: number | null, max: number): value is number => value != null && Number.isFinite(value) && value > 0 && value <= max;
  const validCount = (value: number | null | undefined): value is number => value != null && Number.isInteger(value) && value > 0 && value <= 10000;
  const tolerance = (weight: number) => Math.max(0.1, weight * 0.01);
  const complete = (materials: MakerWorldFilament[]) => materials.length > 0 && materials.every(material => material.grams != null && Number.isFinite(material.grams) && material.grams >= 0 && material.grams <= 1_000_000);
  const singleMaterial = (materials: MakerWorldFilament[]) => {
    if (!materials.length || materials.some(material => !material.type?.trim())) return null;
    const identities = new Set(materials.map(material => JSON.stringify([material.type!.trim().toUpperCase(), normalizedColor(material.color)])));
    return identities.size === 1 ? materials[0] : null;
  };
  const declaredPlates = variant.plates;
  const plates = variant.plate_details;
  let timeSeconds = 0, weightGrams = 0, partCount: number | null = 0;
  const plateIndices: number[] = [];
  if (plates.length) {
    if (declaredPlates != null && declaredPlates !== plates.length)
      throw new Error("O MakerWorld não informou todas as placas. Importe o 3MF fatiado.");
    for (const [position, plate] of plates.entries()) {
      const index = validCount(plate.index) ? plate.index : position + 1;
      if (plateIndices.includes(index)) throw new Error("O MakerWorld retornou placas repetidas. Importe o 3MF fatiado.");
      plateIndices.push(index);
      if (!positive(plate.weight_grams, 1_000_000) || !positive(plate.time_seconds, 31_536_000))
        throw new Error("O MakerWorld não informou peso e tempo de todas as placas. Importe o 3MF fatiado.");
      timeSeconds += plate.time_seconds;
      weightGrams += plate.weight_grams;
      if (!plate.objects.length || plate.objects.some(object => !validCount(object.quantity))) partCount = null;
      else if (partCount != null) partCount += plate.objects.reduce((sum, object) => sum + object.quantity!, 0);
      if (complete(plate.filaments) && Math.abs(plate.filaments.reduce((sum, filament) => sum + filament.grams!, 0) - plate.weight_grams) > tolerance(plate.weight_grams))
        throw new Error("O consumo de filamentos do MakerWorld não confere com o peso da placa. Importe o 3MF fatiado.");
    }
  } else {
    if (!validCount(declaredPlates) || !positive(variant.weight_grams, 1_000_000) || !positive(variant.time_seconds, 31_536_000))
      throw new Error("O MakerWorld não informou peso, tempo e placas completos. Importe o 3MF fatiado.");
    timeSeconds = variant.time_seconds; weightGrams = variant.weight_grams; partCount = null;
  }
  const materials = new Map<string, ModelPricingMaterial>();
  function add(material: MakerWorldFilament, grams: number, indices: number[]) {
    if (!material.type?.trim()) throw new Error("O MakerWorld não identifica o tipo do filamento. Importe o 3MF fatiado.");
    if (!grams) return;
    const materialCode = material.type.trim().toUpperCase(), colorHex = normalizedColor(material.color);
    const key = JSON.stringify(["makerworld", materialCode, colorHex]);
    const previous = materials.get(key);
    if (previous) { previous.grams += grams; previous.plateIndices = [...new Set([...previous.plateIndices, ...indices])]; }
    else materials.set(key, { key, slotId: null, materialCode, colorHex, grams, plateIndices: indices,
      name: [materialCode, colorHex].filter(Boolean).join(" · ") });
  }
  const perPlate = plates.length > 0 && plates.every(plate => complete(plate.filaments) || singleMaterial(plate.filaments));
  const profileCoversObservedMaterials = () => plates.every(plate => plate.filaments.every(observed =>
    variant.filaments.some(declared => (!observed.type?.trim() || observed.type.trim().toUpperCase() === declared.type?.trim().toUpperCase())
      && (!normalizedColor(observed.color) || normalizedColor(observed.color) === normalizedColor(declared.color)))));
  if (perPlate) {
    for (const [position, plate] of plates.entries()) {
      if (complete(plate.filaments)) for (const material of plate.filaments) add(material, material.grams!, [plateIndices[position]]);
      else add(singleMaterial(plate.filaments)!, plate.weight_grams!, [plateIndices[position]]);
    }
  } else if (complete(variant.filaments)) {
    if (!profileCoversObservedMaterials())
      throw new Error("Os materiais das placas diferem do total informado pelo MakerWorld. Importe o 3MF fatiado.");
    const total = variant.filaments.reduce((sum, material) => sum + material.grams!, 0);
    if (Math.abs(total - weightGrams) > tolerance(weightGrams))
      throw new Error("O consumo dos filamentos do perfil MakerWorld não confere com o peso total. Importe o 3MF fatiado.");
    for (const material of variant.filaments) add(material, material.grams!, []);
  } else {
    const single = singleMaterial(variant.filaments);
    if (!single || !profileCoversObservedMaterials()) throw new Error("O MakerWorld não informa os gramas de cada material. Importe o 3MF fatiado para calcular o custo.");
    add(single, weightGrams, plateIndices);
  }
  if (!materials.size) throw new Error("O MakerWorld não informou consumo de filamento. Importe o 3MF fatiado.");
  return {
    source: "makerworld", hours: timeSeconds / 3600, timeSeconds, weightGrams,
    plateCount: plates.length || declaredPlates!, partCount,
    printerModelIds: variant.printer_model ? [variant.printer_model] : variant.printer_code ? [variant.printer_code] : [],
    nozzleDiameters: variant.nozzle_diameter != null ? [String(variant.nozzle_diameter)] : [],
    needAms: profile.need_ams,
    materials: [...materials.values()],
  };
}

/** Read a complete native slice plan. Geometry, part copies and plate yield do
 * not determine the number of finished products; the caller supplies that. */
export function modelPricingFromComposition(composition: ImportedComposition): ModelPricingEstimate {
  if (!composition.plates.length) throw new Error("O arquivo não contém placas para precificar.");
  const materials = new Map<string, ModelPricingMaterial>();
  const indices = new Set<number>(), printers = new Set<string>(), nozzles = new Set<string>();
  let timeSeconds = 0, weightGrams = 0, partCount: number | null = 0;
  for (const plate of composition.plates) {
    if (!Number.isInteger(plate.index) || plate.index < 1 || indices.has(plate.index))
      throw new Error("O arquivo contém índices de placas inválidos ou repetidos.");
    indices.add(plate.index);
    if (!plate.parts.length || plate.parts.some(part => part.quantity_per_plate == null || !Number.isInteger(part.quantity_per_plate) || part.quantity_per_plate < 1)) partCount = null;
    else if (partCount != null) partCount += plate.parts.reduce((sum, part) => sum + part.quantity_per_plate!, 0);
    const estimates = plate.slicer_estimates;
    if (!estimates || estimates.source !== "3mf_slice_info")
      throw new Error(`A placa ${plate.index} precisa ser fatiada para calcular tempo e filamento.`);
    const validPositive = (value: number | null, maximum: number) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum;
    if (!validPositive(plate.time_seconds, 31_536_000) || !validPositive(plate.weight_grams, 1_000_000))
      throw new Error(`O fatiamento da placa ${plate.index} não informa tempo e peso completos.`);
    if (!estimates.filaments.length)
      throw new Error(`O fatiamento da placa ${plate.index} não informa o consumo por filamento.`);
    if (estimates.printer_model_id) printers.add(estimates.printer_model_id);
    if (estimates.nozzle_diameters) nozzles.add(estimates.nozzle_diameters);
    const slots = new Set<number>();
    let filamentGrams = 0;
    for (const filament of estimates.filaments) {
      if (!Number.isInteger(filament.id) || filament.id < 1 || slots.has(filament.id))
        throw new Error(`O fatiamento da placa ${plate.index} contém slots inválidos ou repetidos.`);
      slots.add(filament.id);
      if (typeof filament.weight_grams !== "number" || !Number.isFinite(filament.weight_grams) || filament.weight_grams < 0 || filament.weight_grams > 1_000_000)
        throw new Error(`O fatiamento da placa ${plate.index} não informa os gramas do filamento ${filament.id}.`);
      filamentGrams += filament.weight_grams;
      // A zero explicitly supplied by the slicer is an unused slot, not an
      // unknown consumption. Keep unknown values above from becoming zero.
      if (filament.weight_grams === 0) continue;
      const materialCode = filament.material_code?.trim().toUpperCase() || null;
      const colorHex = filament.color_hex?.trim().toUpperCase() || null;
      const key = JSON.stringify([filament.id, materialCode, colorHex]);
      const existing = materials.get(key);
      if (existing) {
        existing.grams += filament.weight_grams;
        existing.plateIndices.push(plate.index);
      } else materials.set(key, {
        key, slotId: filament.id, materialCode, colorHex,
        grams: filament.weight_grams, plateIndices: [plate.index],
        name: [materialCode || "Filamento", `slot ${filament.id}`, colorHex].filter(Boolean).join(" · "),
      });
    }
    // Native metadata rounds grams per slot. Larger differences can hide purge,
    // supports or missing slots and must be resolved by slicing the file again.
    if (Math.abs(filamentGrams - plate.weight_grams!) > Math.max(0.1, plate.weight_grams! * 0.01))
      throw new Error(`O consumo dos filamentos da placa ${plate.index} não confere com o peso total. Fatie o arquivo novamente.`);
    if (filamentGrams <= 0)
      throw new Error(`O fatiamento da placa ${plate.index} não informa consumo de filamento.`);
    timeSeconds += plate.time_seconds!;
    weightGrams += plate.weight_grams!;
  }
  return {
    hours: timeSeconds / 3600, timeSeconds, weightGrams,
    plateCount: composition.plates.length, partCount,
    printerModelIds: [...printers], nozzleDiameters: [...nozzles],
    needAms: null,
    materials: [...materials.values()],
  };
}
