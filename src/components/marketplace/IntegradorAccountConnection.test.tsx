import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegradorAccountConnection } from "./IntegradorAccountConnection";
const mock = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn(), open: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/mercado-livre-integration", async original => ({ ...await original<typeof import("@/lib/mercado-livre-integration")>(), beginIntegradorEnrollment: mock.begin, finishIntegradorEnrollment: mock.finish, openIntegradorAuthorization: mock.open }));
const id = "11111111-1111-4111-8111-111111111111", receipt = "a".repeat(64);
const binding = { configured: true, enabled: true, bridge_id: "bridge-a", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: [], account_mappings: [] };
const pending = { id, name: "ELEVARE3D", channel: "mercado_livre" as const, external_seller_id: null, connection_state: "pending_credentials", last_sync_at: null };
const result = { connected: true, account_id: id, seller_id: "new-elevare", nickname: "ELEVARE3D", replayed: false };
beforeEach(() => { mock.begin.mockReset().mockResolvedValue({ authorization_url: "official-provider-url", attempt_id: "attempt-a", expires_at: "2026-11-03T00:00:00Z" }); mock.finish.mockReset().mockResolvedValue(result); mock.open.mockReset(); });
afterEach(cleanup);
function mount(options: { receipt?: string; allowed?: boolean | null; configured?: boolean | null; strict?: boolean; accounts?: typeof pending[]; expectedClientId?: string; connectedAccount?: { seller_id: string; nickname: string } } = {}) {
  const connected = vi.fn(), consumed = vi.fn(), busy = vi.fn();
  let currentReceipt = options.receipt;
  let expectedClientId = options.expectedClientId;
  let currentAccounts = options.accounts ?? [pending, { ...pending, id: "legacy-account", name: "Outra loja", external_seller_id: "old-seller" }];
  const ui = (tenant = "tenant-a", user = "operator-a") => <IntegradorAccountConnection key={`${tenant}:${user}`} binding={binding} tenantId={tenant} userId={user} accounts={currentAccounts} allowed={options.allowed === undefined ? true : options.allowed} configured={options.configured === undefined ? true : options.configured} expectedClientId={expectedClientId} connectedAccount={options.connectedAccount} callbackReceipt={currentReceipt} onConnected={connected} onReceiptConsumed={consumed} onBusyChange={busy} />;
  const view = render(options.strict ? <StrictMode>{ui()}</StrictMode> : ui()); return { ...view, connected, consumed, busy, changeScope: () => view.rerender(ui("tenant-b", "operator-b")), changeReceipt: (next: string) => { currentReceipt = next; view.rerender(ui()); }, changeAccounts: (next: typeof pending[]) => { currentAccounts = next; view.rerender(ui()); }, changeApp: (next: string) => { expectedClientId = next; view.rerender(ui()); } };
}
const choose = (target = id) => fireEvent.change(screen.getByLabelText("Cadastro no Forge para esta conexão"), { target: { value: target } });
describe("new Elevare Mercado Livre enrollment", () => {
  it("renders the authoritative linked account after remount instead of asking for another registration", () => {
    mount({ connectedAccount: { seller_id: "confirmed-seller", nickname: "ELEVARE_3D" }, accounts: [] }); expect(screen.getByText(/Conta conectada: ELEVARE_3D · vendedor confirmed-seller/)).toBeInTheDocument(); expect(screen.queryByLabelText("Cadastro no Forge para esta conexão")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Conectar Mercado Livre" })).not.toBeInTheDocument(); expect(mock.begin).not.toHaveBeenCalled(); expect(mock.finish).not.toHaveBeenCalled();
  });
  it("lets the server confirm unknown prerequisites only after an explicit connection attempt", async () => {
    mount({ allowed: null, configured: null }); choose(); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeEnabled(); expect(screen.getByText(/Ao continuar, vamos validar o acesso/)).toBeInTheDocument(); expect(screen.queryByText(/aplicativo.*precisa estar configurado no servidor/)).not.toBeInTheDocument(); expect(mock.begin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await waitFor(() => expect(mock.begin).toHaveBeenCalledOnce()); expect(mock.begin.mock.calls[0][1]).toBe(id);
  });
  it("does not automatically finish an authorization when the prerequisite query is unknown", async () => {
    const view = mount({ receipt, allowed: null, configured: null }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(mock.finish).not.toHaveBeenCalled(); expect(view.consumed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Conferir conclusão desta conexão" })); await screen.findByText(/Conta conectada: ELEVARE3D/); expect(mock.finish).toHaveBeenCalledOnce();
  });
  it("does not finish an old receipt while own API configuration is explicitly missing", async () => {
    const view = mount({ receipt, configured: false }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(mock.finish).not.toHaveBeenCalled(); expect(view.consumed).not.toHaveBeenCalled(); expect(screen.getByText(/Salve e confirme a configuração da sua API na etapa 1/)).toBeInTheDocument();
  });
  it.each([{ allowed: false, configured: true }, { allowed: true, configured: false }])("does not bypass an explicitly rejected prerequisite %s", async options => {
    mount(options); choose(); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeDisabled(); expect(mock.begin).not.toHaveBeenCalled();
  });
  it("selects the sole pending account without starting any authorization before the operator clicks connect", async () => {
    const view = mount(); expect(mock.begin).not.toHaveBeenCalled(); expect(mock.finish).not.toHaveBeenCalled(); expect(screen.getByLabelText("Cadastro no Forge para esta conexão")).toHaveValue(id); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeEnabled(); expect(screen.queryByRole("option", { name: /Outra loja/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await waitFor(() => expect(mock.open).toHaveBeenCalledWith("official-provider-url"));
    expect(mock.begin).toHaveBeenCalledWith(binding, id, window.location.origin, expect.any(String), expect.objectContaining({ userId: "operator-a", signal: expect.any(AbortSignal) })); expect(view.connected).not.toHaveBeenCalled(); expect(mock.finish).not.toHaveBeenCalled();
  });
  it("requires a choice with multiple pending accounts and preserves the operator selection after the list changes", () => {
    const view = mount({ accounts: [pending, { ...pending, id: "22222222-2222-4222-8222-222222222222", name: "Outro cadastro pendente" }] }); expect(screen.getByLabelText("Cadastro no Forge para esta conexão")).toHaveValue(""); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeDisabled();
    choose("new"); view.changeAccounts([pending]); expect(screen.getByLabelText("Cadastro no Forge para esta conexão")).toHaveValue("new"); expect(mock.begin).not.toHaveBeenCalled();
  });
  it("does not refill a pending account that the operator deliberately cleared", () => {
    const view = mount(); choose(""); view.changeAccounts([pending]); expect(screen.getByLabelText("Cadastro no Forge para esta conexão")).toHaveValue(""); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeDisabled(); expect(mock.begin).not.toHaveBeenCalled();
  });
  it("creates a new local account only when the operator explicitly selects new", async () => {
    mount(); choose("new"); fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await waitFor(() => expect(mock.begin).toHaveBeenCalledWith(binding, null, window.location.origin, expect.any(String), expect.anything()));
  });
  it("retries a lost begin response with the same request identity and preserves the selected account", async () => {
    mock.begin.mockRejectedValueOnce(new Error("Resposta perdida")); mount(); choose(); fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await screen.findByText("Resposta perdida"); const first = mock.begin.mock.calls[0].slice(0, 4);
    expect(screen.getByLabelText("Cadastro no Forge para esta conexão")).toHaveValue(id); fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await waitFor(() => expect(mock.open).toHaveBeenCalled()); expect(mock.begin.mock.calls[1].slice(0, 4)).toEqual(first);
  });
  it("automatically consumes a verified callback once, including StrictMode, without reauthorizing or linking tokens locally", async () => {
    const view = mount({ receipt, strict: true }); await screen.findByText(/Conta conectada: ELEVARE3D/);
    expect(mock.finish).toHaveBeenCalledOnce(); expect(mock.finish).toHaveBeenCalledWith(binding, receipt, expect.any(String), expect.objectContaining({ userId: "operator-a" })); expect(view.connected).toHaveBeenCalledWith(result); expect(view.consumed).toHaveBeenCalledOnce(); expect(mock.begin).not.toHaveBeenCalled(); expect(mock.open).not.toHaveBeenCalled();
  });
  it("keeps a failed completion receipt and retries the same scoped request instead of beginning OAuth again", async () => {
    mock.finish.mockRejectedValueOnce(new Error("Resposta perdida")); const view = mount({ receipt }); await screen.findByText("Resposta perdida"); const first = mock.finish.mock.calls[0].slice(0, 3); expect(view.consumed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Conferir conclusão desta conexão" })); await screen.findByText(/Conta conectada: ELEVARE3D/); expect(mock.finish.mock.calls[1].slice(0, 3)).toEqual(first); expect(mock.begin).not.toHaveBeenCalled();
  });
  it("explains an existing legacy seller without replacing it or consuming the failed receipt", async () => {
    mock.finish.mockRejectedValueOnce(new Error("seller_already_legacy")); const view = mount({ receipt }); await screen.findByText(/Entre na conta Mercado Livre correta da Elevare3D/); expect(view.connected).not.toHaveBeenCalled(); expect(view.consumed).not.toHaveBeenCalled(); expect(mock.begin).not.toHaveBeenCalled();
  });
  it("ignores a late enrollment result after the original user and tenant leave", async () => {
    let resolve!: (value: unknown) => void; mock.finish.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockRejectedValue(new Error("receipt_actor_mismatch")); const view = mount({ receipt }); await waitFor(() => expect(mock.finish).toHaveBeenCalledOnce()); view.changeScope();
    await act(async () => { resolve(result); }); expect(view.connected).not.toHaveBeenCalled(); expect(view.consumed).not.toHaveBeenCalled(); expect(screen.queryByText(/Conta conectada:/)).not.toBeInTheDocument(); expect(view.busy).toHaveBeenLastCalledWith(false);
  });
  it("does not consume an invalid callback and permits an explicit fresh connection", async () => {
    mount({ receipt: "not-a-receipt" }); expect(screen.getByRole("alert")).toHaveTextContent("recibo válido"); expect(mock.finish).not.toHaveBeenCalled(); choose(); expect(screen.getByRole("button", { name: "Conectar Mercado Livre" })).toBeEnabled();
  });
  it("never consumes a newer receipt using an older pending completion in the same auth scope", async () => {
    let resolveA!: (value: unknown) => void, resolveB!: (value: unknown) => void;
    mock.finish.mockReturnValueOnce(new Promise(done => { resolveA = done; })).mockReturnValueOnce(new Promise(done => { resolveB = done; }));
    const view = mount({ receipt }); await waitFor(() => expect(mock.finish).toHaveBeenCalledOnce()); const oldSignal = mock.finish.mock.calls[0][3].signal; view.changeReceipt("b".repeat(64));
    await waitFor(() => expect(mock.finish).toHaveBeenCalledTimes(2)); expect(oldSignal.aborted).toBe(true);
    await act(async () => { resolveA(result); }); expect(view.connected).not.toHaveBeenCalled(); expect(view.consumed).not.toHaveBeenCalled(); expect(screen.queryByText(/Conta conectada:/)).not.toBeInTheDocument();
    await act(async () => { resolveB({ ...result, seller_id: "correct-new-receipt", nickname: "Conta confirmada" }); }); expect(view.connected).toHaveBeenCalledWith(expect.objectContaining({ seller_id: "correct-new-receipt" })); expect(view.consumed).toHaveBeenCalledOnce();
  });
  it("does not open an old authorization or clear a callback that arrived while begin was pending", async () => {
    let resolve!: (value: unknown) => void; mock.begin.mockReturnValueOnce(new Promise(done => { resolve = done; })); mock.finish.mockRejectedValue(new Error("O retorno expirou."));
    const view = mount(); choose(); fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await waitFor(() => expect(mock.begin).toHaveBeenCalledOnce()); view.changeReceipt(receipt); await waitFor(() => expect(mock.finish).toHaveBeenCalledOnce());
    await act(async () => { resolve({ authorization_url: "obsolete-provider-url" }); }); expect(mock.open).not.toHaveBeenCalled(); expect(view.consumed).not.toHaveBeenCalled(); expect(view.connected).not.toHaveBeenCalled();
  });
  it("discards a pending login URL after the own API Client ID changes", async () => {
    let resolve!: (value: unknown) => void; mock.begin.mockReturnValueOnce(new Promise(done => { resolve = done; })); const view = mount({ expectedClientId: "123456" }); fireEvent.click(screen.getByRole("button", { name: "Conectar Mercado Livre" })); await waitFor(() => expect(mock.begin).toHaveBeenCalledOnce()); const signal = mock.begin.mock.calls[0][4].signal;
    view.changeApp("654321"); await act(async () => { resolve({ authorization_url: "https://auth.mercadolivre.com.br/authorization?client_id=123456" }); }); expect(signal.aborted).toBe(true); expect(mock.open).not.toHaveBeenCalled(); expect(view.consumed).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(false); expect(screen.getByLabelText("Cadastro no Forge para esta conexão")).toHaveValue(id);
  });
});
