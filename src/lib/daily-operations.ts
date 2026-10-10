import { localDate, validDate } from "./finance";
import { salesOrderNextAction } from "./sales-workflow";
import { readProductionRows } from "./production-read";
import { isMissingDatabaseStructure } from "./database-readiness";
import { deliveryPreparationDay } from "./order-preparation-deadline";

/** Optional deadlines keep the daily view readable before the workflow migration. */
export interface DailyOrder {
  id: string;
  code: string;
  status: string;
  due_date?: string | null;
  ship_by_at?: string | null;
  internal_due_at?: string | null;
  marketplace_order_id?: string | null;
  workflow_issues?: unknown;
  workflow_checked_at?: string | null;
  created_at?: string | null;
}
export interface DailyJob { id: string; status: string; reprint_of?: string | null }
export interface DailyPrinter { id: string; name: string; model?: string | null; status: string }
export interface DailyMaterial {
  id: string; name: string; unit: string;
  current_stock: number | string | null; min_stock: number | string | null;
}
export interface DailyMarketplaceOrder {
  id: string; internal_order_id: string | null; shipping_deadline_at: string | null;
  needs_review: boolean; review_reason: string | null;
}
export interface DailySnapshot {
  orders: DailyOrder[]; jobs: DailyJob[]; printers: DailyPrinter[]; materials: DailyMaterial[];
  marketplaceOrders?: DailyMarketplaceOrder[];
}
export interface DailyDeadline {
  kind: "posting" | "internal" | "internal_day" | "delivery" | "unknown";
  value: string | null;
  sortAt: number;
  urgency: "overdue" | "today" | "upcoming" | "unknown";
}

