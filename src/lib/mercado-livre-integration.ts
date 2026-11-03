import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { marketplaceRpc, parseMarketplaceImport, type CanonicalMarketplaceOrder } from "./marketplace-orders";
import type { MarketplaceStockPreview } from "./marketplace-stock-preview";

// This origin/path is pinned before obtaining a session. A database value or a listing URL never chooses where the JWT is sent.
export const INTEGRADOR_ORIGIN = "https://integradorwedo.lovable.app";
export const INTEGRADOR_BRIDGE_ENDPOINT = `${INTEGRADOR_ORIGIN}/api/public/hooks/forge-bridge`;
export const INTEGRADOR_OAUTH_CALLBACK = `${INTEGRADOR_ORIGIN}/api/public/hooks/ml-oauth`;
export function integradorAuthorizationUrl(value: string): string {
  try {
    const url = new URL(value), callback = new URL(url.searchParams.get("redirect_uri") || "");
    if (url.origin !== "https://auth.mercadolivre.com.br" || url.pathname !== "/authorization" || url.username || url.password || url.hash
      || url.searchParams.get("response_type") !== "code" || !/^\d{1,40}$/.test(url.searchParams.get("client_id") || "") || !/^forge1\.[a-f0-9]{64}$/.test(url.searchParams.get("state") || "")
      || url.searchParams.get("code_challenge_method") !== "S256" || !/^[\w-]{43}$/.test(url.searchParams.get("code_challenge") || "")
      || callback.href !== INTEGRADOR_OAUTH_CALLBACK
      || ["access_token", "refresh_token", "id_token", "client_secret", "code"].some(key => url.searchParams.has(key))) throw new Error();
    return url.href;
  } catch { throw new Error("O endereço de autorização não corresponde ao Mercado Livre e ao retorno aprovado do Integrador."); }
}
export function openIntegradorAuthorization(value: string): void { window.location.assign(integradorAuthorizationUrl(value)); }
const text = z.string().max(1000);
const nullableText = text.nullable().optional().default(null);
const identifier = z.string().min(1).max(160);
const quantity = z.number().finite().nonnegative().nullable().optional().default(null);
const sourceAccount = z.object({ seller_id: identifier, nickname: nullableText, credentials_configured: z.boolean(), expires_at: nullableText });
const enrollmentAppSchema = z.object({ client_id: nullableText, client_secret_configured: z.boolean(), configured: z.boolean(), redirect_uri: z.literal(INTEGRADOR_OAUTH_CALLBACK), revision: z.string().min(1).max(200), can_manage: z.boolean() });
export type IntegradorEnrollmentApp = z.infer<typeof enrollmentAppSchema>;
export type IntegradorEnrollmentAppChanges = { client_id: string; client_secret?: string };
const settings = z.object({ client_id: nullableText, client_secret_configured: z.boolean(), redirect_uri: nullableText,
  configured: z.boolean(), configuration_source: z.enum(["integrador", "tenant", "server", "none"]).optional().default("integrador"), revision: nullableText,
  enabled: z.boolean().nullable().optional().default(null), markup_percent: quantity, stock_safety: quantity,
  listing_type_default: z.preprocess(value => value === "" ? null : value, z.enum(["gold_special", "gold_pro"]).nullable().optional().default(null)), tipo_valor_venda: nullableText,
  full_scope: z.boolean().optional().default(false), can_manage_settings: z.boolean().optional().default(false), can_manage_app: z.boolean().optional().default(false), read_only: z.boolean().optional().default(true) });
