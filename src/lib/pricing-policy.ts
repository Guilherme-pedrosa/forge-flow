import { supabase } from "@/integrations/supabase/client";

export const pricingPolicyFields = [
  { key: "machine_hour_cost", label: "Hora da máquina padrão (R$/h)", hint: "Uso e desgaste da máquina. A energia é calculada separadamente." },
  { key: "labor_cost_hour", label: "Hora de manipulação (R$/h)", hint: "Tarifa do trabalho ativo de preparação, acabamento e montagem." },
  { key: "energy_cost_kwh", label: "Energia elétrica (R$/kWh)", hint: "O tempo de impressão e a potência da impressora determinam o consumo." },
  { key: "target_margin", label: "Margem desejada sobre a venda (%)", hint: "Preço sugerido = custo ÷ (1 − margem/100). Não é acréscimo sobre o custo." },
  { key: "handling_minutes_per_plate", label: "Preparação e retirada por placa (min)", hint: "Tempo ativo por impressão: preparar, retirar as peças e limpar a mesa." },
  { key: "finishing_minutes_per_piece", label: "Acabamento padrão por peça (min)", hint: "Remover suportes, lixar e finalizar cada peça. A ficha específica da peça tem prioridade sobre este padrão." },
  { key: "assembly_minutes_per_product", label: "Montagem por produto completo (min)", hint: "Tempo para reunir as peças e montar uma unidade do produto final." },
  { key: "extras_cost_per_product", label: "Outros insumos padrão por produto (R$)", hint: "Custo adicional por unidade. Embalagens, ímãs e outros itens também podem ser escolhidos do estoque na precificação do produto." },
  { key: "overhead_percent", label: "Despesas indiretas de produção (%)", hint: "Percentual sobre materiais, energia, máquina e trabalho. Não incide outra vez sobre os insumos finais." },
] as const;
export type PricingPolicyKey = typeof pricingPolicyFields[number]["key"];
export type PricingPolicy = Record<PricingPolicyKey, number | null> & {
  revision: string;
  machine_rate_scope: "commercial_excludes_energy";
  printer_hour_costs: { printer_id: string; hour_cost: number }[];
};
export type PricingPolicyPayload = Record<PricingPolicyKey, number | null> & { printer_hour_costs: { printer_id: string; hour_cost: number }[] };
export type PricingPolicyDraft = { values: Record<PricingPolicyKey, string>; printerHours: Record<string, string> };
export const emptyPricingPolicyDraft = (): PricingPolicyDraft => ({ values: Object.fromEntries(pricingPolicyFields.map(field => [field.key, ""])) as PricingPolicyDraft["values"], printerHours: {} });
export function pricingPolicyDraft(policy: PricingPolicy): PricingPolicyDraft {
  return { values: Object.fromEntries(pricingPolicyFields.map(field => [field.key, policy[field.key] == null ? "" : String(policy[field.key]).replace(".", ",")])) as PricingPolicyDraft["values"], printerHours: Object.fromEntries(policy.printer_hour_costs.map(printer => [printer.printer_id, String(printer.hour_cost).replace(".", ",")])) };
}
export function pricingPolicyNumber(value: string, label: string, margin = false): number | null {
  const raw = value.trim();
  if (!raw) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(raw)) throw new Error(`Informe um valor válido para ${label}.`);
  const result = Number(raw.replace(",", "."));
  if (!Number.isFinite(result) || result < 0 || result > 1e9 || margin && result >= 100) throw new Error(margin ? "A margem deve ficar entre 0% e menos de 100%." : `Revise ${label}.`);
  return result;
}
export function pricingPolicyPayload(draft: PricingPolicyDraft): PricingPolicyPayload {
  return { ...Object.fromEntries(pricingPolicyFields.map(field => [field.key, pricingPolicyNumber(draft.values[field.key], field.label, field.key === "target_margin")])),
    printer_hour_costs: Object.entries(draft.printerHours).flatMap(([printer_id, raw]) => {
      const hour_cost = pricingPolicyNumber(raw, "hora da impressora");
      return hour_cost == null ? [] : [{ printer_id, hour_cost }];
    }).sort((a, b) => a.printer_id.localeCompare(b.printer_id)),
  } as PricingPolicyPayload;
}
async function policyRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const call = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: T; error: { message: string } | null }>;
  const result = await call(name, args);
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error("As configurações de precificação não foram confirmadas. Atualize a página e tente novamente.");
  return result.data;
}
export const readPricingSettings = () => policyRpc<PricingPolicy>("pricing_settings");
export const savePricingSettings = (settings: PricingPolicyPayload, revision: string, requestId: string) => policyRpc<string>("save_pricing_settings", { p_settings: settings, p_expected_revision: revision, p_request_id: requestId });
