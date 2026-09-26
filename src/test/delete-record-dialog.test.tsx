import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteRecordDialog, type DeleteTarget } from "@/components/shared/DeleteRecordDialog";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
// Keep the real SDK so a detached rpc method fails exactly as it does in the browser.
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("https://deletion-test.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: network.fetch },
  }) };
});
const target = (kind: DeleteTarget["kind"]): DeleteTarget => ({ kind, id: "670b0b58-2a45-4d73-9c55-b3b57f1ecb14", name: "ORC-20260827-010" });
const success = () => new Response(null, { status: 204 });
function mount(kind: DeleteTarget["kind"] = "order") {
  const onClose = vi.fn(); const onDeleted = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><DeleteRecordDialog target={target(kind)} onClose={onClose} onDeleted={onDeleted} /></QueryClientProvider>);
  return { onClose, onDeleted, invalidate };
}
beforeEach(() => { network.fetch.mockReset(); network.fetch.mockImplementation(async () => success()); });
afterEach(cleanup);

describe("exclusão confirmada com o cliente Supabase real", () => {
  it.each<DeleteTarget["kind"]>(["product", "inventory", "order", "quote", "purchase", "payable", "receivable"])("envia %s ao servidor e atualiza a lista somente após confirmar", async kind => {
    const { onClose, onDeleted, invalidate } = mount(kind);
    expect(network.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(network.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = network.fetch.mock.calls[0];
    expect(String(url)).toBe("https://deletion-test.supabase.co/rest/v1/rpc/delete_unused_record");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ p_kind: kind, p_id: target(kind).id });
    expect(onDeleted).toHaveBeenCalledTimes(1); expect(invalidate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("mantém o registro e mostra o motivo do servidor quando há vínculos", async () => {
    network.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: "P0001", message: "Pedido com produção ou financeiro vinculado. Mantenha o histórico." }), { status: 400 }));
    const { onClose, onDeleted, invalidate } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Excluir definitivamente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pedido com produção ou financeiro vinculado");
    expect(onDeleted).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(network.fetch).toHaveBeenCalledTimes(2);
  });
  it("bloqueia repetição e fechamento enquanto aguarda a exclusão", async () => {
    let finish!: (response: Response) => void;
    network.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
    const { onClose, onDeleted } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(network.fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Excluindo…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled(); expect(onDeleted).not.toHaveBeenCalled();
    finish(success()); await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
  it("Voltar encerra a confirmação sem enviar exclusão", () => {
    const { onClose } = mount(); fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledTimes(1); expect(network.fetch).not.toHaveBeenCalled();
  });
});
