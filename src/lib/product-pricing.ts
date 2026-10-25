import { supabase } from "@/integrations/supabase/client";

export type CostBasis = "unit" | "exclusive_lot";
export type PricingPlan = {
  cost_basis?: CostBasis;
  energy_cost_kwh?: number | null;
  labor_cost_hour?: number | null;
  overhead_percent?: number | null;
  target_margin?: number | null;
  machine_hour_cost?: number | null;
  handling_minutes_per_plate?: number | null;
  finishing_minutes_per_piece?: number | null;
  assembly_minutes_per_product?: number | null;
  extras_cost_per_product?: number | null;
  printer_id?: string | null;
  plates?: { plate_id: string; printer_id?: string | null; machine_hour_cost?: number | null; handling_minutes?: number | null }[];
  consumables?: { item_id: string; quantity: number }[];
};
export const costLabels = {
  material: "Filamentos e materiais",
  energy: "Energia",
  machine: "Hora-máquina",
  handling: "Manipulação das placas",
  finishing: "Acabamento das peças",
  assembly: "Montagem do produto",
  extras: "Insumos e outros custos",
  overhead: "Despesas indiretas",
} as const;
export type CostBreakdown = Record<keyof typeof costLabels, number | null> & { total_lot: number | null; unit_cost: number | null };
export type PricingPlate = {
  plate_id: string; product_id: string; label: string; source: string;
  runs: number; printer_id: string | null; printer_name: string | null;
  print_seconds_per_run: number | null; handling_minutes_per_run: number | null;
  machine_hour_cost: number | null; power_watts: number | null;
  materials: { name?: string | null; material?: string | null; color?: string | null; grams: number | null; cost: number | null }[];
  material: number | null; energy: number | null; machine: number | null; handling: number | null;
  missing: string[];
};
export type PricingRun = {
  plate_id: string | null; label: string; required_runs: number | null; full_runs: number | null;
  surplus_units?: number | null;
  outputs?: { component_product_id?: string; product_id?: string; required_quantity: number | null; produced_quantity: number | null; surplus_units: number | null }[];
};
export type PricingComponent = {
  name?: string; component_product_id: string; quantity_per_product?: number | null;
  required_quantity: number; plate_id?: string | null; quantity_per_plate?: number | null;
  technical?: { source?: string; grams?: number | null; print_seconds?: number | null; materials?: { grams: number | null }[] };
  pricing?: ProductPricingPreview;
};
export type ProductPricingPreview = {
  product_id: string; product_name: string; quantity: number; complete: boolean; missing: string[];
  revision: string; plan_revision: string; plan: PricingPlan; cost_basis: CostBasis;
  components: PricingComponent[]; plates: PricingPlate[]; runs: PricingRun[];
  breakdown: CostBreakdown; production_breakdown: CostBreakdown;
  margin_percent: number | null; suggested_unit_price: number | null; manual_cost_reference: number | null;
};
export type ProductPricingPlan = { plan: PricingPlan; revision: string };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const amount = (value: unknown) => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12;

/** Reject a broken response instead of displaying unknown amounts as zero. */
export function readProductPricingPreview(value: unknown): ProductPricingPreview {
  if (!object(value) || typeof value.product_id !== "string" || typeof value.product_name !== "string" ||
      !Number.isInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 10000 ||
      typeof value.revision !== "string" || typeof value.plan_revision !== "string" || typeof value.complete !== "boolean" ||
      !["unit", "exclusive_lot"].includes(String(value.cost_basis)) || !object(value.plan) ||
      !Array.isArray(value.missing) || !value.missing.every(x => typeof x === "string") ||
      ![value.components, value.plates, value.runs].every(Array.isArray)) {
    throw new Error("A prévia de precificação está incompleta. Atualize e tente novamente.");
  }
  for (const key of ["breakdown", "production_breakdown"]) {
    const costs = value[key];
    if (!object(costs) || ![...Object.keys(costLabels), "total_lot", "unit_cost"].every(k => amount(costs[k]))) {
      throw new Error("Não foi possível conferir os custos retornados.");
    }
  }
  if (![value.margin_percent, value.suggested_unit_price, value.manual_cost_reference].every(amount) ||
      value.margin_percent != null && Number(value.margin_percent) >= 100) {
    throw new Error("Não foi possível conferir os preços retornados.");
  }
  const costs = value.breakdown as Record<string, unknown>;
  if (value.complete && (costs.unit_cost == null || costs.total_lot == null || value.suggested_unit_price == null || value.margin_percent == null)) {
    throw new Error("A prévia não tem todos os custos necessários para aplicar o preço.");
  }
  if (!value.complete && (costs.unit_cost != null || costs.total_lot != null || value.suggested_unit_price != null)) {
    throw new Error("A prévia contém pendências e não pode fornecer um preço final.");
  }
  return value as unknown as ProductPricingPreview;
}

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase.rpc.bind(supabase) as unknown as Rpc)(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function readProductPricingPlan(productId: string): Promise<ProductPricingPlan> {
  const result = await rpc("product_pricing_plan", { p_product_id: productId });
  if (!object(result) || !object(result.plan) || typeof result.revision !== "string") throw new Error("Não foi possível carregar o plano do produto.");
  return result as ProductPricingPlan;
}
export async function previewProductPricing(productId: string, quantity: number, overrides: PricingPlan) {
  const result = readProductPricingPreview(await rpc("product_pricing_preview", { p_product_id: productId, p_quantity: quantity, p_overrides: overrides }));
  if (result.product_id !== productId || result.quantity !== quantity || overrides.cost_basis && result.cost_basis !== overrides.cost_basis) {
    throw new Error("A prévia retornada não corresponde ao produto e à quantidade selecionados.");
  }
  return result;
}
export async function saveProductPricingPlan(productId: string, plan: PricingPlan, revision: string, requestId: string) {
  return rpc("save_product_pricing_plan", { p_product_id: productId, p_plan: plan, p_expected_revision: revision, p_request_id: requestId });
}
export async function applyProductPricing(productId: string, quantity: number, overrides: PricingPlan, revision: string, price: number, requestId: string) {
  return rpc("apply_product_pricing", { p_product_id: productId, p_quantity: quantity, p_overrides: overrides, p_expected_revision: revision, p_unit_price: price, p_request_id: requestId });
}

/** A child product may have its own plates; preserve the tree's individual rates. */
export function pricingProductionRows(preview: ProductPricingPreview): { plates: PricingPlate[]; runs: PricingRun[]; components: PricingComponent[] } {
  const result = { plates: [...(preview.plates ?? [])], runs: [...(preview.runs ?? [])], components: [...(preview.components ?? [])] };
  for (const component of preview.components ?? []) {
    if (component.pricing) {
      const child = pricingProductionRows(component.pricing);
      result.plates.push(...child.plates);
      result.runs.push(...child.runs);
      result.components.push(...child.components);
    }
  }
  return result;
}

export function pricingNumber(value: string, label: string, max = 1000000): number | null {
  if (!value.trim()) return null;
  const normalized = value.includes(",") ? value.trim().replace(/\./g, "").replace(",", ".") : value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error(`${label}: informe um número maior ou igual a zero.`);
  const number = Number(normalized);
  if (!Number.isFinite(number) || number > max) throw new Error(`${label}: valor acima do limite.`);
  return number;
}
