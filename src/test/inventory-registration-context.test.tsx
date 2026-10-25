import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Itens from "@/pages/estoque/Itens";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), toast: vi.fn(),
  items: [] as Record<string, unknown>[],
  products: [] as Record<string, unknown>[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
// These tests check registration payloads and ownership of stock. Native browser
// selection, scrolling and responsive dialog bounds are checked on the live UI.
vi.mock("@/components/shared/SearchableItemSelect", () => ({
  SearchableItemSelect: ({ label, value, options, onChange, disabled }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void; disabled?: boolean }) =>
    <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>,
}));
vi.mock("@/components/ui/select", async () => {
  const { Children, isValidElement } = await import("react");
  return {
    Select: ({ value, onValueChange, children, disabled }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) => {
      const trigger = Children.toArray(children).find(child => isValidElement(child) && (child.props as Record<string, unknown>)["aria-label"]);
      const label = isValidElement(trigger) ? (trigger.props as Record<string, string>)["aria-label"] : "Selecionar";
      return <select aria-label={label} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>;
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, order: () => query, range: () => query,
      is: () => query, in: () => query, not: () => query, returns: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: table === "inventory_items" ? mock.items : table === "products" ? mock.products : [], error: null }).then(resolve, reject),
    };
    return query;
  },
} }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  mock.rpc.mockReset(); mock.toast.mockClear(); mock.items = []; mock.products = [];
  mock.rpc.mockResolvedValue({ data: "created-item", error: null });
});
afterEach(cleanup);
function Location() { return <output aria-label="Página atual">{useLocation().pathname}</output>; }
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Itens /><Location /></MemoryRouter></QueryClientProvider>);
}

describe("contexto do cadastro de materiais e insumos", () => {
  it("cadastra filamento com identidade física, custo e saldo no mesmo item", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo filamento" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome do item *"), { target: { value: "PLA branco" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Material identificado" }), { target: { value: "PLA" } });
    fireEvent.change(within(dialog).getByLabelText("Nome da cor"), { target: { value: "Branco" } });
    fireEvent.change(within(dialog).getByLabelText("Código da cor"), { target: { value: "WHITE" } });
    fireEvent.change(within(dialog).getByLabelText("Quantidade em estoque"), { target: { value: "1000" } });
    fireEvent.change(within(dialog).getByLabelText("Custo unitário do estoque"), { target: { value: "0,075" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cadastrar filamento|Criar item|Salvar item/ }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({
      p_item_id: null,
      p_item: expect.objectContaining({ name: "PLA branco", category: "filament", unit: "g", material_code: "PLA", color: "Branco", color_code: "WHITE", current_stock: 1000, avg_cost: 0.075, parent_id: null }),
    })));
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["save_inventory_catalog"]);
  });

  it("cadastra embalagem por unidade sem herdar campos de impressão", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo insumo" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Nome da cor")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Material identificado" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Diâmetro (mm)")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Unidade do saldo no estoque" })).toHaveValue("un");
    fireEvent.change(within(dialog).getByLabelText("Nome do item *"), { target: { value: "Saco kraft" } });
    fireEvent.change(within(dialog).getByLabelText("Quantidade em estoque"), { target: { value: "30" } });
    fireEvent.change(within(dialog).getByLabelText("Custo unitário do estoque"), { target: { value: "2,50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Cadastrar insumo|Criar item|Salvar item/ }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({
      p_item: expect.objectContaining({ name: "Saco kraft", category: "consumable", unit: "un", current_stock: 30, avg_cost: 2.5, diameter: null, material_code: null, color: null }),
    })));
  });

  it("exclui estoque de produtos e peças da lista, pesquisa e indicadores de materiais", async () => {
    const stock = { category: "consumable", unit: "un", is_active: true, current_stock: 4, avg_cost: 5, min_stock: 10, parent_id: null };
    mock.items = [{ ...stock, id: "finished-stock", name: "Maçã completa" }, { ...stock, id: "piece-stock", name: "Caule impresso" }, { ...stock, id: "supply", name: "Caixa kraft", current_stock: 3, avg_cost: 1, min_stock: 1 }];
    mock.products = [{ id: "finished-product", name: "Maçã completa", stock_item_id: "finished-stock", is_component: false }, { id: "piece-product", name: "Caule impresso", stock_item_id: "piece-stock", is_component: true }];
    mount();
    expect(await screen.findByText("Caixa kraft")).toBeInTheDocument();
    expect(screen.queryByText("Maçã completa")).not.toBeInTheDocument();
    expect(screen.queryByText("Caule impresso")).not.toBeInTheDocument();
    expect(screen.queryByText("Produto acabado")).not.toBeInTheDocument();
    expect(screen.queryByText("Peça produzida")).not.toBeInTheDocument();
    expect(screen.getByText("Itens Cadastrados").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Abaixo do Mínimo").parentElement).toHaveTextContent("0");
    expect(screen.getByText("Valor Total em Estoque").parentElement).toHaveTextContent("R$ 3,00");
    expect(screen.queryByRole("option", { name: "Produtos e peças produzidos" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Buscar por nome, SKU, material, cor…"), { target: { value: "Maçã" } });
    expect(screen.getByText("Nenhum item encontrado")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("troca o tipo de um rascunho sem transferir identidade e diâmetro de filamento para um insumo", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo filamento" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Material identificado" }), { target: { value: "PLA" } });
    fireEvent.change(within(dialog).getByLabelText("Nome da cor"), { target: { value: "Branco" } });
    fireEvent.change(within(dialog).getByLabelText("Código da cor"), { target: { value: "WHITE" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Tipo de item" }), { target: { value: "consumable" } });
    expect(within(dialog).queryByLabelText("Nome da cor")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Unidade do saldo no estoque" })).toHaveValue("un");
    fireEvent.change(within(dialog).getByLabelText("Nome do item *"), { target: { value: "Caixa de presente" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar item" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({
      p_item: expect.objectContaining({ name: "Caixa de presente", category: "consumable", unit: "un", material_type: null, material_code: null, color: null, color_code: null, diameter: null }),
    })));
  });

  it("preserva unidade, quantidade e custo já informados ao mudar o tipo do rascunho", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Novo filamento" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Quantidade em estoque"), { target: { value: "1000" } });
    fireEvent.change(within(dialog).getByLabelText("Custo unitário do estoque"), { target: { value: "0,075" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Tipo de item" }), { target: { value: "consumable" } });
    expect(within(dialog).getByRole("combobox", { name: "Unidade do saldo no estoque" })).toHaveValue("g");
    expect(within(dialog).getByLabelText("Quantidade em estoque")).toHaveValue("1000");
    expect(within(dialog).getByLabelText("Custo unitário do estoque")).toHaveValue("0,075");
    fireEvent.change(within(dialog).getByLabelText("Nome do item *"), { target: { value: "Insumo pesado em gramas" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar item" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_inventory_catalog", expect.objectContaining({
      p_item: expect.objectContaining({ category: "consumable", unit: "g", current_stock: 1000, avg_cost: 0.075 }),
    })));
  });
});
