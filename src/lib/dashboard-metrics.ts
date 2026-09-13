import type { Tables } from "@/integrations/supabase/types";

export type DashboardJob = Pick<Tables<"jobs">, "id" | "code" | "name" | "status" | "sale_price" | "actual_total_cost" | "est_total_cost" | "completed_at" | "est_time_minutes" | "created_at"> & { printers?: { name: string } | null };
export type DashboardTitle = Pick<Tables<"accounts_payable">, "id" | "description" | "amount" | "amount_paid" | "due_date" | "status">;
export type DashboardReceivable = Pick<Tables<"accounts_receivable">, "id" | "description" | "amount" | "amount_received" | "due_date" | "status">;

export const numberValue = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
export const remainingAmount = (amount: unknown, paid: unknown) => Math.max(0, numberValue(amount) - numberValue(paid));
export const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Supabase defaults to a capped response; aggregate every page, or fail visibly. */
export async function collectDashboardRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function summarizeDashboard(jobs: DashboardJob[], payables: DashboardTitle[], receivables: DashboardReceivable[], now = new Date()) {
  const today = localDateKey(now);
  const activeJobs = jobs.filter(job => ["queued", "printing", "paused", "post_processing", "quality_check", "reprint"].includes(job.status));
  const completed = jobs.filter(job => ["completed", "shipped"].includes(job.status));
  const failed = jobs.filter(job => job.status === "failed");
  // Imported printer history is intentionally excluded: it can represent the same local job.
  const finishedCount = completed.length + failed.length;
  const pricedJobs = completed.filter(job => job.sale_price != null && (job.actual_total_cost != null || job.est_total_cost != null));
  const productionValue = pricedJobs.reduce((sum, job) => sum + numberValue(job.sale_price), 0);
  const costedJobs = [...pricedJobs, ...failed.filter(job => job.actual_total_cost != null || job.est_total_cost != null)];
  const unknownFailures = failed.filter(job => job.actual_total_cost == null && job.est_total_cost == null).length;
  const productionCost = costedJobs.reduce((sum, job) => sum + numberValue(job.actual_total_cost ?? job.est_total_cost), 0);
  const pendingPayables = payables.filter(title => !["paid", "cancelled"].includes(title.status)).map(title => ({ ...title, remaining: remainingAmount(title.amount, title.amount_paid), overdue: title.due_date < today })).filter(title => title.remaining > 0).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const pendingReceivables = receivables.filter(title => ["open", "partial", "overdue"].includes(title.status)).map(title => ({ ...title, remaining: remainingAmount(title.amount, title.amount_received), overdue: title.due_date < today })).filter(title => title.remaining > 0).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const key = localDateKey(date).slice(0, 7);
    const monthJobs = pricedJobs.filter(job => job.completed_at && localDateKey(new Date(job.completed_at)).startsWith(key));
    const monthCosts = costedJobs.filter(job => job.completed_at && localDateKey(new Date(job.completed_at)).startsWith(key));
    return {
      month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      label: date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      value: monthJobs.reduce((sum, job) => sum + numberValue(job.sale_price), 0),
      cost: monthCosts.reduce((sum, job) => sum + numberValue(job.actual_total_cost ?? job.est_total_cost), 0),
    };
  });
  return {
    activeJobs, completedCount: completed.length, failedCount: failed.length,
    lossRate: finishedCount ? failed.length / finishedCount * 100 : null,
    productionValue, productionCost,
    productionMargin: productionValue > 0 && unknownFailures === 0 ? (productionValue - productionCost) / productionValue * 100 : null,
    estimatedCostCount: costedJobs.filter(job => job.actual_total_cost == null).length,
    missingCostCount: completed.length - pricedJobs.length + unknownFailures,
    pendingPayables, pendingReceivables,
    payableTotal: pendingPayables.reduce((sum, title) => sum + title.remaining, 0),
    receivableTotal: pendingReceivables.reduce((sum, title) => sum + title.remaining, 0),
    overduePayableCount: pendingPayables.filter(title => title.overdue).length,
    overdueReceivableCount: pendingReceivables.filter(title => title.overdue).length,
    months,
  };
}
