export interface ProductPrintPlateValues {
  units_per_plate: number | null;
  est_grams: number | null;
  est_time_seconds: number | null;
  est_cost_per_unit: number | null;
  actual_grams_per_unit: number | null;
  actual_seconds_per_unit: number | null;
  actual_cost_per_unit: number | null;
  actual_sample_units: number;
  is_active: boolean;
}

export const optionalPlateNumber = (value: string, label: string) => {
  if (!value.trim()) return null;
  const number = Number(value.replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} deve ser um número maior ou igual a zero.`);
  return number;
};

/** A finished SKU requires every active plate, so per-unit components are added. */
export function sumProductPlateReferences(plates: ProductPrintPlateValues[]) {
  const active = plates.filter(plate => plate.is_active);
  let grams = 0, seconds = 0, cost = 0;
  let missingGrams = false, missingSeconds = false, missingCost = false, usesEstimate = false;
  let unconfirmedUnits = 0;
  let printGrams = 0, printSeconds = 0, missingPrintGrams = false, missingPrintSeconds = false;
  const nonNegative = (value: number | null) => value != null && Number.isFinite(value) && value >= 0 ? value : null;
  for (const plate of active) {
    const units = plate.units_per_plate != null && Number.isSafeInteger(plate.units_per_plate) && plate.units_per_plate > 0 ? plate.units_per_plate : null;
    if (units == null) unconfirmedUnits++;
    const accounted = Number.isSafeInteger(plate.actual_sample_units) && plate.actual_sample_units > 0;
    const actualGrams = accounted ? nonNegative(plate.actual_grams_per_unit) : null;
    const actualSeconds = accounted ? nonNegative(plate.actual_seconds_per_unit) : null;
    const actualCost = accounted ? nonNegative(plate.actual_cost_per_unit) : null;
    const estimatedGrams = nonNegative(plate.est_grams);
    const estimatedSeconds = nonNegative(plate.est_time_seconds);
    if (estimatedGrams == null) missingPrintGrams = true; else printGrams += estimatedGrams;
    if (estimatedSeconds == null) missingPrintSeconds = true; else printSeconds += estimatedSeconds;
    const gramsPerUnit = actualGrams ?? (units && estimatedGrams != null ? estimatedGrams / units : null);
    const secondsPerUnit = actualSeconds ?? (units && estimatedSeconds != null ? estimatedSeconds / units : null);
    const costPerUnit = actualCost ?? nonNegative(plate.est_cost_per_unit);
    usesEstimate ||= actualGrams == null || actualSeconds == null || actualCost == null;
    if (gramsPerUnit == null) missingGrams = true; else grams += gramsPerUnit;
    if (secondsPerUnit == null) missingSeconds = true; else seconds += secondsPerUnit;
    if (costPerUnit == null) missingCost = true; else cost += costPerUnit;
  }
  return {
    count: active.length,
    grams: active.length && !missingGrams ? grams : null,
    seconds: active.length && !missingSeconds ? seconds : null,
    cost: active.length && !missingCost ? cost : null,
    incomplete: missingGrams || missingSeconds || missingCost || unconfirmedUnits > 0,
    unconfirmedUnits,
    printGrams: active.length && !missingPrintGrams ? printGrams : null,
    printSeconds: active.length && !missingPrintSeconds ? printSeconds : null,
    usesEstimate,
  };
}
