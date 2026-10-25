import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductPrintPlates from "@/pages/comercial/ProductPrintPlates";
import { supabase } from "@/integrations/supabase/client";
import { productionQueryKeys } from "@/lib/production-api";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), plates: [] as Record<string, unknown>[], sources: [] as Record<string, unknown>[], sourceError: false, bindings: [] as Record<string, unknown>[], learned: null as Record<string, unknown> | null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const builder = {
      select: () => builder, eq: () => builder, in: () => builder, order: () => builder, range: () => builder,
      then: (resolve: (result: unknown) => unknown, reject: (err: unknown) => unknown) => Promise.resolve({
        data: table === "product_print_plates" ? mock.plates : table === "product_print_sources" ? mock.sources : table === "product_print_execution_bindings" ? mock.bindings : table === "inventory_items" ? [{ id: "material-1", name: "PLA preto", unit: "g" }]
          : table === "printers" ? [{ id: "printer-1", name: "Impressora A" }]
            : [{ id: "task-1", bambu_task_id: "101", design_title: "Tampa do produto", status: "2", start_time: "2026-09-13T10:00:00Z", bambu_devices: { name: "Impressora A" } }], error: table === "product_print_sources" && mock.sourceError ? { message: "Source unavailable" } : null,
      }).then(resolve, reject),
    };
    return builder;
  },
} }));
const base = { tenant_id: "tenant-1", product_id: "product-1", source_id: "source-1", units_per_plate: 1, material_id: "material-1", printer_id: "printer-1", est_grams: null, est_time_seconds: null, est_cost_per_unit: null, actual_grams_per_unit: 10, actual_seconds_per_unit: 600, actual_sample_units: 4, actual_source: "measured", actual_updated_at: null, model_id: "model-1", profile_id: "profile-1", is_active: true };
const mount = (client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), sourceId: string | null = "source-1") => render(<QueryClientProvider client={client}><ProductPrintPlates productId="product-1" tenantId="tenant-1" sourceId={sourceId} showProductTotal /></QueryClientProvider>);
beforeEach(() => {
  mock.rpc.mockReset(); mock.rpc.mockImplementation(async (name: string) => ({ data: name === "product_plate_learning" ? mock.learned : "plate-3", error: null })); mock.toast.mockClear();
  mock.sources = [{ id: "source-1", file_sha256: null, profile_id: "profile-1", is_active: true }]; mock.sourceError=false; mock.learned = null; mock.bindings=[];
  mock.plates = [
    { ...base, id: "plate-1", plate_index: 1, label: "Base", actual_cost_per_unit: 10 },
    { ...base, id: "plate-2", plate_index: 2, label: "Tampa", actual_cost_per_unit: 8 },
  ];
});
afterEach(cleanup);

