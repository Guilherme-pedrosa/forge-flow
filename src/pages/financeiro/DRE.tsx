import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function getDefaultPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

export default function DRE() {
  const { profile } = useAuth();
  const defaultPeriod = getDefaultPeriod();
  const [startDate, setStartDate] = useState(defaultPeriod.start);
  const [endDate, setEndDate] = useState(defaultPeriod.end);

  const { data: receivables = [], isLoading: loadingAR } = useQuery({
    queryKey: ["dre_ar", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_receivable")
        .select("amount, amount_received, status, receipt_date, competence_date, created_at")
        .or(`competence_date.gte.${startDate},receipt_date.gte.${startDate}`)
        .or(`competence_date.lte.${endDate},receipt_date.lte.${endDate}`);
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: payables = [], isLoading: loadingAP } = useQuery({
    queryKey: ["dre_ap", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts_payable")
        .select("amount, amount_paid, status, payment_date, competence_date, created_at, description")
        .or(`competence_date.gte.${startDate},payment_date.gte.${startDate}`)
        .or(`competence_date.lte.${endDate},payment_date.lte.${endDate}`);
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: jobs = [], isLoading: loadingJobs } = useQuery({
    queryKey: ["dre_jobs", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("sale_price, actual_total_cost, est_total_cost, actual_material_cost, est_material_cost, actual_machine_cost, est_machine_cost, actual_energy_cost, est_energy_cost, actual_labor_cost, est_labor_cost, actual_overhead, est_overhead, status, completed_at, created_at")
        .in("status", ["completed", "shipped"]);
      if (error) throw error;
      // Filter by period based on completed_at
      return data.filter((j: any) => {
        const d = j.completed_at?.slice(0, 10) || j.created_at?.slice(0, 10);
        return d >= startDate && d <= endDate;
      });
    },
    enabled: !!profile,
  });

  const isLoading = loadingAR || loadingAP || loadingJobs;

  const dre = useMemo(() => {
    // ── RECEITAS ──
    // Receita de vendas (jobs concluídos com preço de venda)
    const salesRevenue = jobs.reduce((s, j: any) => s + (j.sale_price || 0), 0);
    // Receita de recebíveis (valores efetivamente recebidos)
    const arRevenue = receivables.reduce((s, r: any) => s + (r.amount_received || 0), 0);
    // Receita bruta = o maior entre AR e vendas (evitar dupla contagem quando AR já reflete as vendas)
    // MAS agora mostramos ambos para transparência
    const totalRevenue = salesRevenue || arRevenue; // Preferir sales se existir

    // ── CUSTOS DE PRODUÇÃO (CMV) ──
    const materialCost = jobs.reduce((s, j: any) => s + (j.actual_material_cost || j.est_material_cost || 0), 0);
    const machineCost = jobs.reduce((s, j: any) => s + (j.actual_machine_cost || j.est_machine_cost || 0), 0);
    const energyCost = jobs.reduce((s, j: any) => s + (j.actual_energy_cost || j.est_energy_cost || 0), 0);
    const laborCost = jobs.reduce((s, j: any) => s + (j.actual_labor_cost || j.est_labor_cost || 0), 0);
    const overheadCost = jobs.reduce((s, j: any) => s + (j.actual_overhead || j.est_overhead || 0), 0);
    const totalCMV = materialCost + machineCost + energyCost + laborCost + overheadCost;

    // ── LUCRO BRUTO ──
    const grossProfit = totalRevenue - totalCMV;

    // ── DESPESAS OPERACIONAIS (contas a pagar que NÃO são custo de produção) ──
    const opExpenses = payables.reduce((s, p: any) => s + (p.amount_paid || 0), 0);

    // ── RESULTADO LÍQUIDO ──
    const netResult = grossProfit - opExpenses;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netMargin = totalRevenue > 0 ? (netResult / totalRevenue) * 100 : 0;

    return {
      salesRevenue, arRevenue, totalRevenue,
      materialCost, machineCost, energyCost, laborCost, overheadCost, totalCMV,
      grossProfit, grossMargin,
      opExpenses,
      netResult, netMargin,
      jobCount: jobs.length,
    };
  }, [receivables, payables, jobs]);

  const lines = [
    { label: "RECEITA OPERACIONAL", value: dre.totalRevenue, bold: true, section: true },
    { label: "Vendas / Jobs concluídos", value: dre.salesRevenue, indent: true, sub: `${dre.jobCount} jobs` },
    { label: "Recebimentos (clientes)", value: dre.arRevenue, indent: true },
    { label: "", value: 0, separator: true },
    { label: "(-) CUSTO DOS PRODUTOS VENDIDOS", value: -dre.totalCMV, bold: true, section: true, negative: true },
    { label: "Material / Filamento", value: dre.materialCost, indent: true },
    { label: "Máquina (depreciação + manutenção)", value: dre.machineCost, indent: true },
    { label: "Energia", value: dre.energyCost, indent: true },
    { label: "Mão de obra", value: dre.laborCost, indent: true },
    { label: "Overhead", value: dre.overheadCost, indent: true },
    { label: "", value: 0, separator: true },
    { label: "LUCRO BRUTO", value: dre.grossProfit, bold: true, highlight: true, sub: `${dre.grossMargin.toFixed(1)}% margem` },
    { label: "", value: 0, separator: true },
    { label: "(-) DESPESAS OPERACIONAIS", value: -dre.opExpenses, bold: true, section: true, negative: true },
    { label: "Contas a Pagar (pagas no período)", value: dre.opExpenses, indent: true },
    { label: "", value: 0, separator: true },
    { label: "RESULTADO LÍQUIDO", value: dre.netResult, bold: true, highlight: true, final: true },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="DRE" description="Demonstrativo de Resultado do Exercício"
        breadcrumbs={[{ label: "Financeiro" }, { label: "DRE" }]}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Receita</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(dre.totalRevenue)}</p>
          <p className="text-xs text-muted-foreground">{dre.jobCount} jobs concluídos</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">CMV</p>
          <p className="text-2xl font-bold text-destructive">{fmtCurrency(dre.totalCMV)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Lucro Bruto</p>
          <p className={cn("text-2xl font-bold", dre.grossProfit >= 0 ? "text-foreground" : "text-destructive")}>{fmtCurrency(dre.grossProfit)}</p>
          <p className="text-xs text-muted-foreground">Margem {dre.grossMargin.toFixed(1)}%</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Resultado Líquido</p>
          <p className={cn("text-2xl font-bold", dre.netResult >= 0 ? "text-foreground" : "text-destructive")}>{fmtCurrency(dre.netResult)}</p>
          <p className="text-xs text-muted-foreground">Margem {dre.netMargin.toFixed(1)}%</p>
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
    </div>
  );
}
