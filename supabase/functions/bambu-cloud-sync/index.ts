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

    // ── Fetch user projects (saved models / collections) ──
    if (action === "projects") {
      const { data: conn } = await supabase
        .from("bambu_connections")
        .select("*")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .maybeSingle();

      if (!conn || !conn.access_token_encrypted) {
        return new Response(
          JSON.stringify({ error: "Nenhuma conexão Bambu Lab ativa." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const projectsRes = await fetch(`${BAMBU_API}/v1/iot-service/api/user/project`, {
        headers: { Authorization: `Bearer ${conn.access_token_encrypted}` },
      });

      const rawText = await projectsRes.text();
      let projectsData: any;
      try {
        projectsData = JSON.parse(rawText);
      } catch {
        console.error("Bambu projects API returned non-JSON:", rawText.slice(0, 500));
        return new Response(
          JSON.stringify({ error: "API Bambu retornou resposta inválida. Tente reconectar.", projects: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!projectsRes.ok || projectsData.message !== "success") {
        return new Response(
          JSON.stringify({ error: projectsData.message || "Falha ao buscar projetos", projects: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const projects = projectsData.projects || [];

      // Fetch details for each project to get thumbnails and plate data
      const detailedProjects = [];
      for (const proj of projects) {
        try {
          const detailRes = await fetch(
            `${BAMBU_API}/v1/iot-service/api/user/project/${proj.project_id}`,
            { headers: { Authorization: `Bearer ${conn.access_token_encrypted}` } }
          );
          const detailText = await detailRes.text();
          let detailData: any;
          try {
            detailData = JSON.parse(detailText);
          } catch {
            console.warn(`Non-JSON response for project ${proj.project_id}`);
            continue;
          }

          if (detailRes.ok && detailData.message === "success") {
            const profiles = detailData.profiles || [];
            let thumbnail = null;
            let totalWeight = 0;
            let totalTime = 0;
            const filaments: Array<{ type: string; color: string; grams: number }> = [];

            for (const p of profiles) {
              const ctx = p.context;
              if (!ctx) continue;
              const plates = ctx.plates || [];
              for (const plate of plates) {
                if (!thumbnail && plate.thumbnail?.url) thumbnail = plate.thumbnail.url;
                if (plate.weight) totalWeight += Number(plate.weight);
                if (plate.prediction) totalTime += Number(plate.prediction);
                for (const fil of (plate.filaments || [])) {
                  filaments.push({ type: fil.type || "Unknown", color: fil.color || "", grams: Number(fil.used_g) || 0 });
                }
              }
            }

            detailedProjects.push({
              project_id: proj.project_id, model_id: proj.model_id,
              name: proj.name || detailData.name || "Sem nome",
              status: proj.status, created_at: proj.create_time, updated_at: proj.update_time,
              thumbnail, total_weight_grams: totalWeight, total_time_seconds: totalTime, filaments,
            });
          }
        } catch (e) {
          console.warn(`Failed to get project detail for ${proj.project_id}:`, e);
          detailedProjects.push({
            project_id: proj.project_id, model_id: proj.model_id,
            name: proj.name || "Sem nome", status: proj.status,
            created_at: proj.create_time, updated_at: proj.update_time,
            thumbnail: null, total_weight_grams: 0, total_time_seconds: 0, filaments: [],
          });
        }
      }

      return new Response(
        JSON.stringify({ projects: detailedProjects }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Fetch MakerWorld collection models ──
    if (action === "makerworld") {
      const { url } = body;
      if (!url) {
        return new Response(
          JSON.stringify({ error: "URL da coleção é obrigatória" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extract user ID from URL like https://makerworld.com/pt/@user_xxx/collections/models
      // or a model URL like https://makerworld.com/en/models/12345-name
      const models: any[] = [];

      // Try to determine if it's a collection page or model page
      const modelMatch = url.match(/\/models\/(\d+)/);
      const userMatch = url.match(/@([^/]+)/);

      if (modelMatch) {
        // Single model - fetch the page and extract __NEXT_DATA__
        const modelId = modelMatch[1];
        try {
          const pageRes = await fetch(`https://makerworld.com/en/models/${modelId}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
          const html = await pageRes.text();
          const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
          if (nextDataMatch) {
            const nextData = JSON.parse(nextDataMatch[1]);
            const design = nextData?.props?.pageProps?.design;
            if (design) {
              models.push({
                id: design.id,
                title: design.title || "Sem nome",
                thumbnail: design.cover || design.images?.[0]?.url || null,
                description: design.summary || "",
                print_count: design.printCountStr || "0",
                download_count: design.downloadCountStr || "0",
                like_count: design.likeCount || 0,
                profiles: (design.profileList || []).map((p: any) => ({
                  name: p.name || "Default",
                  weight_grams: p.weight || 0,
                  time_seconds: p.estimatedTime || 0,
                  filaments: (p.materialList || []).map((m: any) => ({
                    type: m.type || "PLA",
                    color: m.color || "",
                    grams: m.weight || 0,
                  })),
                })),
              });
            }
          }
        } catch (e) {
          console.error("MakerWorld model fetch error:", e);
        }
      } else if (userMatch) {
        // Collection page - try API endpoint
        const userId = userMatch[1];
        try {
          // MakerWorld internal API for user's published models
          const apiRes = await fetch(
            `https://makerworld.com/api/v1/design/collection?uid=${userId}&offset=0&limit=100&orderBy=updated`,
            {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Referer": "https://makerworld.com/",
              },
            }
          );
          const apiText = await apiRes.text();
          let apiData: any;
          try {
            apiData = JSON.parse(apiText);
          } catch {
            // If API fails, try scraping the page
            const pageRes = await fetch(url.replace("/pt/", "/en/"), {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html",
              },
            });
            const html = await pageRes.text();
            const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (nextDataMatch) {
              const nextData = JSON.parse(nextDataMatch[1]);
              const designs = nextData?.props?.pageProps?.designs || nextData?.props?.pageProps?.collectionDesigns || [];
              for (const d of designs) {
                models.push({
                  id: d.id,
                  title: d.title || "Sem nome",
                  thumbnail: d.cover || d.images?.[0]?.url || null,
                  description: d.summary || "",
                  print_count: d.printCountStr || "0",
                  profiles: [],
                });
              }
            }
            return new Response(
              JSON.stringify({ models }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (apiData?.hits) {
            for (const d of apiData.hits) {
              models.push({
                id: d.id,
                title: d.title || "Sem nome",
                thumbnail: d.cover || null,
                description: d.summary || "",
                print_count: d.printCountStr || "0",
                profiles: [],
              });
            }
          }
        } catch (e) {
          console.error("MakerWorld collection fetch error:", e);
        }
      }

      return new Response(
        JSON.stringify({ models }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      const { data: existingPrinter } = await supabase
        .from("printers")
        .select("id")
        .eq("bambu_device_id", devId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (existingPrinter) {
        printerId = existingPrinter.id;
      } else {
        const { data: newPrinter } = await supabase
          .from("printers")
          .insert({
            tenant_id: tenantId,
            name,
            brand: "Bambu Lab",
            model,
            bambu_device_id: devId,
            bambu_access_code: accessCode,
            status: online ? "idle" : "offline",
          })
          .select("id")
          .single();
        printerId = newPrinter!.id;
      }

      await supabase
        .from("bambu_devices")
        .update({ printer_id: printerId })
        .eq("id", bambuDeviceId);
    }

    // Fetch task history for this device
    await fetchAndSyncTasks(supabase, accessToken, devId, bambuDeviceId, tenantId, printerId);

    syncedDevices.push({ dev_id: devId, name, model, online });
  }

  return syncedDevices;
}

// ── Fetch task history from Bambu Cloud and upsert into DB ──
async function fetchAndSyncTasks(
  supabase: ReturnType<typeof createClient>,
  accessToken: string,
  devId: string,
  bambuDeviceId: string,
  tenantId: string,
  printerId: string | null
) {
  try {
    const tasksRes = await fetch(
      `${BAMBU_API}/v1/user-service/my/tasks?deviceId=${devId}&limit=500`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const tasksData = await tasksRes.json();

    if (!tasksRes.ok || !tasksData.hits) {
      console.warn(`Failed to fetch tasks for device ${devId}:`, tasksData);
      return;
    }

    const tasks = tasksData.hits || [];
    let totalPrints = 0;
    let totalPrintSeconds = 0;
    let totalFailures = 0;

    for (const task of tasks) {
      const bambuTaskId = String(task.id);
      const designTitle = task.title || null;
      const status = task.status != null ? String(task.status) : null;
      const startTime = task.startTime || null;
      const endTime = task.endTime || null;
      const weightGrams = task.weight != null ? Number(task.weight) : null;
      const costTimeSeconds = task.costTime != null ? Number(task.costTime) : null;
      const coverUrl = task.cover || null;

      // Count stats: status 0 = running, 1 = paused, 2 = completed, 3 = failed
      totalPrints++;
      if (costTimeSeconds) {
        totalPrintSeconds += costTimeSeconds;
      }
      if (status === "3") {
        totalFailures++;
      }

      // Upsert task
      const { data: existingTask } = await supabase
        .from("bambu_tasks")
        .select("id")
        .eq("bambu_task_id", bambuTaskId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!existingTask) {
        await supabase.from("bambu_tasks").insert({
          bambu_task_id: bambuTaskId,
          bambu_device_id: bambuDeviceId,
          tenant_id: tenantId,
          design_title: designTitle,
          status,
          start_time: startTime,
          end_time: endTime,
          weight_grams: weightGrams,
          cost_time_seconds: costTimeSeconds,
          cover_url: coverUrl,
          raw_data: task,
        });
      }
    }

    // Update printer stats
    if (printerId && totalPrints > 0) {
      const totalPrintHours = Math.round((totalPrintSeconds / 3600) * 100) / 100;
      await supabase
        .from("printers")
        .update({
          total_prints: totalPrints,
          total_print_hours: totalPrintHours,
          total_failures: totalFailures,
          updated_at: new Date().toISOString(),
        })
        .eq("id", printerId);
    }
  } catch (err) {
    console.error(`Error fetching tasks for device ${devId}:`, err);
  }
}
