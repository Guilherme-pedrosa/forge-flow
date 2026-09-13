import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BambuAccountingForm, BambuConfigurationForm, BambuQualitySummary } from "./BambuProductionPanel";
import type { BambuProductionPreview, BambuProductionReview } from "@/lib/bambu-production-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/bambu-production-api", () => ({ bambuRpc: rpc, readBambuProductionReview: vi.fn(), readBambuSyncState: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const task: BambuProductionReview = { task_id: "task", bambu_task_id: "123", design_title: "Base", device_name: "P1S", started_at: "2026-09-13T10:00:00Z", ended_at: "2026-09-13T10:01:17Z", raw_status: "3", outcome: "failed", state: "needs_measurement", problem: null, planned_grams: 55.63, elapsed_seconds: 77, posted_at: null, total_cost: null, product_id: "product", product_name: "Base 3D", units: 2, consumption_source: null, auto_enabled: false };
const preview: BambuProductionPreview = { task_id: "task", project_key: "project", can_auto: true, outcome: "failed", elapsed_seconds: 77, planned_grams: 55.63,
  filaments: [{ source_key: "tray0", label: "PLA branco", planned_grams: 55.63, item_id: "material" }], profile: null,
  record: { product_id: "product", units: 2, materials: [{ source_key: "tray0", item_id: "material" }], use_slicer: true, labor_cost: 0, overhead: 0, extras_cost: 0 },
};
const products = [{ id: "product", name: "Base 3D", sku: "BASE", category: "printed_part", is_active: true }];
const materials = [{ id: "material", name: "PLA branco estoque", unit: "kg", current_stock: 1, is_active: true }];
function props(nextPreview = preview) { return { task, preview: nextPreview, mode: "account" as const, loading: false, products, materials, jobs: [], plates: [], onClose: vi.fn(), onSaved: vi.fn(), onBusy: vi.fn() }; }
const field = (name: RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const saveAccount = () => fireEvent.click(screen.getByRole("button", { name: "Apurar e registrar consumo" }));

beforeEach(() => { rpc.mockReset(); vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("stable-request") }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("qualidade após a impressão física", () => {
  it("mostra rejeição parcial e peças restantes sem tratar a produção como falha", () => {
    render(<BambuQualitySummary row={{ ...task, outcome: "completed", state: "posted", raw_status: "2", completed_units: 1, quality_state: "partially_rejected", quality_rejected_units: 1, quality_loss_grams: 25, quality_loss_cost: 5 }} />);
    expect(screen.getByText("1 peça(s) sem rejeição registrada.")).toBeInTheDocument();
    expect(screen.getByText(/1 peça\(s\) rejeitada\(s\) na qualidade · 25 g/)).toBeInTheDocument();
    expect(screen.getByText(/Custo da rejeição já incluído/)).toBeInTheDocument();
  });
  it("rejeição total mantém zero peças aproveitáveis explícito", () => {
    render(<BambuQualitySummary row={{ ...task, outcome: "completed", state: "posted", completed_units: 0, quality_state: "rejected", quality_rejected_units: 2 }} />);
    expect(screen.getByText("0 peça(s) sem rejeição registrada.")).toBeInTheDocument();
  });
  it("não apresenta qualidade concluída para tentativas ainda pendentes", () => {
    const result = render(<BambuQualitySummary row={{ ...task, outcome: "completed", completed_units: 2 }} />);
    expect(result.container).toBeEmptyDOMElement();
  });
});

describe("apuração Bambu no formulário", () => {
  it("uma falha exige motivo e pesagem em branco, mesmo se o perfil permite fatiador", async () => {
    render(<BambuAccountingForm {...props()} />);
    expect(screen.getByLabelText(/PLA branco · PLA branco estoque/)).toHaveValue(null);
    expect(screen.queryByLabelText(/Peças efetivamente concluídas/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Tempo decorrido \(segundos\)/)).toHaveValue(77);
    saveAccount(); await screen.findByText("Informe o motivo da interrupção ou falha.");
    field(/Motivo da interrupção/, "Descolou da mesa"); saveAccount();
    await screen.findByText(/Informe o consumo de PLA branco/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("zero medido é explícito e retry após timeout preserva a mesma operação", async () => {
    render(<BambuAccountingForm {...props()} />);
    field(/PLA branco · PLA branco estoque/, "0"); field(/Motivo da interrupção/, "Interrompida antes de extrudar");
    rpc.mockRejectedValueOnce(new Error("Conexão interrompida")).mockResolvedValueOnce({ state: "posted", total_cost: 0.12 });
    saveAccount(); await screen.findByText("Conexão interrompida"); saveAccount();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    const first = rpc.mock.calls[0][1]; const second = rpc.mock.calls[1][1];
    expect(first).toMatchObject({ p_materials: [{ source_key: "tray0", item_id: "material", grams: 0 }], p_seconds: 77, p_units: null });
    expect(second.p_request_id).toBe(first.p_request_id);
  });
  it("conclusão com opt-in conserva fonte fatiador explícita, sem chamá-la pesagem", async () => {
    render(<BambuAccountingForm {...props({ ...preview, outcome: "completed" })} />);
    expect(screen.getByText("Fonte do consumo: referência do fatiador")).toBeInTheDocument();
    rpc.mockResolvedValue({ state: "posted", total_cost: 4 }); saveAccount();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("account_bambu_production", expect.objectContaining({ p_materials: null, p_seconds: 77, p_units: 2 })));
  });
  it("objeto ignorado exige pesos e quantidade boa, mesmo com opt-in", async () => {
    render(<BambuAccountingForm {...props({ ...preview, outcome: "completed", skipped_objects: [7] })} />);
    expect(screen.queryByText("Fonte do consumo: referência do fatiador")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Peças efetivamente concluídas/)).toHaveValue(null);
    field(/PLA branco · PLA branco estoque/, "20"); saveAccount();
    await screen.findByText(/Informe as peças concluídas/); expect(rpc).not.toHaveBeenCalled();
    field(/Peças efetivamente concluídas/, "1"); rpc.mockResolvedValue({ state: "posted", total_cost: 2 }); saveAccount();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("account_bambu_production", expect.objectContaining({ p_units: 1, p_materials: [{ source_key: "tray0", item_id: "material", grams: 20 }] })));
  });
  it("uma tarefa ainda imprimindo não pode gerar baixa", async () => {
    render(<BambuAccountingForm {...props({ ...preview, outcome: "printing", elapsed_seconds: null })} />);
    saveAccount(); await screen.findByText("Somente execuções encerradas podem ser apuradas."); expect(rpc).not.toHaveBeenCalled();
  });
});

describe("vínculos explícitos Bambu", () => {
  it("a configuração por execução envia o item branco e override da base cinza, sem alterar o SKU", async () => {
    const expected = { product_id: "product", plate_id: null, base_item_id: "gray", selected_item_id: "gray", material_code: "PLA", color_code: "GRAY", color_hex: "#A7A9AA" };
    const gray = { ...materials[0], id: "gray", name: "PLA cinza", material_code: "PLA", color: "Cinza", color_code: "GRAY", color_hex: "#A7A9AA", avg_cost: 80 };
    const white = { ...gray, id: "material", name: "PLA branco estoque", color: "Branco", color_code: "WHITE", color_hex: "#FFFFFF", avg_cost: 100 };
    rpc.mockImplementation(async name => name === "bambu_material_selection_preview" ? { material_policy: "execution_variant", expected_materials: [expected],
      material_options: [{ ...expected, options: [gray, white] }], filaments: [{ ...preview.filaments[0], base_item_id: "gray", source_type: "PLA", source_color: "A7A9AAFF", target_type: "PLA", target_color: "FFFFFFFF" }], complete: true, missing: [], cost_per_unit: 1 } : "configuration");
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BambuConfigurationForm {...props({ ...preview, material_policy: "execution_variant" })} materials={[gray, white]} /></QueryClientProvider>);
    await screen.findByText(/Material ou cor personalizados para esta execução/);
    await waitFor(() => expect(screen.queryByText("Conferindo a seleção…")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Salvar vínculo" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("configure_bambu_production", expect.objectContaining({
      p_product_id: "product", p_materials: [{ source_key: "tray0", item_id: "material" }],
      p_material_overrides: [{ product_id: "product", plate_id: null, base_item_id: "gray", item_id: "material" }],
    })));
    expect(rpc.mock.calls.some(([name]) => name === "save_product_material_recipe" || name === "save_product_with_photos")).toBe(false);
  });
  it("uma OI de venda sem placa mantém todas as unidades do lote ao vincular", async () => {
    rpc.mockResolvedValue("configuration");
    render(<BambuConfigurationForm {...props()} jobs={[{ id: "job", code: "OI-003", name: "Lote duas peças", status: "queued", product_id: "product", print_plate_id: null, planned_quantity: 2, order_item_id: "order-item", inventory_posted_at: null }]} />);
    fireEvent.click(screen.getByText("Vincular ordens existentes"));
    fireEvent.click(screen.getByRole("checkbox", { name: "OI-003 · Lote duas peças" }));
    expect(screen.getByLabelText("Peças na ordem OI-003")).toHaveValue(2);
    expect(screen.getByLabelText("Peças na ordem OI-003")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar vínculo" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("configure_bambu_production", expect.objectContaining({ p_units: 2, p_allocations: [{ job_id: "job", quantity: 2 }] })));
  });
  it("trocar para uma OI comercial limpa a cor anterior e exige a escolha permitida pelo pedido", async () => {
    const gray = { ...materials[0], id: "gray", name: "PLA cinza aprovado", material_code: "PLA", color: "Cinza", color_code: "GRAY", color_hex: "#A7A9AA", avg_cost: 80 };
    const white = { ...gray, id: "material", name: "PLA branco estoque", color: "Branco", color_code: "WHITE", color_hex: "#FFFFFF", avg_cost: 100 };
    const expected = { product_id: "product", plate_id: null, base_item_id: "gray", selected_item_id: "gray", material_code: "PLA", color_code: "GRAY", color_hex: "#A7A9AA" };
    rpc.mockImplementation(async (_name, args) => {
      const approved = args.p_allocations.length > 0;
      return { material_policy: approved ? "approved_order" : "execution_variant", expected_materials: [expected], material_options: [{ ...expected, options: [gray, white] }],
        filaments: [{ ...preview.filaments[0], base_item_id: "gray", item_id: approved ? null : "material", suggested_item_id: null }], complete: true, missing: [], cost_per_unit: 1 };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BambuConfigurationForm {...props({ ...preview, material_policy: "execution_variant" })} materials={[gray, white]} jobs={[{ id: "job", code: "OI-004", name: "Pedido cinza", status: "queued", product_id: "product", print_plate_id: null, planned_quantity: 2, order_item_id: "order-item", inventory_posted_at: null }]} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar vínculo" })).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "Material usado em PLA branco" })).toHaveValue("material");
    fireEvent.click(screen.getByText("Vincular ordens existentes")); fireEvent.click(screen.getByRole("checkbox", { name: "OI-004 · Pedido cinza" }));
    await screen.findByText(/Esta impressão atende uma venda/);
    expect(screen.getByRole("combobox", { name: "Material usado em PLA branco" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Salvar vínculo" })).toBeDisabled();
    expect(screen.queryByRole("option", { name: /PLA branco estoque/ })).not.toBeInTheDocument();
    expect(rpc.mock.calls.some(([name]) => name === "configure_bambu_production")).toBe(false);
  });
  it("uma nota de importação oferece sugestão sem escolher o produto sozinha", async () => {
    render(<BambuConfigurationForm {...props({ ...preview, record: null, candidate_product_id: "product", candidate_source: "legacy_note" })} />);
    expect(screen.getByText("Sugestão encontrada na nota de importação:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar vínculo" }));
    await screen.findByText("Selecione o produto desta impressão."); expect(rpc).not.toHaveBeenCalled();
  });
  it("nome e cor iguais não selecionam material de estoque", async () => {
    const source = { ...preview, filaments: [{ ...preview.filaments[0], item_id: null }], record: { ...preview.record, materials: [] } };
    render(<BambuConfigurationForm {...props(source)} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar vínculo" }));
    await screen.findByText("Selecione o item de estoque para PLA branco."); expect(rpc).not.toHaveBeenCalled();
  });
  it("produto com placas cadastradas exige a placa desta tentativa", async () => {
    const plate = { id: "plate", product_id: "product", source_id: null, plate_index: 1, label: "Base", units_per_plate: 2, material_id: "material", printer_id: null, est_grams: 50, est_time_seconds: 60, est_cost_per_unit: 1, is_active: true };
    render(<BambuConfigurationForm {...props()} plates={[plate]} />);
    fireEvent.click(screen.getByRole("button", { name: "Salvar vínculo" }));
    await screen.findByText("Selecione a placa que foi impressa nesta execução."); expect(rpc).not.toHaveBeenCalled();
  });
});
