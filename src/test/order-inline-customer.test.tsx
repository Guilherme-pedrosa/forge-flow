import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pedidos from "@/pages/comercial/Pedidos";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), tenant: "tenant-a", user: "user-a", customers: [] as Record<string, unknown>[], filters: [] as unknown[][] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/components/comercial/CommercialPdfButton", () => ({ CommercialPdfButton: () => null }));
vi.mock("@/components/comercial/ProductMaterialChoice", () => ({ ProductMaterialChoice: () => null }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ label, value, options, onChange, disabled }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean }) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  let tenant: unknown = null;
  const query = { select: () => query, order: () => query, range: () => query,
    eq: (field: string, value: unknown) => { mock.filters.push([table, field, value]); if (field === "tenant_id") tenant = value; return query; },
    limit: () => Promise.resolve({ data: [], error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "customers" ? mock.customers.filter(row => row.tenant_id === tenant) : [], error: null }).then(resolve) };
  return query;
} } }));
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = () => <QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Pedidos /></MemoryRouter></QueryClientProvider>;
  const view = render(ui()); return { client, rerender: () => view.rerender(ui()) };
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
async function prepareDraft() {
  fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
  const order = await screen.findByRole("dialog", { name: "Novo pedido" });
  change("Descrição do item 1", "Peça personalizada"); change("Quantidade do item 1", "2"); change("Preço unitário do item 1", "17.5");
  change("Data de Entrega", "2026-12-05"); change("Receber em · necessário para confirmar", "2026-12-06");
  fireEvent.change(within(order).getByPlaceholderText("Rua, número, bairro, cidade - UF, CEP"), { target: { value: "Endereço combinado no pedido" } });
  fireEvent.change(within(order).getByPlaceholderText("Condições de pagamento, prazo, etc."), { target: { value: "Embalagem combinada" } });
  fireEvent.change(within(within(order).getByText("Frete (R$)", { selector: "label" }).parentElement!).getByRole("spinbutton"), { target: { value: "7" } });
  fireEvent.change(within(within(order).getByText("Desconto (R$)", { selector: "label" }).parentElement!).getByRole("spinbutton"), { target: { value: "2" } });
  return order;
}
beforeEach(() => {
  mock.tenant = "tenant-a"; mock.user = "user-a"; mock.customers = []; mock.filters = []; mock.toast.mockReset();
  mock.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "save_partner") { mock.customers.push({ id: "new-customer", tenant_id: mock.tenant, name: (args.p_data as Record<string, unknown>).name, address: null, email: null, phone: null }); return { data: "new-customer", error: null }; }
    if (name === "save_sales_order") return { data: "saved-order", error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
});
afterEach(cleanup);
describe("customer registration inside an order", () => {
  it("creates and selects the customer in place while retaining the complete unsaved order", async () => {
    mount(); const order = await prepareDraft();
    fireEvent.click(within(order).getByRole("button", { name: "Cadastrar cliente" }));
    const partner = await screen.findByRole("dialog", { name: "Adicionar cliente" });
    fireEvent.change(within(partner).getByLabelText("Nome *"), { target: { value: "Cliente criado no pedido" } });
    expect(within(order).getByRole("button", { name: "Criar pedido", hidden: true })).toBeDisabled();
    fireEvent.click(within(partner).getByRole("button", { name: "Salvar cliente" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Adicionar cliente" })).not.toBeInTheDocument());
    await waitFor(() => expect(within(order).getByLabelText("Cliente do pedido")).toHaveValue("new-customer"));
    expect(within(order).getByLabelText("Descrição do item 1")).toHaveValue("Peça personalizada");
    expect(within(order).getByLabelText("Quantidade do item 1")).toHaveValue(2);
    expect(within(order).getByPlaceholderText("Rua, número, bairro, cidade - UF, CEP")).toHaveValue("Endereço combinado no pedido");
    fireEvent.click(within(order).getByRole("button", { name: "Criar pedido" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_sales_order", expect.objectContaining({ p_order: expect.objectContaining({ customer_id: "new-customer", due_date: "2026-12-05", payment_due_date: "2026-12-06", shipping: 7, discount: 2, total: 40,
      notes: "📍 Entrega: Endereço combinado no pedido\nEmbalagem combinada" }), p_items: [expect.objectContaining({ description: "Peça personalizada", quantity: 2, unit_price: 17.5, total: 35 })] })));
    expect(mock.filters).toContainEqual(["customers", "tenant_id", "tenant-a"]);
  });
  it("cancels customer registration without changing the order draft", async () => {
    mount(); const order = await prepareDraft(); fireEvent.click(within(order).getByRole("button", { name: "Cadastrar cliente" }));
    const partner = await screen.findByRole("dialog", { name: "Adicionar cliente" });
    fireEvent.change(within(partner).getByLabelText("Nome *"), { target: { value: "Não salvar" } });
    fireEvent.click(within(partner).getByRole("button", { name: "Cancelar" }));
    expect(within(order).getByLabelText("Descrição do item 1")).toHaveValue("Peça personalizada");
    expect(within(order).getByLabelText("Cliente do pedido")).toHaveValue("");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("does not select a late customer response into a different tenant's order draft", async () => {
    let finish!: (value: unknown) => void;
    mock.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(), order = await prepareDraft();
    fireEvent.click(within(order).getByRole("button", { name: "Cadastrar cliente" }));
    const partner = await screen.findByRole("dialog", { name: "Adicionar cliente" });
    fireEvent.change(within(partner).getByLabelText("Nome *"), { target: { value: "Cliente da empresa A" } });
    fireEvent.click(within(partner).getByRole("button", { name: "Salvar cliente" })); await waitFor(() => expect(mock.rpc).toHaveBeenCalledOnce());
    mock.tenant = "tenant-b"; mock.user = "user-b"; view.rerender();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    change("Descrição do item 1", "Rascunho da empresa B");
    await act(async () => { finish({ data: "customer-from-a", error: null }); });
    expect(screen.getByLabelText("Cliente do pedido")).toHaveValue("");
    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Rascunho da empresa B");
    expect(mock.filters).toContainEqual(["customers", "tenant_id", "tenant-b"]);
    expect(mock.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Cliente salvo" }));
  });
});
