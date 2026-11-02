import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MercadoLivreSettings } from "./MercadoLivreSettings";
const mock = vi.hoisted(() => ({ binding: vi.fn(), readiness: vi.fn(), verify: vi.fn(), listings: vi.fn(), link: vi.fn(), tenant: "tenant-a", user: "operator-a" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/mercado-livre-integration", async original => ({ ...await original<typeof import("@/lib/mercado-livre-integration")>(), readIntegradorBridgeBinding: mock.binding, readIntegradorReadiness: mock.readiness, revalidateIntegradorAccount: mock.verify, fetchIntegradorListings: mock.listings, linkIntegradorMarketplaceAccount: mock.link }));
const source = { seller_id: "seller-a", nickname: "Loja A", credentials_configured: true, expires_at: "2026-11-03T10:00:00Z" };
const local = { id: "local-a", channel: "mercado_livre" as const, name: "Cadastro Elevare", external_seller_id: "seller-a", connection_state: "import_only", last_sync_at: null };
const page = { items: [{ id: "MLB123", title: "Presépio", status: "active", permalink: "https://produto.mercadolivre.com.br/MLB123", thumbnail: null, currency_id: "BRL", price: 39.9, available_quantity: 5, sku: null, variations: [{ id: "VAR-RED", sku: "RED", price: 39.9, available_quantity: 2, attributes: [{ name: "Cor", value_name: "Vermelho" }] }] }], offset: 0, limit: 20, total: 21, next_offset: 20 };
beforeEach(() => {
  mock.tenant = "tenant-a"; mock.user = "operator-a";
  mock.binding.mockReset().mockResolvedValue({ configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", approved_seller_ids: ["seller-a", "seller-b"], account_mappings: [{ account_id: "local-a", source_seller_id: "seller-a", bridge_id: "public-id" }] });
  mock.readiness.mockReset().mockResolvedValue({ settings: { client_id: "1234", client_secret_configured: true, redirect_uri: "https://integradorwedo.lovable.app/retorno", configured: true }, source_accounts: [source, { ...source, seller_id: "seller-b", nickname: "Loja B", credentials_configured: false }] });
  mock.verify.mockReset().mockResolvedValue(source); mock.listings.mockReset().mockResolvedValue(page); mock.link.mockReset().mockResolvedValue("local-a");
});
afterEach(cleanup);
function mount(activeAccount = local) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const linked = vi.fn(), select = vi.fn(), busy = vi.fn();
  const ui = () => <QueryClientProvider client={client}><MercadoLivreSettings accounts={[local, { ...local, id: "pending", external_seller_id: null }]} activeAccount={activeAccount} onAccountLinked={linked} onSelectListing={select} onBusyChange={busy} /></QueryClientProvider>;
  const view = render(ui()); return { ...view, linked, select, busy, changeScope: () => view.rerender(ui()) };
}
async function choose(id = "seller-a") { await screen.findByRole("option", { name: /Loja A/ }); fireEvent.change(screen.getByLabelText("Vendedor do Integrador"), { target: { value: id } }); }
describe("concrete Integrador operations in Forge", () => {
  it("reads only safe app/account status and requires explicit seller choice and remote verification", async () => {
    mount(); await screen.findByRole("option", { name: /Loja A/ });
    expect(screen.getByLabelText("Vendedor do Integrador")).toHaveValue(""); expect(mock.verify).not.toHaveBeenCalled(); expect(mock.listings).not.toHaveBeenCalled(); expect(mock.link).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Configuração do aplicativo/)); expect(screen.getByText("Configurado no servidor")).toBeInTheDocument(); expect(screen.queryByLabelText(/secret|segredo/i)).not.toBeInTheDocument();
    await choose(); expect(screen.getByText(/acesso remoto ainda não conferido/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conferir acesso desta conta" }));
    expect(await screen.findByText("Acesso conferido no Mercado Livre nesta sessão")).toBeInTheDocument(); expect(mock.verify).toHaveBeenCalledWith(expect.anything(), "seller-a", expect.objectContaining({ userId: "operator-a" }));
    await choose("seller-b"); expect(screen.getByText("Cadastro no Integrador · autorização pendente")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Conferir acesso desta conta" })).toBeDisabled();
  });
  it("queries real listing pages on demand and hands the exact variation/SKU to the canonical binding editor", async () => {
    const view = mount(); await choose(); fireEvent.click(screen.getByRole("button", { name: "Consultar anúncios" }));
    expect(await screen.findByRole("article", { name: "Anúncio MLB123" })).toHaveTextContent("R$ 39,90");
    fireEvent.click(screen.getByRole("button", { name: "Vincular variação VAR-RED a produto" })); expect(view.select).toHaveBeenCalledWith({ external_item_id: "MLB123", external_variant_id: "VAR-RED", external_sku: "RED" }, "seller-a");
    fireEvent.click(screen.getByRole("button", { name: "Próxima página de anúncios" })); await waitFor(() => expect(mock.listings).toHaveBeenLastCalledWith(expect.anything(), "seller-a", 20, expect.anything())); expect(mock.link).not.toHaveBeenCalled();
  });
  it("blocks listing bindings when the selected Forge account belongs to another seller", async () => {
    const view = mount({ ...local, external_seller_id: "wrong-seller" }); await choose(); fireEvent.click(screen.getByRole("button", { name: "Consultar anúncios" }));
    expect(await screen.findByRole("button", { name: "Vincular variação VAR-RED a produto" })).toBeDisabled(); expect(view.select).not.toHaveBeenCalled();
  });
  it("associates only the explicitly chosen local account and retries a lost response with the same request ID and draft", async () => {
    mock.link.mockRejectedValueOnce(new Error("Resposta perdida")); const view = mount(); await choose();
    const button = screen.getByRole("button", { name: "Salvar associação do vendedor" }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Conta de destino no Forge"), { target: { value: "pending" } }); fireEvent.change(screen.getByLabelText("Nome da conta no Forge"), { target: { value: "Elevare confirmada" } }); fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida"); const first = mock.link.mock.calls[0];
    expect(first).toEqual(["seller-a", "Elevare confirmada", "pending", expect.any(String)]); expect(screen.getByLabelText("Nome da conta no Forge")).toHaveValue("Elevare confirmada"); fireEvent.click(button);
    await waitFor(() => expect(view.linked).toHaveBeenCalledWith("local-a")); expect(mock.link.mock.calls[1]).toEqual(first);
  });
  it("ignores a late result after seller or tenant switch and releases the parent busy guard", async () => {
    let resolve!: (value: unknown) => void; mock.listings.mockReturnValue(new Promise(done => { resolve = done; })); const view = mount(); await choose(); fireEvent.click(screen.getByRole("button", { name: "Consultar anúncios" }));
    await waitFor(() => expect(view.busy).toHaveBeenLastCalledWith(true)); mock.tenant = "tenant-b"; mock.user = "operator-b"; view.changeScope();
    await act(async () => { resolve(page); }); expect(screen.queryByRole("article", { name: "Anúncio MLB123" })).not.toBeInTheDocument(); expect(view.select).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(false);
  });
  it("does not call the source without an approved enabled company binding", async () => {
    mock.binding.mockResolvedValue({ configured: false, enabled: false, approved_seller_ids: [] }); mount();
    expect(await screen.findByText(/ainda precisa de associação autorizada/)).toBeInTheDocument(); expect(mock.readiness).not.toHaveBeenCalled(); expect(mock.verify).not.toHaveBeenCalled();
  });
});
