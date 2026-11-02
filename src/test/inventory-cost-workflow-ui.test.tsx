import { webcrypto } from "node:crypto";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Movimentacoes from "@/pages/estoque/Movimentacoes";
import Compras from "@/pages/estoque/Compras";
import { ImportedProductPricing } from "@/components/comercial/ImportedProductPricing";
import type { ModelPricingEstimate } from "@/lib/model-pricing";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), rows: {} as Record<string, Record<string, unknown>[]>, stock: {} as Record<string, number> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" }, user: { id: "user" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label, disabled }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string; disabled?: boolean }) =>
  <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, in: () => query, is: () => query, order: () => query, range: () => query, limit: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: structuredClone(mock.rows[table] || []), error: null }).then(resolve, reject) };
  return query;
} } }));
const policy = { machine_hour_cost: 0, energy_cost_kwh: 0, labor_cost_hour: 0, overhead_percent: 0, target_margin: 50,
  handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  printer_hour_costs: [], machine_rate_scope: "commercial_excludes_energy", revision: "confirmed" };
const estimate: ModelPricingEstimate = { hours: 1, timeSeconds: 3600, weightGrams: 100, plateCount: 1, partCount: 1,
  printerModelIds: ["Bambu Lab A1"], nozzleDiameters: ["0.4"], materials: [{ key: "red", slotId: 1, materialCode: "PLA", colorHex: "#FF0000", grams: 100, plateIndices: [1], name: "PLA vermelho" }] };
