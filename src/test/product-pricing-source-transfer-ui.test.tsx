import { createHash, webcrypto } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";
import { parseModelFile, disposeModel } from "@/lib/model-file";
import { modelPricingFromComposition, modelPricingFromMakerWorld } from "@/lib/model-pricing";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import type { ImportedComposition } from "@/lib/imported-composition";
import type { PricingInput, PricingTransfer } from "@/lib/print-pricing";
import { createPricingSourceTransfer, discardPricingSourceTransfer, MISSING_PRICING_SOURCE_TRANSFER, PRICING_SOURCE_TRANSFER_TTL_MS } from "@/lib/pricing-source-transfer";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), upload: vi.fn(),
  reimport: null as { file: File; composition: ImportedComposition } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" }, user: { id: "user-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/lib/public-description-translation", () => ({ translatePublicDescription: async (text: string) => text }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string }) =>
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
// Keep WebGL out of this persistence regression. The File and composition below
// are parsed by the real importer before exercising the normal editor callbacks.
vi.mock("@/components/comercial/ModelFileInput", () => ({ default: ({ onFileReady, onParsed, onBusyChange }: {
  onFileReady: (file: File) => void; onParsed: (composition: ImportedComposition) => void; onBusyChange?: (busy: boolean) => void }) => <>
  <button type="button" onClick={() => { onBusyChange?.(true); onFileReady(mock.reimport!.file); onBusyChange?.(false); onParsed(mock.reimport!.composition); }}>Reimportar arquivo neste cadastro</button>
  <button type="button" onClick={() => { onBusyChange?.(true); onBusyChange?.(false); }}>Substituir por arquivo inválido</button>
</> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc, functions: { invoke: async () => ({ data: { projects: [] }, error: null }) },
  storage: { from: () => ({ upload: mock.upload, getPublicUrl: () => ({ data: { publicUrl: "https://example.test/model.3mf" } }) }) },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, gt: () => query, is: () => query, in: () => query, order: () => query,
      range: () => query, single: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({
        data: table === "inventory_items" ? [red, green] : table === "printers" ? [printer] : table === "tenants" ? { settings: {} } : [], error: null,
      }).then(resolve, reject) };
    return query;
  },
} }));
const red = { id: "pla", name: "PLA vermelho", category: "filament", unit: "kg", avg_cost: 80,
  freight_cost: 0, loss_coefficient: 0, material_code: "PLA", color_hex: "#FF0000", is_active: true };
const green = { ...red, id: "pla-green", name: "PLA verde", color_hex: "#00FF00" };
const printer = { id: "a1", name: "A1 da oficina", brand: "Bambu Lab", model: "A1", power_watts: 100,
  depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000, is_active: true };
const policy = { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 0, target_margin: 50,
  handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  printer_hour_costs: [], machine_rate_scope: "commercial_excludes_energy", revision: "current-policy" };
const accepted: PricingTransfer = { name: "Produto aceito na precificação", cost: 17.1234, price: 34.9, quantity: 7, quote: true };
const input: PricingInput = { quantity: 2, hours: 2, watts: 100, kwh: 1, machineHour: 2, laborMinutes: 0, laborHour: 20,
  overhead: 0, failure: 0, margin: 50, target: 34.9, materials: [{ name: "Filamentos", grams: 100, kgPrice: 80 }],
  extras: [{ name: "Embalagem especial já incluída", cost: 3.75, basis: "unit" }] };
