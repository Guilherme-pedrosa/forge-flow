import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";
import type { ImportedComposition } from "@/lib/imported-composition";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), upload: vi.fn(), parsedOnly: vi.fn(), useCubeMetrics: false, useMultiplePlates: false, existing: false }));
const abortDescriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
beforeAll(() => { if (!abortDescriptor) Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { configurable: true, value(this: AbortSignal) { if (this.aborted) throw new DOMException("Consulta cancelada", "AbortError"); } }); });
afterAll(() => { if (!abortDescriptor) delete (AbortSignal.prototype as unknown as Record<string, unknown>).throwIfAborted; });
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" }, user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/lib/public-description-translation", () => ({ translatePublicDescription: async (text: string) => text }));
vi.mock("@/pages/comercial/ProductMaterialRecipe", () => ({ default: () => null }));
vi.mock("@/pages/comercial/ProductPrintSources", () => ({ default: () => null }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string }) =>
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/comercial/ModelFileInput", () => ({ default: ({ onParsed, onFileReady }: { onParsed: (composition: ImportedComposition) => void; onFileReady: (file: File) => void }) => <button type="button" onClick={async () => {
  const bytes = new Uint8Array([1, 2, 3]), file = new File([bytes], "produto-fatiado.3mf");
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  onFileReady(file); mock.parsedOnly();
  // Deliberately call only the parser notification, without the separate
  // "use composition" confirmation: reading a sliced file must price it.
  const composition = structuredClone(nativeComposition);
  if (mock.useCubeMetrics) {
    composition.plates[0].weight_grams = 3.63;
    composition.plates[0].time_seconds = 1351;
    composition.plates[0].slicer_estimates!.filaments[0].weight_grams = 3.63;
  }
  if (mock.useMultiplePlates) {
    const second = structuredClone(composition.plates[0]);
    composition.enabled = true;
    composition.plates[0].weight_grams = 40; composition.plates[0].time_seconds = 1800;
    composition.plates[0].slicer_estimates!.filaments = [
      { id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: 12, length_meters: null },
      { id: 2, material_code: "PLA", color_hex: "#00FF00", weight_grams: 28, length_meters: null },
    ];
    second.index = 2; second.label = "Tampa"; second.weight_grams = 60; second.time_seconds = 5400;
    second.slicer_estimates!.filaments = [
      { id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: 58, length_meters: null },
      { id: 2, material_code: "PLA", color_hex: "#00FF00", weight_grams: 2, length_meters: null },
    ];
    composition.plates.push(second);
  }
  onParsed({ ...composition, profile_id: `local:${hash}`, file_sha256: hash });
}}>Ler 3MF fatiado de teste</button> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc, functions: { invoke: async () => ({ data: { projects: [] }, error: null }) },
  storage: { from: () => ({ upload: mock.upload, getPublicUrl: () => ({ data: { publicUrl: "https://example.test/model.3mf" } }) }) },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query, range: () => query, single: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: table === "products" && mock.existing ? [existingProduct] : table === "inventory_items" ? (mock.useMultiplePlates ? [filament, greenFilament] : [filament]) : table === "printers" ? [printer] : table === "tenants" ? { settings: {} } : [], error: null }).then(resolve, reject) };
    return query;
  },
} }));
const filament = { id: "pla", name: "PLA vermelho cadastrado", category: "filament", unit: "kg", avg_cost: 80, freight_cost: 0, loss_coefficient: 0, material_code: "PLA", color_hex: "#FF0000", is_active: true };
const greenFilament = { ...filament, id: "pla-green", name: "PLA verde cadastrado", color_hex: "#00FF00" };
const printer = { id: "a1", name: "A1 oficina", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000, is_active: true };
const existingProduct = { id: "existing", name: "Produto existente", category: "printed_part", is_active: true, manual_cost_override: 17, cost_estimate: 17, sale_price: 34, prints_per_plate: 1, num_colors: 1, extras: [] };
const policy = { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 0, target_margin: 50,
  handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  printer_hour_costs: [], machine_rate_scope: "commercial_excludes_energy", revision: "confirmed" };
