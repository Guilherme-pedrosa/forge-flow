import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import Precificacao from "@/pages/comercial/Precificacao";
import { parseModelFile, disposeModel } from "@/lib/model-file";
import { modelPricingFromComposition, modelPricingFromMakerWorld, type ModelPricingEstimate } from "@/lib/model-pricing";
import { normalizeMakerWorldDesign } from "../../supabase/functions/_shared/makerworld";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import { consumePricingSourceTransfer, discardPricingSourceTransfer, type PreparedPricingSourceTransfer } from "@/lib/pricing-source-transfer";
import * as pricingTransfer from "@/lib/pricing-source-transfer";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), file: null as File | null,
  estimate: null as ModelPricingEstimate | null, reference: null as ProductExternalImport | null,
  arrived: null as { pricing: Record<string, unknown> } | null, prepared: null as PreparedPricingSourceTransfer | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "transfer-tenant" }, user: { id: "transfer-user" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string }) =>
  <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/comercial/PricingModelFile", () => ({ readPricingModelEstimate: async () => ({estimate:mock.estimate,notice:""}), PricingModelFile: ({ onLoaded }: { onLoaded: (file: File, estimate: ModelPricingEstimate | null) => void }) => <>
  <button onClick={() => onLoaded(mock.file!, mock.estimate)}>Escolher 3MF fatiado</button>
  <button onClick={() => onLoaded(new File(["STL ainda não fatiado"], "outra.stl"), null)}>Escolher outra peça</button>
</> }));
vi.mock("@/components/comercial/PricingMakerWorldInput", () => ({ PricingMakerWorldInput: ({ onLoaded }: { onLoaded: (reference: ProductExternalImport | null) => void }) =>
  <button onClick={() => onLoaded(mock.reference)}>Escolher MakerWorld</button> }));
vi.mock("@/components/comercial/MakerWorldProjectSlicer",()=>({MakerWorldProjectSlicer:({onSliced}:{onSliced:(file:File,job:unknown)=>Promise<void>})=><button onClick={()=>void onSliced(mock.file!,{profile_id:"bambu-a1-04-pla-020-v1"})}>Fatiar projeto público</button>}));
const policy = { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20,
  overhead_percent: 0, target_margin: 50, handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0,
  assembly_minutes_per_product: 0, extras_cost_per_product: 2, printer_hour_costs: [],
  machine_rate_scope: "commercial_excludes_energy", revision: "transfer-policy" };
const printers = [{ id: "a1", name: "A1 da oficina", brand: "Bambu Lab", model: "A1", power_watts: 100,
  depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1, acquisition_cost: 4000, useful_life_hours: 10000 }];
