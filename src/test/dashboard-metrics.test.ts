import { describe, expect, it, vi } from "vitest";
import { collectDashboardRows, localDateKey, remainingAmount, summarizeDashboard, type DashboardJob, type DashboardReceivable, type DashboardTitle } from "@/lib/dashboard-metrics";

const now = new Date(2026, 8, 12, 22, 0);
const job = (overrides: Partial<DashboardJob> = {}): DashboardJob => ({ id: "job-1", code: "J1", name: "Peça", status: "completed", sale_price: 100, actual_total_cost: 40, est_total_cost: 60, completed_at: new Date(2026, 8, 10, 10).toISOString(), est_time_minutes: 60, created_at: "2026-09-01T12:00:00Z", ...overrides });
const payable = (overrides: Partial<DashboardTitle> = {}): DashboardTitle => ({ id: "p-1", description: "Filamento", amount: 200, amount_paid: 75, due_date: "2026-09-11", status: "partial", ...overrides });
const receivable = (overrides: Partial<DashboardReceivable> = {}): DashboardReceivable => ({ id: "r-1", description: "Pedido", amount: 500, amount_received: 100, due_date: "2026-09-12", status: "partial", ...overrides });

describe("dashboard operational totals", () => {
  it("counts all jobs, not just the eight most recent rows", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => job({ id: `job-${i}`, status: i < 20 ? "queued" : "completed" }));
    const result = summarizeDashboard(jobs, [], [], now);
    expect(result.activeJobs).toHaveLength(20);
    expect(result.completedCount).toBe(10);
    expect(result.productionValue).toBe(1000);
  });
  it("uses actual zero cost and matches chart value and cost to the same completed jobs", () => {
    const result = summarizeDashboard([
      job({ actual_total_cost: 0 }),
      job({ id: "estimated", actual_total_cost: null, est_total_cost: 30 }),
      job({ id: "draft", status: "draft", sale_price: 9999 }),
      job({ id: "missing", actual_total_cost: null, est_total_cost: null, sale_price: 200 }),
    ], [], [], now);
    expect(result.productionValue).toBe(200);
    expect(result.productionCost).toBe(30);
    expect(result.productionMargin).toBe(85);
    expect(result.estimatedCostCount).toBe(1);
    expect(result.missingCostCount).toBe(1);
    expect(result.months.at(-1)).toMatchObject({ value: 200, cost: 30 });
  });
  it("does not duplicate completed/shipped jobs in the failure denominator", () => {
    const result = summarizeDashboard([job(), job({ id: "shipped", status: "shipped" }), job({ id: "failed", status: "failed" })], [], [], now);
    expect(result.completedCount).toBe(2);
    expect(result.lossRate).toBeCloseTo(100 / 3);
  });
  it("includes failed attempts in production cost without repeating their revenue", () => {
    const result=summarizeDashboard([job({actual_total_cost:60}),job({id:"failed",status:"failed",actual_total_cost:20})],[],[],now);
    expect(result.productionValue).toBe(100);
    expect(result.productionCost).toBe(80);
    expect(result.productionMargin).toBe(20);
    expect(result.months.at(-1)).toMatchObject({value:100,cost:80});
  });
  it("subtracts partial payments and receipts, excluding closed and reversed titles", () => {
    const result = summarizeDashboard([], [payable(), payable({ id: "cancelled", status: "cancelled" }), payable({ id: "paid", status: "paid" })], [receivable(), receivable({ id: "reversed", status: "reversed" }), receivable({ id: "received", status: "received" })], now);
    expect(result.payableTotal).toBe(125);
    expect(result.receivableTotal).toBe(400);
    expect(result.overduePayableCount).toBe(1);
    expect(result.overdueReceivableCount).toBe(0);
  });
  it("uses the local calendar date, not a UTC day boundary, for overdue titles", () => {
    const localNow = new Date(2026, 8, 12, 23, 59);
    expect(localDateKey(localNow)).toBe("2026-09-12");
    expect(summarizeDashboard([], [payable({ due_date: "2026-09-12" })], [], localNow).overduePayableCount).toBe(0);
  });
  it("does not present missing production metrics as real zero percentages", () => {
    const result = summarizeDashboard([], [], [], now);
    expect(result.lossRate).toBeNull();
    expect(result.productionMargin).toBeNull();
    expect(result.months).toHaveLength(6);
  });
  it("never creates a negative open balance for overpaid titles", () => {
    expect(remainingAmount(20, 30)).toBe(0);
    expect(remainingAmount("80.50", "30.25")).toBe(50.25);
  });
});

describe("dashboard paginated reads", () => {
  it("loads all pages beyond the API row limit", async () => {
    const rows = Array.from({ length: 1103 }, (_, id) => ({ id }));
    const fetch = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
    expect(await collectDashboardRows(fetch)).toHaveLength(1103);
    expect(fetch.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
  it("throws on later-page errors instead of publishing a partial total", async () => {
    await expect(collectDashboardRows(async (from: number) => from === 0 ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null } : { data: null, error: { message: "Falha na consulta" } })).rejects.toThrow("Falha na consulta");
  });
});
