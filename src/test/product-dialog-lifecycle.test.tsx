import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), holdPhotos: false, hasPlate: false }));
const product = { id: "product-1", tenant_id: "tenant-1", name: "Produto de teste", category: "printed_part", is_active: true, cost_estimate: 1, sale_price: 10, prints_per_plate: 1, extras: [], num_colors: 1 };
const source = { id: "source-1", tenant_id: "tenant-1", product_id: "product-1", label: "Arquivo de teste", is_active: true, file_path: "tenant-1/base.3mf", file_name: "base.3mf", created_at: "2026-09-13" };
const plate = { id: "plate-1", tenant_id: "tenant-1", product_id: "product-1", source_id: "source-1", plate_index: 1, label: "Base", units_per_plate: 2, is_active: true, recipe: null };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query, range: () => query, single: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (table === "product_photos" && mock.holdPhotos ? new Promise(() => {}) : Promise.resolve({ data: table === "products" ? [product] : table === "tenants" ? { settings: {} } : table === "product_print_sources" && mock.hasPlate ? [source] : table === "product_print_plates" && mock.hasPlate ? [plate] : [], error: null })).then(resolve, reject) };
  return query;
}, storage: { from: () => ({ createSignedUrl: () => new Promise(() => {}) }) } } }));
const preview = { schema_version: 1, product, recipe: null, plates: [], components: [], complete: false, missing: [], cost_per_unit: null };
beforeEach(() => {
  mock.holdPhotos = false; mock.hasPlate = false; mock.toast.mockClear(); mock.rpc.mockReset();
  mock.rpc.mockImplementation(async (name: string) => ({ data: name === "product_material_recipe_catalog" ? [{ id: product.id, configured: false, complete: false, plate_count: mock.hasPlate ? 1 : 0 }] : name === "product_material_recipe_preview" ? { ...preview, plates: mock.hasPlate ? [plate] : [] } : "saved-product", error: null }));
});
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Produtos /></MemoryRouter></QueryClientProvider>);
const openProduct = async () => { fireEvent.click(await screen.findByText("Produto de teste")); return screen.findByRole("dialog", { name: "Editar Produto" }); };

describe("fechamento do editor do produto", () => {
  it.each(["Fechar", "Cancelar"])("%s encerra uma composição em edição e reabre o produto sem busy herdado", async action => {
    mount(); let dialog = await openProduct();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Definir composição" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeDisabled());
    expect(within(dialog).getByRole("status")).toHaveTextContent("Salve ou cancele a composição, fonte ou placa");
    const close = within(dialog).getByRole("button", { name: action }); expect(close).toBeEnabled(); fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Editar Produto" })).not.toBeInTheDocument());
    dialog = await openProduct(); expect(await within(dialog).findByRole("button", { name: "Definir composição" })).toBeEnabled();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeEnabled());
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled();
  });
  it.each([
    ["Adicionar fonte", "Cancelar fonte"],
    ["Adicionar placa", "Cancelar placa"],
  ])("%s mantém o rascunho separado: Salvar bloqueado e X/Cancelar disponíveis", async (open, cancel) => {
    mock.hasPlate = true; mount(); const dialog = await openProduct();
    fireEvent.click(await within(dialog).findByRole("button", { name: open }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(mock.rpc.mock.calls.some(call => call[0] === "save_product_with_photos")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: cancel }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: open }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const reopened = await openProduct();
    expect(within(reopened).queryByRole("button", { name: cancel })).not.toBeInTheDocument();
    await waitFor(() => expect(within(reopened).getByRole("button", { name: "Salvar" })).toBeEnabled());
  });
  it("mantém cada rascunho independente e não descarta fonte após erro no salvamento", async () => {
    mount(); const dialog = await openProduct();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Definir composição" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Adicionar fonte" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar composição" }));
    expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar fonte" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Não foi possível salvar o vínculo" })));
    expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar fonte" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeEnabled());
  });
  it("salvar a fonte encerra seu rascunho e libera o cadastro", async () => {
    mount(); const dialog = await openProduct();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Adicionar fonte" }));
    fireEvent.change(within(dialog).getByLabelText("Link do modelo ou perfil"), { target: { value: "https://makerworld.com/en/models/123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar fonte" }));
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Cancelar fonte" })).not.toBeInTheDocument());
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeEnabled());
  });
  it("permite fechar enquanto fotos estão sendo consultadas, sem apagar fotos via salvamento incompleto", async () => {
    mock.holdPhotos = true; mount(); const dialog = await openProduct();
    expect(within(dialog).getByRole("button", { name: "Carregando fotos..." })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.rpc.mock.calls.some(call => call[0] === "save_product_with_photos")).toBe(false);
  });
  it("não fecha durante gravação real e libera X/Cancelar após falha", async () => {
    let finish!: (result: unknown) => void;
    const base = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name: string, args: unknown) => name === "save_product_with_photos" ? new Promise(resolve => { finish = resolve; }) : base(name, args));
    mount(); const dialog = await openProduct();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Salvar" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" }); expect(dialog).toBeInTheDocument();
    await act(async () => finish({ data: null, error: { message: "Falha de conexão" } }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("fechar receita aninhada preserva o produto aberto e não herda a trava de edição", async () => {
    mock.hasPlate = true; mount(); const productDialog = await openProduct();
    fireEvent.click(await within(productDialog).findByRole("button", { name: "Materiais e cores desta placa" }));
    const recipeDialog = await screen.findByRole("dialog", { name: "Receita da placa" });
    fireEvent.click(await within(recipeDialog).findByRole("button", { name: "Definir composição" }));
    fireEvent.click(within(recipeDialog).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Receita da placa" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Editar Produto" })).toBeInTheDocument();
    await waitFor(() => expect(within(productDialog).getByRole("button", { name: "Salvar" })).toBeEnabled());
    const cancel = within(productDialog).getByRole("button", { name: "Cancelar" }); expect(cancel).toBeEnabled(); fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("um download pendente não bloqueia sair do produto", async () => {
    mock.hasPlate = true; mount(); const dialog = await openProduct();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Baixar arquivo" }));
    expect(within(dialog).getByRole("button", { name: "Fechar" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
