import { describe, expect, it } from "vitest";
import { productionLossTotals } from "./production-losses";

describe("produção e rejeição na qualidade", () => {
  it("inclui somente material da qualidade no material perdido, sem duplicar o custo da OI", () => {
    expect(productionLossTotals([{ total_cost: 10 }], [{ actual_total_cost: 35 }], [{ material_cost: 5, total_cost: 15, quantity: 2 }]))
      .toEqual({ material: 15, uncosted: 0, failedCost: 35, unmeasured: 0, qualityCost: 15, rejectedUnits: 2 });
  });
  it("distingue custos pendentes de zero confirmado", () => {
    expect(productionLossTotals([{ total_cost: null }, { total_cost: 0 }], [{ actual_total_cost: null }, { actual_total_cost: 0 }], []))
      .toEqual({ material: 0, uncosted: 1, failedCost: 0, unmeasured: 1, qualityCost: 0, rejectedUnits: 0 });
  });
});
