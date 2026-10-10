import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Authenticated inbox ingress. It is NOT an anonymous Mercado Livre subscription callback.
// Keep verify_jwt=true until a separately verified upstream authentication contract is deployed.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async req => {
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const header = req.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return reply({ error: "Sessão autenticada obrigatória." }, 401);
    const session = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: header } }, auth: { persistSession: false } });
    const { data: { user }, error } = await session.auth.getUser(header.slice(7));
    if (error || !user) return reply({ error: "Sessão inválida." }, 401);
    const text = await req.text();
    if (new TextEncoder().encode(text).length > 65536) return reply({ error: "Evento acima de 64 KB." }, 413);
    const body = JSON.parse(text), payload = body?.notification;
    if (!body || typeof body.account_id !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload) || !/^\/orders\/\d{1,24}$/.test(String(payload.resource)) || !["orders", "orders_v2"].includes(payload.topic)) return reply({ error: "Conta ou notificação de pedido inválida." }, 400);
    const { data: account, error: accountError } = await session.from("marketplace_accounts").select("id,channel,external_seller_id").eq("id", body.account_id).single();
    if (accountError || !account || account.channel !== "mercado_livre" || !account.external_seller_id || String(payload.user_id) !== account.external_seller_id) return reply({ error: "Notificação não pertence a esta conta." }, 403);
    const canonical = { resource: payload.resource, topic: payload.topic, user_id: String(payload.user_id), sent: payload.sent ?? null, upstream_id: payload._id ?? null };
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical))));
    const key = `notification:${Array.from(digest, byte => byte.toString(16).padStart(2,"0")).join("")}`;
    const { data, error: writeError } = await session.rpc("record_marketplace_event", { p_account_id: account.id, p_event_key: key, p_payload: canonical });
    if (writeError) return reply({ error: writeError.message }, 403);
    // No sales, reservations, production or receivables are created by ingress.
    return reply({ event_id: data, status: "pending" }, 202);
  } catch { return reply({ error: "Evento inválido." }, 400); }
});
