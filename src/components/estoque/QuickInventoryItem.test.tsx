import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickInventoryItem } from "./QuickInventoryItem";

const mock = vi.hoisted(() => ({ tenant: "tenant-a", user: "operator-a", rpc: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
const clients: QueryClient[] = [];
beforeEach(() => { mock.tenant = "tenant-a"; mock.user = "operator-a"; mock.rpc.mockReset().mockResolvedValue({ data: "new-supply", error: null }); });
afterEach(() => { cleanup(); for (const client of clients) client.clear(); clients.length = 0; });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  const onCreated = vi.fn(), onClose = vi.fn(), busy = vi.fn(), invalidate = vi.spyOn(client, "invalidateQueries");
  const component = () => <QueryClientProvider client={client}><QuickInventoryItem open purchaseContext initialName="Espátula descrição original" onCreated={onCreated} onClose={onClose} onBusyChange={busy} /></QueryClientProvider>;
  const view = render(component()); return { ...view, onCreated, onClose, busy, invalidate, changeSession: () => view.rerender(component()) };
}
describe("new purchase supply identity", () => {
  it("asks only identity/unit and confirms selection after saving zero initial stock and cost", async () => {
    const pending = deferred<{ data: string; error: null }>(); mock.rpc.mockReturnValueOnce(pending.promise);
    const view = mount();
    expect(screen.getByLabelText("Nome *")).toHaveValue("Espátula descrição original");
    expect(screen.queryByLabelText("Custo unitário (R$)")).not.toBeInTheDocument(); expect(screen.queryByLabelText("Estoque inicial")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Filamento" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Espátula Elevare" } });
    fireEvent.change(screen.getByLabelText("Unidade do estoque"), { target: { value: "un" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar e selecionar" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_inventory_catalog", { p_item_id: null,
      p_item: { name: "Espátula Elevare", category: "consumable", unit: "un", avg_cost: 0, current_stock: 0 }, p_request_id: expect.any(String) }));
    expect(view.onCreated).not.toHaveBeenCalled(); expect(view.onClose).not.toHaveBeenCalled(); expect(view.busy).toHaveBeenLastCalledWith(true);
    await act(async () => { pending.resolve({ data: "new-supply", error: null }); await pending.promise; });
    await waitFor(() => expect(view.onCreated).toHaveBeenCalledExactlyOnceWith({ id: "new-supply", name: "Espátula Elevare", unit: "un" }));
    expect(view.onClose).toHaveBeenCalledOnce(); expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ["inventory_items"] });
  });
  it("keeps the identity draft after failure and retries the exact same operation ID without initializing purchase stock", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("Resposta do cadastro perdida")); const view = mount();
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "Resina transparente" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "resin" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar e selecionar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Resposta do cadastro perdida");
    expect(screen.getByLabelText("Nome *")).toHaveValue("Resina transparente"); expect(screen.getByLabelText("Unidade do estoque")).toHaveValue("g"); expect(view.onCreated).not.toHaveBeenCalled();
    const first = structuredClone(mock.rpc.mock.calls[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar e selecionar" })); await waitFor(() => expect(view.onCreated).toHaveBeenCalledOnce());
    expect(mock.rpc.mock.calls).toHaveLength(2); expect(mock.rpc.mock.calls[1]).toEqual(first);
    expect(mock.rpc.mock.calls[1][1].p_item).toEqual({ name: "Resina transparente", category: "resin", unit: "g", avg_cost: 0, current_stock: 0 });
  });
  it.each(["unmount", "company change"])("ignores a completed old creation after %s", async mode => {
    const pending = deferred<{ data: string; error: null }>(); mock.rpc.mockReturnValueOnce(pending.promise); const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar e selecionar" })); await waitFor(() => expect(mock.rpc).toHaveBeenCalledOnce());
    if (mode === "unmount") view.unmount(); else { mock.tenant = "tenant-b"; mock.user = "operator-b"; view.changeSession(); }
    await act(async () => { pending.resolve({ data: "old-company-supply", error: null }); await pending.promise; });
    expect(view.onCreated).not.toHaveBeenCalled(); expect(view.onClose).not.toHaveBeenCalled(); expect(view.invalidate).not.toHaveBeenCalled();
    if (mode === "company change") expect(screen.getByRole("button", { name: "Cadastrar e selecionar" })).toBeEnabled();
  });
});
