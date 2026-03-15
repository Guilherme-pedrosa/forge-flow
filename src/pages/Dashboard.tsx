import { useState, useMemo } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ArgusBanner } from "@/components/shared/ArgusBanner";
import {
  DollarSign,
  Factory,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Wallet,
  Package,
  Printer,
  ArrowRight,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Mock KPI data
const kpis = [
  { id: "cash", title: "Saldo em Caixa", value: 24680.42, previousValue: 21480.42, icon: "dollar" as const, format: "currency" as const, trend: "up" as const },
  { id: "jobs", title: "Jobs em Andamento", value: 2, previousValue: 3, icon: "cart" as const, format: "number" as const, trend: "down" as const },
  { id: "loss", title: "Taxa de Perda", value: 4.2, previousValue: 5.3, icon: "alert" as const, format: "percent" as const, trend: "down" as const },
  { id: "margin", title: "Margem Média", value: 38.7, previousValue: 36.4, icon: "box" as const, format: "percent" as const, trend: "up" as const },
];

const recentJobs = [
  { id: "JOB-0042", name: "Engrenagem Helicoidal v3", printer: "X1C-01", status: "printing" as const, material: "PLA Preto", grams: 84, eta: "2h 15m" },
  { id: "JOB-0041", name: "Suporte ABS Reforçado", printer: "P1S-01", status: "printing" as const, material: "ABS Cinza", grams: 122, eta: "4h 32m" },
  { id: "JOB-0040", name: "Caixa Eletrônica v2", printer: "X1C-02", status: "completed" as const, material: "PETG Branco", grams: 67, eta: "—" },
  { id: "JOB-0039", name: "Tampa Rosqueável", printer: "X1C-01", status: "completed" as const, material: "PLA Preto", grams: 23, eta: "—" },
  { id: "JOB-0038", name: "Bracket Motor NEMA17", printer: "A1-01", status: "failed" as const, material: "PETG Branco", grams: 45, eta: "—" },
];

const pendingPayables = [
  { vendor: "Filament Express", due: "17 Mar", amount: 1240.00, status: "open" as const },
  { vendor: "Energia Elétrica", due: "20 Mar", amount: 890.50, status: "open" as const },
  { vendor: "Bambu Lab Store", due: "14 Mar", amount: 3200.00, status: "overdue" as const },
];

const inventoryAlerts = [
  { name: "PETG Branco 1.75mm", supplier: "Esun · Lote #2024-089", stock: 156, min: 200, critical: true },
  { name: "PLA Preto 1.75mm", supplier: "Bambu · Lote #2024-112", stock: 412, min: 500, critical: false },
];

const fmtCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dollar: Wallet,
  cart: ShoppingCart,
  alert: AlertTriangle,
  box: Package,
};

const statusColors: Record<string, string> = {
  printing: "bg-primary/10 text-primary border border-primary/20",
  completed: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
  failed: "bg-red-500/10 text-red-600 border border-red-500/20",
  open: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
  overdue: "bg-red-500/10 text-red-600 border border-red-500/20",
};

const statusLabels: Record<string, string> = {
  printing: "Imprimindo",
  completed: "Concluído",
  failed: "Falhou",
  open: "Aberto",
  overdue: "Vencido",
};

export default function Dashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

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
      <ArgusBanner
        message="2 jobs finalizados hoje consumiram 189g de PETG Branco. Estoque abaixo do mínimo — considere criar pedido de reposição."
        actionLabel="Ver estoque"
        type="warning"
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = iconMap[kpi.icon];
          const change = ((kpi.value - kpi.previousValue) / kpi.previousValue) * 100;
          const isPositive = kpi.trend === "up" ? change > 0 : change < 0;

          return (
            <div key={kpi.id} className="kpi-card p-6">
              <div className="kpi-card-title">
                <Icon className="h-4 w-4" />
                <span className="uppercase tracking-wide">{kpi.title}</span>
              </div>
              <div className="kpi-card-value mb-3 tabular-nums">
                {kpi.format === "currency"
                  ? fmtCurrency(kpi.value)
                  : kpi.format === "percent"
                  ? `${kpi.value}%`
                  : kpi.value}
              </div>
              <div className={cn(
                "kpi-card-trend",
                isPositive ? "kpi-card-trend-up" : "kpi-card-trend-down"
              )}>
                {change > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                <span>{change > 0 ? "+" : ""}{Math.abs(change).toFixed(1)}%</span>
                <span className="text-muted-foreground ml-1">vs mês anterior</span>
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
            <button className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
              Ver todos <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table-enterprise">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Job</th>
                  <th>Impressora</th>
                  <th>Material</th>
                  <th className="text-right">Gramas</th>
                  <th>Status</th>
                  <th className="text-right">ETA</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id} className="cursor-pointer">
                    <td className="font-mono text-muted-foreground text-xs">{job.id}</td>
                    <td className="font-medium text-foreground">{job.name}</td>
                    <td className="font-mono text-muted-foreground text-xs">{job.printer}</td>
                    <td className="text-muted-foreground">{job.material}</td>
                    <td className="text-right font-mono tabular-nums">{job.grams}g</td>
                    <td>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", statusColors[job.status])}>
                        {statusLabels[job.status]}
                      </span>
                    </td>
                    <td className="text-right font-mono text-muted-foreground tabular-nums">{job.eta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <button className="text-xs text-primary flex items-center gap-1 hover:underline font-medium">
                Ver todas <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="divide-y divide-border">
              {pendingPayables.map((p, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.vendor}</p>
                    <p className="text-xs text-muted-foreground">Venc: {p.due}</p>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", statusColors[p.status])}>
                      {statusLabels[p.status]}
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums">{fmtCurrency(p.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Inventory Alerts */}
          <div className="card-enterprise !p-0 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-foreground">Alertas de Estoque</h3>
            </div>
            <div className="divide-y divide-border">
              {inventoryAlerts.map((item, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.supplier}</p>
                  </div>
                  <div className="text-right">
                    <span className={cn("font-mono text-sm font-semibold tabular-nums", item.critical ? "text-destructive" : "text-amber-500")}>
                      {item.stock}g
                    </span>
                    <p className="text-xs text-muted-foreground">mín: {item.min}g</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
