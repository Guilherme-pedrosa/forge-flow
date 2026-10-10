import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pedidos from "@/pages/comercial/Pedidos";
import { operatingDateInput } from "@/lib/sales-workflow";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), orders: [] as Record<string, unknown>[], schemaError: null as { code: string; message: string } | null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/components/comercial/ProductMaterialChoice", () => ({ ProductMaterialChoice: () => null }));
vi.mock("@/components/comercial/CommercialPdfButton", () => ({ CommercialPdfButton: () => null }));
vi.mock("@/components/shared/DeleteRecordDialog", () => ({ DeleteRecordDialog: () => null }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ value, onChange, label, options, emptyLabel, disabled }: { value: string; onChange: (value: string) => void; label: string; options: { id: string; label: string }[]; emptyLabel: string; disabled?: boolean }) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">{emptyLabel}</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query, limit: () => Promise.resolve({ data: [], error: mock.schemaError }),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: table === "orders" ? mock.orders : table === "customers" ? [{ id: "customer-1", name: "Gleyce" }] : table === "products" ? [{ id: "product-1", name: "Maçã", sku: "APPLE", sale_price: 20 }] : table === "order_items" ? [{ id: "item-1", product_id: "product-1", description: "Maçã", quantity: 1, unit_price: 20, total: 20, material_overrides: [] }] : [], error: null }).then(resolve, reject) };
  return query;
} } }));
const order = (id: string, status: string, issues: string[] = []) => ({ id, code: `PED-${id}`, status, customer_id: "customer-1", customers: { name: "Gleyce" }, total: 20, discount: 0, shipping: 0, due_date: "2026-11-10", payment_due_date: "2026-11-10", notes: null, source_quote_id: null, workflow_issues: issues });
const mount = (url = "/") => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Pedidos /></MemoryRouter></QueryClientProvider>);
beforeEach(() => { mock.orders = []; mock.schemaError = null; mock.rpc.mockReset(); mock.toast.mockReset(); });
afterEach(cleanup);

