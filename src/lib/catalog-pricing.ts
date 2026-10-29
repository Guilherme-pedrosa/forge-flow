import { pricingNumber } from "@/lib/product-pricing";

export const catalogAmountInput = (value: number) => value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });

// Decimal arithmetic at the money boundary matches PostgreSQL numeric, including half cents.
function ratio(value: number): [bigint, bigint] {
  const [mantissa, exponent = "0"] = String(value).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const shift = Number(exponent) - fraction.length;
  const digits = BigInt(whole + fraction);
  return shift >= 0 ? [digits * 10n ** BigInt(shift), 1n] : [digits, 10n ** BigInt(-shift)];
}
function add([a, b]: [bigint, bigint], [c, d]: [bigint, bigint]): [bigint, bigint] {
  return [a * d + c * b, b * d];
}
function rounded(numerator: bigint, denominator: bigint, places: number) {
  return (numerator * 10n ** BigInt(places) * 2n + denominator) / (2n * denominator);
}

/** The cadastro uses a percentage ON COST. Do not silently replace it with a sales margin. */
export function catalogPriceDraft(base: string, accessory: string, other: string, markup: string) {
  try {
    const cost = pricingNumber(base, "Preço de custo", 1e9);
    const accessoryValue = pricingNumber(accessory, "Despesas acessórias", 1e9) ?? 0;
    const otherValue = pricingNumber(other, "Outras despesas", 1e9) ?? 0;
    const percent = pricingNumber(markup, "Lucro sobre o custo", 100000);
    const sum = cost == null ? null : add(add(ratio(cost), ratio(accessoryValue)), ratio(otherValue));
    const totalUnits = sum == null ? null : rounded(sum[0], sum[1], 4);
    const total = totalUnits == null ? null : Number(totalUnits) / 10000;
    const [percentValue, percentScale] = ratio(percent ?? 0);
    const price = totalUnits == null || percent == null ? null
      : Number(rounded(totalUnits * (100n * percentScale + percentValue), 10000n * 100n * percentScale, 2)) / 100;
    if (price != null && price > 1e9) throw new Error("Preço de venda acima do limite.");
    return { cost: total, price, markup: percent, error: "" };
  } catch (error) {
    return { cost: null, price: null, markup: null, error: (error as Error).message };
  }
}
