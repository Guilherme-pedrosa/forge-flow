import { describe, expect, it } from "vitest";
import { priceChannel, type ChannelPricingInput } from "./channel-pricing";

const input: ChannelPricingInput = {
  unitCost: 100, variableUnitCost: "", orderQuantity: 1,
  commissionPercent: 0, taxPercent: 0, fixedFeePerOrder: 0,
  sellerShippingPerOrder: 0, advertisingPerOrder: 0, otherCostPerOrder: 0,
  marginPercent: 0, targetUnitPrice: "",
};

describe("commercial channel pricing", () => {
  it("does not invent channel fees and distinguishes margin from markup", () => {
    const result = priceChannel({ ...input, targetUnitPrice: 150 });
    expect(result.sellingExpenses).toBe(0);
    expect(result.includedResult).toBe(50);
    expect(result.contribution).toBe(50);
    expect(result.includedMargin).toBeCloseTo(33.333333);
    expect(result.markup).toBe(50);
  });

  it("calculates the documented multi-plate example with explicit hypothetical channel inputs", () => {
    const result = priceChannel({ ...input, unitCost: 24.74421052631579,
      commissionPercent: 16, taxPercent: 6, fixedFeePerOrder: 4,
      sellerShippingPerOrder: 5, advertisingPerOrder: 2, otherCostPerOrder: .6,
      marginPercent: 20 });
    expect(result.suggested).toBe(62.67);
    expect(result.breakEven).toBe(46.60);
    expect(result.includedResult).toBeCloseTo(12.53838947);
    expect(result.includedMargin).toBeGreaterThanOrEqual(20);
    expect(result.revenue).toBe(62.67);
  });

  it("charges shipping, fixed fee and advertising once per package while percentages use product revenue", () => {
    const result = priceChannel({ ...input, unitCost: 10, orderQuantity: 3,
      commissionPercent: 10, taxPercent: 5, fixedFeePerOrder: 4,
      sellerShippingPerOrder: 12, advertisingPerOrder: 2, targetUnitPrice: 30 });
    expect(result.revenue).toBe(90);
    expect(result.commission).toBe(9);
    expect(result.tax).toBe(4.5);
    expect(result.sellingExpenses).toBe(31.5);
    expect(result.manufacturingCost).toBe(30);
    expect(result.includedResult).toBe(28.5);
    expect(result.breakEven).toBe(18.83);
  });

  it("shows contribution separately from result after the complete informed manufacturing cost", () => {
    const result = priceChannel({ ...input, unitCost: 30, variableUnitCost: 20,
      orderQuantity: 2, targetUnitPrice: 50, fixedFeePerOrder: 10 });
    expect(result.contribution).toBe(50);
    expect(result.includedResult).toBe(30);
    expect(result.contributionMargin).toBe(50);
    expect(result.includedMargin).toBe(30);
    expect(() => priceChannel({ ...input, variableUnitCost: 101 })).toThrow(/variável/);
  });

  it("retains a target below costs without disguising the loss", () => {
    const result = priceChannel({ ...input, targetUnitPrice: 50, commissionPercent: 10 });
    expect(result.includedResult).toBe(-55);
    expect(result.includedMargin).toBeCloseTo(-110);
    expect(result.target).toBe(50);
    expect(result.suggested).toBe(111.12);
  });

  it("requires commission plus tax plus desired margin below 100 even for a manual target", () => {
    for (const percentages of [
      { commissionPercent: 100 }, { taxPercent: 100 }, { marginPercent: 100 },
      { commissionPercent: 16, taxPercent: 6, marginPercent: 78 },
      { commissionPercent: 60, taxPercent: 50 },
    ]) {
      expect(() => priceChannel({ ...input, ...percentages, targetUnitPrice: 200 })).toThrow(/menos de 100/);
    }
  });

  it("rejects invalid quantities, negative inputs, non-finite values and excessive totals", () => {
    for (const value of [0, 1.5, 10001, Infinity]) {
      expect(() => priceChannel({ ...input, orderQuantity: value })).toThrow();
    }
    expect(() => priceChannel({ ...input, sellerShippingPerOrder: -1 })).toThrow();
    expect(() => priceChannel({ ...input, taxPercent: "abc" })).toThrow();
    expect(() => priceChannel({ ...input, targetUnitPrice: Infinity })).toThrow();
    expect(() => priceChannel({ ...input, unitCost: 1e9, orderQuantity: 2 })).toThrow(/muito altos/);
    expect(() => priceChannel({ ...input, unitCost: 1e-320, targetUnitPrice: 1e9 })).toThrow(/muito altos/);
  });

  it("rounds suggested prices up, handles decimal commas and zero costs without negative zero", () => {
    expect(priceChannel({ ...input, unitCost: "10,01", marginPercent: 30 }).suggested).toBe(14.30);
    expect(priceChannel({ ...input, unitCost: 1e-12 }).suggested).toBe(.01);
    const result = priceChannel({ ...input, unitCost: 0 });
    expect(result.target).toBe(0);
    expect(Object.is(result.target, -0)).toBe(false);
    expect(result.includedMargin).toBeNull();
    expect(result.markup).toBeNull();
  });
});
