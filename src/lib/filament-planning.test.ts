import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addPlanningDays, calculateFilamentPlan, filamentPurchaseHref, filamentSupplierPurchaseHref, parseFilamentPurchaseSuggestion, jobFilamentDemand, loadFilamentPlanningSnapshot, operatingDemandDate, snapshotFilamentDemand, stockQuantityToGrams, validPlanningDate, type FilamentJob, type FilamentPlanningSnapshot } from "./filament-planning";

const job = (changes: Partial<FilamentJob> = {}): FilamentJob => ({ id: "j", code: "OI-1", name: "Peça", status: "queued", due_date: "2026-10-11", est_grams: 600, material_id: "a", secondary_material_id: null, print_plate_id: null, production_snapshot: null, inventory_posted_at: null, ...changes });
const snapshot = (changes: Partial<FilamentPlanningSnapshot> = {}): FilamentPlanningSnapshot => ({
  items: [{ id: "a", name: "PLA branco", unit: "kg", current_stock: 1, min_stock: 0, vendor_id: "v" }], jobs: [job()], purchases: [], reservations: [], spools: [], policies: [], committedDemand: [], vendors: [], printers: [], ...changes,
});
describe("filament planning", () => {
  it("converts stock units and preserves invalid units as errors", () => { expect(stockQuantityToGrams(1.25, " KG ")).toBe(1250); expect(stockQuantityToGrams(10.5, "g")).toBe(10.5); expect(() => stockQuantityToGrams(1, "un")).toThrow(/g ou kg/); });
  it("deducts a reservation from free stock once, and job demand once from projected stock", () => {
    const result = calculateFilamentPlan(snapshot({ reservations: [{ id: "r", job_id: "j", item_id: "a", spool_id: null, grams: 600, status: "reserved", released_at: null }] }), "2026-10-10");
    expect(result.materials[0]).toMatchObject({ stockGrams: 1000, reservedGrams: 600, freeGrams: 400, minimumProjectedGrams: 400, suggestedKg: 0 });
  });
  it("keeps physical spools outside aggregate stock and exposes a discrepancy", () => {
    const result = calculateFilamentPlan(snapshot({ spools: [{ id: "s", item_id: "a", label: "Bobina 1", tare_grams: 200, initial_net_grams: 1000, estimated_remaining_grams: 850, measured_gross_grams: 1050, measured_at: null, weight_source: "manual_weighing", location_kind: "storage", location_label: "Depósito", printer_id: null, ams_slot: null, ams_unit: null, needs_weighing: false, is_active: true, updated_at: "" }] }), "2026-10-10");
    expect(result.materials[0]).toMatchObject({ stockGrams: 1000, spoolGrams: 850, spoolDifferenceGrams: -150, minimumProjectedGrams: 400 });
  });
  it("ignores consumed jobs/reservations while retaining no false extra stock", () => {
    const result = calculateFilamentPlan(snapshot({ jobs: [job({ inventory_posted_at: "2026-10-09" })], reservations: [{ id: "r", job_id: "j", item_id: "a", spool_id: null, grams: 600, status: "reserved", released_at: null }] }), "2026-10-10");
    expect(result.materials[0]).toMatchObject({ reservedGrams: 0, demandGrams: 0, minimumProjectedGrams: 1000 });
  });
  it("counts unknown two-color demand instead of guessing a split", () => {
    const result = calculateFilamentPlan(snapshot({ jobs: [job({ secondary_material_id: "b" })] }), "2026-10-10");
    expect(result.unknownDemandCount).toBe(1); expect(result.materials[0].demandGrams).toBe(0);
  });
  it("uses frozen per-plate requirements for each color and ignores other plates", () => {
    expect(jobFilamentDemand(job({ secondary_material_id: "b", print_plate_id: "p", production_snapshot: { requirements: [{ plate_id: "p", item_id: "a", grams_per_print: 100 }, { plate_id: "p", item_id: "b", grams_per_print: 200 }, { plate_id: "q", item_id: "a", grams_per_print: 500 }] } }))).toEqual([{ item_id: "a", grams: 100 }, { item_id: "b", grams: 200 }]);
  });
  it("accounts for whole print runs across different plates and kit components", () => {
    const recipe = (capacity: number, grams: number) => ({ units_per_print: capacity, lines: [{ item_id: "a", grams_per_print: grams }] });
    const value = { components: [{ quantity: 2, snapshot: { plates: [{ recipe: recipe(4, 100) }, { recipe: recipe(3, 60) }] } }] };
    expect(snapshotFilamentDemand(value, 3)).toEqual([{ item_id: "a", grams: 320 }]);
  });
  it("does not let a future purchase conceal an earlier shortage and rounds to the vendor multiple", () => {
    const result = calculateFilamentPlan(snapshot({ jobs: [job({ est_grams: 1700 })], purchases: [{ id: "p", code: "CMP-1", status: "pending", expected_date: "2026-10-15", items: [{ inventory_item_id: "a", stock_quantity: 2 }] }], policies: [{ item_id: "a", vendor_id: "v", multiple_kg: 0.5, lead_days: 3, buffer_grams: 100 }] }), "2026-10-10");
    expect(result.materials[0]).toMatchObject({ minimumProjectedGrams: -700, shortageDate: "2026-10-11", orderByDate: "2026-10-08", suggestedKg: 1, incomingGrams: 2000 });
  });
  it("uses a confirmed same-day delivery before that day's demand", () => {
    const result = calculateFilamentPlan(snapshot({ jobs: [job({ est_grams: 1700 })], purchases: [{ id: "p", code: "CMP-1", status: "pending", expected_date: "2026-10-11", items: [{ inventory_item_id: "a", stock_quantity: 1 }] }] }), "2026-10-10");
    expect(result.materials[0]).toMatchObject({ minimumProjectedGrams: 300, suggestedKg: 0 });
  });
  it("does not manufacture incoming mass from purchase package count or overdue ETA", () => {
    const result = calculateFilamentPlan(snapshot({ purchases: [{ id: "p", code: "CMP-1", status: "pending", expected_date: "2026-10-09", items: [{ inventory_item_id: "a", stock_quantity: 1 }] }, { id: "q", code: "CMP-2", status: "pending", expected_date: null, items: [{ inventory_item_id: "a", stock_quantity: null }] }, { id: "r", code: "CMP-3", status: "draft", expected_date: "2026-10-10", items: [{ inventory_item_id: "a", stock_quantity: 5 }] }] }), "2026-10-10");
    expect(result.materials[0]).toMatchObject({ incomingGrams: 0, undatedIncomingGrams: 1000 }); expect(result.undatedPurchaseCount).toBe(1); expect(result.unconvertedPurchaseCount).toBe(1);
  });
  it("treats demand without a due date as immediate and includes committed unplanned orders", () => {
    const result = calculateFilamentPlan(snapshot({ jobs: [job({ due_date: null })], committedDemand: [{ id: "i", label: "OP", due_date: null, lines: [{ item_id: "a", grams: 700 }] }] }), "2026-10-10");
    expect(result.undatedDemandCount).toBe(2); expect(result.materials[0]).toMatchObject({ demandGrams: 1300, shortageDate: "2026-10-10", suggestedKg: 1 });
    expect(filamentPurchaseHref(result.materials[0])).toContain("reposicao_kg=1");
  });
  it("validates calendar dates and subtracts supplier planning days across months", () => { expect(validPlanningDate("2026-02-30")).toBe(false); expect(addPlanningDays("2026-10-01", -3)).toBe("2026-09-28"); expect(() => calculateFilamentPlan(snapshot(), "invalid")).toThrow(); });
  it("uses the internal target before dispatch/delivery, in the company's timezone", () => {
    expect(operatingDemandDate({ due_date: "2026-10-20", ship_by_at: "2026-10-12T01:00:00Z", internal_due_at: "2026-10-11T01:00:00Z" }, "America/Sao_Paulo")).toBe("2026-10-10");
    expect(operatingDemandDate({ due_date: null, ship_by_at: "2026-10-12T01:00:00Z" }, "America/Sao_Paulo")).toBe("2026-10-11");
  });
  it("loads a quote-based production demand once and inherits an operational deadline for jobs", async () => {
    const recipe = { units_per_print: 1, lines: [{ item_id: "a", grams_per_print: 100 }] };
    const rows: Record<string, Record<string, unknown>[]> = {
      inventory_items: [{ ...snapshot().items[0], category: "filament", is_active: true }],
      tenants: [{ id: "t", timezone: "America/Sao_Paulo" }],
      orders: [{ id: "o", code: "PED", status: "approved", source_quote_id: "q", due_date: "2026-10-20", ship_by_at: "2026-10-12T01:00:00Z", internal_due_at: "2026-10-11T01:00:00Z" }],
      order_items: [{ id: "oi", order_id: "o", quantity: 2, description: "Peça", product_snapshot: { recipe } }],
      production_orders: [{ id: "p", code: "OP", status: "preparing", source_order_id: null, source_quote_id: "q", due_date: null }],
      production_order_items: [{ id: "pi", production_order_id: "p", quantity: 2, description: "Peça", commercial_snapshot: { recipe } }],
    };
    const orderKeys: Record<string, string> = {};
    const client = { from: (table: string) => ({ select() { return this; }, order(key: string) { orderKeys[table] = key; return this; }, range(from: number, to: number) { return Promise.resolve({ data: (rows[table] ?? []).slice(from, to + 1), error: null }); } }) } as unknown as SupabaseClient;
    const unplanned = await loadFilamentPlanningSnapshot(client);
    expect(unplanned.committedDemand).toHaveLength(1); expect(unplanned.committedDemand[0]).toMatchObject({ due_date: "2026-10-10", lines: [{ item_id: "a", grams: 200 }] });
    expect(orderKeys.filament_replenishment_policies).toBe("item_id");
    rows.jobs = [{ ...job({ due_date: "2026-10-20", production_order_id: "p", production_order_item_id: "pi" }) }];
    const planned = await loadFilamentPlanningSnapshot(client);
    expect(planned.committedDemand).toHaveLength(0); expect(planned.jobs[0].due_date).toBe("2026-10-10");
  });
  it("preserves missing-structure error codes while keeping real read failures visible", async () => {
    const client = { from: () => ({ select() { return this; }, order() { return this; }, range() { return Promise.resolve({ data: null, error: { message: "Relation missing", code: "42P01" } }); } }) } as unknown as SupabaseClient;
    await expect(loadFilamentPlanningSnapshot(client)).rejects.toMatchObject({ message: "Relation missing", code: "42P01" });
  });
  it("resolves cancelled sales through paginated OP sources and retains physical work", async () => {
    const rows: Record<string, unknown[]> = {
      inventory_items: [{ ...snapshot().items[0], category: "filament", is_active: true }],
      orders: [...Array.from({ length: 500 }, (_, index) => ({ id: `other-sale-${index}`, status: "draft" })), { id: "cancelled-sale", status: "cancelled" }],
      production_orders: [...Array.from({ length: 500 }, (_, index) => ({ id: `other-op-${index}`, status: "completed" })), { id: "derived-op", status: "released", source_order_id: "cancelled-sale" }, { id: "cancelled-op", status: "cancelled" }],
      jobs: [
        job({ id: "derived", order_id: null, production_order_id: "derived-op" }),
        job({ id: "direct", order_id: "cancelled-sale" }),
        job({ id: "draft-op", status: "draft", production_order_id: "cancelled-op" }),
        job({ id: "reprint-op", status: "reprint", production_order_id: "cancelled-op" }),
        job({ id: "printing", status: "printing", production_order_id: "derived-op" }),
        job({ id: "started", order_id: "cancelled-sale", started_at: "2026-10-10T10:00:00Z" }),
        job({ id: "posted", order_id: "cancelled-sale", inventory_posted_at: "2026-10-10T11:00:00Z" }),
        job({ id: "qc", status: "quality_check", production_order_id: "cancelled-op" }),
        job({ id: "active" }),
      ],
      filament_active_reservations: [{ id: "cancelled-reservation", job_id: "derived", item_id: "a", spool_id: null, grams: 600, status: "reserved", released_at: null }],
    };
    const requests: { table: string; columns: string; from: number }[] = [];
    const client = { from: (table: string) => {
      let columns = "";
      return { select(value: string) { columns = value; return this; }, order() { return this; }, range(from: number, to: number) {
        requests.push({ table, columns, from });
        return Promise.resolve({ data: (rows[table] ?? []).slice(from, to + 1), error: null });
      } };
    } } as unknown as SupabaseClient;
    const loaded = await loadFilamentPlanningSnapshot(client);
    expect(loaded.jobs.map(entry => entry.id)).toEqual(["printing", "started", "posted", "qc", "active"]);
    expect(loaded.committedDemand).toEqual([]);
    expect(calculateFilamentPlan(loaded, "2026-10-10").materials[0]).toMatchObject({ demandGrams: 1800, reservedGrams: 0 });
    expect(requests).toContainEqual(expect.objectContaining({ table: "orders", from: 500 }));
    expect(requests).toContainEqual(expect.objectContaining({ table: "production_orders", from: 500 }));
    expect(requests.find(request => request.table === "jobs")?.columns.split(",")).toContain("started_at");
    expect(rows.jobs).toHaveLength(9);
  });
  it("consolidates colors for one supplier and chooses the earliest need even when overdue", () => {
    const materials = calculateFilamentPlan(snapshot({ items: [snapshot().items[0], { ...snapshot().items[0], id: "b", name: "PLA azul", unit: "g", current_stock: 0 }], jobs: [job({ est_grams: 2000 }), job({ id: "blue", material_id: "b", est_grams: 1500, due_date: "2026-10-15" })] }), "2026-10-10").materials;
    const href = filamentSupplierPurchaseHref(materials);
    const params = new URL(href, "https://erp.example.test").searchParams;
    expect(params.get("reposicao_fornecedor")).toBe("v");
    expect(params.get("reposicao_entrega")).toBe("2026-10-11");
    expect(parseFilamentPurchaseSuggestion(params)).toEqual([{ item_id: "a", kg: 1 }, { item_id: "b", kg: 2 }]);
    expect(params.has("reposicao_item")).toBe(false);
    expect(() => filamentSupplierPurchaseHref([materials[0], { ...materials[1], vendorId: "other" }])).toThrow(/mesmo fornecedor/);
    expect(new URL(filamentSupplierPurchaseHref([{ ...materials[0], vendorId: null, expectedDeliveryDate: "2026-10-09" }, { ...materials[1], vendorId: null }]), "https://erp.example.test").searchParams.get("reposicao_entrega")).toBe("2026-10-09");
  });
  it("rejects the entire malformed multi-item request and never falls back to a valid single item", () => {
    const valid = { item_id: "a", kg: 1 };
    const invalid = [null, {}, [], [valid, { item_id: "b", kg: 0 }], [valid, { item_id: "b", kg: "1" }], [valid, { item_id: "b", kg: 0.0001 }], [valid, { item_id: "b", kg: 100001 }], [valid, valid], Array.from({ length: 501 }, (_, i) => ({ item_id: String(i), kg: 1 }))];
    for (const value of invalid) expect(() => parseFilamentPurchaseSuggestion(new URLSearchParams({ reposicao_itens: JSON.stringify(value) }))).toThrow();
    expect(() => parseFilamentPurchaseSuggestion(new URLSearchParams({ reposicao_itens: "not-json", reposicao_item: "a", reposicao_kg: "1" }))).toThrow();
    expect(() => parseFilamentPurchaseSuggestion(new URLSearchParams("reposicao_itens=%5B%5D&reposicao_itens=%5B%5D"))).toThrow(/repetidos/);
    expect(parseFilamentPurchaseSuggestion(new URLSearchParams({ reposicao_item: "a", reposicao_kg: "1.5" }))).toEqual([{ item_id: "a", kg: 1.5 }]);
    expect(parseFilamentPurchaseSuggestion(new URLSearchParams())).toBeNull();
  });
  it("does not treat a missing material stock balance as zero for a purchase suggestion", () => {
    expect(() => calculateFilamentPlan(snapshot({ items: [{ ...snapshot().items[0], current_stock: null as unknown as number }] }), "2026-10-10")).toThrow(/Saldo de filamento inválido/);
  });
});
