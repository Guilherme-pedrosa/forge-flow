import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeMakerWorldDesign } from "../../../supabase/functions/_shared/makerworld";
import type { ImportedComponent } from "@/lib/imported-composition";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import { SavedProductImportPricing, type SavedProductImportPricingProps } from "./SavedProductImportPricing";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), toast: vi.fn(), rows: {} as Record<string, Record<string, unknown>[]>, queryColumns: [] as string[], filters: [] as unknown[][], failSave: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" }, user: { id: "user" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, options, onChange, label, disabled }: { value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; label: string; disabled?: boolean }) =>
  <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));

const hash = "a".repeat(64), nativeMaterialKey = JSON.stringify([1, "PLA", "#FF0000"]);
const policy = { machine_hour_cost: 2, energy_cost_kwh: 1, labor_cost_hour: 20, overhead_percent: 0, target_margin: 50,
  handling_minutes_per_plate: 0, finishing_minutes_per_piece: 0, assembly_minutes_per_product: 0, extras_cost_per_product: 0,
  printer_hour_costs: [], machine_rate_scope: "commercial_excludes_energy", revision: "confirmed" };
const printer = { id: "a1", name: "A1 oficina", brand: "Bambu Lab", model: "A1", power_watts: 100, depreciation_per_hour: 0.4, maintenance_cost_per_hour: 0.1 };
const filament = { id: "red", name: "PLA vermelho", category: "filament", unit: "kg", avg_cost: 80, material_code: "PLA", color_hex: "#FF0000" };
function source(id = "source", fileHash = hash) {
  return { id, tenant_id: "tenant", product_id: "product", label: `Arquivo ${id}`, profile_id: `local:${fileHash}`, design_id: null,
    file_sha256: fileHash, file_path: `tenant/${id}.3mf`, file_name: `${id}.3mf`, is_active: true };
}
function plate(sourceId = "source", fileHash = hash, grams = 100, seconds = 7200) {
  const estimates: ImportedComponent["slicer_estimates"] = { source: "3mf_slice_info", slicer_version: "02.08", printer_model_id: "Bambu Lab A1", nozzle_diameters: "0.4",
    filaments: [{ id: 1, material_code: "PLA", color_hex: "#FF0000", weight_grams: grams, length_meters: null }] };
  return { id: `plate-${sourceId}`, tenant_id: "tenant", product_id: "product", source_id: sourceId, plate_index: 1, label: "Corpo",
    est_grams: grams, est_time_seconds: seconds, units_per_plate: null, printer_id: null, is_active: true,
    imported_plate_metadata: { local_file_hash: `local:${fileHash}`, file_profile_id: `local:${fileHash}`, file_sha256: fileHash, slicer_estimates: estimates } };
}
function savedPlan(overrides: Record<string, unknown> = {}) {
  return { version: 1, source_id: "source", source_profile_id: `local:${hash}`, source_file_sha256: hash, printer_id: "saved-a1", quantity: 2,
    materials: [{ source_key: nativeMaterialKey, item_id: "saved-spool" }], ...overrides };
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mock.rows = { product_print_sources: [source()], product_print_plates: [plate()], printers: [printer], inventory_items: [filament] };
  mock.queryColumns = []; mock.filters = []; mock.failSave = false; mock.toast.mockReset();
  mock.from.mockReset().mockImplementation((table: string) => {
    const query = { select: (columns: string) => { mock.queryColumns.push(columns); return query; },
      eq: (field: string, value: unknown) => { mock.filters.push([table, field, value]); return query; }, in: () => query, order: () => query,
      range: async () => ({ data: mock.rows[table] || [], error: null }) };
    return query;
  });
  mock.rpc.mockReset().mockImplementation(async (name: string) => name === "pricing_settings" ? { data: policy, error: null }
    : name === "save_product_import_pricing" ? { data: mock.failSave ? null : "saved-source", error: mock.failSave ? { message: "A fonte mudou. Atualize antes de salvar." } : null }
      : { data: null, error: { message: "Unexpected write" } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(props: Partial<SavedProductImportPricingProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SavedProductImportPricing productId="product" externalImport={null} {...props} /></MemoryRouter></QueryClientProvider>);
  return { invalidate };
}
const writes = () => mock.rpc.mock.calls.filter(([name]) => name === "save_product_import_pricing");

describe("repairing the saved import's printing data", () => {
  it("keeps the calculation and technical editor when the parent already provides company cost confirmations", async () => {
    mount({ showCompanyPolicy: false });
    const save = await screen.findByRole("button", { name: "Salvar dados da impressão" });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByLabelText("Produtos completos neste perfil")).toHaveValue(1);
    expect(screen.queryByLabelText("Parâmetros de custo da empresa")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conferir todos os parâmetros da empresa" })).not.toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith("pricing_settings", {});
  });
  it("propagates inline filament draft and busy guards and keeps technical saving blocked until the child closes", async () => {
    const busy = vi.fn(), draft = vi.fn(), secondHash = "b".repeat(64);
    mock.rows.product_print_sources.push(source("second", secondHash)); mock.rows.product_print_plates.push(plate("second", secondHash));
    let finish!: (value: unknown) => void;
    const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name: string, args: unknown) => name === "save_inventory_catalog" ? new Promise(resolve => { finish = resolve; }) : original(name, args));
    mount({ requestedSourceId: "source", onBusy: busy, onDraft: draft });
    const technicalSave = await screen.findByRole("button", { name: "Salvar dados da impressão" }); await waitFor(() => expect(technicalSave).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Alterar modelo ou filamento" }));
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar filamento 1 do produto importado" }));
    const dialog = await screen.findByRole("dialog", { name: "Cadastrar filamento" });
    expect(draft).toHaveBeenLastCalledWith(true); expect(technicalSave).toBeDisabled(); expect(screen.getByLabelText("Perfil de impressão do produto")).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Cor *"), { target: { value: "Vermelho" } });
    fireEvent.change(within(dialog).getByLabelText("Custo médio (R$/kg)"), { target: { value: "80" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cadastrar filamento" }));
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(true)); expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await act(async () => finish({ data: null, error: { message: "Falha no cadastro" } }));
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false)); expect(technicalSave).toBeDisabled(); expect(draft).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(draft).toHaveBeenLastCalledWith(false)); expect(technicalSave).toBeEnabled();
    expect(screen.getByLabelText("Perfil de impressão do produto")).toBeEnabled(); expect(writes()).toHaveLength(0);
  });
  it("reuses the exact saved printer, spool and quantity and writes only the technical plan", async () => {
    mock.rows.printers.push({ ...printer, id: "saved-a1", name: "A1 escolhida" });
    mock.rows.inventory_items.push({ ...filament, id: "saved-spool", name: "Bobina escolhida", avg_cost: 100 });
    const { invalidate } = mount({ savedPlan: savedPlan() });
    const button = await screen.findByRole("button", { name: "Salvar dados da impressão" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText("Modelo: A1")).toBeVisible();
    expect(screen.getByText("Filamento: Bobina escolhida")).toBeVisible();
    expect(screen.getByLabelText("Produtos completos neste perfil")).toHaveValue(2);
    expect(screen.queryByText("Custo por peça")).not.toBeInTheDocument();
    expect(screen.queryByText("Preço sugerido")).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toEqual({ p_product_id: "product", p_request_id: expect.any(String), p_plan: {
      version: 1, source_id: "source", source_profile_id: `local:${hash}`, source_file_sha256: hash, printer_id: "saved-a1", quantity: 2,
      materials: [{ source_key: nativeMaterialKey, item_id: "saved-spool", material_code: "PLA", color_hex: "#FF0000", slot_id: 1 }],
      plates: [{ index: 1, units_per_plate: 2, lines: [{ item_id: "saved-spool", grams: 100 }] }],
    } });
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Dados da impressão salvos" })));
    const invalidated = invalidate.mock.calls.map(([options]) => options?.queryKey?.[0]);
    expect(invalidated).toEqual(expect.arrayContaining(["products", "product_print_sources", "product_print_plates", "product_material_recipe", "product_print_plate_preparation"]));
    expect(mock.rpc.mock.calls.every(([name]) => name === "pricing_settings" || name === "save_product_import_pricing")).toBe(true);
    expect(mock.filters).toEqual(expect.arrayContaining([["product_print_sources", "tenant_id", "tenant"], ["product_print_sources", "product_id", "product"], ["product_print_sources", "is_active", true], ["product_print_plates", "tenant_id", "tenant"], ["product_print_plates", "product_id", "product"], ["product_print_plates", "is_active", true]]));
    expect(mock.queryColumns.join(" ")).not.toMatch(/\*|token|password|access_code|serial_number/);
  });

  it.each([
    { name: "another source", changes: { source_id: "different-source" } },
    { name: "another file revision", changes: { source_file_sha256: "b".repeat(64) } },
  ])("ignores $name's saved choices even if only one source is currently active", async ({ changes }) => {
    mock.rows.printers.push({ ...printer, id: "saved-a1", name: "A1 escolhida" });
    mock.rows.inventory_items.push({ ...filament, id: "saved-spool", name: "Bobina escolhida", avg_cost: 100 });
    mount({ savedPlan: savedPlan(changes) });
    expect(await screen.findByLabelText("Filamento 1 do produto importado")).toHaveValue("");
    expect(screen.getByLabelText("Produtos completos neste perfil")).toHaveValue(1);
    expect(screen.getByRole("button", { name: "Salvar dados da impressão" })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("requires one explicit source when multiple files exist and never adds their estimates together", async () => {
    const secondHash = "b".repeat(64);
    mock.rows.product_print_sources.push(source("second", secondHash));
    mock.rows.product_print_plates.push(plate("second", secondHash, 30, 3600));
    mount();
    const selector = await screen.findByLabelText("Perfil de impressão do produto");
    expect(selector).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Salvar dados da impressão" })).not.toBeInTheDocument();
    fireEvent.change(selector, { target: { value: "second" } });
    const button = await screen.findByRole("button", { name: "Salvar dados da impressão" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].p_plan).toMatchObject({ source_id: "second", source_profile_id: `local:${secondHash}`,
      plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "red", grams: 30 }] }] });
    expect(writes()[0][1].p_plan.plates).toHaveLength(1);
  });

  it("keeps the same request identifier for a retry and releases the editor after an RPC failure", async () => {
    const busy = vi.fn(); mock.failSave = true;
    mount({ onBusy: busy });
    const button = await screen.findByRole("button", { name: "Salvar dados da impressão" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Não foi possível salvar a impressão", description: "A fonte mudou. Atualize antes de salvar." })));
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0][1].p_request_id).toBe(writes()[1][1].p_request_id);
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
  });

  it("keeps source and printing inputs locked during the technical save", async () => {
    const secondHash = "b".repeat(64), busy = vi.fn();
    mock.rows.product_print_sources.push(source("second", secondHash));
    mock.rows.product_print_plates.push(plate("second", secondHash, 30, 3600));
    let finish!: (value: { data: string; error: null }) => void;
    const original = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name: string, args: unknown) => name === "save_product_import_pricing"
      ? new Promise(resolve => { finish = resolve; }) : original(name, args));
    mount({ requestedSourceId: "source", onBusy: busy });
    const button = await screen.findByRole("button", { name: "Salvar dados da impressão" });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(true));
    expect(screen.getByLabelText("Perfil de impressão do produto")).toBeDisabled();
    expect(screen.getByLabelText("Produtos completos neste perfil")).toBeDisabled();
    finish({ data: "source", error: null });
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
    expect(screen.getByLabelText("Perfil de impressão do produto")).toBeEnabled();
  });
});

