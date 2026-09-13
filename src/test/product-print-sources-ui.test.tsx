import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ProductPrintSources from "@/pages/comercial/ProductPrintSources";
import { supabase } from "@/integrations/supabase/client";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), get: vi.fn(), write: vi.fn(), sources: [] as Record<string, unknown>[], tasks: [] as Record<string, unknown>[] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/pages/comercial/ProductPrintPlates", () => ({ default: () => <div data-testid="operational-plates" /> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const builder = { select: () => builder, eq: () => builder, order: () => builder, range: () => builder,
      then: (resolve: (result: unknown) => unknown, reject: (err: unknown) => unknown) => Promise.resolve({ data: table === "product_print_sources" ? mock.sources : table === "bambu_tasks" ? mock.tasks : [], error: null }).then(resolve, reject) };
    return builder;
  },
} }));
const abortDescriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
beforeAll(() => { if (!abortDescriptor) Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { configurable: true, value(this: AbortSignal) { if (this.aborted) throw new DOMException("Consulta cancelada", "AbortError"); } }); });
afterAll(() => { if (!abortDescriptor) delete (AbortSignal.prototype as unknown as Record<string, unknown>).throwIfAborted; });
const privateSource = { id: "source-1", tenant_id: "tenant-1", product_id: "product-1", label: "Arquivo da peça", source_url: null, file_name: "peca.3mf", file_path: "tenant-1/file/peca.3mf", design_id: null, instance_id: null, model_id: null, profile_id: null, plate_index: null, is_active: true };
const source = { ...privateSource, source_url: "https://makerworld.com/en/models/1403296#profileId-1455750", file_name: null, file_path: null, design_id: "1403296", instance_id: "1455750", model_id: "US43322ca98eb5f0", profile_id: "297891629", plate_index: 3 };
const plate = (index: number, weight: number, prediction: number) => ({ index, weight, prediction, objects: [], filaments: [{ id: "1", type: "PLA", color: "#A7A9AA", usedG: String(weight) }] });
const rawDesign = { id: 1403296, modelId: "US43322ca98eb5f0", title: "Wheel", defaultInstanceId: 1455750, instances: [
  { id: 1455750, profileId: 297891629, title: "Wheel All Plates", extention: { modelInfo: { compatibility: { devProductName: "A1", nozzleDiameter: .4 }, plates: [plate(1, 57, 6370), plate(2, 65, 5796), plate(3, 17, 3360)] },
    otherCompatibilityModelInfo: [{ profileId: 807375095, modelInfo: { compatibility: { devProductName: "P1S" }, plates: [plate(1, 57, 5458), plate(2, 65, 5618), plate(3, 17, 3066)] } }] } },
  { id: 2830598, profileId: 677129091, title: "Outra montagem", extention: { modelInfo: { compatibility: { devProductName: "X1C" }, plates: [plate(1, 30, 1000)] } } },
] };
const history = (id: string, index: number) => ({ id: `task-${id}`, bambu_task_id: id === "a" ? "101" : "102", design_title: "Mesmo nome", status: "2", start_time: "2026-09-13T10:00:00Z", bambu_devices: { name: `Impressora ${id.toUpperCase()}` },
  weight_grams: "16.78", cost_time_seconds: 3046, raw_data: { designId: 1403296, instanceId: 1455750, modelId: "US43322ca98eb5f0", profileId: 297891629, plateIndex: index,
    amsDetailMapping: [{ sourceColor: "A7A9AAFF", targetColor: "FFFFFFFF", filamentType: "PLA", weight: 16.78 }] } });
