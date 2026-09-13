import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import FinancialLedger from "@/pages/financeiro/FinancialLedger";

const mock = vi.hoisted(() => ({ updates: [] as any[], rpc: vi.fn(), toast: vi.fn(), conflict: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant", user_id: "user" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: (table: string) => {
    let values: any;
    const builder: any = {
      select: () => builder, eq: () => builder, in: () => builder, order: () => builder, range: () => builder,
      update: (payload: any) => { values = payload; return builder; },
      then: (resolve: any, reject: any) => {
        if (values) { mock.updates.push({ table, values }); return Promise.resolve({ data: mock.conflict ? [] : [{ id: "title" }], error: null }).then(resolve, reject); }
        const rows = table === "accounts_payable" ? [{ id: "title", description: "Serviço contratado", vendor_id: "vendor", vendors: { name: "Fornecedor teste" }, amount: 100, amount_paid: 100, due_date: "2026-09-10", competence_date: "2026-09-01", status: "paid", account_id: "expense", cost_center_id: "center", payment_method_id: "pix", origin_type: "purchase_order", origin_id: "purchase", created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z", notes: "" }]
          : table === "vendors" ? [{ id: "vendor", name: "Fornecedor teste" }]
          : table === "chart_of_accounts" ? [{ id: "expense", code: "4", name: "Serviços" }]
          : table === "cost_centers" ? [{ id: "center", code: "ADM", name: "Administração" }]
          : table === "payment_methods" ? [{ id: "pix", name: "PIX" }] : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
} }));
beforeEach(() => { mock.updates.length = 0; mock.conflict = false; mock.rpc.mockClear(); mock.toast.mockClear(); });
afterEach(cleanup);
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><FinancialLedger kind="payable" /></MemoryRouter></QueryClientProvider>);

describe("Classificação de compras com baixa", () => {
  it("permite classificar um título pago sem alterar valor, fornecedor, vencimento ou status", async () => {
    mount();
    fireEvent.click((await screen.findAllByRole("button", { name: "Classificar" }))[0]);
    expect(screen.getByLabelText("Descrição *")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Valor (R$) *")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Vencimento *")).toHaveAttribute("readonly");
    expect(screen.getByRole("combobox", { name: "Fornecedor" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Competência *"), { target: { value: "2026-09-02" } });
    fireEvent.change(screen.getByLabelText("Observações"), { target: { value: "Classificado como serviço" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar classificação" }));
    await waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]).toEqual({ table: "accounts_payable", values: { account_id: "expense", cost_center_id: "center", competence_date: "2026-09-02", notes: "Classificado como serviço" } });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("mantém formulário aberto quando a versão do título já mudou", async () => {
    mock.conflict = true;
    mount();
    fireEvent.click((await screen.findAllByRole("button", { name: "Classificar" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar classificação" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: expect.stringContaining("O título mudou") })));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