const readinessSchema = z.object({
  settings,
  bridge: z.object({ configured: z.boolean(), source_url: nullableText, revision: nullableText, seller_ids: z.array(identifier).optional().default([]) }).optional(),
  source_accounts: z.array(sourceAccount),
  source_jobs: z.object({ pending_stock_jobs: quantity, running_stock_jobs: quantity, failed_stock_jobs: quantity }).optional(),
  capabilities: z.object({ read_listings: z.boolean(), write_stock: z.literal(false), write_prices: z.literal(false) }).optional(),
  manual_operations: z.object({ available: z.boolean(), automatic_writes: z.literal(false), ownership_confirmation_required: z.literal(true), accepted_forge_channel_price_required: z.literal(true) }).optional(),
  enrollment: z.object({ allowed: z.boolean(), configured: z.boolean(), connected_seller_count: z.number().int().nonnegative() }).optional(),
  enrollment_app: enrollmentAppSchema.nullable().optional().default(null),
});
export type MercadoLivreReadiness = z.infer<typeof readinessSchema>;
export type IntegradorSettings = MercadoLivreReadiness["settings"];
export type IntegradorSourceAccount = z.infer<typeof sourceAccount>;
const bindingSchema = z.object({ configured: z.boolean(), bridge_id: nullableText, source_url: nullableText,
  revision: nullableText, approved_seller_ids: z.array(identifier).optional().default([]), enabled: z.boolean().optional().default(false),
  allow_enrollment: z.boolean().optional().default(false),
  account_mappings: z.array(z.object({ account_id: identifier, source_seller_id: identifier, bridge_id: identifier })).optional().default([]) });
export type IntegradorBridgeBinding = z.infer<typeof bindingSchema>;
const attribute = z.object({ id: nullableText, name: nullableText, value_name: nullableText });
const variation = z.object({ id: identifier, sku: nullableText, attributes: z.array(attribute).optional().default([]), price: quantity, available_quantity: quantity });
const listing = z.object({ id: identifier, title: text, status: text, permalink: nullableText, thumbnail: nullableText,
  currency_id: nullableText, price: quantity, available_quantity: quantity, sku: nullableText, variations: z.array(variation).optional().default([]) });
const listingsSchema = z.object({ items: z.array(listing).max(100), offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(), next_offset: z.number().int().nonnegative().nullable() });
export type MercadoLivreListing = z.infer<typeof listing>;
export type MercadoLivreListings = z.infer<typeof listingsSchema>;
export type MarketplaceListingIdentity = { external_item_id: string; external_variant_id: string; external_sku: string };

