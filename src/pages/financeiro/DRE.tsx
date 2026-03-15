import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function DRE() {
  const { profile } = useAuth();

  const { data: receivables = [], isLoading: loadingAR } = useQuery({
    queryKey: ["accounts_receivable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts_receivable").select("amount, amount_received, status");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: payables = [], isLoading: loadingAP } = useQuery({
    queryKey: ["accounts_payable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts_payable").select("amount, amount_paid, status");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: jobs = [], isLoading: loadingJobs } = useQuery({
    queryKey: ["jobs_dre"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("sale_price, actual_total_cost, est_total_cost, status");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const isLoading = loadingAR || loadingAP || loadingJobs;

  const dre = useMemo(() => {
    const revenue = receivables.reduce((s, r) => s + (r.amount_received || 0), 0);
    const jobRevenue = jobs.reduce((s, j) => s + (j.sale_price || 0), 0);
    const totalRevenue = Math.max(revenue, jobRevenue);

    const expenses = payables.reduce((s, p) => s + (p.amount_paid || 0), 0);
    const jobCosts = jobs.reduce((s, j) => s + (j.actual_total_cost || j.est_total_cost || 0), 0);
    const totalExpenses = Math.max(expenses, jobCosts);

    const grossProfit = totalRevenue - totalExpenses;
    const margin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return { totalRevenue, totalExpenses, grossProfit, margin };
  }, [receivables, payables, jobs]);

  const lines = [
    { label: "Receita Bruta", value: dre.totalRevenue, bold: true },
    { label: "  Recebíveis (clientes)", value: receivables.reduce((s, r) => s + (r.amount_received || 0), 0), indent: true },
    { label: "  Vendas (jobs)", value: jobs.reduce((s, j) => s + (j.sale_price || 0), 0), indent: true },
    { label: "(-) Custos e Despesas", value: -dre.totalExpenses, bold: true, negative: true },
    { label: "  Contas a Pagar", value: payables.reduce((s, p) => s + (p.amount_paid || 0), 0), indent: true },
    { label: "  Custos de Produção", value: jobs.reduce((s, j) => s + (j.actual_total_cost || j.est_total_cost || 0), 0), indent: true },
    { label: "Resultado Líquido", value: dre.grossProfit, bold: true, highlight: true },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="DRE" description="Demonstrativo de Resultado do Exercício"
        breadcrumbs={[{ label: "Financeiro" }, { label: "DRE" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Receita Total</p><p className="text-2xl font-bold text-foreground">{fmtCurrency(dre.totalRevenue)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Despesas Totais</p><p className="text-2xl font-bold text-destructive">{fmtCurrency(dre.totalExpenses)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Margem</p><p className={cn("text-2xl font-bold", dre.margin >= 0 ? "text-foreground" : "text-destructive")}>{dre.margin.toFixed(1)}%</p></div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y">
            {lines.map((line, i) => (
              <div key={i} className={cn("flex items-center justify-between px-6 py-3", line.highlight && "bg-muted/50")}>
                <span className={cn("text-sm", line.bold ? "font-semibold text-foreground" : "text-muted-foreground", line.indent && "pl-4")}>
                  {line.label}
                </span>
                <span className={cn(
                  "font-mono text-sm",
                  line.bold && "font-semibold",
                  line.highlight && (line.value >= 0 ? "text-emerald-600" : "text-destructive"),
                  line.negative && "text-destructive",
                )}>
                  {line.negative ? `(${fmtCurrency(Math.abs(line.value))})` : fmtCurrency(line.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
