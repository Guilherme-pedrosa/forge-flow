export interface ProductionMarginJob {
  product_id: string | null;
  sale_price: number | null;
  est_total_cost: number | null;
  actual_total_cost: number | null;
  actual_grams: number | null;
  actual_time_minutes: number | null;
  status?: string;
  products?: { name: string; sku: string | null } | null;
}

export function productionMargins(jobs: ProductionMarginJob[]) {
  const groups = new Map<string, {
    productId: string; productName: string; sku: string | null; jobCount: number;
    totalRevenue: number; totalEstCost: number; totalActualCost: number;
    missingActual: number; missingEstimate: number; unpriced: number; failedCount: number;
  }>();
  for (const job of jobs) {
    const id = job.product_id ?? "__no_product__";
    const group = groups.get(id) ?? { productId: id, productName: job.products?.name ?? "Sem produto", sku: job.products?.sku ?? null, jobCount: 0, totalRevenue: 0, totalEstCost: 0, totalActualCost: 0, missingActual: 0, missingEstimate: 0, unpriced: 0, failedCount: 0 };
    const failed = job.status === "failed";
    if (failed) group.failedCount++;
    else {
      group.jobCount++;
      group.totalRevenue += job.sale_price ?? 0;
      group.totalEstCost += job.est_total_cost ?? 0;
      group.missingEstimate += job.est_total_cost == null ? 1 : 0;
      group.unpriced += job.sale_price == null || job.sale_price <= 0 ? 1 : 0;
    }
    group.totalActualCost += job.actual_total_cost ?? 0;
    group.missingActual += job.actual_total_cost == null ? 1 : 0;
    groups.set(id, group);
  }
  return [...groups.values()].map(group => {
    const avgEstMargin = group.missingEstimate || group.unpriced || group.totalRevenue <= 0 ? null : (group.totalRevenue - group.totalEstCost) / group.totalRevenue * 100;
    const avgRealMargin = group.missingActual || group.unpriced || group.totalRevenue <= 0 ? null : (group.totalRevenue - group.totalActualCost) / group.totalRevenue * 100;
    return { ...group, avgEstMargin, avgRealMargin, marginDrift: avgRealMargin != null && avgEstMargin != null ? avgRealMargin - avgEstMargin : null };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);
}
