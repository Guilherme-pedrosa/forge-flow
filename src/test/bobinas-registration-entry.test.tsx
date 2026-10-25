import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Bobinas from "@/pages/estoque/Bobinas";
import type { FilamentPlanningSnapshot } from "@/lib/filament-planning";

const mock = vi.hoisted(() => ({ load: vi.fn(), rpc: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("@/lib/filament-planning", async original => ({ ...await original<typeof import("@/lib/filament-planning")>(), loadFilamentPlanningSnapshot: mock.load }));
const spoolId = "82000000-0000-4000-8000-000000000001";
const itemId = "82000000-0000-4000-8000-000000000002";
const snapshot = (): FilamentPlanningSnapshot => ({ items: [], jobs: [], purchases: [], reservations: [], spools: [], policies: [], committedDemand: [], vendors: [], printers: [] });
const clients: QueryClient[] = [];
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function show(path = "/estoque/bobinas") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[path]}><Bobinas /><Location /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { mock.load.mockReset().mockResolvedValue(snapshot()); mock.rpc.mockReset().mockResolvedValue({ data: spoolId, error: null }); mock.toast.mockReset(); });
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
  it("opens unified registration from Materials only once and removes only the novo flag", async () => {
    show("/estoque/bobinas?novo=1&origem=insumos");
    expect(await screen.findByRole("dialog", { name: "Cadastrar filamento e bobina" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/estoque/bobinas?origem=insumos"));
    expect(screen.getByRole("radio", { name: "Filamento novo" })).toBeChecked();
    expect(mock.rpc).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("can start the unified flow even when no material is registered", async () => {
    show(); const start = screen.getByRole("button", { name: "Cadastrar bobina" });
    await waitFor(() => expect(start).toBeEnabled()); fireEvent.click(start);
    expect(screen.getByRole("dialog", { name: "Cadastrar filamento e bobina" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cor do filamento")).toBeEnabled(); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("keeps weighing an existing spool on the physical-only RPC", async () => {
    existingSpool(); show(); fireEvent.click(await screen.findByRole("button", { name: "Pesar" }));
    fireEvent.change(screen.getByLabelText("Peso bruto da balança, com carretel (g)"), { target: { value: "1100" } });
    fireEvent.change(screen.getByLabelText("Motivo / observação"), { target: { value: "Conferência da bobina" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_filament_spool", expect.objectContaining({ p_spool_id: spoolId, p_data: expect.objectContaining({ item_id: itemId, measured_gross_grams: 1100, tare_grams: 200 }) })));
  });
  it("keeps movement between locations free of registration or stock-entry writes", async () => {
    existingSpool(); show(); fireEvent.click(await screen.findByRole("button", { name: "Mover" }));
    fireEvent.change(screen.getByLabelText("Depósito ou prateleira"), { target: { value: "Estante 2" } });
    fireEvent.change(screen.getByLabelText("Motivo / observação"), { target: { value: "Organização do depósito" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("move_filament_spool", expect.objectContaining({ p_spool_id: spoolId, p_location: expect.objectContaining({ location_label: "Estante 2" }) })));
  });
});