function PricingConsumer() {
  const [cost, setCost] = useState<number | null>(null);
  return <><ImportedProductPricing estimate={estimate} onCalculated={value => setCost(value?.cost ?? null)} /><output aria-label="Custo material observado">{cost}</output></>;
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  mock.stock = { red: 100, blue: 20 }; mock.toast.mockReset(); mock.rpc.mockReset();
  mock.rows = {
    inventory_items: [{ id: "red", tenant_id: "tenant", name: "PLA vermelho", category: "filament", unit: "g", avg_cost: .1, current_stock: 100, material_code: "PLA", color: "Vermelho", color_code: "RED", color_hex: "#FF0000", is_active: true },
      { id: "blue", tenant_id: "tenant", name: "PETG azul", category: "filament", unit: "g", avg_cost: .2, current_stock: 20, material_code: "PETG", color: "Azul", color_code: "BLUE", color_hex: "#0000FF", is_active: true }],
    printers: [{ id: "a1", name: "A1 oficina", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 0, maintenance_cost_per_hour: 0, is_active: true }],
    purchase_orders: [{ id: "purchase", code: "CMP-1", status: "pending", order_date: "2026-01-01", expected_date: null, total: 20, subtotal: 20, discount: 0, shipping: 0, additional_costs: 0, vendors: { name: "Fornecedor" } }],
    purchase_order_items: [{ id: "line", purchase_order_id: "purchase", description: "PLA vermelho", quantity: 1, unit_price: 20, total: 20, inventory_item_id: "red", stock_quantity: 100 }],
  };
  mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "pricing_settings") return { data: policy, error: null };
    if (name === "purchase_expected_date_review_available") return { data: true, error: null };
    if (name === "post_inventory_count") {
      const counts = args.p_items as { item_id: string; current_stock: number; expected_stock: number }[];
      if (counts.some(item => mock.stock[item.item_id] !== item.expected_stock)) return { data: null, error: { message: "O saldo mudou desde a abertura. Reabra o item para conferir a quantidade atual." } };
      for (const item of counts) {
        mock.stock[item.item_id] = item.current_stock;
        mock.rows.inventory_items.find(value => value.id === item.item_id)!.current_stock = item.current_stock;
      }
      return { data: counts[0].item_id, error: null };
    }
    if (name === "post_inventory_movement" || name === "post_inventory_batch") return { data: "movement", error: null };
    if (name === "receive_purchase_order") {
      // The real database's weighted-cost calculation has its own integration
      // suite. This response represents its committed 100g + 100g receipt.
      mock.rows.inventory_items[0].avg_cost = .15; mock.rows.inventory_items[0].current_stock = 200; mock.stock.red = 200;
      mock.rows.purchase_orders[0].status = "received";
      return { data: "purchase", error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(element: React.ReactNode, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{element}</MemoryRouter></QueryClientProvider>);
  return { client, invalidate };
}
async function countForm(quantity: string) {
  const dialog = await screen.findByRole("dialog", { name: "Nova Movimentação" });
  await waitFor(() => expect(within(dialog).getByLabelText("Item de estoque")).toHaveValue("red"));
  fireEvent.change(within(dialog).getByLabelText("Movimentação"), { target: { value: "count" } });
  fireEvent.change(within(dialog).getByLabelText("Quantidade da movimentação"), { target: { value: quantity } });
  return dialog;
}

describe("manual filament balances", () => {
  it("submits the absolute count and rejects a receipt that changed the displayed balance before saving", async () => {
    mount(<Movimentacoes />, "/estoque/movimentacoes?item=red");
    const dialog = await countForm("200");
    // Another operator receives 50g while this editor still shows 100g.
    mock.stock.red = 150; mock.rows.inventory_items[0].current_stock = 150; mock.rows.inventory_items[0].avg_cost = .15;
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Erro", description: expect.stringContaining("saldo mudou") })));
    expect(mock.rpc).toHaveBeenCalledWith("post_inventory_count", { p_items: [{ item_id: "red", current_stock: 200, expected_stock: 100 }], p_request_id: expect.any(String) });
    expect(mock.stock.red).toBe(150);
    expect(within(dialog).getByLabelText("Quantidade da movimentação")).toHaveValue("200");
    await waitFor(() => expect(within(dialog).getByText(/Saldo atual:/)).toHaveTextContent("Saldo atual: 150"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith({ title: "Saldo conferido" }));
    const counts = mock.rpc.mock.calls.filter(([name]) => name === "post_inventory_count");
    expect(counts[1][1]).toMatchObject({ p_items: [{ item_id: "red", current_stock: 200, expected_stock: 150 }] });
    expect(counts[0][1].p_request_id).not.toBe(counts[1][1].p_request_id);
    expect(mock.stock.red).toBe(200); expect(mock.rows.inventory_items[0].avg_cost).toBe(.15);
    expect(mock.rpc.mock.calls.some(([name]) => name === "post_inventory_movement" || name === "post_inventory_batch")).toBe(false);
  });

  it("confirms zero balances for several colors in one atomic count request without sending cost fields", async () => {
    mount(<Movimentacoes />, "/estoque/movimentacoes?item=red");
    const dialog = await countForm("0");
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar outro produto" }));
    fireEvent.change(within(dialog).getByLabelText("Item adicional 1"), { target: { value: "blue" } });
    fireEvent.change(within(dialog).getByLabelText("Quantidade adicional 1"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith({ title: "Saldo conferido" }));
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("post_inventory_count", { p_items: [
      { item_id: "red", current_stock: 0, expected_stock: 100 }, { item_id: "blue", current_stock: 0, expected_stock: 20 },
    ], p_request_id: expect.any(String) });
    expect(mock.stock).toEqual({ red: 0, blue: 0 });
    expect(mock.rows.inventory_items.map(item => item.avg_cost)).toEqual([.1, .2]);
  });

  it.each([{ direction: "in", quantity: 50, type: "purchase_in", cost: .1 }, { direction: "out", quantity: -50, type: "adjustment", cost: null }])("preserves the existing $direction ledger operation", async ({ direction, quantity, type, cost }) => {
      mount(<Movimentacoes />, "/estoque/movimentacoes?item=red");
      const dialog = await screen.findByRole("dialog", { name: "Nova Movimentação" });
      await waitFor(() => expect(within(dialog).getByLabelText("Item de estoque")).toHaveValue("red"));
      fireEvent.change(within(dialog).getByLabelText("Movimentação"), { target: { value: direction } });
      fireEvent.change(within(dialog).getByLabelText("Quantidade da movimentação"), { target: { value: "50" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Registrar" }));
      await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("post_inventory_movement", expect.objectContaining({ p_movement: expect.objectContaining({ item_id: "red", quantity, movement_type: type, unit_cost: cost }) })));
      expect(mock.rpc.mock.calls.some(([name]) => name === "post_inventory_count")).toBe(false);
    });
});

describe("purchase receipts update active pricing consumers", () => {
  it("refreshes the actual import calculator after the same color's weighted acquisition rate changes", async () => {
    const { invalidate } = mount(<><Compras /><PricingConsumer /></>, "/estoque/compras?compra=purchase");
    await waitFor(() => expect(screen.getByLabelText("Custo material observado")).toHaveTextContent("10"));
    fireEvent.click(await screen.findByRole("button", { name: "Receber Pedido" }));
    const confirm = await screen.findByRole("dialog", { name: "Confirmar Recebimento" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar Recebimento" }));
    await waitFor(() => expect(screen.getByLabelText("Custo material observado")).toHaveTextContent("15"));
    expect(mock.rpc).toHaveBeenCalledWith("receive_purchase_order", expect.objectContaining({ p_order_id: "purchase" }));
    const keys = invalidate.mock.calls.map(([options]) => options?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(["inventory_items", "import-pricing-filaments", "pricing-materials", "product_print_plate_preparation", "product_material_recipe", "product_pricing_preview", "products", "filament-planning"]));
    expect(keys).not.toContain("pricing_settings");
    expect(mock.rpc.mock.calls.some(([name]) => name === "save_product_with_photos" || name === "register_filament_spool")).toBe(false);
  });
});
