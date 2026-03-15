import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BAMBU_API = "https://api.bambulab.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user
    const {
      data: { user },
      error: userError,
    } = await createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    ).auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "No profile found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    // ── Step 1: Login to Bambu Cloud ──
    if (action === "login") {
      const { email, password } = body;

      const loginRes = await fetch(`${BAMBU_API}/v1/user-service/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: email, password }),
      });

      const loginData = await loginRes.json();

      if (!loginRes.ok) {
        return new Response(
          JSON.stringify({
            error: loginData.message || "Login failed",
            code: loginData.code,
          }),
          {
            status: loginRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // If 2FA is required
      if (loginData.loginType === "verifyCode") {
        return new Response(
          JSON.stringify({
            step: "verify_code",
            message:
              "Código de verificação enviado para seu e-mail. Insira o código para continuar.",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Login successful, save connection and fetch devices
      const accessToken = loginData.accessToken;
      const uid = loginData.uid || null;

      // Save/update bambu_connection
      const { data: existingConn } = await supabase
        .from("bambu_connections")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .maybeSingle();

      let connectionId: string;
      if (existingConn) {
        await supabase
          .from("bambu_connections")
          .update({
            access_token_encrypted: accessToken,
            bambu_email: email,
            bambu_uid: uid?.toString() || null,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingConn.id);
        connectionId = existingConn.id;
      } else {
        const { data: newConn } = await supabase
          .from("bambu_connections")
          .insert({
            tenant_id: profile.tenant_id,
            access_token_encrypted: accessToken,
            bambu_email: email,
            bambu_uid: uid?.toString() || null,
            is_active: true,
          })
          .select("id")
          .single();
        connectionId = newConn!.id;
      }

      // Fetch devices
      const devices = await fetchAndSyncDevices(
        supabase,
        accessToken,
        connectionId,
        profile.tenant_id
      );

      return new Response(
        JSON.stringify({
          step: "done",
          message: `Conectado! ${devices.length} impressora(s) encontrada(s).`,
          devices,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Step 2: Verify code (2FA) ──
    if (action === "verify_code") {
      const { email, code } = body;

      const loginRes = await fetch(`${BAMBU_API}/v1/user-service/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: email, code }),
      });

      const loginData = await loginRes.json();

      if (!loginRes.ok || !loginData.accessToken) {
        return new Response(
          JSON.stringify({
            error: loginData.message || "Código inválido",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const accessToken = loginData.accessToken;
      const uid = loginData.uid || null;

      // Save connection
      const { data: existingConn } = await supabase
        .from("bambu_connections")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .maybeSingle();

      let connectionId: string;
      if (existingConn) {
        await supabase
          .from("bambu_connections")
          .update({
            access_token_encrypted: accessToken,
            bambu_email: email,
            bambu_uid: uid?.toString() || null,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingConn.id);
        connectionId = existingConn.id;
      } else {
        const { data: newConn } = await supabase
          .from("bambu_connections")
          .insert({
            tenant_id: profile.tenant_id,
            access_token_encrypted: accessToken,
            bambu_email: email,
            bambu_uid: uid?.toString() || null,
            is_active: true,
          })
          .select("id")
          .single();
        connectionId = newConn!.id;
      }

      const devices = await fetchAndSyncDevices(
        supabase,
        accessToken,
        connectionId,
        profile.tenant_id
      );

      return new Response(
        JSON.stringify({
          step: "done",
          message: `Conectado! ${devices.length} impressora(s) encontrada(s).`,
          devices,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Re-sync devices using saved token ──
    if (action === "sync") {
      const { data: conn } = await supabase
        .from("bambu_connections")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!conn || !conn.access_token_encrypted) {
        return new Response(
          JSON.stringify({
            error: "Nenhuma conexão Bambu Lab ativa. Faça login primeiro.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const devices = await fetchAndSyncDevices(
        supabase,
        conn.access_token_encrypted,
        conn.id,
        profile.tenant_id
      );

      // Update last_sync_at
      await supabase
        .from("bambu_connections")
        .update({
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", conn.id);

      return new Response(
        JSON.stringify({
          step: "done",
          message: `Sincronizado! ${devices.length} impressora(s).`,
          devices,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("bambu-cloud-sync error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Internal error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ── Fetch devices from Bambu Cloud and upsert into DB ──
async function fetchAndSyncDevices(
  supabase: ReturnType<typeof createClient>,
  accessToken: string,
  connectionId: string,
  tenantId: string
) {
  const devicesRes = await fetch(
    `${BAMBU_API}/v1/iot-service/api/user/bind`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const devicesData = await devicesRes.json();

  if (!devicesRes.ok || devicesData.message !== "success") {
    throw new Error(devicesData.message || "Failed to fetch devices");
  }

  const cloudDevices = devicesData.devices || [];
  const syncedDevices: Array<{
    dev_id: string;
    name: string;
    model: string;
    online: boolean;
  }> = [];

  for (const device of cloudDevices) {
    const devId = device.dev_id;
    const name = device.name || devId;
    const model = device.dev_product_name || device.dev_model_name || "Unknown";
    const online = device.online === true;
    const printStatus = device.print_status || null;
    const accessCode = device.dev_access_code?.trim() || null;

    // Upsert bambu_device
    const { data: existingDevice } = await supabase
      .from("bambu_devices")
      .select("id, printer_id")
      .eq("dev_id", devId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    let bambuDeviceId: string;
    let printerId: string | null = null;

    if (existingDevice) {
      bambuDeviceId = existingDevice.id;
      printerId = existingDevice.printer_id;
      await supabase
        .from("bambu_devices")
        .update({
          name,
          model,
          online,
          print_status: printStatus,
          connection_id: connectionId,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", bambuDeviceId);
    } else {
      const { data: newDevice } = await supabase
        .from("bambu_devices")
        .insert({
          dev_id: devId,
          tenant_id: tenantId,
          connection_id: connectionId,
          name,
          model,
          online,
          print_status: printStatus,
        })
        .select("id")
        .single();
      bambuDeviceId = newDevice!.id;
    }

    // Auto-create printer if not linked
    if (!printerId) {
      // Check if printer already linked by bambu_device_id
      const { data: existingPrinter } = await supabase
        .from("printers")
        .select("id")
        .eq("bambu_device_id", devId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (existingPrinter) {
        printerId = existingPrinter.id;
      } else {
        // Determine brand from model name
        const brand = model.toLowerCase().includes("bambu")
          ? "Bambu Lab"
          : "Bambu Lab";

        const { data: newPrinter } = await supabase
          .from("printers")
          .insert({
            tenant_id: tenantId,
            name,
            brand,
            model,
            bambu_device_id: devId,
            bambu_access_code: accessCode,
            status: online ? "idle" : "offline",
          })
          .select("id")
          .single();
        printerId = newPrinter!.id;
      }

      // Link bambu_device to printer
      await supabase
        .from("bambu_devices")
        .update({ printer_id: printerId })
        .eq("id", bambuDeviceId);
    }

    syncedDevices.push({ dev_id: devId, name, model, online });
  }

  return syncedDevices;
}
