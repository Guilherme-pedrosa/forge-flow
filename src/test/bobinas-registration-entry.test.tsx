import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Bobinas from "@/pages/estoque/Bobinas";
import FilamentSpools from "@/pages/estoque/FilamentSpools";
import type { FilamentPlanningSnapshot } from "@/lib/filament-planning";

const mock = vi.hoisted(() => ({ load: vi.fn(), rpc: vi.fn(), toast: vi.fn(), items: [] as Record<string, unknown>[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: () => {
  const query = { select: () => query, eq: () => query, in: () => query, order: () => query, range: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mock.items, error: null }).then(resolve) };
  return query;
} } }));
vi.mock("@/lib/filament-planning", async original => ({ ...await original<typeof import("@/lib/filament-planning")>(), loadFilamentPlanningSnapshot: mock.load }));
const spoolId = "82000000-0000-4000-8000-000000000001";
const itemId = "82000000-0000-4000-8000-000000000002";
const snapshot = (): FilamentPlanningSnapshot => ({ items: [], jobs: [], purchases: [], reservations: [], spools: [], policies: [], committedDemand: [], vendors: [], printers: [] });
const clients: QueryClient[] = [];
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function show(path = "/estoque/bobinas", physical = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[path]}>{physical ? <FilamentSpools /> : <Bobinas />}<Location /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { mock.items = []; mock.load.mockReset().mockResolvedValue(snapshot()); mock.rpc.mockReset().mockResolvedValue({ data: itemId, error: null }); mock.toast.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });
function existingSpool() {
  const data = snapshot();
  data.items.push({ id: itemId, name: "PLA Framboesa", unit: "g", current_stock: 900, min_stock: 0, vendor_id: null, avg_cost: .1 });
  data.spools.push({ id: spoolId, item_id: itemId, label: "Bobina framboesa", tare_grams: 200, initial_net_grams: 1000, estimated_remaining_grams: 900, measured_gross_grams: 1100,
    measured_at: "2026-10-25T12:00:00Z", weight_source: "manual_weighing", location_kind: "storage", location_label: "Prateleira", printer_id: null,
    ams_unit: null, ams_slot: null, needs_weighing: false, is_active: true, updated_at: "2026-10-25T12:00:00Z" });
  mock.load.mockResolvedValue(data);
}

describe("Entradas da tela de bobinas", () => {
  it("opens the simple filament registration once and removes only the novo flag", async () => {
    show("/estoque/bobinas?novo=1&origem=insumos");
    expect(await screen.findByRole("dialog", { name: "Cadastrar filamento" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/estoque/bobinas?origem=insumos"));
    expect(screen.queryByText(/capacidade|tara do carretel/i)).not.toBeInTheDocument();
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("can start the unified flow even when no material is registered", async () => {
    show(); const start = screen.getByRole("button", { name: "Novo filamento" });
    await waitFor(() => expect(start).toBeEnabled()); fireEvent.click(start);
    expect(screen.getByRole("dialog", { name: "Cadastrar filamento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cor *")).toBeEnabled(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("edits a color's manual stock without a spool and preserves its existing acquisition rate", async () => {
    mock.items = [{ id: itemId, name: "PLA Framboesa", material_code: "PLA", color: "Framboesa", color_code: "FRAMBOESA", brand: "F3D", unit: "g", current_stock: 900, avg_cost: .1 }];
    mock.rpc.mockImplementation(async () => { mock.items = [{ ...mock.items[0], current_stock: 0 }]; return { data: itemId, error: null }; });
    show();
    const table = await screen.findByRole("region", { name: "Estoque de filamentos" });
    expect(within(table).getByText("0,9 kg")).toBeInTheDocument();
    expect(within(table).getByText(/R\$\s*100,00/)).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Editar PLA Framboesa" }));
    const dialog = screen.getByRole("dialog", { name: "Editar filamento" });
    fireEvent.change(within(dialog).getByLabelText("Estoque atual (g)"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar filamento" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({ p_item_id: itemId,
      p_item: expect.objectContaining({ current_stock: 0, expected_stock: 900 }) })));
    expect(mock.rpc.mock.calls[0][1].p_item).not.toHaveProperty("avg_cost");
    await waitFor(() => expect(within(table).getByText("0 kg")).toBeInTheDocument());
    expect(mock.load).not.toHaveBeenCalled();
  });
  it("keeps weighing an existing spool on the physical-only RPC", async () => {
    existingSpool(); show("/estoque/bobinas", true); fireEvent.click(await screen.findByRole("button", { name: "Pesar" }));
    fireEvent.change(screen.getByLabelText("Peso bruto da balança, com carretel (g)"), { target: { value: "1100" } });
    fireEvent.change(screen.getByLabelText("Motivo / observação"), { target: { value: "Conferência da bobina" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_filament_spool", expect.objectContaining({ p_spool_id: spoolId, p_data: expect.objectContaining({ item_id: itemId, measured_gross_grams: 1100, tare_grams: 200 }) })));
  });
  it("keeps movement between locations free of registration or stock-entry writes", async () => {
    existingSpool(); show("/estoque/bobinas", true); fireEvent.click(await screen.findByRole("button", { name: "Mover" }));
    fireEvent.change(screen.getByLabelText("Depósito ou prateleira"), { target: { value: "Estante 2" } });
    fireEvent.change(screen.getByLabelText("Motivo / observação"), { target: { value: "Organização do depósito" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("move_filament_spool", expect.objectContaining({ p_spool_id: spoolId, p_location: expect.objectContaining({ location_label: "Estante 2" }) })));
  });
});
