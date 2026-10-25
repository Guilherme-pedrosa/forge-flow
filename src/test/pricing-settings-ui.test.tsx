import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PricingSettings from "@/pages/configuracoes/Precificacao";
import { emptyPricingPolicyDraft, pricingPolicyPayload, type PricingPolicy } from "@/lib/pricing-policy";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), printersError: false, policy: null as unknown as Record<string, unknown> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "printer", name: "Bambina", power_watts: 150, is_active: true }], error: mock.printersError ? { message: "Offline" } : null }).then(resolve) };
  return query;
} } }));
function RouteProof() { const location = useLocation(); return <div data-testid="route">{location.pathname}</div>; }
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><PricingSettings /><RouteProof /></QueryClientProvider></MemoryRouter>);
  return client;
};
beforeEach(() => {
  vi.clearAllMocks(); mock.printersError = false;
  mock.policy = { ...pricingPolicyPayload(emptyPricingPolicyDraft()), revision: "r1", machine_rate_scope: "commercial_excludes_energy" };
  mock.rpc.mockImplementation(async (name: string, args: { p_settings: unknown }) => {
    if (name === "pricing_settings") return { data: mock.policy, error: null };
    mock.policy = { ...mock.policy, ...args.p_settings as object, revision: "r2" };
    return { data: "saved", error: null };
  });
});
afterEach(cleanup);
describe("configurable pricing tariffs", () => {
  it("saves edited tariffs before opening the product calculator", async () => {
    mount(); const machine = await screen.findByLabelText("Hora da máquina padrão (R$/h)");
    fireEvent.change(machine, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar e precificar" }));
    await waitFor(() => expect(screen.getByTestId("route")).toHaveTextContent("/comercial/precificacao"));
    expect(mock.rpc).toHaveBeenCalledWith("save_pricing_settings", expect.objectContaining({ p_settings: expect.objectContaining({ machine_hour_cost: 3 }) }));
  });
  it("loads missing values as blank and writes only after the user saves", async () => {
    mount(); const machine = await screen.findByLabelText("Hora da máquina padrão (R$/h)");
    expect(machine).toHaveValue(""); expect(screen.getByLabelText("Margem desejada sobre a venda (%)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Salvar parâmetros" })).toBeDisabled();
    fireEvent.change(machine, { target: { value: "2,50" } });
    fireEvent.change(screen.getByLabelText("Energia elétrica (R$/kWh)"), { target: { value: "0" } });
    expect(mock.rpc.mock.calls.filter(([name]) => name === "save_pricing_settings")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_pricing_settings", expect.objectContaining({ p_expected_revision: "r1", p_settings: expect.objectContaining({ machine_hour_cost: 2.5, energy_cost_kwh: 0, target_margin: null, printer_hour_costs: [] }) })));
    await waitFor(() => expect(machine).toHaveValue("2,5"));
  });
  it("does not replace unsaved edits when another session changes the tariffs", async () => {
    const client = mount(); const machine = await screen.findByLabelText("Hora da máquina padrão (R$/h)");
    fireEvent.change(machine, { target: { value: "4,50" } });
    client.setQueryData(["pricing_settings", "tenant"], { ...mock.policy, revision: "r3", machine_hour_cost: 99 } as PricingPolicy);
    await waitFor(() => expect(machine).toHaveValue("4,50"));
    mock.rpc.mockImplementation(async name => name === "pricing_settings" ? { data: mock.policy, error: null } : { data: null, error: { message: "Os parâmetros mudaram. Atualize a página." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    await screen.findByText("Os parâmetros mudaram. Atualize a página.");
    expect(mock.rpc).toHaveBeenCalledWith("save_pricing_settings", expect.objectContaining({ p_expected_revision: "r1" }));
    expect(machine).toHaveValue("4,50");
  });
  it("keeps the same request on an uncertain save and preserves printer-specific zero", async () => {
    mount(); await screen.findByText("Bambina");
    fireEvent.change(screen.getByLabelText("Hora da máquina (R$/h)"), { target: { value: "0" } });
    let attempts = 0; mock.rpc.mockImplementation(async (name, args) => {
      if (name === "pricing_settings") return { data: mock.policy, error: null };
      if (++attempts === 1) return { data: null, error: { message: "Resposta interrompida" } };
      mock.policy = { ...mock.policy, ...args.p_settings, revision: "r2" }; return { data: "saved", error: null };
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" })); await screen.findByText("Resposta interrompida");
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Custos e precificação salvos" })));
    const calls = mock.rpc.mock.calls.filter(([name]) => name === "save_pricing_settings");
    expect(calls).toHaveLength(2); expect(calls[0][1]).toEqual(calls[1][1]);
    expect(calls[1][1].p_settings.printer_hour_costs).toEqual([{ printer_id: "printer", hour_cost: 0 }]);
  });
});
