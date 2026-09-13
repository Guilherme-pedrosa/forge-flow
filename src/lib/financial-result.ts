import { money } from "./finance";

const fields = ["material_cost", "machine_cost", "energy_cost", "labor_cost", "overhead", "extras_cost"];
const componentCost = (job: any, field: string) => job[`actual_${field}`] ?? (job.status === "failed" ? 0 : job[`est_${field}`]) ?? 0;

/** Missing purchase mappings remain explicit pending amounts, never assumed profit. */
export function calculateFinancialResult(receivables: any[], payables: any[], jobs: any[], purchaseItems: any[] = []) {
  const activeAR = receivables.filter(r => r.status !== "reversed");
  const activeAP = payables.filter(p => p.status !== "cancelled");
  let opExpenses = 0, excludedPurchases = 0, unknownPurchaseAmount = 0, unclassifiedCount = 0, unclassifiedExpenseAmount = 0;
  for (const payable of activeAP) {
    const accountType = payable.chart_of_accounts?.account_type;
    const purchase = payable.origin_type === "purchase_order" || /^Ref\. (pedido de compra|NFe|pedido PC-)/i.test(payable.notes || "");
    if (!purchase) {
      if (!accountType || accountType === "expense") {
        opExpenses += payable.amount;
        if (!accountType) { unclassifiedCount++; unclassifiedExpenseAmount += payable.amount; }
      }
      continue;
    }
    const items = payable.origin_id ? purchaseItems.filter(item => item.purchase_order_id === payable.origin_id) : [];
    const itemTotal = items.reduce((sum, item) => sum + item.total, 0);
    const linkedTotal = items.filter(item => item.inventory_item_id).reduce((sum, item) => sum + item.total, 0);
    // Apportion the title (including freight/adjustments) only where actual stock
    // links exist. An unlinked line could be either a service or unmapped material.
    const inventoryPart = itemTotal > 0 ? money(payable.amount * Math.min(1, linkedTotal / itemTotal)) : 0;
    excludedPurchases += inventoryPart;
    const remaining = money(payable.amount - inventoryPart);
    if (accountType === "expense") opExpenses += remaining;
    else if (["asset", "liability", "equity"].includes(accountType)) excludedPurchases += remaining;
    else unknownPurchaseAmount += remaining;
  }
  opExpenses = money(opExpenses);
  excludedPurchases = money(excludedPurchases);
  unknownPurchaseAmount = money(unknownPurchaseAmount);
  unclassifiedExpenseAmount = money(unclassifiedExpenseAmount);
  const totalRevenue = money(activeAR.reduce((sum, title) => sum + title.amount, 0));
  const cost = (field: string) => money(jobs.reduce((sum, job) => sum + componentCost(job, field), 0));
  const materialCost = cost("material_cost"), machineCost = cost("machine_cost"), energyCost = cost("energy_cost"), laborCost = cost("labor_cost"), overheadCost = cost("overhead"), extrasCost = cost("extras_cost");
  const totalCMV = money(jobs.reduce((sum, job) => sum + (job.actual_total_cost ?? fields.reduce((value, field) => value + componentCost(job, field), 0)), 0));
  const failedCost = money(jobs.filter(job => job.status === "failed").reduce((sum, job) => sum + (job.actual_total_cost ?? fields.reduce((value, field) => value + componentCost(job, field), 0)), 0));
  const unmeasuredFailedCount = jobs.filter(job => job.status === "failed" && job.actual_total_cost == null).length;
  const missingFailureDateCount = jobs.filter(job => job.status === "failed" && !job.completed_at).length;
  const costAdjustment = money(totalCMV - materialCost - machineCost - energyCost - laborCost - overheadCost - extrasCost);
  const grossProfit = money(totalRevenue - totalCMV);
  const netResult = money(grossProfit - opExpenses);
  const estimatedCount = jobs.filter(job => job.status !== "failed" && job.actual_total_cost == null && fields.some(field => job[`actual_${field}`] == null && job[`est_${field}`] != null)).length;
  const missingCompetenceCount = [...activeAR, ...activeAP].filter(title => !title.competence_date).length;
  const isPartial = unknownPurchaseAmount > 0 || unclassifiedCount > 0 || missingCompetenceCount > 0 || estimatedCount > 0 || unmeasuredFailedCount > 0 || missingFailureDateCount > 0;
  return {
    totalRevenue, opExpenses, materialCost, machineCost, energyCost, laborCost, overheadCost, extrasCost, costAdjustment, totalCMV, grossProfit, netResult,
    grossMargin: !isPartial && totalRevenue > 0 ? grossProfit / totalRevenue * 100 : null,
    netMargin: !isPartial && totalRevenue > 0 ? netResult / totalRevenue * 100 : null,
    jobCount: jobs.length, titleCount: activeAR.length, unclassifiedCount, unclassifiedExpenseAmount,
    excludedPurchases, unknownPurchaseAmount, failedCost, unmeasuredFailedCount, missingFailureDateCount, estimatedCount, missingCompetenceCount, isPartial,
  };
}
