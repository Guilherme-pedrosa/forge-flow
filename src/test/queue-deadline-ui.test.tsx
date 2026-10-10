import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fila from "@/pages/planejamento/Fila";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), tables: {} as Record<string, Record<string, unknown>[]>, errors: {} as Record<string, { code: string; message: string }>, pages: [] as { table: string; from: number; to: number }[], filters: [] as { table: string; column: string; value: unknown }[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/components/production/ProductionFileDialog", () => ({ ProductionFileDialog: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: (table: string) => {
  let start = 0, end = 499;
  let statuses: unknown[] | undefined;
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => { mock.filters.push({ table, column, value }); return query; },
    in: (column: string, values: unknown[]) => { if (column === "status") statuses = values; return query; },
    order: () => query, gte: () => query,
    range: (from: number, to: number) => { start = from; end = to; mock.pages.push({ table, from, to }); return query; },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: (mock.tables[table] ?? []).filter(row => !statuses || statuses.includes(row.status)).slice(start, end + 1), error: mock.errors[table] ?? null }).then(resolve, reject),
  };
  return query;
} } }));
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Fila /></MemoryRouter></QueryClientProvider>);
}
const job = (id: string, name: string, priority: number, productionId: string) => ({ id, name, priority, code: `JOB-${id}`, status: "queued", printer_id: "printer-1", product_id: null, order_id: null, production_order_id: productionId, due_date: "2026-10-20", est_time_minutes: 60, created_at: "2026-10-09T12:00:00Z", products: null, printers: { name: "P1" } });
beforeEach(() => {
  mock.rpc.mockReset(); mock.pages = []; mock.errors = {}; mock.filters = [];
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

  it.each(["venda direta", "OP", "venda da OP", "venda da OP com venda direta ativa"].flatMap(origin => ["queued", "reprint"].map(status => ({ origin, status }))))("retira $status nunca iniciado quando $origin está cancelada", async ({ origin, status }) => {
    mock.tables.orders.push({ id: "order-cancelled", status: "cancelled" });
    mock.tables.production_orders.push({ id: "production-cancelled", status: origin === "OP" ? "cancelled" : "planned", source_order_id: origin === "OP" ? "order-late" : "order-cancelled" });
    mock.tables.jobs = [
      { ...job("active", "Reposição ativa sem venda", 5, ""), production_order_id: null },
      { ...job("cancelled", "Placa cancelada sem execução", 1, "production-cancelled"), status, order_id: origin === "venda direta" ? "order-cancelled" : origin === "venda da OP com venda direta ativa" ? "order-late" : null, production_order_id: origin === "venda direta" ? null : "production-cancelled", started_at: null, inventory_posted_at: null },
      { ...job("draft", "Rascunho cancelado", 1, "production-cancelled"), status: "draft", started_at: null, inventory_posted_at: null },
    ];
    mount(); await screen.findByText("Reposição ativa sem venda");
    expect(screen.queryByText("Placa cancelada sem execução")).not.toBeInTheDocument();
    expect(screen.queryByText("Rascunho cancelado")).not.toBeInTheDocument();
    expect(within(screen.getByText("Aguardando").parentElement!).getByText("1")).toBeInTheDocument();
  });

  it("preserva impressão, QC e placas já iniciadas ou apuradas apesar do cancelamento", async () => {
    mock.tables.orders = [{ id: "order-cancelled", status: "cancelled" }];
    mock.tables.production_orders = [{ id: "production-cancelled", status: "cancelled", source_order_id: "order-cancelled" }];
    const base = { ...job("base", "Base", 5, "production-cancelled"), order_id: null, started_at: null, inventory_posted_at: null };
    mock.tables.jobs = [
      { ...base, id: "running", name: "Impressão física continua", status: "printing" },
      { ...base, id: "qc", name: "Inspeção física continua", status: "quality_check" },
      { ...base, id: "started", name: "Placa com início registrado", started_at: "2026-10-10T07:00:00Z" },
      { ...base, id: "posted", name: "Placa com consumo apurado", inventory_posted_at: "2026-10-10T07:30:00Z" },
      { ...base, id: "unstarted", name: "Placa sem execução cancelada" },
      { ...base, id: "background", name: "Reposição independente continua", production_order_id: null },
    ];
    mount(); await screen.findByText("Reposição independente continua");
    for (const name of ["Impressão física continua", "Inspeção física continua", "Placa com início registrado", "Placa com consumo apurado"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText("Placa sem execução cancelada")).not.toBeInTheDocument();
    expect(within(screen.getByText("Aguardando").parentElement!).getByText("3")).toBeInTheDocument();
  });

  it("consulta OP cancelada após a primeira página e mantém os vínculos no tenant", async () => {
    mock.tables.production_orders = [...Array.from({ length: 1000 }, (_, index) => ({ id: `other-production-${index}`, source_order_id: null })), { id: "production-cancelled", status: "cancelled", source_order_id: null }];
    mock.tables.jobs = [{ ...job("active", "Reposição independente", 5, ""), production_order_id: null }, job("cancelled", "Cancelada na segunda página", 1, "production-cancelled")];
    mount(); await screen.findByText("Reposição independente");
    expect(screen.queryByText("Cancelada na segunda página")).not.toBeInTheDocument();
    expect(mock.pages).toContainEqual({ table: "production_orders", from: 1000, to: 1999 });
    for (const table of ["orders", "production_orders"]) expect(mock.filters).toContainEqual({ table, column: "tenant_id", value: "tenant-1" });
  });

  it.each(["orders", "production_orders"])("expõe erro ao conferir cancelamento em %s", async table => {
    mock.errors[table] = { code: "42501", message: `Falha na origem ${table}` };
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(`Falha na origem ${table}`);
    expect(screen.queryByText("Placa urgente")).not.toBeInTheDocument();
  });
});
