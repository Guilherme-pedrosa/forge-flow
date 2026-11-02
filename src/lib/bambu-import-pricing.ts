import type { ModelPricingEstimate, ModelPricingMaterial } from "./model-pricing";
import { bambuColor } from "./bambu-material-selection";

export type BambuImportPricingResult = {
  estimate: ModelPricingEstimate | null;
  error: string;
  requiresSingleMaterialConfirmation: boolean;
};
type Options = { printerModel?: string | null; profileId?: string | null };
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
function number(value: unknown): number | null {
  const raw = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : value;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}
const failure = (error: string): BambuImportPricingResult => ({ estimate: null, error, requiresSingleMaterialConfirmation: false });
const positive = (value: number | null, maximum: number): value is number => value != null && value > 0 && value <= maximum;
const tolerance = (grams: number) => Math.max(.1, grams * .01);

function material(row: Row, key: string, plateIndex: number, task: boolean): ModelPricingMaterial | null {
  const code = text(task ? row.targetFilamentType : row.type) ?? text(task ? row.filamentType : row.material_code);
  const color = bambuColor(task ? row.targetColor ?? row.sourceColor : row.color ?? row.color_hex);
  const grams = number(task ? row.weight : row.grams ?? row.used_g ?? row.usedG);
  if (grams == null || grams > 1_000_000) return null;
  return { key, slotId: null, materialCode: code?.toUpperCase() ?? null, colorHex: color,
    grams, plateIndices: [plateIndex], name: [code || "Filamento a identificar", color].filter(Boolean).join(" · ") };
}

/** Task weight/costTime are the slicer's plan for one recorded plate. This
 * adapter never treats history as measured usage or sums another task/profile. */
export function bambuTaskPricing(value: unknown, options: Options = {}): BambuImportPricingResult {
  const task = object(value), raw = object(task.raw_data);
  const grams = number(task.weight_grams ?? raw.weight), seconds = number(task.cost_time_seconds ?? raw.costTime);
  if (!positive(grams, 1_000_000) || !positive(seconds, 31_536_000))
    return failure("A impressão Bambu não informa peso e tempo completos. Envie o 3MF fatiado para calcular o custo.");
  const mappings = list(raw.amsDetailMapping), filaments = list(raw.filaments);
  const records = mappings.length ? mappings : filaments;
  const materials: ModelPricingMaterial[] = [];
  if (records.length) {
    for (const [index, row] of records.entries()) {
      const line = material(row, `bambu-task:${index}`, 1, mappings.length > 0);
      if (!line) {
        if (records.length > 1) return failure("A impressão Bambu não informa os gramas de cada filamento. Envie o 3MF fatiado para conferir o consumo por material.");
        // One explicit mapping can use the one known total; an unknown identity
        // still needs the operator's single-material confirmation in the UI.
        const identified = { ...row, ...(mappings.length ? { weight: grams } : { grams }) };
        materials.push(material(identified, "bambu-task:0", 1, mappings.length > 0)!);
      } else if (line.grams > 0) materials.push(line);
    }
    if (!materials.length || Math.abs(materials.reduce((sum, row) => sum + row.grams, 0) - grams) > tolerance(grams))
      return failure("Os gramas por filamento da Bambu não conferem com o peso da impressão. Envie o 3MF fatiado para revisar o custo.");
    if (materials.length > 1 && materials.some(row => !row.materialCode))
      return failure("A impressão Bambu não identifica todos os materiais. Envie o 3MF fatiado para conferir o consumo por filamento.");
  } else {
    if ((number(raw.numColors) ?? number(raw.colorCount) ?? 0) > 1)
      return failure("A impressão Bambu indica vários filamentos, mas não informa os gramas de cada um. Envie o 3MF fatiado.");
    materials.push({ key: "bambu-task:single-unconfirmed", slotId: null, materialCode: null, colorHex: null,
      grams, plateIndices: [1], name: "Filamento da impressão" });
  }
  const device = object(Array.isArray(task.bambu_devices) ? task.bambu_devices[0] : task.bambu_devices);
  const printer = text(options.printerModel) ?? text(device.model);
  return { error: "", requiresSingleMaterialConfirmation: materials.length === 1 && !materials[0].materialCode,
    estimate: { hours: seconds / 3600, timeSeconds: seconds, weightGrams: grams, plateCount: 1, partCount: null,
      printerModelIds: printer ? [printer] : [], nozzleDiameters: [], materials } };
}

/** Older project rows contain totals summed across alternative profiles. Only
 * an explicitly selected detailed profile or positively identified single
 * profile can supply one pricing plan. */
export function bambuProjectPricing(value: unknown, options: Options = {}): BambuImportPricingResult {
  const project = object(value), profiles = list(project.profiles);
  const profileId = text(options.profileId);
  const selected = profileId ? profiles.find(profile => String(profile.profile_id ?? profile.profileId ?? profile.id) === profileId)
    : profiles.length === 1 ? profiles[0] : null;
  if (profiles.length && !selected) return failure("Escolha um perfil de impressão do projeto Bambu. Os perfis alternativos não podem ser somados no custo.");
  if (!selected) return failure("Este projeto Bambu não identifica um único perfil de impressão. Envie o 3MF fatiado ou importe o perfil pelo link do MakerWorld para calcular o custo.");
  const context = object(selected.context);
  const plates = list(context.plates ?? selected.plates ?? selected.plate_details);
  if (!plates.length) return failure("O perfil Bambu não informa as placas completas. Envie o 3MF fatiado para calcular o custo.");
  const materials: ModelPricingMaterial[] = [];
  let grams = 0, seconds = 0;
  for (const [position, plate] of plates.entries()) {
    const weight = number(plate.weight_grams ?? plate.weight), elapsed = number(plate.time_seconds ?? plate.prediction);
    if (!positive(weight, 1_000_000) || !positive(elapsed, 31_536_000))
      return failure("O perfil Bambu não informa peso e tempo de todas as placas. Envie o 3MF fatiado.");
    const records = list(plate.filaments);
    if (!records.length) return failure("O perfil Bambu não identifica os filamentos das placas. Envie o 3MF fatiado.");
    const rows = records.map((row, index) => material(row, `bambu-project:${position}:${index}`, position + 1, false));
    if (rows.some(row => !row || !row.materialCode))
      return failure("O perfil Bambu não informa o tipo e os gramas de cada filamento. Envie o 3MF fatiado.");
    if (Math.abs(rows.reduce((sum, row) => sum + row!.grams, 0) - weight) > tolerance(weight))
      return failure("Os filamentos do perfil Bambu não conferem com o peso da placa. Envie o 3MF fatiado.");
    materials.push(...rows.filter((row): row is ModelPricingMaterial => !!row && row.grams > 0));
    grams += weight; seconds += elapsed;
  }
  const printer = text(options.printerModel) ?? text(selected.printer_model) ?? text(context.printer_model);
  return { error: "", requiresSingleMaterialConfirmation: false, estimate: {
    hours: seconds / 3600, timeSeconds: seconds, weightGrams: grams, plateCount: plates.length, partCount: null,
    printerModelIds: printer ? [printer] : [], nozzleDiameters: [], materials,
  } };
}
