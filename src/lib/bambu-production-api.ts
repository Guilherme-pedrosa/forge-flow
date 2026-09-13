import { supabase } from "@/integrations/supabase/client";
import { readProductionRows } from "./production-read";
import type { BambuExpectedMaterial, BambuMaterialOverride, BambuMaterialPolicy, BambuSelectionFilament } from "./bambu-material-selection";

export interface BambuMaterialBinding { source_key: string; item_id: string }
export interface BambuJobAllocation { job_id: string; quantity: number }
export interface BambuProductionConfiguration {
  product_id?: string | null; units?: number | null;
  plate_id?: string | null;
  materials?: BambuMaterialBinding[]; allocations?: BambuJobAllocation[];
  auto_enabled?: boolean; use_slicer?: boolean;
  labor_cost?: number | null; overhead?: number | null; extras_cost?: number | null;
  material_overrides?: BambuMaterialOverride[];
}
export interface BambuProductionPreview {
  task_id: string; project_key: string | null; can_auto: boolean;
  outcome: "printing" | "completed" | "failed" | "unknown";
  elapsed_seconds: number | null; planned_grams: number | null;
  filaments: BambuSelectionFilament[];
  material_policy?: BambuMaterialPolicy; expected_materials?: BambuExpectedMaterial[];
  record: BambuProductionConfiguration | null; profile: BambuProductionConfiguration | null;
  candidate_product_id?: string | null; candidate_source?: "verified_identifiers" | "legacy_note" | "ambiguous" | null;
  candidate_plate_id?: string | null;
  skipped_objects?: unknown[] | null;
}
export interface BambuProductionReview {
  task_id: string; bambu_task_id: string; design_title: string | null; device_name: string | null;
  started_at: string | null; ended_at: string | null; raw_status: string | null;
  outcome: BambuProductionPreview["outcome"];
  state: "unlinked" | "watching" | "needs_measurement" | "ready" | "blocked" | "posted" | "unknown";
  problem: string | null; planned_grams: number | null; elapsed_seconds: number | null;
  posted_at: string | null; total_cost: number | null; product_id: string | null; product_name: string | null;
  units: number | null; completed_units?: number | null;
  plate_id?: string | null; plate_label?: string | null; plate_index?: number | null;
  quality_state?: string | null; quality_rejected_units?: number | null;
  quality_loss_grams?: number | null; quality_loss_cost?: number | null;
  consumption_source: "slicer_completed" | "measured" | null; auto_enabled: boolean;
}
export interface BambuSyncState {
  bambu_device_id: string; status: "idle" | "queued" | "syncing" | "success" | "error" | "disabled";
  last_success_at: string | null; last_error: string | null; last_error_code: string | null;
  next_attempt_at: string | null; history_may_be_truncated: boolean;
}
type ReadResult<T> = { data: T[] | null; error: { message: string } | null };
type ReadQuery<T> = PromiseLike<ReadResult<T>> & {
  select(columns: string): ReadQuery<T>;
  gte(column: string, value: string): ReadQuery<T>;
  lte(column: string, value: string): ReadQuery<T>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): ReadQuery<T>;
  range(from: number, to: number): ReadQuery<T>;
};
const from = supabase.from.bind(supabase) as unknown as <T>(table: string) => ReadQuery<T>;

export function readBambuProductionReview() {
  return readProductionRows<BambuProductionReview>((a, b) => from<BambuProductionReview>("bambu_production_review").select("*").order("started_at", { ascending: false, nullsFirst: false }).order("task_id").range(a, b));
}
export interface BambuQualityRejection {
  job_id: string; task_id: string; quantity: number; grams: number; elapsed_seconds: number;
  material_cost: number; total_cost: number; reason: string; created_at: string;
  jobs: { code: string; name: string } | null;
}
export function readBambuQualityRejections(start: string, end: string) {
  return readProductionRows<BambuQualityRejection>((a, b) => from<BambuQualityRejection>("bambu_quality_rejections")
    .select("job_id,task_id,quantity,grams,elapsed_seconds,material_cost,total_cost,reason,created_at,jobs(code,name)")
    .gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }).order("job_id").range(a, b));
}
export async function readBambuSyncState() {
  const { data, error } = await from<BambuSyncState>("bambu_sync_state").select("bambu_device_id,status,last_success_at,last_error,last_error_code,next_attempt_at,history_may_be_truncated");
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function bambuRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
