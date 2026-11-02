import { selectedImportVariant, type ImportedComponent, type ImportedComposition, type ImportedPart, type ImportedSlicerEstimates } from "./imported-composition";
import type { ProductExternalImport } from "./makerworld-import";
import type { ModelPricingEstimate, ModelPricingMaterial } from "./model-pricing";

export type ImportedPricingPlan = {
  version: 1;
  printer_id: string;
  quantity: number;
  source_profile_id: string;
  source_id?: string;
  source_file_sha256?: string;
  materials: { source_key: string; item_id: string; material_code: string | null; color_hex: string | null; slot_id: number | null }[];
  plates: { index: number; units_per_plate: number; lines: { item_id: string; grams: number }[] }[];
};

type Calculation = { printerId: string; quantity: number; materialSelections: Record<string, string>; sourceId?: string | null };
const code = (value: string | null | undefined) => value?.trim().toUpperCase() || null;
const color = (value: string | null | undefined) => {
  const normalized = code(value);
  return normalized && /^#[0-9A-F]{6}FF$/.test(normalized) ? normalized.slice(0, 7) : normalized;
};
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const tolerance = (grams: number) => Math.max(0.1, grams * .01);
const sameIdentity = (material: ModelPricingMaterial, type: string | null | undefined, hex: string | null | undefined) =>
  code(material.materialCode) === code(type) && color(material.colorHex) === color(hex);

/** Preserve choices per native plate. A profile total cannot allocate a mixed
 * material across plates when the source omitted that distribution. */
