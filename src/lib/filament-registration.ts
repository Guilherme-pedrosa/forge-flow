import { MATERIAL_CODES, normalizeMaterialIdentity } from "./material-identity";
import type { MaterialColorValue } from "@/components/estoque/MaterialColorPicker";

export type FilamentRegistrationItem = {
  id: string; unit: string; current_stock: number; avg_cost?: number | null; name?: string | null;
  material_code?: string | null; material_description?: string | null; material_type?: string | null;
  color?: string | null; color_code?: string | null; color_hex?: string | null; brand?: string | null;
  sku?: string | null; diameter?: number | null; notes?: string | null;
};
export type FilamentRegistrationDraft = {
  materialCode: string; materialDescription: string; color: MaterialColorValue; brand: string;
  quantity: string; quantityUnit: "g" | "kg"; costPerKg: string; name: string; sku: string; diameter: string; notes: string;
};

function inputNumber(value: number): string {
  const raw = String(value);
  if (!/[eE]/.test(raw)) return raw;
  const [coefficient, exponent] = raw.toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = whole + fraction, point = whole.length + Number(exponent);
  return point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length
    ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
}

export function filamentName(draft: Pick<FilamentRegistrationDraft, "materialCode" | "materialDescription" | "color" | "brand">): string {
  const material = draft.materialCode === "OTHER" ? draft.materialDescription.trim()
    : MATERIAL_CODES.find(([code]) => code === draft.materialCode)?.[1] || draft.materialCode;
  return [material, draft.color.name.trim(), draft.brand.trim()].filter(Boolean).join(" ");
}
export function newFilamentDraft(item?: FilamentRegistrationItem | null, defaults?: Partial<FilamentRegistrationItem>): FilamentRegistrationDraft {
  if (item) defaults = undefined;
  const draft: FilamentRegistrationDraft = {
    materialCode: item ? item.material_code ?? "" : defaults?.material_code || "PLA", materialDescription: item?.material_description ?? defaults?.material_description ?? "",
    color: { name: item?.color ?? "", code: item?.color_code ?? "", hex: item?.color_hex ?? "" }, brand: item?.brand ?? defaults?.brand ?? "",
    quantity: inputNumber(item?.current_stock ?? 0), quantityUnit: item?.unit.trim().toLowerCase() === "g" ? "g" : "kg",
    costPerKg: item?.avg_cost == null ? "" : inputNumber(item.avg_cost * (item.unit.trim().toLowerCase() === "g" ? 1000 : 1)),
    name: "", sku: item?.sku ?? "", diameter: item ? item.diameter == null ? "" : String(item.diameter) : String(defaults?.diameter ?? 1.75), notes: item?.notes ?? "",
  };
  if (item?.name && item.name !== filamentName(draft)) draft.name = item.name;
  return draft;
}

function amount(raw: string, label: string, allowEmpty = false): number {
  if (allowEmpty && !raw.trim()) return 0;
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized)) || Number(normalized) > 1e9)
    throw new Error(`Informe ${label} com um número maior ou igual a zero.`);
  return Number(normalized);
}
export function filamentColorCode(color: string): string {
  const normalized = color.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const code = normalized.replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return code.slice(0, 64) || `COR-${[...normalized].map(character => character.codePointAt(0)!.toString(16)).join("-").slice(0, 50)}`;
}
export function filamentRegistrationPayload(draft: FilamentRegistrationDraft, item?: FilamentRegistrationItem | null) {
  if (!MATERIAL_CODES.some(([code]) => code === draft.materialCode && code !== "RESIN"))
    throw new Error("Escolha o material do filamento, como PLA ou PETG.");
  if (!draft.color.name.trim()) throw new Error("Informe a cor do filamento.");
  if (!["g", "kg"].includes(draft.quantityUnit)) throw new Error("Informe o saldo em gramas ou quilos.");
  const savedUnit = item?.unit.trim().toLowerCase();
  if (item && (!["g", "kg"].includes(savedUnit!) || savedUnit !== draft.quantityUnit))
    throw new Error("A unidade do filamento cadastrado não pode ser alterada.");
  const unit = item ? savedUnit! : "g";
  const enteredQuantity = amount(draft.quantity, "a quantidade em estoque");
  const quantity = !item && draft.quantityUnit === "kg" ? Number((enteredQuantity * 1000).toFixed(9)) : enteredQuantity;
  if (quantity > 1e9) throw new Error("A quantidade em estoque ultrapassa o limite permitido.");
  const costPerKg = amount(draft.costPerKg, "o custo por quilo", !item || item.avg_cost == null);
  const identity = normalizeMaterialIdentity({ materialCode: draft.materialCode, description: draft.materialDescription,
    color: draft.color.name, colorCode: draft.color.code || filamentColorCode(draft.color.name), colorHex: draft.color.hex });
  const diameter = draft.diameter.trim() ? amount(draft.diameter, "o diâmetro") : null;
  if (diameter != null && (diameter <= 0 || diameter > 10)) throw new Error("Informe um diâmetro maior que zero e de até 10 mm.");
  const name = draft.name.trim() || filamentName(draft);
  const data: Record<string, unknown> = {
    name, category: "filament", ...identity,
    material_type: item?.material_code === draft.materialCode && item.material_type ? item.material_type
      : MATERIAL_CODES.find(([code]) => code === draft.materialCode)![1],
    unit, brand: draft.brand.trim() || null, sku: draft.sku.trim() || null, diameter, notes: draft.notes.trim() || null,
  };
  if (!item || quantity !== Number(item.current_stock)) {
    data.current_stock = quantity;
    if (item) data.expected_stock = Number(item.current_stock);
  }
  const priorCostPerKg = item?.avg_cost == null ? null : item.avg_cost * (unit === "g" ? 1000 : 1);
  if (!item || draft.costPerKg.trim() && costPerKg !== priorCostPerKg)
    data.avg_cost = costPerKg / (unit === "g" ? 1000 : 1);
  return { p_item_id: item?.id ?? null, p_item: data };
}

export function readFilamentRegistrationId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new Error("O servidor não confirmou o cadastro. Tente novamente para conferir a mesma operação.");
  return value;
}
