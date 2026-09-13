import type { Tables } from "@/integrations/supabase/types";

export type JobStatus = Tables<"jobs">["status"];
export const jobTransitions: Record<JobStatus, JobStatus[]> = {
  draft: ["queued"], queued: ["printing", "draft"],
  printing: ["paused", "failed", "post_processing", "quality_check", "completed"],
  paused: ["printing", "failed"], failed: ["reprint"], reprint: ["queued"],
  post_processing: ["quality_check", "completed"], quality_check: ["ready", "failed"],
  ready: ["shipped", "completed"], shipped: ["completed"], completed: [],
};

export function requiresProductionMeasurement(status: JobStatus, inventoryPostedAt?: string | null) {
  return !inventoryPostedAt && ["failed", "post_processing", "quality_check", "ready", "completed"].includes(status);
}

export function nonNegative(value: string | number | null | undefined, label: string, fallback = 0): number {
  const number = value === "" || value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} deve ser um número maior ou igual a zero.`);
  return number;
}

export function positiveInteger(value: string | number, label: string, max = 500): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${label} deve ser um inteiro entre 1 e ${max}.`);
  return number;
}

/** Grams from the slicer must be converted to the inventory item's own unit. */
export function gramsToStockUnit(grams: number, unit: string): number {
  nonNegative(grams, "Consumo");
  const normalized = unit.trim().toLowerCase();
  if (normalized === "g") return grams;
  if (normalized === "kg") return grams / 1000;
  throw new Error("O material de impressão deve usar gramas (g) ou quilogramas (kg).");
}

type CostMaterial = Pick<Tables<"inventory_items">, "unit" | "avg_cost" | "loss_coefficient">;
type CostPrinter = Pick<Tables<"printers">, "power_watts" | "depreciation_per_hour" | "maintenance_cost_per_hour">;

export function estimateProductionCosts(input: {
  grams: number; minutes: number; purgeGrams?: number; material?: CostMaterial;
  purgeMaterial?: CostMaterial; printer?: CostPrinter; energyRate?: number;
  labor?: number; overhead?: number; extras?: number;
}) {
  const { material, printer } = input;
  const grams = nonNegative(input.grams, "Peso");
  const hours = nonNegative(input.minutes, "Tempo") / 60;
  const purge = nonNegative(input.purgeGrams, "Purga");
  const materialCost = material
    ? gramsToStockUnit(grams * (1 + (material.loss_coefficient ?? 0)), material.unit) * nonNegative(material.avg_cost, "Custo") : 0;
  const purgeMaterial = input.purgeMaterial ?? material;
  const purgeCost = purgeMaterial ? gramsToStockUnit(purge, purgeMaterial.unit) * nonNegative(purgeMaterial.avg_cost, "Custo") : 0;
  const machine = printer ? hours * ((printer.depreciation_per_hour ?? 0) + (printer.maintenance_cost_per_hour ?? 0)) : 0;
  const energy = printer ? hours * ((printer.power_watts ?? 0) / 1000) * nonNegative(input.energyRate, "Tarifa", 0.85) : 0;
  const labor = nonNegative(input.labor, "Mão de obra");
  const overhead = nonNegative(input.overhead, "Custos indiretos");
  const extras = nonNegative(input.extras, "Acessórios e embalagem");
  return { material: materialCost + purgeCost, machine, energy, labor, overhead, extras, total: materialCost + purgeCost + machine + energy + labor + overhead + extras };
}

export function productExtrasPerPiece(extras: unknown): number {
  if (!Array.isArray(extras)) return 0;
  return extras.reduce((total: number, extra: unknown) => {
    if (!extra || typeof extra !== "object" || "_kit_product_id" in extra) return total;
    return total + nonNegative("cost" in extra ? extra.cost as number : 0, "Custo de acessório");
  }, 0);
}

export function newJobCode() {
  return `OI-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function movementDirection(type: string, quantity: number): "in" | "out" {
  if (type === "adjustment") return quantity < 0 ? "out" : "in";
  return ["job_consumption", "loss", "maintenance"].includes(type) ? "out" : "in";
}

export function validateMovement(type: string, quantity: number, stock: number, notes: string) {
  if (!Number.isFinite(quantity) || quantity === 0 || (type !== "adjustment" && quantity < 0)) {
    throw new Error(type === "adjustment" ? "Informe uma diferença positiva ou negativa, diferente de zero." : "A quantidade deve ser maior que zero.");
  }
  if (["adjustment", "loss"].includes(type) && !notes.trim()) throw new Error("Informe a justificativa da perda ou do ajuste.");
  if (movementDirection(type, quantity) === "out" && Math.abs(quantity) > stock) throw new Error("Quantidade maior que o saldo disponível. Confira o estoque antes de registrar.");
}

export function resolvePrinterStatus(localStatus: string, device?: { online: boolean | null; print_status: string | null; last_seen_at?: string | null } | null, now = Date.now()) {
  if (localStatus === "maintenance") return "maintenance";
  if (!device) return localStatus;
  if (device.online === false) return "offline";
  if (device.last_seen_at && now - new Date(device.last_seen_at).getTime() > 5 * 60_000) return "offline";
  const status = device.print_status?.toUpperCase();
  if (["RUNNING", "PRINTING"].includes(status ?? "")) return "printing";
  if (["PAUSE", "PAUSED"].includes(status ?? "")) return "paused";
  if (["FAILED", "ERROR"].includes(status ?? "")) return "error";
  if (["IDLE", "FINISH", "SUCCESS"].includes(status ?? "")) return "idle";
  return localStatus;
}
