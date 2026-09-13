import { gramsToStockUnit, nonNegative, positiveInteger } from "@/lib/production";
import type { Tables } from "@/integrations/supabase/types";

type Material = Pick<Tables<"inventory_items">, "avg_cost" | "unit" | "loss_coefficient">;
type Printer = Pick<Tables<"printers">, "name" | "power_watts" | "depreciation_per_hour" | "maintenance_cost_per_hour" | "acquisition_cost" | "useful_life_hours">;
export interface ProductCostInput {
  grams: string | number; printHours: string | number; postMinutes: string | number; printsPerPlate: string | number;
  material?: Material; printer?: Printer;
  settings: { energy_cost_kwh: number; labor_cost_hour: number; overhead_percent: number; target_margin: number };
  extras: { cost: number }[];
}

export function suggestedProductPrice(cost: number, margin: number) {
  nonNegative(cost, "Custo");
  if (!Number.isFinite(margin) || margin < 0 || margin >= 100) throw new Error("A margem desejada deve ser maior ou igual a 0% e menor que 100%.");
  return cost / (1 - margin / 100);
}

export function calculateProductCost(input: ProductCostInput) {
  const grams = nonNegative(input.grams, "Peso por placa");
  const hours = nonNegative(input.printHours, "Tempo por placa");
  const postHours = nonNegative(input.postMinutes, "Acabamento por placa") / 60;
  const count = positiveInteger(input.printsPerPlate, "Peças por placa", 10000);
  if (grams > 0 && !input.material) throw new Error("Selecione o material para calcular o custo da impressão.");
  if (hours > 0 && !input.printer) throw new Error("Selecione a impressora usada como referência de custo.");
  const loss = nonNegative(input.material?.loss_coefficient, "Coeficiente de perda");
  if (loss > 1) throw new Error("O coeficiente de perda do material deve estar entre 0 e 1.");
  // Average inventory cost already includes acquisition freight. Never add it a second time.
  const materialPlate = input.material ? gramsToStockUnit(grams * (1 + loss), input.material.unit) * nonNegative(input.material.avg_cost, "Custo do material") : 0;
  const energyPlate = hours * nonNegative(input.printer?.power_watts, "Potência") / 1000 * nonNegative(input.settings.energy_cost_kwh, "Tarifa de energia");
  const depreciation = input.printer?.depreciation_per_hour ?? (input.printer && (input.printer.useful_life_hours ?? 0) > 0 ? nonNegative(input.printer.acquisition_cost, "Valor da máquina") / input.printer.useful_life_hours! : 0);
  const rate = nonNegative(depreciation, "Depreciação") + nonNegative(input.printer?.maintenance_cost_per_hour, "Manutenção");
  const machinePlate = hours * rate;
  const laborPlate = postHours * nonNegative(input.settings.labor_cost_hour, "Mão de obra");
  const subtotal = materialPlate + energyPlate + machinePlate + laborPlate;
  const overheadPlate = subtotal * nonNegative(input.settings.overhead_percent, "Custos indiretos") / 100;
  const totalPlate = subtotal + overheadPlate;
  const extrasCost = input.extras.reduce((sum, extra) => sum + nonNegative(extra.cost, "Custo dos extras"), 0);
  const total = totalPlate / count + extrasCost;
  return { materialCost: materialPlate / count, energyCost: energyPlate / count, machineCost: machinePlate / count, laborCost: laborPlate / count, overhead: overheadPlate / count, totalPerPiece: totalPlate / count, total, extrasCost, totalPlate, printsPerPlate: count, suggestedPrice: suggestedProductPrice(total, input.settings.target_margin), selectedPrinterName: input.printer?.name ?? null, hasMachineRate: rate > 0 };
}
