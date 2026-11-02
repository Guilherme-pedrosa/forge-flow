import { describe, expect, it } from "vitest";
import { buildCommercialProductDescription } from "./commercial-product-description";
import { emptyProductDimensionsDraft, prepareProductPresentation, readProductDescriptionGeneration, readProductDimensionsDraft } from "./product-presentation";

describe("finished-product presentation", () => {
  it("keeps unknown measurements blank and writes a nullable presentation without inventing zero", () => {
    expect(readProductDimensionsDraft(null)).toEqual(emptyProductDimensionsDraft());
    expect(prepareProductPresentation(emptyProductDimensionsDraft())).toBeNull();
    expect(prepareProductPresentation({ length_cm: "", width_cm: "", height_cm: "12,5" })).toEqual({ dimensions: { length_mm: null, width_mm: null, height_mm: 125 }, description_generation: null });
  });
  it("round-trips millimeters and reads only the complete presentation, never shipping dimensions", () => {
    const dimensions = { length_mm: 120, width_mm: 58.5, height_mm: 150 };
    const draft = readProductDimensionsDraft({ dimensions });
    expect(draft).toEqual({ length_cm: "12", width_cm: "5,85", height_cm: "15" });
    expect(prepareProductPresentation(draft)?.dimensions).toEqual(dimensions);
    expect(readProductDimensionsDraft({ length_cm: 25, width_cm: 20, height_cm: 10, weight_grams: 500 })).toEqual(emptyProductDimensionsDraft());
    expect(readProductDimensionsDraft(dimensions)).toEqual(emptyProductDimensionsDraft());
  });
  it.each(["0", "-1", "NaN", "Infinity", "1.000,5", "10001"])("rejects invalid product measurement %s", value => {
    expect(() => prepareProductPresentation({ ...emptyProductDimensionsDraft(), length_cm: value })).toThrow("Comprimento da peça");
  });
  it("preserves a validated description-generation marker independently of optional dimensions", () => {
    const generation = buildCommercialProductDescription({ title: "Presépio", category: "printed_part" }).generation;
    expect(prepareProductPresentation(emptyProductDimensionsDraft(), generation)).toEqual({ dimensions: { length_mm: null, width_mm: null, height_mm: null }, description_generation: generation });
    expect(readProductDescriptionGeneration({ description_generation: generation })).toEqual(generation);
    expect(readProductDescriptionGeneration({ description_generation: { ...generation, generator: "another-generator" } })).toBeNull();
  });
  it("does not preserve unvalidated marker keys or revive malformed historic measurements", () => {
    const generation = buildCommercialProductDescription({ title: "Presépio" }).generation;
    expect(readProductDescriptionGeneration({ description_generation: { ...generation, extra: "not persisted" } })).toEqual(generation);
    expect(readProductDescriptionGeneration({ description_generation: { ...generation, generated_text: null } })).toBeNull();
    expect(readProductDimensionsDraft({ dimensions: { length_mm: -1, width_mm: Infinity, height_mm: "120" } })).toEqual(emptyProductDimensionsDraft());
  });
});
