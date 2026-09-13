import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductMaterialRecipe from "@/pages/comercial/ProductMaterialRecipe";
import ProductPrintPlates from "@/pages/comercial/ProductPrintPlates";
import { supabase } from "@/integrations/supabase/client";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), plates: [] as Record<string, unknown>[], saveError: false }));
const material = { id: "material-red", name: "PLA vermelho", unit: "kg", material_code: "PLA", color: "Vermelho", color_code: "RED", color_hex: "#FF0000", material_identified_at: "2026-09-13", is_active: true, current_stock: 1, avg_cost: 100 };
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query, range: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: table === "inventory_items" ? [material] : table === "product_print_plates" ? mock.plates : [], error: null }).then(resolve, reject) };
  return query;
} } }));
const preview = () => ({ schema_version: 1, product: { id: "product-1", name: "Base", prints_per_plate: 4 }, recipe: null, plates: mock.plates.map(plate => ({ ...plate, recipe: null })), components: [], complete: false, missing: ["Defina a receita"], cost_per_unit: null });
const mount = (children: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>);
beforeEach(() => {
  mock.plates = []; mock.saveError = false; mock.rpc.mockReset(); mock.toast.mockClear();
  mock.rpc.mockImplementation(async (name: string, payload: Record<string, unknown>) => {
    if (name === "product_material_recipe_preview") return { data: preview(), error: null };
    if (name === "save_product_print_plate") { mock.plates = [{ id: "plate-1", product_id: "product-1", tenant_id: "tenant-1", source_id: "source-1", is_active: true, ...(payload.p_plate as object) }]; return { data: "plate-1", error: null }; }
    return mock.saveError ? { data: null, error: { message: "Resposta interrompida" } } : { data: "version-1", error: null };
  });
});
afterEach(cleanup);

describe("edição da composição física", () => {
  it("exige confirmar os demais custos, preserva o payload no retry e usa o item/cor exatos", async () => {
    const busy = vi.fn(); mount(<ProductMaterialRecipe productId="product-1" tenantId="tenant-1" suggestedNonMaterialCost={2.5} onBusyChange={busy} />);
    fireEvent.click(await screen.findByRole("button", { name: "Definir composição" }));
    await screen.findByRole("option", { name: /PLA vermelho · PLA · Vermelho \[RED\]/ });
    fireEvent.change(screen.getByLabelText("Material e cor · linha 1"), { target: { value: "material-red" } });
    fireEvent.change(screen.getByLabelText("Gramas / impressão inteira"), { target: { value: "100" } });
    expect(screen.getByLabelText(/Demais custos por unidade:/)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Composição não salva" })));
    expect(mock.rpc.mock.calls.filter(call => call[0] === "save_product_material_recipe")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Preencher sugestão/ })); mock.saveError = true;
    fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Resposta interrompida" })));
    mock.saveError = false; fireEvent.click(screen.getByRole("button", { name: "Salvar nova versão" }));
    await waitFor(() => expect(mock.rpc.mock.calls.filter(call => call[0] === "save_product_material_recipe")).toHaveLength(2));
    const saves = mock.rpc.mock.calls.filter(call => call[0] === "save_product_material_recipe");
    expect(saves[0]).toEqual(saves[1]); expect(saves[0][1]).toMatchObject({ p_basis: "per_print", p_plate_id: null, p_lines: [{ item_id: "material-red", grams: 100 }], p_non_material_cost_per_unit: 2.5 });
    expect(mock.rpc.mock.contexts.every(context => context === supabase)).toBe(true);
    expect(busy).toHaveBeenCalledWith(true);
  });
  it("atualiza o preview ao criar uma placa e permite definir sua receita imediatamente", async () => {
    mount(<ProductPrintPlates productId="product-1" tenantId="tenant-1" sourceId="source-1" showProductTotal />);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("product_material_recipe_preview", { p_product_id: "product-1" }));
    const prior = mock.rpc.mock.calls.filter(call => call[0] === "product_material_recipe_preview").length;
    fireEvent.click(screen.getByRole("button", { name: "Adicionar placa" }));
    fireEvent.change(screen.getByLabelText("Unidades do produto atendidas por impressão desta placa"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar placa" }));
    await waitFor(() => expect(mock.rpc.mock.calls.filter(call => call[0] === "product_material_recipe_preview").length).toBeGreaterThan(prior));
    fireEvent.click(await screen.findByText("Materiais e cores desta placa"));
    fireEvent.click(await screen.findByRole("button", { name: "Definir composição" }));
    expect(await screen.findByRole("option", { name: "Uma impressão inteira (2 unidades)" })).toBeInTheDocument();
    expect(screen.queryByText(/Esta placa não está ativa/)).not.toBeInTheDocument();
  });
});