const result = () => ({ data: { source_id: "source-1", created: 3, updated: 0, pending_yield: 3 }, error: null });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ProductPrintSources productId="product-1" tenantId="tenant-1" /></QueryClientProvider>);
beforeEach(() => {
  mock.rpc.mockReset(); mock.toast.mockClear(); mock.get.mockReset(); mock.write.mockReset(); mock.sources = [source]; mock.tasks = [history("a", 1), history("b", 3)];
  mock.get.mockResolvedValue({ data: { status: "ready", payload: rawDesign }, error: null }); mock.write.mockImplementation(async name => name === "save_product_print_source" ? { data: "source-1", error: null } : result());
  mock.rpc.mockImplementation(async (name, input) => name === "request_makerworld_import" ? { data: 77, error: null } : name === "get_makerworld_import" ? mock.get(input) : mock.write(name, input));
});
afterEach(cleanup);
const writes = (name = "persist_source_plate_import") => mock.rpc.mock.calls.filter(call => call[0] === name);
async function selectHistory(value = "task-b") {
  fireEvent.click(await screen.findByRole("button", { name: "Vincular impressão" }));
  await screen.findByRole("option", { name: /Impressora B.*#102/ });
  expect(screen.getByRole("button", { name: "Confirmar vínculo com este produto" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "Impressão do histórico" }), { target: { value } });
}
async function addLink() {
  fireEvent.click(await screen.findByRole("button", { name: "Adicionar fonte" }));
  fireEvent.change(screen.getByLabelText("Nome da fonte"), { target: { value: "Modelo MakerWorld" } });
  const link = screen.getByLabelText("Link do modelo ou perfil");
  fireEvent.change(link, { target: { value: "https://makerworld.com/en/models/1403296#profileId-1455750" } }); fireEvent.blur(link);
  fireEvent.click(screen.getByRole("button", { name: "Salvar fonte" }));
  await screen.findByRole("combobox", { name: "Perfil de impressão" });
}
async function chooseP1S() {
  fireEvent.change(screen.getByRole("combobox", { name: "Perfil de impressão" }), { target: { value: "0" } });
  const configuration = await screen.findByRole("combobox", { name: "Configuração da impressora" });
  expect(screen.getByRole("button", { name: "Salvar fonte" })).toBeDisabled();
  fireEvent.change(configuration, { target: { value: "1" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Salvar fonte" })).toBeEnabled());
}

describe("operational plates imported from a source or explicit Bambu task", () => {
  it("binds the chosen task UUID and imports all three exact A1 plates, not a same-name task or another printer variant", async () => {
    mount(); await selectHistory(); fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const args = writes()[0][1];
    expect(args).toMatchObject({ p_source_id: "source-1", p_task_id: "task-b", p_reference: { selected_instance_id: "1455750", selected_variant_profile_id: "297891629" } });
    expect(args.p_reference.profiles[0].plate_details.map((p: { index: number; weight_grams: number; time_seconds: number }) => [p.index, p.weight_grams, p.time_seconds])).toEqual([[1, 57, 6370], [2, 65, 5796], [3, 17, 3360]]);
    expect(args.p_reference.profiles[0].plate_details[2].filaments[0]).toMatchObject({ color: "#A7A9AA", grams: 17 });
    expect(writes("bind_product_print_source")).toHaveLength(0);
    const at = mock.rpc.mock.calls.findIndex(call => call[0] === "persist_source_plate_import"); expect(mock.rpc.mock.contexts[at]).toBe(supabase);
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "3 placas preenchidas" })));
  });
  it("accepts binding plate1 when this source last recorded plate3 of the same profile", async () => {
    mount(); await selectHistory("task-a"); fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].p_task_id).toBe("task-a"); expect(writes()[0][1].p_reference.profiles[0].plate_details).toHaveLength(3);
  });
  it.each([0, "0"])("uses the private-task fallback for designId=%j without a fabricated MakerWorld request", async designId => {
    mock.sources = [privateSource]; mock.tasks = mock.tasks.map(t => ({ ...t, raw_data: { designId, instanceId: 0, modelId: "PRIVATE", profileId: 501, plateIndex: 1 } }));
    mount(); await selectHistory(); fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toEqual({ p_source_id: "source-1", p_task_id: "task-b", p_reference: null });
    expect(writes("request_makerworld_import")).toHaveLength(0);
  });
  it("keeps the history choice and reports a server ownership conflict without claiming success", async () => {
    mock.write.mockResolvedValue({ data: null, error: { message: "Esta impressão já está vinculada a outro SKU." } });
    mount(); await selectHistory("task-a"); fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: "Esta impressão já está vinculada a outro SKU." })));
    expect(screen.getByRole("combobox", { name: "Impressão do histórico" })).toHaveValue("task-a");
    expect(mock.toast.mock.calls.some(([value]) => /placas preenchidas/.test(value.title))).toBe(false);
  });
  it("refreshes an already linked source into operational plates without needing another task choice", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Atualizar placas e materiais" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ p_source_id: "source-1", p_reference: { selected_variant_profile_id: "297891629" } });
    expect(writes()[0][1]).not.toHaveProperty("p_task_id"); expect(writes()[0][1].p_reference.profiles[0].plate_details).toHaveLength(3);
  });
  it("asks for an explicit printer configuration for a new URL and preserves the entire write payload and UUID across retries", async () => {
    mock.sources = [];
    mock.write.mockResolvedValueOnce({ data: null, error: { message: "A resposta da gravação foi perdida. Tente novamente." } }).mockResolvedValue(result());
    mount(); await addLink(); expect(writes("save_source_with_plate_import")).toHaveLength(0);
    await chooseP1S(); fireEvent.click(screen.getByRole("button", { name: "Salvar fonte" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    const first = writes("save_source_with_plate_import")[0][1];
    expect(first).toMatchObject({ p_source_id: null, p_product_id: "product-1", p_source: { instance_id: "1455750", profile_id: "807375095" }, p_reference: { selected_instance_id: "1455750", selected_variant_profile_id: "807375095" } });
    expect(first.p_request_id).toMatch(/^[a-f0-9-]{36}$/i);
    expect(first.p_reference.profiles[0].variants[0].plate_details[2].time_seconds).toBe(3066);
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar fonte" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Salvar fonte" }));
    await waitFor(() => expect(writes("save_source_with_plate_import")).toHaveLength(2));
    expect(writes("save_source_with_plate_import")[1][1]).toEqual(first);
    expect(writes("request_makerworld_import")).toHaveLength(1);
  });
  it("changing the history search clears selection and cannot bind by a name match", async () => {
    mount(); await selectHistory("task-a"); fireEvent.change(screen.getByLabelText("Buscar por nome, impressora ou ID Bambu"), { target: { value: "Impressora B" } });
    expect(screen.getByRole("button", { name: "Confirmar vínculo com este produto" })).toBeDisabled(); expect(writes()).toHaveLength(0);
  });
  it("canceling a source fetch discards the late response without saving or reopening the picker", async () => {
    mock.sources = []; let complete!: (value: unknown) => void; mock.get.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Adicionar fonte" }));
    fireEvent.change(screen.getByLabelText("Link do modelo ou perfil"), { target: { value: source.source_url } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar fonte" })); await waitFor(() => expect(mock.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar fonte" }));
    await act(async () => { complete({ data: { status: "ready", payload: rawDesign }, error: null }); });
    expect(writes("save_source_with_plate_import")).toHaveLength(0); expect(writes("save_product_print_source")).toHaveLength(0);
    expect(screen.queryByRole("combobox", { name: "Perfil de impressão" })).not.toBeInTheDocument();
  });
  it("closing a binding fetch or unmounting the editor prevents late write requests", async () => {
    let complete!: (value: unknown) => void; mock.get.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const view = mount(); await selectHistory(); fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" })); await waitFor(() => expect(mock.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Fechar vínculo da impressão" })); view.unmount();
    await act(async () => { complete({ data: { status: "ready", payload: rawDesign }, error: null }); });
    expect(writes()).toHaveLength(0);
  });
  it("a cancelled public lookup does not poison a subsequent private-task binding", async () => {
    mock.sources = [privateSource];
    mock.tasks[1] = { ...history("b", 1), raw_data: { designId: 0, instanceId: 0, modelId: "PRIVATE", profileId: 501, plateIndex: 1 } };
    let complete!: (value: unknown) => void; mock.get.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    mount(); await selectHistory("task-a"); fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" })); await waitFor(() => expect(mock.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Fechar vínculo da impressão" }));
    await act(async () => { complete({ data: { status: "ready", payload: rawDesign }, error: null }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Vincular impressão" })).toBeEnabled());
    await selectHistory("task-b"); fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo com este produto" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toEqual({ p_source_id: "source-1", p_task_id: "task-b", p_reference: null });
  });
});
