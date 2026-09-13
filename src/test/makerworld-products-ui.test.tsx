import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";
import { supabase } from "@/integrations/supabase/client";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), products: [] as Record<string, unknown>[], photos: [] as { url: string }[], get: vi.fn() }));
const abortDescriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
beforeAll(() => { if (!abortDescriptor) Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { configurable: true, value(this: AbortSignal) { if (this.aborted) throw new DOMException("Consulta cancelada", "AbortError"); } }); });
afterAll(() => { if (!abortDescriptor) delete (AbortSignal.prototype as unknown as Record<string, unknown>).throwIfAborted; });
const photos = Array.from({ length: 9 }, (_, index) => `https://cdn.example.test/model-${index}.jpg`);
const plate = (index: number, name: string, weight: number, prediction: number, color: string) => ({ index, name, weight, prediction, filaments: [{ id: String(index), type: "PLA", color, usedG: weight }], objects: [{ id: 1, name: "Geometria" }] });
// Raw public design-service shape, deliberately passed through the real parser.
const rawDesign = { id: 456, title: "Conjunto Maker", cover: photos[0], images: photos.slice(1),
  summary: '<p>Descrição completa do autor.</p><p>Montagem sem cola.</p><a href="https://docs.example.test/manual.pdf">Manual</a>',
  defaultInstanceId: 101, tags: ["organizador", "duas placas"], license: "CC BY", creator: { name: "Autor do modelo" },
  designExtension: { boms: [{ displayTitle: "Parafuso M3", quantity: 4, sku: "M3" }], model_files: [{ name: "modelo.3mf" }] },
  instances: [
    { id: 101, profileId: 501, title: "Perfil rápido", extention: { modelInfo: { compatibility: { devProductName: "X1C", nozzleDiameter: .4 }, plates: [plate(1, "Peça única", 50, 1200, "#FFFFFF")] } } },
    { id: 102, profileId: 502, title: "Perfil detalhado", summary: "Configuração com duas placas", extention: {
      modelInfo: { compatibility: { devProductName: "P1S", nozzleDiameter: .4 }, plates: [plate(1, "Base", 80, 1800, "#FF0000"), plate(2, "Tampa", 40, 900, "#FFFFFF")] },
      otherCompatibilityModelInfo: [{ profileId: 602, modelInfo: { compatibility: { devProductName: "A1", nozzleDiameter: .4 }, plates: [plate(1, "Base A1", 90, 1900, "#FF0000"), plate(2, "Tampa A1", 45, 1000, "#FFFFFF")] } }],
    } },
  ],
};
const inventoryItem = { id: "manual-material", name: "Material definido no estoque", unit: "g", avg_cost: .05, loss_coefficient: 0, material_code: "PETG", color: "Azul", color_code: "BLUE", material_identified_at: "2026-09-13", current_stock: 100, is_active: true };
const existingProduct = { id: "product-1", tenant_id: "tenant-1", name: "Nome comercial manual", description: "Descrição manual", sku: "SKU-MANUAL", category: "printed_part", is_active: true,
  material_id: inventoryItem.id, cost_estimate: 3.5, sale_price: 79.9, prints_per_plate: 3, est_grams: 88, est_time_minutes: 120, post_process_minutes: 7, num_colors: 2,
  extras: [{ name: "Embalagem manual", cost: 1.25 }], photo_url: "https://own.example.test/principal.jpg", notes: "Importado do MakerWorld — ID: 456\nObservação manual" };
