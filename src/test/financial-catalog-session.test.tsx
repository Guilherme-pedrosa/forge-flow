import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinancialCatalogDialog, type CatalogRecord } from "@/components/shared/FinancialCatalogDialog";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), tenant: "tenant-a", user: "operator-a" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function mount(record?: CatalogRecord) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const saved = vi.fn(), close = vi.fn(), busy = vi.fn(), invalidation = vi.spyOn(client, "invalidateQueries");
  const ui = (current = record) => <QueryClientProvider client={client}><FinancialCatalogDialog kind="account" record={current} defaultType="expense" onSaved={saved} onClose={close} onBusyChange={busy} /></QueryClientProvider>;
  const view = render(ui());
  return { ...view, saved, close, busy, invalidation, changeScope: () => view.rerender(ui()), changeRecord: (current: CatalogRecord) => view.rerender(ui(current)) };
}
function saveName(name = "Compra de filamento") {
  fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
}
beforeEach(() => { mock.tenant = "tenant-a"; mock.user = "operator-a"; mock.rpc.mockReset().mockResolvedValue({ data: "catalog-id", error: null }); });
afterEach(cleanup);

describe("financial registration scoped to the current operation", () => {
  it("keeps the existing save contract, expense default and exact request identity when confirming a lost response", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("Resposta perdida"));
    const view = mount();
    expect(screen.getByLabelText("Natureza")).toHaveValue("expense");
    saveName("  Compra de filamento  ");
    expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida");
    const first = structuredClone(mock.rpc.mock.calls[0]);
    expect(first).toEqual(["save_financial_catalog", { p_kind: "account", p_id: null, p_request_id: expect.any(String), p_values: { name: "  Compra de filamento  ", code: "", type: "expense", is_active: true, description: "" } }]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(view.saved).toHaveBeenCalledExactlyOnceWith("catalog-id", "Compra de filamento"));
    expect(mock.rpc.mock.calls[1]).toEqual(first);
    expect(view.invalidation).toHaveBeenCalledWith({ queryKey: ["financial_options"] });
    expect(view.close).toHaveBeenCalledOnce();
    await waitFor(() => expect(view.busy).toHaveBeenLastCalledWith(false));
  });

  it.each(["tenant", "user", "unmount"])("ignores an old accepted response after %s changes and releases the parent busy guard", async mode => {
    const pending = deferred<{ data: string; error: null }>(); mock.rpc.mockReturnValueOnce(pending.promise);
    const view = mount(); saveName();
    await waitFor(() => expect(view.busy).toHaveBeenLastCalledWith(true));
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    if (mode === "unmount") view.unmount();
    else { if (mode === "tenant") mock.tenant = "tenant-b"; else mock.user = "operator-b"; view.changeScope(); expect(screen.getByLabelText("Nome *")).toHaveValue(""); }
    expect(view.busy).toHaveBeenLastCalledWith(false);
    await act(async () => { pending.resolve({ data: "catalog-from-a", error: null }); await pending.promise; });
    expect(view.invalidation).not.toHaveBeenCalled(); expect(view.saved).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled();
    expect(view.busy).toHaveBeenLastCalledWith(false);
  });

  it("does not select or close in another operation if the session changes while catalog invalidation is pending", async () => {
    const invalidated = deferred<void>();
    const view = mount(); view.invalidation.mockReturnValue(invalidated.promise); saveName();
    await waitFor(() => expect(view.invalidation).toHaveBeenCalledTimes(6));
    mock.tenant = "tenant-b"; view.changeScope();
    await act(async () => { invalidated.resolve(); await invalidated.promise; });
    expect(view.saved).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome *")).toHaveValue(""); expect(view.busy).toHaveBeenLastCalledWith(false);
  });

  it("preserves the optimistic edit payload and ignores its result after switching to another record", async () => {
    const pending = deferred<{ data: string; error: null }>(); mock.rpc.mockReturnValueOnce(pending.promise);
    const original: CatalogRecord = { id: "old-account", name: "Conta original", code: "2.1", account_type: "asset", is_active: true, description: "Metadados existentes" };
    const view = mount(original); saveName("Conta revisada");
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_financial_catalog", expect.objectContaining({ p_id: original.id,
      p_values: { name: "Conta revisada", code: "2.1", type: "asset", is_active: true, description: "Metadados existentes", expected: original } })));
    view.changeRecord({ ...original, id: "next-account", name: "Outra conta" });
    expect(screen.getByLabelText("Nome *")).toHaveValue("Outra conta");
    await act(async () => { pending.resolve({ data: original.id, error: null }); await pending.promise; });
    expect(view.saved).not.toHaveBeenCalled(); expect(view.invalidation).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(false);
  });
});
