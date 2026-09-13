import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método não permitido" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Client with caller's JWT to check permissions
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error("Not authenticated");

    // Get caller's tenant
    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", caller.id)
      .single();
    if (!callerProfile) throw new Error("Caller has no profile");

    // Check caller is owner or admin
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRoles, error: permissionError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("tenant_id", callerProfile.tenant_id);
    if (permissionError) throw new Error("Não foi possível validar suas permissões.");

    const allowedRoles = ["owner", "admin"];
    const hasPermission = callerRoles?.some((r: any) => allowedRoles.includes(r.role));
    if (!hasPermission) throw new Error("Insufficient permissions");

    // Parse body
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const display_name = typeof body.display_name === "string" ? body.display_name.trim() : "";
    const password = body.password;
    const role = body.role ?? "viewer";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Informe um e-mail válido.");
    if (!display_name || display_name.length > 120) throw new Error("Informe um nome de até 120 caracteres.");
    if (typeof password !== "string" || password.length < 8 || password.length > 128) throw new Error("A senha deve ter entre 8 e 128 caracteres.");

    const validRoles = ["admin", "manager", "operator", "viewer"];
    if (!validRoles.includes(role)) throw new Error("Perfil de acesso inválido.");
    const userRole = role;

    // Create auth user with service role (auto-confirms email)
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;

    if (!newUser.user) throw new Error("Não foi possível criar o usuário.");
    // If either database write fails, remove the new auth identity. Foreign keys
    // cascade the profile/role so a failed creation cannot leave a usable orphan.
    try {
      const { error: profileError } = await adminClient.from("profiles").insert({
        user_id: newUser.user.id,
        tenant_id: callerProfile.tenant_id,
        display_name,
        email,
      });
      if (profileError) throw profileError;

      const { error: roleError } = await adminClient.from("user_roles").insert({
        user_id: newUser.user.id,
        tenant_id: callerProfile.tenant_id,
        role: userRole,
      });
      if (roleError) throw roleError;
    } catch (provisionError) {
      const { error: rollbackError } = await adminClient.auth.admin.deleteUser(newUser.user.id);
      if (rollbackError) {
        console.error("User provisioning rollback failed", { user_id: newUser.user.id });
        throw new Error("O cadastro não foi concluído e requer revisão do administrador antes de tentar novamente.");
      }
      throw provisionError;
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
