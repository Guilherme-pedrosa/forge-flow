import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MercadoLivreSettings } from "./MercadoLivreSettings";
const mock = vi.hoisted(() => ({ binding: vi.fn(), readiness: vi.fn(), verify: vi.fn(), listings: vi.fn(), link: vi.fn(), begin: vi.fn(), open: vi.fn(), saveApp: vi.fn(), tenant: "tenant-a", user: "operator-a" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("./MercadoLivreListingEditor", () => ({ MercadoLivreListingEditor: ({ itemId, onClose }: { itemId: string; onClose: () => void }) => <section role="dialog" aria-label={`Editar anúncio ${itemId}`}><button onClick={onClose}>Fechar editor</button></section> }));
vi.mock("@/lib/mercado-livre-integration", async original => ({ ...await original<typeof import("@/lib/mercado-livre-integration")>(), readIntegradorBridgeBinding: mock.binding, readIntegradorReadiness: mock.readiness, revalidateIntegradorAccount: mock.verify, fetchIntegradorListings: mock.listings, linkIntegradorMarketplaceAccount: mock.link, beginIntegradorEnrollment: mock.begin, openIntegradorAuthorization: mock.open, saveIntegradorEnrollmentApp: mock.saveApp }));
const source = { seller_id: "seller-a", nickname: "Loja A", credentials_configured: true, expires_at: "2026-11-03T10:00:00Z" };
const local = { id: "local-a", channel: "mercado_livre" as const, name: "Cadastro Elevare", external_seller_id: "seller-a", connection_state: "import_only", last_sync_at: null };
const missingApp = { client_id: null, client_secret_configured: false, configured: false, redirect_uri: "https://integradorwedo.lovable.app/api/public/hooks/ml-oauth", revision: "app-none", can_manage: true };
const ownReady = { settings: { client_id: "999999", client_secret_configured: true, configured: true, read_only: true }, source_accounts: [], enrollment: { allowed: true, configured: true, connected_seller_count: 0 }, enrollment_app: { ...missingApp, client_id: "654321", client_secret_configured: true, configured: true, revision: "app-r1" } };
const providerUrl = "https://auth.mercadolivre.com.br/authorization?client_id=654321";
const page = { items: [{ id: "MLB123", title: "Presépio", status: "active", permalink: "https://produto.mercadolivre.com.br/MLB123", thumbnail: null, currency_id: "BRL", price: 39.9, available_quantity: 5, sku: null, variations: [{ id: "VAR-RED", sku: "RED", price: 39.9, available_quantity: 2, attributes: [{ name: "Cor", value_name: "Vermelho" }] }] }], offset: 0, limit: 20, total: 21, next_offset: 20 };
beforeEach(() => {
  mock.tenant = "tenant-a"; mock.user = "operator-a";
  mock.binding.mockReset().mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", approved_seller_ids: ["seller-a", "seller-b"], account_mappings: [{ account_id: "local-a", source_seller_id: "seller-a", bridge_id: "public-id" }] });
  mock.readiness.mockReset().mockResolvedValue({ settings: { client_id: "1234", client_secret_configured: true, redirect_uri: "https://integradorwedo.lovable.app/retorno", configured: true }, source_accounts: [source, { ...source, seller_id: "seller-b", nickname: "Loja B", credentials_configured: false }] });
  mock.verify.mockReset().mockResolvedValue(source); mock.listings.mockReset().mockResolvedValue(page); mock.link.mockReset().mockResolvedValue("local-a"); mock.begin.mockReset().mockResolvedValue({ authorization_url: providerUrl }); mock.open.mockReset();
  mock.saveApp.mockReset().mockResolvedValue(ownReady);
});
afterEach(cleanup);
function mount(activeAccount = local) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const linked = vi.fn(), select = vi.fn(), busy = vi.fn();
  const ui = () => <QueryClientProvider client={client}><MercadoLivreSettings accounts={[local, { ...local, id: "pending", external_seller_id: null }]} activeAccount={activeAccount} onAccountLinked={linked} onSelectListing={select} onBusyChange={busy} /></QueryClientProvider>;
  const view = render(ui()); return { ...view, client, linked, select, busy, changeScope: () => view.rerender(ui()) };
}
async function choose(id = "seller-a") { await screen.findByRole("option", { name: /Loja A/ }); fireEvent.change(screen.getByLabelText("Vendedor do Integrador"), { target: { value: id } }); }
describe("concrete Integrador operations in Forge", () => {
  it("restores a connected summary from the mapped account and stored authorization after remount, regardless of the native pending flag", async () => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: ["seller-a"], account_mappings: [{ account_id: "local-a", source_seller_id: "seller-a", bridge_id: "public-id" }] });
    mock.readiness.mockResolvedValue({ ...ownReady, source_accounts: [source] }); mount({ ...local, connection_state: "pending_credentials" });
    await screen.findByText(/Conta conectada: Loja A · vendedor seller-a/); expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue("seller-a"); expect(screen.queryByLabelText("Cadastro no Forge para esta conexão")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Conectar Mercado Livre" })).not.toBeInTheDocument(); expect(screen.queryByText("Associar vendedor a uma conta do Forge")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Consultar anúncios" })).toBeEnabled(); expect(mock.begin).not.toHaveBeenCalled(); expect(mock.link).not.toHaveBeenCalled(); expect(mock.verify).not.toHaveBeenCalled(); expect(mock.listings).not.toHaveBeenCalled();
  });
  it.each(["missing_credentials", "wrong_bridge"])("does not call a mapped seller connected without full ownership and credential evidence: %s", async reason => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: ["seller-a"], account_mappings: [{ account_id: "local-a", source_seller_id: "seller-a", bridge_id: reason === "wrong_bridge" ? "another-bridge" : "public-id" }] });
    mock.readiness.mockResolvedValue({ ...ownReady, source_accounts: [{ ...source, credentials_configured: reason !== "missing_credentials" }] }); mount(); await screen.findByLabelText("Vendedor do Integrador"); expect(screen.queryByText(/Conta conectada:/)).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeInTheDocument(); expect(mock.link).not.toHaveBeenCalled();
  });
  it("selects the sole approved source seller without auto-associating or remotely querying the account", async () => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: ["seller-a"], account_mappings: [] }); mock.readiness.mockResolvedValue({ ...ownReady, source_accounts: [source] }); mount({ ...local, external_seller_id: null });
    await waitFor(() => expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue("seller-a")); expect(screen.getByText("Associar vendedor a uma conta do Forge")).toBeInTheDocument(); expect(screen.queryByText(/Conta conectada:/)).not.toBeInTheDocument(); expect(mock.link).not.toHaveBeenCalled(); expect(mock.verify).not.toHaveBeenCalled(); expect(mock.listings).not.toHaveBeenCalled();
  });
  it("preserves a manually chosen or cleared seller through readiness refreshes", async () => {
    const view = mount(); await waitFor(() => expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue("seller-a")); await choose("seller-b"); await act(async () => { await view.client.invalidateQueries({ queryKey: ["integrador_readiness", "tenant-a", "operator-a"] }); }); expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue("seller-b");
    fireEvent.change(screen.getByLabelText("Vendedor do Integrador"), { target: { value: "" } }); await act(async () => { await view.client.invalidateQueries({ queryKey: ["integrador_readiness", "tenant-a", "operator-a"] }); }); expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue(""); expect(mock.link).not.toHaveBeenCalled();
  });
  it("keeps the own API form visible after a failed query and prevents login before its app is confirmed", async () => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: [], account_mappings: [] });
    mock.readiness.mockRejectedValue(new Error("A consulta não foi confirmada. Confira o acesso e tente novamente.")); mount();
    await screen.findByText("A consulta não foi confirmada. Confira o acesso e tente novamente."); expect(screen.getByRole("form", { name: "Configurar minha API Mercado Livre" })).toBeInTheDocument(); expect(screen.getByLabelText("Client ID da sua API")).toHaveValue(""); expect(screen.getByLabelText("Client Secret da sua API")).toBeEnabled(); expect(screen.getByRole("region", { name: "Conectar minha conta Mercado Livre" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeDisabled(); expect(mock.begin).not.toHaveBeenCalled(); expect(mock.open).not.toHaveBeenCalled();
  });
  it("preserves the selected pending account while retrying readiness and keeps an explicit denial blocked", async () => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: [], account_mappings: [] });
    mock.readiness.mockRejectedValueOnce(new Error("Falha temporária")).mockResolvedValue({ settings: { configured: true }, source_accounts: [], enrollment: { allowed: false, configured: true, connected_seller_count: 0 } }); mount();
    await screen.findByText("Falha temporária"); fireEvent.change(screen.getByLabelText("Cadastro no Forge para esta conexão"), { target: { value: "pending" } }); fireEvent.click(screen.getByRole("button", { name: "Tentar consultar o Integrador novamente" }));
    await screen.findByText(/A conexão de novas contas precisa ser habilitada/); expect(screen.getByLabelText("Cadastro no Forge para esta conexão")).toHaveValue("pending"); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeDisabled(); expect(mock.begin).not.toHaveBeenCalled();
  });
  it("shows separate own-API fields instead of inheriting the legacy global app in an empty seller scope", async () => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: [], account_mappings: [] });
    mock.readiness.mockResolvedValue({ settings: { client_id: "1234", client_secret_configured: true, configured: true, read_only: true, full_scope: false }, source_accounts: [], enrollment: { allowed: true, configured: false, connected_seller_count: 0 }, enrollment_app: missingApp }); mount();
    await screen.findByRole("button", { name: "Conectar Mercado Livre" }); expect(screen.queryByLabelText("Vendedor do Integrador")).not.toBeInTheDocument(); expect(screen.queryByText(/Loja A|Loja B/)).not.toBeInTheDocument(); expect(screen.getByRole("option", { name: /Cadastro Elevare · cadastro pendente/ })).toBeInTheDocument(); expect(mock.link).not.toHaveBeenCalled(); expect(mock.verify).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Client ID da sua API")).toHaveValue(""); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue(""); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeDisabled(); expect(screen.queryByText(/Configuração do aplicativo/)).not.toBeInTheDocument();
  });
  it("enables account login only after the own API save confirms its private configuration", async () => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: [], account_mappings: [] });
    mock.readiness.mockResolvedValue({ ...ownReady, enrollment: { allowed: true, configured: false, connected_seller_count: 0 }, enrollment_app: missingApp }); const view = mount(); await screen.findByLabelText("Client ID da sua API"); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Client ID da sua API"), { target: { value: "654321" } }); fireEvent.change(screen.getByLabelText("Client Secret da sua API"), { target: { value: "private-client-secret" } }); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" }));
    await screen.findByText(/Sua API foi salva/); await waitFor(() => expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeEnabled()); expect(mock.begin).not.toHaveBeenCalled(); expect(JSON.stringify(view.client.getQueryCache().getAll().map(query => query.state.data))).not.toContain("private-client-secret");
    fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await waitFor(() => expect(mock.open).toHaveBeenCalledWith(providerUrl)); expect(mock.begin).toHaveBeenCalledWith(expect.anything(), "pending", window.location.origin, expect.any(String), expect.objectContaining({ userId: "operator-a" }));
  });
  it("refuses an official login URL that uses the legacy app instead of the own saved Client ID", async () => {
    mock.binding.mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: [], account_mappings: [] }); mock.readiness.mockResolvedValue(ownReady); mock.begin.mockResolvedValue({ authorization_url: "https://auth.mercadolivre.com.br/authorization?client_id=999999" }); mount();
    const connect = await screen.findByRole("button", { name: "Conectar Mercado Livre" }); await waitFor(() => expect(connect).toBeEnabled()); fireEvent.click(connect); await screen.findByText(/A autorização retornou outro aplicativo/); expect(mock.open).not.toHaveBeenCalled();
  });
  it("reads safe app/account status, selects the mapped seller, and still requires explicit remote verification", async () => {
    mount(); await screen.findByRole("option", { name: /Loja A/ });
    expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue("seller-a"); expect(mock.verify).not.toHaveBeenCalled(); expect(mock.listings).not.toHaveBeenCalled(); expect(mock.link).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Configuração do aplicativo/)); expect(screen.getByText("Configurado no servidor")).toBeInTheDocument(); expect(screen.queryByLabelText(/secret|segredo/i)).not.toBeInTheDocument();
    await choose(); expect(screen.getByText(/acesso remoto ainda não conferido/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conferir acesso desta conta" }));
    expect(await screen.findByText("Acesso conferido no Mercado Livre nesta sessão")).toBeInTheDocument(); expect(mock.verify).toHaveBeenCalledWith(expect.anything(), "seller-a", expect.objectContaining({ userId: "operator-a" }));
    await choose("seller-b"); expect(screen.getByText("Cadastro no Integrador · autorização pendente")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Conferir acesso desta conta" })).toBeDisabled();
  });
  it("queries real listing pages on demand and hands the exact variation/SKU to the canonical binding editor", async () => {
    const view = mount(); await choose(); fireEvent.click(screen.getByRole("button", { name: "Consultar anúncios" }));
    expect(await screen.findByRole("row", { name: "Anúncio MLB123" })).toHaveTextContent("R$ 39,90"); fireEvent.click(screen.getByText("Vincular variações (1)"));
    fireEvent.click(screen.getByRole("button", { name: "Vincular variação VAR-RED a produto" })); expect(view.select).toHaveBeenCalledWith({ external_item_id: "MLB123", external_variant_id: "VAR-RED", external_sku: "RED" }, "seller-a");
    fireEvent.click(screen.getByRole("button", { name: "Próxima página de anúncios" })); await waitFor(() => expect(mock.listings).toHaveBeenLastCalledWith(expect.anything(), "seller-a", 20, expect.anything(), {})); expect(mock.link).not.toHaveBeenCalled();
  });
  it("uses the global search/status filters for pagination and opens the editor for the selected real listing", async () => {
    mount(); await choose(); fireEvent.change(screen.getByLabelText("Pesquisar anúncios"), { target: { value: "Presépio" } }); fireEvent.change(screen.getByLabelText("Situação do anúncio"), { target: { value: "active" } }); fireEvent.click(screen.getByRole("button", { name: "Buscar anúncios" })); await screen.findByRole("row", { name: "Anúncio MLB123" }); expect(mock.listings).toHaveBeenLastCalledWith(expect.anything(), "seller-a", 0, expect.anything(), { q: "Presépio", status: "active" }); fireEvent.click(screen.getByRole("button", { name: "Próxima página de anúncios" })); await waitFor(() => expect(mock.listings).toHaveBeenLastCalledWith(expect.anything(), "seller-a", 20, expect.anything(), { q: "Presépio", status: "active" })); fireEvent.click(screen.getByRole("button", { name: "Editar anúncio MLB123" })); expect(screen.getByRole("dialog", { name: "Editar anúncio MLB123" })).toBeInTheDocument(); expect(mock.link).not.toHaveBeenCalled();
  });
  it("blocks listing bindings when the selected Forge account belongs to another seller", async () => {
    const view = mount({ ...local, external_seller_id: "wrong-seller" }); await choose(); fireEvent.click(screen.getByRole("button", { name: "Consultar anúncios" }));
    await screen.findByRole("row", { name: "Anúncio MLB123" }); fireEvent.click(screen.getByText("Vincular variações (1)")); expect(screen.getByRole("button", { name: "Vincular variação VAR-RED a produto" })).toBeDisabled(); expect(view.select).not.toHaveBeenCalled();
  });
  it("associates only the explicitly chosen local account and retries a lost response with the same request ID and draft", async () => {
    mock.link.mockRejectedValueOnce(new Error("Resposta perdida")); const view = mount({ ...local, id: "pending", external_seller_id: null }); await choose();
    const button = screen.getByRole("button", { name: "Salvar associação do vendedor" }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Conta de destino no Forge"), { target: { value: "pending" } }); fireEvent.change(screen.getByLabelText("Nome da conta no Forge"), { target: { value: "Elevare confirmada" } }); fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida"); const first = mock.link.mock.calls[0];
    expect(first).toEqual(["seller-a", "Elevare confirmada", "pending", expect.any(String)]); expect(screen.getByLabelText("Nome da conta no Forge")).toHaveValue("Elevare confirmada"); fireEvent.click(button);
    await waitFor(() => expect(view.linked).toHaveBeenCalledWith("local-a")); expect(mock.link.mock.calls[1]).toEqual(first);
  });
  it("ignores a late result after seller or tenant switch and releases the parent busy guard", async () => {
    let resolve!: (value: unknown) => void; mock.listings.mockReturnValue(new Promise(done => { resolve = done; })); const view = mount(); await choose(); fireEvent.click(screen.getByRole("button", { name: "Consultar anúncios" }));
    await waitFor(() => expect(view.busy).toHaveBeenLastCalledWith(true)); mock.tenant = "tenant-b"; mock.user = "operator-b"; view.changeScope();
    await act(async () => { resolve(page); }); expect(screen.queryByRole("row", { name: "Anúncio MLB123" })).not.toBeInTheDocument(); expect(view.select).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(false);
  });
  it("does not call the source without an approved enabled company binding", async () => {
    mock.binding.mockResolvedValue({ configured: false, enabled: false, approved_seller_ids: [] }); mount();
    expect(await screen.findByText(/ainda precisa de associação autorizada/)).toBeInTheDocument(); expect(mock.readiness).not.toHaveBeenCalled(); expect(mock.verify).not.toHaveBeenCalled();
  });
});
