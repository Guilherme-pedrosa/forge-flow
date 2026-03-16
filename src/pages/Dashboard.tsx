import { useState, useEffect } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ArgusBanner } from "@/components/shared/ArgusBanner";
import {
  DollarSign,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Wallet,
  Package,
  Printer,
  ArrowRight,
  RefreshCw,
  ShoppingCart,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";

const fmtCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const statusColors: Record<string, string> = {
  printing: "bg-primary/10 text-primary border border-primary/20",
  queued: "bg-blue-500/10 text-blue-600 border border-blue-500/20",
  draft: "bg-muted text-muted-foreground border border-border",
  completed: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
  ready: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
  failed: "bg-red-500/10 text-red-600 border border-red-500/20",
  paused: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
  post_processing: "bg-violet-500/10 text-violet-600 border border-violet-500/20",
  quality_check: "bg-cyan-500/10 text-cyan-600 border border-cyan-500/20",
  open: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
  overdue: "bg-red-500/10 text-red-600 border border-red-500/20",
  partial: "bg-orange-500/10 text-orange-600 border border-orange-500/20",
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  printing: "Imprimindo",
  paused: "Pausado",
  failed: "Falhou",
  reprint: "Reimpressão",
  post_processing: "Pós-processo",
  quality_check: "Controle Qual.",
  ready: "Pronto",
  shipped: "Enviado",
  completed: "Concluído",
  open: "Aberto",
  overdue: "Vencido",
  partial: "Parcial",
  paid: "Pago",
};

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dollar: Wallet,
  cart: ShoppingCart,
  alert: AlertTriangle,
  box: Package,
};

interface DashboardData {
  cashBalance: number;
  activeJobs: number;
  lossRate: number;
  avgMargin: number;
  recentJobs: any[];
  pendingPayables: any[];
  inventoryAlerts: any[];
  argusMessage: string | null;
  completedJobCount: number;
  orderPipeline: Record<string, number>;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData>({
    cashBalance: 0,
    activeJobs: 0,
    lossRate: 0,
    avgMargin: 0,
    recentJobs: [],
    pendingPayables: [],
    inventoryAlerts: [],
    argusMessage: null,
    completedJobCount: 0,
    orderPipeline: {},
  });

  const tenantId = profile?.tenant_id;

  const fetchDashboard = async () => {
    if (!tenantId) return;

    try {
      const [
        jobsRes,
        completedJobsRes,
        payablesRes,
        inventoryRes,
        bankRes,
        productsRes,
        ordersRes,
      ] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, code, name, status, est_grams, est_time_minutes, printer_id, printers(name), inventory_items!jobs_material_id_fkey(name)")
          .order("created_at", { ascending: false })
          .limit(5),
        // Completed jobs for real margin
        supabase
          .from("jobs")
          .select("sale_price, actual_total_cost, est_total_cost, status")
          .in("status", ["completed", "shipped"]),
        supabase
          .from("accounts_payable")
          .select("id, description, due_date, amount, amount_paid, status")
          .in("status", ["open", "partial", "overdue"])
          .order("due_date", { ascending: true })
          .limit(5),
        supabase
          .from("inventory_items")
          .select("id, name, current_stock, min_stock, brand, unit")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("bank_accounts")
          .select("current_balance")
          .eq("is_active", true),
        supabase
          .from("products")
          .select("margin_percent, sale_price")
          .eq("is_active", true),
        // Orders pipeline
        supabase
          .from("orders")
          .select("status")
          .not("status", "eq", "cancelled"),
      ]);

      const cashBalance = (bankRes.data || []).reduce((sum, b) => sum + Number(b.current_balance || 0), 0);

      const allJobs = jobsRes.data || [];
      const activeJobs = allJobs.filter((j) =>
        ["queued", "printing", "paused", "post_processing", "quality_check"].includes(j.status)
      ).length;

      // Real margin from completed jobs
      const completed = completedJobsRes.data || [];
      const totalRevenue = completed.reduce((s, j: any) => s + (j.sale_price || 0), 0);
      const totalActualCost = completed.reduce((s, j: any) => s + (j.actual_total_cost || j.est_total_cost || 0), 0);
      const realMargin = totalRevenue > 0 ? ((totalRevenue - totalActualCost) / totalRevenue) * 100 : 0;

      const alerts = (inventoryRes.data || []).filter(
        (item) => item.min_stock != null && item.current_stock < item.min_stock
      );

      const finishedJobs = allJobs.filter((j) => ["completed", "failed"].includes(j.status));
      const failedJobs = allJobs.filter((j) => j.status === "failed");
      const lossRate = finishedJobs.length > 0 ? (failedJobs.length / finishedJobs.length) * 100 : 0;

      // Order pipeline counts
      const ordersList = ordersRes.data || [];
      const orderPipeline = {
        draft: ordersList.filter(o => o.status === "draft").length,
        approved: ordersList.filter(o => o.status === "approved").length,
        in_production: ordersList.filter(o => o.status === "in_production").length,
        ready: ordersList.filter(o => o.status === "ready").length,
        shipped: ordersList.filter(o => o.status === "shipped").length,
      };

