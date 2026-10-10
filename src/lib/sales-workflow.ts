export type SalesWorkflowResult = {
  order_id: string;
  outcome: "stock_ready" | "production_queued" | "needs_preparation" | "already_organized";
  production_order_id: string | null;
  issues: string[];
};

export function readSalesWorkflowResult(value: unknown): SalesWorkflowResult {
  const result = value as SalesWorkflowResult | null;
  if (!result || typeof result.order_id !== "string" || !result.order_id ||
    !["stock_ready", "production_queued", "needs_preparation", "already_organized"].includes(result.outcome) ||
    !Array.isArray(result.issues) || result.issues.some(issue => typeof issue !== "string") ||
    (result.production_order_id !== null && typeof result.production_order_id !== "string")) {
    throw new Error("A confirmação não foi recebida. Atualize o pedido antes de repetir.");
  }
  return result;
}

export function salesOrderNextAction(order: { status: string; workflow_issues?: unknown }): string {
  if (["draft", "approved"].includes(order.status)) return Array.isArray(order.workflow_issues) && order.workflow_issues.length ? "Resolver pendências" : "Confirmar e organizar";
  return ({ in_production: "Acompanhar produção", ready: "Embalar e postar", shipped: "Confirmar entrega", delivered: "Entregue", cancelled: "Cancelado" } as Record<string, string>)[order.status] ?? "Abrir pedido";
}

export function operatingDateToIso(value: string, label: string, original?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Confira ${label}.`);
  // datetime-local displays minutes. Keep the full saved instant when it was not edited.
  if (original && /T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(original) && operatingDateInput(original) === value) return original;
  return date.toISOString();
}

export function operatingDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
