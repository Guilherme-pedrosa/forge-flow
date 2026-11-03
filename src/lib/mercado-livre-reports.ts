import { z } from "zod";
import { requestIntegradorWorkspace, type IntegradorBridgeBinding } from "./mercado-livre-integration";

const amount = z.number().finite().nonnegative().nullable(), count = z.number().int().nonnegative().nullable(), text = z.string().max(2000), date = z.string().datetime({ offset: true });
export const overviewSchema = z.object({ seller_id: text, checked_at: date, period: z.object({ from: date, to: date }), metrics: z.object({ active_listings: count, paused_listings: count,
  under_review_listings: count, closed_listings: count, unanswered_questions: count, pending_conversations: count, paid_orders: count, cancelled_orders: count, paid_product_gross_amount: amount }),
  complete: z.boolean(), issues: z.array(text) });
export const reconciliationSchema = z.object({ seller_id: text, checked_at: date, items: z.array(z.object({ order_id: text, status: text, currency: z.literal("BRL"), products_gross_amount: amount, reported_total: amount,
  payments: z.array(z.object({ id: text, status: text.nullable(), release_status: text.nullable(), release_at: text.nullable(), gross_amount: amount, net_amount: amount, refunded_amount: amount,
    fee_amount: amount, fee_details: z.array(z.object({ type: text, amount: z.number().finite().nonnegative(), payer: text.nullable() })),
    release_state: z.enum(["released", "pending", "refunded", "cancelled", "rejected", "review"]), checked: z.boolean(), issue: text.nullable() })) })).max(20), total: count, next_offset: count, complete: z.boolean(), issues: z.array(text) });
export type MercadoLivreOverview = z.infer<typeof overviewSchema>;
export type MercadoLivreReconciliationResult = z.infer<typeof reconciliationSchema>;
export function mercadoLivreReportPeriod(from: string, to: string): { from: string; to: string } {
  const start = new Date(`${from}T00:00:00`), end = new Date(`${to}T23:59:59.999`);
  const sameDay = (value: Date, expected: string) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` === expected;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || !sameDay(start, from) || !sameDay(end, to) || end < start || end.getTime() - start.getTime() > 31 * 86400000) throw new Error("Escolha um período válido de até 31 dias.");
  return { from: start.toISOString(), to: end.toISOString() };
}
export async function readMercadoLivreOverview(binding: IntegradorBridgeBinding, seller: string, period: { from: string; to: string }, context: { userId: string; signal?: AbortSignal }): Promise<MercadoLivreOverview> {
  const r = overviewSchema.safeParse(await requestIntegradorWorkspace(binding, "workspace_overview", seller, period, context));
  if (!r.success || r.data.seller_id !== seller) throw new Error("Os indicadores desta conta não foram confirmados. Atualize a consulta.");
  return r.data;
}
export async function readMercadoLivreReconciliation(binding: IntegradorBridgeBinding, seller: string, period: { from: string; to: string }, offset: number, context: { userId: string; signal?: AbortSignal }): Promise<MercadoLivreReconciliationResult> {
  const r = reconciliationSchema.safeParse(await requestIntegradorWorkspace(binding, "fetch_reconciliation", seller, { ...period, offset }, context));
  if (!r.success || r.data.seller_id !== seller) throw new Error("Os recebimentos desta conta não foram confirmados. Atualize a consulta.");
  return r.data;
}
