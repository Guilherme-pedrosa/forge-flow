import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Precificacao from "@/pages/comercial/Precificacao";

const mock = vi.hoisted(() => ({ navigate: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("react-router-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-router-dom")>(), useNavigate: () => mock.navigate }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/components/shared/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({
  SearchableItemSelect: ({ value, options, onChange, label }: {
    value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; label: string;
  }) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));

const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mount = () => { const view = render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><Precificacao /></MemoryRouter>
  </QueryClientProvider>,
); fireEvent.click(screen.getByRole("button", { name: "Simulação livre" })); return view; };
const factory = () => {
  set("Nome do produto", "Kit de três placas");
  set("Unidades prontas no lote", "10");
  set("Gramas no lote", "1000");
  set("Custo / kg (R$)", "100");
  set("Despesas indiretas (%)", "0");
  set("Margem desejada sobre a venda (%)", "30");
};
const commercialOrder = async () => {
  set("Canal de venda", "mercado_livre");
  await waitFor(() => expect(screen.getByLabelText("Comissão sobre produtos (%)")).toHaveValue("0"));
  set("Unidades por pedido / pacote", "3");
  set("Comissão sobre produtos (%)", "10");
  set("Tributo sobre produtos (%)", "5");
  set("Tarifa fixa por pedido (R$)", "4");
  set("Frete próprio do pacote (R$)", "12");
  set("Anúncios atribuídos ao pedido (R$)", "2");
  set("Preço escolhido neste canal (R$)", "30");
};
const amount = (label: string) => {
  const panel = within(screen.getByTestId("channel-pricing-result"));
  return panel.getByText(label).closest("div")!.querySelector("dd")!.textContent;
};

beforeEach(() => {
  mock.navigate.mockReset(); mock.from.mockReset(); mock.rpc.mockReset();
  mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "channel_pricing_policy" ? { data: { channel: args.p_channel, configured: true, revision: "channel-r1", assumptions: { commission_percent: 0, tax_percent: 0, fixed_fee_per_order: 0, fixed_fee_per_item: 0, seller_shipping_per_order: 0, advertising_per_order: 0, other_cost_per_order: 0, target_margin: 30 } }, error: null } : { data: { energy_cost_kwh: 0, machine_hour_cost: 0, labor_cost_hour: 0, overhead_percent: 0, target_margin: 30, printer_hour_costs: [], revision: "settings-1" }, error: null });
  mock.from.mockImplementation((table: string) => {
    const data = table === "products" ? [{ id: "product-1", name: "Kit", sku: "KIT" }] : table === "printers" ? [{ id: "printer-1", name: "A1", model: "A1", power_watts: 200, depreciation_per_hour: 99, maintenance_cost_per_hour: 50 }] : [];
    const result = Promise.resolve({ data, error: null });
    const builder = {
      select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
      range: () => result, single: () => Promise.resolve({ data: { settings: null }, error: null }),
    };
    return builder;
  });
});
afterEach(cleanup);

