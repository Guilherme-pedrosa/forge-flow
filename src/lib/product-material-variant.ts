export type MaterialOverride = { product_id: string; plate_id: string | null; base_item_id: string; item_id: string };
export type MaterialOption = { id: string; name: string; material_code: string; color: string; color_code: string; color_hex: string | null; unit: string; avg_cost: number | null; current_stock: number; cost_known: boolean };
export type MaterialChoice = { product_id: string; plate_id: string | null; base_item_id: string; selected_item_id: string; product_name?: string; plate_label?: string; options: MaterialOption[] };
export type MaterialVariantPreview = { snapshot: unknown; material_options: MaterialChoice[]; complete: boolean; missing: string[]; cost_per_unit: number | null; estimated_total_cost: number | null; estimated_unit_cost: number | null };

export const materialChoiceKey = (value: Pick<MaterialOverride, "product_id" | "plate_id" | "base_item_id">) => `${value.product_id}/${value.plate_id || "product"}/${value.base_item_id}`;
export function changeMaterialOverride(current: MaterialOverride[], choice: MaterialChoice, itemId: string): MaterialOverride[] {
  const remaining = current.filter(row => materialChoiceKey(row) !== materialChoiceKey(choice));
  if (itemId !== choice.base_item_id) remaining.push({ product_id: choice.product_id, plate_id: choice.plate_id, base_item_id: choice.base_item_id, item_id: itemId });
  return remaining.sort((a, b) => materialChoiceKey(a).localeCompare(materialChoiceKey(b)));
}

/** Keep the selected physical material and plate identity when editing or duplicating a sale. */
export function readMaterialOverrides(value: unknown): MaterialOverride[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("As cores deste item não puderam ser carregadas. Atualize antes de editar.");
  const keys = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== "object" || typeof row.product_id !== "string" || typeof row.base_item_id !== "string" || typeof row.item_id !== "string" || (row.plate_id !== null && typeof row.plate_id !== "string")) throw new Error("A seleção de material deste item está incompleta.");
    const result = { product_id: row.product_id, plate_id: row.plate_id, base_item_id: row.base_item_id, item_id: row.item_id };
    const key = materialChoiceKey(result); if (keys.has(key)) throw new Error("Há mais de um material selecionado para a mesma parte do produto."); keys.add(key);
    return result;
  });
}
