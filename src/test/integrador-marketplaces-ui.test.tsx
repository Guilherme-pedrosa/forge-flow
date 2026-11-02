import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Marketplaces from "@/pages/integracoes/Marketplaces";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), orders: vi.fn(), listings: vi.fn(), binding: vi.fn(), ready: vi.fn(), stock: vi.fn(), sync: vi.fn(), finish: vi.fn(), enrollment: false, enrolled: false, linked: false, tenant: "tenant-a", user: "user-a" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const account = { id: "local-source", tenant_id: "tenant-a", channel: "mercado_livre", name: "Elevare pelo Integrador", external_seller_id: "123", connection_state: "connected", last_sync_at: null };
const canonical = { external_order_id: "90071992547409930", external_status: "paid", normalized_state: "paid", external_updated_at: "2026-11-02T10:00:00Z", shipping_deadline_at: "2026-11-03T10:00:00Z", deadline_source: "shipment_sla", items: [{ external_line_id: "line-a", external_item_id: "MLB123", external_variant_id: "RED", external_sku: "SKU-R", description: "Peça", quantity: 1, unit_price: 20 }] };
function query(table: string) {
  const filters: Record<string, unknown> = {};
  const rows = () => (table === "marketplace_accounts" ? mock.enrollment ? [{ ...account, name: "ELEVARE3D", external_seller_id: mock.enrolled ? "789" : null, connection_state: mock.enrolled ? "import_only" : "pending_credentials" }] : [account, { ...account, id: "local-native", name: "Conta com autorização própria", external_seller_id: "456" }] : table === "products" ? [{ id: "product-a", tenant_id: "tenant-a", name: "Produto A", sku: "SKU-A", is_active: true }] : table === "marketplace_sku_bindings" && mock.linked ? [{ id: "binding-a", tenant_id: "tenant-a", account_id: account.id, product_id: "product-a" }] : [])
    .filter(row => Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value));
  const builder = { select: () => builder, eq: (key: string, value: unknown) => { filters[key] = value; return builder; }, in: () => builder, is: () => builder, order: () => builder, range: () => builder, limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }), then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve({ data: rows(), count: rows().length, error: null }).then(resolve, reject) };
  return builder;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke }, from: (table: string) => query(table) } }));
