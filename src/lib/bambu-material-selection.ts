import type { BambuMaterialBinding } from "./bambu-production-api";

export type BambuMaterialPolicy = "approved_order" | "execution_variant" | "legacy_unconfigured";
export interface BambuStockMaterial {
  id: string; name: string; material_code: string | null; color: string | null;
  color_code: string | null; color_hex: string | null; unit: string;
  avg_cost: number | null; current_stock: number; cost_known?: boolean; is_active?: boolean;
}
export interface BambuExpectedMaterial {
  product_id: string; plate_id: string | null; base_item_id: string; selected_item_id: string;
  material_code: string | null; color_code: string | null; color_hex: string | null;
}
export interface BambuMaterialOption {
  product_id: string; plate_id: string | null; base_item_id: string; selected_item_id: string;
  options: BambuStockMaterial[];
}
export interface BambuMaterialOverride { product_id: string; plate_id: string | null; base_item_id: string; item_id: string }
export interface BambuSelectionFilament {
  source_key: string; label: string; planned_grams: number | null;
  item_id?: string | null; suggested_item_id?: string | null; base_item_id?: string | null;
  source_type?: string | null; source_color?: string | null; target_type?: string | null; target_color?: string | null;
  ams_id?: number | null; slot_id?: number | null; mapping_source?: string | null;
}
export interface BambuMaterialSelectionPreview {
  material_policy: BambuMaterialPolicy; expected_materials: BambuExpectedMaterial[];
  filaments: BambuSelectionFilament[]; material_options: BambuMaterialOption[];
  complete: boolean; missing: string[]; cost_per_unit: number | null;
}

export function bambuColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.replace(/^#/, "");
  if (/^[a-f\d]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`;
  // Bambu publishes RGBA. Never silently drop an unknown/translucent alpha.
  return /^[a-f\d]{6}ff$/i.test(hex) ? `#${hex.slice(0, 6).toUpperCase()}` : null;
}
export function bambuMaterialScope(value: Pick<BambuExpectedMaterial, "product_id" | "plate_id" | "base_item_id">): string {
  return JSON.stringify([value.product_id, value.plate_id, value.base_item_id]);
}
export function selectionBase(preview: BambuMaterialSelectionPreview, filament: BambuSelectionFilament, chosenScope?: string) {
  const matches = preview.expected_materials.filter(item => chosenScope ? bambuMaterialScope(item) === chosenScope : !!filament.base_item_id && item.base_item_id === filament.base_item_id);
  return matches.length === 1 ? matches[0] : null;
}

/** Translate explicit stock choices into execution overrides. Names and color
 * approximations never participate in this mapping; the backend validates again.
 */
export function resolveBambuMaterialSelection(preview: BambuMaterialSelectionPreview, bindings: Record<string, string>, bases: Record<string, string>) {
  const materials: BambuMaterialBinding[] = [];
  const overrides = new Map<string, BambuMaterialOverride>();
  const selectedByBase = new Map<string, string>();
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const filament of preview.filaments) {
    if (!filament.source_key || keys.has(filament.source_key)) { errors.push("A origem repetiu um filamento. Atualize os dados da impressão."); continue; }
    keys.add(filament.source_key);
    const itemId = bindings[filament.source_key];
    if (!itemId) { errors.push(`Selecione o item de estoque para ${filament.label}.`); continue; }
    materials.push({ source_key: filament.source_key, item_id: itemId });
    if (preview.material_policy === "legacy_unconfigured") continue;
    const base = selectionBase(preview, filament, bases[filament.source_key]);
    if (!base) { errors.push(`Identifique o material da composição correspondente a ${filament.label}.`); continue; }
    const scope = bambuMaterialScope(base);
    if (selectedByBase.has(scope) && selectedByBase.get(scope) !== itemId) { errors.push("Dois filamentos escolheram materiais diferentes para a mesma linha da composição. Revise o vínculo."); continue; }
    selectedByBase.set(scope, itemId);
    if (preview.material_policy === "approved_order") {
      if (itemId !== base.selected_item_id) errors.push("Esta ordem pertence a uma venda. Use o material e a cor aprovados no pedido.");
      continue;
    }
    const option = preview.material_options.find(option => bambuMaterialScope(option) === scope);
    if (!option?.options.some(item => item.id === itemId)) { errors.push(`O item escolhido para ${filament.label} não é uma alternativa permitida para esta composição.`); continue; }
    if (itemId !== base.base_item_id) overrides.set(scope, { product_id: base.product_id, plate_id: base.plate_id, base_item_id: base.base_item_id, item_id: itemId });
  }
  if (!preview.filaments.length) errors.push("A origem ainda não identificou os filamentos da impressão.");
  if (preview.material_policy !== "legacy_unconfigured") {
    for (const base of preview.expected_materials) if (!selectedByBase.has(bambuMaterialScope(base))) errors.push("Nem todos os materiais da composição foram associados aos filamentos desta execução.");
  }
  return { materials, overrides: [...overrides.values()], errors: [...new Set(errors)] };
}

/** Current price is a preview; the ledger uses average cost at posting time. */
export function bambuPlannedMaterialCost(item: BambuStockMaterial | undefined, grams: number | null): number | null {
  if (!item || grams == null || !Number.isFinite(grams) || grams < 0 || item.avg_cost == null || !Number.isFinite(item.avg_cost) || item.avg_cost < 0 || item.cost_known === false) return null;
  const unit = item.unit.trim().toLowerCase();
  if (unit !== "g" && unit !== "kg") return null;
  return item.avg_cost * grams / (unit === "kg" ? 1000 : 1);
}