function makerReference(): ProductExternalImport {
  const model = normalizeMakerWorldDesign({ id: 123, title: "Produto MakerWorld", instances: [
    { id: 10, profileId: 20, title: "Perfil salvo", extention: { modelInfo: { compatibility: { devProductName: "A1", devModelName: "N2S" }, plates: [
      { index: 1, weight: 40, prediction: 1800, filaments: [{ type: "PLA", color: "#FF0000", usedG: 40 }] },
      { index: 2, weight: 60, prediction: 5400, filaments: [{ type: "PLA", color: "#00FF00", usedG: 60 }] },
    ] } } },
    { id: 11, profileId: 21, title: "Outro perfil", extention: { modelInfo: { compatibility: { devProductName: "A1", devModelName: "N2S" }, plates: [
      { index: 1, weight: 500, prediction: 36000, filaments: [{ type: "PLA", color: "#FF0000", usedG: 500 }] },
    ] } } },
  ] });
  return { ...model, provider: "makerworld", source_url: "https://makerworld.com/en/models/123", selected_profile_id: "11", selected_instance_id: "11", selected_variant_profile_id: "21", fetched_at: "2026-11-02T12:00:00Z" };
}
function setMakerRows(reference: ProductExternalImport) {
  mock.rows.product_print_sources = [{ ...source("maker"), profile_id: null, design_id: "123", file_sha256: null, file_path: null, file_name: null }];
  mock.rows.product_print_plates = reference.profiles[0].plate_details.map(spec => ({ id: `maker-${spec.index}`, tenant_id: "tenant", product_id: "product", source_id: "maker", plate_index: spec.index, label: "Conjunto",
    units_per_plate: null, est_grams: spec.weight_grams, est_time_seconds: spec.time_seconds, printer_id: null, is_active: true,
    imported_plate_metadata: { profile_id: "20", provider: "makerworld", plate: spec } }));
  mock.rows.inventory_items.push({ ...filament, id: "green", name: "PLA verde", color_hex: "#00FF00" });
}

describe("repairing saved MakerWorld profiles", () => {
  it("uses the source metadata's variant when external_import currently selects a different profile", async () => {
    const reference = makerReference(); setMakerRows(reference);
    mount({ externalImport: reference, requestedSourceId: "maker" });
    const button = await screen.findByRole("button", { name: "Salvar dados da impressão" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].p_plan).toMatchObject({ source_id: "maker", source_profile_id: "20", printer_id: "a1", quantity: 1,
      plates: [{ index: 1, units_per_plate: 1, lines: [{ item_id: "red", grams: 40 }] }, { index: 2, units_per_plate: 1, lines: [{ item_id: "green", grams: 60 }] }] });
    expect(reference.selected_variant_profile_id).toBe("21");
  });

  it("blocks preparation when aggregate mixed-color grams cannot be assigned to saved plates", async () => {
    const reference = makerReference(); reference.profiles[0].plate_details.forEach(spec => { spec.filaments = []; }); setMakerRows(reference);
    mount({ externalImport: reference });
    const button = await screen.findByRole("button", { name: "Salvar dados da impressão" });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/distribuir os materiais/));
    expect(button).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });
});
