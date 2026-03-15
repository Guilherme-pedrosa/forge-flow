import {
  DollarSign,
  Factory,
  AlertTriangle,
  TrendingUp,
  Printer,
  Package,
  Clock,
  ArrowRight,
} from "lucide-react";
import { KpiCard } from "@/components/KpiCard";
import { ArgusPanel } from "@/components/ArgusPanel";
import { StatusBadge } from "@/components/StatusBadge";

const recentJobs = [
  { id: "JOB-0042", name: "Engrenagem Helicoidal v3", printer: "X1C-01", status: "imprimindo" as const, material: "PLA Preto", grams: 84, eta: "2h 15m" },
  { id: "JOB-0041", name: "Suporte ABS Reforçado", printer: "P1S-01", status: "imprimindo" as const, material: "ABS Cinza", grams: 122, eta: "4h 32m" },
  { id: "JOB-0040", name: "Caixa Eletrônica v2", printer: "X1C-02", status: "concluido" as const, material: "PETG Branco", grams: 67, eta: "—" },
  { id: "JOB-0039", name: "Tampa Rosqueável", printer: "X1C-01", status: "concluido" as const, material: "PLA Preto", grams: 23, eta: "—" },
  { id: "JOB-0038", name: "Bracket Motor NEMA17", printer: "A1-01", status: "falhou" as const, material: "PETG Branco", grams: 45, eta: "—" },
];

const pendingPayables = [
  { vendor: "Filament Express", due: "17 Mar", amount: "R$ 1.240,00", status: "aberto" as const },
  { vendor: "Energia Elétrica", due: "20 Mar", amount: "R$ 890,50", status: "aberto" as const },
  { vendor: "Bambu Lab Store", due: "14 Mar", amount: "R$ 3.200,00", status: "vencido" as const },
];

export default function Dashboard() {
  return (
    <div className="p-6 space-y-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Painel Operacional</h1>
          <p className="text-data-sm text-muted-foreground">15 Mar 2026 · Atualizado há 2 min</p>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Saldo em Caixa"
          value="R$ 24.680"
          subvalue=",42"
          trend="up"
          trendValue="+R$ 3.200 esta semana"
          icon={<DollarSign className="w-4 h-4" />}
        />
        <KpiCard
          label="Jobs em Andamento"
          value="2"
          subvalue="de 4 impressoras"
          variant="argus"
          icon={<Factory className="w-4 h-4" />}
        />
        <KpiCard
          label="Taxa de Perda"
          value="4.2%"
          subvalue="últimos 30 dias"
          trend="down"
          trendValue="-1.1pp vs mês anterior"
          variant="success"
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <KpiCard
          label="Margem Média"
          value="38.7%"
          subvalue="por job concluído"
          trend="up"
          trendValue="+2.3pp"
          variant="success"
          icon={<TrendingUp className="w-4 h-4" />}
        />
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Jobs Table */}
        <div className="lg:col-span-2 forge-card rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Printer className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Jobs Recentes</h2>
            </div>
            <button className="text-xs text-primary flex items-center gap-1 hover:underline">
              Ver todos <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">ID</th>
                  <th className="text-left px-4 py-2 font-medium">Job</th>
                  <th className="text-left px-4 py-2 font-medium">Impressora</th>
                  <th className="text-left px-4 py-2 font-medium">Material</th>
                  <th className="text-right px-4 py-2 font-medium">Gramas</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">ETA</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{job.id}</td>
                    <td className="px-4 py-2.5 text-foreground font-medium">{job.name}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{job.printer}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{job.material}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{job.grams}g</td>
                    <td className="px-4 py-2.5"><StatusBadge status={job.status} /></td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{job.eta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Argus */}
          <div className="forge-card rounded-md p-4">
            <ArgusPanel />
          </div>

          {/* Payables */}
          <div className="forge-card rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Contas a Pagar</h2>
              </div>
              <button className="text-xs text-primary flex items-center gap-1 hover:underline">
                Ver todas <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="divide-y divide-border/50">
              {pendingPayables.map((p, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <p className="text-foreground font-medium">{p.vendor}</p>
                    <p className="text-muted-foreground">Venc: {p.due}</p>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <StatusBadge status={p.status} />
                    <span className="font-mono text-foreground">{p.amount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Inventory Alerts */}
          <div className="forge-card rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Package className="w-4 h-4 text-warning" />
              <h2 className="text-sm font-semibold">Alertas de Estoque</h2>
            </div>
            <div className="divide-y divide-border/50">
              <div className="px-4 py-2.5 flex items-center justify-between text-xs">
                <div>
                  <p className="text-foreground font-medium">PETG Branco 1.75mm</p>
                  <p className="text-muted-foreground">Esun · Lote #2024-089</p>
                </div>
                <div className="text-right">
                  <span className="font-mono text-destructive">156g</span>
                  <p className="text-muted-foreground">mín: 200g</p>
                </div>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between text-xs">
                <div>
                  <p className="text-foreground font-medium">PLA Preto 1.75mm</p>
                  <p className="text-muted-foreground">Bambu · Lote #2024-112</p>
                </div>
                <div className="text-right">
                  <span className="font-mono text-warning">412g</span>
                  <p className="text-muted-foreground">mín: 500g</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