export function buildImportedPricingPlan(estimate: ModelPricingEstimate, composition: ImportedComposition, calculated: Calculation, reference?: ProductExternalImport | null): ImportedPricingPlan {
  if (!calculated.printerId.trim()) throw new Error("Selecione a impressora antes de salvar a preparação.");
  if (!Number.isInteger(calculated.quantity) || calculated.quantity < 1 || calculated.quantity > 10000)
    throw new Error("Confirme quantos produtos completos este perfil produz.");
  if (!composition.profile_id.trim() || !composition.plates.length || composition.plates.length !== estimate.plateCount)
    throw new Error("As placas da preparação não correspondem ao perfil calculado.");
  const keys = new Set<string>();
  for (const material of estimate.materials) {
    if (!material.key || keys.has(material.key) || !positive(material.grams) || !calculated.materialSelections[material.key]?.trim())
      throw new Error("Confirme cada filamento usado no cálculo antes de salvar a preparação.");
    keys.add(material.key);
  }
  if (!keys.size) throw new Error("O perfil não informou os filamentos usados.");
  const variant = reference ? selectedImportVariant(reference) : null;
  if (reference && (!variant || variant.profile_id !== composition.profile_id))
    throw new Error("A preparação e a referência MakerWorld pertencem a perfis diferentes.");
  const indices = new Set<number>();
  const allocated = new Map<string, number>();
  let totalWeight = 0, totalSeconds = 0;
  const plates = composition.plates.map(plate => {
    if (!Number.isInteger(plate.index) || plate.index < 1 || indices.has(plate.index) || !positive(plate.weight_grams) || !positive(plate.time_seconds))
      throw new Error("O perfil precisa informar índice, tempo e peso de todas as placas.");
    indices.add(plate.index); totalWeight += plate.weight_grams; totalSeconds += plate.time_seconds;
    const amounts = new Map<string, number>();
    const add = (material: ModelPricingMaterial, grams: number) => {
      if (!positive(grams) || grams > 1_000_000) throw new Error("O consumo de um filamento da placa é inválido.");
      const item = calculated.materialSelections[material.key];
      amounts.set(item, (amounts.get(item) ?? 0) + grams);
      allocated.set(material.key, (allocated.get(material.key) ?? 0) + grams);
    };
    const find = (type: string | null | undefined, hex: string | null | undefined, slotId?: number) => {
      const matches = estimate.materials.filter(material => sameIdentity(material, type, hex)
        && (slotId === undefined || material.slotId === slotId)
        && (!material.plateIndices.length || material.plateIndices.includes(plate.index)));
      if (matches.length !== 1) throw new Error("Um filamento da placa não corresponde ao cálculo confirmado.");
      return matches[0];
    };
    if (plate.slicer_estimates) {
      const slots = new Set<number>();
      for (const filament of plate.slicer_estimates.filaments) {
        if (!Number.isInteger(filament.id) || filament.id < 1 || slots.has(filament.id)
          || filament.weight_grams == null || !Number.isFinite(filament.weight_grams) || filament.weight_grams < 0)
          throw new Error("O fatiamento não informa os gramas de cada filamento da placa.");
        slots.add(filament.id);
        if (filament.weight_grams > 0) add(find(filament.material_code, filament.color_hex, filament.id), filament.weight_grams);
      }
    } else {
      if (estimate.source !== "makerworld") throw new Error("A placa precisa dos dados de cada filamento do 3MF fatiado.");
      const sourcePlate = variant?.plate_details.find(value => value.index === plate.index);
      if (sourcePlate && (sourcePlate.weight_grams !== plate.weight_grams || sourcePlate.time_seconds !== plate.time_seconds))
        throw new Error("As estimativas da placa mudaram desde o cálculo. Atualize o perfil.");
      const sourceMaterials = sourcePlate?.filaments ?? [];
      if (sourceMaterials.length && sourceMaterials.every(material => material.grams != null && Number.isFinite(material.grams) && material.grams >= 0)) {
        for (const material of sourceMaterials) if (material.grams! > 0) add(find(material.type, material.color), material.grams!);
      } else {
        const known = sourceMaterials.filter(material => material.type?.trim());
        const identities = new Set(known.map(material => JSON.stringify([code(material.type), color(material.color)])));
        if (sourceMaterials.length && (known.length !== sourceMaterials.length || identities.size !== 1))
          throw new Error("O perfil não informa os gramas de cada cor por placa. Importe o 3MF fatiado.");
        const only = known.length ? find(known[0].type, known[0].color)
          : estimate.materials.length === 1 && estimate.materials[0].materialCode
            ? find(estimate.materials[0].materialCode, estimate.materials[0].colorHex) : null;
        if (!only) throw new Error("Não é possível distribuir os materiais do perfil entre as placas. Importe o 3MF fatiado.");
        add(only, plate.weight_grams);
      }
    }
    const sum = [...amounts.values()].reduce((total, grams) => total + grams, 0);
    if (!amounts.size || Math.abs(sum - plate.weight_grams) > tolerance(plate.weight_grams))
      throw new Error("Os gramas da preparação não conferem com o peso da placa.");
    return { index: plate.index, units_per_plate: calculated.quantity,
      lines: [...amounts].sort(([left], [right]) => left.localeCompare(right)).map(([item_id, grams]) => ({ item_id, grams: Number(grams.toFixed(9)) })) };
  });
  if (Math.abs(totalWeight - estimate.weightGrams) > tolerance(totalWeight) || Math.abs(totalSeconds - estimate.timeSeconds) > .001)
    throw new Error("As estimativas do perfil mudaram desde o cálculo. Atualize a preparação.");
  for (const material of estimate.materials) if (Math.abs((allocated.get(material.key) ?? 0) - material.grams) > tolerance(material.grams))
    throw new Error("O consumo por material não corresponde ao perfil calculado.");
  if (composition.file_sha256 && !/^[a-f0-9]{64}$/.test(composition.file_sha256)) throw new Error("O arquivo da preparação precisa ter um SHA-256 válido.");
  if (composition.file_sha256 && composition.profile_id.startsWith("local:") && composition.profile_id !== `local:${composition.file_sha256}`)
    throw new Error("O perfil local precisa corresponder ao arquivo 3MF usado no cálculo.");
  return { version: 1, printer_id: calculated.printerId, quantity: calculated.quantity, source_profile_id: composition.profile_id,
    ...(calculated.sourceId ? { source_id: calculated.sourceId } : {}),
    ...(composition.file_sha256 ? { source_file_sha256: composition.file_sha256 } : {}),
    materials: estimate.materials.map(material => ({ source_key: material.key, item_id: calculated.materialSelections[material.key],
      material_code: material.materialCode, color_hex: material.colorHex, slot_id: material.slotId })), plates };
}

type SavedSource = { id?: string; profile_id?: string | null; file_sha256?: string | null; file_path?: string | null; file_name?: string | null };
type SavedPlate = { id?: string; source_id?: string | null; plate_index: number; label?: string | null; units_per_plate?: number | null;
  est_grams?: number | null; est_time_seconds?: number | null; imported_plate_metadata?: unknown; imported_filaments?: unknown; is_active?: boolean };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const optionalNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const optionalCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10000 ? value : null;

