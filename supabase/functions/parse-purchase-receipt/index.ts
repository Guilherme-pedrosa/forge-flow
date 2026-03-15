import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) {
      throw new Error("No image provided");
    }

    const systemPrompt = `Você é um assistente especializado em extrair dados de compras a partir de screenshots de marketplaces brasileiros (Mercado Livre, Shopee, TikTok Shop, Amazon, Magazine Luiza, etc).

Analise a imagem e extraia TODAS as informações de compra visíveis. Retorne um JSON válido com esta estrutura:

{
  "marketplace": "mercado_livre" | "shopee" | "tiktok_shop" | "amazon" | "magalu" | "outro",
  "vendor_name": "nome da loja/vendedor",
  "order_date": "YYYY-MM-DD ou null",
  "items": [
    {
      "description": "nome completo do produto",
      "quantity": 1,
      "unit_price": 82.08,
      "total": 82.08,
      "color": "cor se visível ou null",
      "variant": "variante se visível ou null"
    }
  ],
  "subtotal": 249.66,
  "shipping": 0,
  "discount": 0,
  "total": 249.66,
  "payment_method": "método de pagamento se visível ou null",
  "payment_installments": "4x R$ 60,92 ou null",
  "status": "concluido" | "pendente" | "enviado" | "cancelado" | null,
  "notes": "observações adicionais relevantes"
}

Regras:
- Valores monetários devem ser números (não strings). Ex: 82.08 não "R$ 82,08"
- Se houver múltiplos pedidos na imagem, retorne um array de objetos
- Se não conseguir identificar algum campo, use null
- Preste atenção em preços riscados (promoção) vs preço pago real
- Identifique a quantidade correta (x1, x2, etc)
- Retorne APENAS o JSON, sem markdown ou texto adicional`;

    const response = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
                },
              },
              {
                type: "text",
                text: "Extraia os dados de compra desta screenshot de marketplace.",
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Gateway error [${response.status}]: ${errorText}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Failed to parse AI response as JSON: ${jsonStr.slice(0, 200)}`);
    }

    // Normalize: if single object, wrap in array
    const purchases = Array.isArray(parsed) ? parsed : [parsed];

    return new Response(JSON.stringify({ purchases }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error parsing receipt:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