function parsed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("O Integrador retornou dados incompletos. Recarregue a conexão antes de continuar.");
  return result.data;
}
export const readMercadoLivreReadiness = (value: unknown): MercadoLivreReadiness => parsed(readinessSchema, value);
export const readMercadoLivreListings = (value: unknown): MercadoLivreListings => parsed(listingsSchema, value);
export function integrationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof (error as { message?: unknown })?.message === "string" ? String((error as { message: string }).message) : "Não foi possível consultar o Integrador. Tente novamente.";
  return raw.replace(/Bearer\s+\S+/gi, "Bearer [omitido]").replace(/((?:access_token|refresh_token|client_secret|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[omitido]").slice(0, 600);
}
export async function readIntegradorBridgeBinding(): Promise<IntegradorBridgeBinding> {
  return parsed(bindingSchema, await marketplaceRpc("integrador_bridge_binding", {}));
}
function assertSource(binding: IntegradorBridgeBinding) {
  if (!binding.configured || !binding.enabled || !binding.bridge_id) throw new Error("A conexão desta empresa com o Integrador precisa ser associada antes da consulta.");
  if (![INTEGRADOR_ORIGIN, `${INTEGRADOR_ORIGIN}/`, INTEGRADOR_BRIDGE_ENDPOINT].includes(binding.source_url ?? "")) throw new Error("O endereço do Integrador não corresponde à conexão aprovada desta empresa.");
}
export type IntegradorWorkspaceAction = "listing_details" | "listing_edit" | "listing_status" | "publication_prepare" | "publication_commit" | "publication_categories" | "publication_catalog_search" | "publication_reference" | "publication_quote" | "publication_quote_accept" | "questions_list" | "question_reply" | "messages_list" | "message_read" | "message_mark_read" | "message_reply" | "workspace_overview" | "fetch_reconciliation" | "automation_review";
type BridgeAction = IntegradorWorkspaceAction | "settings_readiness" | "revalidate_account" | "fetch_listings" | "fetch_orders" | "fetch_recent_orders" | "settings_save" | "stock_preview" | "takeover_stock" | "sync_stock" | "sync_price" | "enrollment_begin" | "enrollment_finish" | "enrollment_app_save";
async function sourceRequest(binding: IntegradorBridgeBinding, action: BridgeAction, args: { source_seller_id?: string; offset?: number; limit?: number; order_ids?: string[]; from?: string; to?: string;
  settings?: IntegradorSettingsChanges; expected_revision?: string; request_id?: string; acknowledge_scheduled_effects?: true; account_id?: string | null; product_ids?: string[]; acknowledge_takeover?: true; acknowledge_marketplace_write?: true; return_origin?: string; receipt?: string; app?: IntegradorEnrollmentAppChanges } & Record<string, unknown>, context: { userId: string; signal?: AbortSignal }): Promise<unknown> {
  assertSource(binding); context.signal?.throwIfAborted();
  if (args.source_seller_id && !binding.approved_seller_ids.includes(args.source_seller_id)) throw new Error("Selecione um vendedor aprovado para esta empresa.");
  const controller = new AbortController();
  const abort = () => controller.abort(context.signal?.reason);
  context.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("A operação no Integrador demorou mais que o esperado. Confira o resultado antes de confirmar outra operação.")), ["stock_preview", "takeover_stock", "sync_stock", "sync_price", "publication_prepare", "publication_commit", "publication_quote", "publication_quote_accept", "publication_reference", "messages_list", "questions_list", "workspace_overview", "fetch_reconciliation"].includes(action) ? 90000 : 20000);
  const bounded = <T,>(operation: PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => {
    if (controller.signal.aborted) { reject(controller.signal.reason); return; }
    const cancelled = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", cancelled, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", cancelled));
  });
  try {
  const { data, error } = await bounded(supabase.auth.getSession());
  context.signal?.throwIfAborted();
  if (error || !data.session?.access_token || !context.userId || data.session.user.id !== context.userId) throw new Error("Sua sessão mudou. Entre novamente antes de consultar o Integrador.");
  const response = await bounded(fetch(INTEGRADOR_BRIDGE_ENDPOINT, { method: "POST", credentials: "omit", redirect: "error", signal: controller.signal,
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ bridge_id: binding.bridge_id, action, ...args }) }));
  context.signal?.throwIfAborted();
  let value: unknown;
  try { value = await bounded(response.json()); } catch (failure) { if (controller.signal.aborted) throw controller.signal.reason; throw new Error("O Integrador não retornou uma resposta válida. Confira a conexão e tente novamente."); }
  context.signal?.throwIfAborted();
  if (!response.ok || value && typeof value === "object" && "error" in value) {
    const message = value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string" ? (value as { error: string }).error : `A consulta ao Integrador falhou (HTTP ${response.status}).`;
    const code = value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string" && /^bridge_[a-z_]{1,100}$/.test(String((value as { code: string }).code)) ? (value as { code: string }).code : undefined;
    throw Object.assign(new Error(integrationErrorMessage(new Error(message))), { status: response.status, ...(code ? { code } : {}) });
  }
  return value;
  } finally { clearTimeout(timer); context.signal?.removeEventListener("abort", abort); }
}
export function requestIntegradorWorkspace(binding: IntegradorBridgeBinding, action: IntegradorWorkspaceAction, sellerId: string, payload: Record<string, unknown>, context: { userId: string; signal?: AbortSignal }): Promise<unknown> {
  if (["bridge_id", "action", "source_seller_id"].some(key => key in payload)) throw new Error("Confira a conta da operação antes de continuar.");
  return sourceRequest(binding, action, { ...payload, source_seller_id: sellerId }, context);
}
function approvedReadiness(binding: IntegradorBridgeBinding, value: unknown): MercadoLivreReadiness {
  const result = readMercadoLivreReadiness(value);
  return { ...result, source_accounts: result.source_accounts.filter(account => binding.approved_seller_ids.includes(account.seller_id)) };
}
export async function readIntegradorReadiness(binding: IntegradorBridgeBinding, context: { userId: string; signal?: AbortSignal }): Promise<MercadoLivreReadiness> {
  return approvedReadiness(binding, await sourceRequest(binding, "settings_readiness", {}, context));
}
export async function saveIntegradorEnrollmentApp(binding: IntegradorBridgeBinding, app: IntegradorEnrollmentAppChanges, revision: string, requestId: string, context: { userId: string; signal?: AbortSignal }): Promise<MercadoLivreReadiness> {
  const clientId = app.client_id.trim(), secret = app.client_secret?.trim();
  if (!binding.allow_enrollment || !/^\d{1,40}$/.test(clientId) || !revision || secret && secret.length > 400) throw new Error("Confira o Client ID e a configuração da sua API antes de salvar.");
  return approvedReadiness(binding, await sourceRequest(binding, "enrollment_app_save", { app: { client_id: clientId, ...(secret ? { client_secret: secret } : {}) }, expected_revision: revision, request_id: requestId }, context));
}
const enrollmentReceipt = /^[\da-f]{64}$/;
export function validIntegradorEnrollmentReceipt(value: string): boolean { return enrollmentReceipt.test(value); }
export async function beginIntegradorEnrollment(binding: IntegradorBridgeBinding, accountId: string | null, returnOrigin: string, requestId: string, context: { userId: string; signal?: AbortSignal }): Promise<{ authorization_url: string; attempt_id: string; expires_at: string }> {
  if (!binding.allow_enrollment) throw new Error("A conexão de uma nova conta ainda não foi habilitada para esta empresa.");
  if (accountId !== null && !z.string().uuid().safeParse(accountId).success) throw new Error("Selecione um cadastro pendente válido do Forge.");
  let origin: URL; try { origin = new URL(returnOrigin); if (origin.origin !== returnOrigin || origin.protocol !== "https:") throw new Error(); } catch { throw new Error("Abra o Forge pelo endereço HTTPS autorizado antes de conectar a conta."); }
  const result = parsed(z.object({ authorization_url: z.string().max(8192), attempt_id: z.string().uuid(), expires_at: z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value))) }),
    await sourceRequest(binding, "enrollment_begin", { account_id: accountId, return_origin: origin.origin, request_id: requestId }, context));
  return { authorization_url: integradorAuthorizationUrl(result.authorization_url), attempt_id: result.attempt_id, expires_at: result.expires_at };
}
export type IntegradorEnrollmentResult = { connected: true; account_id: string; seller_id: string; nickname: string; replayed: boolean };
export async function finishIntegradorEnrollment(binding: IntegradorBridgeBinding, receipt: string, requestId: string, context: { userId: string; signal?: AbortSignal }): Promise<IntegradorEnrollmentResult> {
  if (!binding.allow_enrollment || !validIntegradorEnrollmentReceipt(receipt)) throw new Error("O retorno da conexão não é válido. Comece a autorização da conta novamente.");
  const result = parsed(z.object({ connected: z.literal(true), account_id: z.string().uuid(), seller_id: identifier, nickname: text, replayed: z.boolean() }),
    await sourceRequest(binding, "enrollment_finish", { receipt, request_id: requestId }, context));
  return { connected: result.connected, account_id: result.account_id, seller_id: result.seller_id, nickname: result.nickname, replayed: result.replayed };
}
export async function revalidateIntegradorAccount(binding: IntegradorBridgeBinding, sellerId: string, context: { userId: string; signal?: AbortSignal }): Promise<IntegradorSourceAccount> {
  const result = parsed(z.object({ verified: z.literal(true), account: sourceAccount }), await sourceRequest(binding, "revalidate_account", { source_seller_id: sellerId }, context));
  if (result.account.seller_id !== sellerId) throw new Error("A conta conferida não corresponde ao vendedor selecionado.");
  return result.account;
}
export async function fetchIntegradorListings(binding: IntegradorBridgeBinding, sellerId: string, offset: number, context: { userId: string; signal?: AbortSignal }, filters: { q?: string; status?: string } = {}): Promise<MercadoLivreListings> {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("A página de anúncios não é válida.");
  if (filters.q && filters.q.trim().length > 120 || filters.status && !["active", "paused", "under_review", "closed"].includes(filters.status)) throw new Error("Confira os filtros dos anúncios.");
  return readMercadoLivreListings(await sourceRequest(binding, "fetch_listings", { source_seller_id: sellerId, offset, limit: 20, ...(filters.q?.trim() ? { q: filters.q.trim() } : {}), ...(filters.status ? { status: filters.status } : {}) }, context));
}
export type IntegradorOrders = { orders: CanonicalMarketplaceOrder[]; next_offset: number | null; fetched: number; total: number; truncated: boolean };
export async function fetchIntegradorMarketplaceOrders(binding: IntegradorBridgeBinding, sellerId: string, selection: { order_ids: string[] } | { from: string; to: string; offset: number }, context: { userId: string; signal?: AbortSignal }): Promise<IntegradorOrders> {
  if ("order_ids" in selection) {
    if (!selection.order_ids.length || selection.order_ids.length > 20 || selection.order_ids.some(id => !/^\d{1,24}$/.test(id))) throw new Error("Informe de 1 a 20 IDs de pedidos como texto.");
  } else if (!Number.isFinite(Date.parse(selection.from)) || !Number.isFinite(Date.parse(selection.to)) || Date.parse(selection.to) < Date.parse(selection.from)
    || Date.parse(selection.to) - Date.parse(selection.from) > 31 * 86400000 || !Number.isInteger(selection.offset) || selection.offset < 0 || selection.offset > 80 || selection.offset % 20 !== 0) throw new Error("Confira o período de até 31 dias e a página dos pedidos.");
  const action = "order_ids" in selection ? "fetch_orders" : "fetch_recent_orders";
  const raw = parsed(z.object({ orders: z.array(z.unknown()).max(100), next_offset: z.number().int().nonnegative().nullable(), fetched: z.number().int().nonnegative(), total: z.number().int().nonnegative(), truncated: z.boolean() }),
    await sourceRequest(binding, action, { source_seller_id: sellerId, ...selection }, context));
  return { orders: raw.orders.length ? parseMarketplaceImport(JSON.stringify(raw.orders), "json") : [], next_offset: raw.next_offset, fetched: raw.fetched, total: raw.total, truncated: raw.truncated };
}
export async function linkIntegradorMarketplaceAccount(sellerId: string, name: string, accountId: string | null, requestId: string): Promise<string> {
  const result = await marketplaceRpc<unknown>("link_integrador_marketplace_account", { p_source_seller_id: sellerId, p_name: name, p_account_id: accountId, p_request_id: requestId });
  if (typeof result !== "string" || !result.trim()) throw new Error("A associação não foi confirmada. Tente novamente para conferir a mesma operação.");
  return result;
}
export type IntegradorSettingsDraft = { enabled: boolean | null; markup_percent: string; stock_safety: string; listing_type_default: string; tipo_valor_venda: string; client_id: string; client_secret: string };
export type IntegradorSettingsChanges = Partial<{ enabled: boolean; markup_percent: number; stock_safety: number; listing_type_default: "gold_special" | "gold_pro"; tipo_valor_venda: string; client_id: string; client_secret: string }>;
export function integradorSettingsDraft(value: IntegradorSettings): IntegradorSettingsDraft {
  return { enabled: value.enabled, markup_percent: value.markup_percent == null ? "" : String(value.markup_percent), stock_safety: value.stock_safety == null ? "" : String(value.stock_safety),
    listing_type_default: value.listing_type_default ?? "", tipo_valor_venda: value.tipo_valor_venda ?? "", client_id: value.client_id ?? "", client_secret: "" };
}
export function prepareIntegradorSettingsChanges(draft: IntegradorSettingsDraft, original: IntegradorSettings): IntegradorSettingsChanges {
  if (!original.full_scope || original.read_only || !original.can_manage_settings && !original.can_manage_app) throw new Error("Esta conexão permite apenas consultar a configuração do Integrador.");
  const previous = integradorSettingsDraft(original), changes: IntegradorSettingsChanges = {};
  if (original.can_manage_settings) {
    if (draft.enabled !== previous.enabled) { if (draft.enabled == null) throw new Error("Confirme se as rotinas ficam habilitadas."); changes.enabled = draft.enabled; }
    for (const [key, label, max, integer] of [["markup_percent", "Acréscimo do Integrador", 200, false], ["stock_safety", "Reserva de estoque", 1000, true]] as const) {
      if (draft[key] === previous[key]) continue;
      const raw = draft[key].trim(), value = Number(raw.replace(",", "."));
      if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw) || !Number.isFinite(value) || value < 0 || value > max || integer && !Number.isInteger(value)) throw new Error(`${label}: informe um valor de 0 a ${max}${integer ? ", em unidades inteiras" : ""}.`);
      changes[key] = value;
    }
    if (draft.listing_type_default !== previous.listing_type_default) {
      if (!["gold_special", "gold_pro"].includes(draft.listing_type_default)) throw new Error("Escolha o tipo padrão de anúncio."); changes.listing_type_default = draft.listing_type_default as "gold_special" | "gold_pro";
    }
    if (draft.tipo_valor_venda !== previous.tipo_valor_venda) { const value = draft.tipo_valor_venda.trim(); if (!value || value.length > 40) throw new Error("Confira a tabela de preços usada pelo Integrador."); changes.tipo_valor_venda = value; }
  }
  if (original.can_manage_app) {
    if (draft.client_id !== previous.client_id) { if (!/^\d{1,40}$/.test(draft.client_id.trim())) throw new Error("Informe um Client ID válido."); changes.client_id = draft.client_id.trim(); }
    if (draft.client_secret.trim()) { if (draft.client_secret.trim().length > 4096) throw new Error("Confira o segredo do aplicativo."); changes.client_secret = draft.client_secret.trim(); }
  }
  return changes;
}
export async function integradorSettingsSignature(changes: IntegradorSettingsChanges, revision: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([revision, changes])));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}
export async function saveIntegradorSettings(binding: IntegradorBridgeBinding, changes: IntegradorSettingsChanges, expectedRevision: string, requestId: string, context: { userId: string; signal?: AbortSignal }) {
  return parsed(z.object({ saved: z.literal(true), accepted_revision: z.string().min(1), replayed: z.boolean(), marketplace_api_writes: z.literal(false) }),
    await sourceRequest(binding, "settings_save", { settings: changes, expected_revision: expectedRevision, request_id: requestId, acknowledge_scheduled_effects: true }, context));
}

