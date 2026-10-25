import { MATERIAL_CODES, normalizeMaterialIdentity } from "./material-identity";
import type { FilamentMaterial } from "./filament-planning";
import type { MaterialColorValue } from "@/components/estoque/MaterialColorPicker";

export type SpoolStockMode = "already_in_stock" | "add_to_stock";
export type SpoolRegistrationDraft = {
  materialMode: "existing" | "new"; itemId: string; materialCode: string; materialDescription: string;
  brand: string; color: MaterialColorValue; costPerKg: string; stockMode: SpoolStockMode;
  weighed: boolean; remaining: string; gross: string; tare: string; initial: string;
  label: string; locationKind: "storage" | "printer" | "ams"; location: string;
  printerId: string; amsUnit: string; amsSlot: string; notes: string;
};
export type SpoolRegistrationResult = {
  spool_id: string; item_id: string; item_created: boolean; net_grams: number;
  stock_mode: SpoolStockMode; stock_before: number; stock_after: number; stock_unit: "g" | "kg";
};

export function newSpoolDraft(hasMaterials: boolean): SpoolRegistrationDraft {
  return { materialMode: hasMaterials ? "existing" : "new", itemId: "", materialCode: "", materialDescription: "", brand: "",
    color: { name: "", code: "", hex: "" }, costPerKg: "", stockMode: "already_in_stock", weighed: false,
    remaining: "", gross: "", tare: "", initial: "1000", label: "", locationKind: "storage", location: "Prateleira",
    printerId: "", amsUnit: "1", amsSlot: "1", notes: "" };
}

function decimal(raw: string, label: string, mass = false) {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized)) || Number(normalized) > 1e9)
    throw new Error(`Informe ${label} com um número maior ou igual a zero.`);
  if (mass && normalized.includes(".") && normalized.split(".")[1].length > 3)
    throw new Error("Informe os pesos com até três casas decimais.");
  return Number(normalized);
}

export function spoolNetGrams(draft: SpoolRegistrationDraft): number {
  if (!draft.weighed) return decimal(draft.remaining, "o filamento restante em gramas", true);
  const gross = decimal(draft.gross, "o peso bruto em gramas", true);
  const tare = decimal(draft.tare, "a tara do carretel em gramas", true);
  if (gross < tare) throw new Error("O peso bruto da balança não pode ser menor que a tara do carretel.");
  return Math.round((gross - tare) * 1000) / 1000;
}

export function existingCostPerKg(item: Pick<FilamentMaterial, "unit"> & { avg_cost?: number | null } | undefined): string {
  const value = Number(item?.avg_cost);
  if (!item || !Number.isFinite(value) || value <= 0) return "";
  return String(Math.round(value * (item.unit.trim().toLowerCase() === "g" ? 1000 : 1) * 1e6) / 1e6);
}

export function registrationStockMode(draft: SpoolRegistrationDraft): SpoolStockMode {
  return draft.materialMode === "new" ? "add_to_stock" : draft.stockMode;
}

export function spoolRegistrationPayload(draft: SpoolRegistrationDraft, items: FilamentMaterial[], printers: { id: string }[]) {
  const item = items.find(candidate => candidate.id === draft.itemId);
  if (draft.materialMode === "existing" && !item) throw new Error("Escolha o filamento cadastrado ou use Filamento novo.");
  if (draft.materialMode === "new" && !MATERIAL_CODES.some(([code]) => code === draft.materialCode)) throw new Error("Escolha o material do filamento, como PLA ou PETG.");
  if (draft.materialMode === "new" && !draft.color.name.trim()) throw new Error("Informe a cor do filamento ou escolha uma cor na paleta.");
  const stockMode = registrationStockMode(draft);
  if (stockMode === "add_to_stock" && !draft.costPerKg.trim()) throw new Error("Informe o custo do filamento em R$/kg. Se não houve custo, informe 0.");
  const cost = stockMode === "add_to_stock" ? decimal(draft.costPerKg, "o custo do filamento em R$/kg") : null;
  const net = spoolNetGrams(draft);
  const initial = decimal(draft.initial, "a capacidade inicial em gramas", true);
  if (initial <= 0 || net > initial) throw new Error("Confira a capacidade inicial em Localização e detalhes: ela deve ser maior que zero e cobrir o filamento restante.");
  if (draft.locationKind !== "storage" && !printers.some(printer => printer.id === draft.printerId)) throw new Error("Selecione a impressora em Localização e detalhes.");
  const ams = Number(draft.amsUnit), slot = Number(draft.amsSlot);
  if (draft.locationKind === "ams" && (!Number.isInteger(ams) || ams < 1 || ams > 16 || !Number.isInteger(slot) || slot < 1 || slot > 4))
    throw new Error("Confira o número do AMS (1 a 16) e o slot (1 a 4) em Localização e detalhes.");
  const identity = draft.materialMode === "new" ? normalizeMaterialIdentity({ materialCode: draft.materialCode,
    description: draft.materialDescription, color: draft.color.name, colorCode: draft.color.code, colorHex: draft.color.hex }) : null;
  return {
    p_item_id: draft.materialMode === "existing" ? draft.itemId : null,
    p_material: identity ? { ...identity, brand: draft.brand.trim() || null } : null,
    p_spool: { label: draft.label.trim(), tare_grams: draft.weighed ? decimal(draft.tare, "a tara", true) : draft.tare.trim() ? decimal(draft.tare, "a tara", true) : 0,
      initial_net_grams: initial, estimated_remaining_grams: draft.weighed ? null : net,
      measured_gross_grams: draft.weighed ? decimal(draft.gross, "o peso bruto", true) : null,
      weight_source: draft.weighed ? "manual_weighing" : "manual_estimate", location_kind: draft.locationKind,
      location_label: draft.location.trim() || "Prateleira", printer_id: draft.locationKind === "storage" ? null : draft.printerId,
      ams_unit: draft.locationKind === "ams" ? ams : null, ams_slot: draft.locationKind === "ams" ? slot : null,
      is_active: true, reason: draft.notes.trim() || "Cadastro de bobina" },
    p_stock_mode: stockMode, p_cost_per_kg: cost,
  };
}

export function readSpoolRegistrationResult(value: unknown): SpoolRegistrationResult {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const unit = String(data.stock_unit ?? "").trim().toLowerCase();
  if (!uuid.test(String(data.spool_id ?? "")) || !uuid.test(String(data.item_id ?? "")) || typeof data.item_created !== "boolean"
    || !["already_in_stock", "add_to_stock"].includes(String(data.stock_mode)) || !["g", "kg"].includes(unit)
    || [data.net_grams, data.stock_before, data.stock_after].some(number => typeof number !== "number" || !Number.isFinite(number) || number < 0))
    throw new Error("O servidor não confirmou o cadastro completo. Tente novamente para conferir a mesma operação.");
  return { ...data, stock_unit: unit } as SpoolRegistrationResult;
}
