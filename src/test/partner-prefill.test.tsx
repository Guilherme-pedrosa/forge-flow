import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerDialog, type Partner, type PartnerInitialValues } from "@/components/comercial/PartnerDialog";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), tenant: "tenant-a", user: "user-a" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: mock.tenant }, user: { id: mock.user } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
const seed: PartnerInitialValues = { name: "Fornecedor da nota", document: "19131243000197", email: "nota@example.test", phone: "1133334444",
  address: { cep: "01311902", street: "Avenida Paulista", number: "37", city: "São Paulo", state: "SP" },
  registration_details: { person_type: "company", trade_name: "Nome da nota", state_registration: "ISENTO" } };
function mount(initialValues: PartnerInitialValues = seed, record?: Partner) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const saved = vi.fn(), close = vi.fn(), busy = vi.fn(), invalidation = vi.spyOn(client, "invalidateQueries");
  const ui = (values = initialValues, open = true) => <QueryClientProvider client={client}><PartnerDialog kind="vendor" open={open} record={record} initialValues={values} onSaved={saved} onClose={close} onBusyChange={busy} /></QueryClientProvider>;
  const view = render(ui()); return { saved, close, busy, invalidation, rerender: (values = initialValues, open = true) => view.rerender(ui(values, open)) };
}
beforeEach(() => { mock.tenant = "tenant-a"; mock.user = "user-a"; mock.rpc.mockReset().mockResolvedValue({ data: "vendor-id", error: null }); mock.toast.mockReset(); });
afterEach(cleanup);
describe("PartnerDialog known-data prefill", () => {
  it("prefills only the new vendor's known invoice data and saves it through the existing partner RPC", async () => {
    const { saved, close, invalidation } = mount();
    expect(screen.getByLabelText("Razão social / nome *")).toHaveValue("Fornecedor da nota");
    expect(screen.getByLabelText("CPF / CNPJ")).toHaveValue(seed.document);
    expect(screen.getByLabelText("E-mail")).toHaveValue("nota@example.test");
    expect(screen.getByLabelText("Logradouro")).toHaveValue("Avenida Paulista");
    expect(screen.getByLabelText("Inscrição estadual / ISENTO")).toHaveValue("ISENTO");
    fireEvent.click(screen.getByRole("button", { name: "Salvar fornecedor" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("vendor-id", "Fornecedor da nota"));
    expect(close).toHaveBeenCalledOnce();
    expect(mock.rpc).toHaveBeenCalledWith("save_partner", expect.objectContaining({ p_kind: "vendor", p_id: null, p_request_id: expect.any(String),
      p_data: expect.objectContaining({ name: seed.name, document: seed.document, email: seed.email, phone: seed.phone, expected_updated_at: null,
        address: expect.objectContaining({ street: "Avenida Paulista", number: "37" }), registration_details: expect.objectContaining({ person_type: "company", trade_name: "Nome da nota", state_registration: "ISENTO" }) }) }));
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["vendors"] });
    expect(JSON.stringify(mock.rpc.mock.calls[0][1])).not.toContain('"_key"');
  });
  it("does not replace typed values when the invoice prefill object changes and reapplies it only after reopening", () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText("Razão social / nome *"), { target: { value: "Nome revisado pelo operador" } });
    const replacement = { ...seed, name: "Outra nota" };
    view.rerender(replacement);
    expect(screen.getByLabelText("Razão social / nome *")).toHaveValue("Nome revisado pelo operador");
    view.rerender(replacement, false); view.rerender(replacement, true);
    expect(screen.getByLabelText("Razão social / nome *")).toHaveValue("Outra nota");
  });
  it("gives an existing partner priority over invoice suggestions", async () => {
    const existing: Partner = { id: "vendor-existing", name: "Fornecedor cadastrado", document: "19131243000197", email: "cadastro@example.test", phone: "1199999999", notes: "Histórico", address: { street: "Rua cadastrada", number: "10" }, is_active: true, updated_at: "2026-11-02T10:00:00Z", registration_details: { person_type: "company", trade_name: "Nome já cadastrado", retained: "metadata" } };
    mount(seed, existing);
    expect(screen.getByLabelText("Razão social / nome *")).toHaveValue("Fornecedor cadastrado");
    expect(screen.getByLabelText("E-mail")).toHaveValue("cadastro@example.test");
    expect(screen.getByLabelText("Logradouro")).toHaveValue("Rua cadastrada");
    fireEvent.click(screen.getByRole("button", { name: "Salvar fornecedor" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("save_partner", expect.objectContaining({ p_id: "vendor-existing", p_data: expect.objectContaining({ name: existing.name, expected_updated_at: existing.updated_at, registration_details: expect.objectContaining({ retained: "metadata" }) }) })));
  });
  it("ignores a late accepted partner response after the tenant changes", async () => {
    let finish!: (value: unknown) => void;
    mock.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Salvar fornecedor" }));
    await waitFor(() => expect(view.busy).toHaveBeenLastCalledWith(true));
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    mock.tenant = "tenant-b"; mock.user = "user-b"; view.rerender();
    await act(async () => { finish({ data: "vendor-a", error: null }); });
    expect(view.saved).not.toHaveBeenCalled(); expect(view.close).not.toHaveBeenCalled(); expect(view.invalidation).not.toHaveBeenCalled();
    expect(mock.toast).not.toHaveBeenCalled();
  });
});
