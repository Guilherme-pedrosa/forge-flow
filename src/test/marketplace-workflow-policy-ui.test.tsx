import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowPolicy } from "@/components/marketplace/WorkflowPolicy";

type Policy = { default_customer_id: string | null; receivable_due_days: number; safety_buffer_hours: number; auto_organize: boolean };
type Inbox = { id: string; internal_order_id: string | null; normalized_state: string; needs_review: boolean };
const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), policies: {} as Record<string, Policy | null>, orders: {} as Record<string, Inbox[]> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/lib/marketplace-orders", () => ({ marketplaceRpc: mock.rpc, marketplaceDb: { from: (table: string) => {
  let account = ""; const filters: Record<string, unknown> = {}; let count = 100;
  const response = () => ({ data: (mock.orders[account] ?? []).filter(row => Object.entries(filters).every(([key, value]) => row[key as keyof Inbox] === value)).slice(0, count), error: null });
  const query = { select: () => query, eq: (key: string, value: unknown) => { if (key === "account_id") account = String(value); else filters[key] = value; return query; }, is: (key: string, value: unknown) => { filters[key] = value; return query; }, order: () => query, limit: (limit: number) => { count = limit; return query; },
    maybeSingle: () => Promise.resolve({ data: table === "marketplace_workflow_policies" ? mock.policies[account] ?? null : null, error: null }),
    then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(response()).then(resolve, reject),
  };
  return query;
} } }));

const customers = [{ id: "customer-a", name: "Cliente A" }, { id: "customer-b", name: "Cliente B" }];
const existingPolicy = (changes: Partial<Policy> = {}): Policy => ({ default_customer_id: "customer-a", receivable_due_days: 30, safety_buffer_hours: 24, auto_organize: false, ...changes });
const eligible = (id: string, changes: Partial<Inbox> = {}): Inbox => ({ id, internal_order_id: null, normalized_state: "paid", needs_review: false, ...changes });
function mount(accountId = "account-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (account: string) => <QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><WorkflowPolicy accountId={account} customerOptions={customers} /></MemoryRouter></QueryClientProvider>;
  const result = render(view(accountId));
  return { ...result, changeAccount: (account: string) => result.rerender(view(account)) };
}
const organizeButton = () => screen.getByRole("button", { name: "Organizar até 100 novos pedidos importados" });
beforeEach(() => {
  mock.policies = {}; mock.orders = {}; mock.rpc.mockReset(); mock.toast.mockReset();
  mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "save_marketplace_workflow_policy") { mock.policies[String(args.p_account_id)] = args.p_values as Policy; return args.p_account_id; }
    return { organized: 0, results: [] };
  });
});
afterEach(cleanup);

