import { Button } from "@/components/ui/button";
import { readProductionRows } from "@/lib/production-read";
import { productionMargins } from "@/lib/production-margin";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, TrendingUp, TrendingDown, BarChart3, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = (v: number | null) => v == null ? "Pendente" : `${v.toFixed(1)}%`;

export default function MargemSKU() {
  const { profile } = useAuth();

  const { data: jobs = [], isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["margin_sku_jobs"],
    queryFn: async () => {
      return readProductionRows((from, to) => supabase
        .from("jobs")
        .select("product_id, sale_price, est_total_cost, actual_total_cost, est_grams, actual_grams, est_time_minutes, actual_time_minutes, margin_percent, status, products(id, name, sku)")
        .in("status", ["completed", "shipped", "failed"]).order("id").range(from, to));
    },
    enabled: !!profile,
  });

  const metrics = useMemo(() => productionMargins(jobs), [jobs]);

  const totals = useMemo(() => {
    const t = { revenue: 0, estCost: 0, actualCost: 0, jobs: 0, missingActual: 0, missingEstimate: 0, unpriced: 0, failed: 0 };
    for (const m of metrics) {
      t.revenue += m.totalRevenue;
      t.estCost += m.totalEstCost;
      t.actualCost += m.totalActualCost;
      t.jobs += m.jobCount;
      t.missingActual += m.missingActual;
      t.missingEstimate += m.missingEstimate;
      t.unpriced += m.unpriced;
      t.failed += m.failedCount;
    }
    return {
      ...t,
      estMargin: !t.missingEstimate && !t.unpriced && t.revenue > 0 ? ((t.revenue - t.estCost) / t.revenue) * 100 : null,
      realMargin: !t.missingActual && !t.unpriced && t.revenue > 0 ? ((t.revenue - t.actualCost) / t.revenue) * 100 : null,
    };
  }, [metrics]);

  if (loadError) return <div className="space-y-4 rounded-xl border bg-card p-6"><p role="alert" className="font-medium">Não foi possível carregar os dados.</p><p className="text-sm text-muted-foreground">{loadError.message}</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Margem por SKU"
        description="Margem industrial da receita atribuída às ordens. Inclui o custo das tentativas que falharam, sem duplicar receita. Custos sem apuração ficam pendentes."
        breadcrumbs={[{ label: "Produção" }, { label: "Margem por SKU" }]}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Receita atribuída</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(totals.revenue)}</p>
          <p className="text-xs text-muted-foreground">{totals.jobs} ordens concluídas · {totals.failed} falhas</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Custo real apurado</p>
          <p className="text-2xl font-bold text-destructive">{fmtCurrency(totals.actualCost)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Margem Estimada</p>
          <p className="text-2xl font-bold text-foreground">{fmtPct(totals.estMargin)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Margem Real</p>
          <p className={cn("text-2xl font-bold", (totals.realMargin ?? -Infinity) >= (totals.estMargin ?? Infinity) ? "text-emerald-600" : "text-destructive")}>
            {fmtPct(totals.realMargin)}
          </p>
          <p className="text-xs text-muted-foreground">{totals.jobs === 0 ? "Nenhuma ordem concluída" : totals.missingActual > 0 ? `${totals.missingActual} ordens sem custo real` : totals.unpriced > 0 ? `${totals.unpriced} ordens sem receita atribuída` : "Apuração completa"}</p>
          {totals.realMargin != null && totals.estMargin != null && <p className="text-xs text-muted-foreground flex items-center gap-1">
            {(totals.realMargin ?? -Infinity) >= (totals.estMargin ?? Infinity)
              ? <><TrendingUp className="h-3 w-3 text-emerald-600" /> acima do estimado</>
              : <><TrendingDown className="h-3 w-3 text-destructive" /> abaixo do estimado</>
            }
          </p>}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : metrics.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-8 w-8 mb-2" />
            <p className="text-sm">Nenhum job concluído para análise</p>
            <p className="text-xs">Complete jobs para ver a margem real por SKU</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-center">Jobs</TableHead>
                <TableHead className="text-right">Receita</TableHead>
                <TableHead className="text-right">Custo Est.</TableHead>
                <TableHead className="text-right">Custo Real</TableHead>
                <TableHead className="text-right">Margem Est.</TableHead>
                <TableHead className="text-right">Margem Real</TableHead>
                <TableHead className="text-right">Desvio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m) => (
                 <TableRow key={m.productId} className="cursor-pointer hover:bg-muted/50" onClick={() => {
                   if (m.productId !== "__no_product__") {
                     window.location.href = "/comercial/produtos";
                   }
                 }}>
                   <TableCell>
                     <div>
                       <span className="font-medium text-foreground">{m.productName}</span>
                       {m.sku && <span className="ml-2 text-xs text-muted-foreground font-mono">{m.sku}</span>}
                       <span className="block text-[11px] text-primary hover:underline">Ver produto →</span>
                     </div>
                  </TableCell>
                  <TableCell className="text-center font-mono">{m.jobCount}{m.failedCount > 0 && <span className="block text-xs text-destructive">+ {m.failedCount} falhas</span>}</TableCell>
                  <TableCell className="text-right font-mono">{fmtCurrency(m.totalRevenue)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtCurrency(m.totalEstCost)}</TableCell>
                  <TableCell className="text-right font-mono">{m.missingActual ? `${fmtCurrency(m.totalActualCost)} · parcial` : fmtCurrency(m.totalActualCost)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtPct(m.avgEstMargin)}</TableCell>
                  <TableCell className={cn("text-right font-mono font-semibold", (m.avgRealMargin ?? -Infinity) >= 0 ? "text-emerald-600" : "text-destructive")}>
                    {fmtPct(m.avgRealMargin)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={cn(
                      "inline-flex items-center gap-1 text-xs font-mono font-semibold",
                      (m.marginDrift ?? -Infinity) >= 0 ? "text-emerald-600" : "text-destructive"
                    )}>
                      {m.marginDrift != null && ((m.marginDrift ?? -Infinity) >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
                      {(m.marginDrift ?? -Infinity) >= 0 ? "+" : ""}{fmtPct(m.marginDrift)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
