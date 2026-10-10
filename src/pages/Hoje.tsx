import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Package, Printer, RefreshCw, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { readProductionRows } from "@/lib/production-read";
import { excludeUnstartedCancelledJobs, type PlanningSourceJob, type PlanningSourceProductionOrder } from "@/lib/job-source-cancellation";
import { dailyPrinterStatus, readDailyMarketplaceOrders, summarizeDailyOperations, type DailyJob, type DailyMaterial, type DailyOrder, type DailyPrinter } from "@/lib/daily-operations";
import { displayDate } from "@/lib/finance";
import { operationalIssueLabel } from "@/lib/operational-planning";
import { cn } from "@/lib/utils";

const orderStatus: Record<string, string> = { draft: "Rascunho", approved: "Aprovado", in_production: "Em produção", ready: "Pronto", shipped: "Enviado" };
const timestampLabel = (value: string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const stockLabel = (value: number, unit: string) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit || "(unidade a informar)"}`;
// The historical generated schema omits operational tables added by migrations.
const operationalClient = supabase as unknown as SupabaseClient;

function Panel({ title, description, href, children }: { title: string; description?: string; href?: string; children: React.ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-5"><div><h2 className="font-semibold">{title}</h2>{description && <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{description}</p>}</div>{href && <Link to={href} className="inline-flex min-h-9 items-center gap-1 text-sm text-primary hover:underline">Ver todos<ArrowRight className="h-4 w-4" /></Link>}</div>
    {children}
  </section>;
}
function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-2 p-5 text-sm"><p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-muted-foreground" />{title}</p><p className="leading-relaxed text-muted-foreground">{children}</p></div>;
}

export default function Hoje() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const [now, setNow] = useState(() => new Date());
  const [visibleOrders, setVisibleOrders] = useState(12);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  const query = useQuery({
    queryKey: ["daily-operations", tenantId], enabled: !!tenantId, staleTime: 30_000, refetchInterval: 30_000, retry: 1,
    queryFn: async () => {
      const [orders, jobs, printers, materials, marketplaceOrders, productionOrders] = await Promise.all([
        readProductionRows<DailyOrder>((from, to) => supabase.from("orders").select("*").eq("tenant_id", tenantId!).order("id").range(from, to)),
        readProductionRows<DailyJob & PlanningSourceJob>((from, to) => supabase.from("jobs").select("id, status, reprint_of, order_id, production_order_id, started_at, inventory_posted_at").eq("tenant_id", tenantId!).order("id").range(from, to)),
        readProductionRows<DailyPrinter>((from, to) => supabase.from("printers").select("id, name, model, status").eq("tenant_id", tenantId!).eq("is_active", true).order("id").range(from, to)),
        readProductionRows<DailyMaterial>((from, to) => supabase.from("inventory_items").select("id, name, unit, current_stock, min_stock").eq("tenant_id", tenantId!).eq("is_active", true).order("id").range(from, to)),
        readDailyMarketplaceOrders((from, to) => operationalClient.from("marketplace_orders").select("id, internal_order_id, shipping_deadline_at, needs_review, review_reason").eq("tenant_id", tenantId!).not("internal_order_id", "is", null).order("id").range(from, to)),
        readProductionRows<PlanningSourceProductionOrder>((from, to) => operationalClient.from("production_orders").select("id, status, source_order_id").eq("tenant_id", tenantId!).order("id").range(from, to)),
      ]);
      return { orders, jobs: excludeUnstartedCancelledJobs(jobs, orders, productionOrders), printers, materials, marketplaceOrders };
    },
  });
  const data = useMemo(() => query.data ? summarizeDailyOperations(query.data, now) : null, [query.data, now]);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <div className="space-y-5 page-enter">
    <PageHeader title="Hoje" description="Veja o que precisa avançar nos pedidos, na produção e no estoque." actions={<Button variant="outline" disabled={!tenantId || query.isFetching} onClick={() => { setNow(new Date()); void query.refetch(); }}><RefreshCw className={cn("mr-2 h-4 w-4", query.isFetching && "animate-spin")} />{query.isFetching ? "Atualizando" : "Atualizar"}</Button>} />
    {!tenantId && <p role="status" className="rounded-xl border bg-card p-5 text-sm">Aguardando a identificação da empresa para consultar a operação.</p>}
    {query.error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"><p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Não foi possível atualizar a operação.</p><p className="mt-2 text-sm">{query.error.message}</p><p className="mt-1 text-sm text-muted-foreground">{data ? "Os dados abaixo são da última consulta concluída. Confira a atualização antes de decidir." : "Os indicadores serão exibidos depois de uma consulta completa."}</p><Button className="mt-3" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Tentar novamente</Button></div>}
    {tenantId && query.isPending && !query.error && <div role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Consultando pedidos, produção, impressoras e materiais…</div>}
    {data && <>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Consulta concluída em {timestampLabel(new Date(query.dataUpdatedAt).toISOString())} · horários em {timezone}.</p><div className="flex flex-wrap gap-2"><Button asChild size="sm"><Link to="/comercial/pedidos"><ShoppingCart className="mr-2 h-4 w-4" />Pedidos</Link></Button><Button asChild size="sm" variant="outline"><Link to="/planejamento/fila"><Printer className="mr-2 h-4 w-4" />Fila de impressão</Link></Button></div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        { title: "Pedidos ativos", value: data.orders.length, detail: `${data.unknownDeadlineCount} sem prazo informado`, href: "/comercial/pedidos" },
        { title: "Prazos hoje", value: data.dueTodayCount, detail: "Postagem, produção ou entrega", href: "#pedidos-do-dia" },
        { title: "Prazos vencidos", value: data.overdueCount, detail: "Confira o próximo passo", href: "#pedidos-do-dia" },
        { title: "Materiais abaixo do mínimo", value: data.lowStock.length, detail: "Saldo registrado no estoque", href: "/estoque/reposicao" },
      ].map(card => {
        const content = <><span className="text-xs leading-relaxed text-muted-foreground">{card.title}</span><strong className="mt-2 block text-2xl tabular-nums">{card.value}</strong><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{card.detail}</span></>;
        const classes = "min-w-0 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40";
        return card.href.startsWith("#") ? <a key={card.title} className={classes} href={card.href}>{content}</a> : <Link key={card.title} className={classes} to={card.href}>{content}</Link>;
      })}</div>
      <div id="pedidos-do-dia"><Panel title="Próximo passo dos pedidos" description="Ordenados pelo primeiro prazo registrado. Vendas manuais sem horário usam a meta de produção um dia antes da entrega." href="/comercial/pedidos">
        {!data.orders.length ? <Empty title="Nenhum pedido ativo">Crie um pedido ou importe as vendas dos marketplaces para organizar o trabalho.</Empty> : <div className="divide-y">{data.orders.slice(0, visibleOrders).map(order => <article key={order.id}><Link to={order.href} className="block px-4 py-4 hover:bg-muted/30 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{order.code || "Pedido sem código"}</h3><span className="rounded-full border px-2.5 py-1 text-xs">{orderStatus[order.status] ?? "Status a conferir"}</span></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0 space-y-1 text-sm">
            {order.status !== "shipped" && <p>{order.postingAt ? `Postar até ${timestampLabel(order.postingAt)}${order.postingSource === "marketplace" ? " · prazo do canal" : ""}` : "Postagem: horário não informado"}</p>}
            {order.status !== "shipped" && <p className={order.internalDeadlineNeedsReview ? "text-amber-700" : "text-muted-foreground"}>{order.internalAt ? `Meta interna: ${timestampLabel(order.internalAt)}${order.internalDeadlineNeedsReview ? " · ajustar para antes da postagem" : ""}` : order.internalDay ? `Meta de produção (data): ${displayDate(order.internalDay)} · 1 dia antes da entrega${order.status === "ready" ? " · produção concluída" : ""}` : "Meta interna: não informada"}</p>}
            {order.deliveryDay && <p>Entrega: {displayDate(order.deliveryDay)}</p>}
            <p className={cn("text-xs", order.deadline.urgency === "overdue" ? "font-medium text-destructive" : "text-muted-foreground")}>{order.deadline.urgency === "overdue" ? `${order.deadline.kind === "delivery" ? "Data de entrega vencida" : order.deadline.kind === "internal" ? "Meta interna vencida" : order.deadline.kind === "internal_day" ? "Meta de produção vencida" : "Prazo de postagem vencido"} (conferir andamento)` : order.deadline.urgency === "today" ? `${order.deadline.kind === "delivery" ? "Entrega" : order.deadline.kind === "internal" ? "Meta interna" : order.deadline.kind === "internal_day" ? "Meta de produção" : "Postagem"} hoje` : order.deadline.kind === "unknown" ? "Prazo a informar" : "Prazo registrado; conclusão a conferir"}</p>
            {order.issues.length > 0 && <p className="break-words text-xs text-amber-700">{order.issues.join(" ")}</p>}
            {!order.workflowChecked && <p className="text-xs text-muted-foreground">{order.marketplaceReview ? "Conferência operacional precisa ser refeita após a alteração do canal." : "Conferência operacional ainda não registrada."}</p>}
          </div><span className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-primary">{order.nextAction}<ArrowRight className="h-4 w-4 shrink-0" /></span></div>
        </Link>{order.marketplaceReview && <div className="mx-4 mb-4 rounded-lg border border-amber-300 bg-amber-50/20 p-3 sm:mx-5"><p className="text-sm font-medium">Revisão do marketplace pendente</p><p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{order.marketplaceReviewReason}</p><Link to={order.marketplaceHref} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary">Revisar no marketplace<ArrowRight className="h-4 w-4" /></Link></div>}</article>)}</div>}
        {data.orders.length > visibleOrders && <div className="border-t p-4"><Button variant="outline" className="w-full" onClick={() => setVisibleOrders(count => count + 12)}>Mostrar mais pedidos ({data.orders.length - visibleOrders} restantes)</Button></div>}
        <p className="border-t bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">Entrega e meta de produção por data não definem um horário de corte. Os prazos cadastrados não confirmam capacidade nem previsão de conclusão.</p>
      </Panel></div>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel title="Produção para acompanhar" description="Ordens de impressão locais; tentativas substituídas por reimpressões ficam no histórico. A integração não é somada novamente." href="/producao/jobs"><div className="grid grid-cols-2 divide-x divide-y">{[
          { label: "Na fila / reimpressão", value: data.production.queued, href: "/planejamento/fila" },
          { label: "Imprimindo", value: data.production.printing, href: "/planejamento/fila" },
          { label: "Pausadas / com falha", value: data.production.attention, href: "/planejamento/fila" },
          { label: "Acabamento / inspeção", value: data.production.finishing, href: "/planejamento/fila" },
          { label: "Prontas", value: data.production.ready, href: "/producao/jobs" },
          { label: "Rascunhos", value: data.production.draft, href: "/producao/jobs" },
        ].map(stage => <Link key={stage.label} to={stage.href} className="flex min-h-20 items-center justify-between gap-3 p-4 hover:bg-muted/30"><span className="text-xs leading-relaxed text-muted-foreground">{stage.label}</span><strong className="text-xl tabular-nums">{stage.value}</strong></Link>)}</div>{data.production.unknown > 0 && <p className="border-t p-4 text-sm">{data.production.unknown} ordem(ns) com status a conferir.</p>}</Panel>
        <Panel title="Materiais abaixo do mínimo" description="Saldo por material, na sua unidade. Isso não confirma o saldo físico das bobinas nem a cobertura de pedidos futuros.">
          {!data.lowStock.length ? <Empty title={query.data!.materials.length ? "Nenhum saldo conhecido abaixo do mínimo" : "Nenhum material cadastrado"}>{query.data!.materials.length ? "Confira também a demanda da fila e os limites que ainda faltam informar." : "Cadastre os materiais e defina seus mínimos para acompanhar a reposição."}</Empty> : <div className="divide-y">{data.lowStock.map(row => <div key={row.item.id} className="space-y-1 px-4 py-3"><h3 className="break-words text-sm font-medium">{row.item.name}</h3><p className="text-xs text-muted-foreground">Saldo: <strong className="text-amber-700">{stockLabel(row.balance, row.item.unit)}</strong> · mínimo: {stockLabel(row.minimum, row.item.unit)}</p></div>)}</div>}
          {(data.unknownMinimumCount > 0 || data.unknownStockCount > 0) && <p className="border-t px-4 py-3 text-xs text-muted-foreground">{data.unknownMinimumCount > 0 && `${data.unknownMinimumCount} material(is) sem mínimo válido. `}{data.unknownStockCount > 0 && `${data.unknownStockCount} saldo(s) a conferir; ficaram fora dos alertas.`}</p>}
          <div className="flex flex-wrap gap-2 border-t p-4"><Button asChild size="sm" variant="outline"><Link to="/estoque/bobinas"><Package className="mr-2 h-4 w-4" />Conferir bobinas</Link></Button><Button asChild size="sm"><Link to="/estoque/reposicao">Planejar reposição<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
        </Panel>
        <Panel title="Impressoras" description="Status registrado no cadastro. Uma máquina ociosa ou online ainda precisa de mesa, preparação e compatibilidade confirmadas." href="/producao/impressoras">{!data.printers.length ? <Empty title="Nenhuma impressora cadastrada">Cadastre as máquinas para vincular as ordens de impressão.</Empty> : <div className="grid gap-3 p-4 sm:grid-cols-2">{data.printers.map(printer => <Link key={printer.id} to="/producao/impressoras" className="min-w-0 rounded-lg border p-3 hover:bg-muted/30"><h3 className="break-words text-sm font-medium">{printer.name}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{printer.model || "Modelo não informado"}</p><p className="mt-2 text-sm">{dailyPrinterStatus(printer.status)}</p><p className="mt-1 text-xs text-muted-foreground">Liberação da mesa: a conferir</p></Link>)}</div>}</Panel>
        <Panel title="Simular conclusão dos pedidos" description="Confirme turnos, compatibilidade, todas as placas e as etapas finais para estimar a conclusão."><ul className="space-y-2 p-4 text-sm text-muted-foreground">{["operator_calendar_unknown", "compatibility_unknown", "job_manifest_unknown", "machine_availability_unknown", "final_operations_time_unknown"].map(issue => <li key={issue}>{operationalIssueLabel(issue)}</li>)}</ul><div className="border-t p-4"><Button asChild variant="outline" className="w-full"><Link to="/planejamento/capacidade">Simular prazo<ArrowRight className="ml-auto h-4 w-4" /></Link></Button></div></Panel>
      </div>
    </>}
  </div>;
}
