import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Precificacao from "@/pages/comercial/Precificacao";
import type { ModelPricingEstimate } from "@/lib/model-pricing";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), columns: [] as { table: string; columns: string }[], partCount: 2 as number | null, zeroCost: false, freeReceipt: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "model-pricing-tenant" }, user: { id: "model-pricing-user" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string }) =>
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/comercial/PricingModelFile", () => ({ PricingModelFile: ({ onLoaded, estimate }: { onLoaded: (file: File, estimate: ModelPricingEstimate) => void; estimate: ModelPricingEstimate | null }) => <div><button onClick={() => onLoaded(new File(["synthetic sliced model"], "produto.3mf"), {
  hours: 2, timeSeconds: 7200, weightGrams: 100, plateCount: 2, partCount: mock.partCount,
  printerModelIds: ["Bambu Lab A1"], nozzleDiameters: ["0.4"],
  materials: [{ key: "slot-red", slotId: 1, materialCode: "PLA", colorHex: "#FF0000", grams: 100, plateIndices: [1, 2], name: "PLA · slot 1 · #FF0000" }],
})}>Carregar modelo de teste</button>{estimate && <><output aria-label="Tempo nativo">{estimate.hours} h</output><output aria-label="Filamento nativo">{estimate.weightGrams} g</output></>}</div> }));

const policy = {
  machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20,
  overhead_percent: 0, target_margin: 50, handling_minutes_per_plate: 0,
  finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  printer_hour_costs: [], machine_rate_scope: "commercial_excludes_energy", revision: "confirmed-policy",
};
const printers = [
  { id: "a1", name: "Bambu A1", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000 },
  { id: "mini", name: "Bambu A1 Mini", brand: "Bambu Lab", model: "A1 mini", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000 },
];
const filaments = [
  { id: "pla", name: "PLA vermelho", unit: "kg", avg_cost: 80, material_code: "PLA", color_hex: "#FF0000" },
  { id: "petg", name: "PETG vermelho", unit: "g", avg_cost: 0.08, material_code: "PETG", color_hex: "#FF0000" },
];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/comercial/precificacao"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Precificacao /></MemoryRouter></QueryClientProvider>);
}
function choose(label: string, value: string) {
  const select = screen.getByLabelText(label.startsWith("Bambu") ? "Modelo de impressão" : "Filamento do slot 1");
  fireEvent.change(select, { target: { value } });
}
const expectCost = (value: RegExp) => expect(screen.getByText("Custo / unidade").parentElement?.querySelector("dd")).toHaveTextContent(value);
async function loadAndChoose() {
  fireEvent.click(screen.getByRole("button", { name: "Carregar modelo de teste" }));
  await waitFor(() => expect(screen.getByLabelText("Modelo de impressão")).toHaveTextContent("A1"));
  choose("Bambu A1", "a1");
  choose("PLA vermelho", "pla");
}

beforeEach(() => {
  mock.from.mockReset(); mock.rpc.mockReset(); mock.columns.length = 0;
  mock.partCount = 2;
  mock.zeroCost = false; mock.freeReceipt = false;
  mock.from.mockImplementation((table: string) => {
    const query = {
      select: (columns: string) => { mock.columns.push({ table, columns }); return query; },
      eq: () => query, gt: () => query, in: () => query, order: () => query,
      range: async () => ({ data: table === "printers" ? printers : table === "inventory_items" ? filaments.map(item => mock.zeroCost && item.id === "pla" ? { ...item, avg_cost: 0 } : item)
        : table === "inventory_movements" && mock.freeReceipt ? [{ item_id: "pla" }] : [], error: null }),
    };
    return query;
  });
  mock.rpc.mockImplementation(async (name: string) => name === "pricing_settings"
    ? { data: { ...policy }, error: null }
    : { data: null, error: { message: `Unexpected RPC: ${name}` } });
});
afterEach(cleanup);

