import { nonNegative, positiveInteger } from "./production";
import { roundMoney } from "./sales-order";

export function commissionPercent(value: string | number | null | undefined) {
  const percent = nonNegative(value, "Comissão", 20);
  if (percent > 100) throw new Error("A comissão deve ficar entre 0% e 100%.");
  return percent;
}

export const unitCommission = (price: number, percent: number) => roundMoney(nonNegative(price, "Preço") * commissionPercent(percent) / 100);

export function prepareConsignmentItems(items: { product_id: string; quantity: string | number; unit_price: string | number }[], type: string, stock: { product_id: string; current_qty: number }[]) {
  if (!items.length) throw new Error("Adicione pelo menos um produto.");
  if (!["placement", "replenishment", "return", "sale"].includes(type)) throw new Error("Tipo de movimentação inválido.");
  const seen = new Set<string>();
  return items.map(item => {
    if (!item.product_id || seen.has(item.product_id)) throw new Error("Selecione produtos distintos para cada linha.");
    seen.add(item.product_id);
    const quantity = positiveInteger(item.quantity, "Quantidade", 10000);
    const unit_price = roundMoney(nonNegative(item.unit_price, "Preço"));
    if (type === "sale" && unit_price <= 0) throw new Error("Informe um preço de venda maior que zero.");
    if (["return", "sale"].includes(type) && quantity > (stock.find(value => value.product_id === item.product_id)?.current_qty ?? 0)) throw new Error("Quantidade maior que o saldo do ponto. Atualize o estoque antes de registrar.");
    return { product_id: item.product_id, quantity, unit_price };
  });
}
