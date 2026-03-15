import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
    const { data: callerRoles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("tenant_id", callerProfile.tenant_id);

    const allowedRoles = ["owner", "admin"];
    const hasPermission = callerRoles?.some((r: any) => allowedRoles.includes(r.role));
    if (!hasPermission) throw new Error("Insufficient permissions");

    // Parse body
    const { email, password, display_name, role } = await req.json();
    if (!email || !password || !display_name) {
      throw new Error("email, password, and display_name are required");
    }

    const validRoles = ["admin", "manager", "operator", "viewer"];
    const userRole = validRoles.includes(role) ? role : "viewer";

    // Create auth user with service role (auto-confirms email)
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;

    // Create profile
    const { error: profileError } = await adminClient.from("profiles").insert({
      user_id: newUser.user.id,
      tenant_id: callerProfile.tenant_id,
      display_name,
      email,
    });
    if (profileError) throw profileError;

    // Create role
    const { error: roleError } = await adminClient.from("user_roles").insert({
      user_id: newUser.user.id,
      tenant_id: callerProfile.tenant_id,
      role: userRole,
    });
    if (roleError) throw roleError;

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
