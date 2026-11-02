import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegradorConfigurationEditor } from "./IntegradorConfigurationEditor";
import { readMercadoLivreReadiness, type IntegradorSettings } from "@/lib/mercado-livre-integration";
const mock = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/mercado-livre-integration", async original => ({ ...await original<typeof import("@/lib/mercado-livre-integration")>(), saveIntegradorSettings: mock.save, readIntegradorReadiness: mock.read }));
const binding = { configured: true, enabled: true, bridge_id: "public-id", source_url: "https://integradorwedo.lovable.app", revision: "binding-r1", approved_seller_ids: ["123"], account_mappings: [] };
const ready = (overrides: Partial<IntegradorSettings> = {}) => readMercadoLivreReadiness({ settings: { client_id: "1234", client_secret_configured: true, redirect_uri: "https://integradorwedo.lovable.app/retorno", configured: true, enabled: true, markup_percent: 30, stock_safety: 2, listing_type_default: "gold_special", tipo_valor_venda: "valor_venda", full_scope: true, can_manage_settings: true, can_manage_app: true, read_only: false, revision: "r1", ...overrides }, source_accounts: [] });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); mock.save.mockReset().mockResolvedValue({ saved: true, accepted_revision: "r2", replayed: false, marketplace_api_writes: false }); mock.read.mockReset().mockResolvedValue(ready({ revision: "r2", stock_safety: 3 })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() {
  const confirmed = vi.fn(), busy = vi.fn(); let current = ready().settings;
  const ui = () => <IntegradorConfigurationEditor binding={binding} value={current} userId="operator-a" hasConnectedAccounts onBusyChange={busy} onConfirmed={value => { confirmed(value); current = value.settings; view.rerender(ui()); }} />;
  const view = render(ui()); return { ...view, confirmed, busy, externalChange: (settings: IntegradorSettings) => { current = settings; view.rerender(ui()); } };
}
const acknowledge = () => fireEvent.click(screen.getByRole("checkbox"));
const changeStock = (value = "3") => fireEvent.change(screen.getByLabelText("Reserva de estoque (unidades)"), { target: { value } });
describe("actual Integrador settings save", () => {
  it("hydrates existing values and saves only reviewed changes while preserving the blank stored secret", async () => {
    const view = mount(); expect(screen.getByLabelText("Acréscimo do Integrador (%)")).toHaveValue("30"); expect(screen.getByLabelText("Novo segredo do aplicativo")).toHaveValue(""); expect(screen.getByLabelText("Client ID do aplicativo")).toBeDisabled(); expect(mock.save).not.toHaveBeenCalled();
    changeStock(); const save = screen.getByRole("button", { name: "Salvar configuração do Integrador" }); expect(save).toBeDisabled(); acknowledge(); fireEvent.click(save);
    await waitFor(() => expect(view.confirmed).toHaveBeenCalled()); expect(mock.save).toHaveBeenCalledWith(binding, { stock_safety: 3 }, "r1", expect.any(String), expect.objectContaining({ userId: "operator-a" }));
    expect(screen.getByLabelText("Reserva de estoque (unidades)")).toHaveValue("3"); expect(screen.getByLabelText("Novo segredo do aplicativo")).toHaveValue(""); expect(screen.getByRole("status")).toHaveTextContent("Configuração salva");
  });
  it("keeps the draft and exact request ID after an accepted write loses its response", async () => {
    mock.save.mockRejectedValueOnce(new Error("Resposta perdida após aceitar")); mount(); changeStock(); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "Salvar configuração do Integrador" })); expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida"); const first = mock.save.mock.calls[0]; expect(mock.read).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reserva de estoque (unidades)")).toHaveValue("3"); fireEvent.click(screen.getByRole("button", { name: "Confirmar salvamento da configuração" })); await screen.findByRole("status"); expect(mock.save.mock.calls[1].slice(0, 4)).toEqual(first.slice(0, 4));
  });
  it("blocks a changed remote revision until explicit refresh preserves the operator's edits", async () => {
    const view = mount(); changeStock(); acknowledge(); view.externalChange(ready({ revision: "r2", markup_percent: 40 }).settings);
    expect(screen.getByRole("button", { name: "Salvar configuração do Integrador" })).toBeDisabled(); expect(mock.save).not.toHaveBeenCalled();
    mock.read.mockResolvedValueOnce(ready({ revision: "r2", markup_percent: 40 })); fireEvent.click(screen.getByRole("button", { name: "Atualizar configuração e manter meus ajustes" })); await waitFor(() => expect(screen.getByLabelText("Acréscimo do Integrador (%)")).toHaveValue("40")); expect(screen.getByLabelText("Reserva de estoque (unidades)")).toHaveValue("3"); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "Salvar configuração do Integrador" })); await waitFor(() => expect(mock.save).toHaveBeenCalledWith(binding, { stock_safety: 3 }, "r2", expect.any(String), expect.anything()));
  });
  it("keeps an unknown field pending and accepts a deliberately entered zero", async () => {
    mount(); changeStock(""); acknowledge(); expect(screen.getByRole("button", { name: "Salvar configuração do Integrador" })).toBeDisabled(); expect(screen.getByRole("alert")).toHaveTextContent("Reserva de estoque");
    changeStock("0"); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "Salvar configuração do Integrador" })); await waitFor(() => expect(mock.save).toHaveBeenCalledWith(binding, { stock_safety: 0 }, "r1", expect.any(String), expect.anything()));
  });
  it("does not expose a typed secret in errors and clears it only after confirmed save", async () => {
    mock.save.mockRejectedValueOnce(new Error("Falha ao salvar typed-app-secret")); mount(); const secret = screen.getByLabelText("Novo segredo do aplicativo"); expect(secret).toHaveAttribute("type", "password"); fireEvent.change(secret, { target: { value: "typed-app-secret" } }); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "Salvar configuração do Integrador" }));
    const alert = await screen.findByRole("alert"); expect(alert).not.toHaveTextContent("typed-app-secret"); expect(secret).toHaveValue("typed-app-secret"); fireEvent.click(screen.getByRole("button", { name: "Confirmar salvamento da configuração" })); await screen.findByRole("status"); expect(secret).toHaveValue("");
  });
  it("does not perform a credentialed reread or late cache callback after the form unmounts during save", async () => {
    let resolve!: (value: unknown) => void; mock.save.mockReturnValue(new Promise(done => { resolve = done; })); const view = mount(); changeStock(); acknowledge(); fireEvent.click(screen.getByRole("button", { name: "Salvar configuração do Integrador" })); await waitFor(() => expect(mock.save).toHaveBeenCalled()); view.unmount(); expect(view.busy).toHaveBeenLastCalledWith(false);
    await act(async () => { resolve({ saved: true, accepted_revision: "r2", replayed: false, marketplace_api_writes: false }); }); expect(mock.read).not.toHaveBeenCalled(); expect(view.confirmed).not.toHaveBeenCalled();
  });
});
