import { describe, expect, it } from "vitest";
import { productionSetting, validateCompanyLogo } from "@/lib/company-settings";

describe("Parâmetros de custo da empresa", () => {
  it("preserva custos zero e aceita decimal brasileiro", () => {
    expect(productionSetting("0", "energia")).toBe(0);
    expect(productionSetting("0,85", "energia")).toBe(0.85);
    expect(productionSetting("0", "margem", true)).toBe(0);
  });
  it.each(["", "-1", "NaN", "Infinity", "abc"])("não transforma valor inválido em custo zero: %s", value => expect(() => productionSetting(value, "energia")).toThrow());
  it("impede denominador zero ou negativo no cálculo de preço por margem", () => {
    expect(() => productionSetting("100", "margem", true)).toThrow();
    expect(() => productionSetting("101", "margem", true)).toThrow();
    expect(productionSetting("99,9", "margem", true)).toBe(99.9);
  });
  it("limita logotipos a imagens e tamanho informado na interface", () => {
    expect(() => validateCompanyLogo({ type: "image/png", size: 2048 })).not.toThrow();
    expect(() => validateCompanyLogo({ type: "image/svg+xml", size: 2048 })).toThrow();
    expect(() => validateCompanyLogo({ type: "image/jpeg", size: 3 * 1024 * 1024 })).toThrow();
  });
});