const filaments = [{ id: "pla-red", name: "PLA vermelho", unit: "kg", avg_cost: 80, material_code: "PLA", color_hex: "#FF0000" }];
function sourceFile() {
  const mesh = '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
  const bytes = zipSync({ "3D/3dmodel.model": strToU8(`<model><resources><object id="1" name="Corpo">${mesh}</object></resources><build><item objectid="1"/></build></model>`),
    "Metadata/slice_info.config": strToU8('<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="7200"/><metadata key="weight" value="100"/><metadata key="printer_model_id" value="Bambu Lab A1"/><filament id="1" type="PLA" color="#FF0000" used_g="100" used_m="33.5"/></plate></config>') });
  const parsed = parseModelFile(bytes, "arquivo-retornado-pelo-fatiador.3mf");
  mock.estimate = modelPricingFromComposition(parsed.composition); disposeModel(parsed.group);
  const file = new File([bytes], "arquivo-retornado-pelo-fatiador.3mf", { type: "model/3mf" });
  Object.defineProperty(file, "arrayBuffer", { configurable: true, value: async () => bytes.slice().buffer });
  return { file, bytes };
}
function reference() {
  const model = normalizeMakerWorldDesign({ id: 456, title: "Produto MakerWorld", instances: [{ id: 101, profileId: 501, title: "A1 PLA",
    extention: { modelInfo: { compatibility: { devProductName: "A1" }, plates: [{ index: 1, weight: 100, prediction: 7200,
      filaments: [{ id: "1", type: "PLA", color: "#FF0000", usedG: 100 }], objects: [{ id: 1, name: "Corpo", quantity: 1 }] }] } } }] });
  return { ...model, provider: "makerworld" as const, source_url: "https://makerworld.com/models/456", selected_profile_id: "101",
    selected_instance_id: "101", selected_variant_profile_id: "501", fetched_at: "2026-11-02T12:00:00Z" };
}
function Destination() {
  const location = useLocation();
  useEffect(() => {
    mock.arrived = location.state;
    mock.prepared = consumePricingSourceTransfer(location.state?.pricing?.sourceToken, { tenantId: "transfer-tenant", userId: "transfer-user" });
  }, [location.key, location.state]);
  return <p>Cadastro do produto aberto</p>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/comercial/precificacao"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes>
    <Route path="/comercial/precificacao" element={<Precificacao />} /><Route path="/comercial/produtos" element={<Destination />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
async function load(kind = "Escolher 3MF fatiado") {
  fireEvent.click(screen.getByRole("button", { name: kind }));
  await waitFor(() => expect(screen.getByText("Custo / unidade").parentElement?.querySelector("dd")).toHaveTextContent(/R\$\s*14,20/));
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto); discardPricingSourceTransfer();
  mock.from.mockReset(); mock.rpc.mockReset(); mock.arrived = null; mock.prepared = null;
  mock.file = sourceFile().file; mock.reference = reference();
  mock.from.mockImplementation((table: string) => {
    const query = { select: () => query, eq: () => query, gt: () => query, in: () => query, order: () => query,
      range: async () => ({ data: table === "printers" ? printers : table === "inventory_items" ? filaments : [], error: null }) };
    return query;
  });
  mock.rpc.mockImplementation(async (name: string) => name === "pricing_settings" ? { data: policy, error: null }
    : { data: null, error: { message: `Unexpected RPC: ${name}` } });
});
afterEach(() => { cleanup(); discardPricingSourceTransfer(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("standalone pricing transfers to the canonical product form", () => {
  it("navigates with only a token while retaining the exact 3MF, printer, stock choices and accepted expenses", async () => {
    mount(); await load();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto com estes valores" }));
    await screen.findByText("Cadastro do produto aberto");
    expect(mock.arrived?.pricing).toMatchObject({ cost: 14.2, price: 28.4, quantity: 1, quote: false, sourceRequired: true });
    expect(Object.keys(mock.arrived!.pricing).sort()).toEqual(["cost", "name", "price", "quantity", "quote", "sourceRequired", "sourceToken"]);
    expect(JSON.stringify(mock.arrived).length).toBeLessThan(500);
    expect(mock.prepared?.sourceFile).toBe(mock.file);
    expect(mock.prepared?.composition.profile_id).toMatch(/^local:[\da-f]{64}$/);
    expect(mock.prepared?.plan).toMatchObject({ printer_id: "a1", quantity: 1,
      plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "pla-red", grams: 100 }] }] });
    expect(mock.prepared?.accepted).toMatchObject({ cost: 14.2, price: 28.4 });
    expect(mock.prepared?.pricingInput.extras).toContainEqual({ name: "Insumos padrão da empresa", cost: 2, basis: "unit" });
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings")).toBe(true);
  });
  it("transfers the selected MakerWorld profile and exact preparation when creating and quoting", async () => {
    mount(); await load("Escolher MakerWorld");
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto e orçar" }));
    await screen.findByText("Cadastro do produto aberto");
    expect(mock.arrived?.pricing.quote).toBe(true);
    expect(mock.prepared?.sourceFile).toBeNull();
    expect(mock.prepared?.externalImport?.selected_variant_profile_id).toBe("501");
    expect(mock.prepared?.composition.profile_id).toBe("501");
    expect(mock.prepared?.plan.materials[0].item_id).toBe("pla-red");
    expect(mock.prepared?.estimate).toEqual(modelPricingFromMakerWorld(mock.reference!));
  });
  it("replaces published MakerWorld metrics with native result bytes and carries the origin to product registration",async()=>{
    mount();await load("Escolher MakerWorld");
    fireEvent.click(screen.getByRole("button",{name:"Fatiar projeto público"}));
    await waitFor(()=>expect(screen.queryByText(/conforme o perfil do MakerWorld/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button",{name:"Cadastrar produto com estes valores"}));
    await screen.findByText("Cadastro do produto aberto");
    expect(mock.prepared?.sourceFile).toBe(mock.file);expect(mock.prepared?.externalImport?.design_id).toBe("456");
    expect(mock.prepared?.plan.source_profile_id).toMatch(/^local:/);
  });
  it("blocks navigation if the File no longer agrees with the displayed calculation", async () => {
    mock.estimate = { ...mock.estimate!, timeSeconds: 7201, hours: 7201 / 3600 };
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Escolher 3MF fatiado" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cadastrar produto com estes valores" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto com estes valores" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/mudou desde o cálculo/);
    expect(mock.arrived).toBeNull();
  });
  it("does not navigate with old preparation when another file is selected during the transfer", async () => {
    const discarded = vi.spyOn(pricingTransfer, "discardPricingSourceTransfer");
    const { file, bytes } = sourceFile(); mock.file = file;
    let resolve!: (buffer: ArrayBuffer) => void;
    Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>(done => { resolve = done; }) });
    mount(); await load();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar produto com estes valores" }));
    await screen.findByText("Preparando os dados da impressão para o cadastro…");
    fireEvent.click(screen.getByRole("button", { name: "Escolher outra peça" }));
    await act(async () => { resolve(bytes.slice().buffer); });
    await waitFor(() => expect(discarded).toHaveBeenCalledWith(expect.any(String)));
    expect(mock.arrived).toBeNull();
    expect(screen.queryByText("Cadastro do produto aberto")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cadastrar produto com estes valores" })).not.toBeInTheDocument();
  });
});
