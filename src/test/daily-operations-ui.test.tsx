import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Hoje from "@/pages/Hoje";

const mock = vi.hoisted(() => ({
  from: vi.fn(), tenant: "tenant-1" as string | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  errors: {} as Record<string, string | { message: string; code?: string } | null>,
  requests: [] as { table: string; columns?: string; filters: [string, unknown][]; excluded: { column: string; operator: string; value: unknown }[]; from: number; to: number }[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: mock.tenant ? { tenant_id: mock.tenant } : null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));

const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })}><MemoryRouter><Hoje /></MemoryRouter></QueryClientProvider>);

beforeEach(() => {
  mock.tenant = "tenant-1"; mock.requests = []; mock.errors = {}; mock.tables = { orders: [], jobs: [], printers: [], inventory_items: [] }; mock.from.mockReset();
  mock.from.mockImplementation((table: string) => {
    let columns: string | undefined;
    const filters: [string, unknown][] = [];
    const excluded: { column: string; operator: string; value: unknown }[] = [];
    const builder = {
      select: (value: string) => { columns = value; return builder; },
      eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
      not: (column: string, operator: string, value: unknown) => { excluded.push({ column, operator, value }); return builder; },
      order: () => builder,
      range: (from: number, to: number) => {
        mock.requests.push({ table, columns, filters: [...filters], excluded: [...excluded], from, to });
        const error = mock.errors[table];
        const rows = (mock.tables[table] ?? []).filter(row => excluded.every(filter => filter.operator === "in" ? !String(filter.value).replace(/^\(|\)$/g, "").split(",").includes(String(row[filter.column])) : filter.operator === "is" && filter.value === null ? row[filter.column] != null : true));
        return Promise.resolve({ data: error ? null : rows.slice(from, to + 1), error: typeof error === "string" ? { message: error } : error ?? null });
      },
    };
    return builder;
  });
});
afterEach(cleanup);

