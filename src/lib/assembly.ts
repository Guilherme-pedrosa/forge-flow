import { supabase } from "@/integrations/supabase/client";
import { allRows } from "./finance";

export type AssemblyComponent = { plate_id: string; label: string; plate_index: number; units_per_print: number | null; balance: number; available: number; reserved: number; pending: number; required: number; missing: number; to_print: number; runs: number | null; prepared: boolean; material_key: string; photo_url?: string | null; parts?: { name: string; quantity_per_product: number | null; quantity_per_plate: number | null; name_source: string }[] };
export type AssemblyStatus = { product_id: string; name: string; enabled: boolean; item_id: string | null; required: number; assembled: number; ready_to_assemble: number; finished_stock: number; components: AssemblyComponent[] };
export type AssemblyItem = { id: string; product_id: string; description: string; quantity: number; assembled_quantity: number; assembly_required: boolean; production_order_id: string };
export type ComponentJob = { id: string; code: string; name: string; description: string | null; planned_quantity: number; produced_quantity: number | null; component_stock_key: string | null; status: string };
export type AssemblyHistory = { id: string; quantity: number; component_cost: number; finishing_cost: number; item_id: string | null; created_at: string; notes: string | null };
export async function assemblyRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { message: string } | null }>;
  const result = await rpc(name, args);
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error("A operação não foi confirmada. Atualize para conferir.");
  return result.data;
}
type Query<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }> & { select(value: string): Query<T>; eq(key: string, value: string | boolean): Query<T>; order(key: string, options?: { ascending: boolean }): Query<T>; range(a: number, b: number): Query<T> };
export function assemblyRows<T>(table: string, columns: string, filters: Record<string, string | boolean>, order = "id") {
  const from = supabase.from.bind(supabase) as unknown as (table: string) => Query<T>;
  return allRows((a, b) => { let query = from(table).select(columns); for (const [key, value] of Object.entries(filters)) query = query.eq(key, value); return query.order(order).order("id").range(a, b); });
}
export async function readAssemblyStatus(productId: string, quantity: number, itemId?: string) {
  const result = await assemblyRpc<AssemblyStatus>("assembly_product_status", { p_product_id: productId, p_quantity: quantity, p_item_id: itemId || null });
  if (!Array.isArray(result.components)) throw new Error("Não foi possível conferir os componentes. Atualize para tentar novamente.");
  return result;
}
export const assemblyKeys = ["assembly_status", "assembly_jobs", "assembly_history", "assembly_items", "product_print_plates", "product_material_recipe", "products", "inventory_items", "production_preflight", "production_order_jobs", "jobs", "orders", "production_orders"];
