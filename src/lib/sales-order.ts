import { nonNegative, positiveInteger } from "./production";
import { readMaterialOverrides, type MaterialOverride } from "./product-material-variant";

export const salesOrderTransitions: Record<string, string[]> = {
  draft: ["approved", "cancelled"], approved: ["in_production", "cancelled"],
  in_production: ["ready", "cancelled"], ready: ["shipped", "delivered", "cancelled"],
  shipped: ["delivered"], delivered: [], cancelled: [],
};

export function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function prepareOrder(lines: { product_id: string; description: string; quantity: number | string; unit_price: number | string; notes?: string; material_overrides?: MaterialOverride[] }[], freight: string | number, discount: string | number) {
  const populated = lines.filter(line => line.product_id || line.description.trim() || Number(line.unit_price) !== 0);
  if (!populated.length) throw new Error("Adicione pelo menos um item.");
  const items = populated.map((line, index) => {
    if (!line.description.trim()) throw new Error(`Informe a descrição do item ${index + 1}.`);
    const quantity = positiveInteger(line.quantity, `Quantidade do item ${index + 1}`, 10000);
    const unitPrice = roundMoney(nonNegative(line.unit_price, `Preço do item ${index + 1}`));
    const material_overrides = readMaterialOverrides(line.material_overrides);
    if (!line.product_id && material_overrides.length) throw new Error(`Selecione o produto antes das cores do item ${index + 1}.`);
    return { product_id: line.product_id || null, description: line.description.trim(), quantity, unit_price: unitPrice, total: roundMoney(quantity * unitPrice), notes: line.notes?.trim() || null, material_overrides };
  });
  const shipping = roundMoney(nonNegative(freight, "Frete"));
  const discountValue = roundMoney(nonNegative(discount, "Desconto"));
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
  if (discountValue > subtotal) throw new Error("O desconto não pode superar o subtotal dos itens.");
  return { items, shipping, discount: discountValue, subtotal, total: roundMoney(subtotal + shipping - discountValue) };
}

/** Escape all user-entered values before composing the printable document. */
export function escapePrintHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function printableImageUrl(value: string): string {
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  try { const url = new URL(value); return url.protocol === "https:" ? escapePrintHtml(url.href) : ""; } catch { return ""; }
}

/** Same payload gets the same key after a timeout; edited payload starts a new operation. */
export function orderRequest(previous: { signature: string; id: string } | null, signature: string, generate: () => string = () => crypto.randomUUID()) {
  return previous?.signature === signature ? previous : { signature, id: generate() };
}
