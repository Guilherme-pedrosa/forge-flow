import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MercadoLivreCommunication } from "./MercadoLivreCommunication";

const mock = vi.hoisted(() => ({ reply: vi.fn(), mark: vi.fn(), questions: vi.fn(), conversations: vi.fn(), conversation: vi.fn(), tenant: "tenant-a" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant } }) }));
vi.mock("@/lib/mercado-livre-integration", () => ({ integrationErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock("@/lib/mercado-livre-workspace", () => ({ readMercadoLivreQuestions: mock.questions, readMercadoLivreConversations: mock.conversations, readMercadoLivreConversation: mock.conversation, replyMercadoLivre: mock.reply, markMercadoLivreConversationRead: mock.mark }));
const binding = { configured: true, enabled: true, bridge_id: "bridge-a", source_url: "https://integradorwedo.lovable.app", revision: "binding-r1", approved_seller_ids: ["123"], account_mappings: [] };
const pack = "20000001", firstRevision = "a".repeat(64), secondRevision = "b".repeat(64);
function conversation(revision = firstRevision) { return { pack_id: pack, seller_id: "123", messages: [{ id: "message1", from: "buyer", text: "Olá, qual o prazo?", status: "available", date: "2026-11-02T20:00:00Z" }], status: "active", substatus: null, can_reply: true, pending: true, last_message_at: "2026-11-02T20:00:00Z", revision }; }
beforeEach(() => {
  mock.tenant = "tenant-a"; mock.reply.mockReset(); mock.mark.mockReset().mockResolvedValue({ marked_read: true, pack_id: pack }); mock.questions.mockReset(); mock.conversations.mockReset(); mock.conversation.mockReset();
  mock.conversations.mockResolvedValue({ items: [{ pack_id: pack, order_id: "20000000", title: "Presépio", buyer_name: "Cliente", last_message: "Olá", last_message_at: "2026-11-02T20:00:00Z", pending: true }], offset: 0, limit: 10, total: 1, next_offset: null });
  mock.conversation.mockResolvedValue(conversation());
  mock.reply.mockResolvedValue({ confirmed: true, action: "message_reply", request_id: "request", target_id: pack, status: "accepted", replayed: false });
});
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 5, retryDelay: 0 } } });
  const ui = (user = "user-a") => <QueryClientProvider client={client}><MercadoLivreCommunication binding={binding} sellerId="123" userId={user} kind="messages" /></QueryClientProvider>;
  const view = render(ui()); return { ...view, client, changeUser: () => { mock.tenant = "tenant-b"; view.rerender(ui("user-b")); } };
}
async function start(content = "Seu pedido está em produção.") {
  const input = await screen.findByLabelText("Sua resposta"); fireEvent.change(input, { target: { value: content } }); fireEvent.click(screen.getByRole("button", { name: "Enviar resposta no Mercado Livre" }));
  return input;
}
describe("Mercado Livre reply recovery", () => {
  it("preserves the exact request/text/revision after an uncertain response and a newer thread revision", async () => {
    const { client } = mount(); mock.reply.mockRejectedValueOnce(new Error("O envio pode ter sido recebido pelo canal.")); await start();
    await screen.findByRole("button", { name: "Conferir envio anterior" }); expect(mock.reply).toHaveBeenCalledTimes(1);
    const original = mock.reply.mock.calls[0]; mock.conversation.mockResolvedValue(conversation(secondRevision));
    act(() => client.setQueryData(["ml_communication", "tenant-a", "user-a", "bridge-a", "123", "thread", pack], conversation(secondRevision)));
    fireEvent.click(screen.getByRole("button", { name: "Conferir envio anterior" }));
    await waitFor(() => expect(mock.reply).toHaveBeenCalledTimes(2));
    expect(mock.reply.mock.calls[1].slice(1, 8)).toEqual(original.slice(1, 8));
    await waitFor(() => expect(screen.getByLabelText("Sua resposta")).toHaveValue(""));
  });
  it("reconciles the previous text without discarding a new draft typed after the error", async () => {
    mount(); mock.reply.mockRejectedValueOnce(new Error("Falha de conexão com resultado incerto.")); await start("A peça está pronta para envio."); await screen.findByRole("button", { name: "Conferir envio anterior" });
    fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "Novo rascunho sobre a embalagem." } });
    fireEvent.click(screen.getByRole("button", { name: "Conferir envio anterior" }));
    await screen.findByText("Envio anterior confirmado. Seu novo rascunho foi preservado.");
    expect(mock.reply.mock.calls[1][4]).toBe("A peça está pronta para envio.");
    expect(screen.getByLabelText("Sua resposta")).toHaveValue("Novo rascunho sobre a embalagem.");
  });
  it("lets the user correct a known preflight rejection and never inherits automatic send retries", async () => {
    mount(); mock.reply.mockRejectedValueOnce(new Error("Confira o texto antes de enviar: contato por canal externo.")); await start("Primeiro rascunho inválido.");
    await screen.findByText(/Confira o texto antes de enviar:/); expect(mock.reply).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "Resposta revisada conforme o pedido." } }); fireEvent.click(screen.getByRole("button", { name: "Enviar resposta no Mercado Livre" }));
    await waitFor(() => expect(mock.reply).toHaveBeenCalledTimes(2)); expect(mock.reply.mock.calls[1][6]).not.toBe(mock.reply.mock.calls[0][6]);
    expect(mock.reply.mock.calls[1][4]).toBe("Resposta revisada conforme o pedido.");
  });
  it("does not carry an uncertain reply or draft into another user/company session", async () => {
    const view = mount(); mock.reply.mockRejectedValueOnce(new Error("Resultado incerto.")); await start(); await screen.findByRole("button", { name: "Conferir envio anterior" });
    view.changeUser(); await waitFor(() => expect(screen.getByLabelText("Sua resposta")).toHaveValue("")); expect(screen.queryByRole("button", { name: "Conferir envio anterior" })).not.toBeInTheDocument(); expect(mock.reply).toHaveBeenCalledTimes(1);
  });
  it("marks a conversation read only after a click and refreshes its scoped dashboard counter without sending a reply", async () => {
    const { client } = mount(), invalidate = vi.spyOn(client, "invalidateQueries"); await screen.findByLabelText("Sua resposta"); expect(mock.mark).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Marcar conversa como lida" })); await waitFor(() => expect(mock.mark).toHaveBeenCalledTimes(1));
    expect(mock.mark).toHaveBeenCalledWith(binding, "123", pack, { userId: "user-a" }); await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ml_dashboard", "tenant-a", "user-a", "bridge-a", "123"] })); expect(mock.reply).not.toHaveBeenCalled();
  });
});
