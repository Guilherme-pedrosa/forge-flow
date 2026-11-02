import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Precificacao from "@/pages/comercial/Precificacao";
import type { ModelPricingEstimate } from "@/lib/model-pricing";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), design: null as unknown }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "maker-pricing-tenant" }, user: { id: "maker-pricing-user" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string }) =>
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/comercial/PricingModelFile", () => ({ PricingModelFile: ({ onLoaded }: { onLoaded: (file: File, estimate: ModelPricingEstimate | null) => void }) =>
  <button type="button" onClick={() => onLoaded(new File(["geometry only"], "outra-peca.stl"), null)}>Escolher arquivo sem fatiamento</button> }));

const policy = { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20,
  overhead_percent: 0, target_margin: 50, handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0,
  assembly_minutes_per_product: 0, extras_cost_per_product: 0, printer_hour_costs: [],
  machine_rate_scope: "commercial_excludes_energy", revision: "confirmed-policy" };
const printers = [
  { id: "a1", name: "A1 da oficina", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000 },
  { id: "mini", name: "A1 Mini da oficina", brand: "Bambu Lab", model: "A1 mini", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000 },
];
const filaments = [
  { id: "pla-red", name: "PLA vermelho do estoque", unit: "kg", avg_cost: 80, material_code: "PLA", color_hex: "#FF0000" },
  { id: "petg-red", name: "PETG vermelho do estoque", unit: "g", avg_cost: 0.08, material_code: "PETG", color_hex: "#FF0000" },
];
function profile(id: number, title: string, grams = 100, seconds = 7200, exactGrams = true) {
  return { id, profileId: id + 400, title, extention: { modelInfo: {
    compatibility: { devProductName: "A1", nozzleDiameter: 0.4 },
    plates: [{ index: 1, name: "Produto", weight: grams, prediction: seconds,
      filaments: [{ id: "1", type: "PLA", color: "#FF0000", ...(exactGrams ? { usedG: grams } : {}) }],
      objects: [{ id: 1, name: "Suporte", quantity: 1 }] }],
  } } };
}
const design = (multiple = false, exactGrams = true) => ({ id: 456, title: "Suporte MakerWorld", defaultInstanceId: 101,
  instances: [profile(101, "Perfil rápido", 100, 7200, exactGrams), ...(multiple ? [profile(102, "Perfil detalhado", 200, 3600)] : [])] });
const abortDescriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
beforeAll(() => {
  if (!abortDescriptor) Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { configurable: true, value(this: AbortSignal) {
    if (this.aborted) throw new DOMException("Consulta cancelada", "AbortError");
  } });
});
afterAll(() => { if (!abortDescriptor) delete (AbortSignal.prototype as unknown as Record<string, unknown>).throwIfAborted; });
beforeEach(() => {
  mock.design = design(); mock.from.mockReset(); mock.rpc.mockReset();
  mock.from.mockImplementation((table: string) => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
      range: async () => ({ data: table === "printers" ? printers : table === "inventory_items" ? filaments : [], error: null }) };
    return query;
  });
  mock.rpc.mockImplementation(async (name: string) => {
    if (name === "pricing_settings") return { data: { ...policy }, error: null };
    if (name === "request_makerworld_import") return { data: "maker-request", error: null };
    if (name === "get_makerworld_import") return { data: { status: "ready", payload: mock.design }, error: null };
    return { data: null, error: { message: `Unexpected RPC: ${name}` } };
  });
});
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/comercial/precificacao"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Precificacao /></MemoryRouter></QueryClientProvider>);
}
function paste(url = "https://makerworld.com/pt/models/456-suporte") {
  fireEvent.change(screen.getByLabelText("Link do MakerWorld"), { target: { value: url } });
}
function submit() { fireEvent.click(screen.getByRole("button", { name: "Importar link" })); }
function expectCost(pattern: RegExp) {
  expect(screen.getByText("Custo / unidade").parentElement?.querySelector("dd")).toHaveTextContent(pattern);
}

describe("MakerWorld link to per-piece cost", () => {
  it("pastes a unique profile and calculates automatically with the matching printer and stock filament", async () => {
    mount(); paste();
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
    submit();
    // R$8 PLA + 2h × R$2 machine + 2h × 0.1kW × R$1 = R$12.20.
    await waitFor(() => expectCost(/R\$\s*12,20/));
    expect(screen.getByLabelText("Impressora da impressão")).toHaveValue("a1");
    expect(screen.getByLabelText("Filamento 1")).toHaveValue("pla-red");
    expect(screen.getByText(/^Preço sugerido:/)).toHaveTextContent(/R\$\s*24,40/);
    expect(screen.queryByLabelText("Qual perfil de impressão você vai usar?")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Horas totais de impressão")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome do produto")).toHaveValue("Suporte MakerWorld");
  });

  it("asks one profile question when ambiguous, then computes without resource questions", async () => {
    mock.design = design(true);
    mount(); paste(); submit();
    const chooser = await screen.findByLabelText("Qual perfil de impressão você vai usar?");
    expect(screen.queryByText("Custo / unidade")).not.toBeInTheDocument();
    fireEvent.change(chooser, { target: { value: "1:0" } });
    // This profile publishes 200g and 1h, giving R$16 + R$2 + R$0.10.
    await waitFor(() => expectCost(/R\$\s*18,10/));
    expect(screen.getByLabelText("Impressora da impressão")).toHaveValue("a1");
    expect(screen.getByLabelText("Filamento 1")).toHaveValue("pla-red");
  });

  it("uses explicit total grams for a single declared material without requiring manual consumption", async () => {
    mock.design = design(false, false);
    mount(); paste(); submit();
    await waitFor(() => expectCost(/R\$\s*12,20/));
    expect(screen.getByLabelText("Filamento 1")).toHaveValue("pla-red");
    expect(screen.queryByText(/informe.*gramas/i)).not.toBeInTheDocument();
  });

  it("removes the previous cost immediately when another link is pasted and keeps it cleared on failure", async () => {
    mount(); paste(); submit(); await waitFor(() => expectCost(/R\$\s*12,20/));
    paste("https://makerworld.com/pt/models/789-outra-peca");
    expect(screen.queryByText("Custo / unidade")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    mock.rpc.mockImplementation(async (name: string) => name === "request_makerworld_import"
      ? { data: null, error: { message: "Modelo indisponível." } } : { data: { ...policy }, error: null });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Modelo indisponível.");
    expect(screen.queryByText("Custo / unidade")).not.toBeInTheDocument();
  });

  it("clears the MakerWorld result when the source changes to an unsliced file", async () => {
    mount(); paste(); submit(); await waitFor(() => expectCost(/R\$\s*12,20/));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Escolher arquivo sem fatiamento" })); });
    expect(screen.queryByText("Custo / unidade")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Link do MakerWorld")).toHaveValue("");
    expect(screen.getByLabelText("Nome do produto")).toHaveValue("outra-peca");
  });
});
