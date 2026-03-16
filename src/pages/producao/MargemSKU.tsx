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
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

interface SkuMetrics {
  productId: string;
  productName: string;
  sku: string | null;
  jobCount: number;
  totalRevenue: number;
  totalEstCost: number;
  totalActualCost: number;
  avgEstMargin: number;
  avgRealMargin: number;
  marginDrift: number; // real - estimated
  avgGrams: number;
  avgTimeMin: number;
}

export default function MargemSKU() {
  const { profile } = useAuth();

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["margin_sku_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("product_id, sale_price, est_total_cost, actual_total_cost, est_grams, actual_grams, est_time_minutes, actual_time_minutes, margin_percent, status, products(id, name, sku)")
        .in("status", ["completed", "shipped"]);
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const metrics = useMemo(() => {
    const byProduct = new Map<string, SkuMetrics>();

    for (const j of jobs as any[]) {
      const pid = j.product_id || "__no_product__";
      const pName = j.products?.name || "Sem produto";
      const pSku = j.products?.sku || null;

      if (!byProduct.has(pid)) {
        byProduct.set(pid, {
          productId: pid,
          productName: pName,
          sku: pSku,
          jobCount: 0,
          totalRevenue: 0,
          totalEstCost: 0,
          totalActualCost: 0,
          avgEstMargin: 0,
          avgRealMargin: 0,
          marginDrift: 0,
          avgGrams: 0,
          avgTimeMin: 0,
        });
      }

      const m = byProduct.get(pid)!;
      m.jobCount++;
      m.totalRevenue += j.sale_price || 0;
      m.totalEstCost += j.est_total_cost || 0;
      m.totalActualCost += j.actual_total_cost || 0;
      m.avgGrams += j.actual_grams || j.est_grams || 0;
      m.avgTimeMin += j.actual_time_minutes || j.est_time_minutes || 0;
    }

    const result: SkuMetrics[] = [];
    for (const m of byProduct.values()) {
      if (m.jobCount === 0) continue;
      m.avgGrams /= m.jobCount;
      m.avgTimeMin /= m.jobCount;
      m.avgEstMargin = m.totalRevenue > 0
        ? ((m.totalRevenue - m.totalEstCost) / m.totalRevenue) * 100
        : 0;
      m.avgRealMargin = m.totalRevenue > 0
        ? ((m.totalRevenue - m.totalActualCost) / m.totalRevenue) * 100
        : 0;
      m.marginDrift = m.avgRealMargin - m.avgEstMargin;
      result.push(m);
    }

    return result.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [jobs]);

  const totals = useMemo(() => {
    const t = { revenue: 0, estCost: 0, actualCost: 0, jobs: 0 };
    for (const m of metrics) {
      t.revenue += m.totalRevenue;
      t.estCost += m.totalEstCost;
      t.actualCost += m.totalActualCost;
      t.jobs += m.jobCount;
    }
    return {
      ...t,
      estMargin: t.revenue > 0 ? ((t.revenue - t.estCost) / t.revenue) * 100 : 0,
      realMargin: t.revenue > 0 ? ((t.revenue - t.actualCost) / t.revenue) * 100 : 0,
    };
  }, [metrics]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Margem por SKU"
        description="Análise de margem real vs estimada por produto"
        breadcrumbs={[{ label: "Produção" }, { label: "Margem por SKU" }]}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Receita Total</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(totals.revenue)}</p>
          <p className="text-xs text-muted-foreground">{totals.jobs} jobs concluídos</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Custo Real Total</p>
          <p className="text-2xl font-bold text-destructive">{fmtCurrency(totals.actualCost)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Margem Estimada</p>
          <p className="text-2xl font-bold text-foreground">{fmtPct(totals.estMargin)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Margem Real</p>
          <p className={cn("text-2xl font-bold", totals.realMargin >= totals.estMargin ? "text-emerald-600" : "text-destructive")}>
            {fmtPct(totals.realMargin)}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {totals.realMargin >= totals.estMargin
              ? <><TrendingUp className="h-3 w-3 text-emerald-600" /> acima do estimado</>
              : <><TrendingDown className="h-3 w-3 text-destructive" /> abaixo do estimado</>
            }
          </p>
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
                <TableHead className="text-right">Drift</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((m) => (
                <TableRow key={m.productId}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-foreground">{m.productName}</span>
                      {m.sku && <span className="ml-2 text-xs text-muted-foreground font-mono">{m.sku}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-center font-mono">{m.jobCount}</TableCell>
                  <TableCell className="text-right font-mono">{fmtCurrency(m.totalRevenue)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtCurrency(m.totalEstCost)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtCurrency(m.totalActualCost)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtPct(m.avgEstMargin)}</TableCell>
                  <TableCell className={cn("text-right font-mono font-semibold", m.avgRealMargin >= 0 ? "text-emerald-600" : "text-destructive")}>
                    {fmtPct(m.avgRealMargin)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={cn(
                      "inline-flex items-center gap-1 text-xs font-mono font-semibold",
                      m.marginDrift >= 0 ? "text-emerald-600" : "text-destructive"
                    )}>
                      {m.marginDrift >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {m.marginDrift >= 0 ? "+" : ""}{fmtPct(m.marginDrift)}
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
