import { supabase } from "@/integrations/supabase/client";
import { positiveInteger } from "./production";
import { readProductionRows } from "./production-read";

export interface ProductionPlate {
  id: string; product_id: string; source_id: string | null; plate_index: number; label: string;
  units_per_plate: number; material_id: string | null; printer_id: string | null;
  est_grams: number | null; est_time_seconds: number | null; est_cost_per_unit: number | null; is_active: boolean;
  inventory_items?: { name: string } | null; printers?: { name: string } | null;
}
type Query = PromiseLike<{ data: ProductionPlate[] | null; error: { message: string } | null }> & {
  select(columns: string): Query; eq(column: string, value: string | boolean): Query;
  order(column: string): Query; range(from: number, to: number): Query;
};
export function readProductPlates(productId?: string) {
  const from = supabase.from.bind(supabase) as unknown as (table: string) => Query;
  return readProductionRows<ProductionPlate>((a, b) => {
    let query = from("product_print_plates").select("id,product_id,source_id,plate_index,label,units_per_plate,material_id,printer_id,est_grams,est_time_seconds,est_cost_per_unit,is_active,inventory_items(name),printers(name)").eq("is_active", true);
    if (productId) query = query.eq("product_id", productId);
    return query.order("plate_index").order("id").range(a, b);
  });
}
export function productionPlatePlan(plates: ProductionPlate[], quantity: string | number) {
  const units = positiveInteger(quantity, "Quantidade de conjuntos", 10000);
  return plates.filter(plate => plate.is_active).map(plate => {
    const capacity = positiveInteger(plate.units_per_plate, "Peças por placa", 10000);
    const runs = Math.ceil(units / capacity);
    return { ...plate, runs, plannedCapacity: runs * capacity,
      totalGrams: plate.est_grams == null ? null : plate.est_grams * runs,
      totalSeconds: plate.est_time_seconds == null ? null : plate.est_time_seconds * runs,
      totalCost: plate.est_cost_per_unit == null ? null : plate.est_cost_per_unit * capacity * runs,
    };
  });
}
export async function planProductPlates(productId: string, quantity: number, requestId: string): Promise<string[]> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string[] | null; error: { message: string } | null }>;
  const { data, error } = await rpc("plan_product_plates", { p_product_id: productId, p_quantity: quantity, p_request_id: requestId });
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Não foi possível confirmar a criação das ordens do conjunto.");
  return data;
}