describe("página Hoje", () => {
  it("abre o próximo passo do pedido e expõe os dados desconhecidos sem exigir novos campos", async () => {
    mock.tables.orders = [{ id: "pedido-1", code: "PED-001", status: "ready", due_date: "2026-10-12" }];
    mock.tables.printers = [{ id: "p1", name: "Impressora 1", model: "A1", status: "idle" }];
    mock.tables.inventory_items = [{ id: "m1", name: "PLA azul", unit: "kg", current_stock: 0.5, min_stock: 1 }];
    mount();
    const next = await screen.findByRole("link", { name: /PED-001.*Embalar e postar/ });
    expect(next).toHaveAttribute("href", "/comercial/pedidos?pedido=pedido-1");
    expect(screen.getByText("Entrega: 12/10/2026")).toBeInTheDocument();
    expect(screen.getByText("Postagem: horário não informado")).toBeInTheDocument();
    expect(screen.getByText("Conferência operacional ainda não registrada.")).toBeInTheDocument();
    expect(screen.getByText("Ociosa no cadastro")).toBeInTheDocument();
    expect(screen.getByText("Liberação da mesa: a conferir")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conferir bobinas" })).toHaveAttribute("href", "/estoque/bobinas");
    expect(screen.getByRole("link", { name: /Planejar reposição/ })).toHaveAttribute("href", "/estoque/reposicao");
    expect(screen.getByRole("heading", { name: "Simular conclusão dos pedidos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Simular prazo" })).toHaveAttribute("href", "/planejamento/capacidade");
    expect(mock.requests.find(request => request.table === "orders")?.columns).toBe("*");
    for (const request of mock.requests) expect(request.filters).toContainEqual(["tenant_id", "tenant-1"]);
  });

  it("consulta mais de uma página real em cada tabela e conserva todos os indicadores", async () => {
    mock.tables.orders = Array.from({ length: 501 }, (_, index) => ({ id: `o${index}`, code: `PED-${index}`, status: "draft" }));
    mock.tables.jobs = Array.from({ length: 1001 }, (_, index) => ({ id: `j${index}`, status: "printing" }));
    mock.tables.marketplace_orders = Array.from({ length: 501 }, (_, index) => ({ id: `m${index}`, internal_order_id: `sem-vinculo-${index}`, shipping_deadline_at: null, needs_review: false, review_reason: null }));
    mount();
    await screen.findByRole("link", { name: /Pedidos ativos 501/ });
    expect(screen.getByRole("link", { name: "Imprimindo 1001" })).toBeInTheDocument();
    expect(mock.requests.filter(request => request.table === "orders").map(request => [request.from, request.to])).toEqual([[0, 499], [500, 999]]);
    expect(mock.requests.filter(request => request.table === "jobs").map(request => [request.from, request.to])).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(mock.requests.filter(request => request.table === "marketplace_orders").map(request => [request.from, request.to])).toEqual([[0, 499], [500, 999]]);
    fireEvent.click(screen.getByRole("button", { name: /Mostrar mais pedidos/ }));
    expect(screen.getByRole("button", { name: "Mostrar mais pedidos (477 restantes)" })).toBeInTheDocument();
  });

  it("mostra prazo atualizado do canal e os acessos de revisão sem usar a data antiga da venda", async () => {
    const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
    const oldPosting = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    const oldInternal = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    mock.tables.orders = [{ id: "pedido-1", code: "PED-ML", status: "in_production", ship_by_at: oldPosting, internal_due_at: oldInternal, workflow_checked_at: new Date().toISOString() }];
    mock.tables.marketplace_orders = [{ id: "ml1", internal_order_id: "pedido-1", shipping_deadline_at: cutoff, needs_review: true, review_reason: "O canal antecipou o despacho para antes da meta interna." }];
    mount();
    expect(await screen.findByRole("link", { name: /PED-ML.*Replanejar pedido/ })).toHaveAttribute("href", "/comercial/pedidos?pedido=pedido-1");
    const cutoffLabel = new Date(cutoff).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    expect(screen.getByText(`Postar até ${cutoffLabel} · prazo do canal`)).toBeInTheDocument();
    expect(screen.getByText(/Meta interna:.*ajustar para antes da postagem/)).toBeInTheDocument();
    expect(screen.getByText("Revisão do marketplace pendente")).toBeInTheDocument();
    expect(screen.getByText("O canal antecipou o despacho para antes da meta interna.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar no marketplace" })).toHaveAttribute("href", "/comercial/marketplaces");
    expect(screen.getByRole("link", { name: /Prazos vencidos 1/ })).toBeInTheDocument();
    expect(screen.getByText("Conferência operacional precisa ser refeita após a alteração do canal.")).toBeInTheDocument();
    expect(mock.requests.find(request => request.table === "marketplace_orders")?.filters).toContainEqual(["tenant_id", "tenant-1"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("consulta pedidos locais quando a inbox ainda não existe", async () => {
    mock.tables.orders = [{ id: "local", code: "PED-LOCAL", status: "draft" }];
    mock.errors.marketplace_orders = { code: "42P01", message: "Tabela ainda não publicada" };
    mount();
    await screen.findByRole("link", { name: /PED-LOCAL.*Confirmar e organizar/ });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("não ignora permissão ou rede indisponível na consulta do prazo canônico", async () => {
    mock.errors.marketplace_orders = { code: "42501", message: "Consulta dos canais não autorizada" };
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Consulta dos canais não autorizada");
    expect(screen.queryByRole("link", { name: /Pedidos ativos/ })).not.toBeInTheDocument();
  });

  it("mostra falha e permite repetir a consulta completa sem indicadores fictícios", async () => {
    mock.errors.jobs = "Conexão indisponível";
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Conexão indisponível");
    expect(screen.queryByRole("link", { name: /Pedidos ativos/ })).not.toBeInTheDocument();
    mock.errors.jobs = null;
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await screen.findByText("Nenhum pedido ativo");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Nenhuma impressora cadastrada")).toBeInTheDocument();
    expect(screen.getByText("Nenhum material cadastrado")).toBeInTheDocument();
  });

  it("identifica consulta antiga quando uma atualização falha", async () => {
    mount(); await screen.findByText("Nenhum pedido ativo");
    mock.errors.inventory_items = "Falha no estoque";
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Os dados abaixo são da última consulta concluída."));
    expect(screen.getByRole("link", { name: /Pedidos ativos 0/ })).toBeInTheDocument();
  });

  it("aguarda a empresa antes de consultar qualquer tabela", () => {
    mock.tenant = null; mount();
    expect(screen.getByRole("status")).toHaveTextContent("Aguardando a identificação da empresa");
    expect(mock.from).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeDisabled();
  });

  it.each(["venda direta", "OP", "venda da OP", "venda da OP com venda direta ativa"].flatMap(origin => ["queued", "draft", "reprint"].map(status => ({ origin, status }))))("não conta $status nunca iniciado de $origin cancelada", async ({ origin, status }) => {
    mock.tables.orders = [{ id: "active-order", code: "PED-ATIVO", status: "draft" }, { id: "cancelled-order", code: "PED-CANCELADO", status: "cancelled" }];
    mock.tables.production_orders = [{ id: "cancelled-production", status: origin === "OP" ? "cancelled" : "planned", source_order_id: origin === "OP" ? "active-order" : "cancelled-order" }];
    mock.tables.jobs = [
      { id: "background", status: "queued", order_id: null, production_order_id: null, started_at: null, inventory_posted_at: null },
      { id: "cancelled-job", status, order_id: origin === "venda direta" ? "cancelled-order" : origin === "venda da OP com venda direta ativa" ? "active-order" : null, production_order_id: origin === "venda direta" ? null : "cancelled-production", started_at: null, inventory_posted_at: null },
    ];
    mount(); await screen.findByRole("link", { name: /PED-ATIVO.*Confirmar e organizar/ });
    expect(screen.getByRole("link", { name: "Na fila / reimpressão 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rascunhos 0" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /PED-CANCELADO/ })).not.toBeInTheDocument();
  });

  it("continua contando impressão, QC e fila com início ou consumo apurado após cancelamento", async () => {
    mock.tables.orders = [{ id: "cancelled-order", code: "PED-CANCELADO", status: "cancelled" }];
    mock.tables.production_orders = [{ id: "cancelled-production", source_order_id: "cancelled-order", status: "cancelled" }];
    const base = { order_id: null, production_order_id: "cancelled-production", started_at: null, inventory_posted_at: null };
    mock.tables.jobs = [
      { ...base, id: "running", status: "printing" },
      { ...base, id: "qc", status: "quality_check" },
      { ...base, id: "started", status: "queued", started_at: "2026-10-10T07:00:00Z" },
      { ...base, id: "posted", status: "queued", inventory_posted_at: "2026-10-10T07:30:00Z" },
      { ...base, id: "unstarted", status: "queued" },
      { ...base, id: "background", status: "queued", production_order_id: null },
    ];
    mount(); await screen.findByText("Nenhum pedido ativo");
    expect(screen.getByRole("link", { name: "Na fila / reimpressão 3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Imprimindo 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acabamento / inspeção 1" })).toBeInTheDocument();
  });

  it("pagina vínculos de OP e lê os campos físicos sem excluir vendas canceladas na consulta", async () => {
    mock.tables.orders = [{ id: "cancelled-order", code: "PED-CANCELADO", status: "cancelled" }];
    mock.tables.production_orders = [...Array.from({ length: 500 }, (_, index) => ({ id: `other-production-${index}`, source_order_id: null, status: "planned" })), { id: "cancelled-production", source_order_id: "cancelled-order", status: "planned" }];
    mock.tables.jobs = [{ id: "unstarted", status: "queued", order_id: null, production_order_id: "cancelled-production", started_at: null, inventory_posted_at: null }];
    mount(); await screen.findByText("Nenhum pedido ativo");
    expect(screen.getByRole("link", { name: "Na fila / reimpressão 0" })).toBeInTheDocument();
    const productionRequests = mock.requests.filter(request => request.table === "production_orders");
    expect(productionRequests.map(request => [request.from, request.to])).toEqual([[0, 499], [500, 999]]);
    for (const request of productionRequests) expect(request.filters).toContainEqual(["tenant_id", "tenant-1"]);
    const jobColumns = mock.requests.find(request => request.table === "jobs")?.columns?.split(",").map(column => column.trim());
    for (const field of ["order_id", "production_order_id", "started_at", "inventory_posted_at"]) expect(jobColumns).toContain(field);
    expect(mock.requests.find(request => request.table === "orders")?.excluded.some(filter => filter.column === "status" && String(filter.value).includes("cancelled"))).toBe(false);
  });

  it.each(["orders", "production_orders"])("mantém visível falha na leitura de origem %s", async table => {
    mock.errors[table] = { code: "42501", message: `Origem indisponível: ${table}` };
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(`Origem indisponível: ${table}`);
    expect(screen.queryByRole("link", { name: /Na fila \/ reimpressão/ })).not.toBeInTheDocument();
  });
});
