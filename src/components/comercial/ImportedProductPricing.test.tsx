import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportedProductPricing } from "./ImportedProductPricing";
import type { ModelPricingEstimate } from "@/lib/model-pricing";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), printers: [] as Record<string, unknown>[], filaments: [] as Record<string, unknown>[], policy: {} as Record<string, unknown>, columns: [] as string[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "import-company" }, user: { id: "import-user" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string }) =>
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
const estimate: ModelPricingEstimate = { hours: 2, timeSeconds: 7200, weightGrams: 100, plateCount: 2, partCount: 2,
  printerModelIds: ["Bambu Lab A1"], nozzleDiameters: ["0.4"],
  materials: [{ key: "red", slotId: 1, materialCode: "PLA", colorHex: "#FF0000", grams: 100, plateIndices: [1, 2], name: "PLA vermelho" }] };
const policy = { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 0, target_margin: 50,
  handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  printer_hour_costs: [], machine_rate_scope: "commercial_excludes_energy", revision: "confirmed" };
const a1 = { id: "a1", name: "A1 oficina", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000 };
const pla = { id: "pla", name: "PLA vermelho cadastrado", unit: "kg", avg_cost: 80, material_code: "PLA", color_hex: "#FF0000" };
beforeEach(() => {
  mock.printers = [a1]; mock.filaments = [pla]; mock.policy = { ...policy }; mock.columns.length = 0;
  mock.from.mockReset().mockImplementation((table: string) => {
    const query = { select: (columns: string) => { mock.columns.push(columns); return query; }, eq: () => query, in: () => query, order: () => query,
      range: async () => ({ data: table === "printers" ? mock.printers : mock.filaments, error: null }) };
    return query;
  });
  mock.rpc.mockReset().mockImplementation(async (name: string) => name === "pricing_settings" ? { data: mock.policy, error: null } : { data: null, error: { message: "Unexpected write" } });
});
function mount(value: ModelPricingEstimate | null = estimate, loaded = vi.fn(), error?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: ModelPricingEstimate | null, nextError?: string) => <QueryClientProvider client={client}><MemoryRouter><ImportedProductPricing estimate={next} error={nextError} onCalculated={loaded} /></MemoryRouter></QueryClientProvider>;
  const result = render(ui(value, error));
  return { loaded, rerender: (next: ModelPricingEstimate | null, nextError?: string) => result.rerender(ui(next, nextError)) };
}
const cost = () => screen.getByText("Custo por peça").parentElement?.querySelector("dd");

describe("ImportedProductPricing", () => {
  it("automatically reports a complete cost and price from unique saved resources with no tariff questions", async () => {
    const { loaded } = mount();
    await waitFor(() => expect(loaded).toHaveBeenLastCalledWith({ cost: 12.2, price: 24.4, materialId: "pla", printerId: "a1", quantity: 1, marginPercent: 50 }));
    expect(cost()).toHaveTextContent(/12,20/);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Impressora: A1 oficina")).toBeInTheDocument();
    expect(screen.getByText("Filamento: PLA vermelho cadastrado")).toBeInTheDocument();
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
    for (const columns of mock.columns) expect(columns).not.toMatch(/\*|password|token|access_code|ip_address|serial_number/);
  });

  it("asks for only ambiguous printer and filament choices before calculating", async () => {
    mock.printers.push({ ...a1, id: "other-a1", name: "Outra A1" });
    mock.filaments.push({ ...pla, id: "other-pla", name: "Outra bobina PLA vermelha" });
    const { loaded } = mount();
    const printer = await screen.findByLabelText("Impressora do produto importado");
    const filament = screen.getByLabelText("Filamento 1 do produto importado");
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    fireEvent.change(printer, { target: { value: "a1" } });
    fireEvent.change(filament, { target: { value: "pla" } });
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.cost).toBe(12.2));
  });

  it("charges configured handling, finishing, assembly and extras once and divides by finished products", async () => {
    mock.policy = { ...policy, handling_minutes_per_plate: 2, finishing_minutes_per_piece: 3, assembly_minutes_per_product: 5, extras_cost_per_product: 1 };
    const { loaded } = mount();
    await waitFor(() => expect(cost()).toHaveTextContent(/18,20/));
    fireEvent.change(screen.getByLabelText("Produtos completos neste perfil"), { target: { value: "2" } });
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ cost: 10.4333, quantity: 2, price: 20.87 }));
  });

  it("requires explicit stock selection and single-filament confirmation for an unknown placeholder", async () => {
    const unknown = { ...estimate, printerModelIds: [], materials: [{ ...estimate.materials[0], key: "unknown", slotId: null, materialCode: null, colorHex: null, name: "Filamento não informado" }] };
    const { loaded } = mount(unknown);
    fireEvent.change(await screen.findByLabelText("Impressora do produto importado"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Filamento 1 do produto importado"), { target: { value: "pla" } });
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    expect(loaded.mock.calls.at(-1)?.[0]).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Esta impressão usa um único filamento" }));
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.cost).toBe(12.2));
  });

  it("clears a previous calculation when the imported estimate disappears or errors", async () => {
    const { loaded, rerender } = mount();
    await waitFor(() => expect(cost()).toHaveTextContent(/12,20/));
    rerender(null, "O MakerWorld não informou consumo completo.");
    await waitFor(() => expect(loaded).toHaveBeenLastCalledWith(null));
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("O MakerWorld não informou consumo completo.");
  });

  it("blocks a mismatched material and clears the value sent to the product form", async () => {
    mock.filaments.push({ ...pla, id: "petg", name: "PETG vermelho", material_code: "PETG" });
    const { loaded } = mount();
    await waitFor(() => expect(cost()).toHaveTextContent(/12,20/));
    fireEvent.click(screen.getByRole("button", { name: "Alterar impressora ou filamento" }));
    fireEvent.change(screen.getByLabelText("Filamento 1 do produto importado"), { target: { value: "petg" } });
    await waitFor(() => expect(loaded).toHaveBeenLastCalledWith(null));
    expect(screen.getByRole("alert")).toHaveTextContent("não corresponde ao material do perfil");
  });

  it("does not turn an unconfigured energy tariff into zero", async () => {
    mock.policy.energy_cost_kwh = null;
    const { loaded } = mount();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("tarifa de energia"));
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    expect(loaded).toHaveBeenLastCalledWith(null);
  });
});