const stockAmount = z.number().int().min(0).max(1e9), stockNullable = stockAmount.nullable();
const stockProduct = z.object({ productId: identifier, available: stockNullable, unaccountedPaidQuantity: stockAmount, budget: stockNullable, allocatedQuantity: stockAmount, unallocatedQuantity: stockNullable, complete: z.boolean(), issues: z.array(text) });
const stockBucket = z.object({ key: text, productId: identifier, sellerId: identifier, accountIds: z.array(identifier), itemIds: z.array(identifier), userProductId: nullableText, currentQuantity: stockNullable, proposedQuantity: stockNullable, allocatedQuantity: stockAmount, safeToIncrease: z.boolean(), preserveStatus: z.literal(true), requiresReview: z.boolean(), issues: z.array(text) });
const stockTarget = z.object({ account_id: identifier, product_id: identifier, seller_id: identifier, item_id: identifier });
const priceTarget = stockTarget.extend({ current_price: quantity, accepted_price: quantity, acceptance_id: nullableText, issue: nullableText });
const manualPreviewSchema = z.object({ revision: z.string().regex(/^[\da-f]{64}$/), claimed: z.boolean(), complete: z.boolean(), issues: z.array(text), stock_owner: z.enum(["forge", "integrador"]), manual_confirmation_required: z.literal(true),
  targets: z.array(stockTarget).max(1000), prices: z.array(priceTarget).max(1000), preview: z.object({ tenantId: identifier, previewOnly: z.literal(true), writesEnabled: z.literal(false), complete: z.boolean(), products: z.array(stockProduct).max(1000), buckets: z.array(stockBucket).max(1000), issues: z.array(text) }) });
