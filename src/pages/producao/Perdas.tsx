import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { readProductionRows } from "@/lib/production-read";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ArrowRight, Loader2, Package, RefreshCw } from "lucide-react";

const currency = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export default function Perdas() {
  const { profile } = useAuth();
  const [start, setStart] = useState(() => localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [end, setEnd] = useState(() => localDate(new Date()));
  const validRange = !!start && !!end && start <= end;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["production_losses", profile?.tenant_id, start, end],
    enabled: !!profile && validRange,
    queryFn: async () => {
      const from = new Date(`${start}T00:00:00`).toISOString();
      const until = new Date(`${end}T23:59:59.999`).toISOString();
      const [movements, failed] = await Promise.all([
        readProductionRows((a, b) => supabase.from("inventory_movements").select("*, inventory_items(name, unit)").eq("movement_type", "loss").gte("created_at", from).lte("created_at", until).order("created_at", { ascending: false }).order("id").range(a, b)),
        readProductionRows((a, b) => supabase.from("jobs").select("id, code, name, failure_reason, actual_total_cost, actual_grams, updated_at, product_id, printers(name)").eq("status", "failed").gte("updated_at", from).lte("updated_at", until).order("updated_at", { ascending: false }).order("id").range(a, b)),
      ]);
      return { movements, failed };
    },
  });
  const totals = useMemo(() => ({
    material: data?.movements.reduce((sum, movement) => sum + (movement.total_cost ?? 0), 0) ?? 0,
    uncosted: data?.movements.filter(movement => movement.total_cost == null).length ?? 0,
    failedCost: data?.failed.reduce((sum, job) => sum + (job.actual_total_cost ?? 0), 0) ?? 0,
    unmeasured: data?.failed.filter(job => job.actual_total_cost == null).length ?? 0,
  }), [data]);

  return <div className="space-y-6">
    <PageHeader title="Perdas e reimpressões" description="Rastreie material perdido, causas de falha e custo das ordens que precisam ser refeitas." breadcrumbs={[{ label: "Produção", href: "/producao/jobs" }, { label: "Perdas" }]} actions={<Button asChild><Link to="/producao/jobs">Registrar falha na ordem<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>} />
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <div className="space-y-2"><Label htmlFor="loss-start">De</Label><Input id="loss-start" type="date" value={start} onChange={event => setStart(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="loss-end">Até</Label><Input id="loss-end" type="date" value={end} min={start} onChange={event => setEnd(event.target.value)} /></div>
      <Button variant="outline" onClick={() => refetch()} disabled={!validRange || isLoading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
    </div>
    {!validRange && <p role="alert" className="text-sm text-destructive">Informe um período válido.</p>}
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">Não foi possível carregar as perdas. {error.message}</p>}
    {isLoading ? <div className="flex items-center justify-center gap-3 p-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Carregando apuração...</div> : validRange && !error && <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Material perdido</p><p className="mt-2 text-3xl font-semibold">{currency(totals.material)}</p><p className="mt-2 text-xs text-muted-foreground">{data?.movements.length ?? 0} movimentações {totals.uncosted ? `· ${totals.uncosted} sem custo` : ""}</p></div>
        <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Ordens com falha</p><p className="mt-2 text-3xl font-semibold">{data?.failed.length ?? 0}</p><p className="mt-2 text-xs text-muted-foreground">Histórico preservado ao reimprimir</p></div>
        <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Custo apurado das falhas</p><p className="mt-2 text-3xl font-semibold">{currency(totals.failedCost)}</p><p className="mt-2 text-xs text-muted-foreground">{totals.unmeasured ? `${totals.unmeasured} ordens ainda sem apuração` : "Inclui material, máquina, energia e custos informados"}</p></div>
      </div>
      <p className="text-sm text-muted-foreground">O custo das falhas já inclui o material consumido nessas ordens. Os indicadores acima se sobrepõem e não devem ser somados.</p>
      <section className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4"><h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />Ordens que falharam</h2></div>
        {!data?.failed.length ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma falha registrada no período.</p> : <Table><TableHeader><TableRow><TableHead>Ordem</TableHead><TableHead>Impressora</TableHead><TableHead>Causa registrada</TableHead><TableHead className="text-right">Custo apurado</TableHead></TableRow></TableHeader><TableBody>{data.failed.map(job => <TableRow key={job.id}><TableCell><Link to="/producao/jobs" className="font-medium text-primary">{job.code}</Link><p className="text-xs text-muted-foreground">{job.name}</p></TableCell><TableCell>{job.printers?.name ?? "Não atribuída"}</TableCell><TableCell className="max-w-sm whitespace-normal">{job.failure_reason || "Motivo não registrado"}</TableCell><TableCell className="text-right tabular-nums">{job.actual_total_cost == null ? "Pendente" : currency(job.actual_total_cost)}</TableCell></TableRow>)}</TableBody></Table>}
      </section>
      <section className="rounded-xl border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><h2 className="flex items-center gap-2 font-semibold"><Package className="h-4 w-4 text-muted-foreground" />Baixas de material por perda</h2><Button variant="outline" size="sm" asChild><Link to="/estoque/movimentacoes">Perda avulsa de estoque</Link></Button></div>
        {!data?.movements.length ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma baixa por perda registrada no período.</p> : <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Material</TableHead><TableHead className="text-right">Quantidade</TableHead><TableHead className="text-right">Custo</TableHead><TableHead>Justificativa</TableHead></TableRow></TableHeader><TableBody>{data.movements.map(movement => <TableRow key={movement.id}><TableCell>{new Date(movement.created_at).toLocaleDateString("pt-BR")}</TableCell><TableCell>{movement.inventory_items?.name ?? "Material indisponível"}</TableCell><TableCell className="text-right tabular-nums">{movement.quantity.toLocaleString("pt-BR")} {movement.inventory_items?.unit}</TableCell><TableCell className="text-right tabular-nums">{movement.total_cost == null ? "Pendente" : currency(movement.total_cost)}</TableCell><TableCell className="max-w-sm whitespace-normal">{movement.notes ?? "Sem justificativa"}</TableCell></TableRow>)}</TableBody></Table>}
      </section>
    </>}
  </div>;
}
