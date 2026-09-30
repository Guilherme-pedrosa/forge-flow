import { describe, expect, it } from "vitest";
import {
  pricePrint,
  readPricingTransfer,
  type PricingInput,
} from "@/lib/print-pricing";
import {
  crc16,
  staticPix,
  labelQr,
  validateLabels,
  type LabelOptions,
} from "@/lib/product-labels";
const input: PricingInput = {
  quantity: 10,
  hours: 2,
  watts: 100,
  kwh: 1,
  machineHour: 2,
  laborMinutes: 30,
  laborHour: 20,
  overhead: 10,
  failure: 5,
  margin: 50,
  target: "",
  materials: [
    { name: "PLA", grams: 100, kgPrice: 100 },
    { name: "PETG", grams: 50, kgPrice: 120 },
  ],
  extras: [
    { name: "Caixa", cost: 1, basis: "unit" },
    { name: "Envio", cost: 5, basis: "lot" },
  ],
};
describe("precificação reutilizável", () => {
  it("keeps a zero simulation free of negative-zero prices", () => {
    const value = pricePrint({ ...input, hours: 0, laborMinutes: 0, materials: [], extras: [] });
    expect(Object.is(value.suggested, -0)).toBe(false);
    expect(value.suggested).toBe(0);
  });
  it("calculates multiple materials, costs and lot/unit extras without confusing margin with markup", () => {
    const p = pricePrint(input);
    expect(p.materials).toBe(16);
    expect(p.energy).toBeCloseTo(0.2);
    expect(p.machine).toBe(4);
    expect(p.labor).toBe(10);
    expect(p.overhead).toBeCloseTo(3.02);
    expect(p.failures).toBeCloseTo(1.661);
    expect(p.extras).toBe(15);
    expect(p.lot).toBeCloseTo(49.881);
    expect(p.unit).toBeCloseTo(4.9881);
    expect(p.suggested).toBe(9.98);
    expect(p.margin).toBeGreaterThanOrEqual(50);
  });
  it("compares target price including losses and rejects invalid margin and quantity", () => {
    const p = pricePrint({ ...input, target: 4 });
    expect(p.profit).toBeLessThan(0);
    expect(() => pricePrint({ ...input, margin: 100 })).toThrow();
    expect(() => pricePrint({ ...input, quantity: 1.5 })).toThrow();
    expect(() => pricePrint({ ...input, hours: "abc" })).toThrow();
    expect(() =>
      pricePrint({
        ...input,
        materials: [{ name: "a", grams: -1, kgPrice: 20 }],
      }),
    ).toThrow();
  });
  it("validates transfers before filling a new product", () => {
    expect(
      readPricingTransfer({
        name: "Maçã",
        quantity: 10,
        cost: 4.98,
        price: 9.98,
        quote: true,
      }),
    ).not.toBeNull();
    expect(
      readPricingTransfer({
        name: "Maçã",
        quantity: 0,
        cost: 4,
        price: 10,
        quote: true,
      }),
    ).toBeNull();
  });
});
const options: LabelOptions = {
  mode: "none",
  url: "",
  pixKey: "",
  receiver: "",
  city: "",
  pixAmount: false,
  showPrice: true,
};
describe("etiquetas e Pix", () => {
  it("matches the complete CRC of the official BCB static QR example", () => {
    const payload = staticPix(
      "123e4567-e12b-12d1-a456-426655440000",
      "Fulano de Tal",
      "BRASILIA",
    );
    expect(payload).toBe(
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D",
    );
    expect(crc16(payload.slice(0, -4))).toBe("1D3D");
  });
  it("adds an optional fixed unit amount and normalizes accents", () => {
    const p = staticPix("contato@example.com", "José Silva", "Anápolis", 99.9);
    expect(p).toContain("540599.90");
    expect(p).toContain("Jose Silva");
    expect(() => staticPix("bad", "Nome", "Cidade")).toThrow();
    expect(() =>
      staticPix("contato@example.com", "Nome", "Cidade", 0),
    ).toThrow();
  });
  it("rejects dangerous links and oversized print batches", () => {
    const l = { name: "Maçã", sku: "APPLE", price: 20, quantity: 1 };
    expect(() =>
      labelQr(l, { ...options, mode: "url", url: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      labelQr(l, {
        ...options,
        mode: "url",
        url: "https://user:secret@example.com",
      }),
    ).toThrow();
    expect(() => validateLabels([{ ...l, quantity: 501 }], options)).toThrow();
    expect(() => validateLabels([{ ...l, price: NaN }], options)).toThrow();
    expect(validateLabels([l], options)).toBe(1);
  });
});
