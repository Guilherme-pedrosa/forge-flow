type MaterialSummary = { itemId: string; name: string; material: string; color: string; code: string; hex: string | null; grams: number | null; fullBatches: boolean };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function recipeLines(snapshot: unknown, quantity: number, depth = 0): { row: Record<string, unknown>; multiplier: number; fullBatches: boolean }[] {
  const root = object(snapshot); if (!root || depth > 20) return [];
  if (Array.isArray(root.components) && root.components.length) return root.components.flatMap(value => {
    const component = object(value); const units = Number(component?.quantity);
    return component && Number.isInteger(units) && units > 0 ? recipeLines(component.snapshot, quantity * units, depth + 1) : [];
  });
  const recipes = Array.isArray(root.plates) && root.plates.length ? root.plates.map(plate => object(plate)?.recipe) : [root.recipe];
  const lines = recipes.flatMap(value => {
    const recipe = object(value); const capacity = Number(recipe?.units_per_print);
    if (!recipe || !Array.isArray(recipe.lines) || !Number.isInteger(capacity) || capacity <= 0) return [];
    return recipe.lines.flatMap(line => { const row = object(line); return row ? [{ row, multiplier: Math.ceil(quantity / capacity), fullBatches: true }] : []; });
  });
  if (lines.length) return lines;
  return Array.isArray(root.requirements) ? root.requirements.flatMap(value => { const row = object(value); return row ? [{ row, multiplier: quantity, fullBatches: false }] : []; }) : [];
}
export function quoteSnapshotMaterials(snapshot: unknown, quantity = 1): MaterialSummary[] {
  return recipeLines(snapshot, quantity).flatMap(({ row, multiplier, fullBatches }) => {
    if (typeof row.item_id !== "string") return [];
    const amount = fullBatches ? row.grams_per_print : row.grams_per_unit;
    const grams = amount == null || amount === "" ? null : Number(amount);
    return [{ itemId: row.item_id, name: String(row.name || "Material identificado"), material: String(row.material_type || row.material_code || "Material pendente"), color: String(row.color || "Cor pendente"), code: String(row.color_code || "Código pendente"), hex: typeof row.color_hex === "string" && /^#[0-9a-f]{6}$/i.test(row.color_hex) ? row.color_hex : null, grams: grams != null && Number.isFinite(grams) && grams >= 0 ? grams * multiplier : null, fullBatches }];
  });
}
export function QuoteSnapshotSummary({ snapshot, quantity = 1 }: { snapshot: unknown; quantity?: number }) {
  const materials = quoteSnapshotMaterials(snapshot, quantity);
  if (!materials.length) return <p className="mt-2 text-xs text-muted-foreground">Composição de matéria-prima ainda não registrada nesta versão.</p>;
  return <div className="mt-3 space-y-2" aria-label="Materiais da composição preservada">{materials.map((material, index) => <div key={`${material.itemId}-${index}`} className="flex min-w-0 items-start gap-2 rounded-md border bg-background p-2 text-xs"><span aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border" style={{ backgroundColor: material.hex || "transparent" }} /><div className="min-w-0"><p className="break-words font-medium">{material.name}</p><p className="break-words text-muted-foreground">{material.material} · {material.color} · {material.code}</p><p className="mt-0.5 text-muted-foreground">{material.grams == null ? "Consumo previsto pendente" : `${material.grams.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} g ${material.fullBatches ? "em lotes completos para atender" : "na composição para"} ${quantity} ${quantity === 1 ? "unidade" : "unidades"}`}</p></div></div>)}</div>;
}
