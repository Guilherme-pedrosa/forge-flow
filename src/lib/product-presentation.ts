import type { CommercialDescriptionGeneration } from "./commercial-product-description";

export type ProductDimensionsDraft = { length_cm: string; width_cm: string; height_cm: string };
export type ProductPresentation = {
  dimensions: { length_mm: number | null; width_mm: number | null; height_mm: number | null };
  description_generation: CommercialDescriptionGeneration | null;
};
export const emptyProductDimensionsDraft = (): ProductDimensionsDraft => ({ length_cm: "", width_cm: "", height_cm: "" });
export const productDimensionFields = [["length_cm", "length_mm", "Comprimento da peça (cm)"], ["width_cm", "width_mm", "Largura da peça (cm)"], ["height_cm", "height_mm", "Altura da peça (cm)"]] as const;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Receives the complete products.commercial_presentation object, not its dimensions sub-object. */
export function readProductDimensionsDraft(presentation: unknown): ProductDimensionsDraft {
  const dimensions = object(object(presentation).dimensions), draft = emptyProductDimensionsDraft();
  for (const [key, field] of productDimensionFields) {
    const value = dimensions[field];
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000) draft[key] = String(value / 10).replace(".", ",");
  }
  return draft;
}

/** Receives the complete products.commercial_presentation object. Invalid or unknown versions never authorize automatic rewriting. */
export function readProductDescriptionGeneration(presentation: unknown): CommercialDescriptionGeneration | null {
  const value = object(object(presentation).description_generation);
  if (value.schema_version !== 1 || value.generator !== "facts-pt-BR-v1" || typeof value.generated_text !== "string" || !value.generated_text.trim() || value.generated_text.length > 20000
    || typeof value.input_signature !== "string" || value.input_signature.length > 20000 || !["portuguese", "known_translation", "source_name", "generic"].includes(String(value.title_mode))) return null;
  return { schema_version: 1, generator: "facts-pt-BR-v1", generated_text: value.generated_text, input_signature: value.input_signature, title_mode: value.title_mode as CommercialDescriptionGeneration["title_mode"] };
}

export function prepareProductPresentation(draft: ProductDimensionsDraft, generation?: CommercialDescriptionGeneration | null): ProductPresentation | null {
  const dimensions: ProductPresentation["dimensions"] = { length_mm: null, width_mm: null, height_mm: null };
  for (const [key, field, label] of productDimensionFields) {
    const raw = draft[key].trim();
    if (!raw) continue;
    const value = Number(raw.replace(",", "."));
    if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw) || !Number.isFinite(value) || value <= 0 || value > 10000) throw new Error(`${label}: informe uma medida maior que zero e de até 10.000 cm.`);
    dimensions[field] = Math.round(value * 10 * 1e6) / 1e6;
    if (dimensions[field] === 0) throw new Error(`${label}: informe uma medida maior que zero.`);
  }
  const validatedGeneration = readProductDescriptionGeneration({ description_generation: generation });
  return Object.values(dimensions).some(value => value !== null) || validatedGeneration ? { dimensions, description_generation: validatedGeneration } : null;
}
