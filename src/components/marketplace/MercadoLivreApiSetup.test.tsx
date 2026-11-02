import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MercadoLivreApiSetup } from "./MercadoLivreApiSetup";
import { INTEGRADOR_OAUTH_CALLBACK, type IntegradorEnrollmentApp } from "@/lib/mercado-livre-integration";
const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), copy: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/mercado-livre-integration", async original => ({ ...await original<typeof import("@/lib/mercado-livre-integration")>(), readIntegradorReadiness: mock.read, saveIntegradorEnrollmentApp: mock.save }));
const binding = { configured: true, enabled: true, bridge_id: "bridge-a", source_url: "https://integradorwedo.lovable.app", revision: "r1", allow_enrollment: true, approved_seller_ids: [], account_mappings: [] };
const emptyApp: IntegradorEnrollmentApp = { client_id: null, client_secret_configured: false, configured: false, redirect_uri: INTEGRADOR_OAUTH_CALLBACK, revision: "none", can_manage: true };
const ownApp: IntegradorEnrollmentApp = { ...emptyApp, client_id: "123456", client_secret_configured: true, configured: true, revision: "app-r1" };
const readiness = (app = emptyApp) => ({ settings: { client_id: "999999", client_secret_configured: true, configured: true, read_only: true }, source_accounts: [], enrollment_app: app, enrollment: { allowed: true, configured: app.configured, connected_seller_count: 0 } });
beforeEach(() => { mock.read.mockReset().mockResolvedValue(readiness()); mock.save.mockReset().mockResolvedValue(readiness(ownApp)); mock.copy.mockReset().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mock.copy } }); });
afterEach(cleanup);
function mount(value: IntegradorEnrollmentApp | null = emptyApp) {
  const confirmed = vi.fn(), busy = vi.fn(); let current = value;
  const ui = (tenant = "tenant-a", user = "operator-a") => <MercadoLivreApiSetup key={`${tenant}:${user}`} binding={binding} tenantId={tenant} userId={user} value={current} onConfirmed={confirmed} onBusyChange={busy} />;
  const view = render(ui()); return { ...view, confirmed, busy, changeValue: (next: IntegradorEnrollmentApp) => { current = next; view.rerender(ui()); }, changeScope: () => { current = null; view.rerender(ui("tenant-b", "operator-b")); } };
}
function fill(id = "123456", secret = "private-client-secret") { fireEvent.change(screen.getByLabelText("Client ID da sua API"), { target: { value: id } }); if (secret) fireEvent.change(screen.getByLabelText("Client Secret da sua API"), { target: { value: secret } }); }
describe("own Mercado Livre developer API configuration", () => {
  it("shows empty own-app fields even without readiness and offers the exact callback and official portal", async () => {
    mount(null); expect(screen.getByLabelText("Client ID da sua API")).toHaveValue(""); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue(""); expect(screen.getByLabelText("Client Secret da sua API")).toHaveAttribute("type", "password"); expect(screen.getByLabelText("URL de retorno (Redirect URI)")).toHaveValue(INTEGRADOR_OAUTH_CALLBACK); expect(screen.getByLabelText("URL de retorno (Redirect URI)")).toHaveAttribute("readonly"); expect(screen.getByRole("link", { name: /portal oficial de desenvolvedores/ })).toHaveAttribute("href", "https://developers.mercadolivre.com.br/devcenter");
    fireEvent.click(screen.getByRole("button", { name: "Copiar URL de retorno" })); await screen.findByText("URL de retorno copiada."); expect(mock.copy).toHaveBeenCalledWith(INTEGRADOR_OAUTH_CALLBACK); expect(mock.read).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  });
  it("preflights an unknown own-app revision before saving keys and clears the secret only after confirmation", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem"), view = mount(null); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText(/Sua API foi salva/);
    expect(mock.read).toHaveBeenCalledOnce(); expect(mock.save).toHaveBeenCalledWith(binding, { client_id: "123456", client_secret: "private-client-secret" }, "none", expect.any(String), expect.objectContaining({ userId: "operator-a" })); expect(screen.getByLabelText("Client ID da sua API")).toHaveValue("123456"); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue(""); expect(JSON.stringify(view.confirmed.mock.calls)).not.toContain("private-client-secret"); expect(storage).not.toHaveBeenCalled(); storage.mockRestore();
  });
  it("keeps a lost-save draft and repeats the exact revision/request without exposing the secret in errors", async () => {
    mock.save.mockRejectedValueOnce(new Error("Resposta perdida private-client-secret")); mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText("Resposta perdida [omitido]"); const first = mock.save.mock.calls[0].slice(0, 4);
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-client-secret"); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue("private-client-secret"); fireEvent.click(screen.getByRole("button", { name: "Confirmar salvamento da minha API" })); await screen.findByText(/Sua API foi salva/); expect(mock.save.mock.calls[1].slice(0, 4)).toEqual(first);
  });
  it("keeps an unchanged saved secret and requires new credentials to change the Client ID", async () => {
    mount(ownApp); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue(""); expect(screen.getByRole("button", { name: "Salvar minha API" })).toBeDisabled(); fill("654321", ""); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText(/Informe o Client Secret do novo Client ID/); expect(mock.save).not.toHaveBeenCalled();
    mock.save.mockResolvedValue(readiness({ ...ownApp, client_id: "654321", revision: "app-r2" })); fireEvent.change(screen.getByLabelText("Client Secret da sua API"), { target: { value: "secret-for-new-app" } }); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText(/Sua API foi salva/); expect(mock.save).toHaveBeenCalledWith(binding, { client_id: "654321", client_secret: "secret-for-new-app" }, "app-r1", expect.any(String), expect.anything());
  });
  it("requires the first secret and respects an explicit lack of financial permission", async () => {
    mount(); fill("123456", ""); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText(/Preencha o Client Secret/); expect(mock.save).not.toHaveBeenCalled(); cleanup(); mount({ ...emptyApp, can_manage: false }); expect(screen.getByLabelText("Client ID da sua API")).toBeDisabled(); expect(screen.getByRole("button", { name: "Salvar minha API" })).toBeDisabled();
  });
  it("blocks a stale revision until explicitly refreshed and keeps the operator fields", async () => {
    const view = mount(); fill(); view.changeValue({ ...emptyApp, revision: "external-r2" }); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText(/A configuração da API mudou. Atualize a consulta/); expect(mock.save).not.toHaveBeenCalled();
    mock.read.mockResolvedValue(readiness({ ...emptyApp, revision: "external-r2" })); fireEvent.click(screen.getByRole("button", { name: "Conferir API e manter meus dados" })); await waitFor(() => expect(screen.queryByText(/A configuração da API mudou. Atualize a consulta/)).not.toBeInTheDocument()); expect(screen.getByLabelText("Client ID da sua API")).toHaveValue("123456"); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue("private-client-secret"); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText(/Sua API foi salva/); expect(mock.save.mock.calls[0][2]).toBe("external-r2");
  });
  it("does not save or lose entered keys when the preflight fails", async () => {
    mock.read.mockRejectedValue(new Error("Consulta indisponível")); mount(null); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await screen.findByText("Consulta indisponível"); expect(mock.save).not.toHaveBeenCalled(); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue("private-client-secret");
  });
  it("ignores an old preflight after tenant/user switch and releases the parent busy guard", async () => {
    let resolve!: (value: unknown) => void; mock.read.mockReturnValueOnce(new Promise(done => { resolve = done; })); const view = mount(null); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await waitFor(() => expect(mock.read).toHaveBeenCalledOnce()); view.changeScope(); await act(async () => { resolve(readiness()); }); expect(mock.save).not.toHaveBeenCalled(); expect(view.confirmed).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(false); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue("");
  });
  it("ignores a completed save from the previous user and never caches its private draft", async () => {
    let resolve!: (value: unknown) => void; mock.save.mockReturnValueOnce(new Promise(done => { resolve = done; })); const view = mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Salvar minha API" })); await waitFor(() => expect(mock.save).toHaveBeenCalledOnce()); view.changeScope(); await act(async () => { resolve(readiness(ownApp)); }); expect(view.confirmed).not.toHaveBeenCalled(); expect(screen.queryByText(/Sua API foi salva/)).not.toBeInTheDocument(); expect(screen.getByLabelText("Client Secret da sua API")).toHaveValue(""); expect(view.busy).toHaveBeenLastCalledWith(false);
  });
});