      let argusMessage: string | null = null;
      if (alerts.length > 0) {
        const names = alerts.slice(0, 2).map((a) => a.name).join(", ");
        argusMessage = `${alerts.length} item(ns) de estoque abaixo do mínimo: ${names}. Considere criar pedido de reposição.`;
      }

      const today = new Date().toISOString().split("T")[0];
      const formattedPayables = (payablesRes.data || []).map((p) => ({
        ...p,
        status: p.status === "open" && p.due_date < today ? "overdue" : p.status,
      }));

      setData({
        cashBalance,
        activeJobs,
        lossRate,
        avgMargin: realMargin,
        recentJobs: allJobs,
        pendingPayables: formattedPayables,
        inventoryAlerts: alerts,
        argusMessage,
        completedJobCount: completed.length,
        orderPipeline,
      });
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchDashboard();
    setIsRefreshing(false);
  };

  const kpis = [
    { id: "cash", title: "Saldo em Caixa", value: data.cashBalance, icon: "dollar" as const, format: "currency" as const },
    { id: "jobs", title: "Jobs Ativos", value: data.activeJobs, icon: "cart" as const, format: "number" as const },
    { id: "loss", title: "Taxa de Perda", value: data.lossRate, icon: "alert" as const, format: "percent" as const },
    { id: "margin", title: "Margem Real", value: data.avgMargin, icon: "box" as const, format: "percent" as const },
  ];

  const fmtDuration = (minutes: number | null) => {
    if (!minutes) return "—";
    const h = minutes / 60;
    return `${h.toFixed(1)}h`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Visão geral da sua operação de impressão 3D"
        actions={
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} className="bg-card border-border">
            <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
            Atualizar
          </Button>
        }
      />

      {/* Argus AI Banner */}
      {data.argusMessage && (
        <ArgusBanner
          message={data.argusMessage}
          actionLabel="Ver estoque"
          type="warning"
        />
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = iconMap[kpi.icon];
          return (
            <div key={kpi.id} className="kpi-card p-6">
              <div className="kpi-card-title">
                <Icon className="h-4 w-4" />
                <span className="uppercase tracking-wide">{kpi.title}</span>
              </div>
              <div className="kpi-card-value mb-1 tabular-nums">
                {kpi.format === "currency"
                  ? fmtCurrency(kpi.value)
                  : kpi.format === "percent"
                  ? `${kpi.value.toFixed(1)}%`
                  : kpi.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Jobs Table */}
        <div className="lg:col-span-2 card-enterprise !p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Jobs Recentes</h3>
            </div>
            <Link to="/producao/jobs" className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
              Ver todos <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {data.recentJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Inbox className="h-8 w-8 mb-2" />
              <p className="text-sm">Nenhum job cadastrado ainda</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-enterprise">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Job</th>
                    <th>Impressora</th>
                    <th>Material</th>
                    <th className="text-right">Gramas</th>
                    <th className="text-right">Tempo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentJobs.map((job) => (
                    <tr key={job.id} className="cursor-pointer">
                      <td className="font-mono text-muted-foreground text-xs">{job.code}</td>
                      <td className="font-medium text-foreground">{job.name}</td>
                      <td className="text-muted-foreground text-xs">
                        {(job as any).printers?.name || "—"}
                      </td>
                      <td className="text-muted-foreground">
                        {(job as any).inventory_items?.name || "—"}
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        {job.est_grams ? `${job.est_grams}g` : "—"}
                      </td>
                      <td className="text-right font-mono text-muted-foreground tabular-nums">
                        {fmtDuration(job.est_time_minutes)}
                      </td>
                      <td>
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                          statusColors[job.status] || "bg-muted text-muted-foreground border border-border"
                        )}>
                          {statusLabels[job.status] || job.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Payables */}
          <div className="card-enterprise !p-0 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Contas a Pagar</h3>
              </div>
              <Link to="/financeiro/pagar" className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
                Ver todas <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {data.pendingPayables.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Inbox className="h-6 w-6 mb-1" />
                <p className="text-xs">Nenhuma conta pendente</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.pendingPayables.map((p) => (
                  <div key={p.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{p.description}</p>
                      <p className="text-xs text-muted-foreground">
                        Venc: {new Date(p.due_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-3 flex-shrink-0">
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                        statusColors[p.status] || "bg-muted text-muted-foreground"
                      )}>
                        {statusLabels[p.status] || p.status}
                      </span>
                      <span className="font-mono text-sm font-semibold tabular-nums">{fmtCurrency(p.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inventory Alerts */}
          <div className="card-enterprise !p-0 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-foreground">Alertas de Estoque</h3>
            </div>
            {data.inventoryAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Inbox className="h-6 w-6 mb-1" />
                <p className="text-xs">Estoque OK — nenhum item abaixo do mínimo</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.inventoryAlerts.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.name}</p>
                      {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
                    </div>
                    <div className="text-right">
                      <span className={cn(
                        "font-mono text-sm font-semibold tabular-nums",
                        item.current_stock <= 0 ? "text-destructive" : "text-amber-500"
                      )}>
                        {item.current_stock}{item.unit}
                      </span>
                      <p className="text-xs text-muted-foreground">mín: {item.min_stock}{item.unit}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
