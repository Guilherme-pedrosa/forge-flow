import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketplaceBindings } from "@/components/marketplace/MarketplaceBindings";
import Marketplaces from "@/pages/integracoes/Marketplaces";

type Row = { id: string; tenant_id: string; account_id: string; external_item_id: string; external_variant_id: string; external_sku: string; product_id: string; requires_manual_review: boolean };
type Read = { table: string; columns: string; filters: Record<string, unknown>; range: [number, number] | null };
const mock = vi.hoisted(() => ({
  rpc: vi.fn(), toast: vi.fn(), rows: [] as Row[], reads: [] as Read[],
  readError: null as { code?: string; message: string } | null, reviewAvailable: true,
  delayReview: null as Promise<void> | null,
  orders: [] as Record<string, unknown>[],
}));
function query(table: string) {
  const filters: Record<string, unknown> = {}; let columns = "", bounds: [number, number] | null = null, max: number | null = null;
  const response = () => {
    mock.reads.push({ table, columns, filters: { ...filters }, range: bounds });
    if (table === "marketplace_sku_bindings" && mock.readError) return { data: null, count: null, error: mock.readError };
    if (table === "marketplace_sku_bindings" && !mock.reviewAvailable && columns.includes("requires_manual_review")) return { data: null, count: null, error: { code: "42703", message: "column requires_manual_review does not exist" } };
    const source: Record<string, unknown>[] = table === "marketplace_sku_bindings" ? mock.rows
      : table === "marketplace_accounts" ? [{ id: "account-a", tenant_id: "tenant-a", channel: "mercado_livre", name: "Loja A", connection_state: "connected" }]
      : table === "marketplace_orders" ? mock.orders : table === "products" ? [{ id: "product-a", name: "Produto A", sku: "PA", is_active: true, tenant_id: "tenant-a" }]
      : table === "customers" ? [] : [];
    let data = source.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    const count = data.length;
    if (bounds) data = data.slice(bounds[0], bounds[1] + 1);
    if (max !== null) data = data.slice(0, max);
    return { data, count, error: null };
  };
  const builder = {
    select: (value: string) => { columns = value; return builder; },
    eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
    in: () => builder, is: () => builder, order: () => builder,
    range: (from: number, to: number) => { bounds = [from, to]; return builder; },
    limit: (value: number) => { max = value; return builder; },
    maybeSingle: () => { const result = response(); return Promise.resolve({ ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data }); },
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (table === "marketplace_sku_bindings" && filters.requires_manual_review === true && mock.delayReview ? mock.delayReview : Promise.resolve()).then(response).then(resolve, reject),
  };
  return builder;
}
vi.mock("@/lib/marketplace-orders", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/marketplace-orders")>();
  return { ...actual, marketplaceRpc: mock.rpc, marketplaceDb: { from: (table: string) => query(table) } };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => query(table) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-a" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
const products = [{ id: "product-a", name: "Produto A", sku: "PA" }, { id: "product-b", name: "Produto B", sku: "PB" }];
const row = (changes: Partial<Row> = {}): Row => ({ id: "binding-1", tenant_id: "tenant-a", account_id: "account-a", external_item_id: "MLB123", external_variant_id: "BLUE", external_sku: "SKU-A", product_id: "product-a", requires_manual_review: false, ...changes });
function mount(accountId = "account-a", productOptions = products) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (account: string) => <QueryClientProvider client={client}><MarketplaceBindings accountId={account} tenantId="tenant-a" productOptions={productOptions} /></QueryClientProvider>;
  const result = render(view(accountId));
  return { ...result, client, changeAccount: (account: string) => result.rerender(view(account)) };
}
const createButton = () => screen.getByRole("button", { name: "Cadastrar vínculo" });
async function ready() { await waitFor(() => expect(createButton()).toBeEnabled()); }
function fill(values: { item?: string; variant?: string; sku?: string; product?: string } = {}) {
  fireEvent.change(screen.getByLabelText("Anúncio"), { target: { value: values.item ?? "MLB-BEFORE-SALE" } });
  fireEvent.change(screen.getByLabelText("Variação"), { target: { value: values.variant ?? "BLUE" } });
  fireEvent.change(screen.getByLabelText("SKU externo"), { target: { value: values.sku ?? "SELLER-SKU" } });
  fireEvent.change(screen.getByLabelText("Produto no ERP"), { target: { value: values.product ?? "product-a" } });
}
beforeEach(() => {
  mock.rows = []; mock.reads = []; mock.readError = null; mock.reviewAvailable = true; mock.orders = []; mock.delayReview = null;
  mock.rpc.mockReset(); mock.toast.mockReset();
  mock.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
    const existing = mock.rows.find(item => item.account_id === args.p_account_id && item.external_item_id === args.p_external_item_id && item.external_variant_id === args.p_external_variant_id && item.external_sku === args.p_external_sku);
    if (existing) { existing.product_id = String(args.p_product_id); if (args.p_requires_manual_review != null) existing.requires_manual_review = !!args.p_requires_manual_review; }
    else mock.rows.push(row({ id: `binding-${mock.rows.length + 1}`, account_id: String(args.p_account_id), external_item_id: String(args.p_external_item_id), external_variant_id: String(args.p_external_variant_id), external_sku: String(args.p_external_sku), product_id: String(args.p_product_id), requires_manual_review: !!args.p_requires_manual_review }));
    return "binding-id";
  });
});
afterEach(cleanup);

