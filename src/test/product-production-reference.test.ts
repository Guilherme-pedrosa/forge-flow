import { describe, expect, it } from "vitest";
import { formatProductionSeconds, productProductionReference } from "@/lib/product-production-reference";

describe("production reference shown in the product catalog", () => {
  it("does not label a product as based on production without accounted units", () => {
    expect(productProductionReference(null)).toBeNull();
    expect(productProductionReference({ actual_print_cost_per_unit: 10 })).toBeNull();
    for (const count of [0, -1, 1.5, Infinity, "invalid"]) {
      expect(productProductionReference({ actual_print_sample_units: count })).toBeNull();
    }
  });

  it("keeps the per-unit averages as provided, including explicit zero", () => {
    const result = productProductionReference({
      actual_print_sample_units: 8, actual_print_grams_per_unit: "12.75",
      actual_print_seconds_per_unit: 75, actual_print_cost_per_unit: 0,
      actual_print_source: "measured",
    });
    expect(result?.sampleLabel).toBe("8 peças");
    expect(result?.gramsLabel).toBe("12,75 g");
    expect(result?.durationLabel).toBe("1min 15s");
    expect(result?.costLabel.replace(/\s/g, " ")).toBe("R$ 0,00");
    expect(result?.materialSource).toBe("Material medido nas apurações.");
  });

  it("does not claim that slicer or mixed consumption was fully measured", () => {
    expect(productProductionReference({ actual_print_sample_units: 1, actual_print_source: "slicer_completed" })?.materialSource)
      .toBe("Material estimado pelo fatiador após a conclusão da impressão.");
    expect(productProductionReference({ actual_print_sample_units: 1, actual_print_source: "mixed" })?.materialSource)
      .toBe("Material de medições e de estimativas do fatiador após a conclusão.");
    expect(productProductionReference({ actual_print_sample_units: 1, actual_print_source: "future_source" })?.materialSource)
      .toBe("Origem do consumo de material não informada.");
  });

  it("shows missing or invalid numbers as unknown instead of zero cost", () => {
    const result = productProductionReference({
      actual_print_sample_units: 1, actual_print_grams_per_unit: -1,
      actual_print_seconds_per_unit: Infinity, actual_print_cost_per_unit: "invalid",
      actual_print_updated_at: "invalid",
    });
    expect(result?.sampleLabel).toBe("1 peça");
    expect(result?.gramsLabel).toBe("Não informado");
    expect(result?.durationLabel).toBe("Não informado");
    expect(result?.costLabel).toBe("Não informado");
    expect(result?.updatedLabel).toBeNull();
  });

  it.each([
    [0, "0s"], [49, "49s"], [59.6, "1min"], [3599.6, "1h"],
    [3675, "1h 1min 15s"], [null, "Não informado"], [-1, "Não informado"],
  ])("formats elapsed %s seconds without rounding it to print hours", (seconds, expected) => {
    expect(formatProductionSeconds(seconds)).toBe(expected);
  });
});
