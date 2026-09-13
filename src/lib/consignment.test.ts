import { describe, expect, it } from "vitest";
import { commissionPercent, prepareConsignmentItems, unitCommission } from "./consignment";

describe("comissão e repasse do consignado", () => {
  it("preserva padrão histórico20% e permite comissãozero explícita", () => {
    expect(commissionPercent(undefined)).toBe(20);
    expect(commissionPercent(0)).toBe(0);
    expect(unitCommission(100, 0)).toBe(0);
  });
  it("arredonda por unidade antes de multiplicar a quantidade", () => {
    expect(unitCommission(9.99, 20)).toBe(2);
    expect(unitCommission(9.99, 20) * 3).toBe(6);
  });
  it.each([-1, 101, NaN, Infinity])("recusa comissão inválida%s", percent => expect(() => commissionPercent(percent)).toThrow());
});

describe("estoque em ponto de venda", () => {
  const item = { product_id: "prod", quantity: 2, unit_price: 10 };
  const stock = [{ product_id: "prod", current_qty: 3 }];
  it("registra venda somente dentro do saldo", () => expect(prepareConsignmentItems([item], "sale", stock)).toEqual([item]));
  it("não vende ou devolve produto sem estoque no ponto", () => {
    expect(() => prepareConsignmentItems([item], "sale", [])).toThrow("saldo");
    expect(() => prepareConsignmentItems([item], "return", [])).toThrow("saldo");
  });
  it("não trunca quantidade fracionária silenciosamente", () => expect(() => prepareConsignmentItems([{ ...item, quantity: 2.5 }], "sale", stock)).toThrow("inteiro"));
  it("não aceita duplicação de produto que poderia passar a checagem de saldo", () => expect(() => prepareConsignmentItems([item, item], "sale", stock)).toThrow("distintos"));
  it("não publica uma venda sem valor", () => expect(() => prepareConsignmentItems([{ ...item, unit_price: 0 }], "sale", stock)).toThrow("maior que zero"));
  it("permite reposição de um ponto vazio sem inventar saldo anterior", () => expect(prepareConsignmentItems([item], "replenishment", [])).toEqual([item]));
});
