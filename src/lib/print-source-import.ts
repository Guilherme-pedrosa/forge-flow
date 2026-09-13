import { externalImportReference, fetchMakerWorldModel, type ProductExternalImport } from "./makerworld-import";
import { parseMakerWorldUrl, type MakerWorldModel, type MakerWorldProfile, type MakerWorldVariant } from "../../supabase/functions/_shared/makerworld";

export interface PrintSourceImportIdentity {
  source_url?: string | null;
  design_id?: string | null; instance_id?: string | null; model_id?: string | null;
  profile_id?: string | null; plate_index?: number | null;
}
export interface PrintSourceImportTask {
  id?: string; bambu_task_id?: string; raw_data?: unknown;
  weight_grams?: number | string | null; cost_time_seconds?: number | null;
  status?: string | null; start_time?: string | null; end_time?: string | null;
}
export class PrintSourceImportError extends Error {
  constructor(message: string, public readonly code: "identity_mismatch" | "profile_choice_required" | "metadata_unavailable", public readonly model?: MakerWorldModel) {
    super(message); this.name = "PrintSourceImportError";
  }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function id(value: unknown, label: string): string | null {
  if (value == null || value === "" || value === 0 || value === "0") return null;
  const normalized = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof normalized !== "string" || !/^[1-9]\d{0,18}$/.test(normalized)) throw new PrintSourceImportError(`${label} inválido na referência da impressão.`, "identity_mismatch");
  return normalized;
}
function modelId(value: unknown): string | null {
  if (value == null || value === "" || value === "0" || value === 0) return null;
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new PrintSourceImportError("Model ID inválido na referência da impressão.", "identity_mismatch");
  return value;
}
function plateIndex(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0 || number > 10000) throw new PrintSourceImportError("Índice da placa inválido na impressão.", "identity_mismatch");
  return number;
}
function mergeIdentity<T>(first: T | null, second: T | null, label: string): T | null {
  if (first !== null && second !== null && first !== second) throw new PrintSourceImportError(`${label} da fonte e da impressão não correspondem. Vincule o arquivo correto antes de importar as placas.`, "identity_mismatch");
  return first ?? second;
}
export function getPrintSourceImportIdentity(source: PrintSourceImportIdentity, task?: PrintSourceImportTask) {
  const raw = object(task?.raw_data);
  let linkedDesign: string | null = null;
  let linkedInstance: string | null = null;
  if (source.source_url) {
    try {
      const parsed = parseMakerWorldUrl(source.source_url);
      linkedDesign = parsed.designId; linkedInstance = parsed.instanceId;
    } catch { /* Other providers and private uploaded files can be linked to a public Bambu task. */ }
  }
  return {
    design_id: mergeIdentity(mergeIdentity(id(source.design_id, "Design ID"), linkedDesign, "Design ID do link"), id(raw.designId, "Design ID"), "Design ID"),
    instance_id: mergeIdentity(mergeIdentity(id(source.instance_id, "Instance ID"), linkedInstance, "Perfil público do link"), id(raw.instanceId, "Instance ID"), "Perfil público"),
    model_id: mergeIdentity(modelId(source.model_id), modelId(raw.modelId), "Model ID"),
    profile_id: mergeIdentity(id(source.profile_id, "Profile ID"), id(raw.profileId, "Profile ID"), "Perfil técnico"),
    // A source represents the complete profile; its stored index records the
    // last binding. Another task of the same profile can identify another plate.
    plate_index: plateIndex(raw.plateIndex) ?? plateIndex(source.plate_index),
  };
}
const choices = (profiles: MakerWorldProfile[]) => profiles.flatMap((profile, profileIndex) =>
  [profile, ...profile.variants].map(variant => ({ profile, profileIndex, variant })));

/** Resolve identities only. Never chooses by product title, printer name or array position. */
export function resolvePrintSourceImport(model: MakerWorldModel, source: PrintSourceImportIdentity, task?: PrintSourceImportTask): ProductExternalImport {
  const observed = getPrintSourceImportIdentity(source, task);
  if ((observed.design_id && observed.design_id !== model.design_id) || model.id !== model.design_id ||
      (observed.model_id && observed.model_id !== model.model_id)) {
    throw new PrintSourceImportError("O projeto público não corresponde aos identificadores da fonte vinculada.", "identity_mismatch");
  }
  let candidates = choices(model.profiles);
  const instance = observed.instance_id ?? (observed.profile_id ? null : model.selected_instance_id);
  const technical = observed.profile_id ?? model.selected_variant_profile_id;
  if (instance) candidates = candidates.filter(candidate => candidate.profile.instance_id === instance);
  if (technical) candidates = candidates.filter(candidate => candidate.variant.profile_id === technical);
  if (candidates.length === 0) throw new PrintSourceImportError("O perfil público ou a configuração da impressora vinculada não está disponível neste projeto. Confira o arquivo usado na impressão.", "metadata_unavailable");
  if (candidates.length !== 1 || (!instance && !technical && model.profiles.length > 1)) {
    throw new PrintSourceImportError("Escolha o perfil e a configuração da impressora para importar as placas. O link não identifica uma configuração única.", "profile_choice_required", model);
  }
  const selected = candidates[0];
  validatePlates(selected.variant, observed.plate_index);
  const reference = externalImportReference(model, `https://makerworld.com/en/models/${model.design_id}`, selected.profileIndex);
  reference.selected_variant_profile_id = selected.variant.profile_id;
  return reference;
}

function validatePlates(variant: MakerWorldVariant, observed: number | null) {
  if (!variant.profile_id || variant.plate_details.length === 0) throw new PrintSourceImportError("A configuração identificada não forneceu o detalhamento das placas. Vincule o arquivo 3MF ou confira os dados da impressão.", "metadata_unavailable");
  if (variant.plates != null && variant.plates !== variant.plate_details.length) throw new PrintSourceImportError("A origem informou mais placas do que os detalhes disponíveis. Confira o arquivo completo antes de preencher a produção.", "metadata_unavailable");
  const indexes = variant.plate_details.map(plate => plate.index);
  if (indexes.some(index => index == null || !Number.isSafeInteger(index) || index < 0) || new Set(indexes).size !== indexes.length) {
    throw new PrintSourceImportError("O arquivo não forneceu índices únicos para todas as placas. Revise a origem antes de preencher a produção.", "metadata_unavailable");
  }
  if (observed !== null && !indexes.includes(observed)) throw new PrintSourceImportError("A placa registrada na impressão não existe na configuração identificada. Os índices não foram alterados automaticamente.", "identity_mismatch");
}

/** Reuses the authenticated, bounded public import RPC; no Bambu credential is sent. */
export async function fetchPrintSourceImport(source: PrintSourceImportIdentity, task?: PrintSourceImportTask, signal?: AbortSignal): Promise<ProductExternalImport> {
  signal?.throwIfAborted();
  const observed = getPrintSourceImportIdentity(source, task);
  if (!observed.design_id) throw new PrintSourceImportError("Esta fonte não identifica um projeto público do MakerWorld. Os dados disponíveis são os da placa registrada no histórico Bambu.", "metadata_unavailable");
  const url = `https://makerworld.com/en/models/${observed.design_id}${observed.instance_id ? `#profileId-${observed.instance_id}` : ""}`;
  const model = await fetchMakerWorldModel(url, signal);
  signal?.throwIfAborted();
  return resolvePrintSourceImport(model, source, task);
}
