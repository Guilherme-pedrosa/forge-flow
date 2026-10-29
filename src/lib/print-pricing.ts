import { nonNegative, positiveInteger } from "./production";
import { suggestedProductPrice } from "./product-costs";
export type PricingInput = {
  quantity: string | number;
  hours: string | number;
  watts: string | number;
  kwh: string | number;
  machineHour: string | number;
  laborMinutes: string | number;
  laborHour: string | number;
  overhead: string | number;
  failure: string | number;
  margin: string | number;
  target: string | number;
  materials: {
    name: string;
    grams: string | number;
    kgPrice: string | number;
  }[];
  extras: { name: string; cost: string | number; basis: "lot" | "unit" }[];
};
const confirmed = (value: string | number, label: string) => {
  if (typeof value === "string" && !value.trim()) throw new Error(`Confirme ${label}, inclusive zero quando não houver custo.`);
  return nonNegative(value, label);
};
/** Material subtotal only; this is not a complete production cost or sale price. */
export function printMaterialCost(materials: PricingInput["materials"]) {
  return materials.reduce(
    (total, m) => {
      const grams = nonNegative(m.grams, "Gramas");
      return total + (grams * (grams > 0 ? confirmed(m.kgPrice, `o preço do kg de ${m.name || "filamento"}`) : nonNegative(m.kgPrice, "Preço do kg"))) / 1000;
    },
    0,
  );
}
export function pricePrint(input: PricingInput) {
  const quantity = positiveInteger(input.quantity, "Quantidade do lote", 10000);
  const materials = printMaterialCost(input.materials);
  const hours = nonNegative(input.hours, "Horas de impressão");
  const energy =
    ((hours * (hours > 0 ? confirmed(input.watts, "a potência da impressora") : nonNegative(input.watts, "Potência"))) / 1000) *
    (hours > 0 ? confirmed(input.kwh, "a tarifa de energia") : nonNegative(input.kwh, "Energia"));
  const machine =
    hours * (hours > 0 ? confirmed(input.machineHour, "a hora-máquina") : nonNegative(input.machineHour, "Custo da máquina por hora"));
  const laborMinutes = nonNegative(input.laborMinutes, "Minutos de trabalho");
  const labor =
    (laborMinutes / 60) * (laborMinutes > 0 ? confirmed(input.laborHour, "a tarifa de mão de obra") : nonNegative(input.laborHour, "Mão de obra"));
  const overhead =
    ((materials + energy + machine + labor) *
      confirmed(input.overhead, "as despesas indiretas")) /
    100;
  const failureRate = nonNegative(input.failure, "Reserva de falhas");
  if (failureRate > 100)
    throw new Error("A reserva de falhas deve ficar entre 0% e 100%.");
  const failures =
    ((materials + energy + machine + labor + overhead) * failureRate) / 100;
  const extras = input.extras.reduce(
    (total, e) =>
      total +
      confirmed(e.cost, "o custo do extra") * (e.basis === "unit" ? quantity : 1),
    0,
  );
  const lot =
    materials + energy + machine + labor + overhead + failures + extras;
  const unit = lot / quantity;
  const suggested = Math.max(0,
    Math.ceil(
      (suggestedProductPrice(unit, confirmed(input.margin, "a margem sobre a venda")) -
        1e-9) *
        100,
    ) / 100);
  const target =
    input.target === "" ? suggested : nonNegative(input.target, "Preço alvo");
  if (
    ![lot, unit, suggested, target].every(Number.isFinite) ||
    lot > 1e9 ||
    target > 1e9
  )
    throw new Error("Os valores da simulação são muito altos.");
  return {
    quantity,
    materials,
    energy,
    machine,
    labor,
    overhead,
    failures,
    extras,
    lot,
    unit,
    suggested,
    target,
    revenue: target * quantity,
    profit: target * quantity - lot,
    margin: target > 0 ? ((target - unit) / target) * 100 : null,
  };
}
export type PricingTransfer = {
  name: string;
  cost: number;
  price: number;
  quantity: number;
  quote: boolean;
};
export function readPricingTransfer(value: unknown): PricingTransfer | null {
  if (!value || typeof value !== "object") return null;
  const v = value as PricingTransfer;
  if (
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 200 ||
    typeof v.quote !== "boolean" ||
    ![v.cost, v.price].every((n) => Number.isFinite(n) && n >= 0 && n <= 1e9) ||
    !Number.isInteger(v.quantity) ||
    v.quantity < 1 ||
    v.quantity > 10000
  )
    return null;
  return v;
}
