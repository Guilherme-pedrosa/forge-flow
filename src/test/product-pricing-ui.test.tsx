import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Precificacao from "@/pages/comercial/Precificacao";

const productId = "00000000-0000-4000-8000-000000000001";
const plateId = "00000000-0000-4000-8000-000000000002";
const itemId = "00000000-0000-4000-8000-000000000003";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), navigate: vi.fn(), pending: false, saved: {} as Record<string, unknown>, delay: null as null | (() => void), held: false }));
vi.mock("react-router-dom", async original => ({ ...await original<typeof import("react-router-dom")>(), useNavigate: () => mock.navigate }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/components/shared/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label, disabled }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; label: string; disabled?: boolean }) => <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
const baseCosts = { material: 4, energy: 1, machine: 2, handling: 1, finishing: 0, assembly: 1, extras: 1, overhead: 0 };
function preview(quantity: number, overrides: Record<string, unknown>) {
  const exclusive = overrides.cost_basis === "exclusive_lot";
  const unit = exclusive ? 18 : 10;
  return {
    product_id: productId, product_name: "Maçã", quantity, complete: !mock.pending, missing: mock.pending ? ["Confirme a hora-máquina da folha."] : [],
    revision: `preview-${quantity}-${overrides.cost_basis}`, plan_revision: "plan-1", plan: mock.saved, cost_basis: overrides.cost_basis,
    components: [{ name: "Folha", component_product_id: "leaf", quantity_per_product: 1, required_quantity: quantity, plate_id: plateId, quantity_per_plate: 8, technical: { grams: 2, print_seconds: 60 } }],
    plates: [{ plate_id: plateId, product_id: productId, label: "Folhas", source: "slice_plan", runs: quantity / 8, printer_id: "printer", printer_name: "A1", print_seconds_per_run: 480, handling_minutes_per_run: 2, machine_hour_cost: 5, power_watts: 100, materials: [{ name: "PLA verde", grams: 16, cost: 1.6 }], material: 2, energy: .5, machine: 1, handling: .5, missing: [] }],
    runs: [{ plate_id: plateId, label: "Folhas", required_runs: quantity / 8, full_runs: Math.ceil(quantity / 8), outputs: [{ component_product_id: "leaf", required_quantity: quantity, produced_quantity: Math.ceil(quantity / 8) * 8, surplus_units: Math.ceil(quantity / 8) * 8 - quantity }] }],
    breakdown: { ...Object.fromEntries(Object.entries(baseCosts).map(([key, n]) => [key, n * quantity])), total_lot: mock.pending ? null : unit * quantity, unit_cost: mock.pending ? null : unit },
    production_breakdown: { ...baseCosts, total_lot: mock.pending ? null : 18 * quantity, unit_cost: mock.pending ? null : 18 },
    margin_percent: 50, suggested_unit_price: mock.pending ? null : unit * 2, manual_cost_reference: 8,
  };
}
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const mount = () => render(<MemoryRouter initialEntries={[`/comercial/precificacao?produto=${productId}`]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Precificacao /></QueryClientProvider></MemoryRouter>);
const result = () => within(screen.getByTestId("product-pricing-breakdown"));
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
beforeEach(() => {
  mock.pending = false; mock.saved = { handling_minutes_per_plate: 2, assembly_minutes_per_product: 3, consumables: [{ item_id: itemId, quantity: 1 }] }; mock.delay = null; mock.held = false;
  mock.navigate.mockReset(); mock.from.mockReset(); mock.rpc.mockReset();
  mock.from.mockImplementation((table: string) => {
    const data = table === "products" ? [{ id: productId, name: "Maçã", sku: "APPLE" }] : table === "printers" ? [{ id: "printer", name: "A1", power_watts: 100 }] : [{ id: itemId, name: "Caixa", unit: "un", avg_cost: 1 }];
    const builder = { select: () => builder, eq: () => builder, in: () => builder, order: () => builder, range: () => Promise.resolve({ data, error: null }) };
    return builder;
  });
  mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "pricing_settings") return { data: { machine_hour_cost: 5, energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 0, target_margin: 50, handling_minutes_per_plate: 2, assembly_minutes_per_product: 3, finishing_minutes_per_piece: 0, extras_cost_per_product: 0, printer_hour_costs: [], revision: "settings-1" }, error: null };
    if (name === "product_pricing_plan") return { data: { plan: mock.saved, revision: "plan-1" }, error: null };
    if (name === "product_pricing_preview") {
      if (mock.held) await new Promise<void>(resolve => { mock.delay = resolve; });
      return { data: preview(args.p_quantity as number, args.p_overrides as Record<string, unknown>), error: null };
    }
    if (name === "save_product_pricing_plan") mock.saved = args.p_plan as Record<string, unknown>;
    return { data: "acceptance-id", error: null };
  });
});
afterEach(cleanup);

