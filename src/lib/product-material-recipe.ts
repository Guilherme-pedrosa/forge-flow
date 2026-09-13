export type RecipeBasis = "per_unit" | "per_print";
export type RecipeDraftLine = { item_id: string; grams: string };
export type MaterialRecipeLine = {
  item_id: string; name: string; unit: string; material_code: string | null;
  color: string | null; color_code: string | null; color_hex: string | null;
  grams: number; grams_per_unit: number; grams_per_print: number;
  cost_per_unit: number | null; material_ready: boolean; cost_known: boolean;
};
export type MaterialRecipe = {
  version_id: string; version: number; basis: RecipeBasis; units_per_print: number;
  non_material_cost_per_unit: number | null; material_cost_per_unit: number | null;
  cost_per_unit: number | null; complete: boolean; missing: string[];
  notes: string | null; created_at: string; lines: MaterialRecipeLine[];
};
export type ProductMaterialSnapshot = {
  schema_version: number;
  product: { id: string; name: string; prints_per_plate: number };
  recipe: MaterialRecipe | null;
  plates: { id: string; label: string | null; units_per_plate: number; recipe: MaterialRecipe | null }[];
  components: { product_id: string; quantity: number }[];
  complete: boolean; missing: string[]; cost_per_unit: number | null;
};

function decimal(value: string, label: string): number {
  const text = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) throw new Error(`Informe ${label} com um número válido.`);
  const result = Number(text.replace(",", "."));
  if (!Number.isFinite(result)) throw new Error(`Informe ${label} com um número válido.`);
  return result;
}

export function prepareRecipeLines(lines: RecipeDraftLine[]) {
  if (!lines.length || lines.length > 64) throw new Error("Informe de 1 a 64 materiais na composição.");
  const seen = new Set<string>();
  return lines.map((line, index) => {
    if (!line.item_id) throw new Error(`Selecione o material e a cor da linha ${index + 1}.`);
    if (seen.has(line.item_id)) throw new Error("O mesmo item de estoque está repetido. Some seus gramas em uma linha.");
    seen.add(line.item_id);
    const grams = decimal(line.grams, `os gramas da linha ${index + 1}`);
    if (grams < 0.001 || grams > 10_000_000) throw new Error("Os gramas devem estar entre 0,001 e 10.000.000.");
    return { item_id: line.item_id, grams };
  });
}

export function recipeNonMaterialCost(value: string): number {
  const result = decimal(value, "os demais custos por unidade (inclusive zero)");
  if (result > 1_000_000_000) throw new Error("Os demais custos por unidade excedem o limite permitido.");
  return result;
}

/** Changing the displayed basis preserves the physical recipe, including distinct colors. */
export function convertRecipeBasis(lines: RecipeDraftLine[], from: RecipeBasis, to: RecipeBasis, units: number): RecipeDraftLine[] {
  if (from === to) return lines;
  if (!Number.isInteger(units) || units < 1 || units > 10_000) throw new Error("Defina a quantidade de unidades atendidas por impressão antes da composição.");
  return lines.map(line => {
    if (!line.grams.trim()) return line;
    const value = decimal(line.grams, "os gramas");
    const grams = to === "per_print" ? value * units : value / units;
    return { ...line, grams: String(Number(grams.toFixed(9))) };
  });
}
