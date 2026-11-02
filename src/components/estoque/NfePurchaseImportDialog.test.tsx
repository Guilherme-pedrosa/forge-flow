import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import xml from "@/test/fixtures/nfe-purchase-review.xml?raw";
import { NfePurchaseImportDialog } from "./NfePurchaseImportDialog";

const mock = vi.hoisted(() => ({ tenant: "tenant-a", user: "operator-a", rpc: vi.fn(), inlineName: "", materials: [] as Record<string, unknown>[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/components/shared/SearchableItemSelect", () => ({ SearchableItemSelect: ({ label, value, options, onChange, disabled }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean }) => <select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Selecionar</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock("@/components/comercial/PartnerDialog", () => ({ PartnerDialog: () => null }));
vi.mock("@/components/shared/FinancialCatalogDialog", () => ({ FinancialCatalogDialog: () => null }));
vi.mock("./QuickInventoryItem", () => ({ QuickInventoryItem: ({ initialName, onCreated }: { initialName: string; onCreated: (item: { id: string; name: string; unit: string }) => void }) => <section aria-label="Cadastro auxiliar"><p>{initialName}</p><button onClick={() => { mock.inlineName = initialName; mock.materials.push(rawMaterial("new-item", initialName)); onCreated({ id: "new-item", name: initialName, unit: "g" }); }}>Confirmar novo insumo</button></section> }));
vi.mock("./FilamentRegistration", () => ({ FilamentRegistration: ({ initialName, onSaved }: { initialName: string; onSaved: (id: string) => void }) => <section aria-label="Cadastro auxiliar"><p>{initialName}</p><button onClick={() => { mock.inlineName = initialName; mock.materials.push(rawMaterial("new-filament", initialName)); onSaved("new-filament"); }}>Confirmar novo filamento</button></section> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  const filters: [string, unknown][] = [];
  const query = { select: () => query, eq: (field: string, value: unknown) => { filters.push([field, value]); return query; }, order: () => query,
    range: async (from: number, to: number) => {
      const source = table === "inventory_items" ? mock.materials : table === "products" ? [{ tenant_id: mock.tenant, stock_item_id: "owned-stock", is_active: false }]
        : table === "vendors" ? [{ tenant_id: mock.tenant, is_active: true, id: "vendor", name: "Fornecedor cadastrado", document: "12345678000123" }]
        : table === "payment_methods" ? [{ tenant_id: mock.tenant, is_active: true, id: "method", name: "Boleto conferido", type: "boleto" }]
        : table === "chart_of_accounts" ? [{ tenant_id: mock.tenant, is_active: true, id: "account", name: "Compra de insumos", code: "3.1", account_type: "expense" }]
        : table === "cost_centers" ? [{ tenant_id: mock.tenant, is_active: true, id: "center", name: "Produção", code: "P" }] : [];
      return { data: source.filter(row => filters.every(([field, value]) => row[field] === value)).slice(from, to + 1), error: null };
    } };
  return query;
} } }));
function rawMaterial(id = "pla-white", name = "PLA Branco Elevare") { return { tenant_id: mock.tenant, is_active: true, id, name, category: "filament", unit: "g", sku: "PLA-BR-01", material_code: "PLA", color: "Branco", color_code: "WHITE", avg_cost: .05, current_stock: 1000, vendor_id: "vendor" }; }
const clients: QueryClient[] = [];
beforeEach(() => { mock.tenant = "tenant-a"; mock.user = "operator-a"; mock.inlineName = ""; mock.rpc.mockReset().mockResolvedValue({ data: "purchase", error: null }); mock.materials = [rawMaterial(), rawMaterial("owned-stock", "Estoque de produto arquivado")];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); for (const client of clients) client.clear(); clients.length = 0; });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  const onImported = vi.fn(), onOpenChange = vi.fn();
  const component = () => <QueryClientProvider client={client}><NfePurchaseImportDialog open onImported={onImported} onOpenChange={onOpenChange} /></QueryClientProvider>;
  const view = render(component()); return { ...view, client, onImported, onOpenChange, changeSession: () => view.rerender(component()) };
}
async function upload() {
  const file = new File([xml], "nota.xml", { type: "application/xml" }); Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(xml) });
  fireEvent.change(screen.getByLabelText("Arquivo XML da NFe"), { target: { files: [file] } });
  await screen.findByRole("article", { name: "Item 1 da nota" });
  await waitFor(() => expect(screen.getByLabelText("Fornecedor da NFe")).toHaveValue("vendor"));
}
const row = (number: number) => within(screen.getByRole("article", { name: `Item ${number} da nota` }));
function skip(number: number) { fireEvent.click(row(number).getByRole("checkbox")); }
async function classify() {
  await within(screen.getByLabelText("Forma de pagamento", { exact: true })).findByRole("option", { name: "Boleto conferido" });
  fireEvent.change(screen.getByLabelText("Forma de pagamento", { exact: true }), { target: { value: "method" } });
  fireEvent.change(screen.getByLabelText("Plano de contas", { exact: true }), { target: { value: "account" } });
  fireEvent.change(screen.getByLabelText("Centro de custo", { exact: true }), { target: { value: "center" } });
}
async function readyExpensePurchase() { await upload(); skip(1); skip(2); await classify(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("NF-e import review before one atomic purchase", () => {
  it("shows actual irregular dues/raw mixed payments and blocks an unreviewed item instead of auto-selecting its suggestion", async () => {
    const view = mount(); await upload();
    expect(screen.getByLabelText("Vencimento da parcela 1")).toHaveValue("2026-11-20"); expect(screen.getByLabelText("Valor da parcela 1")).toHaveValue("40.10");
    expect(screen.getByLabelText("Vencimento da parcela 2")).toHaveValue("2027-01-07"); expect(screen.getByLabelText("Valor da parcela 2")).toHaveValue("73.00");
    expect(screen.getByText(/Boleto \(15\)/)).toBeInTheDocument(); expect(screen.getByText(/\(17\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Insumo do item 1")).toHaveValue(""); expect(screen.getByLabelText("Forma de pagamento", { exact: true })).toHaveValue("");
    expect(screen.queryByRole("option", { name: /Estoque de produto arquivado/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar NFe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vincule o item 1"); expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Insumo do item 1"), { target: { value: "pla-white" } }); skip(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Lançar parcelas no financeiro" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar NFe" })); await waitFor(() => expect(view.onImported).toHaveBeenCalledOnce());
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_quick_purchase", expect.objectContaining({ p_receive: false, p_items: [expect.objectContaining({ inventory_item_id: "pla-white", stock_quantity: null }), expect.objectContaining({ inventory_item_id: null })] }));
  });
  it("requires method/account and explicit UN→g conversion, then receives through one RPC preserving fiscal decimals and dues", async () => {
    const view = mount(); await upload();
    fireEvent.click(await row(1).findByRole("button", { name: "Confirmar insumo sugerido do item 1" })); skip(2);
    const description = "FILAMENTO PLA BRANCO 1,75MM - DESCRIÇÃO ORIGINAL DO FORNECEDOR";
    expect(screen.getByLabelText(`Quantidade de estoque de ${description}`)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Importar NFe" })); expect(await screen.findByRole("alert")).toHaveTextContent("forma de pagamento");
    fireEvent.change(screen.getByLabelText("Forma de pagamento", { exact: true }), { target: { value: "method" } });
    fireEvent.click(screen.getByRole("button", { name: "Importar NFe" })); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("plano de contas"));
    await classify(); fireEvent.click(screen.getByRole("checkbox", { name: /Já recebi os insumos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Importar e Receber" })); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("quantidade de entrada")); expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(`Peso de material por embalagem de ${description}`), { target: { value: "0,75" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar total de 1.500 g" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar e Receber" })); await waitFor(() => expect(view.onImported).toHaveBeenCalledOnce());
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_quick_purchase", expect.objectContaining({ p_receive: true,
      p_order: expect.objectContaining({ receive_now: true, total: "113.10", nfe_xml: xml }),
      p_items: [expect.objectContaining({ description, quantity: "2.0000", unit_price: "49.9000000000", total: "99.80", inventory_item_id: "pla-white", stock_quantity: 1500 }), expect.objectContaining({ inventory_item_id: null, stock_quantity: null })],
      p_installments: [expect.objectContaining({ due_date: "2026-11-20", amount: 40.1, payment_method_id: "method", account_id: "account", cost_center_id: "center" }), expect.objectContaining({ due_date: "2027-01-07", amount: 73 })] }));
  });
  it("passes an edited internal name to inline registration while preserving fiscal text and an explicit no-payables choice", async () => {
    const view = mount(); await upload();
    fireEvent.change(screen.getByLabelText("Nome interno do item 1"), { target: { value: "PLA Branco nome interno" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar filamento do item 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar novo filamento" }));
    await waitFor(() => expect(screen.getByLabelText("Insumo do item 1")).toHaveValue("new-filament"));
    expect(mock.inlineName).toBe("PLA Branco nome interno"); skip(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Lançar parcelas no financeiro" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar NFe" })); await waitFor(() => expect(view.onImported).toHaveBeenCalledOnce());
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_quick_purchase", expect.objectContaining({ p_receive: false, p_installments: [], p_items: [expect.objectContaining({ description: "FILAMENTO PLA BRANCO 1,75MM - DESCRIÇÃO ORIGINAL DO FORNECEDOR", inventory_item_id: "new-filament", stock_quantity: null }), expect.anything()] }));
  });
  it("renames an existing stock identity without changing fiscal text, confirmed conversion or the later receipt", async () => {
    mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "save_inventory_catalog") {
        const patch = args.p_item as { name: string };
        mock.materials = mock.materials.map(material => material.id === args.p_item_id ? { ...material, name: patch.name } : material);
        return { data: args.p_item_id, error: null };
      }
      return { data: "purchase", error: null };
    });
    const view = mount(); await upload();
    fireEvent.change(screen.getByLabelText("Insumo do item 1"), { target: { value: "pla-white" } }); skip(2); await classify();
    const fiscal = "FILAMENTO PLA BRANCO 1,75MM - DESCRIÇÃO ORIGINAL DO FORNECEDOR";
    fireEvent.change(screen.getByLabelText(`Quantidade de estoque de ${fiscal}`), { target: { value: "1500" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Já recebi os insumos/ }));
    const before = structuredClone(mock.materials[0]);
    fireEvent.click(row(1).getByText("Alterar nome do insumo"));
    fireEvent.change(row(1).getByLabelText("Nome interno do item 1"), { target: { value: "PLA Branco renomeado" } });
    fireEvent.click(row(1).getByRole("button", { name: "Atualizar nome no estoque do item 1" }));
    await row(1).findByText("PLA Branco renomeado");
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("save_inventory_catalog", { p_item_id: "pla-white", p_item: { name: "PLA Branco renomeado" }, p_request_id: expect.any(String) });
    expect(mock.materials[0]).toEqual({ ...before, name: "PLA Branco renomeado" });
    expect(row(1).getByText(fiscal)).toBeInTheDocument();
    expect(screen.getByLabelText(`Quantidade de estoque de ${fiscal}`)).toHaveValue("1500");
    expect(screen.getByRole("checkbox", { name: /Já recebi os insumos/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Importar e Receber" })); await waitFor(() => expect(view.onImported).toHaveBeenCalledOnce());
    expect(mock.rpc.mock.calls.map(call => call[0])).toEqual(["save_inventory_catalog", "save_quick_purchase"]);
    expect(mock.rpc.mock.calls[1][1]).toMatchObject({ p_receive: true, p_order: { receive_now: true }, p_items: [expect.objectContaining({ description: fiscal, quantity: "2.0000", unit_price: "49.9000000000", total: "99.80", inventory_item_id: "pla-white", stock_quantity: 1500 }), expect.anything()] });
  });
  it("retains reviewed values after a lost response and retries the same complete request identity", async () => {
    mock.rpc.mockRejectedValueOnce(new Error("Resposta perdida depois de confirmar a compra")); const view = mount(); await readyExpensePurchase();
    fireEvent.click(screen.getByRole("button", { name: "Importar NFe" })); expect(await screen.findByRole("alert")).toHaveTextContent("Resposta perdida");
    expect(screen.getByLabelText("Vencimento da parcela 2")).toHaveValue("2027-01-07"); expect(screen.getByLabelText("Plano de contas", { exact: true })).toHaveValue("account");
    const first = structuredClone(mock.rpc.mock.calls[0]);
    fireEvent.click(screen.getByRole("button", { name: "Importar NFe" })); await waitFor(() => expect(view.onImported).toHaveBeenCalledOnce());
    expect(mock.rpc.mock.calls).toHaveLength(2); expect(mock.rpc.mock.calls[1]).toEqual(first); expect(view.onOpenChange).toHaveBeenCalledWith(false);
  });
  it("discards the previously reviewed invoice when an attempted replacement XML is invalid", async () => {
    mount(); await readyExpensePurchase();
    const file = new File(["<NFe>invalid"], "nota-invalida.xml", { type: "application/xml" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue("<NFe>invalid") });
    fireEvent.change(screen.getByLabelText("Arquivo XML da NFe"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/malformado/);
    expect(screen.queryByRole("article", { name: "Item 1 da nota" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importar NFe" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Vencimento da parcela 1")).not.toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each(["tenant change", "unmount"])("ignores a pending old import callback after %s", async mode => {
    const pending = deferred<{ data: string; error: null }>(); mock.rpc.mockReturnValueOnce(pending.promise);
    const view = mount(); await readyExpensePurchase(); fireEvent.click(screen.getByRole("button", { name: "Importar NFe" })); await waitFor(() => expect(mock.rpc).toHaveBeenCalledOnce());
    if (mode === "unmount") view.unmount(); else { mock.tenant = "tenant-b"; mock.user = "operator-b"; view.changeSession(); await screen.findByRole("button", { name: "Selecionar Arquivo XML" }); }
    await act(async () => { pending.resolve({ data: "old-purchase", error: null }); await pending.promise; });
    expect(view.onImported).not.toHaveBeenCalled(); expect(view.onOpenChange).not.toHaveBeenCalled();
    if (mode === "tenant change") expect(screen.queryByRole("article", { name: "Item 1 da nota" })).not.toBeInTheDocument();
  });
});
