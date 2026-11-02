import { supabase } from "@/integrations/supabase/client";
import { allRows } from "./finance";

export const MISSING_FILAMENT_COST = "Informe o custo deste filamento ou registre uma compra recebida.";

/** A newly identified color starts at zero without an acquisition rate. Only an
 * explicit zero-cost receipt can confirm that zero really means free material. */
export async function loadPricingFilaments() {
  const items = await allRows((from, to) => supabase.from("inventory_items")
    .select("id,name,unit,current_stock,avg_cost,material_code,material_description,material_type,color,color_code,color_hex,brand,sku,diameter,notes")
    .eq("is_active", true).eq("category", "filament").in("unit", ["g", "kg"])
    .order("name").order("id").range(from, to));
  const zeroIds = items.filter(item => item.avg_cost === 0).map(item => item.id);
  const free = new Set<string>();
  // Keep the URL of each PostgREST request bounded even for a large catalog.
  for (let offset = 0; offset < zeroIds.length; offset += 100) {
    const receipts = await allRows((from, to) => supabase.from("inventory_movements")
      .select("item_id").eq("movement_type", "purchase_in").eq("unit_cost", 0).gt("quantity", 0)
      .in("item_id", zeroIds.slice(offset, offset + 100)).order("item_id").order("id").range(from, to));
    for (const receipt of receipts) free.add(receipt.item_id);
  }
  return items.map(item => ({ ...item, cost_confirmed: typeof item.avg_cost === "number" && Number.isFinite(item.avg_cost)
    && (item.avg_cost > 0 || item.avg_cost === 0 && free.has(item.id)) }));
}
