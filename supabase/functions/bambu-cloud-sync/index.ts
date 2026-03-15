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

      // Try multiple Bambu API endpoints for projects
      let projects: any[] = [];
      let apiError = "";

      // Attempt 1: /v1/iot-service/api/user/project
      try {
        const projectsRes = await fetch(`${BAMBU_API}/v1/iot-service/api/user/project`, {
          headers: { Authorization: `Bearer ${conn.access_token_encrypted}` },
        });

        if (projectsRes.status === 401 || projectsRes.status === 403) {
          // Token expired - mark connection as needing re-auth
          await supabase
            .from("bambu_connections")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", conn.id);

          return new Response(
            JSON.stringify({ 
              error: "Token Bambu expirado. Vá em Integrações → Bambu Lab e reconecte sua conta.", 
              token_expired: true,
              projects: [] 
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rawText = await projectsRes.text();
        if (rawText && rawText.trim()) {
          try {
            const projectsData = JSON.parse(rawText);
            if (projectsData.message === "success" && projectsData.projects) {
              projects = projectsData.projects;
            } else {
              apiError = projectsData.message || "Resposta inesperada da API";
            }
          } catch {
            console.error("Bambu projects non-JSON:", rawText.slice(0, 200));
            apiError = "API Bambu retornou resposta inválida";
          }
        } else {
          apiError = "API Bambu retornou resposta vazia. Token pode ter expirado.";
        }
      } catch (e) {
        console.error("Bambu projects fetch error:", e);
        apiError = "Erro ao conectar com API Bambu";
      }

      if (projects.length === 0 && apiError) {
        return new Response(
          JSON.stringify({ error: apiError + ". Tente desconectar e reconectar em Integrações → Bambu Lab.", projects: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch details for each project (limit to first 20 to avoid timeouts)
      const detailedProjects = [];
      const projectsToFetch = projects.slice(0, 20);

      for (const proj of projectsToFetch) {
        try {
          const detailRes = await fetch(
            `${BAMBU_API}/v1/iot-service/api/user/project/${proj.project_id}`,
            { headers: { Authorization: `Bearer ${conn.access_token_encrypted}` } }
          );
          const detailText = await detailRes.text();
          if (!detailText || !detailText.trim()) {
            detailedProjects.push({
              project_id: proj.project_id, model_id: proj.model_id,
              name: proj.name || "Sem nome", status: proj.status,
              thumbnail: null, total_weight_grams: 0, total_time_seconds: 0, filaments: [],
            });
            continue;
          }

          const detailData = JSON.parse(detailText);
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
          } else {
            detailedProjects.push({
              project_id: proj.project_id, model_id: proj.model_id,
              name: proj.name || "Sem nome", status: proj.status,
              thumbnail: null, total_weight_grams: 0, total_time_seconds: 0, filaments: [],
            });
          }
        } catch (e) {
          console.warn(`Failed project detail ${proj.project_id}:`, e);
          detailedProjects.push({
            project_id: proj.project_id, model_id: proj.model_id,
            name: proj.name || "Sem nome", status: proj.status,
            thumbnail: null, total_weight_grams: 0, total_time_seconds: 0, filaments: [],
          });
        }
      }

      return new Response(
        JSON.stringify({ projects: detailedProjects }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Fetch MakerWorld models ──
    if (action === "makerworld") {
      const { url, selected_profile_id } = body;
      if (!url) {
        return new Response(
          JSON.stringify({ error: "URL é obrigatória" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const models: any[] = [];
      const modelMatch = url.match(/\/models\/(\d+)/);
      const hashProfileId = url.match(/profileId-(\d+)/i)?.[1] || null;
      const selectedProfileId = selected_profile_id || hashProfileId;

      const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

      if (modelMatch) {
        const modelId = modelMatch[1];
        const hashSuffix = hashProfileId ? `#profileId-${hashProfileId}` : "";

        // Strategy 1: Try MakerWorld internal API (fast, no JS needed)
        try {
          const apiRes = await fetch(`https://makerworld.com/api/v1/design/detail/${modelId}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              "Accept": "application/json",
            },
          });
          const apiText = await apiRes.text();
          if (apiRes.ok && apiText.trim()) {
            try {
              const data = JSON.parse(apiText);
              const design = data?.design || data;
              if (design?.id || design?.title) {
                models.push(parseDesignToModel(design, selectedProfileId));
              }
            } catch {
              console.warn("MakerWorld API JSON parse failed");
            }
          }
        } catch (e) {
          console.warn("MakerWorld API call failed:", e);
        }

        // Strategy 2: Use Firecrawl to render JS and extract data
        if (models.length === 0 && FIRECRAWL_API_KEY) {
          try {
            console.log("Using Firecrawl to scrape MakerWorld model:", modelId);
            const firecrawlRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                url: `https://makerworld.com/en/models/${modelId}${hashSuffix}`,
                formats: ["html", "markdown"],
                waitFor: 5000,
              }),
            });
            const fcData = await firecrawlRes.json();
            
            if (firecrawlRes.ok && fcData.success !== false) {
              const html = fcData.data?.html || fcData.html || "";
              const markdown = fcData.data?.markdown || fcData.markdown || "";
              
              console.log("Firecrawl HTML length:", html.length, "Markdown length:", markdown.length);
              
              // Try __NEXT_DATA__ from rendered HTML
              const extracted = extractFromHtml(html);
              if (extracted) {
                models.push(extracted);
              }
              
              // Fallback: parse from rendered HTML content
              if (models.length === 0) {
                // Extract title from h1 tag
                const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
                // Extract og:image
                const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
                // Extract any makerworld image from the rendered page
                const mwImageMatch = html.match(/src="(https:\/\/makerworld\.bblmw\.com[^"]*(?:\.(?:png|jpg|jpeg|webp))[^"]*)"/i);
                // Extract from model cover image
                const coverMatch = html.match(/src="(https:\/\/[^"]*(?:cover|thumbnail|plate_)[^"]*\.(?:png|jpg|jpeg|webp)[^"]*)"/i);
                
                const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/);
                const ogDesc = html.match(/property="og:description"\s+content="([^"]+)"/);
                const titleFromH1 = h1Match?.[1]?.trim();
                const titleM = markdown.match(/^#\s+(.+)/m);
                
                const title = titleFromH1 || titleM?.[1] || ogTitle?.[1] || "Modelo MakerWorld";
                const thumbnail = ogImage?.[1] || coverMatch?.[1] || mwImageMatch?.[1] || null;
                
                console.log("Extracted title:", title, "thumbnail:", thumbnail?.substring(0, 80));
                
                // Extract profile options, time, colors and weight from markdown/html
                let totalPlates = 0;
                let timeSeconds = 0;
                let weightGrams = 0;
                const filaments: Array<{ type: string; color: string; grams: number }> = [];
                const parsedProfiles: Array<{
                  name: string;
                  weight_grams: number;
                  time_seconds: number;
                  plates: number;
                  filaments: Array<{ type: string; color: string; grams: number }>;
                }> = [];

                const parseHoursAndMinutesToSeconds = (text: string) => {
                  const h = text.match(/(\d+(?:[.,]\d+)?)\s*h\b/i);
                  const min = text.match(/(\d+)\s*min\b/i);
                  const hSeconds = h ? Math.round(parseLooseMetric(h[1]) * 3600) : 0;
                  const minSeconds = min ? Math.round(parseLooseMetric(min[1]) * 60) : 0;
                  return hSeconds + minSeconds;
                };

                const extractWeightFromBlock = (text: string) => {
                  const totalLabelMatch = text.match(/total[^\n]{0,24}?(\d+(?:[.,]\d+)?)\s*(kg|g|grams?)/i);
                  if (totalLabelMatch) {
                    return metricToGrams(totalLabelMatch[1], totalLabelMatch[2]);
                  }

                  const allWeightTokens = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|grams?)\b/gi)].map((m) => metricToGrams(m[1], m[2])).filter((n) => n > 0);
                  if (allWeightTokens.length === 0) return 0;

                  // If multiple tokens exist, assume they are per-color consumptions and sum them.
                  if (allWeightTokens.length > 1) {
                    return allWeightTokens.reduce((sum, n) => sum + n, 0);
                  }

                  return allWeightTokens[0];
                };

                const profileBlocks = markdown
                  .split(/\* \* \*/)
                  .map((block) => block.trim())
                  .filter(Boolean);

                for (let idx = 0; idx < profileBlocks.length; idx++) {
                  const block = profileBlocks[idx];
                  const nameMatch = block.match(/(?:^|\n)#{2,4}\s*([^\n]+)/);
                  const blockName = nameMatch?.[1]?.trim() || `Opção ${idx + 1}`;

                  const platesMatch = block.match(/(\d+)\s*plates?/i);
                  const blockPlates = platesMatch ? parseInt(platesMatch[1]) : 0;
                  const blockTimeSeconds = parseHoursAndMinutesToSeconds(block);
                  const blockWeight = extractWeightFromBlock(block);

                  if (blockPlates > 0 || blockTimeSeconds > 0 || blockWeight > 0) {
                    parsedProfiles.push({
                      name: blockName,
                      weight_grams: blockWeight,
                      time_seconds: blockTimeSeconds,
                      plates: blockPlates,
                      filaments: [],
                    });
                  }
                }

                if (parsedProfiles.length > 0) {
                  totalPlates = Math.max(...parsedProfiles.map((p) => p.plates || 0));
                  timeSeconds = Math.max(...parsedProfiles.map((p) => p.time_seconds || 0));
                  weightGrams = Math.max(...parsedProfiles.map((p) => p.weight_grams || 0));
                }

                // Fallback time from HTML/markdown
                if (timeSeconds === 0) {
                  const htmlTimeValues = collectMetricValues(html, [
                    "estimatedTime",
                    "prediction",
                    "time_seconds",
                    "printTime",
                    "totalTime",
                  ]);
                  const markdownSeconds = parseHoursAndMinutesToSeconds(markdown);
                  const allTimeCandidates = [...htmlTimeValues, markdownSeconds].filter((n) => Number.isFinite(n) && n > 0);
                  if (allTimeCandidates.length > 0) {
                    timeSeconds = Math.max(...allTimeCandidates);
                  }
                }

                // Extract weight: try broad key set from rendered HTML, then markdown fallback
                if (weightGrams === 0) {
                  const htmlWeightValues = collectMetricValues(html, [
                    "totalWeight",
                    "total_weight",
                    "weight_grams",
                    "weightGrams",
                    "weight",
                    "used_g",
                    "usedG",
                    "usedWeight",
                    "filamentWeight",
                    "materialWeight",
                    "consumption",
                    "filament_used_g",
                  ]);

                  const markdownWeightValues = [
                    ...collectMetricValues(markdown, ["total weight", "filament weight", "weight_grams", "used_g"]),
                    ...[...markdown.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|grams?)\b/gi)].map((m) => metricToGrams(m[1], m[2])),
                  ];

                  const candidates = [...htmlWeightValues, ...markdownWeightValues]
                    .filter((n) => Number.isFinite(n) && n > 0.05 && n < 5000);

                  if (candidates.length > 0) {
                    weightGrams = Math.max(...candidates);
                  }
                }

                // Extract filament colors from Bill of Materials section
                const bomSection = markdown.split(/### Bill of Materials/i)[1]?.split(/### Description/i)[0] || "";
                const filColorRegex = /!\[.*?\].*?([A-Za-z\s]+)\s*\(\d{4,}\)/g;
                let filMatch;
                const seenColors = new Set<string>();
                while ((filMatch = filColorRegex.exec(bomSection)) !== null) {
                  const color = filMatch[1].trim();
                  if (color && !seenColors.has(color.toLowerCase())) {
                    seenColors.add(color.toLowerCase());
                    const nearbyPLA = bomSection.slice(Math.max(0, filMatch.index - 200), filMatch.index + 200);
                    const matType = nearbyPLA.match(/\b(PLA|PETG|ABS|ASA|TPU|PC|PA|PVA)\b/i)?.[1] || "PLA";
                    filaments.push({ type: matType.toUpperCase(), color, grams: 0 });
                  }
                }

                if (filaments.length === 0) {
                  const uniqueLinks = new Set(bomSection.match(/\[(?:PLA|PETG|ABS|ASA|TPU|PC|PA|PVA)[^\]]*\]/gi) || []);
                  for (const link of uniqueLinks) {
                    filaments.push({ type: link.match(/PLA|PETG|ABS|ASA|TPU|PC|PA|PVA/i)?.[0]?.toUpperCase() || "PLA", color: "", grams: 0 });
                  }
                }

                // Also try to get all gallery images
                const allImages: string[] = [];
                const imgRegex = /src="(https:\/\/makerworld\.bblmw\.com[^"]*\.(?:png|jpg|jpeg|webp)[^"]*)"/gi;
                let imgMatch;
                while ((imgMatch = imgRegex.exec(html)) !== null) {
                  if (!allImages.includes(imgMatch[1]) && !imgMatch[1].includes('/w_60/') && !imgMatch[1].includes('avatar') && !imgMatch[1].includes('/w_100/')) {
                    allImages.push(imgMatch[1]);
                  }
                }

                const mdImgRegex = /!\[.*?\]\((https:\/\/makerworld\.bblmw\.com[^)]*w_1000[^)]*)\)/g;
                let mdImg;
                while ((mdImg = mdImgRegex.exec(markdown)) !== null) {
                  if (!allImages.includes(mdImg[1])) {
                    allImages.unshift(mdImg[1]);
                  }
                }

                const profileIds = Array.from(
                  new Set(
                    [...html.matchAll(/profileId-(\d+)/gi)]
                      .map((m) => m[1])
                      .filter(Boolean)
                  )
                );

                const normalizedProfiles = parsedProfiles.length > 0
                  ? parsedProfiles.map((p, idx) => ({
                      ...p,
                      profile_id: p.profile_id || profileIds[idx] || null,
                      weight_grams: p.weight_grams || weightGrams,
                      time_seconds: p.time_seconds || timeSeconds,
                      plates: p.plates || totalPlates,
                      filaments: filaments.length > 0 ? filaments : p.filaments,
                    }))
                  : [{
                      name: "Opção 1",
                      profile_id: profileIds[0] || selectedProfileId || null,
                      weight_grams: weightGrams,
                      time_seconds: timeSeconds,
                      plates: totalPlates,
                      filaments,
                    }];

                console.log(`MakerWorld parsed: options=${normalizedProfiles.length}, plates=${totalPlates}, time=${timeSeconds}s, weight=${weightGrams}g, colors=${filaments.length}, images=${allImages.length}`);

                models.push({
                  id: modelId,
                  title,
                  thumbnail,
                  description: ogDesc?.[1] || "",
                  gallery: allImages.slice(0, 10),
                  plates: totalPlates || normalizedProfiles[0]?.plates || 0,
                  profiles: normalizedProfiles,
                });
              }
            } else {
              console.error("Firecrawl error:", fcData);
            }
          } catch (e) {
            console.error("Firecrawl scrape error:", e);
          }
        }

        // Strategy 3: Direct HTML fetch (last resort, usually blocked)
        if (models.length === 0) {
          try {
            const pageRes = await fetch(`https://makerworld.com/en/models/${modelMatch[1]}`, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "text/html",
              },
            });
            const html = await pageRes.text();
            const extracted = extractFromHtml(html);
            if (extracted) models.push(extracted);
          } catch (e) {
            console.error("Direct HTML fetch error:", e);
          }
        }
      }

      if (models.length === 0) {
        const hasFirecrawl = !!FIRECRAWL_API_KEY;
        return new Response(
          JSON.stringify({ 
            error: hasFirecrawl 
              ? "Não foi possível extrair dados do modelo. Verifique se a URL está correta."
              : "Firecrawl não configurado. Conecte o Firecrawl para importar modelos do MakerWorld.",
            models: [] 
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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

// ── Helper: parse MakerWorld design object to our model format ──
function toPositiveNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function maxMetric(...values: number[]): number {
  return values.reduce((acc, v) => (v > acc ? v : acc), 0);
}

function parseLooseMetric(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return 0;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function metricToGrams(value: unknown, explicitUnit?: string | null): number {
  const n = parseLooseMetric(value);
  if (n <= 0) return 0;
  const unit = (explicitUnit || (typeof value === "string" ? (value.match(/\b(kg|kilograms?)\b/i)?.[1] || value.match(/\b(g|grams?)\b/i)?.[1]) : "") || "").toLowerCase();
  if (unit.startsWith("kg") || unit.startsWith("kilo")) return n * 1000;
  return n;
}

function collectMetricValues(source: string, keys: string[]): number[] {
  const values: number[] = [];

  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const structuredRegex = new RegExp(
      `["']?${escaped}["']?\\s*[:=]\\s*["']?([0-9]+(?:[.,][0-9]+)?)(?:\\s*(kg|kgs|kilograms?|g|grams?))?["']?`,
      "gi"
    );

    const looseRegex = new RegExp(
      `${escaped}[^0-9]{0,16}([0-9]+(?:[.,][0-9]+)?)(?:\\s*(kg|kgs|kilograms?|g|grams?))`,
      "gi"
    );

    for (const regex of [structuredRegex, looseRegex]) {
      let m: RegExpExecArray | null;
      while ((m = regex.exec(source)) !== null) {
        const grams = metricToGrams(m[1], m[2]);
        if (grams > 0) values.push(grams);
      }
    }
  }

  return values;
}

function profileDisplayName(profile: any, idx: number): string {
  return profile?.name || profile?.profileName || profile?.title || `Opção ${idx + 1}`;
}

function parseDesignToModel(d: any, selectedProfileId?: string | null) {
  const sourceProfiles = d.profileList || d.profiles || [];

  const profiles = sourceProfiles.map((p: any, idx: number) => {
    const ctx = p.context || {};
    const plates = ctx.plates || [];

    const filamentMap = new Map<string, { type: string; color: string; grams: number }>();
    const addFilament = (type: string, color: string, grams: number) => {
      const normalizedType = (type || "PLA").toUpperCase();
      const normalizedColor = color || "";
      const key = `${normalizedType}-${normalizedColor}`.toLowerCase();
      const existing = filamentMap.get(key);
      if (existing) {
        existing.grams += grams;
      } else {
        filamentMap.set(key, { type: normalizedType, color: normalizedColor, grams });
      }
    };

    let summedPlateWeight = 0;
    let summedPlateTime = 0;

    for (const plate of plates) {
      summedPlateWeight += metricToGrams(
        plate.weight ?? plate.total_weight ?? plate.weight_grams ?? plate.totalWeight,
        plate.weight_unit || plate.unit
      );
      summedPlateTime += parseLooseMetric(plate.prediction ?? plate.estimatedTime ?? plate.time_seconds ?? plate.printTime);

      for (const fil of (plate.filaments || [])) {
        addFilament(
          fil.type || "PLA",
          fil.color || "",
          metricToGrams(fil.used_g ?? fil.weight ?? fil.grams ?? fil.usedWeight, fil.unit)
        );
      }
    }

    for (const m of (p.materialList || p.materials || [])) {
      addFilament(
        m.type || "PLA",
        m.color || "",
        metricToGrams(m.weight ?? m.used_g ?? m.grams ?? m.usedWeight, m.unit)
      );
    }

    const filaments = Array.from(filamentMap.values());
    const filamentWeightSum = filaments.reduce((sum, f) => sum + toPositiveNumber(f.grams), 0);

    const declaredWeight = maxMetric(
      metricToGrams(p.weight, p.weight_unit || p.unit),
      metricToGrams(p.total_weight, p.weight_unit || p.unit),
      metricToGrams(p.totalWeight, p.weight_unit || p.unit),
      metricToGrams(p.weight_grams, "g"),
      metricToGrams(p.used_g, "g")
    );

    const declaredTime = maxMetric(
      parseLooseMetric(p.estimatedTime),
      parseLooseMetric(p.estimated_time),
      parseLooseMetric(p.time_seconds),
      parseLooseMetric(p.printTime)
    );

    return {
      profile_id: p.profile_id || p.profileId || p.id || p.profile_id_str || null,
      name: profileDisplayName(p, idx),
      weight_grams: maxMetric(declaredWeight, summedPlateWeight, filamentWeightSum),
      time_seconds: maxMetric(declaredTime, summedPlateTime),
      plates: plates.length || toPositiveNumber(p.plateCount || p.plate_count),
      filaments,
    };
  });

  if (profiles.length === 0) {
    profiles.push({
      name: "Opção 1",
      weight_grams: maxMetric(
        metricToGrams(d.weight, d.weight_unit || d.unit),
        metricToGrams(d.total_weight, d.weight_unit || d.unit),
        metricToGrams(d.totalWeight, d.weight_unit || d.unit),
        metricToGrams(d.weight_grams, "g")
      ),
      time_seconds: maxMetric(
        parseLooseMetric(d.estimatedTime),
        parseLooseMetric(d.estimated_time),
        parseLooseMetric(d.time_seconds),
        parseLooseMetric(d.printTime)
      ),
      plates: toPositiveNumber(d.plateCount || d.plate_count),
      filaments: [],
    });
  }

  return {
    id: d.id || d.designId || d.design_id || "",
    title: d.title || d.name || "Sem nome",
    thumbnail: d.cover || d.cover_url || d.coverUrl || d.images?.[0]?.url || null,
    description: d.summary || d.description || "",
    print_count: d.printCountStr || d.print_count || "0",
    download_count: d.downloadCountStr || d.download_count || "0",
    like_count: d.likeCount || d.like_count || 0,
    plates: Math.max(...profiles.map((p: any) => p.plates || 0)),
    profiles,
  };
}

// ── Helper: extract model data from HTML page ──
function extractFromHtml(html: string): any | null {
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      const design = nextData?.props?.pageProps?.design;
      if (design) return parseDesignToModel(design);
    } catch {}
  }
  
  // Try og:tags as minimal fallback
  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
  const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/);
  
  if (titleMatch) {
    return {
      id: "og-" + Date.now(),
      title: titleMatch[1],
      thumbnail: imageMatch?.[1] || null,
      description: descMatch?.[1] || "",
      profiles: [],
    };
  }
  
  return null;
}

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
