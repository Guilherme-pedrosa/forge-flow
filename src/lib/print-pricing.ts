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
export function pricePrint(input: PricingInput) {
  const quantity = positiveInteger(input.quantity, "Quantidade do lote", 10000);
  const materials = input.materials.reduce(
    (total, m) =>
      total +
      (nonNegative(m.grams, "Gramas") * nonNegative(m.kgPrice, "Preço do kg")) /
        1000,
    0,
  );
  const hours = nonNegative(input.hours, "Horas de impressão");
  const energy =
    ((hours * nonNegative(input.watts, "Potência")) / 1000) *
    nonNegative(input.kwh, "Energia");
  const machine =
    hours * nonNegative(input.machineHour, "Custo da máquina por hora");
  const labor =
    (nonNegative(input.laborMinutes, "Minutos de trabalho") / 60) *
    nonNegative(input.laborHour, "Mão de obra");
  const overhead =
    ((materials + energy + machine + labor) *
      nonNegative(input.overhead, "Despesas indiretas")) /
    100;
  const failureRate = nonNegative(input.failure, "Reserva de falhas");
  if (failureRate > 100)
    throw new Error("A reserva de falhas deve ficar entre 0% e 100%.");
  const failures =
    ((materials + energy + machine + labor + overhead) * failureRate) / 100;
  const extras = input.extras.reduce(
    (total, e) =>
      total +
      nonNegative(e.cost, "Custo extra") * (e.basis === "unit" ? quantity : 1),
    0,
  );
  const lot =
    materials + energy + machine + labor + overhead + failures + extras;
  const unit = lot / quantity;
  const suggested =
    Math.ceil(
      (suggestedProductPrice(unit, nonNegative(input.margin, "Margem")) -
        1e-9) *
        100,
    ) / 100;
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