vi.mock("@/lib/marketplace-orders", async original => ({ ...await original<typeof import("@/lib/marketplace-orders")>(), marketplaceRpc: mock.rpc, marketplaceDb: { from: (table: string) => query(table) } }));
vi.mock("@/lib/mercado-livre-integration", async original => ({ ...await original<typeof import("@/lib/mercado-livre-integration")>(), readIntegradorBridgeBinding: mock.binding, readIntegradorReadiness: mock.ready, fetchIntegradorMarketplaceOrders: mock.orders, fetchIntegradorListings: mock.listings, readIntegradorStockPreview: mock.stock, syncIntegradorManual: mock.sync, finishIntegradorEnrollment: mock.finish }));
beforeEach(() => {
  mock.tenant = "tenant-a"; mock.user = "user-a"; mock.linked = false; mock.enrollment = false; mock.enrolled = false; mock.stock.mockReset(); mock.sync.mockReset();
  mock.binding.mockReset().mockImplementation(async () => mock.tenant === "tenant-a" ? { configured: true, enabled: true, bridge_id: "bridge-a", source_url: "https://integradorwedo.lovable.app", revision: mock.enrolled ? "r2" : "r1", allow_enrollment: mock.enrollment, approved_seller_ids: mock.enrollment ? mock.enrolled ? ["789"] : [] : ["123"], account_mappings: mock.enrollment ? mock.enrolled ? [{ account_id: account.id, source_seller_id: "789", bridge_id: "bridge-a" }] : [] : [{ account_id: account.id, source_seller_id: "123", bridge_id: "bridge-a" }] } : { configured: false, enabled: false, approved_seller_ids: [], account_mappings: [] });
  mock.ready.mockReset().mockImplementation(async () => ({ settings: { configured: true, client_id: "1234", client_secret_configured: true, redirect_uri: "https://integradorwedo.lovable.app/retorno", read_only: true }, source_accounts: mock.enrollment ? mock.enrolled ? [{ seller_id: "789", nickname: "ELEVARE3D", credentials_configured: true, expires_at: null }] : [] : [{ seller_id: "123", nickname: "Elevare", credentials_configured: true, expires_at: null }], enrollment: { allowed: mock.enrollment, configured: true, connected_seller_count: mock.enrolled ? 1 : 0 } }));
  mock.finish.mockReset().mockImplementation(async () => { mock.enrolled = true; return { connected: true, account_id: account.id, seller_id: "789", nickname: "ELEVARE3D", replayed: false }; });
  mock.orders.mockReset().mockResolvedValue({ orders: [canonical], fetched: 1, total: 1, truncated: false, next_offset: null });
  mock.listings.mockReset().mockResolvedValue({ items: [{ id: "MLB123", title: "Peça", status: "active", permalink: null, thumbnail: null, price: 20, currency_id: "BRL", available_quantity: 1, sku: null, variations: [{ id: "RED", sku: "SKU-R", attributes: [] }] }], total: 1, offset: 0, limit: 20, next_offset: null });
  mock.invoke.mockReset(); mock.rpc.mockReset().mockImplementation(async name => name === "import_marketplace_orders" ? { imported: 1, unchanged: 0 } : "saved-binding");
});
afterEach(cleanup);
function LocationProbe() { const location = useLocation(); return <span data-testid="current-url">{location.pathname}{location.search}</span>; }
function mount(entry = "/") { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); const ui = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Marketplaces /><LocationProbe /></MemoryRouter></QueryClientProvider>; const view = render(ui()); return { ...view, changeSession: () => view.rerender(ui()) }; }
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "Buscar pedidos recentes" })).toBeEnabled()); }
describe("Source-owned accounts use the actual Integrador flow", () => {
  it("finishes the new Elevare receipt with no old source accounts, clears only the receipt, and selects the verified local account", async () => {
    mock.enrollment = true; mount(`/comercial/marketplaces?integrador_oauth=${"a".repeat(64)}&keep=1`);
    await waitFor(() => expect(mock.finish).toHaveBeenCalledOnce()); await waitFor(() => expect(screen.getByTestId("current-url")).toHaveTextContent("/comercial/marketplaces?keep=1"));
    await waitFor(() => expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue("789")); expect(screen.getByLabelText("Conta")).toHaveValue(account.id); expect(mock.rpc).not.toHaveBeenCalledWith("link_integrador_marketplace_account", expect.anything()); expect(mock.invoke).not.toHaveBeenCalled(); expect(screen.queryByRole("option", { name: /Loja A|Loja B|123|456/ })).not.toBeInTheDocument();
  });
  it("offers only the Source connection for a pending Elevare account and handles an expired callback without reusing native Edge OAuth", async () => {
    mock.enrollment = true; mount("/comercial/marketplaces?integrador_oauth_error=expired_or_used"); await screen.findByRole("button", { name: "Conectar Mercado Livre" });
    expect(screen.getByText(/O retorno da autorização expirou ou já foi usado/)).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Autorizar Mercado Livre" })).not.toBeInTheDocument(); expect(mock.finish).not.toHaveBeenCalled(); expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("imports canonical source orders through the existing Forge RPC without invoking native OAuth or Edge", async () => {
    mount(); await ready(); expect(screen.queryByRole("button", { name: /Autorizar Mercado Livre|Autorizar novamente/ })).not.toBeInTheDocument(); expect(mock.orders).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("IDs de pedidos Mercado Livre"), { target: { value: canonical.external_order_id } }); fireEvent.click(screen.getByRole("button", { name: "Consultar pedidos" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("import_marketplace_orders", { p_account_id: account.id, p_orders: [canonical] }));
    expect(mock.orders).toHaveBeenCalledWith(expect.anything(), "123", { order_ids: [canonical.external_order_id] }, expect.objectContaining({ userId: "user-a" })); expect(mock.invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "local-native" } }); await screen.findByRole("button", { name: "Autorizar novamente" });
  });
  it("loads remote listings and opens the canonical exact-identity product binding without touching channel prices or stock", async () => {
    mount(); await ready(); fireEvent.change(screen.getByLabelText("Vendedor do Integrador"), { target: { value: "123" } }); fireEvent.click(screen.getByRole("button", { name: "Consultar anúncios" }));
    const link = await screen.findByRole("button", { name: "Vincular variação RED a produto" }); await waitFor(() => expect(link).toBeEnabled()); fireEvent.click(link);
    await waitFor(() => expect(screen.getByLabelText("Anúncio")).toHaveValue("MLB123")); expect(screen.getByLabelText("Variação")).toHaveValue("RED"); expect(screen.getByLabelText("SKU externo")).toHaveValue("SKU-R");
    const save = screen.getByRole("button", { name: "Cadastrar vínculo" }); await waitFor(() => expect(save).toBeEnabled()); fireEvent.change(screen.getByLabelText("Produto no ERP"), { target: { value: "product-a" } }); fireEvent.click(save);
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_marketplace_sku_binding", expect.objectContaining({ p_account_id: account.id, p_external_item_id: "MLB123", p_external_variant_id: "RED", p_product_id: "product-a" }))); expect(mock.invoke).not.toHaveBeenCalled(); expect(mock.orders).not.toHaveBeenCalled();
  });
  it("does not import a late source order into a new tenant session", async () => {
    let resolve!: (value: unknown) => void; mock.orders.mockReturnValue(new Promise(done => { resolve = done; })); const view = mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Buscar pedidos recentes" })); await waitFor(() => expect(mock.orders).toHaveBeenCalled()); mock.tenant = "tenant-b"; mock.user = "user-b"; view.changeSession();
    await act(async () => { resolve({ orders: [canonical], fetched: 1, total: 1, next_offset: null, truncated: false }); }); expect(mock.rpc).not.toHaveBeenCalledWith("import_marketplace_orders", expect.anything()); expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("opens real manual operations only for a source mapped account and locks other operations while the explicit preview is pending", async () => {
    let resolve!: (value: unknown) => void; mock.stock.mockReturnValue(new Promise(done => { resolve = done; })); mock.linked = true;
    mock.ready.mockResolvedValue({ settings: { configured: true }, source_accounts: [{ seller_id: "123", credentials_configured: true }], manual_operations: { available: true, automatic_writes: false, ownership_confirmation_required: true, accepted_forge_channel_price_required: true } });
    mount(); await ready(); const read = await screen.findByRole("button", { name: "Conferir prévia de estoque e preço" }); await waitFor(() => expect(read).toBeEnabled()); expect(mock.stock).not.toHaveBeenCalled(); expect(mock.sync).not.toHaveBeenCalled(); fireEvent.click(read);
    await waitFor(() => expect(mock.stock).toHaveBeenCalledWith(expect.anything(), { account_id: account.id, source_seller_id: "123", product_ids: ["product-a"] }, expect.objectContaining({ tenantId: "tenant-a", userId: "user-a" })));
    expect(screen.getByLabelText("Conta")).toBeDisabled(); expect(screen.getByRole("button", { name: "Buscar pedidos recentes" })).toBeDisabled(); expect(mock.invoke).not.toHaveBeenCalled();
    await act(async () => { resolve({ revision: "a".repeat(64), claimed: false, stock_owner: "integrador", complete: false, issues: ["legacy_order_queue_requires_review"], targets: [], prices: [], preview: { complete: false, products: [], buckets: [], issues: [] } }); });
    await waitFor(() => expect(screen.getByLabelText("Conta")).toBeEnabled()); fireEvent.change(screen.getByLabelText("Conta"), { target: { value: "local-native" } }); await screen.findByRole("button", { name: "Autorizar novamente" }); expect(screen.queryByRole("region", { name: "Operações manuais de estoque e preço" })).not.toBeInTheDocument(); expect(mock.sync).not.toHaveBeenCalled();
  });
});
