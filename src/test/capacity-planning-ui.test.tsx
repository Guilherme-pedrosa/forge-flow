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
    expect(screen.getByText("Postar até: não informado · Prazo interno: não informado")).toBeInTheDocument();
    expect(within(simulate()).getByText("Informe o horário limite de postagem e o fuso.")).toBeInTheDocument();
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
});
