import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MercadoLivrePublicationPolicy } from "./MercadoLivrePublicationPolicy";
import type { ChannelPolicy } from "@/lib/channel-policy";
const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), company: vi.fn(), tenant: "tenant-a", user: "operator-a" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/lib/channel-policy", () => ({ readChannelPolicy: mock.read, saveChannelPolicy: mock.save }));
vi.mock("@/lib/pricing-policy", async original => ({ ...await original<typeof import("@/lib/pricing-policy")>(), readPricingSettings: mock.company }));
vi.mock("@/components/comercial/InlinePricingPolicy", () => ({ InlinePricingPolicy: ({ missingKeys }: { missingKeys: string[] }) => {
  const client = useQueryClient(); return <section aria-label="Custos de produção em contexto">{missingKeys.join(",")}<button onClick={() => client.setQueryData(["pricing_settings", mock.tenant], (old: Record<string, unknown>) => ({ ...old, revision: "company-r2", assembly_minutes_per_product: 0, finishing_minutes_per_piece: 0, extras_cost_per_product: 0 }))}>Confirmar padrões de produção</button></section>;
} }));
const initial = (): ChannelPolicy => ({ channel: "mercado_livre", configured: false, revision: "policy-r1", assumptions: { commission_percent: null, tax_percent: null, fixed_fee_per_order: 7, fixed_fee_per_item: null, seller_shipping_per_order: null, advertising_per_order: null, other_cost_per_order: null, target_margin: null } });
const company = () => ({ revision: "company-r1", machine_rate_scope: "commercial_excludes_energy", printer_hour_costs: [], machine_hour_cost: null, labor_cost_hour: 25, energy_cost_kwh: 1.14, target_margin: 50, handling_minutes_per_plate: 5, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0, overhead_percent: 3 });
let current = initial();
beforeEach(() => { mock.tenant = "tenant-a"; mock.user = "operator-a"; current = initial(); mock.read.mockReset().mockImplementation(async () => structuredClone(current)); mock.company.mockReset().mockImplementation(async () => company()); mock.save.mockReset().mockImplementation(async (_channel, assumptions) => { current = { ...current, configured: true, revision: "policy-r2", assumptions }; return "saved"; }); });
afterEach(cleanup);
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), saved = vi.fn(), busy = vi.fn(), dirty = vi.fn(); const ui = () => <QueryClientProvider client={client}><MercadoLivrePublicationPolicy onSaved={saved} onBusyChange={busy} onDirtyChange={dirty} /></QueryClientProvider>; const view = render(ui()); return { ...view, client, saved, busy, dirty, changeScope: () => view.rerender(ui()) }; }
async function ready() { await waitFor(() => expect(screen.getByLabelText("Provisão de tributos (%)")).toBeEnabled()); }
function fill() { for (const [label, value] of [["Provisão de tributos (%)", "0"], ["Margem desejada (%)", "25"], ["Publicidade por pedido (R$)", "0"], ["Outros gastos por pedido (R$)", "2"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
describe("company costs are confirmed inside publication without manual marketplace tariffs", () => {
  it("keeps unknown values blank and saves only four explicit company choices while preserving the official-rate fields", async () => {
    const view = mount(); await ready(); expect(screen.getByLabelText("Provisão de tributos (%)")).toHaveValue(""); expect(screen.queryByLabelText(/Comissão|Tarifa fixa|Frete próprio/)).not.toBeInTheDocument(); expect(mock.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Usar margem da empresa (50%)" })); expect(screen.getByLabelText("Margem desejada (%)")).toHaveValue("50"); expect(mock.save).not.toHaveBeenCalled(); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar condições da empresa" }));
    await screen.findByText(/Condições salvas/); expect(mock.save).toHaveBeenCalledWith("mercado_livre", { ...initial().assumptions, tax_percent: 0, target_margin: 25, advertising_per_order: 0, other_cost_per_order: 2 }, "policy-r1", expect.any(String)); expect(view.saved).toHaveBeenCalledOnce();
  });
  it("shows only missing production defaults in context and recalculates after their confirmed revision", async () => {
    mock.company.mockResolvedValue({ ...company(), finishing_minutes_per_piece: null, assembly_minutes_per_product: null, extras_cost_per_product: null }); const view = mount(); const inline = await screen.findByRole("region", { name: "Custos de produção em contexto" }); expect(inline).toHaveTextContent("finishing_minutes_per_piece,assembly_minutes_per_product,extras_cost_per_product"); fireEvent.click(screen.getByRole("button", { name: "Confirmar padrões de produção" })); await waitFor(() => expect(view.saved).toHaveBeenCalledOnce()); expect(mock.save).not.toHaveBeenCalled();
  });
  it("retries a lost save response with the same revision and request instead of inventing values or duplicating the intent", async () => {
    mock.save.mockImplementationOnce(async (_channel, assumptions) => { current = { ...current, configured: true, revision: "policy-r2", assumptions }; throw new Error("Resposta perdida após salvar"); }); mount(); await ready(); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar condições da empresa" })); await screen.findByText("Resposta perdida após salvar"); await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2)); fireEvent.click(screen.getByRole("button", { name: "Confirmar salvamento das condições" })); await screen.findByText(/Condições salvas/); expect(mock.save).toHaveBeenCalledTimes(2); expect(mock.save.mock.calls[1]).toEqual(mock.save.mock.calls[0]);
  });
  it("does not read or update another session after a deferred save finishes", async () => {
    let resolve!: (value: string) => void; mock.save.mockReturnValueOnce(new Promise(done => { resolve = done; })); const view = mount(); await ready(); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar condições da empresa" })); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); mock.tenant = "tenant-b"; mock.user = "operator-b"; view.changeScope(); await ready(); const reads = mock.read.mock.calls.length; await act(async () => { resolve("saved"); }); expect(mock.read).toHaveBeenCalledTimes(reads); expect(view.saved).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(false);
  });
});
