import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelPricingPanel, type ChannelPricingPanelState, type ChannelPricingSelection } from "./ChannelPricingPanel";
import { channelAssumptionKeys, type ChannelAssumptions, type ChannelKey, type ChannelPolicy, type ProductChannelPrice } from "@/lib/channel-policy";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), tenant: "tenant-1", user: "user-1", policies: {} as Partial<Record<ChannelKey, ChannelPolicy>>, history: [] as ProductChannelPrice[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
const assumptions: ChannelAssumptions = { commission_percent: 10, tax_percent: 5, fixed_fee_per_order: 4, fixed_fee_per_item: 0,
  seller_shipping_per_order: 12, advertising_per_order: 2, other_cost_per_order: 0, target_margin: 20 };
const labels: Record<keyof ChannelAssumptions, string> = {
  commission_percent: "Comissão sobre produtos (%)", tax_percent: "Tributo sobre produtos (%)", fixed_fee_per_order: "Tarifa fixa por pedido (R$)",
  fixed_fee_per_item: "Tarifa fixa por unidade (R$)", seller_shipping_per_order: "Frete próprio do pacote (R$)", advertising_per_order: "Anúncios atribuídos ao pedido (R$)",
  other_cost_per_order: "Outros gastos do pedido (R$)", target_margin: "Margem desejada neste canal (%)",
};
const channel: ChannelKey = "mercado_livre";
function policy(values: ChannelAssumptions = assumptions, revision = "policy-r1"): ChannelPolicy { return { channel, configured: true, revision, assumptions: { ...values } }; }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }
const choose = () => change("Canal de venda", channel);
const latest = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as ChannelPricingSelection | undefined;
const saveButton = () => screen.getByRole("button", { name: /^(Salvar condições deste canal na empresa|Confirmar salvamento das condições)$/ });
function amount(label: string) { return within(screen.getByTestId("channel-pricing-result")).getByText(label, { exact: true }).parentElement!.querySelector("dd")!.textContent; }
function mount(options: { unitCost?: number | null; savedState?: ChannelPricingPanelState | null; onStateChange?: (value: ChannelPricingPanelState) => void; productId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const selected = vi.fn(), busy = vi.fn();
  const ui = () => <QueryClientProvider client={client}><ChannelPricingPanel productId={options.productId} unitCost={options.unitCost === undefined ? 10 : options.unitCost} savedState={options.savedState} onStateChange={options.onStateChange} onSelection={selected} onBusy={busy} /></QueryClientProvider>;
  const view = render(ui());
  return { ...view, client, selected, busy, rerenderSession: () => view.rerender(ui()) };
}
beforeEach(() => {
  mock.tenant = "tenant-1"; mock.user = "user-1"; mock.policies = { mercado_livre: policy() }; mock.history = [];
  const requests = new Map<string, string>();
  mock.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "product_channel_price_catalog") return { data: structuredClone(mock.history), error: null };
    const key = args.p_channel as ChannelKey;
    if (name === "channel_pricing_policy") return { data: structuredClone(mock.policies[key] ?? { channel: key, configured: false, revision: "empty-r1", assumptions: Object.fromEntries(channelAssumptionKeys.map(field => [field, null])) }), error: null };
    if (name === "save_channel_pricing_policy") {
      const requestId = String(args.p_request_id);
      if (requests.has(requestId)) return { data: requests.get(requestId), error: null };
      const current = mock.policies[key];
      if (args.p_expected_revision !== (current?.revision ?? "empty-r1")) return { data: null, error: { message: "As condições do canal mudaram. Atualize antes de salvar." } };
      mock.policies[key] = { channel: key, configured: true, revision: "policy-r2", assumptions: structuredClone(args.p_assumptions as ChannelAssumptions) };
      requests.set(requestId, "saved-policy");
      return { data: "saved-policy", error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
});

describe("ChannelPricingPanel", () => {
  const accepted: ProductChannelPrice = { channel, acceptance_id: "accepted-1", unit_price: 35, unit_cost: 9, quantity: 3,
    assumptions: { ...assumptions, commission_percent: 12, seller_shipping_per_order: 4 }, cost_revision: "cost-old", policy_revision: "policy-r1", updated_at: "2026-11-02T13:00:00Z" };
  it("reads the last accepted prices and reopens the product's actual conditions instead of replacing them with company defaults", async () => {
    mock.history = [accepted];
    const { selected } = mount({ productId: "product-1" });
    const reopen = await screen.findByRole("button", { name: "Conferir preço de Mercado Livre" });
    expect(mock.rpc).toHaveBeenCalledWith("product_channel_price_catalog", { p_product_id: "product-1" });
    expect(screen.getByLabelText("Preços salvos por canal")).toHaveTextContent(/35,00.*pedido de 3 un/);
    expect(screen.getByLabelText("Canal de venda")).toHaveValue("factory");
    fireEvent.click(reopen);
    await waitFor(() => expect(latest(selected)?.catalogDraft).toMatchObject({ channel, quantity: 3, unit_price: 35, quoted_unit_cost: 10,
      expected_policy_revision: "policy-r1", assumptions: { commission_percent: 12, seller_shipping_per_order: 4 } }));
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("12");
    expect(screen.getByLabelText(labels.seller_shipping_per_order, { exact: true })).toHaveValue("4");
    expect(screen.getByLabelText("Preço escolhido neste canal (R$)")).toHaveValue("35");
    expect(screen.getByLabelText("Unidades por pedido / pacote")).toHaveValue(3);
    expect(mock.rpc.mock.calls.some(([name]) => name === "save_channel_pricing_policy")).toBe(false);
  });
  it("keeps accepted product overrides pending after a company revision change and only confirms them after explicit review", async () => {
    mock.history = [accepted]; mock.policies.mercado_livre = policy({ ...assumptions, commission_percent: 20, seller_shipping_per_order: 10 }, "company-r2");
    const { selected } = mount({ productId: "product-1" });
    fireEvent.click(await screen.findByRole("button", { name: "Conferir preço de Mercado Livre" }));
    const keep = await screen.findByRole("button", { name: "Manter os ajustes deste produto" });
    expect(latest(selected)?.catalogDraft).toBeNull(); expect(screen.queryByTestId("channel-pricing-result")).not.toBeInTheDocument();
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("12");
    expect(screen.getByLabelText(labels.seller_shipping_per_order, { exact: true })).toHaveValue("4");
    fireEvent.click(keep);
    await waitFor(() => expect(latest(selected)?.catalogDraft).toMatchObject({ expected_policy_revision: "company-r2", unit_price: 35, quantity: 3,
      assumptions: accepted.assumptions }));
    expect(mock.policies.mercado_livre?.assumptions.commission_percent).toBe(20);
    expect(mock.rpc.mock.calls.some(([name]) => name === "save_channel_pricing_policy")).toBe(false);
  });
  it("hydrates the company's persisted assumptions and returns a stamped commercial selection without asking for them again", async () => {
    const { selected } = mount(); choose();
    await waitFor(() => expect(latest(selected)?.catalogDraft).toMatchObject({ channel, quoted_unit_cost: 10, expected_policy_revision: "policy-r1", quantity: 1, assumptions }));
    for (const key of channelAssumptionKeys) expect(screen.getByLabelText(labels[key], { exact: true })).toHaveValue(String(assumptions[key]));
    expect(screen.queryByText(/Complete as condições da sua conta/)).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(mock.rpc.mock.calls.every(([name]) => name === "channel_pricing_policy")).toBe(true);
  });

  it("charges fees and shipping once per order and computes the documented cost10/order3/target30 example", async () => {
    const { selected } = mount(); choose(); await screen.findByTestId("channel-pricing-result");
    change("Unidades por pedido / pacote", "3"); change("Preço escolhido neste canal (R$)", "30");
    await waitFor(() => expect(latest(selected)?.result).toMatchObject({ quantity: 3, revenue: 90, manufacturingCost: 30, commission: 9, tax: 4.5, fixedFee: 4, itemFees: 0, sellerShipping: 12, advertising: 2, includedResult: 28.5, suggested: 24.62 }));
    expect(amount("Resultado após custos informados")).toMatch(/28,50/);
    expect(screen.getByText(/Preço sugerido no canal/)).toHaveTextContent("24,62");
    expect(latest(selected)?.catalogDraft).toMatchObject({ quoted_unit_cost: 10, quantity: 3, unit_price: 30, expected_policy_revision: "policy-r1" });
  });

  it("scales per-item fees with quantity without multiplying order or shipping fees", async () => {
    const { selected } = mount(); choose(); await screen.findByTestId("channel-pricing-result");
    change("Tarifa fixa por unidade (R$)", "2"); change("Unidades por pedido / pacote", "3"); change("Preço escolhido neste canal (R$)", "30");
    await waitFor(() => expect(latest(selected)?.result).toMatchObject({ itemFees: 6, fixedFee: 4, sellerShipping: 12, includedResult: 22.5, suggested: 27.7 }));
    change("Unidades por pedido / pacote", "2");
    await waitFor(() => expect(latest(selected)?.result).toMatchObject({ quantity: 2, itemFees: 4, fixedFee: 4, sellerShipping: 12, manufacturingCost: 20 }));
  });

  it.each(channelAssumptionKeys)("keeps absent %s pending, accepts explicit zero and makes a cleared field pending again", async key => {
    mock.policies.mercado_livre = policy({ ...assumptions, [key]: null });
    const { selected } = mount(); choose();
    expect(await screen.findByText(new RegExp(`Confirme ${labels[key].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible();
    expect(latest(selected)?.catalogDraft).toBeNull(); expect(screen.queryByTestId("channel-pricing-result")).not.toBeInTheDocument();
    change(labels[key], "0");
    await waitFor(() => expect(latest(selected)?.result).not.toBeNull());
    expect(latest(selected)?.catalogDraft?.assumptions[key]).toBe(0);
    change(labels[key], "");
    await waitFor(() => expect(latest(selected)?.result).toBeNull());
    expect(latest(selected)?.catalogDraft).toBeNull();
  });

  it("saves all assumptions with the expected revision and retries the same id after a lost committed response", async () => {
    const original = mock.rpc.getMockImplementation()!; let lost = true;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      const response = await original(name, args);
      if (name === "save_channel_pricing_policy" && lost) { lost = false; throw new Error("Conexão perdida após salvar"); }
      return response;
    });
    const { selected } = mount(); choose(); await screen.findByTestId("channel-pricing-result");
    change(labels.commission_percent, "12,5"); fireEvent.click(saveButton());
    expect(await screen.findByText("Conexão perdida após salvar")).toBeVisible();
    await waitFor(() => expect(latest(selected)?.catalogDraft).toBeNull());
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("12,5");
    fireEvent.click(saveButton()); await screen.findByText("Condições salvas para reutilizar neste canal.");
    const calls = mock.rpc.mock.calls.filter(([name]) => name === "save_channel_pricing_policy");
    expect(calls).toHaveLength(2); expect(calls[1][1]).toEqual(calls[0][1]);
    expect(calls[0][1]).toMatchObject({ p_channel: channel, p_expected_revision: "policy-r1", p_assumptions: { ...assumptions, commission_percent: 12.5 } });
    await waitFor(() => expect(latest(selected)?.catalogDraft).toMatchObject({ expected_policy_revision: "policy-r2", quoted_unit_cost: 10 }));
    expect(saveButton()).toBeDisabled();
  });

  it("invalidates the quote when another operation updates the policy and requires explicit reload", async () => {
    const { client, selected } = mount(); choose(); await screen.findByTestId("channel-pricing-result");
    change(labels.commission_percent, "12");
    await act(async () => { client.setQueryData(["channel_pricing_policy", mock.tenant, channel], policy({ ...assumptions, commission_percent: 15 }, "remote-r2")); });
    await waitFor(() => expect(latest(selected)?.catalogDraft).toBeNull());
    expect(saveButton()).toBeDisabled();
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("12");
    fireEvent.click(screen.getByRole("button", { name: "Carregar condições atualizadas" }));
    await waitFor(() => expect(latest(selected)?.catalogDraft).toMatchObject({ expected_policy_revision: "remote-r2", assumptions: { commission_percent: 15 } }));
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("15");
  });

  it("keeps a real server revision conflict pending until the operator explicitly loads the newer policy", async () => {
    const { selected } = mount(); choose(); await screen.findByTestId("channel-pricing-result");
    change(labels.commission_percent, "12");
    mock.policies.mercado_livre = policy({ ...assumptions, commission_percent: 15 }, "remote-r2");
    fireEvent.click(saveButton());
    await screen.findByText("As condições do canal mudaram. Atualize antes de salvar.");
    await waitFor(() => expect(latest(selected)?.catalogDraft).toBeNull());
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("12");
    expect(screen.queryByTestId("channel-pricing-result")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Carregar condições atualizadas" }));
    await waitFor(() => expect(latest(selected)?.catalogDraft).toMatchObject({ expected_policy_revision: "remote-r2", assumptions: { commission_percent: 15 } }));
    expect(mock.rpc.mock.calls.filter(([name]) => name === "save_channel_pricing_policy")).toHaveLength(1);
  });

  it("allows an incomplete company policy to be saved and preserves its pending fields when the panel unmounts and returns", async () => {
    mock.policies.mercado_livre = policy(Object.fromEntries(channelAssumptionKeys.map(key => [key, null])) as ChannelAssumptions);
    let savedState: ChannelPricingPanelState | null = null;
    const first = mount({ onStateChange: state => { savedState = state; } }); choose();
    await waitFor(() => expect(screen.getByLabelText(labels.commission_percent, { exact: true })).not.toBeDisabled());
    change(labels.commission_percent, "10"); change("Unidades por pedido / pacote", "3");
    fireEvent.click(saveButton()); await screen.findByText("Condições salvas para reutilizar neste canal.");
    expect(mock.policies.mercado_livre?.assumptions).toMatchObject({ commission_percent: 10, tax_percent: null, fixed_fee_per_item: null });
    expect(latest(first.selected)?.catalogDraft).toBeNull();
    expect(savedState).toMatchObject({ channel, quantity: "3", revision: "policy-r2", dirty: false });
    first.unmount();
    const second = mount({ savedState });
    await waitFor(() => expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("10"));
    expect(screen.getByLabelText(labels.tax_percent, { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Unidades por pedido / pacote")).toHaveValue(3);
    await waitFor(() => expect(latest(second.selected)?.catalogDraft).toBeNull());
    expect(screen.queryByTestId("channel-pricing-result")).not.toBeInTheDocument();
  });

  it("restores unsaved incomplete conditions across a pricing-mode toggle without replacing them with the company defaults", async () => {
    mock.policies.mercado_livre = policy(Object.fromEntries(channelAssumptionKeys.map(key => [key, null])) as ChannelAssumptions);
    let state: ChannelPricingPanelState | null = null;
    const first = mount({ onStateChange: value => { state = value; } }); choose();
    await waitFor(() => expect(screen.getByLabelText(labels.commission_percent, { exact: true })).not.toBeDisabled());
    change(labels.commission_percent, "12,5"); change("Unidades por pedido / pacote", "3"); change("Preço escolhido neste canal (R$)", "30");
    await waitFor(() => expect(state).toMatchObject({ dirty: true, quantity: "3", target: "30", values: { commission_percent: "12,5", tax_percent: "" } }));
    first.unmount(); const second = mount({ savedState: state });
    await waitFor(() => expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toHaveValue("12,5"));
    expect(screen.getByLabelText(labels.tax_percent, { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Unidades por pedido / pacote")).toHaveValue(3);
    expect(screen.getByLabelText("Preço escolhido neste canal (R$)")).toHaveValue("30");
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    expect(latest(second.selected)?.catalogDraft).toBeNull();
    expect(mock.rpc.mock.calls.every(([name]) => name === "channel_pricing_policy")).toBe(true);
  });

  it("reports a pending company write and disables edits until the save and revision confirmation finish", async () => {
    let resolve!: () => void;
    const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "save_channel_pricing_policy") await new Promise<void>(done => { resolve = done; });
      return original(name, args);
    });
    const { busy } = mount(); choose(); await screen.findByTestId("channel-pricing-result");
    change(labels.commission_percent, "12"); fireEvent.click(saveButton());
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(true));
    expect(screen.getByLabelText("Canal de venda")).toBeDisabled();
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).toBeDisabled(); expect(saveButton()).toBeDisabled();
    await act(async () => { resolve(); }); await screen.findByText("Condições salvas para reutilizar neste canal.");
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText(labels.commission_percent, { exact: true })).not.toBeDisabled();
  });

  it("resets the channel draft when the authenticated tenant or user changes", async () => {
    const session = mount(); choose(); await screen.findByTestId("channel-pricing-result"); change(labels.commission_percent, "12");
    mock.user = "user-2"; session.rerenderSession();
    await waitFor(() => expect(screen.getByLabelText("Canal de venda")).toHaveValue("factory"));
    expect(latest(session.selected)).toMatchObject({ channel: "factory", result: null, catalogDraft: null });
    choose(); await screen.findByTestId("channel-pricing-result"); mock.tenant = "tenant-2"; session.rerenderSession();
    await waitFor(() => expect(screen.getByLabelText("Canal de venda")).toHaveValue("factory"));
  });

  it("does not restore a previous user's saved state after a session change", async () => {
    let state: ChannelPricingPanelState | null = null;
    const first = mount({ onStateChange: value => { state = value; } }); choose(); await screen.findByTestId("channel-pricing-result");
    change(labels.commission_percent, "12"); change("Unidades por pedido / pacote", "3");
    await waitFor(() => expect(state).toMatchObject({ scope: "tenant-1:user-1", quantity: "3", values: { commission_percent: "12" } }));
    first.unmount(); mock.user = "user-2";
    const second = mount({ savedState: state });
    expect(screen.getByLabelText("Canal de venda")).toHaveValue("factory");
    expect(screen.queryByLabelText(labels.commission_percent)).not.toBeInTheDocument();
    expect(latest(second.selected)).toMatchObject({ channel: "factory", catalogDraft: null });
  });

  it("allows a confirmed zero manufacturing cost and blocks unknown cost while retaining the selected channel", async () => {
    const known = mount({ unitCost: 0 }); choose(); await screen.findByTestId("channel-pricing-result");
    expect(latest(known.selected)?.catalogDraft?.quoted_unit_cost).toBe(0); known.unmount();
    const pending = mount({ unitCost: null }); choose();
    await screen.findByText("Conclua o custo do produto antes de calcular a venda neste canal.");
    expect(screen.getByLabelText("Canal de venda")).toHaveValue(channel);
    expect(latest(pending.selected)?.result).toBeNull(); expect(latest(pending.selected)?.catalogDraft).toBeNull();
  });
});