export type IntegradorManualSelection = { account_id: string; source_seller_id: string; product_ids: string[] };
export type IntegradorManualPreview = { revision: string; claimed: boolean; complete: boolean; issues: string[]; stock_owner: "forge" | "integrador"; manual_confirmation_required: true;
  targets: { account_id: string; product_id: string; seller_id: string; item_id: string }[];
  prices: { account_id: string; product_id: string; seller_id: string; item_id: string; current_price: number | null; accepted_price: number | null; acceptance_id: string | null; issue: string | null }[];
  preview: MarketplaceStockPreview };
export type IntegradorManualReceipt = { confirmed: true; action: "stock" | "price"; accepted_revision: string; replayed: boolean; items: { seller_id: string; item_id: string; quantity: number | null; price: number | null; status: string }[] };
function manualSelection(binding: IntegradorBridgeBinding, selection: IntegradorManualSelection): IntegradorManualSelection {
  const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
  if (!uuid.test(selection.account_id) || !selection.product_ids.length || selection.product_ids.length > 50 || selection.product_ids.some(id => !uuid.test(id))) throw new Error("Selecione de 1 a 50 produtos vinculados nesta conta.");
  if (!binding.account_mappings.some(row => row.account_id === selection.account_id && row.source_seller_id === selection.source_seller_id && row.bridge_id === binding.bridge_id)) throw new Error("Confira a associação desta conta com o vendedor do Integrador.");
  return { account_id: selection.account_id, source_seller_id: selection.source_seller_id, product_ids: [...new Set(selection.product_ids)].sort() };
}
function manualPreview(value: unknown, tenantId: string): IntegradorManualPreview {
  // Every required field is runtime-validated before bridging to the existing stock-preview types.
  const result = parsed(manualPreviewSchema, value) as IntegradorManualPreview;
  if (result.preview.tenantId !== tenantId || result.claimed && result.stock_owner !== "forge") throw new Error("A prévia não corresponde à empresa ou ao responsável confirmado.");
  return result;
}
export async function readIntegradorStockPreview(binding: IntegradorBridgeBinding, selection: IntegradorManualSelection, context: { userId: string; tenantId: string; signal?: AbortSignal }): Promise<IntegradorManualPreview> {
  return manualPreview(await sourceRequest(binding, "stock_preview", manualSelection(binding, selection), context), context.tenantId);
}
export async function takeoverIntegradorStock(binding: IntegradorBridgeBinding, selection: IntegradorManualSelection, revision: string, requestId: string, context: { userId: string; tenantId: string; signal?: AbortSignal }): Promise<IntegradorManualPreview> {
  const value = await sourceRequest(binding, "takeover_stock", { ...manualSelection(binding, selection), expected_revision: revision, request_id: requestId, acknowledge_takeover: true }, context);
  parsed(z.object({ claimed: z.literal(true), marketplace_api_writes: z.literal(false), accepted_revision: z.string().regex(/^[\da-f]{64}$/), replayed: z.boolean() }), value);
  return manualPreview(value, context.tenantId);
}
export async function syncIntegradorManual(binding: IntegradorBridgeBinding, action: "stock" | "price", selection: IntegradorManualSelection, revision: string, requestId: string, context: { userId: string; signal?: AbortSignal }): Promise<IntegradorManualReceipt> {
  const value = parsed(z.object({ confirmed: z.literal(true), action: z.enum(["stock", "price"]), accepted_revision: z.string().regex(/^[\da-f]{64}$/), replayed: z.boolean(), items: z.array(z.object({ seller_id: identifier, item_id: identifier, quantity: stockNullable, price: quantity, status: text })).max(1000) }),
    await sourceRequest(binding, action === "stock" ? "sync_stock" : "sync_price", { ...manualSelection(binding, selection), expected_revision: revision, request_id: requestId, acknowledge_marketplace_write: true }, context));
  if (value.action !== action) throw new Error("A confirmação recebida não corresponde à operação solicitada.");
  return value as IntegradorManualReceipt;
}
export function listingIdentity(item: MercadoLivreListing, variant?: MercadoLivreListing["variations"][number]): MarketplaceListingIdentity {
  return { external_item_id: item.id, external_variant_id: variant?.id ?? "", external_sku: variant?.sku ?? item.sku ?? "" };
}
export function publicListingUrl(value: string | null): string | null {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
