import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ArgusBanner } from "@/components/shared/ArgusBanner";
import {
  DollarSign, AlertTriangle, TrendingUp, TrendingDown, Wallet,
  Package, Printer, ArrowRight, RefreshCw, ShoppingCart, Inbox,
  Factory, Cake, Plus, Zap, BarChart3, Clock, CheckCircle2,
  FileText, Hammer, ArrowRightLeft, Eye, Thermometer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";

const fmtCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtCompact = (v: number) => {
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return fmtCurrency(v);
};

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
  draft: "Rascunho", queued: "Na fila", printing: "Imprimindo",
  paused: "Pausado", failed: "Falhou", reprint: "Reimpressão",
  post_processing: "Pós-processo", quality_check: "QC",
  ready: "Pronto", shipped: "Enviado", completed: "Concluído",
  open: "Aberto", overdue: "Vencido", partial: "Parcial", paid: "Pago",
  idle: "Ociosa", offline: "Offline", error: "Erro", maintenance: "Manutenção",
};

const printerStatusDot: Record<string, string> = {
  idle: "bg-muted-foreground",
  printing: "bg-emerald-500 animate-pulse",
  paused: "bg-amber-500",
  error: "bg-red-500",
  offline: "bg-muted-foreground/40",
  maintenance: "bg-violet-500",
};

const CHART_COLORS = [
  "hsl(217, 100%, 50%)",
  "hsl(160, 84%, 39%)",
  "hsl(38, 92%, 50%)",
  "hsl(271, 91%, 65%)",
  "hsl(0, 84%, 60%)",
];

