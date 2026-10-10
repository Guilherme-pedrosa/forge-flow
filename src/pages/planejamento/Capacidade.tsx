import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assemblyRows } from "@/lib/assembly";
import { excludeUnstartedCancelledJobs } from "@/lib/job-source-cancellation";
import { isMissingDatabaseStructure } from "@/lib/database-readiness";
import { compareOperationalJobs, operationalIssueLabel, planOperations, type OperationalJob, type OperatorWindow } from "@/lib/operational-planning";
import { deliveryPreparationDay } from "@/lib/order-preparation-deadline";
import { displayDate, validDate } from "@/lib/finance";

type CapacityOrder = { id: string; code: string; status: string; due_date: string | null; ship_by_at?: string | null; internal_due_at?: string | null; marketplace_order_id?: string | null };
type CapacityJob = { id: string; code: string; name: string; status: string; order_id: string | null; production_order_id: string | null; printer_id: string | null; due_date: string | null; est_time_minutes: number | null; priority: number; created_at: string; reprint_of: string | null; started_at?: string | null; inventory_posted_at?: string | null };
type CapacityPrinter = { id: string; name: string; status: string; model?: string | null };
type CapacityProductionOrder = { id: string; status: string; source_order_id: string | null };
type CapacityMarketplaceOrder = { internal_order_id: string | null; shipping_deadline_at: string | null; needs_review: boolean; review_reason: string | null };
type TimeField = "setup" | "clearance" | "finishing" | "assembly" | "packaging";
type TimeInputs = Record<TimeField, string>;
type ShiftInput = { id: number; start: string; end: string };
type Simulation = ReturnType<typeof planOperations> & { simulatedAt: string };
const emptyTimes = (): TimeInputs => ({ setup: "", clearance: "", finishing: "", assembly: "", packaging: "" });
const timeLabels: Record<TimeField, string> = { setup: "Preparação por placa (min)", clearance: "Retirada e liberação por placa (min)", finishing: "Acabamento por pedido (min)", assembly: "Montagem por pedido (min)", packaging: "Embalagem por pedido (min)" };
const activeOrders = new Set(["draft", "approved", "in_production", "ready"]);
const backgroundStatuses = new Set(["queued", "reprint", "printing", "paused", "post_processing", "quality_check"]);
const finishedStatuses = new Set(["ready", "completed", "shipped"]);
const printedStatuses = new Set(["post_processing", "quality_check"]);
const forecastLabels = { unknown: "Dados a conferir", blocked: "Bloqueado", late: "Conclusão após o prazo", at_risk: "Folga curta ou prazo interno excedido", estimated_on_time: "Estimativa dentro do prazo" };
const earliestCapacityDeadline = (values: (string | null | undefined)[]) => values.filter((value): value is string => !!value && value.includes("T") && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;

function minutes(value: string, label: string): number | null {
  if (!value.trim()) return null;
  const text = value.trim().replace(",", ".");
  const parsed = Number(text);
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(parsed)) throw new Error(`${label}: informe minutos maiores ou iguais a zero.`);
  return parsed;
}
function localInstant(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error(`${label}: informe data e horário.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}: data ou horário inválido.`);
  const pad = (number: number) => String(number).padStart(2, "0");
  const roundtrip = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  if (roundtrip !== value) throw new Error(`${label}: confira a data e o horário no fuso do navegador.`);
  return parsed.toISOString();
}
function dateLabel(value: string | null | undefined): string {
  if (!value) return "não informado";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDate(value) ? `${displayDate(value)} (horário pendente)` : "data a conferir";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("pt-BR") : "data a conferir";
}
function dayLabel(value: string | null | undefined): string {
  if (!value) return "não informada";
  return validDate(value) ? displayDate(value) : "data a conferir";
}