describe("confirm and organize sales", () => {
  it("submits one transaction with the shipping instant and buffer and reuses its identity after a timeout", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "Timeout" } }).mockResolvedValueOnce({ data: { order_id: "new-order", outcome: "production_queued", production_order_id: "op-1", issues: [] }, error: null });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    await screen.findByRole("option", { name: "Maçã" });
    fireEvent.change(screen.getByLabelText("Produto do item 1"), { target: { value: "product-1" } });
    fireEvent.change(screen.getByLabelText("Cliente do pedido"), { target: { value: "customer-1" } });
    fireEvent.change(screen.getByLabelText(/Receber em/), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("Postar até"), { target: { value: "2026-11-10T14:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e organizar" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Não foi possível confirmar" })));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e organizar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["confirm_sales_workflow", "confirm_sales_workflow"]);
    const first = mock.rpc.mock.calls[0][1], retry = mock.rpc.mock.calls[1][1];
    expect(retry.p_request_id).toBe(first.p_request_id);
    expect(first.p_items[0]).toMatchObject({ product_id: "product-1", quantity: 1, unit_price: 20 });
    expect(new Date(first.p_order.ship_by_at).getTime() - new Date(first.p_order.internal_due_at).getTime()).toBe(24 * 3_600_000);
    expect(first.p_order.due_date).toBeNull();
  });
  it("status deep links filter the visible orders", async () => {
    mock.orders = [order("draft-1", "draft"), order("ready-1", "ready")]; mount("/?status=ready");
    expect(await screen.findByText("PED-ready-1")).toBeInTheDocument();
    expect(screen.queryByText("PED-draft-1")).not.toBeInTheDocument();
    expect(screen.getByText("Embalar e postar")).toBeInTheDocument();
  });
  it("an existing imported draft is confirmed without resubmitting its commercial data and displays preparation issues", async () => {
    mock.orders = [order("pending", "draft", ["Maçã: falta tempo da placa"])] ;
    mock.rpc.mockResolvedValue({ data: { order_id: "pending", outcome: "needs_preparation", production_order_id: null, issues: ["Maçã: falta tempo da placa"] }, error: null });
    mount("/?pedido=pending");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Maçã: falta tempo da placa")).toBeInTheDocument();
    expect(await within(dialog).findByRole("link", { name: "Preparar Maçã" })).toHaveAttribute("href", "/comercial/produtos?produto=product-1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar e organizar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][1]).toMatchObject({ p_order_id: "pending", p_order: null, p_items: null });
  });
  it("keeps legacy draft saving usable without silently dropping operational dates when the schema is not activated", async () => {
    mock.schemaError = { code: "42703", message: "column orders.ship_by_at does not exist" };
    mock.rpc.mockResolvedValue({ data: "legacy-draft", error: null });
    mount();
    expect(await screen.findByText(/Organização automática de pedidos ainda não disponível/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    await screen.findByRole("option", { name: "Maçã" });
    expect(screen.queryByLabelText("Postar até")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar e organizar" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Produto do item 1"), { target: { value: "product-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar pedido" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][0]).toBe("save_sales_order");
    expect(mock.rpc.mock.calls[0][1].p_order).not.toHaveProperty("ship_by_at");
    expect(mock.rpc.mock.calls[0][1].p_order).not.toHaveProperty("internal_due_at");
  });
  it("shows authorization errors as errors and never detects capability through a mutation", async () => {
    mock.schemaError = { code: "42501", message: "permission denied" };
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(screen.queryByText(/Organização automática de pedidos ainda não disponível/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    expect(screen.queryByRole("button", { name: "Confirmar e organizar" })).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("revises deadlines of organized sales without resubmitting items or commercial conditions", async () => {
    mock.orders = [{ ...order("active", "in_production"), ship_by_at: "2026-11-10T17:00:00Z", internal_due_at: "2026-11-09T17:00:00Z" }];
    mock.rpc.mockResolvedValue({ data: "active", error: null });
    mount("/?pedido=active");
    fireEvent.click(await screen.findByRole("button", { name: "Revisar prazos" }));
    fireEvent.change(screen.getByLabelText("Postar até"), { target: { value: "2026-11-10T16:00" } });
    fireEvent.change(screen.getByLabelText("Meta interna (opcional)"), { target: { value: "2026-11-09T16:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][0]).toBe("update_sales_order_deadlines");
    expect(mock.rpc.mock.calls[0][1]).toMatchObject({ p_order_id: "active", p_dates: { ship_by_at: expect.any(String), internal_due_at: expect.any(String) } });
    expect(mock.rpc.mock.calls[0][1]).not.toHaveProperty("p_order");
    expect(mock.rpc.mock.calls[0][1]).not.toHaveProperty("p_items");
  });
  it("previews one preparation day before a direct delivery without submitting a fabricated shipping hour", async () => {
    mock.rpc.mockResolvedValue({ data: { order_id: "direct", outcome: "production_queued", production_order_id: "op-1", issues: [] }, error: null });
    mount(); fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    await screen.findByRole("option", { name: "Maçã" });
    fireEvent.change(screen.getByLabelText("Produto do item 1"), { target: { value: "product-1" } });
    fireEvent.change(screen.getByLabelText("Cliente do pedido"), { target: { value: "customer-1" } });
    fireEvent.change(screen.getByLabelText(/Receber em/), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("Data de Entrega"), { target: { value: "2026-11-10" } });
    expect(screen.getByText("Meta de produção: 09/11/2026 (1 dia antes da entrega; horário não combinado)")).toBeInTheDocument();
    expect(screen.getByLabelText("Postar até")).toHaveValue("");
    expect(screen.queryByLabelText("Folga antes da postagem (horas)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e organizar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][1].p_order).toMatchObject({ due_date: "2026-11-10", ship_by_at: null, internal_due_at: null });
  });
  it("shows the direct preparation day in the order list and detail while keeping the agreed delivery", async () => {
    mock.orders = [{ ...order("direct", "in_production"), marketplace_order_id: null }];
    mount();
    expect(await screen.findByText("Meta de produção: 09/11/2026 (1 dia antes da entrega; horário não combinado)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("PED-direct"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Meta de produção: 09/11/2026 (1 dia antes da entrega; horário não combinado)")).toBeInTheDocument();
    expect(within(dialog).getByText("Data de Entrega").parentElement).toHaveTextContent("10/11/2026");
  });
  it("keeps official seconds and fractions when only the internal target is revised", async () => {
    const official = "2026-10-13T23:59:59.123456-03:00";
    mock.orders = [{ ...order("marketplace", "in_production"), marketplace_order_id: "source-1", ship_by_at: official, internal_due_at: "2026-10-12T23:59:59.123456-03:00" }];
    mock.rpc.mockResolvedValue({ data: "marketplace", error: null });
    mount("/?pedido=marketplace");
    fireEvent.click(await screen.findByRole("button", { name: "Revisar prazos" }));
    const edited = operatingDateInput("2026-10-13T12:00:00-03:00");
    fireEvent.change(screen.getByLabelText("Meta interna (opcional)"), { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar prazos" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][1].p_dates).toEqual({ ship_by_at: official, internal_due_at: new Date(edited).toISOString() });
  });
});