/** Restore only metadata that was actually saved. Missing physical part counts
 * remain unknown; a file's shape or color never invents finished-product yield. */
export function savedPlatesToComposition(source: SavedSource, values: SavedPlate[]): ImportedComposition {
  const plates = values.filter(plate => plate.is_active !== false && (!source.id || plate.source_id === source.id));
  if (!plates.length) throw new Error("Esta fonte não possui placas salvas para conferir a preparação.");
  const profiles = new Set(plates.map(plate => {
    const metadata = object(plate.imported_plate_metadata);
    return text(metadata.file_profile_id) || text(metadata.local_file_hash) || text(metadata.profile_id);
  }).filter((value): value is string => !!value));
  const profile = source.profile_id || (profiles.size === 1 ? [...profiles][0] : null);
  if (!profile || profiles.size > 1 || [...profiles].some(value => value !== profile))
    throw new Error("As placas salvas não identificam um único perfil de impressão.");
  const hashes = new Set([source.file_sha256, ...plates.map(plate => text(object(plate.imported_plate_metadata).file_sha256))].filter((value): value is string => !!value));
  if (hashes.size > 1 || [...hashes].some(value => !/^[a-f0-9]{64}$/.test(value)))
    throw new Error("As placas salvas não pertencem ao mesmo arquivo 3MF.");
  const restored: ImportedComponent[] = plates.map(plate => {
    const metadata = object(plate.imported_plate_metadata), raw = object(metadata.plate);
    const slicer = object(metadata.slicer_estimates);
    let slicerEstimates: ImportedSlicerEstimates | undefined;
    if (slicer.source === "3mf_slice_info" && Array.isArray(slicer.filaments)) {
      slicerEstimates = { source: "3mf_slice_info", slicer_version: text(slicer.slicer_version), printer_model_id: text(slicer.printer_model_id),
        nozzle_diameters: text(slicer.nozzle_diameters), filaments: slicer.filaments.map(value => { const filament = object(value); return {
          id: Number(filament.id), material_code: text(filament.material_code), color_hex: text(filament.color_hex),
          weight_grams: optionalNumber(filament.weight_grams), length_meters: optionalNumber(filament.length_meters),
        }; }) };
    }
    const rawParts = Array.isArray(raw.parts) ? raw.parts : Array.isArray(raw.objects) ? raw.objects : [];
    const parts: ImportedPart[] = rawParts.map((value, index) => { const part = object(value); return {
      source_key: text(part.source_key) || `saved:${plate.plate_index}:${text(part.id) || index + 1}`,
      name: text(part.name) || `Peça ${index + 1}`, photo_url: null, name_source: "source",
      quantity_per_plate: optionalCount(part.quantity_per_plate) ?? optionalCount(part.quantity), quantity_per_product: optionalCount(part.quantity_per_product),
    }; });
    if (!parts.length) parts.push({ source_key: `saved:plate:${plate.plate_index}`, name: plate.label || `Placa ${plate.plate_index}`,
      photo_url: null, name_source: "unknown", quantity_per_plate: null, quantity_per_product: null });
    return { index: plate.plate_index, label: plate.label || `Placa ${plate.plate_index}`, photo_url: null,
      units_per_plate: optionalCount(plate.units_per_plate), weight_grams: optionalNumber(metadata.slicer_weight_grams) ?? optionalNumber(raw.weight_grams) ?? plate.est_grams ?? null,
      time_seconds: optionalNumber(metadata.slicer_time_seconds) ?? optionalNumber(raw.time_seconds) ?? plate.est_time_seconds ?? null, parts,
      ...(slicerEstimates ? { slicer_estimates: slicerEstimates } : {}) };
  });
  return { profile_id: profile, enabled: restored.length > 1 || restored.some(plate => plate.parts.length > 1), plates: restored.sort((a, b) => a.index - b.index),
    ...(hashes.size ? { file_sha256: [...hashes][0] } : {}), ...(source.file_path ? { file_path: source.file_path } : {}), ...(source.file_name ? { file_name: source.file_name } : {}) };
}
