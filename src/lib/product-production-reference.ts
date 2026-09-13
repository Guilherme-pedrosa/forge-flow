/** Read-only averages maintained by the production accounting flow. */
export interface ProductProductionReferenceFields {
  actual_print_grams_per_unit?: number | string | null;
  actual_print_seconds_per_unit?: number | string | null;
  actual_print_cost_per_unit?: number | string | null;
  actual_print_sample_units?: number | string | null;
  actual_print_updated_at?: string | null;
  actual_print_source?: string | null;
}

const finiteNonNegative = (value: unknown): number | null => {
  if (value == null || (typeof value === "string" && !value.trim()) || (typeof value !== "number" && typeof value !== "string")) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export function formatProductionSeconds(value: unknown): string {
  const seconds = finiteNonNegative(value);
  if (seconds == null) return "Não informado";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}min` : "", remainder || rounded === 0 ? `${remainder}s` : ""].filter(Boolean).join(" ");
}

export function productProductionReference(product: ProductProductionReferenceFields | null | undefined) {
  if (!product) return null;
  const sampleUnits = finiteNonNegative(product.actual_print_sample_units);
  if (sampleUnits == null || !Number.isSafeInteger(sampleUnits) || sampleUnits === 0) return null;
  const grams = finiteNonNegative(product.actual_print_grams_per_unit);
  const cost = finiteNonNegative(product.actual_print_cost_per_unit);
  const updated = product.actual_print_updated_at ? new Date(product.actual_print_updated_at) : null;
  const source = product.actual_print_source;
  const materialSource = source === "measured"
    ? "Material medido nas apurações."
    : source === "slicer_completed"
      ? "Material estimado pelo fatiador após a conclusão da impressão."
      : source === "mixed"
        ? "Material de medições e de estimativas do fatiador após a conclusão."
        : "Origem do consumo de material não informada.";
  return {
    sampleUnits,
    sampleLabel: `${sampleUnits.toLocaleString("pt-BR")} ${sampleUnits === 1 ? "peça" : "peças"}`,
    gramsLabel: grams == null ? "Não informado" : `${grams.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} g`,
    durationLabel: formatProductionSeconds(product.actual_print_seconds_per_unit),
    costLabel: cost == null ? "Não informado" : cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    materialSource,
    updatedLabel: updated && Number.isFinite(updated.getTime())
      ? updated.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : null,
  };
}
