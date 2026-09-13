import { supabase } from "@/integrations/supabase/client";
import type { JobStatus } from "./production";

export interface CreateJobInput {
  name: string;
  description?: string | null;
  status: "draft" | "queued";
  product_id?: string | null;
  material_id?: string | null;
  secondary_material_id?: string | null;
  printer_id?: string | null;
  due_date?: string | null;
  priority?: number;
  num_colors?: number;
  purge_waste_grams?: number;
  est_grams?: number | null;
  est_time_minutes?: number | null;
  est_material_cost?: number | null;
  est_energy_cost?: number | null;
  est_machine_cost?: number | null;
  est_labor_cost?: number | null;
  est_overhead?: number | null;
  est_extras_cost?: number | null;
  est_total_cost?: number | null;
  sale_price?: number | null;
}

/** The server assigns identity and ownership and reuses the whole batch on retry. */
export async function createJobs(jobs: CreateJobInput[], requestId: string): Promise<string[]> {
  for (const job of jobs) {
    for (const value of Object.values(job)) {
      // JSON serializes NaN/Infinity as null, which would erase an invalid
      // catalog estimate before PostgreSQL had a chance to reject it.
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Revise os custos e as estimativas: há um número inválido.");
    }
  }
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
  const { data, error } = await rpc("create_jobs", { p_jobs: jobs, p_request_id: requestId });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || !data.every(id => typeof id === "string")) throw new Error("Não foi possível confirmar a criação das ordens. Tente novamente.");
  if (data.length === 0) throw new Error("Esta operação já foi concluída, mas suas ordens foram removidas. Atualize a página.");
  return data;
}

export interface JobTransition {
  id: string;
  status: JobStatus;
  actualGrams?: number;
  actualMinutes?: number;
  wasteGrams?: number;
  failureReason?: string;
  printerId?: string;
  secondaryActualGrams?: number;
  actualLaborCost?: number;
  actualOverhead?: number;
  actualExtrasCost?: number;
}

/** One database transaction owns status, cost and stock. Never retry as client-side writes. */
export async function transitionJob(input: JobTransition) {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  const { error } = await rpc("transition_job", {
    p_job_id: input.id, p_status: input.status,
    p_actual_grams: input.actualGrams ?? null,
    p_actual_time_minutes: input.actualMinutes ?? null,
    p_waste_grams: input.wasteGrams ?? null,
    p_failure_reason: input.failureReason ?? null,
    p_printer_id: input.printerId ?? null,
    p_secondary_actual_grams: input.secondaryActualGrams ?? null,
    p_actual_labor_cost: input.actualLaborCost ?? null,
    p_actual_overhead: input.actualOverhead ?? null,
    p_actual_extras_cost: input.actualExtrasCost ?? null,
  });
  if (error) throw new Error(error.message);
}

export const productionQueryKeys = ["jobs", "fila_jobs", "orders", "inventory_items", "inventory_movements", "margin_sku_jobs", "production_losses", "printers", "fila_printers", "products", "products_list", "fila_products", "product_print_plates", "bambu_production_review", "bambu_production_preview", "dre_jobs"];
