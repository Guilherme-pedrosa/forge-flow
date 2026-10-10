import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { externalId, normalizeMercadoLivreOrder } from "./mercado-livre.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const API = "https://api.mercadolibre.com";
class RequestError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
type Data = Record<string, unknown>;
async function api(path: string, token: string): Promise<Data> {
  // Resource paths are constructed here, never supplied as arbitrary URLs.
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new RequestError(`Mercado Livre retornou HTTP ${response.status}. Confira a autorização e o pedido.`, response.status === 401 ? 401 : 502);
  return await response.json();
}
function configuration() {
  const clientId = Deno.env.get("ML_CLIENT_ID"), clientSecret = Deno.env.get("ML_CLIENT_SECRET"), redirect = Deno.env.get("ML_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirect) throw new RequestError("Importação disponível. Configure ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI no servidor para autorizar a API.", 409);
  let uri: URL; try { uri = new URL(redirect); } catch { throw new RequestError("ML_REDIRECT_URI inválida no servidor.", 409); }
  if (uri.protocol !== "https:" || uri.hash || uri.search) throw new RequestError("ML_REDIRECT_URI precisa ser HTTPS e corresponder ao retorno cadastrado no aplicativo.", 409);
  return { clientId, clientSecret, redirect };
}
async function exchange(params: Record<string, string>) {
  const config = configuration();
  const response = await fetch(`${API}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new RequestError(`Mercado Livre recusou a autorização (HTTP ${response.status}). Autorize a conta novamente.`, 409);
  const value = await response.json();
  if (typeof value.access_token !== "string" || !value.access_token || typeof value.refresh_token !== "string" || !value.refresh_token || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new RequestError("A autorização retornou credenciais incompletas.", 502);
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: new Date(Date.now() + value.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() };
}
async function checked<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise; if (error) throw new RequestError(error.message); return data;
}
async function getOrder(id: string, token: string, sellerId: string) {
  const raw = await api(`/orders/${id}`, token);
  const shipping = raw.shipping as { id?: unknown } | null;
  const shipmentId = externalId(shipping?.id);
  let sla: Data = {};
  if (shipmentId) {
    if (!/^\d{1,24}$/.test(shipmentId)) throw new RequestError("ID de envio inválido no pedido.");
    const response = await fetch(`${API}/shipments/${shipmentId}/sla`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (response.ok) sla = await response.json();
    else if (response.status !== 404) throw new RequestError(`Não foi possível conferir o prazo oficial do envio (HTTP ${response.status}).`, 502);
  }
  try { return normalizeMercadoLivreOrder(raw, sla, sellerId); }
  catch (error) { throw new RequestError(error instanceof Error ? error.message : "Dados inválidos no canal."); }
}
async function batches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let i = 0; i < items.length; i += 10) result.push(...await Promise.all(items.slice(i, i + 10).map(run)));
  return result;
}

// verify_jwt remains enabled in Supabase config; additionally verify the session + role here.
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  let service: SupabaseClient | undefined, lockedAccount: string | undefined, lease: string | undefined;
  try {
    const header = req.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) throw new RequestError("Sessão autenticada obrigatória.", 401);
    const session = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
    const { data: { user }, error } = await session.auth.getUser(header.slice(7));
    if (error || !user) throw new RequestError("Sessão inválida.", 401);
    const tenant = await checked(session.rpc("get_user_tenant_id"));
    const canWrite = await checked(session.rpc("erp_can_write", { financial: false }));
    if (!tenant || !canWrite) throw new RequestError("Seu perfil não pode operar esta integração.", 403);
    const text = await req.text();
    if (new TextEncoder().encode(text).length > 65536) throw new RequestError("Requisição acima de 64 KB.");
    const body = JSON.parse(text) as Data;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Requisição inválida.");
    const action = body.action;
    service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    if (["oauth_begin", "oauth_exchange"].includes(String(action)) && !await checked(session.rpc("erp_can_write", { financial: true }))) throw new RequestError("Somente responsáveis pela conta podem autorizar o aplicativo.", 403);
    let accountId = body.account_id;
    if (action === "oauth_exchange") {
      if (typeof body.state !== "string" || !/^[\da-f-]{36}$/i.test(body.state) || typeof body.code !== "string" || body.code.length < 1 || body.code.length > 1000) throw new RequestError("Código ou estado da autorização inválido.");
      configuration();
      // Delete-and-return atomically consumes the nonce; parallel callbacks cannot reuse it.
      const states = await checked(service.from("marketplace_oauth_states").delete().eq("state", body.state).eq("user_id", user.id).gt("expires_at", new Date().toISOString()).select("account_id"));
      if (!states?.[0]) throw new RequestError("Autorização expirada ou já utilizada. Comece novamente.");
      accountId = states[0].account_id;
    }
    if (typeof accountId !== "string" || !/^[\da-f-]{36}$/i.test(accountId)) throw new RequestError("Conta inválida.");
    const account = await checked(session.from("marketplace_accounts").select("id,tenant_id,channel,external_seller_id,connection_state").eq("id", accountId).eq("tenant_id", tenant).single());
    if (account.channel !== "mercado_livre") throw new RequestError("API deste canal ainda precisa de acesso e contrato validados. Use a importação JSON/CSV.", 409);
    if (action === "oauth_begin") {
      const config = configuration();
      const state = crypto.randomUUID();
      await checked(service.from("marketplace_oauth_states").insert({ state, account_id: account.id, user_id: user.id }));
      const url = new URL("https://auth.mercadolivre.com.br/authorization");
      url.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirect, state }).toString();
      return reply({ authorization_url: url.toString() });
    }
    if (action === "oauth_exchange") {
      const config = configuration();
      const lock = await checked(service.rpc("claim_marketplace_sync", { p_account_id: account.id }));
      if (!lock) throw new RequestError("A conta está sendo consultada. Inicie a autorização novamente após a consulta.", 409);
      lease = String(lock); lockedAccount = account.id;
      const tokens = await exchange({ grant_type: "authorization_code", code: body.code as string, redirect_uri: config.redirect });
      const seller = await api("/users/me", tokens.access_token), sellerId = externalId(seller.id, true);
      if (!/^\d{1,24}$/.test(sellerId) || (account.external_seller_id && account.external_seller_id !== sellerId)) throw new RequestError("A autorização pertence a outro vendedor. Confira o ID da conta.", 409);
      // Save secrets only in service-only tables; never return them to the browser.
      await checked(service.rpc("persist_marketplace_credentials", { p_account_id: account.id, p_lease: lease, p_seller_id: sellerId, p_access_token: tokens.access_token, p_refresh_token: tokens.refresh_token, p_expires_at: tokens.expires_at }));
      return reply({ connected: true, account_id: account.id });
    }
    if (!["fetch_orders", "fetch_recent_orders", "process_events"].includes(String(action))) throw new RequestError("Operação desconhecida.");
    if (account.connection_state !== "connected" || !/^\d{1,24}$/.test(account.external_seller_id ?? "")) throw new RequestError("Autorize a conta Mercado Livre antes de consultar pedidos.", 409);
    const lock = await checked(service.rpc("claim_marketplace_sync", { p_account_id: account.id }));
    if (!lock) throw new RequestError("Uma consulta desta conta já está em andamento. Tente novamente em instantes.", 409);
    lease = String(lock); lockedAccount = account.id;
    let credentials = await checked(service.from("marketplace_credentials").select("access_token,refresh_token,expires_at").eq("account_id", account.id).single());
    if (Date.parse(credentials.expires_at) < Date.now() + 60000) {
      let tokens;
      try { tokens = await exchange({ grant_type: "refresh_token", refresh_token: credentials.refresh_token }); }
      catch (refreshError) {
        await checked(service.from("marketplace_accounts").update({ connection_state: "reauthorization_required" }).eq("id", account.id));
        throw refreshError;
      }
      await checked(service.rpc("persist_marketplace_credentials", { p_account_id: account.id, p_lease: lease, p_seller_id: account.external_seller_id, p_access_token: tokens.access_token, p_refresh_token: tokens.refresh_token, p_expires_at: tokens.expires_at }));
      credentials = tokens;
    }
    let ids: string[] = [], nextOffset: number | null = null;
    if (action === "fetch_orders") {
      if (!Array.isArray(body.order_ids) || body.order_ids.length < 1 || body.order_ids.length > 20 || body.order_ids.some(id => typeof id !== "string" || !/^\d{1,24}$/.test(id))) throw new RequestError("Informe de 1 a 20 IDs de pedidos como texto.");
      ids = [...new Set(body.order_ids as string[])];
    } else if (action === "fetch_recent_orders") {
      const from = typeof body.from === "string" ? Date.parse(body.from) : Date.now() - 7 * 86400000;
      const to = typeof body.to === "string" ? Date.parse(body.to) : Date.now();
      const offset = body.offset == null ? 0 : Number(body.offset);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 31 * 86400000 || !Number.isInteger(offset) || offset < 0 || offset > 80 || offset % 20 !== 0) throw new RequestError("Consulte um intervalo de até 31 dias; páginas de 20, até 100 pedidos por intervalo.");
      const params = new URLSearchParams({ seller: account.external_seller_id, "order.status": "paid", sort: "date_desc", "order.date_created.from": new Date(from).toISOString(), "order.date_created.to": new Date(to).toISOString(), limit: "20", offset: String(offset) });
      const search = await api(`/orders/search?${params}`, credentials.access_token);
      if (!Array.isArray(search.results)) throw new RequestError("Busca retornou uma lista inválida.", 502);
      ids = search.results.map(row => externalId((row as Data).id, true));
      if (ids.some(id => !/^\d{1,24}$/.test(id))) throw new RequestError("Busca retornou ID inválido.", 502);
      const total = Number((search.paging as Data | undefined)?.total ?? 0);
      if (offset + ids.length < total && offset + 20 <= 80) nextOffset = offset + 20;
    } else {
      const events = await checked(service.from("marketplace_events").select("id,payload,attempts").eq("account_id", account.id).in("status", ["pending", "failed"]).lt("attempts", 5).order("received_at").limit(10));
      let processed = 0, failed = 0;
      await Promise.all((events ?? []).map(async event => {
        const resource = String(event.payload.resource ?? "");
        try {
          if (!/^\/orders\/\d{1,24}$/.test(resource)) throw new RequestError("Recurso de evento não suportado.");
          const order = await getOrder(resource.split("/")[2], credentials.access_token, account.external_seller_id);
          await checked(session.rpc("import_marketplace_orders", { p_account_id: account.id, p_orders: [order] }));
          await checked(service.from("marketplace_events").update({ status: "processed", attempts: event.attempts + 1, processed_at: new Date().toISOString(), last_error: null }).eq("id", event.id)); processed++;
        } catch (eventError) {
          await checked(service.from("marketplace_events").update({ status: "failed", attempts: event.attempts + 1, last_error: eventError instanceof Error ? eventError.message.slice(0,500) : "Falha ao consultar pedido" }).eq("id", event.id)); failed++;
        }
      }));
      return reply({ processed, failed });
    }
    const orders = await batches(ids, id => getOrder(id, credentials.access_token, account.external_seller_id));
    const imported = orders.length ? await checked(session.rpc("import_marketplace_orders", { p_account_id: account.id, p_orders: orders })) : { imported: 0, unchanged: 0, ignored_older: 0 };
    return reply({ ...imported, next_offset: nextOffset, fetched: orders.length });
  } catch (error) {
    if (service && lockedAccount && error instanceof RequestError && error.status === 401) await service.from("marketplace_accounts").update({ connection_state: "reauthorization_required" }).eq("id", lockedAccount);
    const message = error instanceof RequestError ? error.message : error instanceof SyntaxError ? "JSON inválido." : "Não foi possível concluir a consulta. Confira os dados e tente novamente.";
    return reply({ error: message }, error instanceof RequestError ? error.status : 400);
  } finally {
    if (service && lockedAccount && lease) await service.rpc("release_marketplace_sync", { p_account_id: lockedAccount, p_lease: lease });
  }
});
