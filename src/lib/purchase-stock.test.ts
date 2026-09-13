import { describe, expect, it } from "vitest";
import { purchaseMassToStock, purchasePackageToStock, purchaseMaterialLabel, purchaseStockQuantity } from "./purchase-stock";

describe("compra e saldo em unidades diferentes", () => {
  it("converte o peso explícito de cada rolo sem confundir a quantidade comercial", () => {
    expect(purchasePackageToStock(1, "1", "kg", "g")).toBe(1000);
    expect(purchasePackageToStock(3, "0,75", "kg", "g")).toBe(2250);
    expect(purchasePackageToStock(2, "500", "g", "kg")).toBe(1);
  });
  it("aceita apenas massa de unidade conhecida, sem interpretar nome, rolo, volume ou valores ausentes", () => {
    expect(purchaseMassToStock(2, "KG", "g")).toBe(2000);
    for (const unit of ["UN", "rolo 1kg", "ml", ""]) expect(purchaseMassToStock(1, unit, "g")).toBeNull();
    for (const value of ["", "0", "-1", "abc"]) expect(purchasePackageToStock(2, value, "kg", "g")).toBeNull();
    expect(purchasePackageToStock(0, "1", "kg", "g")).toBeNull();
    expect(purchaseMassToStock(.00000001, "g", "kg")).toBeNull();
  });
  it("exibe tipo, cor e unidade estruturados sem inventar identificação pelo nome", () => {
    expect(purchaseMaterialLabel({ name: "Filamento", unit: "g", material_code: "PLA", color: "Azul", color_code: "BLUE", sku: "SKU-2" })).toBe("Filamento · PLA · Azul · [BLUE] · SKU-2 · estoque em g");
    expect(purchaseMaterialLabel({ name: "PLA vermelho 1kg", unit: "g", category: "filament" })).toContain("Tipo/cor pendentes");
  });
  it("permite vínculo pendente sem quantidade, mas rejeita entrada inválida", () => {
    expect(purchaseStockQuantity("")).toBeNull(); expect(purchaseStockQuantity("1,25")).toBe(1.25);
    for (const value of ["0", "-2", "abc", "Infinity"]) expect(() => purchaseStockQuantity(value)).toThrow("maior que zero");
  });
});
