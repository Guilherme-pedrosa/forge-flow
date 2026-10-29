import { describe, expect, it } from "vitest";
import { catalogPriceDraft } from "@/lib/catalog-pricing";

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
});