describe("channel simulation in the existing manufacturing calculator", () => {
  it("loads configured rates and keeps the selected printer visible without adding legacy depreciation to the commercial rate", async () => {
    mount();
    await screen.findByRole("option", { name: "A1" });
    set("Modelo de referência", "printer-1");
    expect(screen.getByLabelText("Modelo de referência")).toHaveValue("printer-1");
    expect(screen.getByLabelText("Potência média (W)")).toHaveValue("200");
    expect(screen.getByLabelText("Hora-máquina sem energia (R$ / h)")).toHaveValue("0");
    expect(screen.getByLabelText("Energia (R$ / kWh)")).toHaveValue("0");
  });
  it("preserves the manufacturing transfer when commercial simulation is off", () => {
    mount(); factory();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto e orçar" }));
    expect(mock.navigate).toHaveBeenCalledWith("/comercial/produtos", {
      state: { pricing: { name: "Kit de três placas", cost: 10, price: 14.29, quantity: 10, quote: true } },
    });
    expect(mock.rpc.mock.calls.filter(([name]) => name !== "pricing_settings")).toHaveLength(0);
  });

  it("loads explicitly confirmed zero fees from the saved Mercado Livre and Shopee policies", async () => {
    mount(); factory(); set("Canal de venda", "mercado_livre");
    await waitFor(() => expect(screen.getByLabelText("Comissão sobre produtos (%)")).toHaveValue("0"));
    for (const label of ["Comissão sobre produtos (%)", "Tributo sobre produtos (%)", "Tarifa fixa por pedido (R$)",
      "Frete próprio do pacote (R$)", "Anúncios atribuídos ao pedido (R$)", "Outros gastos do pedido (R$)"]) {
      expect(screen.getByLabelText(label)).toHaveValue("0");
    }
    expect(amount("Comissão")).toBe(brl(0));
    set("Canal de venda", "shopee");
    await waitFor(() => expect(amount("Tributo parametrizado")).toBe(brl(0)));
    expect(mock.rpc).toHaveBeenCalledWith("channel_pricing_policy", { p_channel: "shopee" });
  });

  it("counts expenses once for the package, distinguishes contribution and transfers its price and quantity", async () => {
    mount(); factory(); await commercialOrder();
    expect(amount("Receita de produtos · pedido")).toBe(brl(90));
    expect(amount("Custo fabril · pedido")).toBe(brl(30));
    expect(amount("Comissão")).toBe(brl(9));
    expect(amount("Tributo parametrizado")).toBe(brl(4.5));
    expect(amount("Frete próprio")).toBe(brl(12));
    expect(screen.getByText(/Resultado após custos informados/)).toHaveTextContent(/R\$\s28,50/);
    expect(screen.getByText(/Contribuição estimada:/)).toHaveTextContent(/R\$\s28,50/);
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto com estes valores" }));
    expect(mock.navigate).toHaveBeenCalledWith("/comercial/produtos", {
      state: { pricing: { name: "Kit de três placas", cost: 10, price: 14.29, quotePrice: 30, quantity: 3, quote: false,
        channelPricing: { channel: "mercado_livre", quantity: 3, quoted_unit_cost: 10, expected_policy_revision: "channel-r1", unit_price: 30,
          assumptions: { commission_percent: 10, tax_percent: 5, fixed_fee_per_order: 4, fixed_fee_per_item: 0, seller_shipping_per_order: 12, advertising_per_order: 2, other_cost_per_order: 0, target_margin: 30 } } } },
    });
    await screen.findByRole("option", { name: "Kit" });
    set("Produto para orçamento", "product-1");
    fireEvent.click(screen.getByRole("button", { name: "Usar preço no novo orçamento" }));
    expect(mock.navigate).toHaveBeenLastCalledWith("/comercial/orcamentos", {
      state: { pricingQuote: { product_id: "product-1", quantity: 3, unit_price: 30 } },
    });
    expect(mock.rpc.mock.calls.filter(([name]) => !["pricing_settings", "channel_pricing_policy"].includes(name))).toHaveLength(0);
  });

  it("blocks all price transfers for invalid percentages and restores the manufacturing mode", async () => {
    mount(); factory(); await commercialOrder(); set("Comissão sobre produtos (%)", "65");
    expect(screen.getByRole("alert")).toHaveTextContent(/devem somar menos de 100%/);
    expect(screen.queryByTestId("channel-pricing-result")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cadastrar produto com estes valores" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cadastrar produto e orçar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto e orçar" }));
    expect(mock.navigate).not.toHaveBeenCalled();
    set("Canal de venda", "factory");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cadastrar produto e orçar" })).toBeEnabled();
  });

  it("identifies a below-cost target without presenting the estimate as profit or marketplace payout", async () => {
    mount(); factory(); await commercialOrder(); set("Preço escolhido neste canal (R$)", "5");
    expect(screen.getByRole("status")).toHaveTextContent("O preço alvo não cobre os custos informados.");
    expect(screen.getByText(/Resultado e contribuição não são lucro líquido nem repasse/)).toBeInTheDocument();
  });
  it("preserves the factory target while choosing another channel price and restores it on returning to base pricing", async () => {
    mount(); factory(); set("Preço alvo por unidade (R$)", "22");
    await commercialOrder();
    expect(screen.queryByLabelText("Preço alvo por unidade (R$)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Preço escolhido neste canal (R$)")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto com estes valores" }));
    expect(mock.navigate).toHaveBeenLastCalledWith("/comercial/produtos", expect.objectContaining({ state: { pricing: expect.objectContaining({ price: 22, quotePrice: 30 }) } }));
    set("Canal de venda", "factory");
    expect(screen.getByLabelText("Preço alvo por unidade (R$)")).toHaveValue("22");
    expect(screen.queryByLabelText("Preço escolhido neste canal (R$)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto com estes valores" }));
    expect(mock.navigate).toHaveBeenLastCalledWith("/comercial/produtos", { state: { pricing: { name: "Kit de três placas", cost: 10, price: 22, quantity: 10, quote: false } } });
  });
});