describe("marketplace organization policy", () => {
  it("starts off and opening the configuration creates no sale, receivable or operation", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar organização" })).toBeEnabled());
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByLabelText("Previsão do recebível (dias)")).toHaveValue(30);
    expect(screen.getByLabelText("Antecedência para produzir (horas)")).toHaveValue(24);
    expect(organizeButton()).toBeDisabled();
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/Isso pode baixar estoque pronto, criar recebíveis/)).toBeInTheDocument();
  });
  it("saves explicit opt-in and a valid 1.1-hour buffer, then enables organization", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar organização" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Cliente dos pedidos desta conta"), { target: { value: "customer-a" } });
    fireEvent.change(screen.getByLabelText("Previsão do recebível (dias)"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Antecedência para produzir (horas)"), { target: { value: "1.1" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(organizeButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar organização" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_marketplace_workflow_policy", expect.objectContaining({ p_account_id: "account-a", p_values: { default_customer_id: "customer-a", receivable_due_days: 12, safety_buffer_hours: 1.1, auto_organize: true }, p_request_id: expect.any(String) })));
    await waitFor(() => expect(organizeButton()).toBeEnabled());
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["save_marketplace_workflow_policy"]);
  });
  it("reuses the request after a transport failure and starts a fresh attempt after a confirmed pending receipt", async () => {
    mock.policies["account-a"] = existingPolicy(); mock.orders["account-a"] = [eligible("external-row")];
    const receipt = { organized: 0, results: [{ marketplace_order_id: "external-row", order_id: null, outcome: "needs_review", issues: ["Vincule o SKU"] }] };
    mock.rpc.mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce(receipt).mockResolvedValueOnce(receipt);
    mount(); await waitFor(() => expect(organizeButton()).toBeEnabled());
    fireEvent.click(organizeButton());
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Timeout" })));
    await waitFor(() => expect(organizeButton()).toBeEnabled()); fireEvent.click(organizeButton());
    await screen.findByText(/Vincule o SKU/);
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    expect(mock.rpc.mock.calls[1][1].p_request_id).toBe(mock.rpc.mock.calls[0][1].p_request_id);
    await waitFor(() => expect(organizeButton()).toBeEnabled()); fireEvent.click(organizeButton());
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(3));
    expect(mock.rpc.mock.calls[2][1].p_request_id).not.toBe(mock.rpc.mock.calls[1][1].p_request_id);
    for (const call of mock.rpc.mock.calls) expect(call).toEqual(["organize_eligible_marketplace_orders", expect.objectContaining({ p_account_id: "account-a", p_order_ids: ["external-row"] })]);
  });
  it("does not copy another account's unsaved policy or previous pending result", async () => {
    mock.policies["account-a"] = existingPolicy({ auto_organize: true, receivable_due_days: 12 });
    mock.policies["account-b"] = existingPolicy({ default_customer_id: "customer-b", auto_organize: false, receivable_due_days: 45, safety_buffer_hours: 6 });
    mock.orders["account-a"] = [eligible("account-a-row")];
    mock.rpc.mockResolvedValueOnce({ organized: 0, results: [{ marketplace_order_id: "account-a-row", external_order_id: "ACCOUNT-A-ORDER", order_id: "account-a-draft", outcome: "needs_preparation", issues: ["Pendência da conta A"] }] });
    const { changeAccount } = mount();
    await waitFor(() => expect(screen.getByLabelText("Previsão do recebível (dias)")).toHaveValue(12));
    await waitFor(() => expect(organizeButton()).toBeEnabled()); fireEvent.click(organizeButton());
    await screen.findByText(/ACCOUNT-A-ORDER: Pendência da conta A/);
    fireEvent.change(screen.getByLabelText("Antecedência para produzir (horas)"), { target: { value: "1.1" } });
    changeAccount("account-b");
    await waitFor(() => expect(screen.getByLabelText("Previsão do recebível (dias)")).toHaveValue(45));
    expect(screen.getByLabelText("Antecedência para produzir (horas)")).toHaveValue(6);
    expect(screen.getByLabelText("Cliente dos pedidos desta conta")).toHaveValue("customer-b");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText(/Pendência da conta A/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Abrir pedido" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar organização" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_marketplace_workflow_policy", expect.objectContaining({ p_account_id: "account-b", p_values: { default_customer_id: "customer-b", receivable_due_days: 45, safety_buffer_hours: 6, auto_organize: false } })));
  });
  it("identifies a pending draft and links directly to its preparation without claiming production is complete", async () => {
    mock.policies["account-a"] = existingPolicy(); mock.orders["account-a"] = [eligible("12345678-pending")];
    mock.rpc.mockResolvedValue({ organized: 0, results: [{ marketplace_order_id: "12345678-pending", external_order_id: "SHOPEE-2026-10-42", order_id: "draft / 1", outcome: "needs_preparation", issues: ["Falta o tempo da placa"] }] });
    mount(); await waitFor(() => expect(organizeButton()).toBeEnabled()); fireEvent.click(organizeButton());
    expect(await screen.findByText(/Pedido SHOPEE-2026-10-42: Falta o tempo da placa/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir pedido" })).toHaveAttribute("href", "/comercial/pedidos?pedido=draft%20%2F%201");
    expect(screen.getByText(/Rascunhos com pendências podem ser preparados e confirmados em Pedidos/)).toBeInTheDocument();
  });
  it("skips already linked sales so they do not occupy the 100-new-order batch", async () => {
    mock.policies["account-a"] = existingPolicy();
    mock.orders["account-a"] = [...Array.from({ length: 100 }, (_, i) => eligible(`organized-${i}`, { internal_order_id: `sale-${i}` })), eligible("new-101")];
    mount(); await waitFor(() => expect(organizeButton()).toBeEnabled()); fireEvent.click(organizeButton());
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("organize_eligible_marketplace_orders", expect.objectContaining({ p_order_ids: ["new-101"] })));
  });
});