describe("marketplace bindings independent of orders", () => {
  it("creates a tenant-scoped binding before any order and sends explicit personalisation review", async () => {
    mount(); await ready();
    expect(screen.getByText("Nenhum vínculo cadastrado nesta conta.")).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
    fill({ item: " MLB-BEFORE-SALE ", sku: " SELLER-SKU " });
    fireEvent.click(screen.getByRole("checkbox", { name: "Exige conferência antes de organizar" }));
    fireEvent.click(createButton());
    await screen.findByText("Vínculo salvo para esta conta.");
    expect(mock.rpc).toHaveBeenCalledWith("save_marketplace_sku_binding", { p_account_id: "account-a", p_external_item_id: "MLB-BEFORE-SALE", p_external_variant_id: "BLUE", p_external_sku: "SELLER-SKU", p_product_id: "product-a", p_requires_manual_review: true });
    expect(await screen.findByText(/Conferência obrigatória antes de organizar/)).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.reads.every(read => read.table === "marketplace_sku_bindings" && read.filters.tenant_id === "tenant-a" && read.filters.account_id === "account-a")).toBe(true);
  });
  it("corrects an active destination while retaining the exact identity and review requirement", async () => {
    mock.rows = [row({ requires_manual_review: true })];
    mount(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir produto" }));
    for (const label of ["Anúncio", "Variação", "SKU externo"]) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeChecked();
    // The RPC also uses the stored identity if a disabled control is tampered with.
    fireEvent.change(screen.getByLabelText("Anúncio"), { target: { value: "TAMPERED" } });
    fireEvent.change(screen.getByLabelText("Produto no ERP"), { target: { value: "product-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar destino" }));
    await screen.findByText("Vínculo salvo para esta conta.");
    expect(mock.rpc).toHaveBeenCalledWith("save_marketplace_sku_binding", { p_account_id: "account-a", p_external_item_id: "MLB123", p_external_variant_id: "BLUE", p_external_sku: "SKU-A", p_product_id: "product-b", p_requires_manual_review: true });
    expect(await screen.findByText("Produto: Produto B")).toBeInTheDocument();
  });
  it("sends explicit false only when review is deliberately cleared while editing", async () => {
    mock.rows = [row({ requires_manual_review: true })];
    mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Corrigir produto" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar destino" }));
    await screen.findByText("Vínculo salvo para esta conta.");
    expect(mock.rpc).toHaveBeenCalledWith("save_marketplace_sku_binding", expect.objectContaining({ p_external_item_id: "MLB123", p_product_id: "product-a", p_requires_manual_review: false }));
    expect(mock.rows[0].requires_manual_review).toBe(false);
  });
  it("preserves a review requirement created after the creation precheck", async () => {
    const apply = mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementationOnce(async (name: string, args: Record<string, unknown>) => {
      mock.rows.push(row({ external_item_id: String(args.p_external_item_id), external_variant_id: String(args.p_external_variant_id), external_sku: String(args.p_external_sku), requires_manual_review: true }));
      return apply(name, args);
    });
    mount(); await ready(); fill();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(createButton()); await screen.findByText("Vínculo salvo para esta conta.");
    expect(mock.rpc).toHaveBeenCalledWith("save_marketplace_sku_binding", expect.objectContaining({ p_requires_manual_review: null }));
    expect(mock.rows).toHaveLength(1);
    expect(mock.rows[0].requires_manual_review).toBe(true);
    expect(await screen.findByText(/Conferência obrigatória antes de organizar/)).toBeInTheDocument();
  });
  it("does not clear an existing personalisation requirement through a duplicate creation on another page", async () => {
    mock.rows = [...Array.from({ length: 20 }, (_, index) => row({ id: `first-${index}`, external_item_id: `OTHER-${index}` })), row({ id: "last-binding", requires_manual_review: true })];
    mount(); await ready();
    fill({ item: "MLB123", variant: "BLUE", sku: "SKU-A", product: "product-b" });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um vínculo com esta identidade");
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.rows.at(-1)).toMatchObject({ product_id: "product-a", requires_manual_review: true });
  });
  it("clears unsaved identity, selected product, review flag and errors when the account changes", async () => {
    mock.rows = [row(), row({ id: "binding-b", account_id: "account-b", external_item_id: "B-ITEM", external_sku: "B-SKU" })];
    const { changeAccount } = mount(); await ready();
    fill(); fireEvent.click(screen.getByRole("checkbox"));
    mock.rpc.mockRejectedValueOnce(new Error("Falha da conta A"));
    fireEvent.click(createButton()); await screen.findByRole("alert");
    changeAccount("account-b"); await ready();
    expect(screen.getByLabelText("Anúncio")).toHaveValue("");
    expect(screen.getByLabelText("Variação")).toHaveValue("");
    expect(screen.getByLabelText("SKU externo")).toHaveValue("");
    expect(screen.getByLabelText("Produto no ERP")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText(/Falha da conta A/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Anúncio: MLB123/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Anúncio: B-ITEM/)).toBeInTheDocument();
    fill({ item: "B-NEW" }); fireEvent.click(createButton());
    await waitFor(() => expect(mock.rpc).toHaveBeenLastCalledWith("save_marketplace_sku_binding", expect.objectContaining({ p_account_id: "account-b", p_external_item_id: "B-NEW", p_requires_manual_review: null })));
  });
  it("keeps a failed save visible and retries the same upsert without losing the draft", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("Tempo esgotado"));
    mount(); await ready(); fill(); fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Tempo esgotado");
    expect(screen.getByLabelText("Anúncio")).toHaveValue("MLB-BEFORE-SALE");
    fireEvent.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
    await screen.findByText("Vínculo salvo para esta conta.");
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    expect(mock.rpc.mock.calls[1]).toEqual(mock.rpc.mock.calls[0]);
    expect(mock.rows).toHaveLength(1);
  });
  it("recovers a timed-out creation whose intended binding was already committed", async () => {
    mock.rpc.mockImplementationOnce(async (_name: string, args: Record<string, unknown>) => {
      mock.rows.push(row({ external_item_id: String(args.p_external_item_id), external_variant_id: String(args.p_external_variant_id), external_sku: String(args.p_external_sku), product_id: String(args.p_product_id), requires_manual_review: !!args.p_requires_manual_review }));
      throw new Error("Timeout após gravação");
    });
    mount(); await ready(); fill(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Timeout após gravação");
    fireEvent.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
    await screen.findByText("Vínculo salvo para esta conta.");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rows).toHaveLength(1);
    expect(mock.rows[0].requires_manual_review).toBe(true);
  });
  it("does not overwrite the new account's draft when a previous save finishes late", async () => {
    let finish: (value: string) => void = () => {};
    mock.rpc.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const { changeAccount } = mount(); await ready(); fill(); fireEvent.click(createButton());
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(1));
    changeAccount("account-b"); await ready(); fill({ item: "B-UNSAVED", product: "product-b" });
    fireEvent.click(screen.getByRole("checkbox"));
    finish("a-saved");
    await waitFor(() => expect(screen.getByLabelText("Anúncio")).toHaveValue("B-UNSAVED"));
    expect(screen.getByLabelText("Produto no ERP")).toHaveValue("product-b");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.queryByText("Vínculo salvo para esta conta.")).not.toBeInTheDocument();
  });
  it("paginates all bindings with account and tenant filters", async () => {
    mock.rows = [...Array.from({ length: 23 }, (_, index) => row({ id: `a-${index}`, external_item_id: `ANNOUNCEMENT-${index}` })), row({ id: "other-account", account_id: "account-b", external_item_id: "OTHER-ACCOUNT" }), row({ id: "other-tenant", tenant_id: "tenant-b", external_item_id: "OTHER-TENANT" })];
    mount(); await ready();
    expect(screen.getAllByRole("article")).toHaveLength(20);
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    await screen.findByText("Página 2 · 23 vínculo(s)");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Próxima página" })).toBeDisabled();
    expect(mock.reads.some(read => read.range?.[0] === 20 && read.range?.[1] === 39 && read.filters.account_id === "account-a" && read.filters.tenant_id === "tenant-a")).toBe(true);
    expect(screen.queryByText(/OTHER-ACCOUNT|OTHER-TENANT/)).not.toBeInTheDocument();
  });
  it("surfaces access failures and recovers reads without treating them as activation", async () => {
    mock.readError = { code: "42501", message: "Acesso negado" };
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Acesso negado");
    expect(createButton()).toBeDisabled();
    expect(screen.queryByText(/precisa ser ativado no banco/)).not.toBeInTheDocument();
    mock.readError = null;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await ready(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("uses the legacy binding contract while review controls await activation", async () => {
    mock.reviewAvailable = false;
    mount(); await ready();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/exigência de conferência dos vínculos ficará disponível/)).toBeInTheDocument();
    fill(); fireEvent.click(createButton()); await screen.findByText("Vínculo salvo para esta conta.");
    expect(mock.rpc.mock.calls[0][1]).not.toHaveProperty("p_requires_manual_review");
  });
  it("requires a usable external identity and an active product before calling the RPC", async () => {
    mount(); await ready(); fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o anúncio ou o SKU externo");
    expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("SKU externo"), { target: { value: "SKU-ONLY" } });
    fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Selecione um produto ativo");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("opens the linked internal sale directly from an imported marketplace order", async () => {
    mock.orders = [{ id: "marketplace-order", account_id: "account-a", tenant_id: "tenant-a", external_order_id: "ML-123", external_status: "paid", normalized_state: "paid", total: 20, reported_total: 20, shipping_deadline_at: "2026-10-12T17:00:00-03:00", internal_order_id: "sale / 123", needs_review: false, items: [{ id: "line", product_id: "product-a", description: "Produto A", quantity: 1, unit_price: 20, external_item_id: "MLB123", external_variant_id: "", external_sku: "PA" }] }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Marketplaces /></MemoryRouter></QueryClientProvider>);
    const inbox = await screen.findByRole("region", { name: "Pedidos recebidos" });
    expect(await within(inbox).findByRole("link", { name: "Abrir pedido" })).toHaveAttribute("href", "/comercial/pedidos?pedido=sale%20%2F%20123");
    expect(screen.getByText("Vínculos de anúncios", { selector: "summary" }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Cadastrar vínculo" })).not.toBeVisible();
  });
  it("requires personalised orders to be checked in the linked sale instead of confirming from the inbox", async () => {
    mock.rows = [row({ requires_manual_review: true })];
    mock.orders = [{ id: "marketplace-order", account_id: "account-a", tenant_id: "tenant-a", external_order_id: "ML-123", external_status: "paid", normalized_state: "paid", total: 20, reported_total: 20, shipping_deadline_at: "2026-10-12T17:00:00-03:00", internal_order_id: "personalized / 1", needs_review: false, items: [{ id: "line", product_id: "product-a", description: "Placa com nome", quantity: 1, unit_price: 20, external_item_id: "MLB123", external_variant_id: "BLUE", external_sku: "SKU-A" }] }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Marketplaces /></MemoryRouter></QueryClientProvider>);
    const inbox = await screen.findByRole("region", { name: "Pedidos recebidos" });
    expect(await within(inbox).findByText(/Este anúncio exige conferência e está fora da organização automática e em lote/)).toBeInTheDocument();
    expect(within(inbox).getByRole("link", { name: "Conferir em Pedidos" })).toHaveAttribute("href", "/comercial/pedidos?pedido=personalized%20%2F%201");
    expect(within(inbox).queryByRole("button", { name: "Organizar pedido" })).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("disables inbox confirmation while an old unflagged binding cache is revalidated", async () => {
    mock.rows = [row()];
    mock.orders = [{ id: "marketplace-order", account_id: "account-a", tenant_id: "tenant-a", external_order_id: "ML-123", external_status: "paid", normalized_state: "paid", total: 20, reported_total: 20, shipping_deadline_at: "2026-10-12T17:00:00-03:00", internal_order_id: "sale-1", needs_review: false, items: [{ id: "line", product_id: "product-a", description: "Placa com nome", quantity: 1, unit_price: 20, external_item_id: "MLB123", external_variant_id: "BLUE", external_sku: "SKU-A" }] }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Marketplaces /></MemoryRouter></QueryClientProvider>);
    const button = await screen.findByRole("button", { name: "Organizar pedido" });
    await waitFor(() => expect(button).toBeEnabled());
    let finish: () => void = () => {};
    mock.delayReview = new Promise<void>(resolve => { finish = resolve; });
    mock.rows[0].requires_manual_review = true;
    const refresh = client.invalidateQueries({ queryKey: ["marketplace_review_bindings"] });
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(mock.rpc).not.toHaveBeenCalled();
    finish(); await refresh;
    expect(await screen.findByRole("link", { name: "Conferir em Pedidos" })).toHaveAttribute("href", "/comercial/pedidos?pedido=sale-1");
    expect(screen.queryByRole("button", { name: "Organizar pedido" })).not.toBeInTheDocument();
  });
});
