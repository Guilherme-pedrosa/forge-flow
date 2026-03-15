import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) {
      throw new Error("No image provided");
    }

    const systemPrompt = `Você é um assistente especializado em extrair dados de compras a partir de screenshots de marketplaces brasileiros (Mercado Livre, Shopee, TikTok Shop, Amazon, Magazine Luiza, etc).

INSTRUÇÕES CRÍTICAS:
1. Analise a imagem PIXEL A PIXEL. Cada pedido visível DEVE ter seus itens extraídos.
2. Na Shopee, cada bloco com "nome da loja >" seguido de produtos é UM pedido separado.
3. NUNCA retorne um pedido com items vazio. Se você vê o nome de um produto, EXTRAIA ele.
4. Preste atenção em: nome do produto, variante/cor, quantidade (x1, x2...), preço unitário, total.
5. Se houver MÚLTIPLOS pedidos de LOJAS DIFERENTES na mesma imagem, retorne um ARRAY com um objeto para cada pedido/loja.

Retorne um JSON válido. Se houver múltiplos pedidos, retorne um array. Para um único pedido, retorne um objeto.

Estrutura de cada pedido:
{
  "marketplace": "shopee" | "mercado_livre" | "tiktok_shop" | "amazon" | "magalu" | "outro",
  "vendor_name": "nome exato da loja/vendedor como aparece na tela",
  "order_date": "YYYY-MM-DD ou null se não visível",
  "items": [
    {
      "description": "nome COMPLETO do produto como aparece na tela",
      "quantity": 2,
      "unit_price": 61.00,
      "total": 122.00,
      "color": "Preto",
      "variant": "Padrão"
    }
  ],
  "subtotal": null,
  "shipping": null,
  "discount": null,
  "total": 123.60,
  "status": "concluido" | "pendente" | "enviado" | "cancelado" | null,
  "payment_method": "pix" | "credit_card" | "boleto" | "debit_card" | null,
  "payment_installments": "3x de R$ 41,20" ou null,
  "notes": null
}

REGRAS DE VALORES:
- Valores monetários SEMPRE como números: 61.00 não "R$ 61,00"
- R$ 72,01 → 72.01
- Quantidade "x2" → quantity: 2
- Se o preço é unitário e a qtd > 1, calcule o total = unit_price × quantity
- O "Total:" mostrado na Shopee é o total do PEDIDO (pode incluir frete)
- Se não conseguir um campo, use null (mas NUNCA deixe items vazio se há produtos visíveis)
- EXTRAIA a forma de pagamento se visível (cartão de crédito, PIX, boleto, etc)
- Se houver parcelamento (ex: "3x de R$ 41,20"), coloque em payment_installments
- payment_method deve ser: "credit_card", "debit_card", "pix", "boleto" ou null

Retorne APENAS o JSON, sem markdown, sem explicações.`;

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
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
                text: "Extraia TODOS os pedidos e TODOS os itens visíveis nesta screenshot. Não pule nenhum produto.",
              },
            ],
          },
        ],
        temperature: 0.05,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      throw new Error(`AI Gateway error [${response.status}]: ${errorText}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";
    console.log("AI raw response length:", content.length);

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    // Remove markdown fences
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse JSON:", jsonStr.slice(0, 500));
      throw new Error(`Failed to parse AI response as JSON: ${jsonStr.slice(0, 200)}`);
    }

    // Normalize: if single object, wrap in array
    const purchases = Array.isArray(parsed) ? parsed : [parsed];

    // Validate: filter out purchases with no items
    const validPurchases = purchases.filter((p: any) => {
      if (!p.items || p.items.length === 0) {
        console.warn("Skipping purchase with no items:", p.vendor_name);
        return false;
      }
      return true;
    });

    console.log(`Parsed ${purchases.length} purchases, ${validPurchases.length} with items`);

    return new Response(JSON.stringify({ purchases: validPurchases }), {
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
