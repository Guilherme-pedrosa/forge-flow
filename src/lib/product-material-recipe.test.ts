import { describe, expect, it } from "vitest";
import { convertRecipeBasis, prepareRecipeLines, recipeNonMaterialCost } from "./product-material-recipe";

describe("composição explícita por unidade ou impressão", () => {
  it("preserva duas cores ao converter para impressão e de volta", () => {
    const lines = [{ item_id: "pla-red", grams: "12,5" }, { item_id: "pla-blue", grams: "2.25" }];
    const printed = convertRecipeBasis(lines, "per_unit", "per_print", 4);
    expect(printed).toEqual([{ item_id: "pla-red", grams: "50" }, { item_id: "pla-blue", grams: "9" }]);
    expect(prepareRecipeLines(convertRecipeBasis(printed, "per_print", "per_unit", 4))).toEqual([{ item_id: "pla-red", grams: 12.5 }, { item_id: "pla-blue", grams: 2.25 }]);
  });
  it("não aceita massa ausente, negativa, zero, infinita ou sem item exato", () => {
    for (const grams of ["", "0", "-1", "Infinity", "1e7", "1.000,50"]) expect(() => prepareRecipeLines([{ item_id: "id", grams }])).toThrow();
    expect(() => prepareRecipeLines([{ item_id: "", grams: "1" }])).toThrow("material e a cor");
    expect(() => prepareRecipeLines([])).toThrow("1 a 64");
  });
  it("impede duplicação do mesmo estoque e capacidade inexistente", () => {
    expect(() => prepareRecipeLines([{ item_id: "red", grams: "10" }, { item_id: "red", grams: "5" }])).toThrow("repetido");
    expect(() => convertRecipeBasis([], "per_unit", "per_print", 0)).toThrow("quantidade");
    expect(() => convertRecipeBasis([{ item_id: "red", grams: "100" }], "per_print", "per_unit", null)).toThrow("quantidade");
  });
  it("zero nos demais custos exige informação explícita", () => {
    expect(recipeNonMaterialCost("0")).toBe(0);
    expect(recipeNonMaterialCost("1,025")).toBe(1.025);
    expect(() => recipeNonMaterialCost("")).toThrow();
    expect(() => recipeNonMaterialCost("-1")).toThrow();
  });
});
