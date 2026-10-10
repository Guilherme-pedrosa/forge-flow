import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fila from "@/pages/planejamento/Fila";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), tables: {} as Record<string, Record<string, unknown>[]>, errors: {} as Record<string, { code: string; message: string }>, pages: [] as { table: string; from: number; to: number }[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/components/production/ProductionFileDialog", () => ({ ProductionFileDialog: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  let start = 0, end = 499;
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query, gte: () => query,
    range: (from: number, to: number) => { start = from; end = to; mock.pages.push({ table, from, to }); return query; },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: (mock.tables[table] ?? []).slice(start, end + 1), error: mock.errors[table] ?? null }).then(resolve, reject),
  };
  return query;
} } }));
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Fila /></MemoryRouter></QueryClientProvider>);
}
const job = (id: string, name: string, priority: number, productionId: string) => ({ id, name, priority, code: `JOB-${id}`, status: "queued", printer_id: "printer-1", product_id: null, order_id: null, production_order_id: productionId, due_date: "2026-10-20", est_time_minutes: 60, created_at: "2026-10-09T12:00:00Z", products: null, printers: { name: "P1" } });
beforeEach(() => {
  mock.rpc.mockReset(); mock.pages = []; mock.errors = {};
  mock.tables = {
    printers: [{ id: "printer-1", name: "P1", model: "Modelo", status: "idle", brand: null, bambu_device_id: null }],
    jobs: [job("late", "Placa depois", 1, "production-late"), job("early", "Placa urgente", 10, "production-early")],
    orders: [{ id: "order-late", due_date: "2026-10-20", ship_by_at: "2026-10-10T17:00:00Z", internal_due_at: "2026-10-10T15:00:00Z" }, { id: "order-early", due_date: "2026-10-20", ship_by_at: "2026-10-10T14:00:00Z", internal_due_at: "2026-10-10T10:00:00Z" }],
    production_orders: [{ id: "production-late", source_order_id: "order-late" }, { id: "production-early", source_order_id: "order-early" }],
  };
});
afterEach(cleanup);

describe("prazo na fila", () => {
  it("usa o prazo interno do pedido vinculado pela OP antes da prioridade manual", async () => {
    mount(); const urgent = await screen.findByText("Placa urgente"), later = screen.getByText("Placa depois");
    expect(urgent.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(/Prazo interno/)).toHaveLength(2);
    expect(screen.getByText(/Prazo interno.*10:00/)).toBeInTheDocument();
    expect(screen.getAllByText("Impressão prevista: 60 min")).toHaveLength(2);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("consulta páginas adicionais de pedidos para não perder um prazo fora dos primeiros 1000", async () => {
    const early = mock.tables.orders[1];
    mock.tables.orders = [...Array.from({ length: 1000 }, (_, index) => ({ id: `other-${index}`, due_date: null })), mock.tables.orders[0], early];
    mount(); await screen.findByText("Placa urgente");
    expect(screen.getByText(/Prazo interno.*10:00/)).toBeInTheDocument();
    expect(mock.pages).toContainEqual({ table: "orders", from: 1000, to: 1999 });
  });

  it("mostra tempo desconhecido e bloqueio sem afirmar viabilidade da máquina", async () => {
    mock.tables.printers[0].status = "maintenance"; mock.tables.jobs[0].est_time_minutes = null;
    mount(); await screen.findByText("Placa depois");
    expect(screen.getAllByText("Impressora indisponível")).toHaveLength(2);
    expect(screen.getByText("Tempo de impressão não informado")).toBeInTheDocument();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it("antecipa a placa pelo cutoff do canal mesmo quando a meta interna local permanece depois", async () => {
    mock.tables.marketplace_orders = [{ id: "inbox-late", internal_order_id: "order-late", shipping_deadline_at: "2026-10-10T08:45:00Z", needs_review: true, review_reason: "Prazo do canal antecipado." }];
    mount(); const nowUrgent = await screen.findByText("Placa depois"), later = screen.getByText("Placa urgente");
    expect(nowUrgent.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Prazo interno.*08:45/)).toBeInTheDocument();
    expect(screen.getByText("Revisão do marketplace")).toBeInTheDocument();
    expect(screen.getByText(/Prazo do canal antecipado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conferir pedido" })).toHaveAttribute("href", "/comercial/pedidos?pedido=order-late");
  });

  it("pagina também a inbox e mantém uma meta interna mais cedo que o cutoff", async () => {
    mock.tables.marketplace_orders = [...Array.from({ length: 1000 }, (_, index) => ({ id: `inbox-other-${index}`, internal_order_id: null })), { id: "inbox-late", internal_order_id: "order-late", shipping_deadline_at: "2026-10-10T16:00:00Z", needs_review: false, review_reason: null }];
    mount(); await screen.findByText("Placa depois");
    expect(screen.getByText(/Prazo interno.*15:00/)).toBeInTheDocument();
    expect(mock.pages).toContainEqual({ table: "marketplace_orders", from: 1000, to: 1999 });
  });

  it("aceita inbox ainda sem esquema e não esconde falhas de permissão", async () => {
    mock.errors.marketplace_orders = { code: "PGRST205", message: "table missing" };
    mount(); await screen.findByText("Placa urgente"); cleanup();
    mock.errors.marketplace_orders = { code: "42501", message: "permission denied" };
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  });
});
