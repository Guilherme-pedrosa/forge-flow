import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegradorStockOperations } from "./IntegradorStockOperations";
import type { IntegradorManualPreview } from "@/lib/mercado-livre-integration";
const account = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", product = "33333333-3333-4333-8333-333333333333";
const mock = vi.hoisted(() => ({ read: vi.fn(), takeover: vi.fn(), sync: vi.fn(), current: null as IntegradorManualPreview | null, reads: [] as Record<string, string>[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/marketplace-orders", async original => ({ ...await original<typeof import("@/lib/marketplace-orders")>(), marketplaceDb: { from: () => {
  const filters: Record<string, string> = {}; const builder = { select: () => builder, eq: (key: string, value: string) => { filters[key] = value; return builder; }, order: () => builder, range: () => builder,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => { mock.reads.push({ ...filters }); return Promise.resolve({ data: filters.tenant_id === "tenant-a" ? [{ id: "binding-a", product_id: product }] : [], error: null }).then(resolve, reject); } }; return builder;
} } }));
vi.mock("@/lib/mercado-livre-integration", async original => ({ ...await original<typeof import("@/lib/mercado-livre-integration")>(), readIntegradorStockPreview: mock.read, takeoverIntegradorStock: mock.takeover, syncIntegradorManual: mock.sync }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ label, value, options, disabled, onChange }: { label: string; value: string; options: { id: string; label: string }[]; disabled: boolean; onChange: (id: string) => void }) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Escolher</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
const binding = { configured: true, enabled: true, bridge_id: "bridge-a", source_url: "https://integradorwedo.lovable.app", revision: "binding-r1", approved_seller_ids: ["123", "456"], account_mappings: [{ account_id: account, source_seller_id: "123", bridge_id: "bridge-a" }, { account_id: other, source_seller_id: "456", bridge_id: "bridge-a" }] };
function preview(claimed = false): IntegradorManualPreview {
  const targets = [{ account_id: account, product_id: product, seller_id: "123", item_id: "MLB-A" }, { account_id: other, product_id: product, seller_id: "456", item_id: "MLB-B" }];
  return { revision: (claimed ? "b" : "a").repeat(64), claimed, complete: true, issues: [], stock_owner: claimed ? "forge" : "integrador", manual_confirmation_required: true, targets,
    prices: targets.map(target => ({ ...target, current_price: 20, accepted_price: 25, acceptance_id: "accepted-one-unit", issue: null })),
    preview: { tenantId: "tenant-a", previewOnly: true, writesEnabled: false, complete: true, issues: [], products: [{ productId: product, available: 10, unaccountedPaidQuantity: 2, budget: 8, allocatedQuantity: 8, unallocatedQuantity: 0, complete: true, issues: [] }],
      buckets: targets.map((target, index) => ({ key: `bucket-${index}`, productId: product, sellerId: target.seller_id, accountIds: [target.account_id], itemIds: [target.item_id], userProductId: null, currentQuantity: 1, proposedQuantity: 4, allocatedQuantity: 4, safeToIncrease: true, preserveStatus: true, requiresReview: false, issues: [] })) } };
}
beforeEach(() => {
  mock.current = preview(); mock.reads.length = 0; mock.read.mockReset().mockImplementation(async () => structuredClone(mock.current));
  mock.takeover.mockReset().mockImplementation(async () => { mock.current = preview(true); return structuredClone(mock.current); });
  mock.sync.mockReset().mockImplementation(async (_binding, action) => ({ confirmed: true, action, accepted_revision: "b".repeat(64), replayed: false, items: [{ seller_id: "123", item_id: "MLB-A", quantity: action === "stock" ? 4 : null, price: action === "price" ? 25 : null, status: "confirmed" }] }));
});
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 5 } } }); const busy = vi.fn();
  const ui = (tenant = "tenant-a", userId = "user-a") => <QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><IntegradorStockOperations binding={binding} tenantId={tenant} userId={userId} accountId={account} sellerId="123" productOptions={[{ id: product, name: "Produto A", sku: "PA" }, { id: "unlinked", name: "Sem vínculo", sku: null }]} accountNames={[{ id: account, name: "Conta A" }, { id: other, name: "Conta B" }]} onBusyChange={busy} /></MemoryRouter></QueryClientProvider>;
  const view = render(ui()); return { ...view, client, busy, changeSession: () => view.rerender(ui("tenant-b", "user-b")) };
}
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "Conferir prévia de estoque e preço" })).toBeEnabled()); }
async function review() { await ready(); fireEvent.click(screen.getByRole("button", { name: "Conferir prévia de estoque e preço" })); await screen.findByText(/Responsável pelo estoque:/); }
const confirmStock = () => fireEvent.click(screen.getByRole("checkbox", { name: "Confirmo as quantidades propostas em todos os anúncios listados." }));
const confirmPrice = () => fireEvent.click(screen.getByRole("checkbox", { name: "Confirmo a publicação dos preços aceitos no Forge para todos os anúncios listados." }));
describe("manual marketplace publishing from server previews", () => {
  it("selects the one actually linked product without running operations and shows every affected seller before metadata takeover", async () => {
    mount(); await ready(); expect(mock.read).not.toHaveBeenCalled(); expect(mock.takeover).not.toHaveBeenCalled(); expect(mock.sync).not.toHaveBeenCalled(); expect(screen.queryByRole("option", { name: "Sem vínculo" })).not.toBeInTheDocument();
    await review(); expect(screen.getByText(/Conta B · vendedor 456 · anúncio MLB-B/)).toBeInTheDocument(); const saldo = within(screen.getByRole("article", { name: "Saldo de Produto A" })); expect(saldo.getByText("10")).toBeInTheDocument(); expect(saldo.getByText("2")).toBeInTheDocument(); expect(saldo.getAllByText("8")).toHaveLength(2); expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    const take = screen.getByRole("button", { name: "Assumir controle do estoque no Forge" }); expect(take).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox", { name: /Quero que o Forge assuma/ })); fireEvent.click(take);
    await screen.findByRole("button", { name: "Atualizar estoque no canal" }); expect(mock.takeover).toHaveBeenCalledWith(binding, { account_id: account, source_seller_id: "123", product_ids: [product] }, "a".repeat(64), expect.any(String), expect.objectContaining({ tenantId: "tenant-a", userId: "user-a" })); expect(mock.sync).not.toHaveBeenCalled();
    expect(mock.reads.every(row => row.tenant_id === "tenant-a" && row.account_id === account)).toBe(true);
  });
  it("allows confirmed stock while an accepted one-unit price remains pending", async () => {
    mock.current = preview(true); mock.current.prices = mock.current.prices.map(row => ({ ...row, accepted_price: null, acceptance_id: null, issue: "accept_price_for_one_unit" })); mount(); await review();
    expect(screen.getByRole("button", { name: "Atualizar preços no canal" })).toBeDisabled(); expect(screen.getAllByText(/Confirme no Forge um preço de Mercado Livre/)).toHaveLength(2); confirmStock(); fireEvent.click(screen.getByRole("button", { name: "Atualizar estoque no canal" }));
    await screen.findByText("Estoque confirmado no canal."); expect(mock.sync).toHaveBeenCalledOnce(); expect(mock.sync).toHaveBeenCalledWith(binding, "stock", { account_id: account, source_seller_id: "123", product_ids: [product] }, "b".repeat(64), expect.any(String), expect.anything());
  });
  it("keeps unknown stock pending and explains a prior GC queue without an override action", async () => {
    mock.current = preview(); mock.current.complete = false; mock.current.issues = ["legacy_order_queue_requires_review"]; mock.current.preview.products[0].available = null; mock.current.preview.products[0].budget = null; mock.current.preview.products[0].complete = false; mock.current.preview.buckets[0].proposedQuantity = null; mock.current.preview.buckets[0].requiresReview = true;
    mount(); await review(); expect(screen.getByText(/Conclua ou revise a fila de processamento anterior do GC/)).toBeInTheDocument(); expect(within(screen.getByRole("article", { name: "Saldo de Produto A" })).getAllByText("Pendente")).toHaveLength(2); expect(screen.getByRole("button", { name: "Assumir controle do estoque no Forge" })).toBeDisabled(); expect(mock.takeover).not.toHaveBeenCalled(); expect(mock.sync).not.toHaveBeenCalled();
  });
  it("blocks publication when the Integrador still controls the same stock on Amazon", async () => {
    mock.current = preview(true); mock.current.complete = false; mock.current.issues = ["legacy_other_channel_stock_owner"]; mount(); await review();
    expect(screen.getByText(/Este mesmo estoque ainda é anunciado na Amazon pelo Integrador/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Atualizar estoque no canal" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Atualizar preços no canal" })).toBeDisabled(); expect(mock.sync).not.toHaveBeenCalled();
  });
  it("blocks operations if any competing target lacks the exact approved local seller mapping", async () => {
    mock.current = preview(true); mock.current.targets[1].account_id = "not-associated"; mount(); await review();
    expect(screen.getByText(/Confira a associação de todas as contas e anúncios envolvidos/)).toBeInTheDocument(); expect(screen.getByText(/not-associated · vendedor 456/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Atualizar estoque no canal" })).toBeDisabled(); expect(mock.sync).not.toHaveBeenCalled();
  });
  it("publishes only the accepted server price after its own explicit confirmation", async () => {
    mock.current = preview(true); mount(); await review(); expect(screen.getByRole("button", { name: "Atualizar preços no canal" })).toBeDisabled(); confirmPrice(); fireEvent.click(screen.getByRole("button", { name: "Atualizar preços no canal" })); await screen.findByText("Preços confirmados no canal.");
    expect(mock.sync).toHaveBeenCalledWith(binding, "price", { account_id: account, source_seller_id: "123", product_ids: [product] }, "b".repeat(64), expect.any(String), expect.anything()); expect(Object.keys(mock.sync.mock.calls[0][2]).sort()).toEqual(["account_id", "product_ids", "source_seller_id"]); expect(screen.getByRole("region", { name: "Resultado confirmado no canal" })).toHaveTextContent("R$ 25,00");
  });
  it("never repeats an uncertain PUT and requires a fresh preview and new confirmation/request ID", async () => {
    mock.current = preview(true); mock.sync.mockRejectedValueOnce(new Error("Readback falhou após o envio")); mount(); await review(); confirmStock(); fireEvent.click(screen.getByRole("button", { name: "Atualizar estoque no canal" })); await screen.findByText(/A última atualização tem resultado incerto/); const first = mock.sync.mock.calls[0][4];
    await act(async () => { await Promise.resolve(); }); expect(mock.sync).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: /Tentar.*novamente|Atualizar estoque no canal/ })).not.toBeInTheDocument();
    mock.current.revision = "c".repeat(64); await review(); expect(screen.getByRole("button", { name: "Atualizar estoque no canal" })).toBeDisabled(); confirmStock(); fireEvent.click(screen.getByRole("button", { name: "Atualizar estoque no canal" })); await screen.findByText("Estoque confirmado no canal."); expect(mock.sync).toHaveBeenCalledTimes(2); expect(mock.sync.mock.calls[1][4]).not.toBe(first);
  });
  it("can confirm a lost metadata takeover response with the identical request identity", async () => {
    mock.takeover.mockRejectedValueOnce(new Error("Resposta perdida")); mount(); await review(); fireEvent.click(screen.getByRole("checkbox", { name: /Quero que o Forge assuma/ })); fireEvent.click(screen.getByRole("button", { name: "Assumir controle do estoque no Forge" })); await screen.findByText("Resposta perdida"); const first = mock.takeover.mock.calls[0].slice(0, 4);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar controle destes anúncios" })); await screen.findByRole("button", { name: "Atualizar estoque no canal" }); expect(mock.takeover.mock.calls[1].slice(0, 4)).toEqual(first); expect(mock.sync).not.toHaveBeenCalled();
  });
  it("discards a stale approved preview if a later read fails", async () => {
    mock.current = preview(true); mount(); await review(); confirmStock(); mock.read.mockRejectedValueOnce(new Error("Conferência indisponível")); fireEvent.click(screen.getByRole("button", { name: "Conferir prévia de estoque e preço" })); await screen.findByText("Conferência indisponível"); expect(screen.queryByRole("button", { name: "Atualizar estoque no canal" })).not.toBeInTheDocument(); expect(mock.sync).not.toHaveBeenCalled();
  });
  it("clears selection and approvals intentionally and does not refill them after a catalog refresh", async () => {
    mock.current = preview(true); const view = mount(); await review(); confirmStock(); fireEvent.click(screen.getByRole("button", { name: "Remover Produto A" })); expect(screen.queryByRole("button", { name: "Atualizar estoque no canal" })).not.toBeInTheDocument(); await act(async () => { await view.client.invalidateQueries({ queryKey: ["marketplace_sku_bindings", "tenant-a", account] }); }); expect(screen.getByRole("button", { name: "Conferir prévia de estoque e preço" })).toBeDisabled(); expect(mock.sync).not.toHaveBeenCalled();
  });
  it("ignores a late preview after tenant/user change and releases the parent pending guard", async () => {
    let resolve!: (value: unknown) => void; mock.read.mockReturnValue(new Promise(done => { resolve = done; })); const view = mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Conferir prévia de estoque e preço" })); await waitFor(() => expect(view.busy).toHaveBeenLastCalledWith(true)); view.changeSession();
    await act(async () => { resolve(preview()); }); expect(screen.queryByText(/Responsável pelo estoque:/)).not.toBeInTheDocument(); expect(view.busy).toHaveBeenLastCalledWith(false); expect(mock.takeover).not.toHaveBeenCalled(); expect(mock.sync).not.toHaveBeenCalled();
  });
});