describe("pricing from the saved product structure", () => {
  it("opens the linked product, loads technical data and displays each cost without recomputing the server total", async () => {
    mount();
    await screen.findByText("Peças e placas que formam Maçã");
    expect(screen.getByLabelText("Produto para precificar")).toHaveValue(productId);
    expect(screen.getByText(/Referência por peça: 2 g · 1 min/)).toBeInTheDocument();
    expect(screen.getByText(/PLA verde: 16 g por impressão/)).toBeInTheDocument();
    expect(result().getByText("Hora-máquina").nextSibling).toHaveTextContent(brl(2));
    expect(result().getByText("Custo por unidade").nextSibling).toHaveTextContent(brl(10));
    expect(screen.getByLabelText("Preparação e retirada por placa (min)")).toHaveValue(2);
    expect(mock.rpc.mock.calls.filter(([name]) => /save|apply/.test(name))).toHaveLength(0);
  });
  it("switches the pricing basis to whole runs while keeping surplus explicit", async () => {
    mount(); await screen.findByText("Peças e placas que formam Maçã");
    set("Quantidade de produtos prontos", "3");
    set("Base do custo e do preço", "exclusive_lot");
    await waitFor(() => expect(result().getByText("Custo por unidade").nextSibling).toHaveTextContent(brl(18)));
    expect(result().getByText("Custo para a quantidade").nextSibling).toHaveTextContent(brl(54));
    expect(within(screen.getByTestId("pricing-production-plan")).getByText(/5 de sobra/)).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith("product_pricing_preview", expect.objectContaining({ p_quantity: 3, p_overrides: { cost_basis: "exclusive_lot" } }));
  });
  it("saves manipulation, assembly and stock consumables as a plan without applying prices or posting stock", async () => {
    mount(); await screen.findByText("Peças e placas que formam Maçã");
    set("Montagem por produto completo (min)", "4");
    set("Qtd. por produto (un)", "2");
    fireEvent.click(screen.getByRole("button", { name: "Salvar tempos e insumos do produto" }));
    await screen.findByText(/Plano salvo/);
    expect(mock.rpc).toHaveBeenCalledWith("save_product_pricing_plan", expect.objectContaining({ p_product_id: productId, p_expected_revision: "plan-1", p_plan: { cost_basis: "unit", handling_minutes_per_plate: 2, assembly_minutes_per_product: 4, consumables: [{ item_id: itemId, quantity: 2 }] } }));
    expect(mock.rpc.mock.calls.some(([name]) => name === "apply_product_pricing" || /stock|inventory/.test(name))).toBe(false);
  });
  it("keeps known subtotals visible and prevents applying any incomplete price", async () => {
    mock.pending = true; mount(); await screen.findByText("Confirme a hora-máquina da folha.");
    expect(result().getByText("Filamentos e materiais").nextSibling).toHaveTextContent(brl(4));
    expect(result().getByText("Custo por unidade").nextSibling).toHaveTextContent("Pendente");
    expect(screen.getByRole("button", { name: "Aplicar custo e preço ao cadastro" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Usar preço no novo orçamento" })).toBeDisabled();
  });
  it("blocks stale revisions while recalculating, then applies only the current preview", async () => {
    mount(); await screen.findByText("Peças e placas que formam Maçã");
    mock.held = true; set("Quantidade de produtos prontos", "2");
    await waitFor(() => expect(mock.delay).not.toBeNull());
    expect(screen.getByRole("button", { name: "Aplicar custo e preço ao cadastro" })).toBeDisabled();
    mock.held = false; mock.delay!();
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar custo e preço ao cadastro" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Aplicar custo e preço ao cadastro" }));
    await screen.findByText("Custo e preço aplicados ao cadastro do produto.");
    expect(mock.rpc).toHaveBeenCalledWith("apply_product_pricing", expect.objectContaining({ p_product_id: productId, p_quantity: 2, p_overrides: { cost_basis: "unit" }, p_expected_revision: "preview-2-unit", p_unit_price: 20 }));
  });
  it("uses the chosen product unit cost for channel pricing and quotes without changing the catalogue", async () => {
    mount(); await screen.findByText("Peças e placas que formam Maçã");
    set("Quantidade de produtos prontos", "3"); set("Canal da simulação", "mercado_livre"); set("Comissão sobre produtos (%)", "10"); set("Preço alvo por unidade (R$)", "30");
    const channel = within(screen.getByTestId("product-channel-result"));
    expect(channel.getByText("Custo fabril").nextSibling).toHaveTextContent(brl(30));
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar preço no novo orçamento" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Usar preço no novo orçamento" }));
    expect(mock.navigate).toHaveBeenCalledWith("/comercial/orcamentos", { state: { pricingQuote: { product_id: productId, quantity: 3, unit_price: 30 } } });
    expect(mock.rpc.mock.calls.some(([name]) => name === "apply_product_pricing")).toBe(false);
  });
  it("uses the same top quantity for exclusive-lot production, channel costs and the quoted order", async () => {
    mount(); await screen.findByText("Peças e placas que formam Maçã");
    set("Quantidade de produtos prontos", "3"); set("Base do custo e do preço", "exclusive_lot");
    await waitFor(() => expect(result().getByText("Custo por unidade").nextSibling).toHaveTextContent(brl(18)));
    set("Canal da simulação", "mercado_livre");
    expect(screen.queryByLabelText("Unidades por pedido / pacote")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("product-channel-result")).getByText("Custo fabril").nextSibling).toHaveTextContent(brl(54));
    expect(screen.getByText(/Quantidade por pedido: 3 produtos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usar preço no novo orçamento" }));
    expect(mock.navigate).toHaveBeenCalledWith("/comercial/orcamentos", { state: { pricingQuote: { product_id: productId, quantity: 3, unit_price: 36 } } });
  });
  it("blocks stale cached prices after a failed refresh until a new valid preview is loaded", async () => {
    mount(); await screen.findByText("Peças e placas que formam Maçã");
    const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "product_pricing_preview" ? Promise.resolve({ data: null, error: { message: "Consulta temporariamente indisponível" } }) : original(name, args));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar prévia" }));
    await screen.findByText("Consulta temporariamente indisponível");
    expect(screen.getByRole("button", { name: "Aplicar custo e preço ao cadastro" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Usar preço no novo orçamento" })).toBeDisabled();
    mock.rpc.mockImplementation(original);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar prévia" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar custo e preço ao cadastro" })).toBeEnabled());
  });
});
