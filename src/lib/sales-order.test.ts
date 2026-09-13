import { describe, expect, it } from "vitest";
import { escapePrintHtml, orderRequest, prepareOrder, printableImageUrl, salesOrderTransitions } from "./sales-order";

const line = { product_id: "product-1", description: "Suporte 3D", quantity: 3, unit_price: 19.9, notes: "PLA azul" };

describe("orçamentos consistentes", () => {
  it("persiste frete separado e arredonda total em centavos", () => {
    const order = prepareOrder([line], "12.5", "5");
    expect(order).toMatchObject({ shipping: 12.5, discount: 5, subtotal: 59.7, total: 67.2 });
    expect(order.items[0].total).toBe(59.7);
  });
  it("rejeita desconto maior que o subtotal mesmo se houver frete", () => expect(() => prepareOrder([line], 100, 60)).toThrow("subtotal"));
  it.each([-1, Infinity, "abc"])("rejeita frete inválido %s", freight => expect(() => prepareOrder([line], freight, 0)).toThrow("Frete"));
  it("quantidade fracionária não cria ordens extras de produção", () => expect(() => prepareOrder([{ ...line, quantity: 1.5 }], 0, 0)).toThrow("inteiro"));
  it("não descarta silenciosamente item preenchido sem descrição", () => expect(() => prepareOrder([{ ...line, description: " " }], 0, 0)).toThrow("descrição"));
  it("ignora somente a linha realmente vazia", () => expect(prepareOrder([line, { ...line, product_id: "", description: "", unit_price: 0 }], 0, 0).items).toHaveLength(1));
  it("retry após timeout mantém o identificador de operação", () => {
    const initial = orderRequest(null, "same-payload", () => "id-1");
    expect(orderRequest(initial, "same-payload", () => "id-2").id).toBe("id-1");
    expect(orderRequest(initial, "edited-payload", () => "id-2").id).toBe("id-2");
  });
  it("pedido entregue/cancelado não pode voltar ao rascunho", () => {
    expect(salesOrderTransitions.delivered).toEqual([]);
    expect(salesOrderTransitions.cancelled).toEqual([]);
    expect(salesOrderTransitions.approved).not.toContain("draft");
  });
});

describe("documento imprimível", () => {
  it("nome e observações não viram HTML executável", () => expect(escapePrintHtml('<img src=x onerror="alert(1)"> & O\'Brien')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; O&#39;Brien"));
  it("rejeita URLs de script e SVG data", () => {
    expect(printableImageUrl("javascript:alert(1)")).toBe("");
    expect(printableImageUrl("data:image/svg+xml,<svg onload=alert(1)/>")).toBe("");
  });
  it("permite imagens HTTPS escapadas e PNG base64", () => {
    expect(printableImageUrl("https://example.com/item.png?a=1&b=2")).toContain("&amp;");
    expect(printableImageUrl("data:image/png;base64,aGVsbG8=")).toBe("data:image/png;base64,aGVsbG8=");
  });
});
