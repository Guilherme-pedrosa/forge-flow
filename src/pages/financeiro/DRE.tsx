import { useState, useMemo } from "react";
import { allRows, localDate, validDate } from "@/lib/finance";
import { calculateFinancialResult } from "@/lib/financial-result";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function getDefaultPeriod() {
  const now = new Date();
  const start = localDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = localDate(now);
  return { start, end };
}

export default function DRE() {
  const { profile } = useAuth();
  const defaultPeriod = getDefaultPeriod();
  const [startDate, setStartDate] = useState(defaultPeriod.start);
  const [endDate, setEndDate] = useState(defaultPeriod.end);

  const periodValid = validDate(startDate) && validDate(endDate) && startDate <= endDate;

  const { data: receivables = [], isLoading: loadingAR, error: errorAR } = useQuery({
    queryKey: ["dre_ar", profile?.tenant_id, startDate, endDate],
    queryFn: async () => {
      const data = await allRows<any>((from, to) => supabase.from("accounts_receivable").select("*").order("id").range(from, to));
      return data.filter(r => { const date = r.competence_date || r.created_at.slice(0, 10); return date >= startDate && date <= endDate; });
    },
    enabled: !!profile && periodValid,
  });

  const { data: payables = [], isLoading: loadingAP, error: errorAP } = useQuery({
    queryKey: ["dre_ap", profile?.tenant_id, startDate, endDate],
    queryFn: async () => {
      const data = await allRows<any>((from, to) => supabase.from("accounts_payable").select("*,chart_of_accounts(account_type)").order("id").range(from, to));
      return data.filter(r => { const date = r.competence_date || r.created_at.slice(0, 10); return date >= startDate && date <= endDate; });
    },
    enabled: !!profile && periodValid,
  });

  const { data: jobs = [], isLoading: loadingJobs, error: errorJobs } = useQuery({
    queryKey: ["dre_jobs", profile?.tenant_id, startDate, endDate],
    queryFn: async () => {
      const data = await allRows<any>((from, to) => supabase.from("jobs").select("*").in("status", ["completed", "shipped", "failed"]).order("id").range(from, to));
      return data.filter(j => { const date = j.completed_at?.slice(0, 10) || (j.status === "failed" ? j.updated_at?.slice(0, 10) : null) || j.created_at?.slice(0, 10); return date >= startDate && date <= endDate; });
    },
    enabled: !!profile && periodValid,
  });

  const { data: purchaseItems = [], isLoading: loadingItems, error: errorItems } = useQuery({
    queryKey: ["dre_purchase_items", profile?.tenant_id],
    queryFn: () => allRows<any>((from, to) => supabase.from("purchase_order_items").select("purchase_order_id,inventory_item_id,total").order("id").range(from, to)),
    enabled: !!profile && periodValid,
  });
  const isLoading = loadingAR || loadingAP || loadingJobs || loadingItems;

  const hasError = errorAR || errorAP || errorJobs || errorItems;
  const dre = useMemo(() => calculateFinancialResult(receivables, payables, jobs, purchaseItems), [receivables, payables, jobs, purchaseItems]);

  const lines = [
    { label: "RECEITA OPERACIONAL", value: dre.totalRevenue, bold: true, section: true },
    { label: "Títulos a receber por competência", value: dre.totalRevenue, indent: true, sub: `${dre.titleCount} títulos · recebidos e em aberto` },
    { label: "", value: 0, separator: true },
    { label: "(-) CUSTOS DE PRODUÇÃO E PERDAS", value: -dre.totalCMV, bold: true, section: true, negative: true },
    { label: "Material / Filamento", value: dre.materialCost, indent: true },
    { label: "Máquina (depreciação + manutenção)", value: dre.machineCost, indent: true },
    { label: "Energia", value: dre.energyCost, indent: true },
    { label: "Mão de obra", value: dre.laborCost, indent: true },
    { label: "Overhead", value: dre.overheadCost, indent: true },
    { label: "Custos extras", value: dre.extrasCost, indent: true },
    { label: "Ajustes do custo total apurado", value: dre.costAdjustment, indent: true },
    { label: "", value: 0, separator: true },
    { label: "RESULTADO BRUTO APURADO", value: dre.grossProfit, bold: true, highlight: true, sub: dre.grossMargin == null ? "Margem indisponível enquanto houver pendências" : `${dre.grossMargin.toFixed(1)}% margem` },
    { label: "", value: 0, separator: true },
    { label: "(-) DESPESAS OPERACIONAIS", value: -dre.opExpenses, bold: true, section: true, negative: true },
    { label: "Despesas por competência (pagas e em aberto)", value: dre.opExpenses, indent: true },
    { label: "", value: 0, separator: true },
    { label: dre.isPartial ? "RESULTADO PARCIAL — COM PENDÊNCIAS" : "RESULTADO GERENCIAL", value: dre.netResult, bold: true, highlight: true, final: true },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="DRE gerencial" description="Receitas e despesas por competência, com custos da produção e perdas apuradas."
        breadcrumbs={[{ label: "Financeiro" }, { label: "DRE" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><a href="/financeiro/pagar">Contas a Pagar</a></Button>
            <Button variant="outline" size="sm" asChild><a href="/financeiro/receber">Contas a Receber</a></Button>
          </div>
        }
      />

      {/* Period Filter */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="grid gap-1.5">
          <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> De</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[160px] h-8 text-sm" />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[160px] h-8 text-sm" />
        </div>
      </div>

      {!periodValid && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Informe um período válido: a data inicial deve ser anterior ou igual à final.</p>}
      {hasError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Não foi possível carregar todas as fontes. O resultado está indisponível para evitar totais incompletos.</p>}
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground space-y-2">
        <p>Receitas vêm dos títulos financeiros. O preço dos jobs não é somado novamente. Aquisições vinculadas ao estoque ou classificadas fora de despesas ({fmtCurrency(dre.excludedPurchases)}) não são descontadas novamente.</p>
        <p>Custos incluem produção concluída e falhas apuradas ({fmtCurrency(dre.failedCost)} em perdas). Produção em andamento permanece fora desta apuração; diferenças entre produção, entrega e receita devem ser conciliadas no fechamento.</p>
        {dre.isPartial && <p className="font-semibold text-amber-800">Apuração parcial. As margens ficam indisponíveis até a revisão das pendências abaixo.</p>}
        {dre.unknownPurchaseAmount > 0 && <p className="text-amber-800">{fmtCurrency(dre.unknownPurchaseAmount)} em compras ainda sem vínculo de estoque ou classificação contábil estão pendentes, fora do resultado parcial. Podem conter serviços e outras despesas. Revise a origem dos títulos e os itens da compra antes de considerar lucro.</p>}
        {dre.unmeasuredFailedCount > 0 && <p className="text-amber-800">{dre.unmeasuredFailedCount} falhas não têm custo total real apurado. Não foi usado o custo estimado de uma peça concluída para inventar o valor da perda.</p>}
        {dre.missingFailureDateCount > 0 && <p className="text-amber-800">{dre.missingFailureDateCount} falhas antigas não têm data de conclusão registrada; foi usada a última atualização para selecionar o período. Confira a competência dessas perdas.</p>}
        {dre.estimatedCount > 0 && <p className="text-amber-700">{dre.estimatedCount} jobs usam algum custo estimado: finalize o apontamento dos custos reais.</p>}
        {dre.unclassifiedCount > 0 && <p className="text-amber-700">{dre.unclassifiedCount} despesas sem plano de contas ({fmtCurrency(dre.unclassifiedExpenseAmount)}) estão incluídas no resultado parcial. Classifique antes do fechamento.</p>}
        {dre.missingCompetenceCount > 0 && <p className="text-amber-700">{dre.missingCompetenceCount} títulos antigos não têm competência; foi usada a data de cadastro.</p>}
      </div>
      {periodValid && !hasError && <>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Receita</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(dre.totalRevenue)}</p>
          <p className="text-xs text-muted-foreground">{dre.titleCount} títulos por competência</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Custos de produção</p>
          <p className="text-2xl font-bold text-destructive">{fmtCurrency(dre.totalCMV)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Lucro Bruto</p>
          <p className={cn("text-2xl font-bold", dre.grossProfit >= 0 ? "text-foreground" : "text-destructive")}>{fmtCurrency(dre.grossProfit)}</p>
          <p className="text-xs text-muted-foreground">{dre.grossMargin == null ? "Margem indisponível" : `Margem ${dre.grossMargin.toFixed(1)}%`}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">{dre.isPartial ? "Resultado parcial" : "Resultado gerencial"}</p>
          <p className={cn("text-2xl font-bold", dre.netResult >= 0 ? "text-foreground" : "text-destructive")}>{fmtCurrency(dre.netResult)}</p>
          <p className="text-xs text-muted-foreground">{dre.netMargin == null ? "Margem indisponível" : `Margem ${dre.netMargin.toFixed(1)}%`}</p>
        </div>
      </div>

      {/* DRE Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y">
            {lines.map((line, i) => {
              if (line.separator) return <div key={i} className="h-px bg-border" />;
              return (
                <div key={i} className={cn(
                  "flex items-center justify-between px-6 py-3",
                  line.highlight && "bg-muted/50",
                  line.final && "bg-primary/5",
                  line.section && "bg-muted/30",
                )}>
                  <div className="flex flex-col">
                    <span className={cn(
                      "text-sm",
                      line.bold ? "font-semibold text-foreground" : "text-muted-foreground",
                      line.indent && "pl-4",
                      line.section && "text-xs uppercase tracking-wider",
                    )}>
                      {line.label}
                    </span>
                    {line.sub && (
                      <span className="text-[10px] text-muted-foreground pl-4">{line.sub}</span>
                    )}
                  </div>
                  <span className={cn(
                    "font-mono text-sm",
                    line.bold && "font-semibold",
                    (line.highlight || line.final) && (line.value >= 0 ? "text-emerald-600" : "text-destructive"),
                    line.negative && "text-destructive",
                  )}>
                    {line.negative ? `(${fmtCurrency(Math.abs(line.value))})` : fmtCurrency(line.value)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>}
    </div>
  );
}
