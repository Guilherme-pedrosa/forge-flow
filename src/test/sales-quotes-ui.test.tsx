import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Orcamentos from "@/pages/comercial/Orcamentos";
import { supabase } from "@/integrations/supabase/client";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), quote: {} as Record<string, unknown>, item: {} as Record<string, unknown> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, order: () => query, range: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: table === "sales_quotes" ? [mock.quote] : table === "sales_quote_items" ? [mock.item] : table === "customers" ? [{ id: "customer-1", name: "Ana Cliente" }] : [{ id: "product-1", name: "Base", sku: "BASE", sale_price: 10 }], error: null }).then(resolve, reject) };
    return query;
  },
} }));
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Orcamentos /></MemoryRouter></QueryClientProvider>);
beforeEach(() => {
  mock.rpc.mockReset(); mock.rpc.mockResolvedValue({ data: "quote-1", error: null }); mock.toast.mockClear();
  mock.quote = { id: "quote-1", tenant_id: "tenant-1", code: "ORC-001", status: "draft", revision: 1, customer_id: "customer-1", customer_snapshot: { name: "Ana Cliente" }, valid_until: "2026-12-31", due_date: "2026-12-01", payment_due_date: "2026-12-01", subtotal: 20, total: 20, discount: 0, shipping: 0, notes: null, order_id: null };
  mock.item = { id: "item-1", quote_id: "quote-1", product_id: "product-1", description: "Base", quantity: 2, unit_price: 10, total: 20, estimated_unit_cost: 3, estimated_total_cost: 6, product_snapshot: { complete: true, cost_per_unit: 3, product: { sku: "BASE" }, requirements: [{ item_id: "material-1", name: "PLA preto", material_code: "PLA", color: "Preto", color_code: "BLACK", grams_per_unit: 20 }], missing: [] } };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("quotation workflow", () => {
  it("prints the customer offer with escaped text and without internal cost details", async () => {
    mock.item.description = '<script>alert("unsafe")</script>';
    const write = vi.fn(); const print = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({ document: { write, close: vi.fn() }, focus: vi.fn(), print } as unknown as Window);
    mount(); fireEvent.click(await screen.findByRole("button", { name: /ORC-001/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
    expect(write).toHaveBeenCalledOnce(); const html = write.mock.calls[0][0];
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).not.toContain("Previsão interna"); expect(html).not.toContain("estimated_total_cost"); expect(html).toContain("Ana Cliente"); expect(html).toContain("PLA · Preto"); expect(print).toHaveBeenCalledOnce();
  });
  it("saves a draft from catalogue products without accepting a client-forged cost snapshot", async () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Novo orçamento" }));
    await screen.findByRole("option", { name: "BASE · Base" });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "customer-1" } });
    fireEvent.change(screen.getByLabelText("Produto cadastrado"), { target: { value: "product-1" } });
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Desconto (R$)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Frete cobrado (R$)"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(mock.rpc.mock.calls.some(call => call[0] === "save_sales_quote")).toBe(true));
    const [name, payload] = mock.rpc.mock.calls.find(call => call[0] === "save_sales_quote")!; expect(name).toBe("save_sales_quote"); expect(payload.p_quote.total).toBe(22); expect(payload.p_items[0]).toMatchObject({ product_id: "product-1", quantity: 2, unit_price: 10, total: 20, material_overrides: [] });
    expect(payload.p_items[0]).not.toHaveProperty("product_snapshot"); expect(payload.p_items[0]).not.toHaveProperty("estimated_unit_cost"); expect(mock.rpc.mock.contexts[0]).toBe(supabase);
  });
  it("withholds emission and margin for an incomplete material recipe", async () => {
    mock.item.product_snapshot = { complete: false, missing: ["Confirme o material"], requirements: [] }; mock.item.estimated_unit_cost = null;
    mount(); fireEvent.click(await screen.findByRole("button", { name: /ORC-001/ }));
    expect(await screen.findByText(/Previsão incompleta:/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Emitir proposta" })).toBeDisabled(); expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });
  it("converts with explicit receivable details and reuses its key after an uncertain error", async () => {
    mock.quote.status = "approved"; mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "Resposta interrompida" } }).mockResolvedValue({ data: "order-1", error: null });
    mount(); fireEvent.click(await screen.findByRole("button", { name: /ORC-001/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Converter em venda" })); expect(screen.getByText(/conta a receber de/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venda" })); await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Resposta interrompida" })));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venda" })); await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    expect(mock.rpc.mock.calls[0]).toEqual(mock.rpc.mock.calls[1]); expect(mock.rpc.mock.calls[0][0]).toBe("convert_sales_quote"); expect(mock.rpc.mock.contexts[0]).toBe(supabase);
  });
  it("shows the frozen color and consumption rather than consulting a new catalogue version", async () => {
    mock.quote.status = "issued"; mount(); fireEvent.click(await screen.findByRole("button", { name: /ORC-001/ }));
    expect(await screen.findByText("PLA · Preto · BLACK")).toBeInTheDocument(); expect(screen.getByText("40 g na composição para 2 unidades")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Registrar aprovação" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("transition_sales_quote", { p_quote_id: "quote-1", p_status: "approved", p_reason: null }));
  });
});