const scope = { tenantId: "tenant-1", userId: "user-1" };
function native(multiple = true) {
  const mesh = '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
  const plateInfo = (index: number, grams: number, seconds: number, redGrams: number, greenGrams: number) => `<plate><metadata key="index" value="${index}"/><metadata key="prediction" value="${seconds}"/><metadata key="weight" value="${grams}"/><metadata key="printer_model_id" value="Bambu Lab A1"/><metadata key="nozzle_diameters" value="0.4"/><filament id="1" type="PLA" color="#FF0000" used_g="${redGrams}" used_m="1"/>${greenGrams ? `<filament id="2" type="PLA" color="#00FF00" used_g="${greenGrams}" used_m="1"/>` : ""}</plate>`;
  const configPlate = (index: number) => `<plate><metadata key="plater_id" value="${index}"/><model_instance><metadata key="object_id" value="${index}"/><metadata key="instance_id" value="0"/></model_instance></plate>`;
  const bytes = zipSync({
    "3D/3dmodel.model": strToU8(`<model><resources><object id="1" name="Corpo">${mesh}</object>${multiple ? `<object id="2" name="Tampa">${mesh}</object>` : ""}</resources><build><item objectid="1"/>${multiple ? '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 300 0 0"/>' : ""}</build></model>`),
    "Metadata/model_settings.config": strToU8(`<config><object id="1"><metadata key="name" value="Corpo"/></object>${multiple ? '<object id="2"><metadata key="name" value="Tampa"/></object>' : ""}${configPlate(1)}${multiple ? configPlate(2) : ""}</config>`),
    "Metadata/slice_info.config": strToU8(`<config><header><header_item key="X-BBL-Client-Version" value="02.08.02.61"/></header>${multiple ? plateInfo(1,40,1800,12,28)+plateInfo(2,60,5400,58,2) : plateInfo(1,100,7200,100,0)}</config>`),
  });
  const file = new File([bytes], multiple ? "3mf-retornado-pelo-fatiador.3mf" : "nova-origem.3mf", { type: "model/3mf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.slice().buffer });
  const model = parseModelFile(bytes, file.name);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const composition = { ...model.composition, profile_id: `local:${hash}`, file_sha256: hash, file_name: file.name };
  const estimate = modelPricingFromComposition(composition); disposeModel(model.group);
  return { file, hash, composition, estimate,
    calculated: { printerId: "a1", quantity: 2, materialSelections: Object.fromEntries(estimate.materials.map(material => [material.key, material.colorHex === "#FF0000" ? "pla" : "pla-green"])) } };
}
function makerReference(): ProductExternalImport {
  const model = normalizeMakerWorldDesign({ id: 456, title: "Produto MakerWorld", description: "Descrição aceita", cover: "https://images.example.test/finished.png",
    images: ["https://images.example.test/detail.png"], instances: [{ id: 101, profileId: 501, title: "PLA A1", extention: { modelInfo: {
      compatibility: { devProductName: "A1", nozzleDiameter: 0.4 }, plates: [{ index: 1, name: "Corpo", weight: 100, prediction: 7200,
        objects: [{ id: 1, name: "Corpo", quantity: 1 }], filaments: [{ id: "1", type: "PLA", color: "#FF0000", usedG: 100 }] }],
    } } }] });
  return { ...model, provider: "makerworld", source_url: "https://makerworld.com/models/456", selected_profile_id: "101", selected_instance_id: "101", selected_variant_profile_id: "501", fetched_at: "2026-11-02T12:00:00Z" };
}
const saved = () => mock.rpc.mock.calls.find(([name]) => name === "save_product_with_photos")?.[1] as { p_product: Record<string, unknown>; p_photos: string[] } | undefined;
function Location() { const location = useLocation(); return <output aria-label="Destino do orçamento">{JSON.stringify(location.state)}</output>; }
function mount(sourceToken: string, values = accepted) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter initialEntries={[{ pathname: "/comercial/produtos", state: { pricing: { ...values, sourceRequired: true, sourceToken } } }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Produtos /><Location /></MemoryRouter>
  </QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto); discardPricingSourceTransfer();
  mock.rpc.mockReset(); mock.toast.mockReset(); mock.upload.mockReset().mockResolvedValue({ data: { path: "uploaded.3mf" }, error: null });
  mock.reimport = native(false);
  mock.rpc.mockImplementation(async (name: string) => ({ data: name === "pricing_settings" ? policy : name === "save_product_with_photos" ? "saved-product" : [], error: null }));
});
afterEach(() => { cleanup(); discardPricingSourceTransfer(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("canonical product receives the complete accepted pricing source", () => {
  it("adds only new product extras to an accepted cost that already includes the standalone extras", async () => {
    const source = native();
    const token = await createPricingSourceTransfer(scope, { sourceFile: source.file, externalImport: null, estimate: source.estimate, calculated: source.calculated, pricingInput: input, accepted });
    mount(token); const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    await within(editor).findByText("Impressão e valores preservados");
    fireEvent.click(within(editor).getByText("Peças, composição e referências de produção", { selector: "summary" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Adicionar Item" }));
    const name = within(editor).getByPlaceholderText("Ex: Chocolate, Embalagem, Laço...");
    fireEvent.change(name, { target: { value: "Laço novo" } });
    fireEvent.change(within(name.parentElement!).getByPlaceholderText("0,00"), { target: { value: "2,50" } });
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("19.6234");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("34.9");
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ })); await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 19.6234, sale_price: 34.9, extras: [{ name: "Laço novo", cost: 2.5 }],
      import_pricing: { quantity: 2, plates: [{ index: 1, lines: [{ item_id: "pla", grams: 12 }, { item_id: "pla-green", grams: 28 }] }, { index: 2, lines: [{ item_id: "pla", grams: 58 }, { item_id: "pla-green", grams: 2 }] }] } });
  });
  it("uploads the actual File hash and saves exact per-plate choices while retaining accepted cost, price and quote quantity", async () => {
    const source = native();
    const token = await createPricingSourceTransfer(scope, { sourceFile: source.file, externalImport: null, estimate: source.estimate,
      calculated: source.calculated, pricingInput: input, accepted });
    mount(token);
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    expect(within(editor).getByRole("tab", { name: "Produto e preço" })).toHaveAttribute("aria-selected", "true");
    const cadastro = within(editor).getByRole("tabpanel", { name: "Produto e preço" });
    expect(within(cadastro).getByLabelText("Nome *")).toBeVisible();
    expect(within(cadastro).getByLabelText("Preço de custo (R$)")).toBeVisible();
    expect(within(cadastro).getByLabelText("Preço unitário (R$)")).toBeVisible();
    expect(await within(editor).findByText("Impressão e valores preservados")).toBeVisible();
    expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("17.1234");
    expect(within(editor).getByLabelText("Preço unitário (R$)")).toHaveValue("34.9");
    expect(within(editor).queryByLabelText("Produtos completos neste perfil")).not.toBeInTheDocument();
    expect(mock.rpc.mock.calls.some(([name]) => name === "pricing_settings")).toBe(false);
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    const product = saved()!.p_product;
    expect(product).toMatchObject({ cost_estimate: 17.1234, manual_cost: 17.1234, sale_price: 34.9,
      catalog_details: { base_cost: 17.1234, accessory_cost: 0, other_cost: 0 }, extras: [],
      file_composition: { profile_id: `local:${source.hash}`, file_sha256: source.hash, file_name: source.file.name },
      import_pricing: { printer_id: "a1", quantity: 2, source_file_sha256: source.hash,
        plates: [{ index: 1, units_per_plate: 2, lines: [{ item_id: "pla", grams: 12 }, { item_id: "pla-green", grams: 28 }] },
          { index: 2, units_per_plate: 2, lines: [{ item_id: "pla", grams: 58 }, { item_id: "pla-green", grams: 2 }] }] } });
    expect(mock.upload).toHaveBeenCalledTimes(1);
    expect(mock.upload.mock.calls[0][1]).toBe(source.file);
    expect((product.file_composition as ImportedComposition).file_path).toMatch(/^tenant-1\//);
    await waitFor(() => expect(screen.getByLabelText("Destino do orçamento")).toHaveTextContent('"quantity":7'));
    expect(screen.getByLabelText("Destino do orçamento")).toHaveTextContent('"unit_price":34.9');
  });
  it("saves native file plates and the full MakerWorld origin together without using its published estimates",async()=>{
    const source=native(),externalImport=makerReference();
    const token=await createPricingSourceTransfer(scope,{sourceFile:source.file,externalImport,estimate:source.estimate,calculated:source.calculated,pricingInput:input,accepted});
    mount(token);const editor=await screen.findByRole("dialog",{name:"Novo Produto"});await within(editor).findByText("Impressão e valores preservados");
    fireEvent.click(within(editor).getByRole("button",{name:/^Criar$/}));await waitFor(()=>expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({cost_estimate:17.1234,sale_price:34.9,file_composition:{profile_id:'local:'+source.hash},external_import:{design_id:'456',selected_variant_profile_id:'501'},import_pricing:{source_file_sha256:source.hash}});
    expect(saved()!.p_product).not.toHaveProperty('import_composition');expect(mock.upload).toHaveBeenCalledTimes(1);
  });
  it("keeps MakerWorld metadata and finished-product photos without recalculating accepted financial values", async () => {
    const externalImport = makerReference(), estimate = modelPricingFromMakerWorld(externalImport);
    const token = await createPricingSourceTransfer(scope, { sourceFile: null, externalImport, estimate, pricingInput: input, accepted,
      calculated: { printerId: "a1", quantity: 2, materialSelections: { [estimate.materials[0].key]: "pla" } } });
    mount(token);
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    expect(await within(editor).findByText("Impressão e valores preservados")).toBeVisible();
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 17.1234, sale_price: 34.9, material_id: "pla", prints_per_plate: 2,
      external_import: { selected_profile_id: "101", selected_variant_profile_id: "501" }, import_composition: { profile_id: "501" },
      import_pricing: { printer_id: "a1", quantity: 2, plates: [{ index: 1, units_per_plate: 2, lines: [{ item_id: "pla", grams: 100 }] }] },
      photo_url: "https://images.example.test/finished.png" });
    expect(saved()!.p_photos).toContain("https://images.example.test/detail.png");
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.rpc.mock.calls.some(([name]) => name === "pricing_settings")).toBe(false);
  });
  it.each(["missing", "expired"])("blocks a %s source token until explicit manual opt-out", async kind => {
    let token = "token-not-in-this-session";
    if (kind === "expired") {
      vi.useFakeTimers(); const source = native(false);
      token = await createPricingSourceTransfer(scope, { sourceFile: source.file, externalImport: null, estimate: source.estimate,
        calculated: source.calculated, pricingInput: input, accepted });
      vi.advanceTimersByTime(PRICING_SOURCE_TRANSFER_TTL_MS); vi.useRealTimers();
    }
    mount(token);
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    expect(await within(editor).findByRole("alert")).toHaveTextContent(MISSING_PRICING_SOURCE_TRANSFER);
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: MISSING_PRICING_SOURCE_TRANSFER })));
    expect(saved()).toBeUndefined(); expect(mock.upload).not.toHaveBeenCalled();
    fireEvent.click(within(editor).getByRole("button", { name: "Continuar apenas com custo manual" }));
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product).toMatchObject({ cost_estimate: 17.1234, sale_price: 34.9 });
    expect(saved()!.p_product.import_pricing).toBeUndefined(); expect(saved()!.p_product.file_composition).toBeUndefined();
  });
  it("clears the expired-source block after explicit reimport instead of silently using its old preparation", async () => {
    mount("missing-token");
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    fireEvent.click(await within(editor).findByRole("button", { name: "Importar novamente neste cadastro" }));
    fireEvent.click(await within(editor).findByRole("button", { name: "Reimportar arquivo neste cadastro" }));
    await waitFor(() => expect(within(editor).getByLabelText("Preço de custo (R$)")).toHaveValue("12.2"));
    expect(within(editor).queryByText(MISSING_PRICING_SOURCE_TRANSFER)).not.toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: /^Criar$/ }));
    await waitFor(() => expect(saved()).toBeDefined());
    expect(saved()!.p_product.import_pricing).toMatchObject({ printer_id: "a1", quantity: 1, source_file_sha256: mock.reimport!.composition.file_sha256,
      plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "pla", grams: 100 }] }] });
    expect(mock.upload.mock.calls[0][1]).toBe(mock.reimport!.file);
  });
  it("does not silently save without preparation after a replacement file fails before parsing", async () => {
    const source = native();
    const token = await createPricingSourceTransfer(scope, { sourceFile: source.file, externalImport: null, estimate: source.estimate,
      calculated: source.calculated, pricingInput: input, accepted });
    mount(token);
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    await within(editor).findByText("Impressão e valores preservados");
    fireEvent.click(within(editor).getByRole("button", { name: "Substituir por arquivo inválido" }));
    expect(within(editor).queryByText("Impressão e valores preservados")).not.toBeInTheDocument();
    const create = within(editor).getByRole("button", { name: /^Criar$/ });
    fireEvent.click(create);
    await waitFor(() => expect(create.hasAttribute("disabled") || mock.toast.mock.calls.some(([message]) => message.variant === "destructive")).toBe(true));
    expect(saved()).toBeUndefined(); expect(mock.upload).not.toHaveBeenCalled();
  });
});
