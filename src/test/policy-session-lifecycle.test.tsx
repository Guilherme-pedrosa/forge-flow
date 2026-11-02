import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlinePricingPolicy } from "@/components/comercial/InlinePricingPolicy";
import { ChannelPricingPanel } from "@/components/comercial/ChannelPricingPanel";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), tenant: "tenant-a", user: "user-a", calls: [] as { name: string; tenant: string; user: string }[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const assumptions = { commission_percent: 10, tax_percent: 5, fixed_fee_per_order: 4, fixed_fee_per_item: 0,
  seller_shipping_per_order: 12, advertising_per_order: 2, other_cost_per_order: 0, target_margin: 20 };
const manufacturing = (scope = mock.tenant) => ({ revision: `${scope}-revision`, machine_rate_scope: "commercial_excludes_energy" as const,
  machine_hour_cost: 2, labor_cost_hour: 20, energy_cost_kwh: scope === "tenant-a" ? 1 : 999, target_margin: 50,
  handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  overhead_percent: 0, printer_hour_costs: [] });
const channel = (scope = mock.tenant) => ({ channel: "mercado_livre" as const, configured: true, revision: `${scope}-channel-revision`,
  assumptions: { ...assumptions, commission_percent: scope === "tenant-a" ? 10 : 77, target_margin: 0 } });
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function mount(kind: "manufacturing" | "channel") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(["pricing_settings", "tenant-a"], manufacturing("tenant-a"));
  const ui = () => <QueryClientProvider client={client}>{kind === "manufacturing"
    ? <InlinePricingPolicy key={`${mock.tenant}:${mock.user}`} policy={manufacturing()} missingKeys={["finishing_minutes_per_piece"]} />
    : <ChannelPricingPanel unitCost={10} />}</QueryClientProvider>;
  const view = render(ui());
  return { ...view, client, remountScope: () => { mock.tenant = "tenant-b"; mock.user = "user-b"; view.rerender(ui()); } };
}
async function finish(write: ReturnType<typeof deferred>, value: unknown) {
  await act(async () => { write.resolve(value); await new Promise(done => setTimeout(done, 0)); });
}
function manufacturingSave() {
  fireEvent.change(screen.getByLabelText("Acabamento padrão por peça (min)", { exact: true }), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
}
async function channelSave() {
  fireEvent.change(screen.getByLabelText("Canal de venda"), { target: { value: "mercado_livre" } });
  await screen.findByTestId("channel-pricing-result");
  fireEvent.change(screen.getByLabelText("Comissão sobre produtos (%)", { exact: true }), { target: { value: "11" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar condições deste canal na empresa" }));
}
beforeEach(() => { mock.tenant = "tenant-a"; mock.user = "user-a"; mock.calls = []; mock.rpc.mockReset(); });
afterEach(cleanup);

describe("policy promises remain scoped to their mounted authentication session", () => {
  it("does not read with the new session or cache it under the previous tenant after a manufacturing write", async () => {
    const write = deferred();
    mock.rpc.mockImplementation((name: string) => { mock.calls.push({ name, tenant: mock.tenant, user: mock.user });
      return name === "save_pricing_settings" ? write.promise : Promise.resolve({ data: manufacturing(), error: null }); });
    const view = mount("manufacturing"); manufacturingSave();
    await waitFor(() => expect(mock.calls.some(call => call.name === "save_pricing_settings")).toBe(true));
    view.remountScope(); await finish(write, { data: "saved-old-tenant", error: null });
    expect(view.client.getQueryData(["pricing_settings", "tenant-a"])).toEqual(manufacturing("tenant-a"));
    expect(mock.calls.some(call => call.name === "pricing_settings")).toBe(false);
    expect(screen.queryByText(/Parâmetros salvos/)).not.toBeInTheDocument();
  });
  it("does not make a secondary channel read after a pending write outlives the keyed session", async () => {
    const write = deferred();
    mock.rpc.mockImplementation((name: string) => { mock.calls.push({ name, tenant: mock.tenant, user: mock.user });
      return name === "save_channel_pricing_policy" ? write.promise : Promise.resolve({ data: channel(), error: null }); });
    const view = mount("channel"); await channelSave();
    await waitFor(() => expect(mock.calls.some(call => call.name === "save_channel_pricing_policy")).toBe(true));
    view.remountScope(); await finish(write, { data: "saved-old-tenant", error: null });
    await waitFor(() => expect(view.client.getMutationCache().getAll()[0].state.status).toBe("success"));
    expect(view.client.getQueryData(["channel_pricing_policy", "tenant-a", "mercado_livre"])).toEqual(channel("tenant-a"));
    expect(mock.calls.some(call => call.tenant === "tenant-b")).toBe(false);
  });
  it("does not refetch the previous tenant's channel query when an old write rejects after unmount", async () => {
    const write = deferred();
    mock.rpc.mockImplementation((name: string) => { mock.calls.push({ name, tenant: mock.tenant, user: mock.user });
      return name === "save_channel_pricing_policy" ? write.promise : Promise.resolve({ data: channel(), error: null }); });
    const view = mount("channel"); await channelSave();
    await waitFor(() => expect(mock.calls.some(call => call.name === "save_channel_pricing_policy")).toBe(true));
    view.remountScope(); await finish(write, { data: null, error: { message: "Old save rejected" } });
    await waitFor(() => expect(view.client.getMutationCache().getAll()[0].state.status).toBe("error"));
    expect(view.client.getQueryData(["channel_pricing_policy", "tenant-a", "mercado_livre"])).toEqual(channel("tenant-a"));
    expect(mock.calls.some(call => call.tenant === "tenant-b")).toBe(false);
  });
  it("does not recreate a cleared old-session cache when a manual refresh resolves after unmount", async () => {
    const read = deferred();
    mock.rpc.mockImplementation((name: string) => { mock.calls.push({ name, tenant: mock.tenant, user: mock.user });
      return name === "save_pricing_settings" ? Promise.resolve({ data: null, error: { message: "Conflict" } }) : read.promise; });
    const view = mount("manufacturing"); manufacturingSave(); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar parâmetros e manter meus valores" }));
    await waitFor(() => expect(mock.calls.some(call => call.name === "pricing_settings")).toBe(true));
    view.unmount(); view.client.clear(); mock.tenant = "tenant-b"; mock.user = "user-b";
    await finish(read, { data: manufacturing("tenant-a"), error: null });
    expect(view.client.getQueryData(["pricing_settings", "tenant-a"])).toBeUndefined();
  });
});