function Check({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex items-start gap-2"><Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={value => onChange(value === true)} /><Label htmlFor={id} className="text-sm leading-5 font-normal">{label}</Label></div>;
}

export default function Capacidade() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "fuso local do navegador";
  const [times, setTimes] = useState<TimeInputs>(emptyTimes);
  const [shifts, setShifts] = useState<ShiftInput[]>([]);
  const [calendarConfirmed, setCalendarConfirmed] = useState(false);
  const [freeBeds, setFreeBeds] = useState<Record<string, boolean>>({});
  const [compatible, setCompatible] = useState<Record<string, boolean>>({});
  const [manifests, setManifests] = useState<Record<string, boolean>>({});
  const [printedReady, setPrintedReady] = useState<Record<string, boolean>>({});
  const [jobTimes, setJobTimes] = useState<Record<string, string>>({});
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["capacity_data", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const filter = { tenant_id: tenantId! };
      const [orders, jobs, printers, productionOrders, marketplaceOrders] = await Promise.all([
        assemblyRows<CapacityOrder>("orders", "*", filter),
        assemblyRows<CapacityJob>("jobs", "*", filter),
        assemblyRows<CapacityPrinter>("printers", "*", { ...filter, is_active: true }),
        assemblyRows<CapacityProductionOrder>("production_orders", "*", filter),
        assemblyRows<CapacityMarketplaceOrder>("marketplace_orders", "id,internal_order_id,shipping_deadline_at,needs_review,review_reason", filter).catch(error => { if (isMissingDatabaseStructure(error)) return []; throw error; }),
      ]);
      return { orders, jobs, printers, productionOrders, marketplaceOrders };
    },
  });
  useEffect(() => {
    setTimes(emptyTimes()); setShifts([]); setCalendarConfirmed(false); setFreeBeds({}); setCompatible({}); setManifests({}); setPrintedReady({}); setJobTimes({}); setSimulation(null); setError(null);
  }, [tenantId]);
  useEffect(() => {
    // Confirmations describe this snapshot; new plates/assignments need a new review.
    setFreeBeds({}); setCompatible({}); setManifests({}); setPrintedReady({}); setJobTimes({});
  }, [query.data]);
  useEffect(() => { setSimulation(null); setError(null); }, [query.data, times, shifts, calendarConfirmed, freeBeds, compatible, manifests, printedReady, jobTimes]);
  useEffect(() => { if (query.isFetching || query.isError) setSimulation(null); }, [query.isFetching, query.isError]);

  const prepared = useMemo(() => {
    const allOrders = (query.data?.orders ?? []).map(order => {
      const linked = (query.data?.marketplaceOrders ?? []).filter(row => row.internal_order_id != null && row.internal_order_id === order.id);
      const canonical = earliestCapacityDeadline(linked.map(row => row.shipping_deadline_at));
      const review = linked.filter(row => row.needs_review);
      const preparationDay = ["ready", "shipped", "delivered", "cancelled"].includes(order.status) ? null : deliveryPreparationDay(order, linked.length > 0);
      return { ...order, preparationDay, planningDeadline: linked.length ? canonical : order.ship_by_at ?? order.due_date, planningInternalDeadline: linked.length ? canonical ? earliestCapacityDeadline([order.internal_due_at, canonical]) : null : order.internal_due_at ?? preparationDay, postingDeadline: linked.length ? canonical : order.ship_by_at ?? null, marketplaceReview: review.length ? [...new Set(review.map(row => row.review_reason || "Confira a atualização do marketplace antes de confirmar o prazo."))].join(" · ") : null };
    });
    const orders = allOrders.filter(order => activeOrders.has(order.status));
    const byOrder = new Map(allOrders.map(order => [order.id, order]));
    const orderIds = new Set(orders.map(order => order.id));
    const sources = new Map((query.data?.productionOrders ?? []).map(order => [order.id, order.source_order_id]));
    const orderIdFor = (job: CapacityJob) => job.order_id ?? (job.production_order_id ? sources.get(job.production_order_id) : null) ?? null;
    const deadlineFor = (job: CapacityJob) => {
      const order = byOrder.get(orderIdFor(job) ?? "");
      return { id: job.id, status: job.status, deadlineAt: order ? order.planningDeadline : job.due_date, internalDeadlineAt: order?.planningInternalDeadline, durationMinutes: job.est_time_minutes, priority: job.priority, createdAt: job.created_at };
    };
    const planningJobs = excludeUnstartedCancelledJobs(query.data?.jobs ?? [], allOrders, query.data?.productionOrders ?? []);
    const replacements = new Set(planningJobs.filter(job => job.reprint_of).map(job => job.reprint_of));
    const jobs = planningJobs.filter(job => !(job.status === "failed" && replacements.has(job.id)) && (orderIds.has(orderIdFor(job) ?? "") || backgroundStatuses.has(job.status))).sort((a, b) => compareOperationalJobs(deadlineFor(a), deadlineFor(b)));
    return { orders, jobs, printers: query.data?.printers ?? [], orderIdFor, deadlineFor };
  }, [query.data]);

  function simulate() {
    try {
      const parsed = Object.fromEntries((Object.keys(times) as TimeField[]).map(field => [field, minutes(times[field], timeLabels[field])])) as Record<TimeField, number | null>;
      const operatorWindows: OperatorWindow[] | null = calendarConfirmed ? shifts.map((shift, index) => {
        const startAt = localInstant(shift.start, `Início do turno ${index + 1}`), endAt = localInstant(shift.end, `Fim do turno ${index + 1}`);
        if (endAt <= startAt) throw new Error(`Turno ${index + 1}: o fim precisa ser depois do início.`);
        return { startAt, endAt };
      }) : null;
      const now = new Date().toISOString();
      const orders = prepared.orders.map(order => {
        const linked = prepared.jobs.filter(job => prepared.orderIdFor(job) === order.id);
        const confirmed = manifests[order.id] && (linked.length > 0 || order.status === "ready");
        return { id: order.id, deadlineAt: order.planningDeadline, internalDeadlineAt: order.planningInternalDeadline, finishingMinutes: parsed.finishing, assemblyMinutes: parsed.assembly, packagingMinutes: parsed.packaging, expectedJobIds: confirmed ? linked.map(job => job.id) : undefined };
      });
      const jobs: OperationalJob[] = prepared.jobs.map(job => {
        const override = jobTimes[job.id];
        const duration = override === undefined ? (job.status === "printing" ? null : job.est_time_minutes) : minutes(override, `Tempo da ordem ${job.code}`);
        return { ...prepared.deadlineFor(job), orderId: prepared.orderIdFor(job), machineId: job.printer_id, durationMinutes: job.status === "printing" ? null : duration, remainingMinutes: job.status === "printing" ? duration : null, setupMinutes: parsed.setup, clearanceMinutes: parsed.clearance, readyAt: printedReady[job.id] ? now : null, compatibleMachineIds: compatible[job.id] && job.printer_id ? [job.printer_id] : null };
      });
      const machines = prepared.printers.map(printer => ({ id: printer.id, state: (printer.status === "maintenance" ? "maintenance" : ["offline", "error"].includes(printer.status) ? "offline" : printer.status === "printing" ? "busy" : printer.status === "idle" && freeBeds[printer.id] ? "available" : "unknown") as "available" | "busy" | "maintenance" | "offline" | "unknown" }));
      const plan = planOperations({ now, orders, jobs, machines, operatorWindows });
      setSimulation({ ...plan, orders: plan.orders.map(result => prepared.orders.find(order => order.id === result.id)?.marketplaceReview && result.status !== "blocked" ? { ...result, status: "unknown" as const } : result), simulatedAt: now }); setError(null);
    } catch (cause) { setSimulation(null); setError(cause instanceof Error ? cause.message : "Confira os dados para simular."); }
  }

  return <>
    <PageHeader title="Simular prazo" description="Confira se as placas, o atendimento e as etapas finais cabem no prazo de postagem dos pedidos." breadcrumbs={[{ label: "Planejamento", href: "/planejamento/fila" }, { label: "Simular prazo" }]} />
    <p className="mb-5 text-sm text-muted-foreground">Esta estimativa usa o cadastro e as confirmações desta sessão. Não reserva capacidade nem envia comandos às impressoras. Impressões podem continuar sem operador; preparação, retirada e etapas finais usam um único operador compartilhado. Paradas e falhas futuras não estão previstas.</p>
    {query.isLoading && <p role="status">Carregando pedidos, ordens e impressoras…</p>}
    {query.isError && <div role="alert" className="mb-5 rounded border border-destructive p-4"><p>Não foi possível conferir todos os dados. {query.error?.message || "Atualize para tentar novamente."}</p><Button variant="outline" onClick={() => void query.refetch()} className="mt-2">Atualizar dados</Button></div>}
    {!query.isLoading && !query.isError && !prepared.orders.length && <p role="status" className="mb-5">Nenhum pedido aberto para simular.</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Horários de atendimento</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Datas e horários no fuso do navegador: <strong>{timezone}</strong>. Adicione todos os turnos até a conclusão esperada; sobreposições não aumentam o número de operadores.</p>
        {shifts.map((shift, index) => <div key={shift.id} className="space-y-2 rounded border p-3"><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`shift-start-${shift.id}`}>Início do turno {index + 1}</Label><Input id={`shift-start-${shift.id}`} type="datetime-local" value={shift.start} onChange={event => setShifts(previous => previous.map(item => item.id === shift.id ? { ...item, start: event.target.value } : item))} /></div><div><Label htmlFor={`shift-end-${shift.id}`}>Fim do turno {index + 1}</Label><Input id={`shift-end-${shift.id}`} type="datetime-local" value={shift.end} onChange={event => setShifts(previous => previous.map(item => item.id === shift.id ? { ...item, end: event.target.value } : item))} /></div></div><Button variant="ghost" size="sm" onClick={() => setShifts(previous => previous.filter(item => item.id !== shift.id))}>Remover turno {index + 1}</Button></div>)}
        <Button variant="outline" onClick={() => setShifts(previous => [...previous, { id: previous.reduce((max, shift) => Math.max(max, shift.id), 0) + 1, start: "", end: "" }])}>Adicionar turno</Button>
        <Check id="calendar-confirmed" label="Confirmo estes horários de um operador para a simulação" checked={calendarConfirmed} onChange={setCalendarConfirmed} />
        {calendarConfirmed && shifts.length === 0 && <p className="text-sm text-muted-foreground">Sem turnos, nenhuma operação com atendimento pode iniciar.</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Tempos de trabalho</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Use os tempos médios que você conferiu. Preparação e retirada se repetem em cada placa; acabamento, montagem e embalagem se repetem em cada pedido. Campo vazio mantém a pendência. Digite 0 somente quando essa operação não for necessária.</p>
        <div className="grid gap-3 sm:grid-cols-2">{(Object.keys(times) as TimeField[]).map(field => <div key={field}><Label htmlFor={`time-${field}`}>{timeLabels[field]}</Label><Input id={`time-${field}`} inputMode="decimal" value={times[field]} onChange={event => setTimes(previous => ({ ...previous, [field]: event.target.value }))} placeholder="A conferir" /></div>)}</div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Disponibilidade física</CardTitle></CardHeader><CardContent className="space-y-4">
        {!prepared.printers.length && <p className="text-sm text-muted-foreground">Nenhuma impressora ativa cadastrada.</p>}
        {prepared.printers.map(printer => <div key={printer.id} className="space-y-2 rounded border p-3"><div className="flex flex-wrap items-center gap-2 text-sm font-medium">{printer.name} <Badge variant="outline">Status cadastrado: {printer.status}</Badge></div>{printer.status === "idle" ? <Check id={`bed-${printer.id}`} label={`Mesa livre, preparada e disponível agora: ${printer.name}`} checked={!!freeBeds[printer.id]} onChange={checked => setFreeBeds(previous => ({ ...previous, [printer.id]: checked }))} /> : <p className="text-sm text-muted-foreground">{printer.status === "printing" ? "O término depende de uma única ordem em impressão e de seu tempo restante confirmado abaixo." : "A disponibilidade não está confirmada. Manutenção, offline e erro bloqueiam novas impressões."}</p>}</div>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Placas e peças por pedido</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Confira se as ordens vinculadas representam todas as placas e peças necessárias, inclusive produtos com várias placas. Uma falha substituída por reimpressão não soma outra peça pronta.</p>
        {prepared.orders.map(order => {
          const linked = prepared.jobs.filter(job => prepared.orderIdFor(job) === order.id), canConfirm = linked.length > 0 || order.status === "ready";
          return <div key={order.id} className="space-y-2 rounded border p-3"><p className="text-sm font-medium">{order.code} · {linked.length} ordem(ns) vinculada(s)</p><p className="text-xs text-muted-foreground">Postar até: {order.postingDeadline ? dateLabel(order.postingDeadline) : "horário não informado"} · {order.preparationDay ? <>Meta de produção (data): {dayLabel(order.preparationDay)} · 1 dia antes da entrega</> : <>Prazo interno: {dateLabel(order.planningInternalDeadline)}</>} · Entrega: {dayLabel(order.due_date)} (data comercial)</p>{order.marketplaceReview && <p className="text-sm text-amber-700">Revisão do marketplace: {order.marketplaceReview} <Link className="underline" to="/integracoes/marketplaces">Conferir marketplace</Link></p>}{linked.length > 0 && <p className="text-xs text-muted-foreground">{linked.map(job => job.code).join(", ")}</p>}<Check id={`manifest-${order.id}`} label={linked.length ? `Todas as placas e peças de ${order.code} estão representadas` : `Conferi todos os itens de ${order.code}: estão disponíveis e dispensam impressão`} checked={!!manifests[order.id]} disabled={!canConfirm} onChange={checked => setManifests(previous => ({ ...previous, [order.id]: checked }))} />{!canConfirm && <p className="text-sm text-muted-foreground">Vincule as ordens necessárias ou confira o atendimento por estoque no pedido.</p>}<Link className="text-sm text-primary underline" to={`/comercial/pedidos?pedido=${encodeURIComponent(order.id)}`}>Abrir pedido {order.code}</Link></div>;
        })}
      </CardContent></Card>
    </div>
    <Card className="mt-5"><CardHeader><CardTitle className="text-base">Tempos e compatibilidade das ordens</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">O tempo cadastrado é uma estimativa. Confirme a atribuição após conferir volume da peça, material, bico e perfil da placa. Ordens sem máquina precisam de atribuição na fila; nenhuma compatibilidade é presumida. Ordens de outros pedidos também ocupam a farm.</p>
      {!prepared.jobs.length && <p className="text-sm text-muted-foreground">Nenhuma ordem vinculada ou em andamento.</p>}
      {prepared.jobs.map(job => {
        const printer = prepared.printers.find(item => item.id === job.printer_id), finished = finishedStatuses.has(job.status), printed = printedStatuses.has(job.status);
        return <div key={job.id} className="grid gap-3 rounded border p-3 md:grid-cols-2"><div className="space-y-2"><div className="flex flex-wrap items-center gap-2 text-sm font-medium">{job.code} · {job.name} <Badge variant="outline">{job.status}</Badge></div><p className="text-sm text-muted-foreground">{printer?.name ?? "Sem impressora ativa atribuída"}</p>{!finished && !printed && <Check id={`compat-${job.id}`} label={`Conferi a compatibilidade de ${job.code} com ${printer?.name ?? "a impressora atribuída"}`} checked={!!compatible[job.id]} disabled={!printer} onChange={checked => setCompatible(previous => ({ ...previous, [job.id]: checked }))} />}{printed && <Check id={`printed-${job.id}`} label={`Conferi e liberei as peças de ${job.code} para as etapas finais agora`} checked={!!printedReady[job.id]} onChange={checked => setPrintedReady(previous => ({ ...previous, [job.id]: checked }))} />}{finished && <p className="text-sm text-muted-foreground">Saída indicada como pronta no cadastro. Confira o estado das peças ao confirmar o pedido.</p>}</div>{!finished && !printed && <div><Label htmlFor={`job-time-${job.id}`}>{job.status === "printing" ? `Tempo restante de ${job.code} (min)` : `Tempo de impressão de ${job.code} (min)`}</Label><Input id={`job-time-${job.id}`} inputMode="decimal" value={jobTimes[job.id] ?? (job.status === "printing" || job.est_time_minutes == null ? "" : String(job.est_time_minutes))} placeholder="A conferir" onChange={event => setJobTimes(previous => ({ ...previous, [job.id]: event.target.value }))} /><p className="mt-1 text-xs text-muted-foreground">{job.status === "printing" ? "Informe o restante observado; o tempo total cadastrado não substitui essa confirmação." : "Estimativa cadastrada, ajustável somente nesta sessão."}</p></div>}</div>;
      })}
      <Link className="text-sm text-primary underline" to="/planejamento/fila">Abrir fila de impressão</Link>
    </CardContent></Card>
    <div className="my-5 flex flex-wrap items-center gap-3"><Button onClick={simulate} disabled={!tenantId || query.isLoading || query.isFetching || query.isError || !prepared.orders.length}>Simular prazo</Button><p className="text-sm text-muted-foreground">Confirmações e tempos não são gravados. Ao alterar os dados, simule novamente.</p></div>
    {error && <p role="alert" className="mb-5 text-sm text-destructive">{error}</p>}
    {simulation && !query.isError && !query.isFetching && <section aria-label="Resultado da simulação" className="space-y-4"><p className="text-sm text-muted-foreground">Simulação em {dateLabel(simulation.simulatedAt)} · {timezone}. A conclusão inclui liberação das placas e etapas finais informadas; o prazo de postagem deve considerar o deslocamento e o horário da transportadora.</p>{simulation.orders.map(result => {
      const order = prepared.orders.find(item => item.id === result.id)!;
      const known = result.status !== "unknown" && result.status !== "blocked";
      return <Card key={result.id}><CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-base">{order.code}<Badge variant={result.status === "late" || result.status === "blocked" ? "destructive" : "outline"}>{forecastLabels[result.status]}</Badge></CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-sm">{known ? "Conclusão estimada" : "Conclusão parcial estimada"}: {result.readyAt ? dateLabel(result.readyAt) : "não calculável com os dados atuais"}</p>{known && result.slackMinutes != null && <p className="text-sm">Folga até a postagem: {Math.round(result.slackMinutes)} min. Aviso de folga curta: 60 min.</p>}{!known && result.readyAt && <p className="text-sm text-muted-foreground">O horário parcial depende das pendências abaixo; não confirma que o pedido cabe no prazo.</p>}{order.marketplaceReview && <p className="text-sm text-amber-700">Revisão do marketplace: {order.marketplaceReview} <Link className="underline" to="/integracoes/marketplaces">Conferir marketplace</Link></p>}{result.issues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{result.issues.map(issue => <li key={issue}>{operationalIssueLabel(issue)}</li>)}</ul>}<div className="flex flex-wrap gap-4"><Link className="text-sm text-primary underline" to={`/comercial/pedidos?pedido=${encodeURIComponent(order.id)}`}>Conferir pedido {order.code}</Link><Link className="text-sm text-primary underline" to="/planejamento/fila">Rever fila</Link></div></CardContent></Card>;
    })}</section>}
  </>;
}
