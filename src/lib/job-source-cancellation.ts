export interface PlanningSourceOrder { id: string; status?: string | null }
export interface PlanningSourceProductionOrder extends PlanningSourceOrder { source_order_id?: string | null }
export interface PlanningSourceJob {
  status: string;
  order_id?: string | null;
  production_order_id?: string | null;
  started_at?: string | null;
  inventory_posted_at?: string | null;
}

/** Cancellation removes future work, never evidence of a physical execution. */
export function excludeUnstartedCancelledJobs<T extends PlanningSourceJob>(
  jobs: readonly T[], orders: readonly PlanningSourceOrder[], productionOrders: readonly PlanningSourceProductionOrder[],
): T[] {
  const cancelledSales = new Set(orders.filter(order => order.status === "cancelled").map(order => order.id));
  const productions = new Map(productionOrders.map(order => [order.id, order]));
  return jobs.filter(job => {
    if (!["draft", "queued", "reprint"].includes(job.status) || job.started_at || job.inventory_posted_at) return true;
    const production = job.production_order_id ? productions.get(job.production_order_id) : undefined;
    // Missing relationships are not proof of cancellation; keep them for review.
    return !cancelledSales.has(job.order_id ?? "") && production?.status !== "cancelled"
      && !cancelledSales.has(production?.source_order_id ?? "");
  });
}
