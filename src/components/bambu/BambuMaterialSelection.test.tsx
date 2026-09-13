import { useCallback, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BambuMaterialSelection, { type BambuSelectionState } from "./BambuMaterialSelection";
import { bambuMaterialScope, type BambuMaterialSelectionPreview, type BambuStockMaterial } from "@/lib/bambu-material-selection";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/bambu-production-api", () => ({ bambuRpc: mock.rpc }));
const gray: BambuStockMaterial = { id: "gray", name: "PLA estoque cinza", material_code: "PLA", color: "Cinza", color_code: "GRAY", color_hex: "#A7A9AA", unit: "kg", avg_cost: 80, current_stock: 1 };
const white: BambuStockMaterial = { ...gray, id: "white", name: "PLA estoque branco", color: "Branco", color_code: "WHITE", color_hex: "#FFFFFF", avg_cost: 100 };
const expected = { product_id: "product", plate_id: "plate", base_item_id: "gray", selected_item_id: "gray", material_code: "PLA", color_code: "GRAY", color_hex: "#A7A9AA" };
const preview = (): BambuMaterialSelectionPreview => ({ material_policy: "execution_variant", expected_materials: [expected], material_options: [{ ...expected, options: [gray, white] }], filaments: [{ source_key: "ams", label: "Filamento da placa", planned_grams: 17, base_item_id: "gray", item_id: "white", suggested_item_id: "white", source_type: "PLA", source_color: "A7A9AAFF", target_type: "PLA", target_color: "FFFFFFFF", ams_id: 0, slot_id: 2 }], complete: true, missing: [], cost_per_unit: 1.36 });
function Harness() {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<BambuSelectionState>({ overrides: [], ready: false, error: null });
  const changed = useCallback((value: BambuSelectionState) => { mock.state(value); setSelection(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); }, []);
  return <><BambuMaterialSelection taskId="task" productId="product" plateId="plate" allocations={[]} materials={[gray, white]} bindings={bindings} setBindings={setBindings} overrides={selection.overrides} onChange={changed} /><button disabled={!selection.ready}>Confirmar materiais</button></>;
}
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Harness /></QueryClientProvider>);
beforeEach(() => { mock.rpc.mockReset(); mock.state.mockReset(); mock.rpc.mockResolvedValue(preview()); });
afterEach(cleanup);

describe("Bambu material selection per execution", () => {
  it("shows source gray versus actual white, the exact stock item and its kg-based projected cost", async () => {
    mount();
    expect(await screen.findByText("Na execução")).toBeInTheDocument(); expect(screen.getByText("No arquivo original")).toBeInTheDocument();
    expect(screen.getByText("PLA · #FFFFFF")).toBeInTheDocument(); expect(screen.getByText("PLA · #A7A9AA")).toBeInTheDocument();
    expect(screen.getByText("AMS 0 · posição 3")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Material usado em Filamento da placa" })).toHaveValue("white"));
    expect(screen.getByText(/R\$\s*1,70 previstos neste filamento/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar materiais" })).toBeEnabled());
    expect(mock.state).toHaveBeenCalledWith(expect.objectContaining({ overrides: [{ product_id: "product", plate_id: "plate", base_item_id: "gray", item_id: "white" }], ready: true }));
    expect(mock.rpc).toHaveBeenCalledWith("bambu_material_selection_preview", expect.objectContaining({ p_task_id: "task", p_product_id: "product", p_plate_id: "plate", p_allocations: [] }));
  });
  it("offers only the item approved in a sales order and preserves that selection without local substitution", async () => {
    const data = preview(); data.material_policy = "approved_order"; data.expected_materials = [{ ...expected, selected_item_id: "white" }]; mock.rpc.mockResolvedValue(data);
    mount(); const selector = await screen.findByRole("combobox", { name: "Material usado em Filamento da placa" });
    expect(within(selector).queryByRole("option", { name: /estoque cinza/ })).not.toBeInTheDocument();
    expect(within(selector).getByRole("option", { name: /estoque branco/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar materiais" })).toBeEnabled());
    expect(mock.state).toHaveBeenCalledWith({ overrides: [], ready: true, error: null });
  });
  it("asks for the base composition line when the source cannot identify it unambiguously", async () => {
    const data = preview(); data.filaments[0].base_item_id = null; mock.rpc.mockResolvedValue(data);
    mount(); const base = await screen.findByRole("combobox", { name: "Composição de Filamento da placa" });
    expect(base).toHaveValue(""); expect(screen.getByRole("button", { name: "Confirmar materiais" })).toBeDisabled();
    fireEvent.change(base, { target: { value: bambuMaterialScope(expected) } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar materiais" })).toBeEnabled());
  });
  it("does not unlock a write when the contextual preview fails", async () => {
    mock.rpc.mockRejectedValue(new Error("As ordens selecionadas têm materiais aprovados incompatíveis."));
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("materiais aprovados incompatíveis");
    expect(screen.getByRole("button", { name: "Confirmar materiais" })).toBeDisabled();
  });
  it("lets a failed lookup be retried without closing the production form", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("Conexão interrompida")).mockResolvedValue(preview());
    mount(); await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar materiais" })).toBeEnabled());
    expect(screen.queryByText("Conexão interrompida")).not.toBeInTheDocument();
  });
  it("shows an unavailable previous choice explicitly and keeps confirmation blocked", async () => {
    const data = preview(); data.material_options[0].options = [gray]; mock.rpc.mockResolvedValue(data);
    mount();
    expect(await screen.findByRole("option", { name: "Seleção anterior indisponível — selecione novamente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirmar materiais" })).toBeDisabled();
    expect(mock.state).not.toHaveBeenCalledWith(expect.objectContaining({ ready: true }));
  });
});
