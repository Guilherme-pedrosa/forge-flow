import { describe, expect, it } from "vitest";
import { emptyShippingPackageDraft, prepareShippingPackage, readShippingPackageDraft, shippingPackageDraftComplete } from "./product-shipping";

describe("embalagem física do produto", () => {
  it("separa medidas de envio do peso de produção e aceita decimais em português", () => {
    expect(prepareShippingPackage({ length_cm: "20,5", width_cm: "15", height_cm: "8", weight_grams: "350,5" }))
      .toEqual({ length_cm: 20.5, width_cm: 15, height_cm: 8, weight_grams: 350.5 });
    expect(readShippingPackageDraft({ est_grams: 10, total_weight_grams: 12 })).toEqual(emptyShippingPackageDraft());
  });
  it("permite cadastro incompleto sem fabricar medidas e distingue prontidão para cotar", () => {
    expect(prepareShippingPackage(emptyShippingPackageDraft())).toBeNull();
    const draft = { ...emptyShippingPackageDraft(), length_cm: "20" };
    expect(prepareShippingPackage(draft)).toEqual({ length_cm: 20, width_cm: null, height_cm: null, weight_grams: null });
    expect(shippingPackageDraftComplete(draft)).toBe(false);
    expect(shippingPackageDraftComplete({ length_cm: "20", width_cm: "15", height_cm: "8", weight_grams: "350" })).toBe(true);
  });
  it.each(["0", "-2", "NaN", "Infinity", "1.000,5", "1001"])("rejeita dimensão inválida %s", value => {
    expect(() => prepareShippingPackage({ ...emptyShippingPackageDraft(), height_cm: value })).toThrow(/Altura/);
  });
  it("preserva dados salvos e limita peso bruto", () => {
    const saved = { length_cm: 20, width_cm: 15, height_cm: 8, weight_grams: 350 };
    expect(prepareShippingPackage(readShippingPackageDraft(saved))).toEqual(saved);
    expect(() => prepareShippingPackage({ ...readShippingPackageDraft(saved), weight_grams: "1000001" })).toThrow(/Peso total/);
  });
});
