import { describe, expect, it, vi } from "vitest";
import { estimateProductionCosts, gramsToStockUnit, jobTransitions, nonNegative, positiveInteger, resolvePrinterStatus, validateMovement, productExtrasPerPiece, requiresProductionMeasurement } from "./production";
import { productionMargins, type ProductionMarginJob } from "./production-margin";
import { readProductionRows } from "./production-read";

describe("produção e unidade de estoque", () => {
  it("200g consomem 0,2kg, não 200kg", () => expect(gramsToStockUnit(200, "kg")).toBe(0.2));
  it("rejeita material sem unidade de massa", () => expect(() => gramsToStockUnit(100, "ml")).toThrow("gramas"));
  it("mantém perda zero e inclui purga uma vez", () => {
    const costs = estimateProductionCosts({ grams: 200, minutes: 120, purgeGrams: 20, material: { unit: "kg", avg_cost: 80, loss_coefficient: 0 }, printer: { power_watts: 200, depreciation_per_hour: 1, maintenance_cost_per_hour: 0.5 }, energyRate: 1, labor: 5, overhead: 2 });
    expect(costs.material).toBeCloseTo(17.6);
    expect(costs.machine).toBe(3);
    expect(costs.energy).toBeCloseTo(0.4);
    expect(costs.total).toBeCloseTo(28);
  });
  it("calcula perda prevista e material secundário com seus próprios custos", () => {
    expect(estimateProductionCosts({ grams: 100, minutes: 0, purgeGrams: 10, material: { unit: "g", avg_cost: 0.1, loss_coefficient: 0.1 }, purgeMaterial: { unit: "kg", avg_cost: 200, loss_coefficient: 0 } }).material).toBeCloseTo(13);
  });
  it("não troca tarifa zero por padrão", () => expect(estimateProductionCosts({ grams: 0, minutes: 60, energyRate: 0, printer: { power_watts: 100, depreciation_per_hour: 0, maintenance_cost_per_hour: 0 } }).energy).toBe(0));
  it.each([-1, NaN, Infinity])("não aceita custo ou quantidade inválida %s", value => expect(() => nonNegative(value, "Custo")).toThrow());
  it.each([0, -1, 1.5, 101, "abc"])("rejeita quantidade de placas %s", value => expect(() => positiveInteger(value, "Placas", 100)).toThrow());
  it("não permite reabrir uma conclusão nem apagar a falha voltando a rascunho", () => {
    expect(jobTransitions.completed).toEqual([]);
    expect(jobTransitions.failed).toEqual(["reprint"]);
  });
  it("apuracustos antes de avançar para qualidade e acabamento", () => {
    expect(requiresProductionMeasurement("quality_check", null)).toBe(true);
    expect(requiresProductionMeasurement("post_processing", null)).toBe(true);
    expect(requiresProductionMeasurement("ready", "2026-09-12T00:00:00Z")).toBe(false);
  });
  it("inclui acessórios por peça sem somar de novo componentes do kit", () => {
    const extras = productExtrasPerPiece([{ name: "Caixa", cost: 2 }, { name: "Chocolate", cost: 5 }, { name: "Kit componente", cost: 30, _kit_product_id: "part" }]);
    expect(extras).toBe(7);
    expect(estimateProductionCosts({ grams: 0, minutes: 0, extras: extras * 4 }).total).toBe(28);
  });
});

describe("movimentações rastreáveis", () => {
  it("reduz ajuste com diferença negativa e motivo", () => expect(() => validateMovement("adjustment", -2, 10, "Inventário físico" )).not.toThrow());
  it("recusa ajuste sem justificativa", () => expect(() => validateMovement("adjustment", 2, 10, " ")).toThrow("justificativa"));
  it("recusa saída que deixaria saldo negativo", () => expect(() => validateMovement("loss", 11, 10, "Avaria")).toThrow("saldo"));
  it("recusa entrada com quantidade negativa", () => expect(() => validateMovement("purchase_in", -10, 10, "")).toThrow("maior que zero"));
});

describe("telemetria confiável", () => {
  it("offline tem prioridade sobre status RUNNING antigo", () => expect(resolvePrinterStatus("idle", { online: false, print_status: "RUNNING" })).toBe("offline"));
  it("telemetria vencida não indica máquina imprimindo", () => expect(resolvePrinterStatus("idle", { online: true, print_status: "RUNNING", last_seen_at: "2026-09-12T10:00:00Z" }, Date.parse("2026-09-12T10:06:00Z"))).toBe("offline"));
  it("respeita manutenção mesmo com último sinal IDLE", () => expect(resolvePrinterStatus("maintenance", { online: true, print_status: "IDLE" })).toBe("maintenance"));
});

const job = (overrides: Partial<ProductionMarginJob> = {}): ProductionMarginJob => ({ product_id: "sku1", sale_price: 100, est_total_cost: 50, actual_total_cost: 60, actual_grams: 100, actual_time_minutes: 60, ...overrides });
describe("margem por SKU", () => {
  it("margem real ausente fica pendente em vez de 100%", () => expect(productionMargins([job({ actual_total_cost: null })])[0].avgRealMargin).toBeNull());
  it("não confunde custo zero medido com ausência de apuração", () => expect(productionMargins([job({ actual_total_cost: 0 })])[0].avgRealMargin).toBe(100));
  it("não mistura margem parcial com produção sem venda atribuída", () => expect(productionMargins([job(), job({ sale_price: null })])[0].avgRealMargin).toBeNull());
  it("pondera pela receita, sem média simples das porcentagens", () => expect(productionMargins([job(), job({ sale_price: 900, actual_total_cost: 720 })])[0].avgRealMargin).toBeCloseTo(22));
  it("mantém custo negativo no resultado como prejuízo real", () => expect(productionMargins([job({ actual_total_cost: 120 })])[0].avgRealMargin).toBe(-20));
  it("inclui o custo da impressão que falhou sem duplicar receita da reimpressão", () => {
    const margin = productionMargins([job(), job({ status: "failed", actual_total_cost: 20, sale_price: 100 })])[0];
    expect(margin.totalRevenue).toBe(100);
    expect(margin.totalEstCost).toBe(50);
    expect(margin.totalActualCost).toBe(80);
    expect(margin.avgRealMargin).toBe(20);
    expect(margin.jobCount).toBe(1);
    expect(margin.failedCount).toBe(1);
  });
});

describe("paginação de relatórios", () => {
  it("lê além do limite de1000 sem perder registros", async () => {
    const all = Array.from({ length: 1234 }, (_, id) => ({ id }));
    const fetch = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }));
    expect(await readProductionRows(fetch)).toHaveLength(1234);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("propaga falha sem devolver soma parcial", async () => {
    await expect(readProductionRows(async () => ({ data: null, error: { message: "Conexão indisponível" } }))).rejects.toThrow("Conexão indisponível");
  });
});
