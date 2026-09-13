import { describe, expect, it } from "vitest";
import { prepareQuote, quoteCostSummary, quoteSnapshotTimeIssues, type QuoteDraftLine, type QuoteItem } from "./sales-quote";
import { quoteSnapshotMaterials } from "@/components/comercial/QuoteSnapshotSummary";
const line: QuoteDraftLine = { key: "a", product_id: "p1", description: "Base", quantity: "2", unit_price: "10", notes: "" };
const item = (cost: number | null, complete = true): QuoteItem => ({ id: "i1", tenant_id: "t1", quote_id: "q1", line_index: 1, product_id: "p1", description: "Base", quantity: 2, unit_price: 10, total: 20, notes: null, estimated_unit_cost: cost, estimated_total_cost: cost == null ? null : cost * 2, product_snapshot: { complete } });
describe("sales quotations", () => {
  it("requires time recursively without conflating it with the material cost", () => {
    expect(quoteSnapshotTimeIssues({ product: { name: "Base", est_time_minutes: 10 } })).toEqual([]);
    expect(quoteSnapshotTimeIssues({ product: { name: "Base", est_time_minutes: 0 } })).toEqual(["Informe o tempo por impressão de Base."]);
    expect(quoteSnapshotTimeIssues({ components: [{ snapshot: { plates: [{ label: "Tampa", est_time_seconds: null }] } }] })).toEqual(["Informe o tempo por impressão da placa Tampa."]);
    expect(quoteSnapshotTimeIssues({ plates: [{ label: "Tampa", est_time_seconds: 0.5 }] })).toEqual([]);
  });
  it("keeps an absent price pending instead of treating it as a gift", () => {
    const quote = prepareQuote([{ ...line, unit_price: "" }], "3", "1");
    expect(quote.items[0].unit_price).toBeNull(); expect(quote.subtotal).toBeNull(); expect(quote.total).toBeNull();
    expect(prepareQuote([{ ...line, unit_price: "0" }], "0", "0").total).toBe(0);
  });
  it("preserves monetary totals and caps quantity at the order contract", () => {
    expect(prepareQuote([line], "3", "1").total).toBe(22);
    expect(() => prepareQuote([{ ...line, quantity: "501" }], "", "")).toThrow();
    expect(() => prepareQuote([{ ...line, quantity: "1.5" }], "", "")).toThrow();
    expect(() => prepareQuote([{ ...line, product_id: "" }], "", "")).toThrow(/produto/);
    expect(() => prepareQuote([line], "", "21")).toThrow(/desconto/);
  });
  it("withholds margins when any recipe or cost is incomplete", () => {
    expect(quoteCostSummary([item(null)], { subtotal: 20, discount: 1 })).toMatchObject({ incomplete: true, cost: null, result: null, margin: null });
    expect(quoteCostSummary([item(0, false)], { subtotal: 20, discount: 1 }).margin).toBeNull();
    expect(quoteCostSummary([item(0)], { subtotal: 20, discount: 1 }).cost).toBe(0);
    expect(quoteCostSummary([], { subtotal: 20, discount: 1 }).margin).toBeNull();
  });
  it("calculates projected contribution from product revenue after discount", () => {
    const totals = quoteCostSummary([item(3)], { subtotal: 20, discount: 1 });
    expect(totals.cost).toBe(6); expect(totals.result).toBe(13); expect(totals.margin).toBeCloseTo(13 / 19 * 100);
    expect(quoteCostSummary([item(3)], { subtotal: null, discount: 0 }).margin).toBeNull();
  });
  it("shows frozen material identity and scales grams exactly once by sale quantity", () => {
    const snapshot = { requirements: [{ item_id: "red", name: "PLA vermelho", material_code: "PLA", color: "Vermelho", color_code: "RED-123", color_hex: "#ff0000", grams_per_unit: 25 }, { item_id: "black", name: "PLA preto", color: "Preto", color_code: "BLACK", grams_per_unit: null }] };
    expect(quoteSnapshotMaterials(snapshot, 4)).toEqual([
      { itemId: "red", name: "PLA vermelho", material: "PLA", color: "Vermelho", code: "RED-123", hex: "#ff0000", grams: 100, fullBatches: false },
      { itemId: "black", name: "PLA preto", material: "Material pendente", color: "Preto", code: "BLACK", hex: null, grams: null, fullBatches: false },
    ]);
    expect(quoteSnapshotMaterials(null)).toEqual([]);
    const recipe = { units_per_print: 2, lines: [{ item_id: "red", grams_per_print: 100 }] };
    expect(quoteSnapshotMaterials({ recipe }, 3)[0]).toMatchObject({ grams: 200, fullBatches: true });
    expect(quoteSnapshotMaterials({ components: [{ quantity: 2, snapshot: { recipe } }] }, 3)[0]).toMatchObject({ grams: 300, fullBatches: true });
  });
});
