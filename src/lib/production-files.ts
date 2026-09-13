import { supabase } from "@/integrations/supabase/client";
import { safePrintFileName, validatePrintFile } from "./product-print-source";
import type { ProductMaterialSnapshot } from "./product-material-recipe";
import type { ProductionPlate } from "./production-plates";

export interface ProductionPrintFile {
  id: string; label?: string | null; file_path: string; file_name: string | null; file_sha256: string | null;
  source_url?: string | null; origin?: string; plate_id?: string | null; plate_index?: number | null;
  printer_model?: string | null; printer_profile_verified?: boolean; captured_at?: string;
}
export interface ProductionRequirement {
  item_id: string; name?: string; item_name?: string; unit: string;
  material_type?: string | null; material_code?: string | null; color?: string | null; color_code?: string | null; color_hex?: string | null;
  recipe_version_id?: string | null; recipe_version?: number; required_grams: number;
  current_stock_grams: number | null; is_active: boolean;
}
export interface JobProductionReview {
  job_id: string; code: string; status: string; product_id: string | null; planned_quantity: number;
  origin: "approved_order" | "catalog" | "reprint" | null; captured_at: string | null;
  file: ProductionPrintFile | null; file_options: ProductionPrintFile[];
  plate: { id: string; label: string; plate_index: number; units_per_plate: number } | null;
  printer: { id: string; name: string; model: string; status: string } | null;
  requirements: ProductionRequirement[]; issues: string[]; preparation_ready: boolean; dispatch_available: false; can_prepare: boolean; manual_accounting_supported: boolean;
  est_total_cost: number | null; est_grams: number | null; est_time_minutes: number | null;
}

const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
export async function readProductionRecipe(productId: string): Promise<ProductMaterialSnapshot> {
  const { data, error } = await rpc("product_material_recipe_preview", { p_product_id: productId });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") throw new Error("Não foi possível consultar a receita do produto.");
  return data as ProductMaterialSnapshot;
}
export function platesWithRecipe(plates: ProductionPlate[], snapshot?: ProductMaterialSnapshot): ProductionPlate[] {
  return plates.map(plate => {
    const recipe = snapshot?.plates.find(value => value.id === plate.id)?.recipe;
    if (!recipe) return plate;
    return { ...plate, material_id: recipe.lines[0]?.item_id ?? null,
      est_grams: recipe.lines.reduce((sum, line) => sum + line.grams_per_print, 0), est_cost_per_unit: recipe.cost_per_unit,
      inventory_items: { name: recipe.lines.map(line => `${line.name} · ${line.color_code || line.color || "cor pendente"}`).join(" / ") } };
  });
}
export function jobRecipeMaterialCount(job: { production_snapshot?: unknown; print_plate_id?: string | null }): number {
  const snapshot = job.production_snapshot;
  if (!snapshot || typeof snapshot !== "object" || !("requirements" in snapshot) || !Array.isArray(snapshot.requirements)) return 0;
  return new Set(snapshot.requirements.filter(line => line && typeof line === "object" && (line.plate_id || null) === (job.print_plate_id || null)).map(line => line.item_id)).size;
}
export async function readJobProduction(jobId: string): Promise<JobProductionReview> {
  const { data, error } = await rpc("job_production_review", { p_job_id: jobId });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") throw new Error("Não foi possível consultar a preparação da ordem.");
  return data as JobProductionReview;
}
export async function prepareJobPrintFile(jobId: string, sourceId: string, printerId: string, reason: string, requestId: string) {
  if (!sourceId || !printerId) throw new Error("Selecione o arquivo e a impressora.");
  if (!reason.trim()) throw new Error("Informe a justificativa da preparação.");
  const { data, error } = await rpc("prepare_job_print_file", { p_job_id: jobId, p_source_id: sourceId, p_printer_id: printerId, p_reason: reason.trim(), p_request_id: requestId });
  if (error) throw new Error(error.message);
  if (data !== jobId) throw new Error("A preparação não foi confirmada. Atualize antes de tentar novamente.");
}

export function filePreparationHint(name: string | null) {
  if (name && /\.stl$/i.test(name)) return "Modelo STL: abra no Bambu Studio e fatie com a máquina, o material e a cor desta ordem.";
  if (name && /(?:\.gcode|\.gcode\.3mf)$/i.test(name)) return "Arquivo fatiado: confira modelo da máquina, bico, placa e mapeamento de filamentos no Bambu Studio ou Connect antes de enviar.";
  return "Projeto 3MF: confira a placa selecionada e o perfil de máquina no Bambu Studio. A extensão não confirma que o arquivo já foi fatiado.";
}
export async function verifyPrintFileBlob(file: ProductionPrintFile, blob: Blob) {
  validatePrintFile({ name: file.file_name || file.file_path, size: blob.size });
  if (file.file_sha256) {
    if (!/^[a-f\d]{64}$/i.test(file.file_sha256)) throw new Error("A referência de integridade do arquivo é inválida.");
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== file.file_sha256.toLowerCase()) throw new Error("O arquivo difere da versão registrada na ordem. O download foi interrompido.");
  }
}
export async function downloadJobPrintFile(file: ProductionPrintFile, tenantId: string) {
  if (!file.file_path || file.file_path.split("/")[0] !== tenantId || file.file_path.includes("..")) throw new Error("O arquivo não pertence à empresa desta ordem.");
  const { data, error } = await supabase.storage.from("attachments").createSignedUrl(file.file_path, 60);
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error("Não foi possível preparar o download privado.");
  const response = await fetch(data.signedUrl, { credentials: "omit" });
  if (!response.ok) throw new Error("Não foi possível baixar o arquivo. Tente novamente.");
  const blob = await response.blob(); await verifyPrintFileBlob(file, blob);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = objectUrl;
  anchor.download = safePrintFileName(file.file_name || file.file_path.split("/").at(-1) || "impressao.3mf");
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function productionFileName(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  return typeof value.file_name === "string" && value.file_name.trim() ? value.file_name : typeof value.file_path === "string" ? "Arquivo associado" : null;
}