interface DashboardData {
  cashBalance: number;
  activeJobs: number;
  lossRate: number;
  avgMargin: number;
  totalRevenue: number;
  totalOrders: number;
  recentJobs: any[];
  pendingPayables: any[];
  inventoryAlerts: any[];
  argusMessage: string | null;
  completedJobCount: number;
  orderPipeline: Record<string, number>;
  upcomingBirthdays: any[];
  revenueByMonth: { month: string; revenue: number; cost: number }[];
  jobsByStatus: { name: string; value: number; color: string }[];
  printers: any[];
  materialUsage: { name: string; value: number }[];
}

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData>({
    cashBalance: 0, activeJobs: 0, lossRate: 0, avgMargin: 0,
    totalRevenue: 0, totalOrders: 0,
    recentJobs: [], pendingPayables: [], inventoryAlerts: [],
    argusMessage: null, completedJobCount: 0,
    orderPipeline: {}, upcomingBirthdays: [],
    revenueByMonth: [], jobsByStatus: [], printers: [], materialUsage: [],
  });

  const tenantId = profile?.tenant_id;

  const fetchDashboard = async () => {
    if (!tenantId) return;

    try {
      const [
        jobsRes, completedJobsRes, payablesRes, inventoryRes, bankRes,
        ordersRes, customersRes, printersRes, movementsRes,
      ] = await Promise.all([
        supabase.from("jobs")
          .select("id, code, name, status, est_grams, est_time_minutes, printer_id, started_at, completed_at, sale_price, actual_total_cost, est_total_cost, printers(name), inventory_items!jobs_material_id_fkey(name)")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase.from("jobs")
          .select("sale_price, actual_total_cost, est_total_cost, status, completed_at")
          .in("status", ["completed", "shipped"]),
        supabase.from("accounts_payable")
          .select("id, description, due_date, amount, amount_paid, status")
          .in("status", ["open", "partial", "overdue"])
          .order("due_date", { ascending: true }).limit(5),
        supabase.from("inventory_items")
          .select("id, name, current_stock, min_stock, brand, unit")
          .eq("is_active", true).order("name"),
        supabase.from("bank_accounts")
          .select("current_balance").eq("is_active", true),
        supabase.from("orders")
          .select("status, total, created_at")
          .not("status", "eq", "cancelled"),
        supabase.from("customers")
          .select("id, name, birthday, phone")
          .eq("is_active", true).not("birthday", "is", null),
        supabase.from("printers")
          .select("id, name, model, status, total_print_hours, total_prints")
          .eq("is_active", true).order("name"),
        supabase.from("inventory_movements")
          .select("item_id, quantity, movement_type, created_at, inventory_items(name)")
          .eq("movement_type", "job_consumption")
          .order("created_at", { ascending: false }).limit(100),
      ]);

      const cashBalance = (bankRes.data || []).reduce((sum, b) => sum + Number(b.current_balance || 0), 0);
      const allJobs = jobsRes.data || [];
      const activeJobs = allJobs.filter((j) =>
        ["queued", "printing", "paused", "post_processing", "quality_check"].includes(j.status)
      ).length;

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

      const ordersList = ordersRes.data || [];
      const orderPipeline = {
        draft: ordersList.filter(o => o.status === "draft").length,
        approved: ordersList.filter(o => o.status === "approved").length,
        in_production: ordersList.filter(o => o.status === "in_production").length,
        ready: ordersList.filter(o => o.status === "ready").length,
        shipped: ordersList.filter(o => o.status === "shipped").length,
      };

      // Revenue by month (last 6 months from orders)
      const revenueByMonth: { month: string; revenue: number; cost: number }[] = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = d.toISOString().slice(0, 7);
        const monthLabel = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
        
        const monthOrders = ordersList.filter(o => o.created_at?.startsWith(monthKey));
        const monthRevenue = monthOrders.reduce((s, o: any) => s + (o.total || 0), 0);
        
        const monthJobs = completed.filter((j: any) => j.completed_at?.startsWith(monthKey));
        const monthCost = monthJobs.reduce((s, j: any) => s + (j.actual_total_cost || j.est_total_cost || 0), 0);
        
        revenueByMonth.push({ month: monthLabel, revenue: monthRevenue, cost: monthCost });
      }

      // Jobs by status (for pie chart)
      const allJobsForPie = [...allJobs, ...completed];
      const statusCounts: Record<string, number> = {};
      allJobsForPie.forEach(j => { statusCounts[j.status] = (statusCounts[j.status] || 0) + 1; });
      const jobsByStatus = Object.entries(statusCounts)
        .filter(([, v]) => v > 0)
        .map(([name, value], i) => ({ name: statusLabels[name] || name, value, color: CHART_COLORS[i % CHART_COLORS.length] }));

      // Material usage (top 5)
      const matUsage: Record<string, number> = {};
      (movementsRes.data || []).forEach((m: any) => {
        const name = m.inventory_items?.name || "Desconhecido";
        matUsage[name] = (matUsage[name] || 0) + Number(m.quantity || 0);
      });
      const materialUsage = Object.entries(matUsage)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, value]) => ({ name: name.length > 15 ? name.slice(0, 15) + "…" : name, value: Math.round(value) }));

      let argusMessage: string | null = null;
      if (alerts.length > 0) {
        const names = alerts.slice(0, 2).map((a) => a.name).join(", ");
        argusMessage = `${alerts.length} item(ns) abaixo do mínimo: ${names}. Reponha o estoque.`;
      }

      const todayStr = new Date().toISOString().split("T")[0];
      const formattedPayables = (payablesRes.data || []).map((p) => ({
        ...p,
        status: p.status === "open" && p.due_date < todayStr ? "overdue" : p.status,
      }));

      const allCustomers = customersRes.data || [];
      const todayDate = new Date();
      const upcomingBirthdays = allCustomers
        .map((c: any) => {
          const bday = new Date(c.birthday + "T00:00:00");
          const thisYear = new Date(todayDate.getFullYear(), bday.getMonth(), bday.getDate());
          if (thisYear < todayDate) thisYear.setFullYear(thisYear.getFullYear() + 1);
          const diffDays = Math.round((thisYear.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
          return { ...c, nextBirthday: thisYear, daysUntil: diffDays };
        })
        .filter((c: any) => c.daysUntil >= 0 && c.daysUntil <= 30)
        .sort((a: any, b: any) => a.daysUntil - b.daysUntil)
        .slice(0, 5);

      setData({
        cashBalance, activeJobs, lossRate, avgMargin: realMargin,
        totalRevenue, totalOrders: ordersList.length,
        recentJobs: allJobs, pendingPayables: formattedPayables,
        inventoryAlerts: alerts, argusMessage,
        completedJobCount: completed.length, orderPipeline,
        upcomingBirthdays, revenueByMonth, jobsByStatus,
        printers: printersRes.data || [], materialUsage,
      });
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboard(); }, [tenantId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchDashboard();
    setIsRefreshing(false);
  };

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

  const quickActions = [
    { label: "Novo Pedido", icon: FileText, href: "/comercial/pedidos", color: "text-primary" },
    { label: "Novo Job", icon: Hammer, href: "/producao/jobs", color: "text-emerald-600" },
    { label: "Novo Produto", icon: Package, href: "/comercial/produtos", color: "text-violet-600" },
    { label: "Nova Compra", icon: ShoppingCart, href: "/estoque/compras", color: "text-amber-600" },
  ];

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Visão geral da sua operação"
        actions={
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} className="bg-card border-border">
            <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
            Atualizar
          </Button>
        }
      />

      {/* Argus AI Banner */}
      {data.argusMessage && (
        <ArgusBanner message={data.argusMessage} actionLabel="Ver estoque" type="warning" />
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 -mx-1 overflow-x-auto px-1">
        {quickActions.map((a) => (
          <Link key={a.href} to={a.href}>
            <Button variant="outline" size="sm" className="bg-card gap-2">
              <a.icon className={cn("h-4 w-4", a.color)} />
              {a.label}
            </Button>
          </Link>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { title: "Saldo em Caixa", value: fmtCurrency(data.cashBalance), icon: Wallet, trend: null },
          { title: "Receita Total", value: fmtCurrency(data.totalRevenue), icon: TrendingUp, trend: null },
          { title: "Jobs Ativos", value: String(data.activeJobs), icon: Printer, trend: null },
          { title: "Taxa de Perda", value: `${data.lossRate.toFixed(1)}%`, icon: AlertTriangle, trend: data.lossRate > 10 ? "bad" : "good" },
          { title: "Margem Real", value: `${data.avgMargin.toFixed(1)}%`, icon: BarChart3, trend: data.avgMargin > 30 ? "good" : data.avgMargin > 0 ? "neutral" : "bad" },
        ].map((kpi) => (
          <div key={kpi.title} className="kpi-card p-3 md:p-5">
            <div className="kpi-card-title">
              <kpi.icon className="h-4 w-4" />
              <span className="uppercase tracking-wide">{kpi.title}</span>
            </div>
            <div className={cn(
              "text-lg md:text-2xl font-bold tabular-nums",
              kpi.trend === "good" && "text-emerald-600",
              kpi.trend === "bad" && "text-destructive",
            )}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 card-enterprise !p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Receita vs Custo (6 meses)</h3>
            </div>
          </div>
          <div className="p-4 h-[240px]">
            {data.revenueByMonth.some(r => r.revenue > 0 || r.cost > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.revenueByMonth} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217, 100%, 50%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(217, 100%, 50%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(215, 16%, 47%)" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} stroke="hsl(215, 16%, 47%)" />
                  <Tooltip
                    formatter={(value: number, name: string) => [fmtCurrency(value), name === "revenue" ? "Receita" : "Custo"]}
                    labelStyle={{ fontWeight: 600 }}
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(214, 32%, 91%)", fontSize: 13 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(217, 100%, 50%)" fill="url(#revenueGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="cost" stroke="hsl(0, 84%, 60%)" fill="url(#costGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Dados insuficientes para gráfico</p>
                  <p className="text-xs mt-1">Complete pedidos para ver a receita</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Material Usage */}
        <div className="card-enterprise !p-0 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Consumo de Material</h3>
          </div>
          <div className="p-4 h-[240px]">
            {data.materialUsage.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.materialUsage} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}g`} stroke="hsl(215, 16%, 47%)" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} stroke="hsl(215, 16%, 47%)" />
                  <Tooltip formatter={(v: number) => [`${v}g`, "Consumo"]} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
                  <Bar dataKey="value" fill="hsl(217, 100%, 50%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Sem dados de consumo</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Farm View + Order Pipeline */}
      <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
        {/* 🖨️ Farm View — Impressoras */}
        <div className="card-enterprise !p-0 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Farm — Impressoras</h3>
            </div>
            <Link to="/producao/impressoras" className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
              Gerenciar <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {data.printers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Printer className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">Nenhuma impressora cadastrada</p>
              <Link to="/producao/impressoras">
                <Button variant="link" size="sm" className="mt-1">Adicionar impressora</Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
              {data.printers.map((p: any) => (
                <Link
                  key={p.id}
                  to="/producao/impressoras"
                  className="flex flex-col gap-2 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/50 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", printerStatusDot[p.status] || "bg-muted-foreground/40")} />
                    <span className="text-sm font-semibold text-foreground truncate">{p.name}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {p.model} · {statusLabels[p.status] || p.status}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                    <span>{p.total_prints ?? 0} prints</span>
                    <span>{(p.total_print_hours ?? 0).toFixed(0)}h</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Order Pipeline */}
        <div className="card-enterprise !p-0 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Factory className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Pipeline de Pedidos</h3>
            </div>
            <Link to="/comercial/pedidos" className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
              Ver todos <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between gap-1">
              {[
                { key: "draft", label: "Rascunho", color: "bg-muted-foreground" },
                { key: "approved", label: "Aprovado", color: "bg-primary" },
                { key: "in_production", label: "Produção", color: "bg-amber-500" },
                { key: "ready", label: "Pronto", color: "bg-emerald-500" },
                { key: "shipped", label: "Enviado", color: "bg-blue-500" },
              ].map((s, i, arr) => (
                <div key={s.key} className="flex items-center gap-1 flex-1">
                  <div className="flex flex-col items-center gap-1.5 flex-1">
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white text-lg font-bold", s.color)}>
                      {data.orderPipeline[s.key] || 0}
                    </div>
                    <span className="text-[10px] text-muted-foreground text-center leading-tight">{s.label}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 -mt-4" />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{data.totalOrders} pedidos no total</span>
              <Link to="/comercial/pedidos">
                <Button variant="outline" size="sm">
                  <Plus className="h-3 w-3 mr-1" /> Novo Pedido
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Jobs + Right Column */}
      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
        {/* Jobs Table */}
        <div className="lg:col-span-2 card-enterprise !p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hammer className="w-4 h-4 text-muted-foreground" />
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
                    <tr key={job.id} className="cursor-pointer" onClick={() => navigate("/producao/jobs")}>
                      <td className="font-mono text-muted-foreground text-xs">{job.code}</td>
                      <td className="font-medium text-foreground">{job.name}</td>
                      <td className="text-muted-foreground text-xs">{(job as any).printers?.name || "—"}</td>
                      <td className="text-muted-foreground">{(job as any).inventory_items?.name || "—"}</td>
                      <td className="text-right font-mono tabular-nums">{job.est_grams ? `${job.est_grams}g` : "—"}</td>
                      <td className="text-right font-mono text-muted-foreground tabular-nums">{fmtDuration(job.est_time_minutes)}</td>
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
          {/* Upcoming Birthdays */}
          <div className="rounded-xl border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 via-card to-card overflow-hidden shadow-md">
            <div className="px-5 py-4 border-b border-pink-500/20 flex items-center justify-between bg-pink-500/5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-pink-500/15 flex items-center justify-center">
                  <Cake className="w-4 h-4 text-pink-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">🎂 Aniversários</h3>
                  <p className="text-[11px] text-muted-foreground">Próximos 30 dias</p>
                </div>
              </div>
              <Link to="/comercial/clientes" className="text-xs text-pink-600 flex items-center gap-1 hover:underline font-semibold">
                Clientes <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {data.upcomingBirthdays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Cake className="h-6 w-6 mb-1 text-pink-300" />
                <p className="text-xs">Nenhum aniversário próximo</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.upcomingBirthdays.map((c: any) => (
                  <div key={c.id} className="px-5 py-3 flex items-center justify-between hover:bg-pink-500/5 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(c.birthday + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
                      </p>
                    </div>
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold shrink-0",
                      c.daysUntil === 0 ? "bg-pink-500 text-white"
                        : c.daysUntil <= 3 ? "bg-pink-500/15 text-pink-600 border border-pink-500/30"
                        : "bg-muted text-muted-foreground border border-border"
                    )}>
                      {c.daysUntil === 0 ? "🎂 Hoje!" : c.daysUntil === 1 ? "Amanhã" : `${c.daysUntil}d`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payables */}
          <div className="card-enterprise !p-0 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Contas a Pagar</h3>
              </div>
              <Link to="/financeiro/pagar" className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
                Ver <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {data.pendingPayables.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <Inbox className="h-6 w-6 mb-1" />
                <p className="text-xs">Nenhuma conta pendente</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.pendingPayables.map((p) => (
                  <div key={p.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{p.description}</p>
                      <p className="text-xs text-muted-foreground">
                        Venc: {new Date(p.due_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-2 flex-shrink-0">
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
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-foreground">Alertas de Estoque</h3>
              </div>
              <Link to="/estoque/alertas" className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
                Ver <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {data.inventoryAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <CheckCircle2 className="h-6 w-6 mb-1 text-emerald-500" />
                <p className="text-xs">Estoque OK</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.inventoryAlerts.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
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
