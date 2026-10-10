import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeShopeeOrder, numericId, object, orderId, SHOPEE_HOSTS, signedShopeeUrl, type ShopeeConfig } from "./shopee.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version", "Access-Control-Allow-Methods": "POST, OPTIONS" };
type Data = Record<string, unknown>;
class RequestError extends Error { constructor(message: string, readonly status = 400, readonly reauthorize = false) { super(message); } }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
function configuration(): ShopeeConfig {
  const partnerId = Deno.env.get("SHOPEE_PARTNER_ID"), partnerKey = Deno.env.get("SHOPEE_PARTNER_KEY"), redirect = Deno.env.get("SHOPEE_REDIRECT_URI");
  if (!partnerId || !partnerKey || !redirect) throw new RequestError("Configure SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY e SHOPEE_REDIRECT_URI no servidor para autorizar a Shopee. A importação por arquivo continua disponível.", 409);
  const region = Deno.env.get("SHOPEE_API_REGION") ?? "BR";
  if (region !== "BR" && region !== "GLOBAL") throw new RequestError("SHOPEE_API_REGION deve ser BR ou GLOBAL.", 409);
  let uri: URL; try { numericId(partnerId); uri = new URL(redirect); } catch { throw new RequestError("Identificação do aplicativo ou retorno Shopee inválidos no servidor.", 409); }
  if (uri.protocol !== "https:" || uri.hash || uri.search || partnerKey.length > 16384) throw new RequestError("O retorno Shopee precisa ser HTTPS e corresponder ao endereço cadastrado no aplicativo.", 409);
  return { partnerId, partnerKey, redirect, host: SHOPEE_HOSTS[region] };
}
async function checked<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise; if (error) throw new RequestError(error.message); return data;
}
async function api(config: ShopeeConfig, path: string, params: Record<string, string> = {}, credentials?: { token: string; shopId: string }, body?: Data): Promise<Data> {
  const url = await signedShopeeUrl(config, path, params, credentials);
  const response = await fetch(url, { method: body ? "POST" : "GET", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new RequestError(`Shopee retornou HTTP ${response.status}. Confira o acesso do aplicativo.`, response.status === 401 ? 401 : 502, response.status === 401);
  const raw = object(await response.json());
  if (raw.error) {
    // Do not relay upstream messages or URLs: they can contain codes, tokens or signatures.
    const code = typeof raw.error === "string" && /^[\w.-]{1,120}$/.test(raw.error) ? raw.error : "resposta inválida";
    const reauthorize = ["invalid_access_token", "invalid_acceess_token", "refresh_token_expired", "invalid_refresh_token"].includes(code) ||
      path === "/api/v2/auth/access_token/get" && ["error_auth", "error_shop_refresh_token", "shop_no_linked"].includes(code);
    throw new RequestError(`A Shopee recusou a operação (${code}). Confira autorização e permissões do aplicativo.`, reauthorize ? 401 : 502, reauthorize);
  }
  // Auth and get_shop_info are top-level; Orders resources use the response object.
  return raw.response == null ? raw : object(raw.response);
}
async function exchange(config: ShopeeConfig, shopId: string, value: { code: string } | { refresh_token: string }) {
  const refresh = "refresh_token" in value;
  const raw = await api(config, refresh ? "/api/v2/auth/access_token/get" : "/api/v2/auth/token/get", {}, undefined, { ...value, shop_id: Number(shopId), partner_id: Number(config.partnerId) });
  if (typeof raw.access_token !== "string" || !raw.access_token || raw.access_token.length > 16384 || typeof raw.refresh_token !== "string" || !raw.refresh_token || raw.refresh_token.length > 16384 || typeof raw.expire_in !== "number" || !Number.isInteger(raw.expire_in) || raw.expire_in <= 0 || raw.expire_in > 86400) throw new RequestError("A Shopee retornou credenciais incompletas ou prazo de acesso inválido.", 502);
  if (raw.shop_id != null && numericId(raw.shop_id) !== shopId) throw new RequestError("A autorização retornada pertence a outra loja Shopee.", 409);
  if (Array.isArray(raw.shop_id_list) && raw.shop_id_list.length && !raw.shop_id_list.some(id => numericId(id) === shopId)) throw new RequestError("Esta loja não consta na autorização Shopee retornada.", 409);
  return { access_token: raw.access_token, refresh_token: raw.refresh_token, expires_at: new Date(Date.now() + raw.expire_in * 1000).toISOString() };
}
const detailFields = "item_list,pay_time,total_amount,payment_method,package_list";
async function getOrders(config: ShopeeConfig, ids: string[], credentials: { token: string; shopId: string }) {
  if (!ids.length) return [];
  const response = await api(config, "/api/v2/order/get_order_detail", { order_sn_list: ids.join(","), response_optional_fields: detailFields, request_order_status_pending: "true" }, credentials);
  if (!Array.isArray(response.order_list) || response.order_list.length !== ids.length) throw new RequestError("A Shopee não retornou todos os pedidos solicitados. Nenhum pedido desta consulta foi importado.", 502);
  const found = response.order_list.map(raw => orderId(object(raw).order_sn));
  if (new Set(found).size !== found.length || found.some(id => !ids.includes(id))) throw new RequestError("A Shopee retornou uma lista de pedidos diferente da solicitada.", 502);
  try { return response.order_list.map(normalizeShopeeOrder); }
  catch (error) { throw new RequestError(error instanceof Error ? error.message : "Dados Shopee inválidos."); }
}

// JWT remains enabled in deployment config. The handler also verifies session, role and tenant.
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  let service: SupabaseClient | undefined, lockedAccount: string | undefined, lease: string | undefined, invalidateExistingAuthorization = false;
  try {
    const header = req.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) throw new RequestError("Sessão autenticada obrigatória.", 401);
    const session = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
    const { data: { user }, error } = await session.auth.getUser(header.slice(7));
    if (error || !user) throw new RequestError("Sessão inválida.", 401);
    const tenant = await checked(session.rpc("get_user_tenant_id"));
    if (!tenant || !await checked(session.rpc("erp_can_write", { financial: false }))) throw new RequestError("Seu perfil não pode consultar esta integração.", 403);
    const text = await req.text();
    if (new TextEncoder().encode(text).length > 65536) throw new RequestError("Requisição acima de 64 KB.", 413);
    const body = object(JSON.parse(text));
    const action = body.action;
    if (!["oauth_begin", "oauth_exchange", "fetch_orders", "fetch_recent_orders"].includes(String(action))) throw new RequestError("Operação Shopee desconhecida.");
    if (["oauth_begin", "oauth_exchange"].includes(String(action)) && !await checked(session.rpc("erp_can_write", { financial: true }))) throw new RequestError("Somente responsáveis pela conta podem autorizar a Shopee.", 403);
    const config = configuration();
    service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    let accountId = body.account_id;
    if (action === "oauth_exchange") {
      if (!uuid(body.state) || typeof body.code !== "string" || body.code.length < 1 || body.code.length > 1000) throw new RequestError("Código ou estado Shopee inválido.");
      numericId(body.shop_id);
      const states = await checked(service.from("marketplace_oauth_states").delete().eq("state", body.state).eq("user_id", user.id).gt("expires_at", new Date().toISOString()).select("account_id"));
      if (!states?.[0]) throw new RequestError("Autorização Shopee expirada ou já utilizada. Comece novamente.");
      accountId = states[0].account_id;
    }
    if (!uuid(accountId)) throw new RequestError("Conta Shopee inválida.");
    const account = await checked(session.from("marketplace_accounts").select("id,tenant_id,channel,external_seller_id,connection_state").eq("id", accountId).eq("tenant_id", tenant).single());
    if (account.channel !== "shopee") throw new RequestError("Selecione uma conta Shopee para esta consulta.", 409);
    if (action === "oauth_begin") {
      const state = crypto.randomUUID();
      await checked(service.from("marketplace_oauth_states").insert({ state, account_id: account.id, user_id: user.id }));
      // Current official Developer Guide uses /auth with native, returned-as-is CSRF state.
      const url = new URL(config.host === SHOPEE_HOSTS.BR ? "https://open.shopee.com.br/auth" : "https://open.shopee.com/auth");
      url.search = new URLSearchParams({ partner_id: config.partnerId, auth_type: "seller", redirect_uri: config.redirect, response_type: "code", state }).toString();
      return reply({ authorization_url: url.toString() });
    }
    if (action === "oauth_exchange") {
      const shopId = numericId(body.shop_id);
      if (account.external_seller_id && account.external_seller_id !== shopId) throw new RequestError("A autorização pertence a outra loja Shopee. Confira o ID da conta.", 409);
      const lock = await checked(service.rpc("claim_marketplace_sync", { p_account_id: account.id }));
      if (!lock) throw new RequestError("A conta Shopee está sendo consultada. Inicie a autorização novamente após a consulta.", 409);
      lease = String(lock); lockedAccount = account.id;
      const tokens = await exchange(config, shopId, { code: body.code as string });
      const shop = await api(config, "/api/v2/shop/get_shop_info", {}, { token: tokens.access_token, shopId });
      if (shop.region !== "BR" || shop.status !== "NORMAL") throw new RequestError("A loja autorizada precisa estar ativa no Brasil para esta integração.", 409);
      await checked(service.rpc("persist_shopee_credentials", { p_account_id: account.id, p_lease: lease, p_shop_id: shopId, p_access_token: tokens.access_token, p_refresh_token: tokens.refresh_token, p_expires_at: tokens.expires_at }));
      return reply({ connected: true, account_id: account.id });
    }
    if (account.connection_state !== "connected") throw new RequestError("Autorize a loja Shopee antes de consultar pedidos.", 409);
    invalidateExistingAuthorization = true;
    const shopId = numericId(account.external_seller_id);
    const lock = await checked(service.rpc("claim_marketplace_sync", { p_account_id: account.id }));
    if (!lock) throw new RequestError("Uma consulta desta loja Shopee já está em andamento. Tente novamente em instantes.", 409);
    lease = String(lock); lockedAccount = account.id;
    let credentials = await checked(service.from("marketplace_credentials").select("access_token,refresh_token,expires_at").eq("account_id", account.id).single());
    if (!Number.isFinite(Date.parse(credentials.expires_at))) throw new RequestError("A autorização Shopee tem prazo inválido. Autorize novamente.", 409, true);
    if (Date.parse(credentials.expires_at) < Date.now() + 60000) {
      const tokens = await exchange(config, shopId, { refresh_token: credentials.refresh_token });
      // Refresh tokens are single-use. Persist their rotated pair under the same account lease.
      await checked(service.rpc("persist_shopee_credentials", { p_account_id: account.id, p_lease: lease, p_shop_id: shopId, p_access_token: tokens.access_token, p_refresh_token: tokens.refresh_token, p_expires_at: tokens.expires_at }));
      credentials = tokens;
    }
    const signedCredentials = { token: credentials.access_token, shopId };
    let ids: string[], nextCursor: string | null = null, effectiveFrom: string | null = null, effectiveTo: string | null = null;
    if (action === "fetch_orders") {
      if (!Array.isArray(body.order_ids) || body.order_ids.length < 1 || body.order_ids.length > 50) throw new RequestError("Informe de 1 a 50 números de pedido Shopee como texto.");
      ids = [...new Set(body.order_ids.map(orderId))];
    } else {
      const from = typeof body.from === "string" ? Date.parse(body.from) : Date.now() - 7 * 86400000;
      const requestedTo = typeof body.to === "string" ? Date.parse(body.to) : Date.now();
      const to = Math.min(requestedTo, Date.now());
      const cursor = body.cursor == null ? "" : body.cursor;
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 15 * 86400000 || typeof cursor !== "string" || cursor.length > 512) throw new RequestError("Consulte atualizações Shopee em um intervalo de até 15 dias.");
      if (cursor && (typeof body.from !== "string" || typeof body.to !== "string" || requestedTo > Date.now())) throw new RequestError("A próxima página precisa usar o intervalo efetivo retornado pela consulta anterior.");
      effectiveFrom = new Date(Math.floor(from / 1000) * 1000).toISOString();
      effectiveTo = new Date(Math.floor(to / 1000) * 1000).toISOString();
      const response = await api(config, "/api/v2/order/get_order_list", { time_range_field: "update_time", time_from: String(Math.floor(from / 1000)), time_to: String(Math.floor(to / 1000)), page_size: "20", request_order_status_pending: "true", ...(cursor ? { cursor } : {}) }, signedCredentials);
      if (!Array.isArray(response.order_list) || response.order_list.length > 20 || typeof response.more !== "boolean") throw new RequestError("A Shopee retornou uma página inválida.", 502);
      ids = response.order_list.map(entry => orderId(object(entry).order_sn));
      if (new Set(ids).size !== ids.length) throw new RequestError("A Shopee retornou pedidos repetidos na página.", 502);
      if (response.more) {
        if (typeof response.next_cursor !== "string" || !response.next_cursor || response.next_cursor.length > 512 || response.next_cursor === cursor) throw new RequestError("A Shopee retornou um cursor de paginação inválido.", 502);
        nextCursor = response.next_cursor;
      }
    }
    const orders = await getOrders(config, ids, signedCredentials);
    const imported = orders.length ? await checked(session.rpc("import_marketplace_orders", { p_account_id: account.id, p_orders: orders })) : { imported: 0, unchanged: 0, ignored_older: 0 };
    return reply({ ...imported, fetched: orders.length, next_cursor: nextCursor, effective_from: effectiveFrom, effective_to: effectiveTo, missing_deadline: orders.filter(order => !order.shipping_deadline_at).length, values_to_review: orders.filter(order => order.reported_total != null && Math.round(order.reported_total * 100) !== order.items.reduce((sum, item) => sum + item.quantity * Math.round(item.unit_price * 100), 0)).length });
  } catch (error) {
    if (service && lockedAccount && lease && invalidateExistingAuthorization && error instanceof RequestError && error.reauthorize) await service.rpc("mark_shopee_reauthorization_required", { p_account_id: lockedAccount, p_lease: lease });
    const message = error instanceof RequestError ? error.message : error instanceof SyntaxError ? "JSON inválido." : "Não foi possível concluir a consulta Shopee. Confira os dados e tente novamente.";
    return reply({ error: message }, error instanceof RequestError ? error.status : 400);
  } finally {
    if (service && lockedAccount && lease) await service.rpc("release_marketplace_sync", { p_account_id: lockedAccount, p_lease: lease });
  }
});
