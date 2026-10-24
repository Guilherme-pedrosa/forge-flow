import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductWorkspace from "@/pages/comercial/ProductWorkspace";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), rows: vi.fn(), status: vi.fn() }));
const technical = { source: "manual", revision: "revision-1", materials: [{ item_id: null, material: "PLA", color: "Verde", grams: 2, cost_per_kg: 80 }], grams: 2, print_seconds: 300, finishing_seconds: 0, estimated_cost: 0.16 };
const parent = { id: "apple", name: "Maçã", sku: "APPLE", is_component: false, assembly_enabled: true, stock_item_id: "apple-stock", sale_price: 20, manual_cost_override: 3 };
const child = { id: "leaf", name: "Folha", sku: "LEAF", is_component: true, stock_item_id: "leaf-stock", manual_cost_override: 0.5 };
const part = { id: "membership", component_product_id: "leaf", label: "Folha", sku: "LEAF", quantity_per_product: 1, quantity_per_plate: null, plate_id: null, plate_label: null, balance: 12, available: 12, missing: 0, to_print: 0, technical };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/lib/assembly", () => ({ assemblyKeys: ["products", "assembly_status", "inventory_items"], assemblyRows: mock.rows, assemblyRpc: mock.rpc, readAssemblyStatus: mock.status }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; label: string }[] }) => <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}><option value="">Escolher</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select> }));
vi.mock("@/components/production/AssemblyWorkspace", () => ({ AssemblyWorkspace: ({ onEditComposition }: { onEditComposition: () => void }) => <div>Montagem em contexto<button onClick={onEditComposition}>Voltar às peças</button></div> }));
vi.mock("@/pages/comercial/ProductPrintSources", () => ({ default: () => <div>Arquivos de impressão</div> }));
vi.mock("@/pages/comercial/ProductPrintPlates", () => ({ default: () => <div>Placas de impressão</div> }));
beforeEach(() => {
  mock.rows.mockReset(); mock.rpc.mockReset(); mock.status.mockReset();
  mock.status.mockResolvedValue({ product_id: "apple", name: "Maçã", individual_stock: true, enabled: true, components: [part] });
  mock.rpc.mockImplementation(async name => name === "product_piece_spec" ? technical : "membership");
  mock.rows.mockImplementation(async (table, _columns, filters) => table === "products" ? filters.is_component ? [child] : [parent, child] : table === "product_subitems" ? [{ id: "membership", product_id: "apple", component_product_id: "leaf", quantity_per_product: 1 }] : table === "inventory_items" ? [{ id: "apple-stock", current_stock: 2 }, { id: "leaf-stock", current_stock: 12 }] : []);
});
afterEach(cleanup);
function mount(path = "/comercial/produtos/apple") { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path="/comercial/produtos/:productId" element={<ProductWorkspace />} /></Routes></MemoryRouter></QueryClientProvider>); }

