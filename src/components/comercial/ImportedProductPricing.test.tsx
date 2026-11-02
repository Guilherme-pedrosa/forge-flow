import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportedProductPricing } from "./ImportedProductPricing";
import type { ModelPricingEstimate } from "@/lib/model-pricing";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), printers: [] as Record<string, unknown>[], filaments: [] as Record<string, unknown>[], movements: [] as Record<string, unknown>[], policy: {} as Record<string, unknown>, columns: [] as string[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "import-company" }, user: { id: "import-user" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string }) =>
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
const estimate: ModelPricingEstimate = { hours: 2, timeSeconds: 7200, weightGrams: 100, plateCount: 2, partCount: 2,
  printerModelIds: ["Bambu Lab A1"], nozzleDiameters: ["0.4"],
  materials: [{ key: "red", slotId: 1, materialCode: "PLA", colorHex: "#FF0000", grams: 100, plateIndices: [1, 2], name: "PLA vermelho" }] };
const multicolor: ModelPricingEstimate = { ...estimate, plateCount: 1, needAms: true, materials: [
  { ...estimate.materials[0], grams: 20, plateIndices: [1] },
  { ...estimate.materials[0], key: "green", slotId: 2, colorHex: "#00FF00", grams: 30, plateIndices: [1], name: "PLA verde" },
  { ...estimate.materials[0], key: "blue", slotId: 3, colorHex: "#0000FF", grams: 50, plateIndices: [1], name: "PLA azul" },
] };
const policy = { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 0, target_margin: 50,
  handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  printer_hour_costs: [], machine_rate_scope: "commercial_excludes_energy", revision: "confirmed" };
const a1 = { id: "a1", name: "A1 oficina", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000 };
const pla = { id: "pla", name: "PLA vermelho cadastrado", unit: "kg", avg_cost: 80, material_code: "PLA", color_hex: "#FF0000" };
beforeEach(() => {
  mock.printers = [a1]; mock.filaments = [pla]; mock.movements = []; mock.policy = { ...policy }; mock.columns.length = 0;
  mock.from.mockReset().mockImplementation((table: string) => {
    const query = { select: (columns: string) => { mock.columns.push(columns); return query; }, eq: () => query, gt: () => query, in: () => query, order: () => query,
      range: async () => ({ data: table === "printers" ? mock.printers : table === "inventory_movements" ? mock.movements : mock.filaments, error: null }) };
    return query;
  });
  mock.rpc.mockReset().mockImplementation(async (name: string) => name === "pricing_settings" ? { data: mock.policy, error: null } : { data: null, error: { message: "Unexpected write" } });
});
function mount(value: ModelPricingEstimate | null = estimate, loaded = vi.fn(), error?: string, options: { initialQuantity?: number; initialSelections?: Record<string, string>; showTotals?: boolean; existingPrinterId?: string; onAuxiliaryBusy?: (busy: boolean) => void; onAuxiliaryDraft?: (open: boolean) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: ModelPricingEstimate | null, nextError?: string) => <QueryClientProvider client={client}><MemoryRouter><ImportedProductPricing estimate={next} error={nextError} onCalculated={loaded} {...options} /></MemoryRouter></QueryClientProvider>;
  const result = render(ui(value, error));
  return { loaded, rerender: (next: ModelPricingEstimate | null, nextError?: string) => result.rerender(ui(next, nextError)) };
}
const cost = () => screen.getByText("Custo por peça").parentElement?.querySelector("dd");
const createdId = "84000000-0000-4000-8000-000000000001";
function inventoryWriter(lostResponse = false) {
  const read = mock.rpc.getMockImplementation()!;
  let committed = false, lost = lostResponse;
  mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== "save_inventory_catalog") return read(name, args);
    const data = args.p_item as Record<string, unknown>;
    if (args.p_item_id) {
      const existing = mock.filaments.find(item => item.id === args.p_item_id)!; Object.assign(existing, data);
    } else if (!committed) { mock.filaments.push({ id: createdId, ...data }); committed = true; }
    if (lost) { lost = false; throw new Error("A conexão caiu após o cadastro"); }
    return { data: args.p_item_id || createdId, error: null };
  });
}
function editField(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }

