import { describe, expect, it } from "vitest";
import { bambuColor, bambuMaterialScope, bambuPlannedMaterialCost, resolveBambuMaterialSelection, type BambuMaterialSelectionPreview, type BambuStockMaterial } from "./bambu-material-selection";

const gray: BambuStockMaterial = { id: "gray", name: "PLA", material_code: "PLA", color: "Cinza", color_code: "GRAY", color_hex: "#A7A9AA", unit: "kg", avg_cost: 80, current_stock: 2, cost_known: true };
const white: BambuStockMaterial = { ...gray, id: "white", color: "Branco", color_code: "WHITE", color_hex: "#FFFFFF", avg_cost: 100 };
const expected = { product_id: "product", plate_id: "plate", base_item_id: "gray", selected_item_id: "gray", material_code: "PLA", color_code: "GRAY", color_hex: "#A7A9AA" };
const preview = (): BambuMaterialSelectionPreview => ({ material_policy: "execution_variant", expected_materials: [expected], material_options: [{ ...expected, options: [gray, white] }], filaments: [{ source_key: "ams", label: "PLA branco", planned_grams: 17, base_item_id: "gray", source_color: "A7A9AAFF", target_color: "FFFFFFFF" }], complete: true, missing: [], cost_per_unit: 1.36 });

describe("material and color selection for an individual Bambu execution", () => {
  it("uses the explicitly chosen stock item without modifying the SKU composition", () => {
    const source = preview(); const unchanged = JSON.stringify(source);
    expect(resolveBambuMaterialSelection(source, { ams: "white" }, {})).toEqual({ materials: [{ source_key: "ams", item_id: "white" }], overrides: [{ product_id: "product", plate_id: "plate", base_item_id: "gray", item_id: "white" }], errors: [] });
    expect(JSON.stringify(source)).toBe(unchanged);
  });
  it("never substitutes by same material name or color label, nor chooses a stock item implicitly", () => {
    expect(resolveBambuMaterialSelection(preview(), {}, {}).errors).toContain("Selecione o item de estoque para PLA branco.");
    expect(resolveBambuMaterialSelection(preview(), { ams: "other-white" }, {}).errors.join(" ")).toContain("não é uma alternativa permitida");
  });
  it("requires the commercially approved item for a sales order even when another color is available", () => {
    const source = { ...preview(), material_policy: "approved_order" as const, expected_materials: [{ ...expected, selected_item_id: "white" }] };
    expect(resolveBambuMaterialSelection(source, { ams: "gray" }, {}).errors.join(" ")).toContain("aprovados no pedido");
    expect(resolveBambuMaterialSelection(source, { ams: "white" }, {})).toMatchObject({ overrides: [], errors: [] });
  });
  it("requests an explicit base-line choice when the file cannot identify one uniquely", () => {
    const source = preview(); source.filaments[0].base_item_id = null;
    expect(resolveBambuMaterialSelection(source, { ams: "white" }, {}).errors.join(" ")).toContain("material da composição");
    expect(resolveBambuMaterialSelection(source, { ams: "white" }, { ams: bambuMaterialScope(expected) }).errors).toEqual([]);
  });
  it("does not collapse different product or plate scopes into the same base material", () => {
    const source = preview(); source.expected_materials.push({ ...expected, plate_id: "another-plate" });
    expect(resolveBambuMaterialSelection(source, { ams: "white" }, {}).errors.length).toBeGreaterThan(0);
    expect(resolveBambuMaterialSelection(source, { ams: "white" }, { ams: bambuMaterialScope(expected) }).errors.join(" ")).toContain("Nem todos os materiais");
  });
  it("deduplicates an identical override but rejects contradictory stock choices for one composition line", () => {
    const source = preview(); source.filaments.push({ ...source.filaments[0], source_key: "second" });
    const same = resolveBambuMaterialSelection(source, { ams: "white", second: "white" }, {});
    expect(same.overrides).toHaveLength(1); expect(same.materials).toHaveLength(2); expect(same.errors).toEqual([]);
    expect(resolveBambuMaterialSelection(source, { ams: "white", second: "gray" }, {}).errors.join(" ")).toContain("mesma linha");
  });
  it("legacy executions preserve explicit material mapping without inventing a base recipe", () => {
    const source = { ...preview(), material_policy: "legacy_unconfigured" as const, expected_materials: [], material_options: [] };
    expect(resolveBambuMaterialSelection(source, { ams: "white" }, {})).toMatchObject({ overrides: [], errors: [] });
  });
  it("shows kg/g costs with explicit zero and keeps unknown or invalid costs pending", () => {
    expect(bambuPlannedMaterialCost(gray, 17)).toBeCloseTo(1.36); expect(bambuPlannedMaterialCost(white, 17)).toBeCloseTo(1.7);
    expect(bambuPlannedMaterialCost({ ...gray, unit: "g", avg_cost: .08 }, 17)).toBeCloseTo(1.36);
    expect(bambuPlannedMaterialCost({ ...gray, avg_cost: 0 }, 17)).toBe(0);
    expect(bambuPlannedMaterialCost({ ...gray, avg_cost: null }, 17)).toBeNull(); expect(bambuPlannedMaterialCost(gray, NaN)).toBeNull();
  });
  it("normalizes opaque Bambu RGBA colors and rejects unsafe or unknown color representations", () => {
    expect(bambuColor("A7A9AAFF")).toBe("#A7A9AA"); expect(bambuColor("#ffffff")).toBe("#FFFFFF");
    for (const value of ["url(javascript:alert(1))", "A7A9AA00", "Branco", {}, null]) expect(bambuColor(value)).toBeNull();
  });
});
