import { importedComposition, type ImportedComposition } from "./imported-composition";
import { buildImportedPricingPlan, type ImportedPricingPlan } from "./imported-pricing-plan";
import type { ProductExternalImport } from "./makerworld-import";
import { modelPricingFromComposition, modelPricingFromMakerWorld, type ModelPricingEstimate } from "./model-pricing";
import { readPricingTransfer, type PricingInput, type PricingTransfer } from "./print-pricing";

export const PRICING_SOURCE_TRANSFER_TTL_MS = 10 * 60 * 1000;
export const MAX_PRICING_TRANSFER_FILE_BYTES = 80 * 1024 * 1024;
export const MISSING_PRICING_SOURCE_TRANSFER = "Os dados da impressão expiraram ou não estão disponíveis nesta sessão. Volte à precificação e envie novamente, ou escolha informar o custo manualmente.";
export type PricingTransferScope = { tenantId: string; userId: string };
export type PricingTransferCalculation = { printerId: string; quantity: number; materialSelections: Record<string, string> };
export type PricingSourceTransferInput = {
  sourceFile: File | null;
  externalImport: ProductExternalImport | null;
  estimate: ModelPricingEstimate;
  calculated: PricingTransferCalculation;
  pricingInput: PricingInput;
  accepted: PricingTransfer;
};
export type PreparedPricingSourceTransfer = PricingSourceTransferInput & {
  composition: ImportedComposition;
  plan: ImportedPricingPlan;
};

// One transient transfer per browser context. Never serialize the model into
// router history, localStorage or sessionStorage, and never retain credentials.
let pending: { token: string; scope: PricingTransferScope; expires: number; value: PreparedPricingSourceTransfer } | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
const hasControlCharacter = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
function clearPending() {
  pending = null;
  if (expiryTimer != null) clearTimeout(expiryTimer);
  expiryTimer = null;
}
function validScope(scope: PricingTransferScope) {
  return [scope.tenantId, scope.userId].every(value => typeof value === "string" && value.trim() && value.length <= 200 && !hasControlCharacter(value));
}
function estimateIdentity(estimate: ModelPricingEstimate) {
  return JSON.stringify({ hours: estimate.hours, seconds: estimate.timeSeconds, grams: estimate.weightGrams, plates: estimate.plateCount,
    parts: estimate.partCount, materials: estimate.materials.map(material => ({ slot: material.slotId,
      type: material.materialCode?.trim().toUpperCase(), color: material.colorHex?.trim().toUpperCase(),
      grams: material.grams, plates: [...material.plateIndices].sort((a, b) => a - b) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
}

/** Retain the exact source and accepted commercial values together. Validating
 * the source does not recalculate the accepted cost, price or extra expenses. */
export async function createPricingSourceTransfer(scope: PricingTransferScope, input: PricingSourceTransferInput): Promise<string> {
  if (!validScope(scope)) throw new Error("Sua sessão expirou. Entre novamente antes de cadastrar o produto.");
  const sourceScope = { ...scope };
  const operation = ++generation;
  clearPending();
  const accepted = readPricingTransfer(input.accepted);
  if (!accepted) throw new Error("Confira os valores da precificação antes de cadastrar o produto.");
  if (!!input.sourceFile === !!input.externalImport) throw new Error("Escolha um arquivo fatiado ou um perfil MakerWorld antes de cadastrar o produto.");
  // Snapshot the selections before reading the file asynchronously; later edits
  // must not mix another material/printer selection with this accepted price.
  const snapshot = structuredClone({ externalImport: input.externalImport, estimate: input.estimate,
    calculated: input.calculated, pricingInput: input.pricingInput, accepted });
  const sourceFile = input.sourceFile;
  let composition: ImportedComposition;
  let actualEstimate: ModelPricingEstimate;
  if (sourceFile) {
    if (!(sourceFile instanceof File) || !/\.3mf$/i.test(sourceFile.name) || !sourceFile.size || sourceFile.size > MAX_PRICING_TRANSFER_FILE_BYTES
      || sourceFile.name.length > 240 || /[/\\]/.test(sourceFile.name) || hasControlCharacter(sourceFile.name))
      throw new Error("Envie o 3MF fatiado de até 80 MB para manter a preparação no cadastro.");
    const buffer = await sourceFile.arrayBuffer();
    if (buffer.byteLength !== sourceFile.size) throw new Error("O arquivo mudou durante a leitura. Envie novamente o 3MF fatiado.");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const { parseModelFile, disposeModel } = await import("./model-file");
    const model = parseModelFile(new Uint8Array(buffer), sourceFile.name);
    try {
      composition = { ...model.composition, profile_id: `local:${hash}`, file_sha256: hash, file_name: sourceFile.name };
      actualEstimate = modelPricingFromComposition(composition);
    } finally { disposeModel(model.group); }
  } else {
    composition = importedComposition(snapshot.externalImport!)!;
    if (!composition) throw new Error("O perfil MakerWorld não informa todas as placas. Envie o 3MF fatiado para manter a preparação.");
    actualEstimate = modelPricingFromMakerWorld(snapshot.externalImport!);
  }
  const values = (entries: string[]) => JSON.stringify(entries.map(entry => entry.trim().toUpperCase()).sort());
  if (estimateIdentity(actualEstimate) !== estimateIdentity(snapshot.estimate)
    || actualEstimate.printerModelIds.length > 0 && values(actualEstimate.printerModelIds) !== values(snapshot.estimate.printerModelIds)
    || actualEstimate.nozzleDiameters.length > 0 && values(actualEstimate.nozzleDiameters) !== values(snapshot.estimate.nozzleDiameters))
    throw new Error("O arquivo ou perfil mudou desde o cálculo. Confira novamente a precificação antes de cadastrar.");
  const plan = buildImportedPricingPlan(snapshot.estimate, composition, snapshot.calculated, snapshot.externalImport);
  if (operation !== generation) throw new Error("A origem da impressão mudou. Confira a seleção antes de cadastrar.");
  const token = crypto.randomUUID();
  pending = { token, scope: sourceScope, expires: Date.now() + PRICING_SOURCE_TRANSFER_TTL_MS,
    value: { ...snapshot, sourceFile, composition, plan } };
  expiryTimer = setTimeout(() => { if (pending?.token === token) clearPending(); }, PRICING_SOURCE_TRANSFER_TTL_MS);
  return token;
}

/** One successful read removes the retained File. The destination owns that
 * reference only while its product form remains open. */
export function consumePricingSourceTransfer(token: unknown, scope: PricingTransferScope): PreparedPricingSourceTransfer | null {
  if (pending && pending.expires <= Date.now()) clearPending();
  if (!validScope(scope) || typeof token !== "string" || !pending || pending.token !== token
    || pending.scope.tenantId !== scope.tenantId || pending.scope.userId !== scope.userId) return null;
  const value = pending.value;
  clearPending();
  return value;
}

/** Clear on explicit replacement/manual opt-out. A supplied old token cannot
 * erase a newer source that another in-flight operation prepared. */
export function discardPricingSourceTransfer(token?: unknown) {
  if (token !== undefined && pending?.token !== token) return;
  ++generation;
  clearPending();
}
