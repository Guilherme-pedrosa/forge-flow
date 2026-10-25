export const shippingPackageFields = [
  ["length_cm", "Comprimento da embalagem (cm)", 1000],
  ["width_cm", "Largura da embalagem (cm)", 1000],
  ["height_cm", "Altura da embalagem (cm)", 1000],
  ["weight_grams", "Peso total embalado (g)", 1000000],
] as const;

export type ShippingPackageKey = typeof shippingPackageFields[number][0];
export type ShippingPackage = Record<ShippingPackageKey, number | null>;
export type ShippingPackageDraft = Record<ShippingPackageKey, string>;

export const emptyShippingPackageDraft = (): ShippingPackageDraft => ({ length_cm: "", width_cm: "", height_cm: "", weight_grams: "" });

export function readShippingPackageDraft(value: unknown): ShippingPackageDraft {
  const draft = emptyShippingPackageDraft();
  if (!value || typeof value !== "object" || Array.isArray(value)) return draft;
  for (const [key, , max] of shippingPackageFields) {
    const number = (value as Record<string, unknown>)[key];
    if (typeof number === "number" && Number.isFinite(number) && number > 0 && number <= max) draft[key] = String(number);
  }
  return draft;
}

/** Empty or partial packaging remains a draft; quoting requires every measure. */
export function prepareShippingPackage(draft: ShippingPackageDraft): ShippingPackage | null {
  const prepared: ShippingPackage = { length_cm: null, width_cm: null, height_cm: null, weight_grams: null };
  let populated = false;
  for (const [key, label, max] of shippingPackageFields) {
    const raw = draft[key].trim();
    if (!raw) continue;
    const value = Number(raw.replace(",", "."));
    if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw) || !Number.isFinite(value) || value <= 0 || value > max) {
      throw new Error(`${label}: informe um valor maior que zero e de até ${max.toLocaleString("pt-BR")}.`);
    }
    prepared[key] = value;
    populated = true;
  }
  return populated ? prepared : null;
}

export function shippingPackageDraftComplete(draft: ShippingPackageDraft): boolean {
  try {
    const value = prepareShippingPackage(draft);
    return !!value && shippingPackageFields.every(([key]) => value[key] !== null);
  } catch { return false; }
}
