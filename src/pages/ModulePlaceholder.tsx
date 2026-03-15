import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  ArrowRight,
  Boxes,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  Factory,
  Printer,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { ArgusBanner } from "@/components/shared/ArgusBanner";

interface ModuleConfig {
  title: string;
  description: string;
  actionLabel: string;
  kpis: Array<{ label: string; value: string; trend: string; tone: "today" | "upcoming" | "paid" | "overdue" | "total" }>;
  tableColumns: string[];
  tableRows: string[][];
  aiMessage: string;
}

const configs: Record<string, ModuleConfig> = {
  "/financeiro/receber": {
    title: "Contas a Receber",
    description: "Controle de entradas, títulos e recebimentos por cliente.",
    actionLabel: "Novo Título",
    aiMessage: "Existem 7 títulos próximos do vencimento. Recomendo priorizar cobrança dos 3 maiores valores para melhorar o caixa projetado.",
    kpis: [
      { label: "Previsto (30d)", value: "R$ 128.420,00", trend: "+8,4%", tone: "total" },
      { label: "Recebido Hoje", value: "R$ 9.480,00", trend: "+12,1%", tone: "paid" },
      { label: "A Vencer", value: "R$ 71.200,00", trend: "24 títulos", tone: "today" },
      { label: "Em Atraso", value: "R$ 12.940,00", trend: "6 títulos", tone: "overdue" },
    ],
    tableColumns: ["Título", "Cliente", "Vencimento", "Valor", "Status", "Origem"],
    tableRows: [
      ["REC-1048", "Loja Alfa", "18/03/2026", "R$ 3.850,00", "Aberto", "Pedido #9021"],
      ["REC-1047", "Studio 3D Pro", "17/03/2026", "R$ 1.420,00", "Parcial", "Pedido #9017"],
      ["REC-1045", "MecParts", "15/03/2026", "R$ 7.920,00", "Vencido", "Pedido #9009"],
      ["REC-1044", "AutoNexa", "14/03/2026", "R$ 2.760,00", "Recebido", "Pedido #9006"],
    ],
  },
  "/financeiro/caixa": {
    title: "Caixa & Bancos",
    description: "Movimentações, saldos e conciliação de contas bancárias.",
    actionLabel: "Nova Movimentação",
    aiMessage: "Detectei 4 lançamentos sem conciliação há mais de 3 dias. Posso priorizar os itens com maior impacto no saldo diário.",
    kpis: [
      { label: "Saldo Consolidado", value: "R$ 94.780,55", trend: "+2,9%", tone: "total" },
      { label: "Entradas Hoje", value: "R$ 11.920,00", trend: "17 lanç.", tone: "paid" },
      { label: "Saídas Hoje", value: "R$ 8.640,00", trend: "12 lanç.", tone: "today" },
      { label: "Não Conciliado", value: "R$ 4.220,00", trend: "4 lanç.", tone: "warning" as never },
    ],
    tableColumns: ["Conta", "Descrição", "Data", "Valor", "Tipo", "Conciliação"],
    tableRows: [
      ["Itaú PJ", "Recebimento PIX", "15/03/2026", "R$ 2.180,00", "Entrada", "Conciliado"],
      ["Nubank PJ", "Compra filamento", "15/03/2026", "R$ 1.290,00", "Saída", "Pendente"],
      ["Itaú PJ", "Tarifa bancária", "14/03/2026", "R$ 89,90", "Saída", "Conciliado"],
      ["Caixa", "Venda balcão", "14/03/2026", "R$ 640,00", "Entrada", "Pendente"],
    ],
  },
};

