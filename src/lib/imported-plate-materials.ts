import { MATERIAL_CODES } from "./material-identity";
import type { RecipeDraftLine } from "./product-material-recipe";

export type ImportedPlateFilament = {
  id?: string; type: string | null; color: string | null; grams: number | null;
  meters?: number | null; item_id?: string | null; match_status?: string; candidate_count?: number;
};
export type IdentifiedRecipeMaterial = {
  id: string; unit: string; is_active: boolean; material_code: string | null;
  color: string | null; color_code: string | null; color_hex: string | null; material_identified_at: string | null;
};
export type ImportedPlatePreparation = {
  filaments: ImportedPlateFilament[]; missing: string[];
  material_cost_per_print: number | null; energy_cost_per_print: number | null;
  machine_cost_per_print: number | null; known_cost_per_print: number | null;
  non_material_cost_per_unit_suggestion: number | null;
};

/** Hex samples are compared exactly; a color name never identifies an inventory item. */
export function importedColorHex(value: string | null | undefined): string | null {
  const hex = value?.trim().replace(/^#/, "").toUpperCase();
  if (hex && /^[0-9A-F]{6}$/.test(hex)) return `#${hex}`;
  if (hex && /^[0-9A-F]{6}FF$/.test(hex)) return `#${hex.slice(0, 6)}`;
  return null;
}

export function importedPlateFilaments(value: unknown): ImportedPlateFilament[] {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row && typeof row === "object" && !Array.isArray(row)).map(row => ({
    ...row,
    type: typeof row.type === "string" ? row.type.trim() || null : null,
    color: typeof row.color === "string" ? row.color.trim() || null : null,
    grams: typeof row.grams === "number" && Number.isFinite(row.grams) && row.grams >= 0 ? row.grams : null,
  }));
}

export function observedPlateFilaments(metadata: unknown): ImportedPlateFilament[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const observed = (metadata as Record<string, unknown>).observed;
  if (!observed || typeof observed !== "object" || Array.isArray(observed)) return [];
  return importedPlateFilaments((observed as Record<string, unknown>).filaments);
}

export function importedFilamentLabel(filament: ImportedPlateFilament): string {
  return `${filament.type || "Material não informado"} · ${filament.color || "Cor não informada"}`;
}

export function importedRecipeDraft(filaments: ImportedPlateFilament[], inventory: IdentifiedRecipeMaterial[]): RecipeDraftLine[] {
  const result: RecipeDraftLine[] = [];
  for (const filament of filaments) {
    const code = filament.type?.trim().toUpperCase();
    const hex = importedColorHex(filament.color);
    const controlled = code && code !== "OTHER" && MATERIAL_CODES.some(([value]) => value === code);
    const candidates = controlled && hex ? inventory.filter(item => item.is_active && ["g", "kg"].includes(item.unit)
      && item.material_identified_at && item.color && item.color_code && item.material_code === code && importedColorHex(item.color_hex) === hex) : [];
    // Even a suggested item_id cannot disambiguate identical catalog identities silently.
    const itemId = candidates.length === 1 ? candidates[0].id : "";
    const mass = filament.grams != null && filament.grams > 0 ? filament.grams : null;
    const prior = itemId && mass != null ? result.find(line => line.item_id === itemId && line.grams !== "") : null;
    if (prior) { prior.grams = String(Number((Number(prior.grams) + mass!).toFixed(9))); continue; }
    result.push({ item_id: itemId, grams: mass == null ? "" : String(mass), imported_reference: importedFilamentLabel(filament),
      imported_match: candidates.length === 1 ? "unique" : candidates.length > 1 ? "ambiguous" : "missing" });
  }
  return result;
}
