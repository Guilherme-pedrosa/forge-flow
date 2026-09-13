import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pedidos from "@/pages/comercial/Pedidos";
import Orcamentos from "@/pages/comercial/Orcamentos";
import type { MaterialOverride } from "@/lib/product-material-variant";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), saved: [] as MaterialOverride[] }));
const blue = { product_id: "product-1", plate_id: "plate-1", base_item_id: "red", item_id: "blue" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
// This suite tests the page-to-item contract; the choice component has its own RPC/price tests.
vi.mock("@/components/comercial/ProductMaterialChoice", () => ({ ProductMaterialChoice: ({ productId, overrides, onChange, onUnitPriceChange, disabled }: { productId: string; overrides: MaterialOverride[]; onChange: (value: MaterialOverride[]) => void; onUnitPriceChange: (value: number) => void; disabled: boolean }) => <section><output aria-label="Escolha preservada">{JSON.stringify(overrides)}</output><button disabled={disabled} onClick={() => onChange([{ product_id: productId, plate_id: "plate-1", base_item_id: "red", item_id: "blue" }])}>Selecionar azul</button><button disabled={disabled} onClick={() => onUnitPriceChange(25)}>Usar preço 25</button></section> }));
vi.mock("@/components/ui/select", async () => {
  const { Children, isValidElement } = await import("react");
  return {
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => {
      const trigger = Children.toArray(children).find(child => isValidElement(child) && (child.props as Record<string, unknown>)["aria-label"]);
      const label = isValidElement(trigger) ? (trigger.props as Record<string, string>)["aria-label"] : "Selecionar";
      return <select aria-label={label} value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>;
    }, SelectTrigger: () => null, SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query, single: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data:
      table === "orders" ? [{ id: "order-1", code: "PED-001", status: "draft", customer_id: null, total: 20, discount: 0, shipping: 0, notes: "", source_quote_id: null, created_at: "2026-09-13" }]
      : table === "sales_quotes" ? [{ id: "quote-1", code: "ORC-001", status: "draft", revision: 1, customer_id: null, customer_snapshot: null, subtotal: 20, total: 20, discount: 0, shipping: 0, notes: null }]
      : ["order_items", "sales_quote_items"].includes(table) ? [{ id: "item-1", product_id: "product-1", description: "Base", quantity: 2, unit_price: 10, total: 20, notes: "", material_overrides: mock.saved, product_snapshot: { complete: true, product: { name: "Base", est_time_minutes: 10 }, requirements: [], plates: [], missing: [] }, estimated_unit_cost: 2, estimated_total_cost: 4 }]
      : table === "products" ? [{ id: "product-1", name: "Base", sku: "BASE", sale_price: 10 }, { id: "product-2", name: "Tampa", sku: "TAMPA", sale_price: 12 }]
      : table === "tenants" ? { name: "Forge", settings: {} } : [], error: null }).then(resolve, reject) };
  return query;
} } }));
const mount = (page: "order" | "quote", existing = false) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[existing && page === "order" ? "/?pedido=order-1" : "/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{page === "order" ? <Pedidos /> : <Orcamentos />}</MemoryRouter></QueryClientProvider>);
const savedPayload = (name: string) => mock.rpc.mock.calls.find(call => call[0] === name)?.[1];
beforeEach(() => { mock.saved = []; mock.rpc.mockReset(); mock.toast.mockClear(); mock.rpc.mockImplementation(async (name: string) => ({ data: name === "save_sales_order" ? "order-1" : "quote-1", error: null })); });
afterEach(cleanup);

describe("cores preservadas nos itens comerciais", () => {
  it.each(["novo", "editar"])("pedido %s em tela estreita mantém campos únicos, total e remoção por item sem perder a cor", async mode => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 }); window.dispatchEvent(new Event("resize"));
    try {
      mock.saved = [blue]; mount("order", mode === "editar");
      fireEvent.click(await screen.findByRole("button", { name: mode === "editar" ? "Editar rascunho" : "Novo pedido" }));
      await screen.findByRole("option", { name: /Base/ });
      fireEvent.change(screen.getByLabelText("Produto do item 1"), { target: { value: "product-1" } });
      fireEvent.click(screen.getByRole("button", { name: "Selecionar azul" }));
      fireEvent.change(screen.getByLabelText("Quantidade do item 1"), { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Preço unitário do item 1"), { target: { value: "12.5" } });
      expect(screen.getAllByLabelText("Produto do item 1")).toHaveLength(1);
      expect(screen.getAllByLabelText("Quantidade do item 1")).toHaveLength(1);
      expect(screen.getAllByLabelText("Escolha preservada")).toHaveLength(1);
      expect(screen.getByLabelText("Total do item 1")).toHaveTextContent(/37,50/);
      expect(screen.getByRole("button", { name: "Remover item 1" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Adicionar item ao pedido" }));
      fireEvent.change(screen.getByLabelText("Produto do item 2"), { target: { value: "product-2" } });
      expect(screen.getByRole("button", { name: "Remover item 2" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Remover item 2" }));
      expect(screen.queryByLabelText("Produto do item 2")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Escolha preservada")).toHaveTextContent(JSON.stringify(blue));
      fireEvent.click(screen.getByRole("button", { name: mode === "editar" ? /Salvar alterações/i : "Criar pedido" }));
      await waitFor(() => expect(savedPayload("save_sales_order")).toBeDefined());
      expect(savedPayload("save_sales_order").p_items).toEqual([expect.objectContaining({ product_id: "product-1", material_overrides: [blue], quantity: 3, unit_price: 12.5, total: 37.5 })]);
    } finally { Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth }); window.dispatchEvent(new Event("resize")); }
  });
  it("cria pedido com a cor escolhida para o item, sem modificar o produto do catálogo", async () => {
    mount("order"); fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    await screen.findByRole("option", { name: /Base/ });
    fireEvent.change(screen.getByLabelText("Produto do item 1"), { target: { value: "product-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Selecionar azul" })); fireEvent.click(screen.getByRole("button", { name: "Usar preço 25" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar pedido" }));
    await waitFor(() => expect(savedPayload("save_sales_order")).toBeDefined());
    expect(savedPayload("save_sales_order")).toMatchObject({ p_order_id: null, p_items: [expect.objectContaining({ material_overrides: [blue], unit_price: 25, total: 25 })] });
    expect(mock.rpc.mock.calls.some(call => ["save_product_with_photos", "save_product_material_recipe"].includes(call[0]))).toBe(false);
  });
  it("seleciona cor e preço no orçamento, envia apenas overrides e limpa a escolha ao trocar produto", async () => {
    mount("quote"); fireEvent.click(screen.getByRole("button", { name: "Novo orçamento" }));
    await screen.findByRole("option", { name: "BASE · Base" });
    fireEvent.change(screen.getByLabelText("Produto cadastrado"), { target: { value: "product-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Selecionar azul" }));
    expect(screen.getByLabelText("Escolha preservada")).toHaveTextContent('"item_id":"blue"');
    fireEvent.change(screen.getByLabelText("Produto cadastrado"), { target: { value: "product-2" } });
    expect(screen.getByLabelText("Escolha preservada")).toHaveTextContent("[]");
    fireEvent.change(screen.getByLabelText("Produto cadastrado"), { target: { value: "product-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Selecionar azul" })); fireEvent.click(screen.getByRole("button", { name: "Usar preço 25" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(savedPayload("save_sales_quote")).toBeDefined());
    expect(savedPayload("save_sales_quote").p_items[0]).toMatchObject({ material_overrides: [blue], unit_price: 25 });
    expect(savedPayload("save_sales_quote").p_items[0]).not.toHaveProperty("product_snapshot");
  });
  it.each(["Editar", "Duplicar"])("%s orçamento preserva material e placa escolhidos na nova submissão", async action => {
    mock.saved = [blue]; mount("quote"); fireEvent.click(await screen.findByRole("button", { name: /ORC-001/ }));
    fireEvent.click(await screen.findByRole("button", { name: action }));
    expect(screen.getByLabelText("Escolha preservada")).toHaveTextContent(JSON.stringify([blue]));
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(savedPayload("save_sales_quote")).toBeDefined());
    expect(savedPayload("save_sales_quote")).toMatchObject({ p_quote_id: action === "Duplicar" ? null : "quote-1", p_items: [expect.objectContaining({ material_overrides: [blue] })] });
  });
  it("não abre duplicação descartando silenciosamente uma escolha salva inválida", async () => {
    mock.saved = [{ product_id: "product-1", base_item_id: "red" }] as MaterialOverride[];
    mount("quote"); fireEvent.click(await screen.findByRole("button", { name: /ORC-001/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Duplicar" }));
    expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "A seleção de material deste item está incompleta." }));
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
    expect(savedPayload("save_sales_quote")).toBeUndefined();
  });
  it("editar pedido restaura escolha física, permite preço e limpa material ao trocar SKU", async () => {
    mock.saved = [blue]; mount("order", true);
    fireEvent.click(await screen.findByRole("button", { name: "Editar rascunho" }));
    expect(screen.getByLabelText("Escolha preservada")).toHaveTextContent(JSON.stringify([blue]));
    fireEvent.change(screen.getByLabelText("Produto do item 1"), { target: { value: "product-2" } });
    expect(screen.getByLabelText("Escolha preservada")).toHaveTextContent("[]");
    fireEvent.change(screen.getByLabelText("Produto do item 1"), { target: { value: "product-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Selecionar azul" })); fireEvent.click(screen.getByRole("button", { name: "Usar preço 25" }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/i }));
    await waitFor(() => expect(savedPayload("save_sales_order")).toBeDefined());
    expect(savedPayload("save_sales_order")).toMatchObject({ p_order_id: "order-1", p_items: [expect.objectContaining({ material_overrides: [blue], quantity: 2, unit_price: 25, total: 50 })] });
    expect(savedPayload("save_sales_order").p_items[0]).not.toHaveProperty("product_snapshot");
  });
});
