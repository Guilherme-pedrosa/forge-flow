import { describe, expect, it } from "vitest";
import xml from "@/test/fixtures/nfe-purchase-review.xml?raw";
import { parseNfePurchaseXml } from "./nfe-purchase";
import { buildNfePurchasePayload, nfeStockLinks, type NfeFinancialDraft } from "./nfe-purchase-draft";
import type { PurchaseMaterial } from "./purchase-catalog";

const material: PurchaseMaterial = { id: "pla-white", name: "PLA Branco Elevare", sku: null, category: "filament", unit: "g", material_code: "PLA", color: "Branco", color_code: "WHITE", avg_cost: .05, current_stock: 1000 };
function draft() {
  const invoice = parseNfePurchaseXml(xml), links = nfeStockLinks(invoice);
  links[0] = { ...links[0], itemId: material.id, name: "Nome interno editado", stockQuantity: "1500" };
  links[1].skipStock = true;
  const financial: NfeFinancialDraft = { paymentMethodId: "boleto", accountId: "material-account", costCenterId: "production", createPayables: true,
    parts: invoice.billing.duplicates.map(part => ({ due_date: part.dueDate, amount: part.amountExact })) };
  return { invoice, links, financial };
}
describe("confirmed NF-e purchase payload", () => {
  it("preserves fiscal descriptions/decimal strings, exact real dues and one atomic receipt intent", () => {
    const { invoice, links, financial } = draft(), before = structuredClone({ invoice, links, financial });
    const payload = buildNfePurchasePayload(invoice, xml, links, [material], "vendor", financial, true);
    expect(payload.p_order).toMatchObject({ vendor_id: "vendor", subtotal: "109.80", discount: "2.30", shipping: "4.50", additional_costs: "1.10", total: "113.10", nfe_xml: xml, receive_now: true });
    expect(payload.p_receive).toBe(true);
    expect(payload.p_items[0]).toMatchObject({ description: invoice.items[0].fiscalDescription, quantity: "2.0000", unit_price: "49.9000000000", total: "99.80", inventory_item_id: material.id, stock_quantity: 1500 });
    expect(payload.p_items[0].description).not.toBe(links[0].name);
    expect(payload.p_items[1]).toMatchObject({ description: invoice.items[1].fiscalDescription, inventory_item_id: null, stock_quantity: null });
    expect(payload.p_items[1].notes).toContain("sem estoque");
    expect(payload.p_installments).toEqual([
      expect.objectContaining({ amount: 40.1, due_date: "2026-11-20", payment_method_id: "boleto", account_id: "material-account", cost_center_id: "production", installment_number: 1, installment_total: 2 }),
      expect.objectContaining({ amount: 73, due_date: "2027-01-07", payment_method_id: "boleto", account_id: "material-account", cost_center_id: "production", installment_number: 2, installment_total: 2 }),
    ]);
    expect(payload.p_installments.every(part => !("amount_paid" in part) && !("paid_at" in part))).toBe(true);
    expect({ invoice, links, financial }).toEqual(before);
  });
  it("requires an explicit stock mapping or skip for every row and never infers grams from UN or a product name", () => {
    const { invoice, financial } = draft(), links = nfeStockLinks(invoice);
    expect(links.every(link => !link.itemId && !link.stockQuantity && !link.skipStock)).toBe(true);
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", financial, false)).toThrow(/Vincule o item 1/);
    links[0].itemId = material.id; links[1].skipStock = true;
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", financial, true)).toThrow(/quantidade de entrada/);
    expect(buildNfePurchasePayload(invoice, xml, links, [material], "vendor", financial, false).p_items[0].stock_quantity).toBeNull();
    links[0].itemId = "product-owned-stock";
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", financial, false)).toThrow(/Vincule o item 1/);
  });
  it("requires confirmed method/account and balanced actual dues, with a separate explicit no-payables choice", () => {
    const { invoice, links, financial } = draft();
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { ...financial, paymentMethodId: "" }, true)).toThrow(/forma de pagamento/);
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { ...financial, accountId: "" }, true)).toThrow(/plano de contas/);
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { ...financial, parts: [{ amount: "113.09", due_date: "2026-11-20" }] }, true)).toThrow(/soma das parcelas/);
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { ...financial, parts: [{ amount: "113.10", due_date: "" }] }, true)).toThrow(/vencimentos/);
    const payload = buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { paymentMethodId: "", accountId: "", costCenterId: "", parts: [], createPayables: false }, false);
    expect(payload.p_installments).toEqual([]); expect(payload.p_order.notes).toContain("nenhum pagamento registrado");
    expect(payload.p_order).not.toHaveProperty("status"); expect(payload.p_order).not.toHaveProperty("paid_at");
  });
  it("uses each confirmed installment method or the purchase fallback while preserving actual dues and classification", () => {
    const { invoice, links, financial } = draft();
    const methods = { ...financial, partPaymentMethodIds: ["pix-confirmed", "card-confirmed"] };
    const payload = buildNfePurchasePayload(invoice, xml, links, [material], "vendor", methods, false);
    expect(payload.p_installments).toEqual([
      expect.objectContaining({ amount: 40.1, due_date: "2026-11-20", payment_method_id: "pix-confirmed", account_id: "material-account", cost_center_id: "production", installment_number: 1, installment_total: 2 }),
      expect.objectContaining({ amount: 73, due_date: "2027-01-07", payment_method_id: "card-confirmed", account_id: "material-account", cost_center_id: "production", installment_number: 2, installment_total: 2 }),
    ]);
    const fallback = buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { ...methods, partPaymentMethodIds: ["pix-confirmed", ""] }, false);
    expect(fallback.p_installments.map(part => part.payment_method_id)).toEqual(["pix-confirmed", "boleto"]);
    expect(buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { ...methods, paymentMethodId: "" }, false).p_installments).toEqual(payload.p_installments);
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", { ...methods, paymentMethodId: "", partPaymentMethodIds: ["pix-confirmed", ""] }, false)).toThrow(/forma de pagamento/);
    expect(payload.p_installments.every(part => !("amount_paid" in part) && !("paid_at" in part))).toBe(true);
  });
  it("blocks fiscal discrepancies or excluded-from-total lines without adjusting original values", () => {
    const { invoice, links, financial } = draft();
    invoice.review.itemTotalsMatch = false;
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", financial, true)).toThrow(/não altera quantidade/);
    invoice.review.itemTotalsMatch = true; invoice.items[1].includedInTotal = false;
    expect(() => buildNfePurchasePayload(invoice, xml, links, [material], "vendor", financial, true)).toThrow(/valores fiscais/);
    expect(invoice.items[0].exact.unitPrice).toBe("49.9000000000"); expect(invoice.exact.total).toBe("113.10");
  });
});
