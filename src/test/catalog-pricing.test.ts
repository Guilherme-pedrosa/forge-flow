import { describe, expect, it } from "vitest";
import { catalogCostWithProductExtras, catalogPriceDraft } from "@/lib/catalog-pricing";

describe("Preço no cadastro", () => {
  it.each([
    ["6,67", "0", "0", "50", 6.67, 10.01],
    ["1,005", "0", "0", "0", 1.005, 1.01],
    ["0,00005", "0", "0", "0", 0.0001, 0],
    ["10", "2,50", "2,50", "50", 15, 22.5],
    ["0", "0", "0", "0", 0, 0],
  ])("arredonda valores monetários como o banco: %s", (base, accessory, other, markup, cost, price) => {
    expect(catalogPriceDraft(base, accessory, other, markup)).toEqual({ cost, price, markup: Number(markup), error: "" });
  });
  it("mantém custo desconhecido como pendência", () => {
    expect(catalogPriceDraft("", "0", "0", "50")).toMatchObject({ cost: null, price: null });
    expect(catalogPriceDraft("errado", "0", "0", "50")).toMatchObject({ cost: null, price: null, error: expect.any(String) });
  });
  it("soma adicionais do cadastro à base importada sem cobrar novamente os adicionais já aceitos nessa base", () => {
    expect(catalogCostWithProductExtras("12.2", [{ cost: 2.5 }])).toEqual({ input: "14.7", error: "" });
    expect(catalogCostWithProductExtras("17.1234", [{ cost: 2.5 }])).toEqual({ input: "19.6234", error: "" });
    expect(catalogPriceDraft("14.7", "0", "0", "100")).toMatchObject({ cost: 14.7, price: 29.4 });
  });
  it("arredonda uma única vez no total e preserva custos subcentavos e metadados das linhas", () => {
    const extras = [{ cost: 0.000025, origin: { invoice: "kept" } }, { cost: 0.000025 }], before = structuredClone(extras);
    const base = catalogCostWithProductExtras("1", extras);
    expect(base.input).toBe("1.00005");
    expect(catalogPriceDraft(base.input, "0.00005", "0", "0")).toMatchObject({ cost: 1.0001 });
    expect(extras).toEqual(before);
  });
  it.each([null, undefined, "", "1.2.3", -1, NaN, Infinity])("recusa custo inválido no adicional: %s", cost => {
    expect(catalogCostWithProductExtras("12.2", [{ cost }])).toMatchObject({ input: "", error: expect.any(String) });
  });
  it("não cria uma base conhecida só porque há adicionais e conserva zero explícito", () => {
    expect(catalogCostWithProductExtras("", [{ cost: 2.5 }])).toEqual({ input: "", error: "" });
    expect(catalogCostWithProductExtras("0", [{ cost: 0 }])).toEqual({ input: "0", error: "" });
  });
});
