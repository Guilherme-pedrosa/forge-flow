import { describe, expect, it } from "vitest";
import { allRows, effectiveStatus, localDate, money, monthlyInstallments, outstandingAmount, positiveMoney, validDate, validateSettlement } from "@/lib/finance";
import { calculateFinancialResult } from "@/lib/financial-result";

const title = { amount: 100, amount_paid: 25, due_date: "2026-09-10", status: "partial" };
describe("Valores e baixas financeiras", () => {
  it("aceita centavos brasileiros, agrupamento e arredonda sem truncar", () => {
    expect(money("1.234,56")).toBe(1234.56);
    expect(money("123,45")).toBe(123.45);
    expect(money(1.005)).toBe(1.01);
  });
  it.each(["", " ", "1x", "0x10", "1e3", "1,2,3", "Infinity", "NaN"])("rejeita entrada inválida %s", value => expect(() => money(value)).toThrow());
  it.each([0, -1, 0.001, NaN, Infinity])("rejeita baixa não positiva/finita %s", value => expect(() => positiveMoney(value)).toThrow());
  it("classifica atraso pela data local mesmo quando banco ainda diz partial", () => {
    expect(effectiveStatus(title, "2026-09-12")).toBe("overdue");
    expect(effectiveStatus(title, "2026-09-10")).toBe("partial");
    expect(outstandingAmount(title)).toBe(75);
  });
  it("não apresenta cancelados e estornados como aberto", () => {
    expect(effectiveStatus({ ...title, status: "cancelled" })).toBe("cancelled");
    expect(effectiveStatus({ ...title, status: "reversed" })).toBe("cancelled");
  });
  it("permite baixa parcial, rejeita excesso, baixa futura e títulos cancelados", () => {
    expect(validateSettlement(title, "12,34", "2026-09-12", "2026-09-12")).toBe(12.34);
    expect(() => validateSettlement(title, 75.01, "2026-09-12", "2026-09-12")).toThrow(/saldo/);
    expect(() => validateSettlement(title, 10, "2026-09-13", "2026-09-12")).toThrow(/data/);
    expect(() => validateSettlement({ ...title, status: "cancelled" }, 10, "2026-09-12")).toThrow();
  });
});

describe("Calendário e parcelamento", () => {
  it("usa componentes locais da data e valida dias do calendário", () => {
    expect(localDate(new Date(2026, 8, 12, 23, 59))).toBe("2026-09-12");
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2026-02-29")).toBe(false);
  });
  it("conserva o total em centavos e o dia do mês após fevereiro", () => {
    expect(monthlyInstallments(100, 3, "2026-01-31")).toEqual([
      { amount: 33.34, due_date: "2026-01-31" }, { amount: 33.33, due_date: "2026-02-28" }, { amount: 33.33, due_date: "2026-03-31" },
    ]);
  });
  it("conserva centavos com 12 parcelas e cruza ano corretamente", () => {
    const installments = monthlyInstallments(10.01, 12, "2026-12-31");
    expect(installments.reduce((sum, part) => sum + Math.round(part.amount * 100), 0)).toBe(1001);
    expect(installments[1].due_date).toBe("2027-01-31");
  });
  it("impede parcelas de zero centavos, frações e datas inválidas", () => {
    expect(() => monthlyInstallments(0.01, 2, "2026-09-12")).toThrow();
    expect(() => monthlyInstallments(100, 1.5, "2026-09-12")).toThrow();
    expect(() => monthlyInstallments(100, 2, "2026-13-12")).toThrow();
  });
});