describe("Produto e suas peças no mesmo contexto", () => {
  it("mostra quantidade, estoque e ficha da peça e salva identidade e técnica juntas", async () => {
    mount();
    const card = await screen.findByRole("article", { name: "Peça Folha" });
    expect(within(card).getByText("2 g")).toBeInTheDocument();
    expect(within(card).getByText("5min")).toBeInTheDocument();
    expect(within(card).getByText("12")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Editar Folha" }));
    fireEvent.change(screen.getByLabelText("Nome da peça *"), { target: { value: "Folha verde" } });
    fireEvent.change(screen.getByLabelText("Custo manual por peça (R$)"), { target: { value: "0,75" } });
    fireEvent.change(screen.getByLabelText("Quantidade desta peça em 1 produto completo"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Impressão por peça (min)"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar peça no produto" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_subitem_details", expect.objectContaining({ p_product_id: "apple", p_subitem_id: "membership", p_data: expect.objectContaining({ name: "Folha verde", quantity_per_product: 2, unit_cost: 0.75, technical: expect.objectContaining({ revision: "revision-1", print_seconds: 360, materials: [expect.objectContaining({ grams: 2 })] }) }) })));
    expect(mock.rpc.mock.calls.filter(([name]) => name === "save_product_subitem_details")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByLabelText("Nome da peça *")).not.toBeInTheDocument());
  });
  it("mostra o produto pai ao abrir uma peça e permite editar dentro dele", async () => {
    mount("/comercial/produtos/leaf");
    expect(await screen.findByRole("heading", { name: "Esta peça faz parte de" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Editar dentro do produto/ })).toHaveAttribute("href", "/comercial/produtos/apple?peca=leaf");
    expect(screen.getByRole("link", { name: "Maçã" })).toHaveAttribute("href", "/comercial/produtos/apple");
  });
  it("preserva o rendimento local da placa mista ao editar a ficha global", async () => {
    mock.status.mockResolvedValue({ product_id: "apple", individual_stock: true, components: [{ ...part, plate_id: "mixed", plate_label: "Placa mista", quantity_per_plate: 3, technical: { ...technical, pieces_per_plate: 20 } }] });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Editar Folha" }));
    expect(screen.getByLabelText("Quantas unidades desta peça saem nesta placa?")).toHaveValue("3");
    fireEvent.change(screen.getByLabelText("Impressão por peça (min)"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar peça no produto" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_subitem_details", expect.objectContaining({ p_data: expect.objectContaining({ technical: expect.objectContaining({ pieces_per_plate: 20, print_seconds: 360 }) }) })));
    const payload = mock.rpc.mock.calls.find(([name]) => name === "save_product_subitem_details")![1].p_data;
    expect(payload).not.toHaveProperty("quantity_per_plate");
    expect(payload).not.toHaveProperty("unit_cost");
    expect(payload).not.toHaveProperty("photo_url");
  });
  it("salva nome preservando quantidades desconhecidas e ficha não editada", async () => {
    mock.status.mockResolvedValue({ product_id: "apple", individual_stock: true, components: [{ ...part, plate_id: "mixed", quantity_per_plate: null, quantity_per_product: null }] });
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Editar Folha" }));
    expect(screen.getByLabelText("Quantidade desta peça em 1 produto completo")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Nome da peça *"), { target: { value: "Folha pequena" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar peça no produto" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_subitem_details", expect.objectContaining({ p_data: { name: "Folha pequena", quantity_per_product: null } })));
  });
  it("usa peça já cadastrada sem alterar seus dados ou estoque", async () => {
    mount(); await screen.findByRole("article", { name: "Peça Folha" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar peça" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar peça existente" }));
    await waitFor(() => expect(mock.rows).toHaveBeenCalledWith("products", "id,name,sku", { tenant_id: "tenant", is_component: true, is_active: true }, "name"));
    fireEvent.change(await screen.findByRole("combobox", { name: "Peça cadastrada" }), { target: { value: "leaf" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar peça no produto" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_product_subitem_details", expect.objectContaining({ p_data: { component_product_id: "leaf", quantity_per_product: 1 } })));
  });
  it("abre estoque e montagem sem sair do produto", async () => {
    mount(); await screen.findByRole("article", { name: "Peça Folha" });
    fireEvent.click(screen.getByRole("tab", { name: "Estoque e montagem" }));
    expect(await screen.findByText("Montagem em contexto")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voltar às peças" }));
    expect(screen.getByRole("article", { name: "Peça Folha" })).toBeInTheDocument();
  });
  it("exibe falha de composição sem simular uma lista vazia ou liberar montagem", async () => {
    mock.status.mockRejectedValue(new Error("Sem conexão")); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a composição");
    expect(screen.queryByText("Nenhuma peça cadastrada neste produto")).not.toBeInTheDocument();
    expect(screen.queryByText("Montagem em contexto")).not.toBeInTheDocument();
  });
});
