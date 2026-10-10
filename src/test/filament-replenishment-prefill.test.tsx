import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Compras from "@/pages/estoque/Compras";
import Reposicao from "@/pages/estoque/Reposicao";
import type { FilamentPlanningSnapshot } from "@/lib/filament-planning";
import { localDate } from "@/lib/finance";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), unit: "g", plan: null as FilamentPlanningSnapshot | null, items: null as null | { id: string; name: string; category: string; material_code: string; color: string; color_code: string; unit: string }[] }));
vi.mock("@/lib/filament-planning", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/filament-planning")>(), loadFilamentPlanningSnapshot: () => Promise.resolve(mock.plan) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: table === "inventory_items" ? mock.items ?? [{ id: "white", name: "PLA branco", category: "filament", material_code: "PLA", color: "Branco", color_code: "WHITE", unit: mock.unit }] : table === "vendors" ? [{ id: "vendor", name: "Fornecedor" }] : [], error: null }).then(resolve, reject) };
  return query;
} } }));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn(); mock.rpc.mockReset(); mock.toast.mockClear(); mock.unit = "g"; mock.items = null; mock.plan = null;
  mock.rpc.mockResolvedValue({ data: "purchase-1", error: null });
});
afterEach(cleanup);
const mount = (query: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[`/estoque/compras?${query}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Compras /></MemoryRouter></QueryClientProvider>);
describe("replenishment review in purchases", () => {
  it("prefills kg and converted grams without creating any financial/material operation", async () => {
    mount("reposicao_item=white&reposicao_kg=1.5&reposicao_fornecedor=vendor&reposicao_entrega=2099-10-10");
    await screen.findByText("Revisar reposição sugerida");
    expect(screen.getByLabelText("Quantidade comprada do item 1")).toHaveValue("1.5");
    expect(screen.getByLabelText("Preço unitário do item 1")).toHaveValue(0);
    expect(screen.getByLabelText("Quantidade de estoque de PLA branco · compra em kg")).toHaveValue("1500");
    expect(screen.getByRole("combobox", { name: "Fornecedor da compra" })).toHaveValue("vendor");
    expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Preço unitário do item 1"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar compra" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_quick_purchase", expect.objectContaining({ p_receive: false, p_items: [expect.objectContaining({ quantity: 1.5, unit_price: 80, stock_quantity: 1500, total: 120 })] })));
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["save_quick_purchase"]);
  });
  it("keeps a kg inventory item in kg and requires the normal review action", async () => {
    mock.unit = "kg"; mount("reposicao_item=white&reposicao_kg=2");
    await screen.findByText("Revisar reposição sugerida");
    expect(screen.getByLabelText("Quantidade de estoque de PLA branco · compra em kg")).toHaveValue("2");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("discards a stale supplier reference rather than assigning an arbitrary vendor", async () => {
    mount("reposicao_item=white&reposicao_kg=1&reposicao_fornecedor=foreign");
    await screen.findByText("Revisar reposição sugerida");
    expect(screen.getByRole("combobox", { name: "Fornecedor da compra" })).toHaveValue("");
    expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Preço unitário do item 1"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar compra" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("fornecedor ativo") })));
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("reviews two colors in different stock units and saves one purchase with one freight after every price is entered", async () => {
    mock.items = [
      { id: "white", name: "PLA branco", category: "filament", material_code: "PLA", color: "Branco", color_code: "WHITE", unit: "g" },
      { id: "blue", name: "PLA azul", category: "filament", material_code: "PLA", color: "Azul", color_code: "BLUE", unit: "kg" },
    ];
    const params = new URLSearchParams({ reposicao_itens: JSON.stringify([{ item_id: "white", kg: 1.5 }, { item_id: "blue", kg: 2 }]), reposicao_fornecedor: "vendor", reposicao_entrega: "2099-10-10" });
    mount(params.toString());
    await screen.findByText("Revisar reposição sugerida");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("Quantidade comprada do item 1")).toHaveValue("1.5");
    expect(screen.getByLabelText("Quantidade comprada do item 2")).toHaveValue("2");
    expect(screen.getByLabelText("Quantidade de estoque de PLA branco · compra em kg")).toHaveValue("1500");
    expect(screen.getByLabelText("Quantidade de estoque de PLA azul · compra em kg")).toHaveValue("2");
    expect(screen.getByLabelText("Preço unitário do item 1")).toHaveValue(0);
    expect(screen.getByLabelText("Preço unitário do item 2")).toHaveValue(0);
    expect(screen.getByLabelText("Previsão de Entrega")).toHaveValue("2099-10-10");
    expect(screen.getByRole("combobox", { name: "Fornecedor da compra" })).toHaveValue("vendor");
    expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Preço unitário do item 1"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar compra" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("todos os materiais") })));
    expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Preço unitário do item 2"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Frete (R$)"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Previsão de Entrega"), { target: { value: "2099-10-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar compra" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_quick_purchase", expect.objectContaining({ p_receive: false, p_order: expect.objectContaining({ vendor_id: "vendor", shipping: 20, total: 320, expected_date: "2099-10-09" }), p_items: [expect.objectContaining({ inventory_item_id: "white", quantity: 1.5, unit_price: 80, stock_quantity: 1500, total: 120 }), expect.objectContaining({ inventory_item_id: "blue", quantity: 2, unit_price: 90, stock_quantity: 2, total: 180 })] })));
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["save_quick_purchase"]);
  });
  it.each([
    [{ item_id: "white", kg: 1 }, { item_id: "missing", kg: 1 }],
    [{ item_id: "white", kg: 1 }, { item_id: "white", kg: 2 }],
    Array.from({ length: 501 }, (_, i) => ({ item_id: `item-${i}`, kg: 1 })),
  ])("rejects an invalid consolidated suggestion without opening a partial purchase", async (...rows) => {
    mount(new URLSearchParams({ reposicao_itens: JSON.stringify(rows) }).toString());
    await screen.findByText("Não foi possível abrir a reposição sugerida.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("does not use a legacy single-color fallback for invalid multi-color JSON", async () => {
    mount("reposicao_itens=invalid&reposicao_item=white&reposicao_kg=1");
    await screen.findByText("Não foi possível abrir a reposição sugerida.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("opens every color from the supplier group button with the earliest required delivery", async () => {
    mock.items = [
      { id: "white", name: "PLA branco", category: "filament", material_code: "PLA", color: "Branco", color_code: "WHITE", unit: "g" },
      { id: "blue", name: "PLA azul", category: "filament", material_code: "PLA", color: "Azul", color_code: "BLUE", unit: "kg" },
    ];
    const job = { code: "OI", name: "Peça", status: "queued", secondary_material_id: null, production_snapshot: null, inventory_posted_at: null, print_plate_id: null };
    mock.plan = { items: mock.items.map(item => ({ ...item, current_stock: 0, min_stock: 0, vendor_id: "vendor" })), jobs: [{ ...job, id: "white-job", material_id: "white", est_grams: 1500, due_date: "2099-10-12" }, { ...job, id: "blue-job", material_id: "blue", est_grams: 500, due_date: "2099-10-10" }], purchases: [], reservations: [], spools: [], policies: [], committedDemand: [], vendors: [{ id: "vendor", name: "Fornecedor" }], printers: [] };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={["/estoque/reposicao"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/estoque/reposicao" element={<Reposicao />} /><Route path="/estoque/compras" element={<Compras />} /></Routes></MemoryRouter></QueryClientProvider>);
    const button = await screen.findByRole("link", { name: "Revisar compra do fornecedor" });
    expect(screen.getAllByRole("link", { name: "Revisar compra do fornecedor" })).toHaveLength(1);
    fireEvent.click(button);
    await screen.findByText("Revisar reposição sugerida");
    expect(screen.getByLabelText("Quantidade de estoque de PLA branco · compra em kg")).toHaveValue("2000");
    expect(screen.getByLabelText("Quantidade de estoque de PLA azul · compra em kg")).toHaveValue("1");
    expect(screen.getByLabelText("Previsão de Entrega")).toHaveValue("2099-10-10");
    expect(screen.getByRole("combobox", { name: "Fornecedor da compra" })).toHaveValue("vendor");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("shows the current physical safety risk without another purchase for covered ETA today", async () => {
    mock.plan = {
      items: [{ id: "white", name: "PLA branco", unit: "g", current_stock: 200, min_stock: 500, vendor_id: "vendor" }],
      jobs: [], reservations: [], policies: [], committedDemand: [], vendors: [{ id: "vendor", name: "Fornecedor" }], printers: [],
      purchases: [{ id: "purchase", code: "CMP", status: "pending", expected_date: localDate(), items: [{ inventory_item_id: "white", stock_quantity: 1000 }] }],
      spools: [{ id: "spool", item_id: "white", label: "Bobina branca", tare_grams: 200, initial_net_grams: 1000, estimated_remaining_grams: 100, measured_gross_grams: 300, measured_at: null, weight_source: "manual_weighing", location_kind: "storage", location_label: "Depósito", printer_id: null, ams_unit: null, ams_slot: null, needs_weighing: true, is_active: true, updated_at: "" }],
    };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Reposicao /></MemoryRouter></QueryClientProvider>);
    await screen.findByText("Segurança abaixo do mínimo agora");
    expect(screen.getByText(/risco permanece até receber/)).toHaveTextContent("0,3 kg");
    expect(screen.getByText(/diferença de/)).toHaveTextContent("-0,1 kg");
    expect(screen.getByText(/diferença de/)).toHaveTextContent("1 bobina(s) precisam de pesagem");
    expect(screen.queryByRole("link", { name: "Revisar compra do fornecedor" })).not.toBeInTheDocument();
    expect(screen.getByText(/demanda conhecida cabe no saldo registrado/)).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("keeps a valid color in the supplier purchase when another color has a stale reservation", async () => {
    mock.items = [
      { id: "white", name: "PLA branco", category: "filament", material_code: "PLA", color: "Branco", color_code: "WHITE", unit: "g" },
      { id: "blue", name: "PLA azul", category: "filament", material_code: "PLA", color: "Azul", color_code: "BLUE", unit: "kg" },
    ];
    const job = { code: "OI", name: "Peça", status: "queued", secondary_material_id: null, production_snapshot: null, inventory_posted_at: null, print_plate_id: null, due_date: "2099-10-12", est_grams: 600 };
    mock.plan = { items: mock.items.map(item => ({ ...item, current_stock: 0, min_stock: 0, vendor_id: "vendor" })), jobs: [{ ...job, id: "white-job", material_id: "white" }, { ...job, id: "blue-job", material_id: "blue" }], purchases: [], reservations: [{ id: "stale", job_id: "cancelled-source", item_id: "white", spool_id: null, grams: 600, status: "reserved", released_at: null }], spools: [], policies: [], committedDemand: [], vendors: [{ id: "vendor", name: "Fornecedor" }], printers: [] };
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Reposicao /></MemoryRouter></QueryClientProvider>);
    const button = await screen.findByRole("link", { name: "Revisar 1 material(is) sem pendência" });
    expect(screen.getByText(/PLA branco: reserva sem demanda ativa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revise as reservas deste material" })).toBeDisabled();
    const params = new URL(button.getAttribute("href")!, "https://erp.example.test").searchParams;
    expect(JSON.parse(params.get("reposicao_itens")!)).toEqual([{ item_id: "blue", kg: 1 }]);
    expect(params.get("reposicao_fornecedor")).toBe("vendor");
    expect(screen.getByRole("link", { name: "Revisar só este material" })).toHaveAttribute("href", expect.stringContaining("reposicao_item=blue"));
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