const nativeComposition: ImportedComposition = { profile_id: "local:parsed-file", enabled: false, plates: [{
  index: 1, label: "Corpo", photo_url: null, units_per_plate: 1, weight_grams: 100, time_seconds: 7200,
  parts: [{ source_key: "body", name: "Corpo", photo_url: null, quantity_per_product: 1, quantity_per_plate: 1, name_source: "file" }],
  slicer_estimates: { source: "3mf_slice_info", slicer_version: "02.08.02.61", printer_model_id: "Bambu Lab A1", nozzle_diameters: "0.4",
    filaments: [{ id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: 100, length_meters: null }] },
}] };
const rawDesign = { id: 456, title: "Produto MakerWorld", instances: [{ id: 101, profileId: 501, title: "PLA A1", extention: { modelInfo: {
  compatibility: { devProductName: "A1", devModelName: "N2S", nozzleDiameter: 0.4 },
  plates: [{ index: 1, name: "Corpo", weight: 100, prediction: 7200, objects: [{ id: 1, name: "Corpo", quantity: 1 }], filaments: [{ id: "1", type: "PLA", color: "#FF0000", usedG: 100 }] }],
} } }] };

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mock.rpc.mockReset(); mock.toast.mockReset(); mock.upload.mockReset().mockResolvedValue({ data: { path: "saved.3mf" }, error: null }); mock.parsedOnly.mockReset();
  mock.useCubeMetrics = false;
  mock.useMultiplePlates = false;
  mock.existing = false;
  mock.rpc.mockImplementation(async (name: string) => {
    if (name === "pricing_settings") return { data: policy, error: null };
    if (name === "product_material_recipe_catalog") return { data: [], error: null };
    if (name === "product_pricing_plan") return { data: { plan: {}, revision: "plan-r1" }, error: null };
    if (name === "request_makerworld_import") return { data: "maker-request", error: null };
    if (name === "get_makerworld_import") return { data: { status: "ready", payload: rawDesign }, error: null };
    if (name === "save_product_with_photos") return { data: "saved-product", error: null };
    return { data: [], error: null };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(path = "/comercial/produtos") {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Produtos /></MemoryRouter></QueryClientProvider>);
}
it("opens the extension entry in the product form, prefilling only a supported public model link without starting an import", async () => {
  mount("/comercial/produtos?novo=1&aba=producao&makerworld=" + encodeURIComponent("https://makerworld.com/models/744793"));
  const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
  expect(within(editor).getByRole("tab", { name: "Produto e preço" })).toHaveAttribute("aria-selected", "true");
  const cadastro = within(editor).getByRole("tabpanel", { name: "Produto e preço" });
  expect(within(cadastro).getByLabelText("Nome *")).toBeVisible();
  expect(within(cadastro).getByLabelText("Importar produto completo pelo link do MakerWorld")).toBeVisible();
  expect((within(cadastro).getByLabelText("Importar produto completo pelo link do MakerWorld") as HTMLInputElement).value).toContain("/models/744793");
  expect(within(cadastro).getByRole("button", { name: "Ler 3MF fatiado de teste" })).toBeVisible();
  expect(within(cadastro).getByLabelText("Preço de custo (R$)")).toBeVisible();
  expect(within(cadastro).getByLabelText("Preço unitário (R$)")).toBeVisible();
  expect(mock.rpc.mock.calls.some(([name]) => /request_makerworld|save_product/.test(name))).toBe(false);
});
async function newProduct() {
  fireEvent.click(screen.getByRole("button", { name: "Novo Produto" }));
  return screen.findByRole("dialog", { name: "Novo Produto" });
}
const saved = () => mock.rpc.mock.calls.find(([name]) => name === "save_product_with_photos")?.[1] as { p_product: Record<string, any> } | undefined;
async function loadNative(expectedCost = "12.2") {
  const editor = await newProduct();
  fireEvent.change(within(editor).getByLabelText("Nome *"), { target: { value: "Produto do arquivo" } });
  expect(within(editor).getByRole("tab", { name: "Produto e preço" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(await within(editor).findByRole("button", { name: "Ler 3MF fatiado de teste" }));
  await waitFor(() => expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue(expectedCost));
  return editor;
}

describe("automatic costs in the product import editor", () => {
  it("fills and saves native 3MF cost and sale price as soon as the file is parsed", async () => {
    mount(); const editor = await loadNative();
    expect(mock.parsedOnly).toHaveBeenCalledTimes(1);
    expect(within(editor).getByRole("tab", { name: "Produto e preço" })).toHaveAttribute("data-state", "active");
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveAttribute("readonly");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("24.40");
    expect(within(editor).getByLabelText("Lucro sobre o custo (%)")).toHaveValue("100");
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 12.2, manual_cost: 12.2, sale_price: 24.4, material_id: "pla", margin_percent: 50 });
    expect(saved()!.p_product.file_composition.file_path).toContain("tenant-1/");
    expect(saved()!.p_product.import_pricing).toEqual({ version: 1, printer_id: "a1", quantity: 1,
      source_profile_id: saved()!.p_product.file_composition.profile_id, source_file_sha256: saved()!.p_product.file_composition.file_sha256,
      materials: [{ source_key: JSON.stringify([1, "PLA", "#FF0000"]), item_id: "pla", material_code: "PLA", color_hex: "#FF0000", slot_id: 1 }],
      plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "pla", grams: 100 }] }] });
    expect(saved()!.p_product.file_composition.profile_id).toBe(`local:${saved()!.p_product.file_composition.file_sha256}`);
    expect(mock.upload).toHaveBeenCalledTimes(1);
    expect(mock.rpc.mock.calls.some(([name]) => name === "product_pricing_plan")).toBe(false);
  });

  it("adds product extras once to the native base and updates the price without changing sliced weights or preparation", async () => {
    mount(); const editor = await loadNative();
    fireEvent.click(within(editor).getByText("Peças, composição e referências de produção", { selector: "summary" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Adicionar Item" }));
    const name = within(editor).getByPlaceholderText("Ex: Chocolate, Embalagem, Laço..."), row = name.parentElement!;
    fireEvent.change(name, { target: { value: "Laço novo" } });
    const extra = within(row).getByPlaceholderText("0,00");
    fireEvent.change(extra, { target: { value: "2,50" } });
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("14.7");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("29.40");
    fireEvent.change(extra, { target: { value: "3,50" } });
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("15.7");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("31.40");
    fireEvent.change(extra, { target: { value: "2.5.6" } });
    expect(within(editor).getByRole("alert")).toHaveTextContent("custo válido para o adicional");
    fireEvent.change(extra, { target: { value: "2,50" } });
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ })); await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 14.7, sale_price: 29.4, extras: [{ name: "Laço novo", cost: 2.5 }],
      import_pricing: { quantity: 1, plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "pla", grams: 100 }] }] },
      file_composition: { plates: [{ weight_grams: 100, time_seconds: 7200 }] } });
  });

  it.each(["custom", "error", "empty"])("checks an existing product's %s pricing plan before accepting the new source's automatic cost", async kind => {
    mock.existing = true; const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async (name: string, args: unknown) => name === "product_pricing_plan"
      ? kind === "custom" ? { data: { plan: { consumables: [{ item_id: "box", quantity: 1 }] }, revision: "custom-r1" }, error: null }
        : kind === "error" ? { data: null, error: { message: "Plano indisponível" } } : { data: { plan: {}, revision: "empty-r1" }, error: null } : original(name, args));
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Editar Produto existente" }));
    const editor = screen.getByRole("dialog", { name: "Editar Produto" });
    fireEvent.change(within(editor).getByLabelText("Importar produto completo pelo link do MakerWorld"), { target: { value: "https://makerworld.com/en/models/456#profileId-101" } });
    const load = within(editor).getByRole("button", { name: "Carregar modelo" });
    await waitFor(() => expect(load).toBeEnabled()); fireEvent.click(load);
    const choice = await screen.findByRole("dialog", { name: "Escolha a opção de impressão" });
    fireEvent.click(within(choice).getByRole("button", { name: "Importar esta opção" }));
    fireEvent.mouseDown(within(editor).getByRole("tab", { name: "Composição / produção" }), { button: 0, ctrlKey: false });
    fireEvent.click(await within(editor).findByRole("button", { name: "Ler 3MF fatiado de teste" }));
    if (kind === "empty") {
      await waitFor(() => expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("12.2"));
      expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("24.40");
      return;
    }
    await within(editor).findByText(kind === "custom" ? /Este produto tem ajustes próprios/ : /Não foi possível conferir os ajustes de custo/);
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("");
    fireEvent.click(within(editor).getByRole("button", { name: "Prefiro informar o custo manualmente" }));
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("");
    expect(within(editor).getByLabelText("Preço de custo (R$)")).not.toHaveAttribute("readonly");
    expect(saved()).toBeUndefined();
  });

  it("recalculates cost for the imported quantity while preserving the user's percentage", async () => {
    mount(); const editor = await loadNative();
    fireEvent.change(within(editor).getByLabelText("Lucro sobre o custo (%)"), { target: { value: "50" } });
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("18.30");
    fireEvent.change(within(editor).getByLabelText("Produtos completos neste perfil"), { target: { value: "2" } });
    await waitFor(() => expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("6.1"));
    expect(within(editor).getByLabelText("Lucro sobre o custo (%)")).toHaveValue("50");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("9.15");
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 6.1, sale_price: 9.15, prints_per_plate: 2 });
    expect(saved()!.p_product.import_pricing).toMatchObject({ printer_id: "a1", quantity: 2,
      plates: [{ index: 1, units_per_plate: 2, lines: [{ item_id: "pla", grams: 100 }] }] });
  });

  it("preserves decimal consumption and native seconds when pricing and saving captured cube metrics", async () => {
    // Same native metrics as fixtures/bambu-cube-slice-info.config: 3.63g/1351s.
    // Material .2904 + machine .750555... + energy .037527... = 1.078483...
    // The form saves four cost decimals and R$2.16 at 50% sales margin.
    mock.useCubeMetrics = true;
    mount(); const editor = await loadNative("1.0785");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("2.16");
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 1.0785, manual_cost: 1.0785, sale_price: 2.16, est_grams: 3.63 });
    expect(saved()!.p_product.file_composition.plates[0]).toMatchObject({ weight_grams: 3.63, time_seconds: 1351 });
    expect(saved()!.p_product.import_pricing).toMatchObject({ printer_id: "a1", quantity: 1,
      plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "pla", grams: 3.63 }] }] });
  });

  it("saves both native plates' actual material distribution together with the cost", async () => {
    mock.useMultiplePlates = true;
    mount(); const editor = await loadNative();
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 12.2, sale_price: 24.4 });
    expect(saved()!.p_product.import_pricing).toMatchObject({ printer_id: "a1", quantity: 1,
      materials: [
        { source_key: JSON.stringify([1, "PLA", "#FF0000"]), item_id: "pla", slot_id: 1 },
        { source_key: JSON.stringify([2, "PLA", "#00FF00"]), item_id: "pla-green", slot_id: 2 },
      ], plates: [
        { index: 1, units_per_plate: 1, lines: [{ item_id: "pla", grams: 12 }, { item_id: "pla-green", grams: 28 }] },
        { index: 2, units_per_plate: 1, lines: [{ item_id: "pla", grams: 58 }, { item_id: "pla-green", grams: 2 }] },
      ] });
  });

  it("fills cost and price in the same editor after importing a MakerWorld link", async () => {
    mount(); const editor = await newProduct();
    fireEvent.change(within(editor).getByLabelText("Importar produto completo pelo link do MakerWorld"), { target: { value: "https://makerworld.com/en/models/456#profileId-101" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Carregar modelo" }));
    const choice = await screen.findByRole("dialog", { name: "Escolha a opção de impressão" });
    fireEvent.click(within(choice).getByRole("button", { name: "Importar esta opção" }));
    const imported = await screen.findByRole("dialog", { name: "Novo Produto" });
    await waitFor(() => expect(within(imported).getByLabelText("Preço de custo (R$)")).toHaveValue("12.2"));
    expect(within(imported).getByLabelText("Preço unitário (R$)")).toHaveValue("24.40");
    fireEvent.click(within(imported).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ name: "Produto MakerWorld", cost_estimate: 12.2, sale_price: 24.4, material_id: "pla" });
    expect(saved()!.p_product.external_import).toMatchObject({ selected_profile_id: "101", selected_variant_profile_id: "501" });
    expect(saved()!.p_product.import_pricing).toEqual({ version: 1, printer_id: "a1", quantity: 1, source_profile_id: "501",
      materials: [{ source_key: JSON.stringify(["makerworld", "PLA", "#FF0000"]), item_id: "pla", material_code: "PLA", color_hex: "#FF0000", slot_id: null }],
      plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "pla", grams: 100 }] }] });
  });
});