/** A calendar DATE is never accepted as a posting cutoff or a completion estimate. */
function instant(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !validDate(value.slice(0, 10))) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}
const finiteStock = (value: number | string | null) => {
  if (value === null || (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Only an unactivated inbox can be skipped; failed reads must not hide deadlines. */
export async function readDailyMarketplaceOrders(load: (from: number, to: number) => PromiseLike<{
  data: DailyMarketplaceOrder[] | null; error: { message: string; code?: string } | null;
}>): Promise<DailyMarketplaceOrder[]> {
  try {
    return await readProductionRows(async (from, to) => {
      const result = await load(from, to);
      // Preserve the structured code across readProductionRows' generic error seam.
      if (result.error) throw result.error;
      return result;
    });
  } catch (error) {
    if (isMissingDatabaseStructure(error)) return [];
    throw new Error(error && typeof error === "object" && "message" in error ? String(error.message) : "Não foi possível conferir os prazos dos marketplaces.");
  }
}

export function dailyOrderDeadline(order: DailyOrder, now = new Date(), hasMarketplaceLink = false): DailyDeadline {
  // An already shipped order needs delivery follow-up, not a stale posting alarm.
  const candidates = order.status === "shipped" ? [] : [
    { kind: "posting" as const, value: order.ship_by_at, at: instant(order.ship_by_at) },
    { kind: "internal" as const, value: order.internal_due_at, at: order.status === "ready" ? null : instant(order.internal_due_at) },
  ].filter(candidate => candidate.at !== null).sort((a, b) => a.at! - b.at!);
  const first = candidates[0];
  if (first) return {
    kind: first.kind, value: first.value!, sortAt: first.at!,
    urgency: first.at! < now.getTime() ? "overdue" : localDate(new Date(first.at!)) === localDate(now) ? "today" : "upcoming",
  };
  const internalDay = ["ready", "shipped"].includes(order.status) ? null : deliveryPreparationDay(order, hasMarketplaceLink);
  const day = internalDay ?? order.due_date;
  if (day && validDate(day)) {
    const [year, month, date] = day.split("-").map(Number);
    return {
      kind: internalDay ? "internal_day" : "delivery", value: day,
      // Sorting only: this instant must never be displayed as a cutoff time.
      sortAt: new Date(year, month - 1, date).getTime(),
      urgency: day < localDate(now) ? "overdue" : day === localDate(now) ? "today" : "upcoming",
    };
  }
  return { kind: "unknown", value: null, sortAt: Infinity, urgency: "unknown" };
}

export function dailyPrinterStatus(status: string): string {
  return ({ idle: "Ociosa no cadastro", printing: "Imprimindo", paused: "Pausada", error: "Erro", offline: "Offline", maintenance: "Manutenção" } as Record<string, string>)[status] ?? "Status a conferir";
}

export function summarizeDailyOperations(snapshot: DailySnapshot, now = new Date()) {
  const inboxByOrder = new Map((snapshot.marketplaceOrders ?? []).filter(inbox => inbox.internal_order_id).map(inbox => [inbox.internal_order_id!, inbox]));
  const orders = snapshot.orders.filter(order => !["delivered", "cancelled"].includes(order.status)).map(order => {
    const inbox = inboxByOrder.get(order.id);
    // The inbox retains the real cutoff even while an older sales snapshot awaits review.
    const effective = inbox ? { ...order, ship_by_at: inbox.shipping_deadline_at } : order;
    const needsReview = inbox?.needs_review === true;
    const postingTime = instant(effective.ship_by_at), internalTime = instant(order.internal_due_at);
    return {
      ...order,
      deadline: dailyOrderDeadline(effective, now, inbox != null),
      postingAt: postingTime !== null ? effective.ship_by_at! : null,
      postingSource: inbox ? "marketplace" as const : "order" as const,
      internalAt: internalTime !== null ? order.internal_due_at! : null,
      internalDay: deliveryPreparationDay(effective, inbox != null),
      internalDeadlineNeedsReview: inbox != null && internalTime !== null && postingTime !== null && internalTime > postingTime,
      deliveryDay: order.due_date && validDate(order.due_date) ? order.due_date : null,
      issues: Array.isArray(order.workflow_issues) ? order.workflow_issues.filter((issue): issue is string => typeof issue === "string" && !!issue.trim()) : [],
      workflowChecked: !needsReview && instant(order.workflow_checked_at) !== null,
      marketplaceReview: needsReview,
      marketplaceReviewReason: needsReview ? inbox?.review_reason?.trim() || "Confira a alteração do canal e replaneje o pedido antes de continuar." : null,
      marketplaceHref: "/comercial/marketplaces",
      nextAction: needsReview ? "Replanejar pedido" : salesOrderNextAction(order),
      href: `/comercial/pedidos?pedido=${encodeURIComponent(order.id)}`,
    };
  }).sort((a, b) => {
    if (a.deadline.sortAt !== b.deadline.sortAt) return a.deadline.sortAt < b.deadline.sortAt ? -1 : 1;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id);
  });
  // A replacement owns the next action; its failed parent stays in the history.
  const reprinted = new Set(snapshot.jobs.flatMap(job => job.reprint_of ? [job.reprint_of] : []));
  const currentJobs = snapshot.jobs.filter(job => !reprinted.has(job.id));
  const countJobs = (statuses: string[]) => currentJobs.filter(job => statuses.includes(job.status)).length;
  const stock = snapshot.materials.map(item => ({ item, balance: finiteStock(item.current_stock), minimum: finiteStock(item.min_stock) }));
  const lowStock = stock.filter((row): row is { item: DailyMaterial; balance: number; minimum: number } =>
    row.balance !== null && row.minimum !== null && row.minimum >= 0 && row.balance < row.minimum,
  ).sort((a, b) => a.item.name.localeCompare(b.item.name, "pt-BR") || a.item.id.localeCompare(b.item.id));
  return {
    orders,
    dueTodayCount: orders.filter(order => order.deadline.urgency === "today").length,
    overdueCount: orders.filter(order => order.deadline.urgency === "overdue").length,
    unknownDeadlineCount: orders.filter(order => order.deadline.kind === "unknown").length,
    uncheckedOrderCount: orders.filter(order => !order.workflowChecked).length,
    production: {
      queued: countJobs(["queued", "reprint"]), printing: countJobs(["printing"]),
      attention: countJobs(["paused", "failed"]), finishing: countJobs(["post_processing", "quality_check"]),
      ready: countJobs(["ready"]), draft: countJobs(["draft"]),
      unknown: currentJobs.filter(job => !["draft", "queued", "reprint", "printing", "paused", "failed", "post_processing", "quality_check", "ready", "completed", "shipped"].includes(job.status)).length,
    },
    lowStock,
    unknownStockCount: stock.filter(row => row.balance === null).length,
    unknownMinimumCount: stock.filter(row => row.minimum === null || row.minimum < 0).length,
    printers: [...snapshot.printers].sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id)),
  };
}
