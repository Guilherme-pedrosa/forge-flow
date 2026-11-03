import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { integrationErrorMessage, type IntegradorBridgeBinding } from "@/lib/mercado-livre-integration";
import { mercadoLivreReportPeriod, readMercadoLivreOverview } from "@/lib/mercado-livre-reports";

export type MercadoLivreReportProps = { binding: IntegradorBridgeBinding; sellerId: string; userId: string };
export const reportDate = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("pt-BR") : "A conferir";
export const reportMoney = (value: number | null | undefined) => value == null ? "A conferir" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const day = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export function useMercadoLivreReportPeriod() {
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 29 * 86400000))), [to, setTo] = useState(() => day(new Date()));
  const [selected, setSelected] = useState(() => mercadoLivreReportPeriod(from, to)), [error, setError] = useState("");
  return { from, to, setFrom, setTo, selected, error, apply: (): "changed" | "same" | false => { try { const next = mercadoLivreReportPeriod(from, to); const changed = JSON.stringify(next) !== JSON.stringify(selected); if (changed) setSelected(next); setError(""); return changed ? "changed" : "same"; } catch (failure) { setError(integrationErrorMessage(failure)); return false; } } };
}
export function MercadoLivreReportPeriodFields({ period, disabled = false, onApply, idPrefix }: { period: ReturnType<typeof useMercadoLivreReportPeriod>; disabled?: boolean; onApply: () => void; idPrefix: string }) {
  return <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); onApply(); }}><div><Label htmlFor={`${idPrefix}-from`}>De</Label><Input id={`${idPrefix}-from`} type="date" value={period.from} disabled={disabled} onChange={event => period.setFrom(event.target.value)} /></div><div><Label htmlFor={`${idPrefix}-to`}>Até</Label><Input id={`${idPrefix}-to`} type="date" value={period.to} disabled={disabled} onChange={event => period.setTo(event.target.value)} /></div><Button variant="outline" disabled={disabled}>Consultar período</Button>{period.error && <p role="alert" className="w-full text-sm text-destructive">{period.error}</p>}</form>;
}
export function MercadoLivreDashboard({ binding, sellerId, userId }: MercadoLivreReportProps) {
  const { profile } = useAuth(), period = useMercadoLivreReportPeriod();
  const query = useQuery({ queryKey: ["ml_dashboard", profile?.tenant_id, userId, binding.bridge_id, sellerId, period.selected], queryFn: ({ signal }) => readMercadoLivreOverview(binding, sellerId, period.selected, { userId, signal }), retry: false });
  const metrics = query.data?.metrics;
  const cards = [["paid_orders", "Pedidos pagos no período"], ["cancelled_orders", "Pedidos cancelados no período"], ["active_listings", "Anúncios ativos"], ["paused_listings", "Anúncios pausados"], ["under_review_listings", "Anúncios em revisão"], ["unanswered_questions", "Perguntas aguardando resposta"], ["pending_conversations", "Conversas com mensagens não lidas"]] as const;
  return <section aria-label="Dashboard do Mercado Livre" className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Dashboard</h2><p className="text-sm text-muted-foreground">Acompanhe as vendas e o atendimento da conta selecionada.</p></div><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Atualizar indicadores</Button></div>
    <MercadoLivreReportPeriodFields period={period} disabled={query.isFetching} idPrefix="ml-dashboard" onApply={() => { if (period.apply() === "same") void query.refetch(); }} />
    {query.isLoading && <p role="status">Consultando os indicadores da conta…</p>}{query.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(query.error)}</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><article className="rounded-xl border bg-card p-4 sm:col-span-2"><p className="text-sm text-muted-foreground">Valor bruto dos produtos em pedidos pagos</p><p className="mt-2 text-2xl font-semibold">{reportMoney(metrics?.paid_product_gross_amount)}</p><p className="mt-2 text-xs text-muted-foreground">Antes dos descontos e das despesas de venda. O repasse é conferido em Conciliação.</p></article>{cards.map(([key, label]) => <article key={key} className="rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{metrics?.[key] == null ? "A conferir" : metrics[key]}</p></article>)}</div>
    {query.data && <><p className="text-xs text-muted-foreground">Consulta em {reportDate(query.data.checked_at)}</p>{!!query.data.issues.length && <div role="status" className="space-y-1 rounded-lg border bg-card p-3 text-sm">{query.data.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div>}</>}
    <nav aria-label="Ações do Mercado Livre" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["publicar", "Publicar uma peça"], ["anuncios", "Gerenciar anúncios"], ["perguntas", "Responder perguntas"], ["mensagens", "Abrir mensagens"]].map(([path, label]) => <Button key={path} asChild variant="outline"><Link to={`/comercial/mercado-livre/${path}`}>{label}</Link></Button>)}</nav>
  </section>;
}
