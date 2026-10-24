import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Produtos from "@/pages/comercial/Produtos";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), filters: vi.fn(), linksError: false }));
const base = { tenant_id: "tenant-1", category: "printed_part", is_active: true, cost_estimate: 2, sale_price: 10, extras: [], prints_per_plate: 1, num_colors: 1 };
const returnProductId = "12345678-1234-4234-8234-123456789abc";
const products = [
  { ...base, id: "apple", name: "Maçã completa", sku: "MACA", is_component: false },
  { ...base, id: "gift", name: "Presente montado", sku: "PRESENTE", is_component: null },
  { ...base, id: "leaf", name: "Folha verde", sku: "FOLHA", is_component: true },
  { ...base, id: "stem", name: "Caule avulso", sku: "CAULE", is_component: true },
  { ...base, id: returnProductId, name: "Produto de retorno", sku: "RETORNO", is_component: false },
];
const links = [
  { id: "apple-leaf", product_id: "apple", component_product_id: "leaf", quantity_per_product: 2 },
  { id: "gift-leaf", product_id: "gift", component_product_id: "leaf", quantity_per_product: 1 },
];

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/pages/comercial/ProductPrintSources", () => ({ default: () => null }));
vi.mock("@/pages/comercial/ProductPrintPlates", () => ({ default: () => null }));
vi.mock("@/pages/comercial/ProductMaterialRecipe", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { mock.filters(table, column, value); return query; },
      is: () => query, in: () => query, order: () => query, range: () => query, single: () => query,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({
        data: table === "products" ? products : table === "product_subitems" ? links : table === "tenants" ? { settings: {} } : [],
        error: table === "product_subitems" && mock.linksError ? { message: "Sem conexão" } : null,
      }).then(resolve, reject),
    };
    return query;
  },
} }));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output aria-label="Endereço atual">{location.pathname}{location.search}</output><button onClick={() => navigate("/comercial/produtos?produto=apple&editar=1&aba=valores")}>Reabrir pelo link</button></>;
}
function mount(entry = "/comercial/produtos") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LocationProbe />
      <Routes><Route path="/comercial/produtos" element={<Produtos />} /><Route path="/comercial/produtos/:id" element={<p>Página do produto</p>} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}
const chooseView = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });

beforeEach(() => {
  mock.linksError = false; mock.filters.mockClear(); mock.toast.mockClear(); mock.rpc.mockReset();
  mock.rpc.mockImplementation(async (name: string) => ({ data: name === "product_material_recipe_catalog" ? [] : "saved", error: null }));
});
afterEach(cleanup);

