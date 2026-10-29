import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Precificacao from "@/pages/comercial/Precificacao";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "daily-pricing-tenant" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));

// Synthetic, explicitly confirmed company values. No products, printers or stock
// need to exist to price the totals from a new project's slicer plates.
const companyPolicy = {
  machine_hour_cost: 2,
  energy_cost_kwh: 1,
  labor_cost_hour: 20,
  overhead_percent: 0,
  target_margin: 50,
  handling_minutes_per_plate: 0,
  finishing_minutes_per_piece: 0,
  assembly_minutes_per_product: 0,
  extras_cost_per_product: 0,
  printer_hour_costs: [],
  machine_rate_scope: "commercial_excludes_energy",
  revision: "confirmed-daily-policy",
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/comercial/precificacao"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Precificacao /></MemoryRouter></QueryClientProvider>);
}
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const set = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

async function openFreeForIndependentCase() {
  // The separate entry test forbids this extra click. Other regressions remain
  // observable on the old page, so one entry failure cannot mask all of them.
  if (!screen.queryByLabelText("Gramas no lote")) fireEvent.click(screen.getByRole("button", { name: "Simulação livre" }));
  await waitFor(() => expect(field("Margem desejada sobre a venda (%)").value).toBe("50"));
}
function fillProject() {
  set("Nome do produto", "Produto completo de duas placas");
  set("Unidades prontas no lote", "1");
  set("Gramas no lote", "100");
  set("Custo / kg (R$)", "80");
  set("Horas totais de impressão", "2");
  // Confirm the power manually, without selecting a registered printer.
  set("Potência média (W)", "100");
}
const expectUnitCost = (currency: RegExp) => expect(screen.getByText("Custo / unidade").parentElement?.querySelector("dd")).toHaveTextContent(currency);

beforeEach(() => {
  mock.from.mockReset(); mock.rpc.mockReset();
  mock.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
      range: () => Promise.resolve({ data: [], error: null }) };
    return query;
  });
  mock.rpc.mockImplementation(async (name: string) => name === "pricing_settings"
    ? { data: { ...companyPolicy }, error: null }
    : { data: null, error: { message: `Unexpected fixture RPC: ${name}` } });
});
afterEach(cleanup);

describe("daily pricing of a new 3D product", () => {
  it("opens the calculator directly without requiring an existing product or an extra mode click", () => {
    mount();
    expect(screen.getByLabelText("Nome do produto")).toBeVisible();
    expect(screen.getByLabelText("Unidades prontas no lote")).toBeVisible();
    expect(screen.getByLabelText("Gramas no lote")).toBeVisible();
    expect(screen.getByLabelText("Custo / kg (R$)")).toBeVisible();
    expect(screen.getByLabelText("Horas totais de impressão")).toBeVisible();
    expect(mock.rpc.mock.calls.some(([name]) => /product_pricing_plan|product_pricing_preview|save|apply/.test(name))).toBe(false);
  });

  it("retains a filled project when switching to saved products and back", async () => {
    mount(); await openFreeForIndependentCase(); fillProject();
    set("Unidades prontas no lote", "3");
    fireEvent.click(screen.getByRole("button", { name: "Produto cadastrado" }));
    fireEvent.click(screen.getByRole("button", { name: "Simulação livre" }));
    expect(field("Nome do produto").value).toBe("Produto completo de duas placas");
    expect(field("Unidades prontas no lote").value).toBe("3");
    expect(field("Gramas no lote").value).toBe("100");
    expect(field("Custo / kg (R$)").value).toBe("80");
    expect(field("Horas totais de impressão").value).toBe("2");
    expect(field("Potência média (W)").value).toBe("100");
  });

  it("prices the complete product from both plates' combined totals without ERP setup", async () => {
    mount(); await openFreeForIndependentCase(); fillProject();
    // Independent worked example: plate A 40g/1h plus plate B 60g/1h.
    // Material R$8 + energy R$0.20 + machine R$4 = R$12.20 for ONE
    // complete product. A confirmed 50% sales margin suggests R$24.40.
    await waitFor(() => expectUnitCost(/R\$\s*12,20/));
    expect(screen.getByText(/^Preço sugerido:/)).toHaveTextContent(/R\$\s*24,40/);
    expect(screen.getByRole("button", { name: "Cadastrar produto com estes valores" })).toBeEnabled();
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });

  it("accepts decimal commas for project weight, filament price and printing time", async () => {
    mount(); await openFreeForIndependentCase(); fillProject();
    set("Gramas no lote", "100,5");
    set("Custo / kg (R$)", "80,5");
    set("Horas totais de impressão", "2,5");
    expect(field("Gramas no lote").value).toBe("100,5");
    expect(field("Custo / kg (R$)").value).toBe("80,5");
    expect(field("Horas totais de impressão").value).toBe("2,5");
    // Independent decimal example: R$8.09025 material + R$0.25 energy
    // + R$5 machine = R$13.34025; 50% margin rounds UP to R$26.69.
    await waitFor(() => expectUnitCost(/R\$\s*13,34/));
    expect(screen.getByText(/^Preço sugerido:/)).toHaveTextContent(/R\$\s*26,69/);
  });
  it("shows the known material subtotal while guiding missing costs instead of inventing a complete price", async () => {
    mock.rpc.mockResolvedValue({ data: { ...companyPolicy, machine_hour_cost: null, energy_cost_kwh: null, labor_cost_hour: null, overhead_percent: null, target_margin: null }, error: null });
    mount();
    await waitFor(() => expect(field("Margem desejada sobre a venda (%)").value).toBe("30"));
    set("Gramas no lote", "100"); set("Custo / kg (R$)", "80"); set("Horas totais de impressão", "2");
    expect(screen.getByText(/Filamento informado/)).toHaveTextContent(/R\$\s*8,00/);
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar produto com estes valores" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conferir custos da impressão" }));
    expect(field("Potência média (W)")).toBeVisible();
    expect(field("Energia (R$ / kWh)")).toHaveValue("");
    expect(field("Hora-máquina sem energia (R$ / h)")).toHaveValue("");
    set("Potência média (W)", "100"); set("Energia (R$ / kWh)", "1");
    set("Hora-máquina sem energia (R$ / h)", "2"); set("Despesas indiretas (%)", "0");
    await waitFor(() => expectUnitCost(/R\$\s*12,20/));
    expect(screen.getByText(/^Preço sugerido:/)).toHaveTextContent(/R\$\s*17,43/);
  });
});
