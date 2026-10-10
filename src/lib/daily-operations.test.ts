import { describe, expect, it } from "vitest";
import { dailyOrderDeadline, dailyPrinterStatus, readDailyMarketplaceOrders, summarizeDailyOperations, type DailyOrder, type DailySnapshot } from "./daily-operations";

const now = new Date("2026-10-10T12:00:00Z");
const order = (id: string, fields: Partial<DailyOrder> = {}): DailyOrder => ({ id, code: `PED-${id}`, status: "draft", ...fields });
const snapshot = (fields: Partial<DailySnapshot> = {}): DailySnapshot => ({ orders: [], jobs: [], printers: [], materials: [], ...fields });

describe("ações da operação diária", () => {
  it("antecipa a produção manual para a data anterior à entrega e alerta nesse dia sem criar horário", () => {
    const manual = order("manual", { status: "in_production", due_date: "2026-10-12", marketplace_order_id: null });
    const result = summarizeDailyOperations(snapshot({ orders: [manual] }), new Date("2026-10-11T12:00:00Z"));
    expect(result.orders[0]).toMatchObject({
      internalDay: "2026-10-11", internalAt: null, postingAt: null, deliveryDay: "2026-10-12",
      deadline: { kind: "internal_day", value: "2026-10-11", urgency: "today" },
    });
    expect(result.dueTodayCount).toBe(1);
    expect(dailyOrderDeadline(manual, now)).toMatchObject({ kind: "internal_day", urgency: "upcoming" });
    expect(dailyOrderDeadline(manual, new Date("2026-10-12T12:00:00Z"))).toMatchObject({ kind: "internal_day", urgency: "overdue" });
    expect(manual.due_date).toBe("2026-10-12");
  });

  it("preserva meta explícita e não infere uma meta de produção de origem desconhecida ou de canal sem cutoff", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [
      order("explicito", { marketplace_order_id: null, due_date: "2026-10-12", internal_due_at: "2026-10-10T15:00:00Z" }),
      order("canal", { marketplace_order_id: "inbox-1", due_date: "2026-10-12" }),
      order("origem-a-conferir", { due_date: "2026-10-12" }),
    ] }), now);
    expect(result.orders.find(row => row.id === "explicito")).toMatchObject({ internalDay: null, internalAt: "2026-10-10T15:00:00Z", deadline: { kind: "internal" } });
    for (const id of ["canal", "origem-a-conferir"]) expect(result.orders.find(row => row.id === id)).toMatchObject({ internalDay: null, internalAt: null, deadline: { kind: "delivery", value: "2026-10-12" } });
  });

  it("um vínculo da inbox sem cutoff bloqueia a meta manual mesmo quando o campo de origem está nulo", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [order("vinculado", { marketplace_order_id: null, due_date: "2026-10-12" })], marketplaceOrders: [
      { id: "inbox-1", internal_order_id: "vinculado", shipping_deadline_at: null, needs_review: false, review_reason: null },
    ] }), new Date("2026-10-11T12:00:00Z"));
    expect(result.orders[0]).toMatchObject({ internalDay: null, postingAt: null, deadline: { kind: "delivery", value: "2026-10-12", urgency: "upcoming" } });
    expect(result.dueTodayCount).toBe(0);
  });

  it("não alerta a meta manual já cumprida de pedidos prontos ou enviados", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [
      order("pronto-manual", { status: "ready", marketplace_order_id: null, due_date: "2026-10-11" }),
      order("enviado-manual", { status: "shipped", marketplace_order_id: null, due_date: "2026-10-11" }),
    ] }), new Date("2026-10-11T12:00:00Z"));
    expect(result.overdueCount).toBe(0);
    expect(result.orders.every(row => row.deadline.kind === "delivery" && row.deadline.urgency === "today")).toBe(true);
    expect(result.orders.map(row => row.nextAction)).toEqual(["Confirmar entrega", "Embalar e postar"]);
  });

  it("ordena pelo primeiro prazo real e usa entrega apenas como data quando não há horário", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [
      order("sem-prazo"),
      order("postagem", { ship_by_at: "2026-10-10T19:00:00Z" }),
      order("interno", { ship_by_at: "2026-10-10T18:00:00Z", internal_due_at: "2026-10-10T10:00:00Z" }),
      order("entrega", { due_date: "2026-10-09" }),
    ] }), now);
    expect(result.orders.map(row => row.id)).toEqual(["entrega", "interno", "postagem", "sem-prazo"]);
    expect(result.orders[0].deadline).toMatchObject({ kind: "delivery", value: "2026-10-09", urgency: "overdue" });
    expect(result.orders[1].deadline).toMatchObject({ kind: "internal", urgency: "overdue" });
    expect(result.orders[2].deadline).toMatchObject({ kind: "posting", urgency: "today" });
    expect(result.unknownDeadlineCount).toBe(1);
  });

  it("não transforma DATE em horário de corte e rejeita datas impossíveis ou sem fuso", () => {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(dailyOrderDeadline(order("hoje", { due_date: today }), now)).toMatchObject({ kind: "delivery", urgency: "today" });
    for (const value of ["2026-10-09", "2026-02-31T09:00:00Z", "2026-10-10T10:00:00", "2026-10-10T24:00:00Z", "indefinido"]) {
      expect(dailyOrderDeadline(order("inválido", { ship_by_at: value }), now)).toMatchObject({ kind: "unknown", value: null });
    }
    expect(dailyOrderDeadline(order("fuso", { ship_by_at: "2026-10-10T09:30:00-03:00" }), now)).toMatchObject({ kind: "posting", urgency: "today" });
  });

  it("não alerta prazo de postagem antigo para pedido já enviado", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [
      order("enviado", { status: "shipped", ship_by_at: "2026-10-08T08:00:00Z", internal_due_at: "2026-10-07T08:00:00Z", due_date: "2026-10-12" }),
      order("enviado-sem-entrega", { status: "shipped", ship_by_at: "2026-10-08T08:00:00Z" }),
      order("cancelado", { status: "cancelled" }), order("entregue", { status: "delivered" }),
    ] }), now);
    expect(result.orders).toHaveLength(2);
    expect(result.overdueCount).toBe(0);
    expect(result.orders[0]).toMatchObject({ nextAction: "Confirmar entrega", deadline: { kind: "delivery" } });
    expect(result.orders[1].deadline.kind).toBe("unknown");
  });

  it("pedido pronto segue o prazo de postagem e não a meta de produção já cumprida", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [order("pronto", {
      status: "ready", internal_due_at: "2026-10-09T08:00:00Z", ship_by_at: "2026-10-11T17:00:00Z",
    })] }), now);
    expect(result.orders[0]).toMatchObject({ deadline: { kind: "posting", urgency: "upcoming" }, internalAt: "2026-10-09T08:00:00Z", nextAction: "Embalar e postar" });
    expect(result.overdueCount).toBe(0);
  });

  it("usa o despacho canônico antecipado mesmo quando a venda guarda o prazo antigo até revisão", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [
      order("canal", { status: "in_production", ship_by_at: "2026-10-12T17:00:00Z", internal_due_at: "2026-10-11T17:00:00Z", workflow_checked_at: "2026-10-09T08:00:00Z" }),
      order("outro", { ship_by_at: "2026-10-10T15:00:00Z" }),
    ], marketplaceOrders: [{ id: "ml1", internal_order_id: "canal", shipping_deadline_at: "2026-10-10T13:00:00Z", needs_review: true, review_reason: "O canal antecipou o despacho para antes da meta interna." }] }), now);
    expect(result.orders.map(row => row.id)).toEqual(["canal", "outro"]);
    expect(result.orders[0]).toMatchObject({
      deadline: { kind: "posting", value: "2026-10-10T13:00:00Z", urgency: "today" },
      postingAt: "2026-10-10T13:00:00Z", postingSource: "marketplace", internalDeadlineNeedsReview: true,
      marketplaceReview: true, marketplaceReviewReason: "O canal antecipou o despacho para antes da meta interna.",
      marketplaceHref: "/comercial/marketplaces", workflowChecked: false, nextAction: "Replanejar pedido",
    });
    expect(result.orders[0].ship_by_at).toBe("2026-10-12T17:00:00Z");
    expect(result.dueTodayCount).toBe(2);
  });

  it("não reutiliza postagem antiga quando o canal vinculado deixa de informar um prazo válido", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [order("canal", { ship_by_at: "2026-10-12T17:00:00Z" })], marketplaceOrders: [
      { id: "ml1", internal_order_id: "canal", shipping_deadline_at: null, needs_review: true, review_reason: null },
      { id: "ml2", internal_order_id: null, shipping_deadline_at: "2026-10-10T08:00:00Z", needs_review: true, review_reason: "Sem vínculo" },
    ] }), now);
    expect(result.orders[0]).toMatchObject({ postingAt: null, deadline: { kind: "unknown" }, marketplaceReview: true });
    expect(result.overdueCount).toBe(0);
    expect(result.orders[0].marketplaceReviewReason).toMatch(/Confira a alteração/);
  });

  it("mostra próxima ação, link e conferência desconhecida sem campos da nova migração", () => {
    const result = summarizeDailyOperations(snapshot({ orders: [
      order("a/b", { workflow_issues: ["Complete a receita."] }),
      order("pronto", { status: "ready", workflow_checked_at: "2026-10-10T08:00:00Z" }),
    ] }), now);
    expect(result.orders[0]).toMatchObject({ nextAction: "Resolver pendências", href: "/comercial/pedidos?pedido=a%2Fb", workflowChecked: false, postingAt: null, internalAt: null });
    expect(result.orders[1]).toMatchObject({ nextAction: "Embalar e postar", workflowChecked: true });
    expect(result.uncheckedOrderCount).toBe(1);
  });

  it("conta fases locais e preserva status ociosa sem tratá-lo como mesa livre", () => {
    const statuses = ["queued", "reprint", "printing", "paused", "failed", "post_processing", "quality_check", "ready", "draft", "completed", "shipped", "outro"];
    const result = summarizeDailyOperations(snapshot({ jobs: statuses.map((status, index) => ({ id: String(index), status })) }), now);
    expect(result.production).toEqual({ queued: 2, printing: 1, attention: 2, finishing: 2, ready: 1, draft: 1, unknown: 1 });
    expect(dailyPrinterStatus("idle")).toBe("Ociosa no cadastro");
    expect(dailyPrinterStatus("inexistente")).toBe("Status a conferir");
  });

  it("retira a falha original dos próximos passos quando existe reimpressão, inclusive em cadeia", () => {
    const result = summarizeDailyOperations(snapshot({ jobs: [
      { id: "antigo", status: "failed" },
      { id: "segundo", status: "failed", reprint_of: "antigo" },
      { id: "fila", status: "reprint", reprint_of: "segundo" },
      { id: "resolvido", status: "failed" },
      { id: "substituto", status: "completed", reprint_of: "resolvido" },
      { id: "pendente", status: "failed" },
    ] }), now);
    expect(result.production.queued).toBe(1);
    expect(result.production.attention).toBe(1);
  });

  it("não inventa estoque zero nem mínimo para material incompleto e não soma unidades diferentes", () => {
    const result = summarizeDailyOperations(snapshot({ materials: [
      { id: "kg", name: "PLA", unit: "kg", current_stock: "0.4", min_stock: "1" },
      { id: "un", name: "Embalagem", unit: "un", current_stock: 1, min_stock: 2 },
      { id: "zero", name: "Mínimo zero", unit: "g", current_stock: 0, min_stock: 0 },
      { id: "sem-minimo", name: "Sem mínimo", unit: "kg", current_stock: 0, min_stock: null },
      { id: "sem-saldo", name: "Sem saldo", unit: "kg", current_stock: null, min_stock: 1 },
      { id: "invalido", name: "Saldo inválido", unit: "kg", current_stock: "", min_stock: 1 },
    ] }), now);
    expect(result.lowStock.map(row => [row.item.id, row.balance, row.minimum, row.item.unit])).toEqual([["un", 1, 2, "un"], ["kg", 0.4, 1, "kg"]]);
    expect(result.unknownStockCount).toBe(2);
    expect(result.unknownMinimumCount).toBe(1);
  });

  it.each(["42P01", "42703", "PGRST204", "PGRST205"])("permite inbox ainda não ativada (%s) sem mascarar falhas de consulta", async code => {
    expect(await readDailyMarketplaceOrders(async () => ({ data: null, error: { code, message: "Estrutura ausente" } }))).toEqual([]);
  });

  it.each(["42501", "PGRST301", "XX000"])("mantém erro da inbox visível (%s)", async code => {
    await expect(readDailyMarketplaceOrders(async () => ({ data: null, error: { code, message: "Não foi possível consultar o canal" } }))).rejects.toThrow("Não foi possível consultar o canal");
  });
});