describe("product plate configuration", () => {
  it("exibe placas importadas em preparação com tempo, filamentos e custos por impressão, preservando rendimento nulo ao editar", async () => {
    mock.plates = [{ ...base, id: "plate-1", plate_index: 1, label: "Base importada", units_per_plate: null, actual_sample_units: 0, est_grams: 125, est_time_seconds: 3600, imported_filaments: [{ type: "PLA", color: "#FF0000", grams: 100 }, { type: "PETG", color: "#0000FF", grams: 25 }] }];
    mock.rpc.mockImplementation(async (name: string) => ({ data: name === "product_print_plate_preparation" ? { material_cost_per_print: 12.5, energy_cost_per_print: 1, machine_cost_per_print: 2, known_cost_per_print: 15.5, missing: ["Confirme o rendimento da placa"] } : name === "product_plate_learning" ? null : "plate-1", error: null }));
    mount();
    expect(await screen.findByText("Placa 1 · Base importada")).toBeInTheDocument();
    expect(screen.getByText("Em preparação · rendimento por impressão pendente")).toBeInTheDocument();
    expect(screen.getByText("125 g")).toBeInTheDocument(); expect(screen.getByText("1h")).toBeInTheDocument();
    expect(screen.getByText("PLA · #FF0000")).toBeInTheDocument(); expect(screen.getByText("PETG · #0000FF")).toBeInTheDocument();
    expect(screen.getByText("100 g")).toBeInTheDocument(); expect(screen.getByText("25 g")).toBeInTheDocument();
    expect(await screen.findByText(/R\$\s15,50/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar placa 1" }));
    expect(screen.getByLabelText("Unidades do produto atendidas por impressão desta placa")).toHaveValue(null);
    expect(screen.getByLabelText("Peso estimado por impressão (g)")).toHaveValue(125);
    expect(screen.getByLabelText("Tempo estimado por impressão (min)")).toHaveValue(60);
    fireEvent.click(screen.getByRole("button", { name: "Salvar placa" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_print_plate", expect.objectContaining({ p_plate: expect.objectContaining({ units_per_plate: null, est_grams: 125, est_time_seconds: 3600 }) })));
  });
  it("loads observed costs even when the planner cached a narrower plate projection", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["product_print_plates", "tenant-1", "product-1"], mock.plates.map(plate => ({
      id: plate.id, source_id: plate.source_id, plate_index: plate.plate_index, label: plate.label,
      units_per_plate: plate.units_per_plate, is_active: true,
    })));
    mount(client);
    expect(await screen.findByText(/R\$\s18,00/)).toBeInTheDocument();
    expect(screen.getByText("20min")).toBeInTheDocument();
  });
  it("shows base plus lid as an eighteen-real product", async () => {
    mount();
    expect(await screen.findByText(/2 placas · .* por conjunto de impressões/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s18,00/)).toBeInTheDocument();
    expect(screen.getByText("20min")).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s9,00/)).not.toBeInTheDocument();
  });
  it.each([false,true])("keeps the manual pane total on the file plan when SHA is only in the source (source unavailable: %s)",async(sourceError)=>{
    mock.sourceError=sourceError;
    mock.sources=[{id:"source-1",file_sha256:"a".repeat(64),file_name:"linked-file.3mf",profile_id:"native-profile",is_active:true}];
    mock.plates=[{...base,id:"plate-1",plate_index:1,label:"Source plate",est_grams:30,est_time_seconds:600,est_cost_per_unit:7,actual_cost_per_unit:88,imported_plate_metadata:null}];
    mount(undefined,null);
    expect(await screen.findByText(/R\$\s7,00/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s88,00/)).not.toBeInTheDocument();
  });
  it("loads source identities in the manual pane before retaining a non-file production average",async()=>{
    mock.plates=[{...base,id:"plate-1",plate_index:1,label:"Legacy plate",est_grams:30,est_time_seconds:600,est_cost_per_unit:7,actual_cost_per_unit:88,imported_plate_metadata:null}];
    mount(undefined,null);
    expect(await screen.findByText(/R\$\s88,00/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s7,00/)).not.toBeInTheDocument();
  });
  it("saves print totals and per-unit cost with explicit capacity, without sending read-only averages", async () => {
    mount();
    await screen.findByText("Placa 1 · Base");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar placa" }));
    fireEvent.change(screen.getByLabelText("Nome da placa (ex.: base ou tampa)"), { target: { value: "Encaixe" } });
    fireEvent.change(screen.getByLabelText("Unidades do produto atendidas por impressão desta placa"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Peso estimado por impressão (g)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Tempo estimado por impressão (min)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Custo estimado por unidade do produto (R$)"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar placa" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_print_plate", {
      p_plate_id: null, p_product_id: "product-1", p_source_id: "source-1",
      p_plate: { plate_index: 3, label: "Encaixe", units_per_plate: 4, material_id: null, printer_id: null, est_grams: 100, est_time_seconds: 3600, est_cost_per_unit: 8 },
    }));
  });
  it("shows existing Bambu IDs read-only and keeps them outside the save RPC whitelist", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Editar placa 1" }));
    expect(screen.getByText("model-1")).toBeInTheDocument();
    expect(screen.getByText("profile-1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Model ID da placa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Profile ID da placa" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar placa" }));
    await waitFor(() => expect(mock.rpc.mock.calls.some(([name]) => name === "save_product_print_plate")).toBe(true));
    const callIndex = mock.rpc.mock.calls.findIndex(([name]) => name === "save_product_print_plate");
    const payload = mock.rpc.mock.calls[callIndex][1].p_plate;
    expect(mock.rpc.mock.contexts[callIndex]).toBe(supabase);
    expect(Object.keys(payload).sort()).toEqual(["plate_index", "label", "units_per_plate", "material_id", "printer_id", "est_grams", "est_time_seconds", "est_cost_per_unit"].sort());
  });
  it("binds the selected execution to the lid plate, not just to its source or product", async () => {
    mount();
    const details = await screen.findAllByText("Custos, impressora e histórico"); fireEvent.click(details[1]);
    const bindButtons = await screen.findAllByRole("button", { name: "Vincular impressão desta placa" });
    fireEvent.click(bindButtons[1]);
    await screen.findByRole("option", { name: /Tampa do produto.*#101/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Impressão Bambu da placa 2" }), { target: { value: "task-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar vínculo desta placa" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("bind_product_print_plate", { p_plate_id: "plate-2", p_task_id: "task-1" }));
  });
  it("requires confirmation of the active file and plate before recording a file execution without overwriting imported identities", async () => {
    const hash="a".repeat(64);
    mock.sources=[{id:"source-1",file_sha256:hash,file_name:"folhas.3mf",profile_id:`local:${hash}`,is_active:true}];
    mock.plates=[{...base,id:"plate-1",plate_index:1,label:"Folhas",est_grams:30,est_time_seconds:600,actual_sample_units:0,imported_plate_metadata:{file_sha256:hash,file_profile_id:`local:${hash}`}}];
    mock.rpc.mockImplementation(async(name:string)=>{
      if(name==="product_plate_learning")return{data:null,error:null};
      if(name==="bind_file_plate_execution")mock.bindings=[{id:"binding-1",tenant_id:"tenant-1",plate_id:"plate-1",source_id:"source-1",file_sha256:hash,remote_plate_index:2,confirmation:"file_confirmation",confirmed_at:"2026-10-25T12:00:00Z"}];
      return{data:"plate-1",error:null};
    });
    mount(); fireEvent.click(await screen.findByText("Custos, impressora e histórico"));
    fireEvent.click(screen.getByRole("button",{name:"Vincular impressão desta placa"}));
    await screen.findByRole("option",{name:/Tampa do produto.*#101/});
    fireEvent.change(screen.getByRole("combobox",{name:"Impressão Bambu da placa 1"}),{target:{value:"task-1"}});
    const button=screen.getByRole("button",{name:"Confirmar vínculo desta placa"});
    expect(button).toBeDisabled(); expect(screen.getByText("folhas.3mf · placa 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox",{name:"Esta impressão foi feita com este arquivo e esta placa"})); expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith("bind_file_plate_execution",{p_plate_id:"plate-1",p_task_id:"task-1",p_file_sha256:hash}));
    expect(mock.rpc.mock.calls.some(([name])=>name==="bind_product_print_plate")).toBe(false);
    expect(mock.plates[0]).toMatchObject({model_id:"model-1",profile_id:"profile-1",plate_index:1});
    expect(await screen.findByText("Arquivo e placa confirmados com o Bambu")).toBeInTheDocument();
  });
  it("does not confirm a file whose stored SHA differs from the plate revision",async()=>{
    const hash="a".repeat(64);
    mock.sources=[{id:"source-1",file_sha256:"b".repeat(64),file_name:"changed.3mf",profile_id:`local:${hash}`,is_active:true}];
    mock.plates=[{...base,id:"plate-1",plate_index:1,label:"Folhas",imported_plate_metadata:{file_sha256:hash,file_profile_id:`local:${hash}`}}];
    mount(); fireEvent.click(await screen.findByText("Custos, impressora e histórico")); fireEvent.click(screen.getByRole("button",{name:"Vincular impressão desta placa"}));
    await screen.findByRole("option",{name:/Tampa do produto.*#101/}); fireEvent.change(screen.getByRole("combobox",{name:"Impressão Bambu da placa 1"}),{target:{value:"task-1"}});
    expect(screen.getByText(/O arquivo ativo ainda não está verificado ou mudou de revisão/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Confirmar vínculo desta placa"})).toBeDisabled();
    expect(mock.rpc.mock.calls.some(([name])=>name==="bind_file_plate_execution"||name==="bind_product_print_plate")).toBe(false);
  });
  it("clears file confirmation when selecting a task again",async()=>{
    const hash="a".repeat(64);
    mock.sources=[{id:"source-1",file_sha256:hash,file_name:"folhas.3mf",profile_id:`local:${hash}`,is_active:true}];
    mock.plates=[{...base,id:"plate-1",plate_index:1,label:"Folhas",imported_plate_metadata:{file_sha256:hash}}];
    mount(); fireEvent.click(await screen.findByText("Custos, impressora e histórico")); fireEvent.click(screen.getByRole("button",{name:"Vincular impressão desta placa"}));
    await screen.findByRole("option",{name:/Tampa do produto.*#101/}); const select=screen.getByRole("combobox",{name:"Impressão Bambu da placa 1"});
    fireEvent.change(select,{target:{value:"task-1"}}); const checkbox=screen.getByRole("checkbox",{name:"Esta impressão foi feita com este arquivo e esta placa"}); fireEvent.click(checkbox); expect(checkbox).toBeChecked();
    fireEvent.change(select,{target:{value:""}}); fireEvent.change(select,{target:{value:"task-1"}}); expect(checkbox).not.toBeChecked(); expect(screen.getByRole("button",{name:"Confirmar vínculo desta placa"})).toBeDisabled();
  });
  it("refreshes the learned reference after quality invalidation without replacing the local plate plan",async()=>{
    const hash="a".repeat(64);
    mock.sources=[{id:"source-1",file_sha256:hash,file_name:"folhas.3mf",profile_id:`local:${hash}`,is_active:true}];
    mock.plates=[{...base,id:"plate-1",plate_index:1,label:"Folhas",est_grams:30,est_time_seconds:600,actual_sample_units:0,imported_plate_metadata:{file_sha256:hash}}];
    const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}}); mount(client);
    fireEvent.click(await screen.findByText("Custos, impressora e histórico")); await screen.findByText(/A referência Bambu aparece após apuração/);
    mock.learned={source:"bambu",grams:3,print_seconds:120,estimated_cost:1,materials:[{item_id:"material-1",material:"PLA",color:"Verde",grams:3,cost_per_kg:null}],sample_units:10,sample_runs:2,file_sha256:hash,project_key:"execution-1",updated_at:"2026-10-25T12:00:00Z",consumption_source:"slicer_completed",time_source:"elapsed_start_end"};
    await Promise.all(productionQueryKeys.map(key=>client.invalidateQueries({queryKey:[key]})));
    expect(await screen.findByText("Referência Bambu de impressões aprovadas no QC")).toBeInTheDocument();
    expect(screen.getByText("10 peças em 2 impressões.")).toBeInTheDocument(); expect(screen.getByText("Peso informado pelo fatiador Bambu em impressões concluídas.")).toBeInTheDocument();
    expect(screen.getAllByText("30 g").length).toBeGreaterThan(0); expect(screen.getAllByText("10min").length).toBeGreaterThan(0); expect(mock.plates[0]).toMatchObject({est_grams:30,est_time_seconds:600});
  });
  it("requires a fresh confirmation when the active file changes in another session",async()=>{
    const hash="a".repeat(64),nextHash="b".repeat(64);
    mock.sources=[{id:"source-1",file_sha256:hash,file_name:"folhas.3mf",profile_id:`local:${hash}`,is_active:true}];
    mock.plates=[{...base,id:"plate-1",plate_index:1,label:"Folhas",imported_plate_metadata:{file_sha256:hash}}];
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}); mount(client);
    fireEvent.click(await screen.findByText("Custos, impressora e histórico")); fireEvent.click(screen.getByRole("button",{name:"Vincular impressão desta placa"}));
    await screen.findByRole("option",{name:/Tampa do produto.*#101/}); fireEvent.change(screen.getByRole("combobox",{name:"Impressão Bambu da placa 1"}),{target:{value:"task-1"}});
    fireEvent.click(screen.getByRole("checkbox",{name:"Esta impressão foi feita com este arquivo e esta placa"}));
    mock.sources=[{...mock.sources[0],file_sha256:nextHash,profile_id:`local:${nextHash}`,file_name:"folhas-revisadas.3mf"}];
    mock.plates=[{...mock.plates[0],imported_plate_metadata:{file_sha256:nextHash}}];
    await Promise.all([client.invalidateQueries({queryKey:["product_print_sources"]}),client.invalidateQueries({queryKey:["product_print_plates"]})]);
    await waitFor(()=>expect(screen.getByRole("checkbox",{name:"Esta impressão foi feita com este arquivo e esta placa"})).not.toBeChecked());
    expect(screen.getByText("folhas-revisadas.3mf · placa 1")).toBeInTheDocument(); expect(screen.getByRole("button",{name:"Confirmar vínculo desta placa"})).toBeDisabled();
  });
});
