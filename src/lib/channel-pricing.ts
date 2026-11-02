import { nonNegative, positiveInteger } from "./production";

type NumericInput = string | number;

export type ChannelPricingInput = {
  unitCost: NumericInput;
  /** Empty means all informed manufacturing costs are treated as variable. */
  variableUnitCost?: NumericInput;
  orderQuantity: NumericInput;
  commissionPercent: NumericInput;
  taxPercent: NumericInput;
  fixedFeePerOrder: NumericInput;
  fixedFeePerItem?: NumericInput;
  sellerShippingPerOrder: NumericInput;
  advertisingPerOrder: NumericInput;
  otherCostPerOrder: NumericInput;
  marginPercent: NumericInput;
  targetUnitPrice: NumericInput;
};

const ceilMoney = (value: number) => value === 0 ? 0 : Math.max(.01, Math.ceil(value * 100 - 1e-9) / 100);
const confirmed = (value: NumericInput, label: string) => {
  if (value == null || typeof value === "string" && !value.trim()) throw new Error(`Confirme ${label.toLocaleLowerCase("pt-BR")}, inclusive zero quando não se aplicar.`);
  return nonNegative(value, label);
};

/**
 * A simulation for one order/package. Percentages use only product revenue;
 * seller shipping and other order expenses are charged once for the package.
 * These inputs are assumptions, not marketplace tariffs or expected payouts.
 */
export function priceChannel(input: ChannelPricingInput) {
  const unitCost = confirmed(input.unitCost, "Custo completo por unidade");
  const variableUnitCost = input.variableUnitCost === "" || input.variableUnitCost == null
    ? unitCost
    : nonNegative(input.variableUnitCost, "Custo variável por unidade");
  if (variableUnitCost > unitCost) {
    throw new Error("O custo variável não pode superar o custo completo por unidade.");
  }
  const quantity = positiveInteger(input.orderQuantity, "Unidades por pedido", 10000);
  const commissionPercent = confirmed(input.commissionPercent, "Comissão do canal");
  const taxPercent = confirmed(input.taxPercent, "Tributo sobre venda");
  const marginPercent = confirmed(input.marginPercent, "Margem desejada");
  if (commissionPercent + taxPercent + marginPercent >= 100) {
    throw new Error("Comissão + tributo + margem desejada devem somar menos de 100%.");
  }
  const fixedFee = confirmed(input.fixedFeePerOrder, "Tarifa fixa do pedido");
  const fixedFeePerItem = input.fixedFeePerItem == null || input.fixedFeePerItem === "" ? 0 : nonNegative(input.fixedFeePerItem, "Tarifa fixa por item");
  const itemFees = fixedFeePerItem * quantity;
  const sellerShipping = confirmed(input.sellerShippingPerOrder, "Frete pago pelo vendedor");
  const advertising = confirmed(input.advertisingPerOrder, "Anúncios do pedido");
  const otherCost = confirmed(input.otherCostPerOrder, "Outros gastos do pedido");
  const orderExpenses = fixedFee + itemFees + sellerShipping + advertising + otherCost;
  const rate = (commissionPercent + taxPercent) / 100;
  const costBasisPerUnit = unitCost + orderExpenses / quantity;
  const suggested = ceilMoney(costBasisPerUnit / (1 - rate - marginPercent / 100));
  const breakEven = ceilMoney(costBasisPerUnit / (1 - rate));
  const target = input.targetUnitPrice === ""
    ? suggested
    : nonNegative(input.targetUnitPrice, "Preço alvo por unidade");
  const revenue = target * quantity;
  const commission = revenue * commissionPercent / 100;
  const tax = revenue * taxPercent / 100;
  const sellingExpenses = commission + tax + orderExpenses;
  const manufacturingCost = unitCost * quantity;
  const variableManufacturingCost = variableUnitCost * quantity;
  const totalCost = manufacturingCost + sellingExpenses;
  const includedResult = revenue - totalCost;
  const contribution = revenue - variableManufacturingCost - sellingExpenses;
  const afterSellingExpenses = revenue - sellingExpenses;
  const includedMargin = revenue > 0 ? includedResult / revenue * 100 : null;
  const contributionMargin = revenue > 0 ? contribution / revenue * 100 : null;
  const markup = totalCost > 0 ? includedResult / totalCost * 100 : null;
  if (![unitCost, variableUnitCost, orderExpenses, suggested, breakEven, target,
    revenue, totalCost, sellingExpenses, manufacturingCost, variableManufacturingCost,
    includedResult, contribution, afterSellingExpenses].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) {
    throw new Error("Os valores da simulação comercial são muito altos.");
  }
  if ([includedMargin, contributionMargin, markup].some(value => value != null && !Number.isFinite(value))) {
    throw new Error("Os valores da simulação comercial são muito altos.");
  }
  return {
    quantity, unitCost, variableUnitCost, suggested, breakEven, target, revenue,
    commission, tax, fixedFee, fixedFeePerItem, itemFees, orderExpenses, sellerShipping, advertising, otherCost,
    sellingExpenses, manufacturingCost, variableManufacturingCost, totalCost,
    afterSellingExpenses, includedResult, contribution,
    includedMargin, contributionMargin, markup,
  };
}