describe("Resultado por competência", () => {
  it("reconhece valores de títulos independentemente de baixas e exclui estornos", () => {
    const result = calculateFinancialResult([{ amount: 1000, amount_received: 50, status: "partial" }, { amount: 900, status: "reversed" }], [{ amount: 200, amount_paid: 0, status: "open", account_id: "x" }, { amount: 999, status: "cancelled" }], []);
    expect(result.totalRevenue).toBe(1000);
    expect(result.opExpenses).toBe(200);
    expect(result.netResult).toBe(800);
  });
  it("não soma preço de job novamente nem lança compra de estoque duas vezes", () => {
    const result = calculateFinancialResult([{ amount: 1000, status: "received" }], [{ amount: 800, status: "open", origin_type: "purchase_order", origin_id: "purchase-1" }], [{ sale_price: 1000, actual_material_cost: 100, actual_machine_cost: 0, actual_energy_cost: 0, actual_labor_cost: 0, actual_overhead: 0 }], [{ purchase_order_id: "purchase-1", inventory_item_id: "material-1", total: 800 }]);
    expect(result.totalRevenue).toBe(1000);
    expect(result.opExpenses).toBe(0);
    expect(result.totalCMV).toBe(100);
    expect(result.netResult).toBe(900);
    expect(result.excludedPurchases).toBe(800);
    expect(result.unknownPurchaseAmount).toBe(0);
  });
  it("preserva custo real zero e evidencia custos estimados", () => {
    const result = calculateFinancialResult([], [], [{ actual_material_cost: 0, est_material_cost: 999, actual_machine_cost: null, est_machine_cost: 25 }]);
    expect(result.materialCost).toBe(0);
    expect(result.machineCost).toBe(25);
    expect(result.estimatedCount).toBe(1);
  });
  it("não trata aquisição de ativo como despesa operacional", () => {
    const result = calculateFinancialResult([], [{ amount: 100, status: "open", chart_of_accounts: { account_type: "asset" } }], []);
    expect(result.opExpenses).toBe(0);
  });
  it("inclui extras e respeita custo total real quando informado", () => {
    const fallback = calculateFinancialResult([], [], [{ actual_total_cost: null, actual_material_cost: 10, actual_extras_cost: 7 }]);
    expect(fallback.totalCMV).toBe(17);
    expect(fallback.extrasCost).toBe(7);
    const actual = calculateFinancialResult([], [], [{ actual_total_cost: 20, actual_material_cost: 10, actual_extras_cost: 7 }]);
    expect(actual.totalCMV).toBe(20);
    expect(actual.costAdjustment).toBe(3);
  });
  it("deduz o custo real das falhas, sem usar orçamento de peça concluída", () => {
    const result = calculateFinancialResult([{ amount: 100, status: "received", competence_date: "2026-09-12" }], [], [{ status: "failed", actual_total_cost: 12, est_total_cost: 999, actual_material_cost: 7, est_material_cost: 900, actual_extras_cost: 5 }]);
    expect(result.failedCost).toBe(12);
    expect(result.totalCMV).toBe(12);
    expect(result.netResult).toBe(88);
  });
  it("sinaliza falhas sem apuração e não inventa perdas estimadas", () => {
    const result = calculateFinancialResult([], [], [{ status: "failed", actual_total_cost: null, est_material_cost: 900 }]);
    expect(result.failedCost).toBe(0);
    expect(result.unmeasuredFailedCount).toBe(1);
    expect(result.isPartial).toBe(true);
    expect(result.netMargin).toBeNull();
  });
  it("inclui compra de serviço classificada como despesa", () => {
    const result = calculateFinancialResult([], [{ amount: 110, status: "open", origin_type: "purchase_order", origin_id: "service", chart_of_accounts: { account_type: "expense" }, competence_date: "2026-09-12" }], [], [{ purchase_order_id: "service", inventory_item_id: null, total: 100 }]);
    expect(result.opExpenses).toBe(110);
    expect(result.excludedPurchases).toBe(0);
    expect(result.unknownPurchaseAmount).toBe(0);
  });
  it("separa estoque e serviço em compra mista incluindo frete proporcional", () => {
    const result = calculateFinancialResult([], [{ amount: 110, status: "open", origin_type: "purchase_order", origin_id: "mixed", chart_of_accounts: { account_type: "expense" }, competence_date: "2026-09-12" }], [], [{ purchase_order_id: "mixed", inventory_item_id: "material", total: 80 }, { purchase_order_id: "mixed", inventory_item_id: null, total: 20 }]);
    expect(result.excludedPurchases).toBe(88);
    expect(result.opExpenses).toBe(22);
  });
  it("não apresenta margem completa quando compra não tem origem ou classificação", () => {
    const result = calculateFinancialResult([{ amount: 1000, status: "received", competence_date: "2026-09-12" }], [{ amount: 300, status: "open", notes: "Ref. NFe 1234 - Pedido PC-0001", competence_date: "2026-09-12" }], []);
    expect(result.unknownPurchaseAmount).toBe(300);
    expect(result.excludedPurchases).toBe(0);
    expect(result.isPartial).toBe(true);
    expect(result.netMargin).toBeNull();
  });
});

describe("Totais sem truncamento silencioso", () => {
  it("carrega as páginas além dos primeiros mil registros", async () => {
    const calls: number[] = [];
    const rows = await allRows(async from => { calls.push(from); return { data: Array.from({ length: from === 0 ? 1000 : 7 }, (_, i) => from + i), error: null }; });
    expect(rows).toHaveLength(1007);
    expect(calls).toEqual([0, 1000]);
  });
  it("não devolve um total parcial quando uma página falha", async () => {
    await expect(allRows(async from => from === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: new Error("offline") })).rejects.toThrow("offline");
  });
});
