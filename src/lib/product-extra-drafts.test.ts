import { describe, expect, it, vi } from "vitest";
import { normalizeProductExtraCost, productExtraCostInput, readProductExtraDrafts, serializeProductExtraDrafts } from "./product-extra-drafts";

const originals = () => [
  { name: "Laço", cost: 0.1234567, material_ref: "stock-ribbon", metadata: { source: "old-order", batches: [1, 2] } },
  { name: "🧩 Base histórica ×2", cost: 3.456789, _kit_product_id: "base", _kit_qty: 2, _source_recipe: { revision: 9 } },
  { name: "Adesivo", cost: "0.0049500", code: "original-sticker" },
  { name: "🧩 Tampa histórica", cost: 0.9999999, _kit_product_id: "lid", custom: ["keep", { precision: true }] },
];
const current = vi.fn((id: string) => ({ name: id === "base" ? "Base atual" : "Tampa atual", unitCost: id === "base" ? 9.87654 : 5.4321 }));

describe("product extra drafts preserve untouched source data", () => {
  it("retains full numeric/string precision, original order and unknown metadata without repricing kit entries", () => {
    current.mockClear();
    const raw = originals(), { regular, kits } = readProductExtraDrafts(raw);
    expect(regular[0].costInput).toBe("0,1234567");
    expect(regular[1].costInput).toBe("0,0049500");
    const result = serializeProductExtraDrafts(regular, kits, current);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw); expect(result[0]).not.toBe(raw[0]);
    expect(current).not.toHaveBeenCalled();
    expect(raw).toEqual(originals());
  });
  it("keeps each row's source metadata after regular and kit drafts are reordered independently", () => {
    const { regular, kits } = readProductExtraDrafts(originals());
    expect(serializeProductExtraDrafts(regular.reverse(), kits.reverse(), current)).toEqual(originals());
  });
  it("changes only the name when renamed, retaining the original cost and custom metadata", () => {
    const { regular, kits } = readProductExtraDrafts(originals());
    regular[1] = { ...regular[1], name: "  Adesivo novo  " };
    const result = serializeProductExtraDrafts(regular, kits, current);
    expect(result[2]).toEqual({ ...originals()[2], name: "Adesivo novo" });
    expect(result[0]).toEqual(originals()[0]); expect(result[1]).toEqual(originals()[1]);
  });
  it("does not round untouched values when focused/blurred and rounds edited decimal costs once", () => {
    const { regular } = readProductExtraDrafts(originals());
    expect(normalizeProductExtraCost(regular[0])).toBe(regular[0]);
    const changed = { ...regular[0], cost: 1.005, costInput: "1,005" };
    const normalized = normalizeProductExtraCost(changed);
    expect(normalized.cost).toBe(1.01); expect(normalized.costInput).toBe("1,01");
    expect(serializeProductExtraDrafts([changed], [], current)[0]).toEqual({ ...originals()[0], cost: 1.01 });
    expect(serializeProductExtraDrafts([normalized], [], current)[0]).toEqual({ ...originals()[0], cost: 1.01 });
  });
  it("supports numeric-only cost edits, new comma values and explicit free extras", () => {
    const { regular } = readProductExtraDrafts(originals());
    const result = serializeProductExtraDrafts([{ ...regular[0], cost: 2.345 },
      { name: "Caixa", cost: 1.2345, costInput: "1,2345" }, { name: "Brinde", cost: 0 }, { name: "", cost: 0 }], [], current);
    expect(result).toEqual([{ ...originals()[0], cost: 2.35 }, { name: "Caixa", cost: 1.23 }, { name: "Brinde", cost: 0 }]);
    expect(result.every(row => !("original" in row))).toBe(true);
  });
  it("recalculates only a changed kit quantity using decimal multiplication before rounding", () => {
    const { regular, kits } = readProductExtraDrafts(originals());
    kits[0] = { ...kits[0], qty: 3 };
    const resolve = vi.fn(() => ({ name: "Base escolhida", unitCost: 0.335 }));
    const result = serializeProductExtraDrafts(regular, kits, resolve);
    expect(resolve).toHaveBeenCalledTimes(1); expect(resolve).toHaveBeenCalledWith("base");
    expect(result[1]).toEqual({ ...originals()[1], name: "🧩 Base escolhida ×3", _kit_qty: 3, cost: 1.01 });
    expect(result[3]).toEqual(originals()[3]);
  });
  it("updates a changed component identity and leaves other lines intact", () => {
    const { regular, kits } = readProductExtraDrafts(originals());
    kits[1] = { ...kits[1], productId: "new-lid", qty: 1 };
    const result = serializeProductExtraDrafts(regular, kits, () => ({ name: "Tampa nova", unitCost: 2.1234 }));
    expect(result[3]).toEqual({ ...originals()[3], name: "🧩 Tampa nova", cost: 2.12, _kit_product_id: "new-lid", _kit_qty: 1 });
    expect(result.slice(0, 3)).toEqual(originals().slice(0, 3));
  });
  it("removes only deleted entries and appends new entries without borrowing another row's metadata", () => {
    const { regular, kits } = readProductExtraDrafts(originals());
    regular.shift(); regular.push({ name: "Caixa nova", cost: 2 });
    const result = serializeProductExtraDrafts(regular, kits, current);
    expect(result).toEqual([...originals().slice(1), { name: "Caixa nova", cost: 2 }]);
  });
  it("refuses edited costs, missing component costs and duplicated original-row identities instead of inventing zero", () => {
    for (const value of ["-1", "NaN", "Infinity", "1e100", "1.2.3"]) {
      expect(() => serializeProductExtraDrafts([{ name: "Caixa", cost: 0, costInput: value }], [], current)).toThrow(/custo válido/);
    }
    expect(() => serializeProductExtraDrafts([], [{ productId: "unknown", qty: 1 }], () => undefined)).toThrow(/Confira o custo/);
    expect(() => serializeProductExtraDrafts([], [{ productId: "unknown", qty: 1 }], () => ({ name: "Peça", unitCost: null }))).toThrow(/Confira o custo/);
    expect(() => serializeProductExtraDrafts([], [{ productId: "base", qty: 0 }], current)).toThrow(/quantidade/);
    const { regular } = readProductExtraDrafts(originals());
    expect(() => serializeProductExtraDrafts([regular[0], regular[0]], [], current)).toThrow(/mais de uma linha/);
  });
  it("preserves tiny costs in the display and rejects malformed persisted rows without silently dropping them", () => {
    expect(productExtraCostInput(1.234e-7)).toBe("0,0000001234");
    expect(productExtraCostInput(1e-25)).toBe("0," + "0".repeat(24) + "1");
    expect(readProductExtraDrafts(null)).toEqual({ regular: [], kits: [] });
    expect(() => readProductExtraDrafts({ name: "wrong container" })).toThrow(/lista/);
    expect(() => readProductExtraDrafts([null])).toThrow(/formato inválido/);
  });
});