const fallbackConfig: ModuleConfig = {
  title: "Módulo Operacional",
  description: "Visão central do módulo com indicadores, fila e ações rápidas.",
  actionLabel: "Nova Ação",
  aiMessage: "O módulo já está com layout ERP completo. Posso seguir com CRUD real, filtros avançados e integrações deste fluxo.",
  kpis: [
    { label: "Pendências", value: "18", trend: "-2 hoje", tone: "today" },
    { label: "Concluído", value: "42", trend: "+11 esta semana", tone: "paid" },
    { label: "Atenção", value: "5", trend: "2 críticos", tone: "overdue" },
    { label: "Total", value: "65", trend: "100% rastreado", tone: "total" },
  ],
  tableColumns: ["Código", "Descrição", "Responsável", "Prazo", "Status", "Prioridade"],
  tableRows: [
    ["ITM-801", "Revisar lote de produção", "Operação", "16/03/2026", "Em progresso", "Alta"],
    ["ITM-798", "Separar itens para expedição", "Expedição", "16/03/2026", "Aberto", "Média"],
    ["ITM-790", "Aprovar orçamento fornecedor", "Financeiro", "15/03/2026", "Aguardando", "Alta"],
    ["ITM-777", "Atualizar ficha técnica", "Engenharia", "14/03/2026", "Concluído", "Baixa"],
  ],
};

function toneClass(tone: ModuleConfig["kpis"][number]["tone"]) {
  if (tone === "overdue") return "status-card-overdue";
  if (tone === "paid") return "status-card-paid";
  if (tone === "today") return "status-card-today";
  if (tone === "upcoming") return "status-card-upcoming";
  return "status-card-total";
}

function statusBadgeClass(status: string) {
  if (status === "Vencido" || status === "Pendente") return "badge-destructive";
  if (status === "Recebido" || status === "Conciliado" || status === "Concluído") return "badge-success";
  if (status === "Parcial" || status === "Em progresso") return "badge-warning";
  return "badge-info";
}

export default function ModulePlaceholder() {
  const location = useLocation();

  const config = useMemo(() => configs[location.pathname] ?? fallbackConfig, [location.pathname]);
  const segments = location.pathname.split("/").filter(Boolean);
  const breadcrumbs = segments.slice(0, -1).map((segment, index) => ({
    label: segment.charAt(0).toUpperCase() + segment.slice(1),
    href: `/${segments.slice(0, index + 1).join("/")}`,
  }));

  return (
    <div className="space-y-6 page-enter">
      <PageHeader
        title={config.title}
        description={config.description}
        breadcrumbs={breadcrumbs}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Exportar
            </Button>
            <Button className="gap-2">
              <CircleDollarSign className="h-4 w-4" />
              {config.actionLabel}
            </Button>
          </div>
        }
      />

      <ArgusBanner
        message={config.aiMessage}
        actionLabel="Aplicar sugestão"
        onAction={() => undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {config.kpis.map((kpi) => (
          <div key={kpi.label} className={`status-card status-card-active ${toneClass(kpi.tone)}`}>
            <span className="status-card-count">{kpi.value}</span>
            <span className="status-card-value">{kpi.trend}</span>
            <span className="status-card-label">{kpi.label}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 card-enterprise !p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Fila operacional</h3>
            <button className="text-xs text-primary flex items-center gap-1 font-medium hover:underline">
              Ver completo <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table-enterprise">
              <thead>
                <tr>
                  {config.tableColumns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {config.tableRows.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, idx) => {
                      const isStatus = idx === row.length - 2;
                      return (
                        <td key={`${row[0]}-${idx}`}>
                          {isStatus ? (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(cell)}`}>
                              {cell}
                            </span>
                          ) : (
                            cell
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="card-enterprise space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Particularidades 3D
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><Printer className="h-4 w-4" /> SLA dos jobs por impressora</p>
              <p className="flex items-center gap-2"><Boxes className="h-4 w-4" /> Consumo real de filamento por lote</p>
              <p className="flex items-center gap-2"><Clock3 className="h-4 w-4" /> ETA dinâmico com fila de impressão</p>
              <p className="flex items-center gap-2"><Factory className="h-4 w-4" /> Custos por máquina e setup</p>
            </div>
          </div>

          <div className="card-enterprise space-y-3">
            <h4 className="text-sm font-semibold text-foreground">Próximos passos</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• CRUD completo com dados reais</li>
              <li>• Filtros avançados e paginação</li>
              <li>• Fluxo de aprovação por perfil</li>
              <li>• Integração com anexos e auditoria</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