const bom = { schema_version: 1, product: existingProduct, plates: [], components: [], requirements: [{ item_id: inventoryItem.id }], complete: true, missing: [], cost_per_unit: 3.5,
  recipe: { version_id: "recipe-manual-7", version: 7, basis: "per_unit", units_per_print: 3, non_material_cost_per_unit: 3, material_cost_per_unit: .5, cost_per_unit: 3.5, complete: true, missing: [], created_at: "2026-09-13", notes: "Receita aprovada", lines: [{ item_id: inventoryItem.id, name: inventoryItem.name, material_code: "PETG", color: "Azul", color_code: "BLUE", grams: 10, grams_per_unit: 10, grams_per_print: 30 }] } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc, functions: { invoke: async () => ({ data: { projects: [] }, error: null }) },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query, range: () => query, single: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: table === "products" ? mock.products : table === "product_photos" ? mock.photos : table === "tenants" ? { settings: {} } : table === "inventory_items" ? [inventoryItem] : [], error: null }).then(resolve, reject) };
    return query;
  },
} }));
beforeEach(() => {
  mock.products = []; mock.photos = []; mock.toast.mockClear(); mock.rpc.mockReset(); mock.get.mockReset();
  mock.get.mockResolvedValue({ data: { status: "ready", payload: rawDesign }, error: null });
  mock.rpc.mockImplementation(async (name: string, args: unknown) => {
    if (name === "request_makerworld_import") return { data: "request-1", error: null };
    if (name === "get_makerworld_import") return mock.get(args);
    if (name === "product_material_recipe_catalog") return { data: mock.products.map(product => ({ id: product.id, configured: true, complete: true, cost_per_unit: 3.5, plate_count: 0 })), error: null };
    if (name === "product_material_recipe_preview") return { data: bom, error: null };
    return { data: "saved-product", error: null };
  });
});
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Produtos /></MemoryRouter></QueryClientProvider>);
async function searchModel() {
  fireEvent.click(screen.getByRole("button", { name: "Importar da Bambu" }));
  const dialog = await screen.findByRole("dialog", { name: "Importar da Bambu Lab" });
  fireEvent.click(within(dialog).getByRole("button", { name: "MakerWorld" }));
  fireEvent.change(within(dialog).getByLabelText("Link do modelo MakerWorld"), { target: { value: "https://makerworld.com/pt/models/456-conjunto#profileId-102" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Buscar modelo do MakerWorld" }));
  return dialog;
}
async function chooseA1() {
  const chooser = await screen.findByRole("dialog", { name: "Escolha a opção de impressão" });
  fireEvent.click(within(chooser).getByRole("button", { name: /Perfil detalhado/ }));
  fireEvent.change(within(chooser).getByLabelText("Configuração da impressora"), { target: { value: "1" } });
  expect(within(chooser).getByRole("option", { name: /^A1 · bico 0.4 mm/ })).toHaveProperty("selected", true);
  fireEvent.click(within(chooser).getByRole("button", { name: "Importar esta opção" }));
}
const savedPayload = () => mock.rpc.mock.calls.find(call => call[0] === "save_product_with_photos")?.[1];

describe("importação MakerWorld no cadastro de produtos", () => {
  it("preserva a configuração A1, todas as fotos/perfis/placas e não inventa material, cor ou rendimento", async () => {
    mount(); const search = await searchModel();
    fireEvent.click(await within(search).findByRole("button", { name: /Conjunto Maker/ }));
    await chooseA1();
    const editor = await screen.findByRole("dialog", { name: "Novo Produto" });
    fireEvent.click(within(editor).getByRole("button", { name: "Ver todas as 9 fotos" }));
    expect(within(editor).getAllByRole("button", { name: /^Ampliar foto \d+ do MakerWorld$/ })).toHaveLength(9);
    fireEvent.click(within(editor).getByText("Ver ficha técnica, placas e materiais"));
    expect(within(editor).getByText("A1 · selecionada")).toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText("Preço unitário (R$)"), { target: { value: "39.9" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(savedPayload()).toBeDefined());
    const payload = savedPayload(); const imported = payload.p_product.external_import;
    expect(payload.p_product).toMatchObject({ name: "Conjunto Maker", material_id: null, prints_per_plate: 1, num_colors: 2, sale_price: 39.9 });
    expect(imported).toMatchObject({ provider: "makerworld", selected_profile_id: "102", selected_variant_profile_id: "602" });
    expect(imported.profiles).toHaveLength(2); expect(imported.profiles[1].variants[0]).toMatchObject({ printer_model: "A1", weight_grams: 135, time_seconds: 2900 });
    expect(imported.profiles[1].variants[0].plate_details.map((value: { name: string }) => value.name)).toEqual(["Base A1", "Tampa A1"]);
    expect(imported.profiles[1].variants[0].plate_details.every((value: { units_per_plate: null }) => value.units_per_plate === null)).toBe(true);
    expect(imported.gallery).toHaveLength(9); expect(payload.p_photos).toEqual(photos.slice(1)); expect(payload.p_product.photo_url).toBe(photos[0]);
    expect(mock.rpc).toHaveBeenCalledWith("request_makerworld_import", { p_url: "https://makerworld.com/en/models/456#profileId-102" });
    expect(mock.rpc).toHaveBeenCalledWith("get_makerworld_import", { p_request_id: "request-1" });
    expect(mock.rpc.mock.contexts.every(context => context === supabase)).toBe(true);
    expect(mock.rpc.mock.calls.some(call => call[0] === "save_product_material_recipe")).toBe(false);
  });
  it("atualiza detalhes e mescla a galeria do produto existente preservando nome, preço e composição manual", async () => {
    mock.products = [existingProduct]; mock.photos = [{ url: "https://own.example.test/manual-extra.jpg" }, { url: photos[2] }]; mount();
    fireEvent.click(await screen.findByText(existingProduct.name));
    let editor = await screen.findByRole("dialog", { name: "Editar Produto" });
    const refresh = within(editor).getByRole("button", { name: "Atualizar fotos e detalhes do link" });
    await waitFor(() => expect(refresh).toBeEnabled()); fireEvent.click(refresh);
    await chooseA1(); editor = screen.getByRole("dialog", { name: "Editar Produto" });
    expect(within(editor).getByText("Versão 7 · Composição e custo completos")).toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(savedPayload()).toBeDefined());
    const payload = savedPayload(); expect(payload.p_product_id).toBe(existingProduct.id);
    expect(payload.p_product).toMatchObject({ name: existingProduct.name, sale_price: 79.9, sku: "SKU-MANUAL", material_id: inventoryItem.id, prints_per_plate: 3, est_grams: 88, est_time_minutes: 120, post_process_minutes: 7, num_colors: 2, notes: existingProduct.notes, extras: existingProduct.extras });
    expect(payload.p_product.photo_url).toBe(existingProduct.photo_url); expect(payload.p_photos).toHaveLength(10);
    expect(payload.p_photos).toEqual(expect.arrayContaining([...photos, "https://own.example.test/manual-extra.jpg"]));
    expect(payload.p_product.external_import.selected_variant_profile_id).toBe("602");
    expect(mock.rpc.mock.calls.some(call => call[0] === "save_product_material_recipe")).toBe(false);
  });
  it("erro da consulta mantém o fluxo aberto para corrigir e não cria produto", async () => {
    mock.get.mockResolvedValue({ data: { status: "error", message: "Modelo privado ou indisponível" }, error: null }); mount(); const dialog = await searchModel();
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Não foi possível consultar o modelo", description: "Modelo privado ou indisponível" })));
    expect(dialog).toBeInTheDocument(); expect(screen.queryByRole("dialog", { name: "Novo Produto" })).not.toBeInTheDocument();
    expect(savedPayload()).toBeUndefined(); expect(within(dialog).getByRole("button", { name: "Buscar modelo do MakerWorld" })).toBeEnabled();
  });
  it("fechar a consulta impede que a resposta atrasada reabra a importação", async () => {
    let resolveRead!: (value: unknown) => void; mock.get.mockImplementation(() => new Promise(resolve => { resolveRead = resolve; })); mount(); const dialog = await searchModel();
    await waitFor(() => expect(mock.get).toHaveBeenCalled()); fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    await act(async () => resolveRead({ data: { status: "ready", payload: rawDesign }, error: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(savedPayload()).toBeUndefined();
    expect(mock.toast.mock.calls.some(call => /importado|atualizada/i.test(call[0].title))).toBe(false);
  });
  it("fechar o produto durante atualização descarta a resposta atrasada sem abrir novo cadastro", async () => {
    mock.products = [existingProduct]; let resolveRead!: (value: unknown) => void; mock.get.mockImplementation(() => new Promise(resolve => { resolveRead = resolve; })); mount();
    fireEvent.click(await screen.findByText(existingProduct.name)); const editor = await screen.findByRole("dialog", { name: "Editar Produto" });
    const refresh = within(editor).getByRole("button", { name: "Atualizar fotos e detalhes do link" }); await waitFor(() => expect(refresh).toBeEnabled()); fireEvent.click(refresh);
    await waitFor(() => expect(mock.get).toHaveBeenCalled()); fireEvent.click(within(editor).getByRole("button", { name: "Cancelar" }));
    await act(async () => resolveRead({ data: { status: "ready", payload: rawDesign }, error: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(savedPayload()).toBeUndefined();
    fireEvent.click(screen.getByText(existingProduct.name)); const reopened = await screen.findByRole("dialog", { name: "Editar Produto" });
    expect(within(reopened).queryByRole("region", { name: "Detalhamento importado do MakerWorld" })).not.toBeInTheDocument();
  });
});
