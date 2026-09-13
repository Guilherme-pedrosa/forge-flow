import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error("Not authenticated");

    const { data: callerProfile } = await callerClient
      .from("profiles").select("tenant_id").eq("user_id", caller.id).single();
    if (!callerProfile) throw new Error("Caller has no profile");

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRoles, error: permissionError } = await adminClient
      .from("user_roles").select("role")
      .eq("user_id", caller.id).eq("tenant_id", callerProfile.tenant_id);
    if (permissionError) throw new Error("Não foi possível validar suas permissões.");
    if (!callerRoles?.some((r: any) => ["owner", "admin"].includes(r.role))) {
      throw new Error("Insufficient permissions");
    }

    const body = await req.json();
    const targetUserId = typeof body.user_id === "string" ? body.user_id : "";
    const password = body.password;
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) throw new Error("Usuário inválido.");
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      throw new Error("A senha deve ter entre 8 e 128 caracteres.");
    }

    // Target must belong to the caller's tenant.
    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles").select("user_id, tenant_id")
      .eq("user_id", targetUserId).eq("tenant_id", callerProfile.tenant_id).maybeSingle();
    if (targetError) throw new Error("Não foi possível localizar o usuário.");
    if (!targetProfile) throw new Error("Usuário não pertence à sua empresa.");

    // Only an owner may reset another owner's password.
    const { data: targetRoles } = await adminClient
      .from("user_roles").select("role")
      .eq("user_id", targetUserId).eq("tenant_id", callerProfile.tenant_id);
    const targetIsOwner = targetRoles?.some((r: any) => r.role === "owner");
    const callerIsOwner = callerRoles.some((r: any) => r.role === "owner");
    if (targetIsOwner && !callerIsOwner) throw new Error("Apenas o proprietário pode alterar esta senha.");

    const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
      password,
      email_confirm: true,
    });
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
