import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DRE from "@/pages/financeiro/DRE";
import { localDate } from "@/lib/finance";

const mock = vi.hoisted(() => ({ error: null as { code: string; message: string } | null, components: [] as any[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async () => ({ data: { jobs: [], assembly_cost: 0, component_loss_cost: 0 }, error: null }),
  from: (table: string) => {
    const builder: any = { select: () => builder, eq: () => builder, in: () => builder, gte: () => builder, lte: () => builder, order: () => builder, range: () => builder,
      then: (resolve: any, reject: any) => {
        const day = localDate();
        const rows = table === "accounts_receivable" ? [{ amount: 100, status: "received", competence_date: day }]
          : table === "accounts_payable" ? [{ amount: 15, status: "paid", competence_date: day, chart_of_accounts: { account_type: "expense" } }]
          : table === "marketplace_settlement_components" ? mock.components : [];
        return Promise.resolve({ data: rows, error: table === "marketplace_settlement_components" ? mock.error : null }).then(resolve, reject);
      },
    };
    return builder;
  },
} }));
beforeEach(() => { mock.error = null; mock.components = []; });
afterEach(cleanup);
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><DRE /></MemoryRouter></QueryClientProvider>); }

describe("Ativação e ajustes financeiros de marketplaces na DRE", () => {
  it("mantém a apuração existente com aviso explícito quando a tabela nova ainda não foi publicada", async () => {
    mock.error = { code: "PGRST205", message: "Missing new table" };
    mount();
    expect(await screen.findByText(/Ajustes de repasses ainda não ativados/)).toBeInTheDocument();
    expect(await screen.findByText("RESULTADO GERENCIAL")).toBeInTheDocument();
    expect(screen.queryByText(/resultado está indisponível/)).not.toBeInTheDocument();
  });
  it.each(["42501", "NETWORK_ERROR"])("deixa totais indisponíveis quando a falha é %s, sem tratar como ativação", async code => {
    mock.error = { code, message: "Access/network failure" };
    mount();
    expect(await screen.findByText(/resultado está indisponível/)).toBeInTheDocument();
    expect(screen.queryByText("RESULTADO GERENCIAL")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ajustes de repasses ainda não ativados/)).not.toBeInTheDocument();
  });
  it("mostra o bruto preservado e aplica estorno e crédito de tarifas uma vez ao resultado", async () => {
    mock.components = [{ kind: "refund", amount_signed: -20 }, { kind: "fee_credit", amount_signed: -2 }];
    mount();
    expect(await screen.findByText("RESULTADO GERENCIAL")).toBeInTheDocument();
    const refundLine = screen.getByText("Estornos de vendas nos marketplaces").closest("div.justify-between");
    expect(refundLine?.textContent).toContain("20,00");
    const creditLine = screen.getByText("Créditos de despesas dos marketplaces").closest("div.justify-between");
    expect(creditLine?.textContent).toContain("2,00");
    expect(screen.getByText("Títulos a receber pelo bruto")).toBeInTheDocument();
    expect(screen.getAllByText(/67,00/).length).toBeGreaterThan(0);
  });
});