describe("automatic file and filament pricing", () => {
  it("keeps identity-only filament rates pending before offering a complete price", async () => {
    mock.zeroCost = true;
    mount(); await loadAndChoose();
    expect(await screen.findByText("Informe o custo deste filamento ou registre uma compra recebida.")).toBeVisible();
    expect(screen.queryByText("Custo / unidade")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });

  it("prices an explicitly confirmed free filament using the remaining machine and energy costs", async () => {
    mock.zeroCost = true; mock.freeReceipt = true;
    mount(); await loadAndChoose();
    await waitFor(() => expectCost(/R\$\s*4,20/));
    expect(screen.getByText(/^Preço sugerido:/)).toHaveTextContent(/R\$\s*8,40/);
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });
  it("opens the file workflow directly and reads only nonsecret printer fields", async () => {
    mount();
    expect(screen.getByRole("button", { name: "Arquivo e filamento" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Carregar modelo de teste" })).toBeVisible();
    await waitFor(() => expect(mock.columns.some(read => read.table === "printers")).toBe(true));
    for (const read of mock.columns.filter(read => read.table === "printers")) {
      expect(read.columns).not.toContain("*");
      expect(read.columns).not.toMatch(/token|password|access_code|bambu_|ip_address|serial_number/i);
    }
  });

  it("computes per-piece cost and sale price from native time, stock cost and selected printer", async () => {
    mount(); await loadAndChoose();
    // Two plates: R$8 material + 2h × R$2 machine + 2h × 0.1kW × R$1.
    await waitFor(() => expectCost(/R\$\s*12,20/));
    expect(screen.getByText(/^Preço sugerido:/)).toHaveTextContent(/R\$\s*24,40/);
    fireEvent.change(screen.getByLabelText("Unidades prontas no lote"), { target: { value: "2" } });
    await waitFor(() => expectCost(/R\$\s*6,10/));
    expect(screen.getByText(/^Preço sugerido:/)).toHaveTextContent(/R\$\s*12,20/);
    expect(screen.getByLabelText("Tempo nativo")).toHaveTextContent("2 h");
    expect(screen.getByLabelText("Filamento nativo")).toHaveTextContent("100 g");
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });

  it("blocks a material or printer mismatch instead of presenting an inaccurate price", async () => {
    mount(); await loadAndChoose();
    await waitFor(() => expectCost(/R\$\s*12,20/));
    choose("PETG vermelho", "petg");
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    expect(screen.getByText(/material escolhido difere/i)).toBeVisible();
    choose("PLA vermelho", "pla");
    choose("Bambu A1 Mini", "mini");
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    expect(screen.getByText(/fatiado para outra impressora/i)).toBeVisible();
  });

  it("retains the imported estimate and chosen resources across mode changes", async () => {
    mount(); await loadAndChoose();
    await waitFor(() => expectCost(/R\$\s*12,20/));
    fireEvent.change(screen.getByLabelText("Unidades prontas no lote"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Simulação livre" }));
    fireEvent.click(screen.getByRole("button", { name: "Arquivo e filamento" }));
    await waitFor(() => expectCost(/R\$\s*6,10/));
    expect(screen.getByLabelText("Unidades prontas no lote")).toHaveValue(2);
    expect(screen.getByLabelText("Tempo nativo")).toHaveTextContent("2 h");
    expect(screen.getByLabelText("Filamento nativo")).toHaveTextContent("100 g");
    const selected = screen.getAllByRole("combobox").map(element => (element as HTMLSelectElement).value);
    expect(selected).toContain("a1"); expect(selected).toContain("pla");
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });

  it("includes configured handling, finishing, assembly and extras exactly once when quantity and manual additions change", async () => {
    mock.rpc.mockResolvedValue({ data: { ...policy, handling_minutes_per_plate: 2, finishing_minutes_per_piece: 3, assembly_minutes_per_product: 5, extras_cost_per_product: 1 }, error: null });
    mount(); await loadAndChoose();
    // 2 plates × 2min + 2 physical parts × 3min + 1 product × 5min = 15min.
    // Native printing R$12.20 + 15min × R$20/h + R$1 standard extras = R$18.20.
    await waitFor(() => expectCost(/R\$\s*18,20/));
    fireEvent.change(screen.getByLabelText("Unidades prontas no lote"), { target: { value: "2" } });
    // Native totals stay fixed; assembly and standard extras apply per product:
    // (12.20 + (4+6+10)/60 × 20 + 2) / 2 = R$10.433333 per product.
    await waitFor(() => expectCost(/R\$\s*10,43/));
    const additionalLabor = screen.getByLabelText("Trabalho manual adicional no lote (min)");
    fireEvent.change(additionalLabor, { target: { value: "2" } });
    await waitFor(() => expectCost(/R\$\s*10,77/));
    expect(additionalLabor).toHaveValue("2");
    fireEvent.change(additionalLabor, { target: { value: "3" } });
    fireEvent.change(additionalLabor, { target: { value: "2" } });
    expectCost(/R\$\s*10,77/);
    fireEvent.click(screen.getByText("Embalagem e outros custos"));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar extra" }));
    expect(screen.getAllByLabelText(/Custo do extra/)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Custo do extra 1"), { target: { value: "3" } });
    await waitFor(() => expectCost(/R\$\s*13,77/));
    fireEvent.change(screen.getByLabelText("Nome do extra 1"), { target: { value: "Embalagem adicional" } });
    expectCost(/R\$\s*13,77/);
    fireEvent.change(screen.getByLabelText("Custo do extra 1"), { target: { value: "4" } });
    expectCost(/R\$\s*14,77/);
    expect(screen.getByLabelText("Tempo nativo")).toHaveTextContent("2 h");
    expect(screen.getByLabelText("Filamento nativo")).toHaveTextContent("100 g");
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });

  it("requires a physical part count before charging configured finishing per part", async () => {
    mock.partCount = null;
    mock.rpc.mockResolvedValue({ data: { ...policy, finishing_minutes_per_piece: 3 }, error: null });
    mount(); await loadAndChoose();
    await waitFor(() => expect(screen.getByText(/não informa a quantidade de peças para calcular o acabamento/)).toBeVisible());
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Custo / unidade")).not.toBeInTheDocument();
  });

  it.each(["handling_minutes_per_plate", "finishing_minutes_per_piece", "assembly_minutes_per_product", "extras_cost_per_product", "labor_cost_hour"])("keeps automatic file pricing pending for unknown company %s without dropping the native source", async key => {
    mock.rpc.mockResolvedValue({ data: { ...policy, [key]: null }, error: null });
    mount(); await loadAndChoose();
    expect(await screen.findByText(/Confirme .*inclusive zero quando não se aplicar/)).toBeVisible();
    expect(screen.queryByText("Custo / unidade")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Preço sugerido:/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tempo nativo")).toHaveTextContent("2 h");
    expect(screen.getByLabelText("Filamento nativo")).toHaveTextContent("100 g");
    expect(screen.getByLabelText("Unidades prontas no lote")).toHaveValue(1);
  });
});
