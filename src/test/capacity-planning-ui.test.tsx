import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Capacidade from "@/pages/planejamento/Capacidade";

const mock = vi.hoisted(() => ({ rows: vi.fn(), tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/lib/assembly", () => ({ assemblyRows: mock.rows }));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Capacidade /></MemoryRouter></QueryClientProvider>);
  return client;
}
async function load() { await screen.findByText("PED-1 · 1 ordem(ns) vinculada(s)"); await waitFor(() => expect(screen.getByRole("button", { name: "Simular prazo" })).toBeEnabled()); }
function simulate() { fireEvent.click(screen.getByRole("button", { name: "Simular prazo" })); return screen.getByRole("region", { name: "Resultado da simulação" }); }
function enterConfirmedInputs({ bed = true, manifest = true }: { bed?: boolean; manifest?: boolean } = {}) {
  fireEvent.click(screen.getByRole("button", { name: "Adicionar turno" }));
  fireEvent.change(screen.getByLabelText("Início do turno 1"), { target: { value: "2026-10-10T08:00" } });
  fireEvent.change(screen.getByLabelText("Fim do turno 1"), { target: { value: "2026-10-10T18:00" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Confirmo estes horários de um operador para a simulação" }));
  for (const label of ["Preparação por placa (min)", "Retirada e liberação por placa (min)", "Acabamento por pedido (min)", "Montagem por pedido (min)", "Embalagem por pedido (min)"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "5" } });
  if (bed) fireEvent.click(screen.getByRole("checkbox", { name: "Mesa livre, preparada e disponível agora: P1" }));
  if (manifest) fireEvent.click(screen.getByRole("checkbox", { name: "Todas as placas e peças de PED-1 estão representadas" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Conferi a compatibilidade de JOB-1 com P1" }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-10T08:00:00Z"));
  mock.tables = {
    orders: [{ id: "order-1", code: "PED-1", status: "in_production", due_date: "2026-10-10", ship_by_at: "2026-10-10T17:00:00Z", internal_due_at: "2026-10-10T15:00:00Z" }],
    jobs: [{ id: "job-1", code: "JOB-1", name: "Base", status: "queued", order_id: null, production_order_id: "production-1", printer_id: "printer-1", due_date: "2026-10-10", est_time_minutes: 60, priority: 5, created_at: "2026-10-09T12:00:00Z", reprint_of: null }],
    printers: [{ id: "printer-1", name: "P1", status: "idle" }],
    production_orders: [{ id: "production-1", source_order_id: "order-1" }],
  };
  mock.rows.mockReset().mockImplementation((table: string) => Promise.resolve(mock.tables[table] ?? []));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("simulação de prazo da farm", () => {
  it("liga as placas ao pedido pela ordem de produção e mantém pendências sem fabricar um horário", async () => {
    mount(); await load();
    expect(screen.getByLabelText("Preparação por placa (min)")).toHaveValue("");
    expect(screen.queryByLabelText("Início do turno 1")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Mesa livre, preparada e disponível agora: P1" })).not.toBeChecked();
    const result = simulate();
    expect(within(result).getByText("Dados a conferir")).toBeInTheDocument();
    expect(within(result).getByText(/não calculável com os dados atuais/)).toBeInTheDocument();
    expect(within(result).getByText("Confirme todas as placas e peças necessárias ao pedido.")).toBeInTheDocument();
    expect(within(result).queryByText("Estimativa dentro do prazo")).not.toBeInTheDocument();
    expect(mock.rows.mock.calls.map(call => call[0])).toEqual(["orders", "jobs", "printers", "production_orders", "marketplace_orders"]);
    expect(mock.rows.mock.calls.every(call => call[2].tenant_id === "tenant-1")).toBe(true);
  });

  it("estima a conclusão somente depois de confirmar tempos, atendimento, mesa, compatibilidade e cobertura", async () => {
    mount(); await load(); enterConfirmedInputs();
    const result = simulate();
    expect(within(result).getByText("Estimativa dentro do prazo")).toBeInTheDocument();
    expect(within(result).getByText(/Conclusão estimada:/)).toHaveTextContent("09:25");
    expect(within(result).getByRole("link", { name: "Conferir pedido PED-1" })).toHaveAttribute("href", "/comercial/pedidos?pedido=order-1");
    expect(within(result).queryByText(/não confirma que o pedido cabe/)).not.toBeInTheDocument();
  });

  it("retira o resultado ao editar dados e exige novamente a confirmação que foi removida", async () => {
    mount(); await load(); enterConfirmedInputs(); simulate();
    fireEvent.click(screen.getByRole("checkbox", { name: "Todas as placas e peças de PED-1 estão representadas" }));
    expect(screen.queryByRole("region", { name: "Resultado da simulação" })).not.toBeInTheDocument();
    expect(within(simulate()).getByText("Dados a conferir")).toBeInTheDocument();
    expect(screen.getByText("Confirme todas as placas e peças necessárias ao pedido.")).toBeInTheDocument();
  });

  it("não libera impressora em manutenção por meio de confirmação local", async () => {
    mock.tables.printers[0].status = "maintenance";
    mount(); await load(); enterConfirmedInputs({ bed: false });
    expect(screen.queryByRole("checkbox", { name: /Mesa livre/ })).not.toBeInTheDocument();
    const result = simulate();
    expect(within(result).getByText("Bloqueado")).toBeInTheDocument();
    expect(within(result).getByText("Retire o bloqueio ou atribua outra impressora disponível.")).toBeInTheDocument();
    expect(within(result).getByText(/não calculável com os dados atuais/)).toBeInTheDocument();
  });

  it("mantém o horário de postagem pendente quando só há uma data no cadastro", async () => {
    delete mock.tables.orders[0].ship_by_at;
    mount(); await load(); enterConfirmedInputs();
    const result = simulate();
    expect(within(result).getByText("Dados a conferir")).toBeInTheDocument();
    expect(within(result).getByText("Informe o horário limite de postagem e o fuso.")).toBeInTheDocument();
    expect(within(result).getByText(/Conclusão parcial estimada:/)).toBeInTheDocument();
  });

  it("usa o dia anterior à entrega manual como meta de produção sem fabricar cutoff ou folga", async () => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-10-12", ship_by_at: null, internal_due_at: null, marketplace_order_id: null });
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText("Postar até: horário não informado · Meta de produção (data): 11/10/2026 · 1 dia antes da entrega · Entrega: 12/10/2026 (data comercial)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir pedido PED-1" })).toHaveAttribute("href", "/comercial/pedidos?pedido=order-1");
    const result = simulate();
    expect(within(result).getByText("Dados a conferir")).toBeInTheDocument();
    expect(within(result).getByText("Informe o horário limite de postagem e o fuso.")).toBeInTheDocument();
    expect(within(result).getByText("Confira o horário do prazo interno.")).toBeInTheDocument();
    expect(within(result).getByText(/Conclusão parcial estimada:/)).toHaveTextContent("09:25");
    expect(within(result).queryByText(/Folga até a postagem/)).not.toBeInTheDocument();
    expect(within(result).queryByText("Estimativa dentro do prazo")).not.toBeInTheDocument();
  });

  it("ordena placas ligadas pela OP usando a meta do dia 11 mesmo com entrega comercial no dia 12", async () => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-10-12", ship_by_at: null, internal_due_at: null, marketplace_order_id: null });
    mock.tables.orders.push({ id: "order-2", code: "PED-2", status: "in_production", due_date: "2026-10-11", ship_by_at: "2026-10-11T12:00:00Z", internal_due_at: null, marketplace_order_id: null });
    mock.tables.production_orders.push({ id: "production-2", source_order_id: "order-2" });
    mock.tables.jobs.unshift({ ...mock.tables.jobs[0], id: "job-2", code: "JOB-2", production_order_id: "production-2", due_date: "2026-10-11", priority: 1 });
    mount(); await load();
    expect(screen.getAllByLabelText(/^Tempo de impressão de JOB-/).map(input => input.getAttribute("id"))).toEqual(["job-time-job-1", "job-time-job-2"]);
    enterConfirmedInputs();
    fireEvent.click(screen.getByRole("checkbox", { name: "Todas as placas e peças de PED-2 estão representadas" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Conferi a compatibilidade de JOB-2 com P1" }));
    const result = simulate();
    const manualOrder = within(result).getByRole("heading", { name: "PED-1 Dados a conferir" }).parentElement!.parentElement!;
    expect(within(manualOrder).getByText(/Conclusão parcial estimada:/)).toHaveTextContent("09:30");
    expect(within(manualOrder).queryByText(/Folga até a postagem/)).not.toBeInTheDocument();
  });

  it.each([undefined, "marketplace-1"])("não infere meta pela entrega para origem %s sem prova de pedido manual", async marketplaceOrderId => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-10-12", ship_by_at: null, internal_due_at: null, marketplace_order_id: marketplaceOrderId });
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText("Postar até: horário não informado · Prazo interno: não informado · Entrega: 12/10/2026 (data comercial)")).toBeInTheDocument();
    expect(screen.queryByText(/Meta de produção \(data\)/)).not.toBeInTheDocument();
    const result = simulate();
    expect(within(result).getByText("Dados a conferir")).toBeInTheDocument();
    expect(within(result).queryByText("Confira o horário do prazo interno.")).not.toBeInTheDocument();
    expect(within(result).queryByText(/Folga até a postagem/)).not.toBeInTheDocument();
  });

  it("preserva a meta explícita de produção em vez de antecipar novamente a entrega manual", async () => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-10-12", ship_by_at: null, internal_due_at: "2026-10-10T15:00:00Z", marketplace_order_id: null });
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText(/Postar até: horário não informado · Prazo interno:.*10\/10\/2026.*15:00.*Entrega: 12\/10\/2026 \(data comercial\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Meta de produção \(data\)/)).not.toBeInTheDocument();
    expect(within(simulate()).queryByText("Confira o horário do prazo interno.")).not.toBeInTheDocument();
  });

  it("preserva o cutoff explícito de postagem sem inferir meta pela entrega manual", async () => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-10-12", internal_due_at: null, marketplace_order_id: null });
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText(/Postar até:.*10\/10\/2026.*17:00.*Prazo interno: não informado.*Entrega: 12\/10\/2026 \(data comercial\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Meta de produção \(data\)/)).not.toBeInTheDocument();
    expect(within(simulate()).getByText("Estimativa dentro do prazo")).toBeInTheDocument();
  });

  it("não mantém meta inferida ativa quando o pedido já está pronto", async () => {
    Object.assign(mock.tables.orders[0], { status: "ready", due_date: "2026-10-12", ship_by_at: null, internal_due_at: null, marketplace_order_id: null });
    mock.tables.jobs[0].status = "completed";
    mount(); await load();
    expect(screen.getByText("Postar até: horário não informado · Prazo interno: não informado · Entrega: 12/10/2026 (data comercial)")).toBeInTheDocument();
    expect(screen.queryByText(/Meta de produção \(data\)/)).not.toBeInTheDocument();
    expect(within(simulate()).queryByText("Confira o horário do prazo interno.")).not.toBeInTheDocument();
  });

  it.each(["shipped", "delivered", "cancelled"])("não prioriza trabalho físico de pedido %s por uma meta de produção inferida já encerrada", async status => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-10-11", ship_by_at: "2026-10-11T12:00:00Z", internal_due_at: null });
    mock.tables.orders.push({ id: "closed-order", code: "PED-ENCERRADO", status, due_date: "2026-10-12", ship_by_at: null, internal_due_at: null, marketplace_order_id: null });
    mock.tables.production_orders.push({ id: "closed-production", source_order_id: "closed-order", status: "planned" });
    mock.tables.jobs.unshift({ ...mock.tables.jobs[0], id: "closed-job", code: "JOB-ENCERRADO", production_order_id: "closed-production", due_date: "2026-10-12", priority: 1, started_at: "2026-10-09T12:00:00Z" });
    mount(); await load();
    expect(screen.getAllByLabelText(/^Tempo de impressão de JOB-/).map(input => input.getAttribute("id"))).toEqual(["job-time-job-1", "job-time-closed-job"]);
    expect(screen.queryByRole("link", { name: "Abrir pedido PED-ENCERRADO" })).not.toBeInTheDocument();
  });

  it("mantém uma entrega impossível a conferir sem normalizar para outro dia", async () => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-02-30", ship_by_at: null, internal_due_at: null, marketplace_order_id: null });
    mount(); await load();
    expect(screen.getByText("Postar até: horário não informado · Prazo interno: não informado · Entrega: data a conferir (data comercial)")).toBeInTheDocument();
    expect(screen.queryByText(/Meta de produção \(data\)/)).not.toBeInTheDocument();
  });

  it("não troca o tempo restante observado pelo tempo total cadastrado", async () => {
    mock.tables.jobs[0].status = "printing"; mock.tables.printers[0].status = "printing";
    mount(); await load(); enterConfirmedInputs({ bed: false });
    expect(screen.getByLabelText("Tempo restante de JOB-1 (min)")).toHaveValue("");
    expect(within(simulate()).getByText("Confira o tempo restante da impressão.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tempo restante de JOB-1 (min)"), { target: { value: "30" } });
    expect(within(simulate()).getByText("Estimativa dentro do prazo")).toBeInTheDocument();
  });

  it("dados novos invalidam a cobertura e as confirmações físicas anteriores", async () => {
    const client = mount(); await load(); enterConfirmedInputs(); simulate();
    mock.tables.jobs = [{ ...mock.tables.jobs[0], est_time_minutes: 90 }];
    await client.invalidateQueries({ queryKey: ["capacity_data"] });
    await waitFor(() => expect(screen.getByLabelText("Tempo de impressão de JOB-1 (min)")).toHaveValue("90"));
    expect(screen.queryByRole("region", { name: "Resultado da simulação" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Todas as placas e peças de PED-1 estão representadas" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Conferi a compatibilidade de JOB-1 com P1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mesa livre, preparada e disponível agora: P1" })).not.toBeChecked();
  });

  it("aceita mais de um turno datado e valida o fim antes de calcular", async () => {
    mount(); await load(); enterConfirmedInputs();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar turno" }));
    fireEvent.change(screen.getByLabelText("Início do turno 2"), { target: { value: "2026-10-11T10:00" } });
    fireEvent.change(screen.getByLabelText("Fim do turno 2"), { target: { value: "2026-10-11T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Simular prazo" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Turno 2: o fim precisa ser depois do início.");
    expect(screen.queryByRole("region", { name: "Resultado da simulação" })).not.toBeInTheDocument();
  });

  it("não permite declarar cobertura vazia de um pedido que ainda depende de produção", async () => {
    mock.tables.jobs = []; mount();
    await screen.findByText("PED-1 · 0 ordem(ns) vinculada(s)");
    expect(screen.getByRole("checkbox", { name: "Conferi todos os itens de PED-1: estão disponíveis e dispensam impressão" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Simular prazo" })).toBeEnabled());
    expect(within(simulate()).getByText("Dados a conferir")).toBeInTheDocument();
  });

  it("representa a reimpressão de uma falha sem exigir que o histórico falho volte a imprimir", async () => {
    mock.tables.jobs = [{ ...mock.tables.jobs[0], id: "failed-attempt", code: "JOB-FALHOU", status: "failed" }, { ...mock.tables.jobs[0], reprint_of: "failed-attempt" }];
    mount(); await load();
    expect(screen.queryByText(/JOB-FALHOU/)).not.toBeInTheDocument();
    enterConfirmedInputs(); expect(within(simulate()).getByText("Estimativa dentro do prazo")).toBeInTheDocument();
  });

  it("usa o cutoff canônico anterior à meta local e não confirma prazo enquanto a venda pede revisão", async () => {
    mock.tables.marketplace_orders = [{ id: "inbox-1", internal_order_id: "order-1", shipping_deadline_at: "2026-10-10T10:45:00Z", needs_review: true, review_reason: "Prazo de postagem antecipado no Mercado Livre." }];
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText(/Postar até:.*10:45.*Prazo interno:.*10:45/)).toBeInTheDocument();
    const result = simulate();
    expect(within(result).getByText("Dados a conferir")).toBeInTheDocument();
    expect(within(result).queryByText("Estimativa dentro do prazo")).not.toBeInTheDocument();
    expect(within(result).getByText(/Prazo de postagem antecipado/)).toBeInTheDocument();
    expect(within(result).getByRole("link", { name: "Conferir marketplace" })).toHaveAttribute("href", "/integracoes/marketplaces");
    expect(within(result).getByRole("link", { name: "Conferir pedido PED-1" })).toHaveAttribute("href", "/comercial/pedidos?pedido=order-1");
  });

  it("sem revisão pendente, calcula atraso pelo cutoff atual e preserva uma meta interna mais cedo", async () => {
    mock.tables.orders[0].internal_due_at = "2026-10-10T08:30:00Z";
    mock.tables.marketplace_orders = [{ id: "inbox-1", internal_order_id: "order-1", shipping_deadline_at: "2026-10-10T08:45:00Z", needs_review: false, review_reason: null }];
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText(/Postar até:.*08:45.*Prazo interno:.*08:30/)).toBeInTheDocument();
    expect(within(simulate()).getByText("Conclusão após o prazo")).toBeInTheDocument();
  });

  it("não recupera o prazo antigo da venda quando o canal atual está sem cutoff", async () => {
    mock.tables.marketplace_orders = [{ id: "inbox-1", internal_order_id: "order-1", shipping_deadline_at: null, needs_review: true, review_reason: "SLA atual ainda não informado." }];
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText("Postar até: horário não informado · Prazo interno: não informado · Entrega: 10/10/2026 (data comercial)")).toBeInTheDocument();
    expect(within(simulate()).getByText("Informe o horário limite de postagem e o fuso.")).toBeInTheDocument();
  });

  it("bloqueia a meta inferida de entrega quando existe inbox vinculada sem cutoff", async () => {
    Object.assign(mock.tables.orders[0], { due_date: "2026-10-12", ship_by_at: null, internal_due_at: null, marketplace_order_id: null });
    mock.tables.marketplace_orders = [{ id: "inbox-1", internal_order_id: "order-1", shipping_deadline_at: null, needs_review: false, review_reason: null }];
    mount(); await load(); enterConfirmedInputs();
    expect(screen.getByText("Postar até: horário não informado · Prazo interno: não informado · Entrega: 12/10/2026 (data comercial)")).toBeInTheDocument();
    expect(screen.queryByText(/Meta de produção \(data\)/)).not.toBeInTheDocument();
    const result = simulate();
    expect(within(result).getByText("Dados a conferir")).toBeInTheDocument();
    expect(within(result).getByText("Informe o horário limite de postagem e o fuso.")).toBeInTheDocument();
    expect(within(result).queryByText("Confira o horário do prazo interno.")).not.toBeInTheDocument();
    expect(within(result).queryByText(/Folga até a postagem/)).not.toBeInTheDocument();
  });

  it("ignora somente a ausência de esquema da inbox e apresenta outros erros de leitura", async () => {
    mock.rows.mockImplementation((table: string) => table === "marketplace_orders" ? Promise.reject({ code: "42P01", message: "table missing" }) : Promise.resolve(mock.tables[table] ?? []));
    const client = mount(); await load(); enterConfirmedInputs();
    expect(within(simulate()).getByText("Estimativa dentro do prazo")).toBeInTheDocument();
    mock.rows.mockImplementation((table: string) => table === "marketplace_orders" ? Promise.reject({ code: "42501", message: "permission denied" }) : Promise.resolve(mock.tables[table] ?? []));
    await client.invalidateQueries({ queryKey: ["capacity_data"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
    expect(screen.getByRole("button", { name: "Simular prazo" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Resultado da simulação" })).not.toBeInTheDocument();
  });

  it.each(["venda direta", "OP", "venda da OP", "venda da OP com venda direta ativa"].flatMap(origin => ["queued", "draft", "reprint"].map(status => ({ origin, status }))))("exclui $status nunca iniciado de $origin cancelada da cobertura e da capacidade", async ({ origin, status }) => {
    mock.tables.orders.push({ id: "cancelled-order", code: "PED-CANCELADO", status: "cancelled" });
    mock.tables.production_orders.push({ id: "cancelled-production", status: origin === "OP" ? "cancelled" : "planned", source_order_id: origin === "OP" ? "order-1" : "cancelled-order" });
    mock.tables.jobs.push({ ...mock.tables.jobs[0], id: "cancelled-job", code: "JOB-CANCELLED", name: "Cancelada", status, order_id: origin === "venda direta" ? "cancelled-order" : origin === "venda da OP com venda direta ativa" ? "order-1" : null, production_order_id: origin === "venda direta" ? null : "cancelled-production", started_at: null, inventory_posted_at: null });
    mount(); await screen.findByLabelText("Tempo de impressão de JOB-1 (min)");
    expect(screen.queryByLabelText("Tempo de impressão de JOB-CANCELLED (min)")).not.toBeInTheDocument();
    expect(screen.getByText("PED-1 · 1 ordem(ns) vinculada(s)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Abrir pedido PED-CANCELADO" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Simular prazo" })).toBeEnabled());
    enterConfirmedInputs();
    const result = simulate();
    expect(within(result).getByText("Estimativa dentro do prazo")).toBeInTheDocument();
    expect(within(result).getByText(/Conclusão estimada:/)).toHaveTextContent("09:25");
  });

  it("preserva trabalho físico de origem cancelada e a fila independente que disputa a farm", async () => {
    mock.tables.orders.push({ id: "cancelled-order", code: "PED-CANCELADO", status: "cancelled" });
    mock.tables.production_orders.push({ id: "cancelled-production", source_order_id: "cancelled-order", status: "cancelled" });
    const base = { ...mock.tables.jobs[0], order_id: null, production_order_id: "cancelled-production", started_at: null, inventory_posted_at: null };
    mock.tables.jobs.push(
      { ...base, id: "running", code: "JOB-RUNNING", name: "Impressão física", status: "printing" },
      { ...base, id: "qc", code: "JOB-QC", name: "Inspeção física", status: "quality_check" },
      { ...base, id: "started", code: "JOB-STARTED", name: "Início registrado", started_at: "2026-10-10T07:00:00Z" },
      { ...base, id: "posted", code: "JOB-POSTED", name: "Consumo apurado", inventory_posted_at: "2026-10-10T07:30:00Z" },
      { ...base, id: "unstarted", code: "JOB-CANCELLED", name: "Sem execução" },
      { ...base, id: "background", code: "JOB-BACKGROUND", name: "Reposição independente", production_order_id: null },
    );
    mount(); await load();
    expect(screen.getByLabelText("Tempo restante de JOB-RUNNING (min)")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Conferi e liberei as peças de JOB-QC para as etapas finais agora" })).toBeInTheDocument();
    for (const code of ["JOB-STARTED", "JOB-POSTED", "JOB-BACKGROUND"]) expect(screen.getByLabelText(`Tempo de impressão de ${code} (min)`)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tempo de impressão de JOB-CANCELLED (min)")).not.toBeInTheDocument();
    enterConfirmedInputs();
    const result = simulate();
    expect(within(result).queryByText("Estimativa dentro do prazo")).not.toBeInTheDocument();
    expect(within(result).getByText("Bloqueado")).toBeInTheDocument();
    expect(within(result).getByText("Resolva a impressão que bloqueia esta máquina.")).toBeInTheDocument();
  });

  it("mantém uma impressão de venda cancelada ocupando a máquina durante a simulação", async () => {
    mock.tables.orders.push({ id: "cancelled-order", code: "PED-CANCELADO", status: "cancelled" });
    mock.tables.production_orders.push({ id: "cancelled-production", source_order_id: "cancelled-order", status: "planned" });
    mock.tables.jobs.push({ ...mock.tables.jobs[0], id: "background-running", code: "JOB-BACKGROUND", name: "Impressão já iniciada", status: "printing", order_id: null, production_order_id: "cancelled-production" });
    mock.tables.printers[0].status = "printing";
    mount(); await load(); enterConfirmedInputs({ bed: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Conferi a compatibilidade de JOB-BACKGROUND com P1" }));
    fireEvent.change(screen.getByLabelText("Tempo restante de JOB-BACKGROUND (min)"), { target: { value: "30" } });
    const result = simulate();
    expect(within(result).getByText("Estimativa dentro do prazo")).toBeInTheDocument();
    expect(within(result).getByText(/Conclusão estimada:/)).toHaveTextContent("10:00");
  });

  it.each(["orders", "production_orders"])("bloqueia simulação e expõe erro ao conferir origem %s", async table => {
    mock.rows.mockImplementation((requested: string) => requested === table ? Promise.reject(new Error(`Origem indisponível: ${table}`)) : Promise.resolve(mock.tables[requested] ?? []));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(`Origem indisponível: ${table}`);
    expect(screen.getByRole("button", { name: "Simular prazo" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Resultado da simulação" })).not.toBeInTheDocument();
  });
});
