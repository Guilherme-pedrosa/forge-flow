import { describe, expect, it } from "vitest";
import { documentAddress, documentDate, documentFilename, documentMoney, orderDocument } from "@/lib/commercial-document";
import { createCommercialPdf } from "@/lib/commercial-pdf";

const order = { code: "ORC-20260420-003", status: "draft", created_at: "2026-04-20T01:00:00Z", due_date: "2026-05-07", customers: { name: "Cliente José" }, discount: 5, shipping: 10, total: 104.9, notes: "📍 Entrega: Rua São João, 5\nPersonalização: nome em dourado." };
const items = [{ description: "Kit Nossa Senhora Aparecida", quantity: 1, unit_price: 99.9, total: 99.9, notes: "Acabamento fosco" }];
describe("documentos comerciais para clientes", () => {
  it("preserves the saved amounts, delivery, and customer customization", () => {
    const document = orderDocument(order, items);
    expect(document).toMatchObject({ kind: "quote", subtotal: 99.9, shipping: 10, discount: 5, total: 104.9, deliveryAddress: "Rua São João, 5", notes: "Personalização: nome em dourado." });
    expect(document.items[0].details).toBe("Acabamento fosco");
    expect(orderDocument({ ...order, status: "approved" }, items).kind).toBe("order");
  });
  it("does not turn pending prices or dates into zero or yesterday", () => {
    expect(orderDocument(order, [{ ...items[0], total: null }]).subtotal).toBeNull();
    expect(documentMoney(null)).toBe("A definir"); expect(documentMoney(0)).toBe("R$ 0,00");
    expect(documentDate("2026-05-07")).toBe("07/05/2026");
    expect(documentDate("2026-04-20T01:00:00Z")).toBe("19/04/2026");
    expect(documentDate(null)).toBe("A combinar");
  });
  it("handles both legacy addresses and structured addresses", () => {
    expect(documentAddress("Rua da Empresa, 4")).toBe("Rua da Empresa, 4");
    expect(documentAddress({ cep: "75093-630" })).toBe("CEP 75093-630");
    expect(documentAddress({ street: "Rua São João", number: "5", city: "Anápolis", state: "GO", zip: "75093630" })).toBe("Rua São João, 5, Anápolis / GO, CEP 75093-630");
    expect(documentFilename({ kind: "quote", code: "../../ORC<001>" })).not.toContain("/");
  });
  it("generates an actual A4 PDF and paginates long tables and observations", () => {
    const document = orderDocument(order, items);
    const short = createCommercialPdf(document, { name: "Elevare 3D" });
    expect(short.output().slice(0, 8)).toBe("%PDF-1.3"); expect(short.getNumberOfPages()).toBe(1);
    expect(short.internal.pageSize.getWidth()).toBeCloseTo(210, 1);
    const long = createCommercialPdf({ ...document, items: Array.from({ length: 75 }, (_, i) => ({ ...document.items[0], description: `Peça ${i + 1} - Maçã com caule e folha`, details: "PLA · Vermelho\nPersonalização para presente" })), notes: "Observação extensa para o cliente. ".repeat(300) }, { name: "Elevare 3D" });
    expect(long.getNumberOfPages()).toBeGreaterThan(4);
  });
});
