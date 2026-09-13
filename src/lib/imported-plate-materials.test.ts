import { describe, expect, it } from "vitest";
import { importedColorHex, importedPlateFilaments, importedRecipeDraft, type IdentifiedRecipeMaterial } from "./imported-plate-materials";
const item: IdentifiedRecipeMaterial = { id: "red", unit: "kg", is_active: true, material_code: "PLA", color: "Vermelho", color_code: "RED", color_hex: "#FF0000", material_identified_at: "2026-09-13" };
describe("filamentos importados na composição", () => {
  it("usa identidade exata do estoque e mantém os gramas da impressão sem dividir por rendimento", () => {
    expect(importedRecipeDraft([{ type: " pla ", color: "ff0000ff", grams: 100 }], [item]))
      .toEqual([{ item_id: "red", grams: "100", imported_reference: " pla  · ff0000ff", imported_match: "unique" }]);
    expect(importedColorHex("#ff000080")).toBeNull(); expect(importedColorHex("vermelho")).toBeNull();
  });
  it("não usa item_id sugerido para escolher arbitrariamente entre estoques com a mesma identidade", () => {
    const [line] = importedRecipeDraft([{ type: "PLA", color: "#FF0000", grams: 25, item_id: "red" }], [item, { ...item, id: "red-other" }]);
    expect(line).toMatchObject({ item_id: "", grams: "25", imported_match: "ambiguous" });
  });
  it("não adivinha variante por nome, cor ausente, estoque inativo ou unidade incompatível", () => {
    for (const material of [{ ...item, is_active: false }, { ...item, unit: "un" }, { ...item, material_identified_at: null }]) {
      expect(importedRecipeDraft([{ type: "PLA", color: "#FF0000", grams: 25 }], [material])[0].item_id).toBe("");
    }
    for (const filament of [{ type: "PLA Basic", color: "#FF0000", grams: 10 }, { type: "PLA", color: null, grams: 10 }, { type: "PETG", color: "#FF0000", grams: 10 }]) {
      expect(importedRecipeDraft([filament], [item])[0]).toMatchObject({ item_id: "", grams: "10" });
    }
  });
  it("soma somente filamentos que resolveram para o mesmo item exato e preserva pesos desconhecidos", () => {
    const list = importedPlateFilaments([{ type: "PLA", color: "#FF0000", grams: 10 }, { type: "PLA", color: "FF0000", grams: 2.5 }, { type: "PETG", color: "#0000FF", grams: null }, { type: "ABS", color: "#FFFFFF", grams: "99" }]);
    expect(importedRecipeDraft(list, [item])).toMatchObject([{ item_id: "red", grams: "12.5" }, { item_id: "", grams: "" }, { item_id: "", grams: "" }]);
  });
});
