import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPricingFilaments } from "./pricing-filaments";

const mock = vi.hoisted(() => ({ from: vi.fn(), items: [] as Record<string, unknown>[], movements: [] as Record<string, unknown>[],
  reads: [] as { table: string; columns: string; filters: unknown[][]; from: number; to: number }[], movementError: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
const item = (id: string, cost: unknown) => ({ id, name: id, unit: "g", avg_cost: cost, material_code: "PLA", color_hex: "#FFFFFF", is_active: true, category: "filament" });
beforeEach(() => {
  mock.items = []; mock.movements = []; mock.reads = []; mock.movementError = false;
  mock.from.mockReset().mockImplementation((table: string) => {
    let columns = ""; const filters: unknown[][] = [];
    const query = { select: (value: string) => { columns = value; return query; },
      eq: (field: string, value: unknown) => { filters.push(["eq", field, value]); return query; },
      gt: (field: string, value: unknown) => { filters.push(["gt", field, value]); return query; },
      in: (field: string, value: unknown[]) => { filters.push(["in", field, value]); return query; }, order: () => query,
      range: async (from: number, to: number) => {
        mock.reads.push({ table, columns, filters, from, to });
        if (table === "inventory_movements" && mock.movementError) return { data: null, error: new Error("Receipt check unavailable") };
        const rows = (table === "inventory_items" ? mock.items : mock.movements).filter(row => filters.every(([kind, field, value]) => kind === "eq" ? row[String(field)] === value
          : kind === "gt" ? Number(row[String(field)]) > Number(value) : (value as unknown[]).includes(row[String(field)])));
        return { data: rows.slice(from, to + 1).map(row => Object.fromEntries(columns.split(",").map(field => [field, row[field]]))), error: null };
      } };
    return query;
  });
});

describe("confirmed filament acquisition rates", () => {
  it("accepts positive rates without reading the stock ledger or requesting private fields", async () => {
    mock.items = [item("red", .08), { ...item("blue", 80), unit: "kg" }];
    const result = await loadPricingFilaments();
    expect(result.map(value => [value.id, value.avg_cost, value.cost_confirmed])).toEqual([["red", .08, true], ["blue", 80, true]]);
    expect(mock.from).toHaveBeenCalledExactlyOnceWith("inventory_items");
    expect(mock.reads[0].columns).toBe("id,name,unit,current_stock,avg_cost,material_code,material_description,material_type,color,color_code,color_hex,brand,sku,diameter,notes");
  });

  it("keeps identity-only zero, missing and invalid rates unknown without creating artificial free acquisitions", async () => {
    mock.items = [item("zero", 0), item("missing", null), item("absent", undefined), item("invalid", Number.NaN), item("negative", -1)];
    const before = structuredClone(mock.movements);
    expect((await loadPricingFilaments()).map(value => value.cost_confirmed)).toEqual([false, false, false, false, false]);
    expect(mock.movements).toEqual(before);
    expect(mock.reads[1]).toMatchObject({ table: "inventory_movements", columns: "item_id", filters: [
      ["eq", "movement_type", "purchase_in"], ["eq", "unit_cost", 0], ["gt", "quantity", 0], ["in", "item_id", ["zero"]],
    ] });
  });

  it("allows a zero rate only after an explicit positive zero-cost acquisition for that item", async () => {
    mock.items = [item("free", 0), item("identity-only", 0), item("return-only", 0), item("empty-receipt", 0)];
    mock.movements = [
      { item_id: "free", movement_type: "purchase_in", unit_cost: 0, quantity: 1000 },
      { item_id: "identity-only", movement_type: "purchase_in", unit_cost: .1, quantity: 1000 },
      { item_id: "return-only", movement_type: "return", unit_cost: 0, quantity: 1000 },
      { item_id: "empty-receipt", movement_type: "purchase_in", unit_cost: 0, quantity: 0 },
    ];
    expect((await loadPricingFilaments()).map(value => [value.id, value.cost_confirmed])).toEqual([
      ["free", true], ["identity-only", false], ["return-only", false], ["empty-receipt", false],
    ]);
  });

  it("checks all ledger pages instead of missing a later color's free acquisition", async () => {
    mock.items = [item("first", 0), item("late", 0)];
    mock.movements = [...Array.from({ length: 1000 }, () => ({ item_id: "first", movement_type: "purchase_in", unit_cost: 0, quantity: 1 })),
      { item_id: "late", movement_type: "purchase_in", unit_cost: 0, quantity: 1 }];
    expect((await loadPricingFilaments()).every(value => value.cost_confirmed)).toBe(true);
    expect(mock.reads.filter(read => read.table === "inventory_movements").map(read => [read.from, read.to])).toEqual([[0, 999], [1000, 1999]]);
  });

  it("never confirms a zero rate when its receipt check failed", async () => {
    mock.items = [item("zero", 0)]; mock.movementError = true;
    await expect(loadPricingFilaments()).rejects.toThrow("Receipt check unavailable");
  });
});
