import { supabase } from "@/integrations/supabase/client";

export type SavedCatalogCost = { product_id: string; source: "manual" | "composition"; complete: boolean; unit_cost: number | null; revision: string; missing: string[] };
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, payload: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
export async function readSavedCatalogCost(productId: string): Promise<SavedCatalogCost> {
  const { data, error } = await rpc("product_catalog_cost", { p_product_id: productId });
  if (error) throw new Error(error.message);
  const row = data as SavedCatalogCost | null;
  if (!row || row.product_id !== productId || !["manual", "composition"].includes(row.source) || typeof row.complete !== "boolean"
    || typeof row.revision !== "string" || !row.revision || !Array.isArray(row.missing) || !row.missing.every(item => typeof item === "string")
    || row.complete && (typeof row.unit_cost !== "number" || !Number.isFinite(row.unit_cost) || row.unit_cost < 0 || row.unit_cost > 1e9)
    || !row.complete && row.unit_cost !== null) throw new Error("Não foi possível conferir o custo salvo do produto. Atualize a prévia.");
  return row;
}
export async function applySavedCatalogPrice(productId: string, quantity: number, revision: string, unitPrice: number, requestId: string) {
  const { data, error } = await rpc("apply_saved_catalog_price", { p_product_id: productId, p_quantity: quantity, p_expected_cost_revision: revision, p_unit_price: unitPrice, p_request_id: requestId });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || !data) throw new Error("O salvamento do preço não foi confirmado. Tente conferir a mesma operação novamente.");
  return data;
}
