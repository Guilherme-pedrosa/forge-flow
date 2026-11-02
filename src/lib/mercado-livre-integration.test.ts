import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { INTEGRADOR_BRIDGE_ENDPOINT, fetchIntegradorListings, fetchIntegradorMarketplaceOrders, integradorSettingsDraft, prepareIntegradorSettingsChanges, readIntegradorReadiness, readMercadoLivreReadiness, revalidateIntegradorAccount, saveIntegradorSettings, readIntegradorStockPreview, takeoverIntegradorStock, syncIntegradorManual, type IntegradorBridgeBinding } from "./mercado-livre-integration";
const mock = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn(), fetch: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: mock.getSession } } }));
vi.mock("./marketplace-orders", async original => ({ ...await original<typeof import("./marketplace-orders")>(), marketplaceRpc: mock.rpc }));
const abort = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
beforeAll(() => { if (!abort) Object.defineProperty(AbortSignal.prototype, "throwIfAborted", { configurable: true, value(this: AbortSignal) { if (this.aborted) throw new DOMException("Cancelado", "AbortError"); } }); });
afterAll(() => { if (!abort) delete (AbortSignal.prototype as unknown as Record<string, unknown>).throwIfAborted; });
const binding: IntegradorBridgeBinding = { configured: true, enabled: true, bridge_id: "public-bridge-id", source_url: "https://integradorwedo.lovable.app", revision: "r1", approved_seller_ids: ["seller-a"], account_mappings: [] };
const account = { seller_id: "seller-a", nickname: "Loja autorizada", credentials_configured: true, expires_at: "2026-11-03T10:00:00Z" };
const readiness = { settings: { client_id: "1234", client_secret_configured: true, redirect_uri: "https://integradorwedo.lovable.app/retorno", configured: true }, source_accounts: [account] };
beforeEach(() => { mock.rpc.mockReset(); mock.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "operator-a" }, access_token: "session-jwt" } }, error: null }); mock.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => readiness }); vi.stubGlobal("fetch", mock.fetch); });
afterEach(() => vi.unstubAllGlobals());
describe("pinned authenticated Integrador client", () => {
  it("uses the normal transient Forge JWT only at the pinned endpoint and strips unexpected secret fields", async () => {
    mock.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...readiness, access_token: "forbidden", settings: { ...readiness.settings, client_secret: "forbidden-secret" }, source_accounts: [{ ...account, refresh_token: "forbidden-refresh" }, { ...account, seller_id: "other-tenant" }] }) });
    const result = await readIntegradorReadiness(binding, { userId: "operator-a" });
    expect(mock.fetch).toHaveBeenCalledExactlyOnceWith(INTEGRADOR_BRIDGE_ENDPOINT, expect.objectContaining({ method: "POST", credentials: "omit", headers: { Authorization: "Bearer session-jwt", "Content-Type": "application/json" }, body: JSON.stringify({ bridge_id: binding.bridge_id, action: "settings_readiness" }) }));
    expect(JSON.stringify(result)).not.toMatch(/forbidden|other-tenant/); expect(result.source_accounts).toHaveLength(1);
  });
  it.each([{ ...binding, source_url: "https://attacker.example" }, { ...binding, enabled: false }, { ...binding, configured: false }])("rejects an unapproved source before reading the session", async invalid => {
    await expect(readIntegradorReadiness(invalid, { userId: "operator-a" })).rejects.toThrow(); expect(mock.getSession).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("does not send a session from another operator or query an unapproved seller", async () => {
    await expect(fetchIntegradorListings(binding, "other-seller", 0, { userId: "operator-a" })).rejects.toThrow("vendedor aprovado");
    expect(mock.getSession).not.toHaveBeenCalled();
    await expect(readIntegradorReadiness(binding, { userId: "operator-b" })).rejects.toThrow("sessão mudou"); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("aborts before sending JWT if the original UI scope disappears while getSession is pending", async () => {
    let resolve!: (value: unknown) => void; mock.getSession.mockReturnValue(new Promise(done => { resolve = done; }));
    const controller = new AbortController(), promise = readIntegradorReadiness(binding, { userId: "operator-a", signal: controller.signal });
    controller.abort(); resolve({ data: { session: { user: { id: "operator-a" }, access_token: "session-jwt" } }, error: null });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" }); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("requires positive remote verification of the selected seller and preserves listing/variation IDs as strings", async () => {
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ verified: true, account: { ...account, seller_id: "wrong-seller" } }) });
    await expect(revalidateIntegradorAccount(binding, "seller-a", { userId: "operator-a" })).rejects.toThrow("vendedor selecionado");
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: "MLB123", title: "Produto", status: "active", variations: [{ id: "90071992547409930", sku: "RED" }] }], offset: 20, limit: 20, total: 21, next_offset: null }) });
    const page = await fetchIntegradorListings(binding, "seller-a", 20, { userId: "operator-a" });
    expect(page.items[0].variations[0].id).toBe("90071992547409930");
    expect(JSON.parse(mock.fetch.mock.calls[1][1].body)).toEqual({ bridge_id: binding.bridge_id, action: "fetch_listings", source_seller_id: "seller-a", offset: 20, limit: 20 });
  });
  it("does not turn missing credential status into a connected account", () => {
    expect(() => readMercadoLivreReadiness({ ...readiness, source_accounts: [{ seller_id: "seller-a" }] })).toThrow("dados incompletos");
  });
  it("bounds a stalled session lookup without sending the JWT", async () => {
    vi.useFakeTimers(); mock.getSession.mockReturnValue(new Promise(() => {}));
    try { const result = readIntegradorReadiness(binding, { userId: "operator-a" }); const assertion = expect(result).rejects.toThrow("demorou"); await vi.advanceTimersByTimeAsync(20001); await assertion; expect(mock.fetch).not.toHaveBeenCalled(); } finally { vi.useRealTimers(); }
  });
  it("validates canonical orders before Forge import and keeps remote order and item identities", async () => {
    const order = { external_order_id: "90071992547409930", external_status: "paid", normalized_state: "paid", external_updated_at: "2026-11-02T10:00:00Z", shipping_deadline_at: "2026-11-03T10:00:00Z", items: [{ external_line_id: "line-1", external_item_id: "MLB123", external_variant_id: "RED", external_sku: "SKU-RED", description: "Peça", quantity: 1, unit_price: 20 }] };
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [order], next_offset: null, fetched: 1, total: 1, truncated: false, bridge_version: "v1" }) });
    const result = await fetchIntegradorMarketplaceOrders(binding, "seller-a", { order_ids: [order.external_order_id] }, { userId: "operator-a" });
    expect(result.orders[0]).toMatchObject(order); expect(mock.rpc).not.toHaveBeenCalled();
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [{ ...order, items: [{ ...order.items[0], quantity: -1 }] }], next_offset: null, fetched: 1, total: 1, truncated: false }) });
    await expect(fetchIntegradorMarketplaceOrders(binding, "seller-a", { order_ids: [order.external_order_id] }, { userId: "operator-a" })).rejects.toThrow();
  });
  it("sends only changed allowed settings, preserves a blank secret, and accepts explicit zero without inventing unknown values", () => {
    const original = readMercadoLivreReadiness({ ...readiness, settings: { ...readiness.settings, full_scope: true, read_only: false, can_manage_settings: true, can_manage_app: true, enabled: true, markup_percent: null, stock_safety: 2, listing_type_default: "gold_special", tipo_valor_venda: "valor_venda", revision: "r1" } }).settings;
    const draft = integradorSettingsDraft(original);
    expect(draft.markup_percent).toBe(""); expect(draft.client_secret).toBe("");
    expect(prepareIntegradorSettingsChanges({ ...draft, stock_safety: "0" }, original)).toEqual({ stock_safety: 0 });
    expect(() => prepareIntegradorSettingsChanges({ ...draft, stock_safety: "" }, original)).toThrow("Reserva de estoque");
    expect(() => prepareIntegradorSettingsChanges({ ...draft, stock_safety: "3" }, { ...original, full_scope: false })).toThrow("apenas consultar");
  });
  it("sends an explicit settings confirmation to the source with revision/request identity and keeps the response free of secrets", async () => {
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true, accepted_revision: "r2", replayed: false, marketplace_api_writes: false, client_secret: "must-not-return" }) });
    const result = await saveIntegradorSettings(binding, { stock_safety: 0 }, "r1", "same-request", { userId: "operator-a" });
    expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ bridge_id: binding.bridge_id, action: "settings_save", settings: { stock_safety: 0 }, expected_revision: "r1", request_id: "same-request", acknowledge_scheduled_effects: true });
    expect(result).toEqual({ saved: true, accepted_revision: "r2", replayed: false, marketplace_api_writes: false });
  });
});
const localAccount = "11111111-1111-4111-8111-111111111111", productId = "22222222-2222-4222-8222-222222222222";
const manualBinding: IntegradorBridgeBinding = { ...binding, account_mappings: [{ account_id: localAccount, source_seller_id: "seller-a", bridge_id: binding.bridge_id! }] };
const selection = { account_id: localAccount, source_seller_id: "seller-a", product_ids: [productId] };
const manualContext = { userId: "operator-a", tenantId: "tenant-a" };
function manualPreview() {
  return { revision: "a".repeat(64), claimed: false, complete: false, issues: ["finished_availability_missing"], stock_owner: "integrador", manual_confirmation_required: true,
    targets: [{ ...selection, product_id: productId, seller_id: "seller-a", item_id: "MLB-A" }], prices: [],
    preview: { tenantId: "tenant-a", previewOnly: true, writesEnabled: false, complete: false, products: [{ productId, available: null, unaccountedPaidQuantity: 0, budget: null, allocatedQuantity: 0, unallocatedQuantity: null, complete: false, issues: ["finished_availability_missing"] }], buckets: [], issues: [] } };
}
describe("manual Integrador operation HTTP contract", () => {
  it("sends only linked identifiers and leaves unknown server stock pending", async () => {
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => manualPreview() });
    const result = await readIntegradorStockPreview(manualBinding, { ...selection, product_ids: [productId, productId], quantity: 99, price: 999 } as typeof selection, manualContext);
    expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ bridge_id: binding.bridge_id, action: "stock_preview", ...selection });
    expect(result.preview.products[0].available).toBeNull(); expect(result.preview.products[0].budget).toBeNull(); expect(result.complete).toBe(false); expect(JSON.stringify(result)).not.toContain("product_ids");
  });
  it("checks the exact mapped account and UUID selection before reading any session", async () => {
    await expect(readIntegradorStockPreview(manualBinding, { ...selection, account_id: productId }, manualContext)).rejects.toThrow("associação");
    await expect(readIntegradorStockPreview(manualBinding, { ...selection, product_ids: ["unbound"] }, manualContext)).rejects.toThrow("produtos vinculados");
    expect(mock.getSession).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("rejects a preview from another tenant or contradictory claimed ownership", async () => {
    const wrong = manualPreview(); wrong.preview.tenantId = "tenant-b";
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => wrong });
    await expect(readIntegradorStockPreview(manualBinding, selection, manualContext)).rejects.toThrow("empresa");
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...manualPreview(), claimed: true }) });
    await expect(readIntegradorStockPreview(manualBinding, selection, manualContext)).rejects.toThrow("responsável confirmado");
  });
  it("requires metadata-only takeover proof and includes the same revision/request confirmation", async () => {
    const accepted = { ...manualPreview(), claimed: true, stock_owner: "forge", accepted_revision: "b".repeat(64), replayed: true, marketplace_api_writes: false };
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => accepted });
    expect((await takeoverIntegradorStock(manualBinding, selection, "a".repeat(64), "request-a", manualContext)).claimed).toBe(true);
    expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ bridge_id: binding.bridge_id, action: "takeover_stock", ...selection, expected_revision: "a".repeat(64), request_id: "request-a", acknowledge_takeover: true });
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...accepted, marketplace_api_writes: true }) });
    await expect(takeoverIntegradorStock(manualBinding, selection, "a".repeat(64), "request-a", manualContext)).rejects.toThrow("dados incompletos");
  });
  it("sends an explicit server-price confirmation and rejects a receipt for another operation", async () => {
    const receipt = { confirmed: true, action: "price", accepted_revision: "a".repeat(64), replayed: false, items: [{ seller_id: "seller-a", item_id: "MLB-A", quantity: null, price: 25, status: "confirmed" }], access_token: "forbidden" };
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => receipt });
    const result = await syncIntegradorManual(manualBinding, "price", selection, "a".repeat(64), "write-a", manualContext);
    expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ bridge_id: binding.bridge_id, action: "sync_price", ...selection, expected_revision: "a".repeat(64), request_id: "write-a", acknowledge_marketplace_write: true });
    expect(JSON.stringify(result)).not.toContain("forbidden");
    mock.fetch.mockResolvedValueOnce({ ok: true, json: async () => receipt });
    await expect(syncIntegradorManual(manualBinding, "stock", selection, "a".repeat(64), "write-b", manualContext)).rejects.toThrow("operação solicitada");
  });
  it("uses ninety seconds for manual writes and never repeats an uncertain request", async () => {
    vi.useFakeTimers(); mock.fetch.mockReturnValue(new Promise(() => {}));
    try {
      const promise = syncIntegradorManual(manualBinding, "stock", selection, "a".repeat(64), "write-a", manualContext), assertion = expect(promise).rejects.toThrow("Confira o resultado");
      await vi.advanceTimersByTimeAsync(20001); expect(mock.fetch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(70000); await assertion; expect(mock.fetch).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