describe("ImportedProductPricing", () => {
  it("creates the missing color in place and assigns it only to the intended slot without resetting the sliced source or quantity", async () => {
    mock.filaments.push({ ...pla, id: "green", color_hex: "#00FF00", name: "PLA verde" });
    inventoryWriter(); const draft = vi.fn();
    const { loaded } = mount(multicolor, vi.fn(), undefined, { onAuxiliaryDraft: draft });
    await screen.findByLabelText("Filamento 3 do produto importado"); editField("Produtos completos neste perfil", "2");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar filamento 3 do produto importado" }));
    const dialog = await screen.findByRole("dialog", { name: "Cadastrar filamento" });
    expect(within(dialog).getByLabelText("Material")).toHaveValue("PLA");
    expect(within(dialog).getByLabelText("Cor *")).toHaveValue("");
    expect(within(dialog).getByText(/Cor do arquivo:/)).toHaveTextContent("#0000FF");
    expect(draft).toHaveBeenLastCalledWith(true); editField("Cor *", "Azul"); editField("Custo médio (R$/kg)", "100");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar filamento" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ quantity: 2, cost: 6.6, materialSelections: { red: "pla", green: "green", blue: createdId } }));
    expect(screen.getByLabelText("Produtos completos neste perfil")).toHaveValue(2);
    expect(screen.getByText(/2 h · 100 g · 1 placa/)).toBeInTheDocument();
    expect(draft).toHaveBeenLastCalledWith(false);
    expect(mock.rpc.mock.calls.find(([name]) => name === "save_inventory_catalog")?.[1]).toMatchObject({ p_item: { current_stock: 0, color_hex: "#0000FF" } });
  });
  it("preserves a valid calculation and selections after cancelling inline registration", async () => {
    const { loaded } = mount(); await waitFor(() => expect(cost()).toHaveTextContent("12,20"));
    editField("Produtos completos neste perfil", "3");
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.quantity).toBe(3));
    const previous = loaded.mock.calls.at(-1)?.[0];
    fireEvent.click(screen.getByRole("button", { name: "Alterar modelo ou filamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar filamento 1 do produto importado" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByLabelText("Produtos completos neste perfil")).toHaveValue(3);
    expect(screen.getByLabelText("Filamento 1 do produto importado")).toHaveValue("pla");
    expect(loaded.mock.calls.at(-1)?.[0]).toEqual(previous);
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });
  it("retries the same inline creation after a lost response without losing its source or making another stock item", async () => {
    mock.filaments = []; inventoryWriter(true);
    const { loaded } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar filamento 1 do produto importado" }));
    const dialog = await screen.findByRole("dialog"); editField("Cor *", "Vermelho"); editField("Custo médio (R$/kg)", "80");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar filamento" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A conexão caiu após o cadastro");
    expect(within(dialog).getByLabelText("Cor *")).toHaveValue("Vermelho");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar filamento" }));
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ cost: 12.2, materialSelections: { red: createdId } }));
    const writes = mock.rpc.mock.calls.filter(([name]) => name === "save_inventory_catalog");
    expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]); expect(mock.filaments).toHaveLength(1);
  });
  it("keeps a created zero-stock color's unknown cost pending and lets its rate be completed in place without touching stock", async () => {
    mock.filaments = []; inventoryWriter(); const { loaded } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar filamento 1 do produto importado" }));
    let dialog = await screen.findByRole("dialog"); editField("Cor *", "Vermelho");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar filamento" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o custo deste filamento"); expect(loaded).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Informar custo do filamento 1" }));
    dialog = await screen.findByRole("dialog", { name: "Editar filamento" });
    expect(within(dialog).getByLabelText("Estoque atual (g)")).toHaveValue("0"); editField("Custo médio (R$/kg)", "80");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar filamento" }));
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.cost).toBe(12.2));
    const write = mock.rpc.mock.calls.filter(([name]) => name === "save_inventory_catalog").at(-1)?.[1];
    expect(write).toMatchObject({ p_item_id: createdId, p_item: { avg_cost: .08 } });
    expect(write.p_item).not.toHaveProperty("current_stock"); expect(write.p_item).not.toHaveProperty("expected_stock");
  });
  it("reports pending auxiliary writes and never applies the saved stock id to a replacement source", async () => {
    mock.filaments = []; const read = mock.rpc.getMockImplementation()!;
    let finish!: (result: unknown) => void;
    mock.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === "save_inventory_catalog" ? new Promise(resolve => { finish = resolve; mock.filaments.push({ id: createdId, ...args.p_item as Record<string, unknown> }); }) : read(name, args));
    const busy = vi.fn(), draft = vi.fn(); const { rerender, loaded } = mount(estimate, vi.fn(), undefined, { onAuxiliaryBusy: busy, onAuxiliaryDraft: draft });
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar filamento 1 do produto importado" }));
    const dialog = await screen.findByRole("dialog"); editField("Cor *", "Vermelho"); editField("Custo médio (R$/kg)", "80");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar filamento" }));
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(true));
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    rerender({ ...estimate, hours: 3, timeSeconds: 10800, materials: [{ ...estimate.materials[0], materialCode: "PETG", name: "PETG vermelho" }] });
    await act(async () => finish({ data: createdId, error: null }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Filamento 1 do produto importado")).toHaveValue(""); expect(loaded).toHaveBeenLastCalledWith(null);
    expect(busy).toHaveBeenLastCalledWith(false); expect(draft).toHaveBeenLastCalledWith(false);
  });
  it.each([0, null])("keeps a new color's %s acquisition rate pending instead of presenting a complete cost", async avg_cost => {
    mock.filaments = [{ ...pla, avg_cost }];
    const { loaded } = mount();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Informe o custo deste filamento ou registre uma compra recebida."));
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    expect(screen.queryByText("Preço sugerido")).not.toBeInTheDocument();
    expect(loaded).toHaveBeenLastCalledWith(null);
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });

  it("accepts zero material cost when the stock ledger confirms an explicit free acquisition", async () => {
    mock.filaments = [{ ...pla, avg_cost: 0 }]; mock.movements = [{ item_id: "pla" }];
    const { loaded } = mount();
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ cost: 4.2, price: 8.4 }));
    expect(cost()).toHaveTextContent(/4,20/);
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });
  it("chooses the compatible registered model across five A1 machines without asking for individual nicknames", async () => {
    mock.printers = [a1, ...["Babi", "Bambina", "Bentolino", "Oficina"].map((name, index) => ({ ...a1, id: `a1-${index}`, name })), { ...a1, id: "a2l", name: "Outra impressora", model: "A2L" }];
    const { loaded } = mount();
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.printerId).toBe("a1"));
    expect(screen.getByText("Modelo: A1")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Alterar modelo ou filamento" }));
    const models = screen.getByLabelText("Modelo de impressão");
    expect(models.querySelectorAll("option")).toHaveLength(3);
    expect(screen.queryByRole("option", { name: "Babi" })).not.toBeInTheDocument();
  });

  it("preserves a saved machine as its model representative and supports exact registered A2L slicing", async () => {
    mock.printers.push({ ...a1, id: "saved-a1", name: "Bambina" });
    const { loaded } = mount(estimate, vi.fn(), undefined, { existingPrinterId: "saved-a1" });
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.printerId).toBe("saved-a1"));
    expect(screen.getByText("Modelo: A1")).toBeVisible();
  });

  it("automatically chooses the exact registered A2L model instead of assuming an A1 alias", async () => {
    mock.printers.push({ ...a1, id: "a2l", name: "Impressora com apelido", model: "A2L", power_watts: 150 });
    const { loaded } = mount({ ...estimate, printerModelIds: ["A2L"] });
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ printerId: "a2l", cost: 12.3 }));
    expect(screen.getByText("Modelo: A2L")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("preserves each color's stock selection and cost without inventing an AMS fee", async () => {
    mock.filaments = [pla, { ...pla, id: "green", name: "PLA verde", color_hex: "#00FF00", avg_cost: 100 }, { ...pla, id: "blue", name: "PLA azul", color_hex: "#0000FF", avg_cost: 120 }];
    const { loaded } = mount(multicolor);
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ cost: 14.8, materialId: null, materialSelections: { red: "pla", green: "green", blue: "blue" } }));
    expect(screen.getByText("Este perfil informa uso de AMS.")).toBeVisible();
    expect(screen.getByText(/A purga só entra quando já está incluída/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sem AMS, em placas separadas" }));
    await waitFor(() => expect(loaded).toHaveBeenLastCalledWith(null));
    expect(screen.getByRole("alert")).toHaveTextContent(/importe o novo 3MF fatiado/);
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Como o perfil importado (AMS/multicor)" }));
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.cost).toBe(14.8));
  });

  it("never silently maps three source colors to the only white spool and requires an explicit one-color choice", async () => {
    mock.filaments = [{ ...pla, id: "white", name: "PLA branco", color_hex: "#FFFFFF" }];
    const { loaded } = mount(multicolor);
    for (const index of [1, 2, 3]) {
      const filament = await screen.findByLabelText(`Filamento ${index} do produto importado`);
      expect(filament).toHaveValue("");
      fireEvent.change(filament, { target: { value: "white" } });
    }
    expect(loaded.mock.calls.at(-1)?.[0]).toBeNull();
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Quero produzir todas as cores com o mesmo filamento" }));
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ cost: 12.2, materialId: "white", materialSelections: { red: "white", green: "white", blue: "white" } }));
  });

  it("reuses saved quantity and material mappings without repeating the financial summary", async () => {
    mock.filaments.push({ ...pla, id: "saved", name: "Bobina escolhida", avg_cost: 100 });
    const { loaded } = mount(estimate, vi.fn(), undefined, { initialQuantity: 2, initialSelections: { red: "saved" }, showTotals: false });
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ cost: 7.1, quantity: 2, materialSelections: { red: "saved" } }));
    expect(screen.getByLabelText("Produtos completos neste perfil")).toHaveValue(2);
    expect(screen.getByText("Filamento: Bobina escolhida")).toBeVisible();
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    expect(screen.queryByText("Preço sugerido")).not.toBeInTheDocument();
  });

  it("identifies a native mixed plate without claiming known AMS use, and accepts separately sliced plates", async () => {
    mock.filaments = [pla, { ...pla, id: "green", color_hex: "#00FF00" }, { ...pla, id: "blue", color_hex: "#0000FF" }];
    const native = { ...multicolor, needAms: null };
    const { loaded, rerender } = mount(native);
    expect(await screen.findByText(/O arquivo não confirma se usa AMS/)).toBeVisible();
    expect(screen.queryByText("Este perfil informa uso de AMS.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sem AMS, em placas separadas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/importe o novo 3MF fatiado/);
    rerender({ ...native, needAms: false, plateCount: 3, materials: native.materials.map((material, index) => ({ ...material, plateIndices: [index + 1] })) });
    expect(screen.queryByRole("button", { name: "Sem AMS, em placas separadas" })).not.toBeInTheDocument();
    expect(screen.queryByText(/O arquivo não confirma se usa AMS/)).not.toBeInTheDocument();
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]?.cost).toBe(12.2));
  });

  it("automatically reports a complete cost and price from unique saved resources with no tariff questions", async () => {
    const { loaded } = mount();
    await waitFor(() => expect(loaded).toHaveBeenLastCalledWith({ cost: 12.2, price: 24.4, materialId: "pla", materialSelections: { red: "pla" }, printerId: "a1", quantity: 1, marginPercent: 50 }));
    expect(cost()).toHaveTextContent(/12,20/);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Modelo: A1")).toBeInTheDocument();
    expect(screen.getByText("Filamento: PLA vermelho cadastrado")).toBeInTheDocument();
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
    for (const columns of mock.columns) expect(columns).not.toMatch(/\*|password|token|access_code|ip_address|serial_number/);
  });

  it("asks for only ambiguous printer and filament choices before calculating", async () => {
    mock.printers.push({ ...a1, id: "a2l", name: "Bentolino", model: "A2L" });
    mock.filaments.push({ ...pla, id: "other-pla", name: "Outra bobina PLA vermelha" });
    const { loaded } = mount({ ...estimate, printerModelIds: [] });
    const printer = await screen.findByLabelText("Modelo de impressão");
    expect(screen.getByRole("option", { name: "A1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "A2L" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Bentolino" })).not.toBeInTheDocument();
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

  it.each(["handling_minutes_per_plate", "finishing_minutes_per_piece", "assembly_minutes_per_product", "extras_cost_per_product", "labor_cost_hour"])("keeps unknown company %s pending instead of reducing it to zero", async key => {
    mock.policy[key] = null;
    const { loaded } = mount();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Confirme"));
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    expect(loaded).toHaveBeenLastCalledWith(null);
  });

  it("confirms the missing standards in place and recalculates without losing the source, filament or finished-product quantity", async () => {
    mock.policy = { ...policy, finishing_minutes_per_piece: null, assembly_minutes_per_product: null, extras_cost_per_product: null, printer_hour_costs: [{ printer_id: "a1", hour_cost: 2 }] };
    const read = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name !== "save_pricing_settings") return read(name, args);
      mock.policy = { ...mock.policy, ...(args.p_settings as object), revision: "policy-2" };
      return { data: "saved-policy", error: null };
    });
    const draft = vi.fn(), busy = vi.fn(), { loaded } = mount(estimate, vi.fn(), undefined, { onAuxiliaryDraft: draft, onAuxiliaryBusy: busy });
    await screen.findByText("Confirme os custos que faltam");
    editField("Produtos completos neste perfil", "3");
    for (const label of ["Acabamento padrão por peça (min)", "Montagem por produto completo (min)", "Outros insumos padrão por produto (R$)"])
      fireEvent.click(screen.getByRole("button", { name: `Considerar zero: ${label}` }));
    expect(draft).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Salvar parâmetros e recalcular" }));
    await waitFor(() => expect(loaded.mock.calls.at(-1)?.[0]).toMatchObject({ cost: 4.0667, quantity: 3, printerId: "a1", materialSelections: { [estimate.materials[0].key]: "pla" } }));
    expect(screen.getByLabelText("Produtos completos neste perfil")).toHaveValue(3);
    expect(screen.getByText(/2 h · 100 g · 2 placa/)).toBeInTheDocument();
    expect(screen.getByText("Filamento: PLA vermelho cadastrado")).toBeInTheDocument();
    expect(draft).toHaveBeenLastCalledWith(false); expect(busy).toHaveBeenLastCalledWith(false);
    const saved = mock.rpc.mock.calls.find(([name]) => name === "save_pricing_settings")?.[1];
    expect(saved).toMatchObject({ p_settings: { printer_hour_costs: [{ printer_id: "a1", hour_cost: 2 }], handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0 } });
  });

  it("requires explicit stock selection and single-filament confirmation for an unknown placeholder", async () => {
    const unknown = { ...estimate, printerModelIds: [], materials: [{ ...estimate.materials[0], key: "unknown", slotId: null, materialCode: null, colorHex: null, name: "Filamento não informado" }] };
    const { loaded } = mount(unknown);
    fireEvent.change(await screen.findByLabelText("Filamento 1 do produto importado"), { target: { value: "pla" } });
    expect(screen.getByText("Modelo: A1")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Alterar modelo ou filamento" }));
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