describe("catálogo de produtos completos e peças", () => {
  it("abre produtos completos por padrão e mantém as peças como vínculos da composição", async () => {
    mount();
    expect(await screen.findByRole("link", { name: "Maçã completa" })).toHaveAttribute("href", "/comercial/produtos/apple");
    expect(screen.getByRole("link", { name: "Presente montado" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Folha verde" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Folha verde" })).not.toBeInTheDocument();
    const composition = await screen.findByLabelText("Composição de Maçã completa");
    expect(within(composition).getByRole("link", { name: "Abrir peça Folha verde" })).toHaveTextContent("2×Folha verde");
    expect(mock.filters).toHaveBeenCalledWith("product_subitems", "tenant_id", "tenant-1");
  });

  it("mostra todos os produtos que usam uma peça e identifica a peça sem vínculo", async () => {
    mount(); await screen.findByRole("link", { name: "Maçã completa" }); chooseView("Peças e subprodutos");
    expect(await screen.findByRole("link", { name: "Folha verde" })).toBeInTheDocument();
    const parents = await screen.findByLabelText("Usada em produtos: Folha verde");
    expect(within(parents).getByRole("link", { name: "Abrir produto Maçã completa" })).toHaveAttribute("href", "/comercial/produtos/apple?aba=pecas");
    expect(within(parents).getByRole("link", { name: "Abrir produto Presente montado" })).toHaveAttribute("href", "/comercial/produtos/gift?aba=pecas");
    expect(screen.getByText("Sem produto vinculado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Maçã completa" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent("?tipo=pecas");
  });

  it("busca produtos pela peça e peças pelo produto, sem depender dos acentos", async () => {
    mount(); await screen.findByLabelText("Composição de Maçã completa");
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar no catálogo" }), { target: { value: "folha" } });
    expect(screen.getByRole("link", { name: "Maçã completa" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Presente montado" })).toBeInTheDocument();
    chooseView("Peças e subprodutos");
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar no catálogo" }), { target: { value: "maca" } });
    expect(screen.getByRole("link", { name: "Folha verde" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Caule avulso" })).not.toBeInTheDocument();
  });

  it("oferece a visão de todos os cadastros sem misturá-la à entrada padrão", async () => {
    mount(); await screen.findByRole("link", { name: "Maçã completa" }); chooseView("Todos os cadastros");
    expect(screen.getByRole("link", { name: "Folha verde" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Maçã completa" })).toBeInTheDocument();
    chooseView("Produtos completos");
    expect(screen.queryByRole("link", { name: "Folha verde" })).not.toBeInTheDocument();
  });

  it("abre a página do produto no clique principal, sem montar o editor legado", async () => {
    mount(); fireEvent.click(await screen.findByRole("link", { name: "Maçã completa" }));
    expect(await screen.findByText("Página do produto")).toBeInTheDocument();
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent("/comercial/produtos/apple");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("o vínculo Usada em abre diretamente as peças do produto completo", async () => {
    mount("/comercial/produtos?tipo=pecas");
    fireEvent.click(await screen.findByRole("link", { name: "Abrir produto Maçã completa" }));
    expect(await screen.findByText("Página do produto")).toBeInTheDocument();
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent("/comercial/produtos/apple?aba=pecas");
  });

  it("preserva edição separada de dados, custo e estoque sem duplicar a composição", async () => {
    mount(); fireEvent.click(await screen.findByRole("button", { name: "Editar Maçã completa" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar Produto" });
    expect(within(dialog).getByLabelText("Nome *")).toHaveValue("Maçã completa");
    expect(within(dialog).getByRole("link", { name: "Gerenciar peças deste produto" })).toHaveAttribute("href", "/comercial/produtos/apple?aba=pecas");
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent(/^\/comercial\/produtos$/);
  });

  it("encaminha o link antigo para a página do produto e preserva a aba", async () => {
    mount("/comercial/produtos?produto=apple&aba=pecas");
    expect(await screen.findByText("Página do produto")).toBeInTheDocument();
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent("/comercial/produtos/apple?aba=pecas");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("limpa o link do editor ao fechar e permite abrir novamente o mesmo produto", async () => {
    mount("/comercial/produtos?produto=apple&editar=1&aba=valores");
    const dialog = await screen.findByRole("dialog", { name: "Editar Produto" });
    expect(within(dialog).getByRole("tab", { name: "Valores" })).toHaveAttribute("data-state", "active");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent(/^\/comercial\/produtos$/);
    fireEvent.click(screen.getByRole("button", { name: "Reabrir pelo link" }));
    expect(await screen.findByRole("dialog", { name: "Editar Produto" })).toBeInTheDocument();
  });

  it.each(["Cancelar", "Salvar"])("%s devolve à página do mesmo produto quando veio dela", async action => {
    mount(`/comercial/produtos?produto=${returnProductId}&editar=1&retorno=${returnProductId}`);
    const dialog = await screen.findByRole("dialog", { name: "Editar Produto" });
    const button = within(dialog).getByRole("button", { name: action });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByText("Página do produto")).toBeInTheDocument();
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent(`/comercial/produtos/${returnProductId}`);
  });

  it.each(["https://externo.example.test", "87654321-1234-4234-8234-123456789abc"])("ignora retorno externo ou para outro cadastro: %s", async returnId => {
    mount(`/comercial/produtos?produto=${returnProductId}&editar=1&retorno=${encodeURIComponent(returnId)}`);
    const dialog = await screen.findByRole("dialog", { name: "Editar Produto" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Endereço atual")).toHaveTextContent(/^\/comercial\/produtos$/);
  });

  it("informa falha dos vínculos sem declarar uma composição vazia", async () => {
    mock.linksError = true; mount("/comercial/produtos?tipo=pecas");
    expect(await screen.findByText("Não foi possível conferir as peças e os produtos vinculados.")).toBeInTheDocument();
    expect(screen.getAllByText("Vínculos indisponíveis no momento.")).toHaveLength(2);
    expect(screen.queryByText("Sem produto vinculado")).not.toBeInTheDocument();
  });
});
