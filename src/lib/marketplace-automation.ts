import { z } from "zod";
import { marketplaceRpc } from "./marketplace-orders";
import {readIntegradorBridgeBinding,requestIntegradorWorkspace} from './mercado-livre-integration';

const timestamp = z.string().datetime({ offset: true }).nullable();
const interval = z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]);
export const automationValuesSchema = z.object({
  orders_auto: z.boolean(), stock_auto: z.boolean(), price_auto: z.boolean(),
  safety_stock: z.number().int().min(0).max(1000),
  listing_type_default: z.enum(["gold_special", "gold_pro"]), interval_minutes: interval,
}).strict();
const statusSchema = z.object({ last_success_at: timestamp, last_run_at: timestamp, next_run_at: timestamp,
  last_error: z.string().max(1000).nullable(), pending_jobs: z.number().int().nonnegative(),
  running_jobs: z.number().int().nonnegative(), failed_jobs: z.number().int().nonnegative(),needs_review_actions:z.array(z.enum(['orders','stock','price'])).default([]) });
const snapshotSchema = z.object({ policy: automationValuesSchema.extend({ configured: z.boolean(), revision: z.string().min(1).max(200) }), status: statusSchema });
export type MarketplaceAutomationValues = z.infer<typeof automationValuesSchema>;
export type MarketplaceAutomation = z.infer<typeof snapshotSchema>;
function read<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("A rotina não retornou uma configuração válida. Atualize a consulta antes de salvar.");
  return parsed.data;
}
export const readMarketplaceAutomation = (accountId: string): Promise<MarketplaceAutomation> =>
  marketplaceRpc("read_marketplace_automation", { p_account_id: accountId }).then(value => read(snapshotSchema, value));
export async function saveMarketplaceAutomation(accountId: string, values: MarketplaceAutomationValues, revision: string, requestId: string): Promise<MarketplaceAutomation> {
  return read(snapshotSchema, await marketplaceRpc("save_marketplace_automation", { p_account_id: accountId,
    p_values: read(automationValuesSchema, values), p_expected_revision: revision, p_request_id: requestId }));
}
export async function requestMarketplaceAutomation(accountId: string, requestId: string): Promise<{ queued: number; status: MarketplaceAutomation["status"] }> {
  const value = read(z.object({ queued: z.number().int().nonnegative(), status: statusSchema }),
    await marketplaceRpc("request_marketplace_automation_sync", { p_account_id: accountId, p_request_id: requestId }));
  return { queued: value.queued, status: value.status };
}
export function automationValues(snapshot: MarketplaceAutomation): MarketplaceAutomationValues {
  return automationValuesSchema.parse(Object.fromEntries(Object.keys(automationValuesSchema.shape).map(key => [key, snapshot.policy[key as keyof typeof snapshot.policy]])));
}
export async function reviewMarketplaceAutomation(accountId:string,action:'orders'|'stock'|'price',requestId:string,context:{userId:string;signal?:AbortSignal}):Promise<{queued:number;status:MarketplaceAutomation['status']}>{
 const binding=await readIntegradorBridgeBinding();context.signal?.throwIfAborted();
 const mapping=binding.account_mappings.find(row=>row.account_id===accountId&&row.bridge_id===binding.bridge_id);
 if(!mapping)throw new Error('Confira a associação desta conta antes de revisar a rotina.');
 const result=read(z.object({queued:z.number().int().nonnegative(),status:statusSchema}),await requestIntegradorWorkspace(binding,'automation_review',mapping.source_seller_id,{account_id:accountId,automation_action:action,request_id:requestId,acknowledge_marketplace_write:true},context));
 return {queued:result.queued,status:result.status};
}
