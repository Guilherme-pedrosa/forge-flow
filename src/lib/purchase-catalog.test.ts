import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPurchaseMaterials } from "./purchase-catalog";

const mock = vi.hoisted(() => ({ from: vi.fn(), inventory: [] as Record<string, unknown>[], products: [] as Record<string, unknown>[],
  reads: [] as { table: string; columns: string; filters: [string, unknown][]; orders: string[]; from: number; to: number }[],
  failTable: "", failFrom: 0, transportFailure: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
const material = (id: string, extra: Record<string, unknown> = {}) => ({ id, tenant_id: "tenant-a", name: id, category: "filament", sku: null,
  material_code: "PLA", color: "Branco", color_code: "WHITE", unit: "g", avg_cost: .05, current_stock: 1000, is_active: true, ...extra });
beforeEach(() => {
  mock.inventory = []; mock.products = []; mock.reads = []; mock.failTable = ""; mock.failFrom = 0; mock.transportFailure = false;
  mock.from.mockReset().mockImplementation((table: string) => {
    let columns = ""; const filters: [string, unknown][] = [], orders: string[] = [];
    const query = { select(value: string) { columns = value; return query; }, eq(field: string, value: unknown) { filters.push([field, value]); return query; },
      order(field: string) { orders.push(field); return query; }, async range(from: number, to: number) {
        mock.reads.push({ table, columns, filters: [...filters], orders: [...orders], from, to });
        if (table === mock.failTable && from === mock.failFrom) {
          if (mock.transportFailure) throw new Error(`${table} transport unavailable`);
          return { data: null, error: new Error(`${table} catalogue unavailable`) };
        }
        const source = table === "inventory_items" ? mock.inventory : mock.products;
        const rows = source.filter(row => filters.every(([field, value]) => row[field] === value));
        return { data: rows.slice(from, to + 1).map(row => Object.fromEntries(columns.split(",").map(field => [field, row[field]]))), error: null };
      } };
    return query;
  });
});

describe("purchase material catalogue excludes product-owned stock", () => {
  it("excludes active and archived products' stock while keeping genuine active raw materials", async () => {
    mock.inventory = [material("raw"), material("active-product-stock"), material("archived-product-stock"), material("inactive-material", { is_active: false }), material("foreign-material", { tenant_id: "tenant-b" })];
    mock.products = [{ id: "active-product", tenant_id: "tenant-a", is_active: true, stock_item_id: "active-product-stock" },
      { id: "archived-product", tenant_id: "tenant-a", is_active: false, stock_item_id: "archived-product-stock" },
      { id: "unlinked-product", tenant_id: "tenant-a", is_active: true, stock_item_id: null },
      { id: "foreign-product", tenant_id: "tenant-b", is_active: true, stock_item_id: "raw" }];
    const result = await loadPurchaseMaterials("tenant-a");
    expect(result.items.map(row => row.id)).toEqual(["raw"]);
    expect(result.productStockItemIds).toEqual(["active-product-stock", "archived-product-stock"]);
    expect(mock.reads.find(read => read.table === "products")).toMatchObject({ columns: "stock_item_id", filters: [["tenant_id", "tenant-a"]], orders: ["id"] });
    expect(mock.reads.find(read => read.table === "inventory_items")).toMatchObject({ filters: [["tenant_id", "tenant-a"], ["is_active", true]], orders: ["name", "id"] });
  });
  it("excludes explicit product/finished_product categories even when no product currently references them", async () => {
    mock.inventory = [material("filament"), material("supply", { category: "consumable", unit: "un" }), material("product", { category: "product" }), material("finished", { category: "finished_product" })];
    expect((await loadPurchaseMaterials("tenant-a")).items.map(row => row.id)).toEqual(["filament", "supply"]);
  });
  it("loads all pages of both catalogues before excluding a later archived-product stock identity", async () => {
    mock.inventory = [...Array.from({ length: 1000 }, (_, index) => material(`material-${String(index).padStart(4, "0")}`)), material("late-owned-stock")];
    mock.products = [...Array.from({ length: 1000 }, (_, index) => ({ tenant_id: "tenant-a", id: `product-${index}`, stock_item_id: null, is_active: true })),
      { tenant_id: "tenant-a", id: "late-archived-product", stock_item_id: "late-owned-stock", is_active: false }];
    const result = await loadPurchaseMaterials("tenant-a");
    expect(result.items).toHaveLength(1000); expect(result.items.some(row => row.id === "late-owned-stock")).toBe(false);
    expect(result.productStockItemIds).toEqual(["late-owned-stock"]);
    for (const table of ["inventory_items", "products"])
      expect(mock.reads.filter(read => read.table === table).map(read => [read.from, read.to])).toEqual([[0, 999], [1000, 1999]]);
  });
  it.each(["inventory_items", "products"])("fails closed when %s cannot be loaded, even if the other catalogue succeeded", async table => {
    mock.inventory = [material("looks-like-filament")]; mock.products = [{ tenant_id: "tenant-a", stock_item_id: "looks-like-filament" }]; mock.failTable = table;
    await expect(loadPurchaseMaterials("tenant-a")).rejects.toThrow(`${table} catalogue unavailable`);
    expect(mock.reads.map(read => read.table)).toContain("inventory_items"); expect(mock.reads.map(read => read.table)).toContain("products");
  });
  it.each(["inventory_items", "products"])("does not expose a partial first page when a later %s page fails", async table => {
    mock.inventory = Array.from({ length: 1001 }, (_, index) => material(`material-${index}`));
    mock.products = Array.from({ length: 1001 }, (_, index) => ({ tenant_id: "tenant-a", stock_item_id: `material-${index}` }));
    mock.failTable = table; mock.failFrom = 1000;
    await expect(loadPurchaseMaterials("tenant-a")).rejects.toThrow(`${table} catalogue unavailable`);
  });
  it("propagates a rejected transport promise instead of treating the exclusion catalogue as empty", async () => {
    mock.inventory = [material("owned-stock")]; mock.failTable = "products"; mock.transportFailure = true;
    await expect(loadPurchaseMaterials("tenant-a")).rejects.toThrow("products transport unavailable");
  });
});
