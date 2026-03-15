import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  Clock, CheckCircle2, Hammer, AlertTriangle, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";

interface RoadmapItem {
  feature: string;
  status: "done" | "in_progress" | "planned";
  description: string;
}

interface ModuleRoadmap {
  title: string;
  description: string;
  items: RoadmapItem[];
}

const roadmaps: Record<string, ModuleRoadmap> = {
  "/integracoes/ml": {
    title: "Mercado Livre",
    description: "Integração com o Mercado Livre para importação de pedidos, conciliação de repasses e sincronização de estoque.",
    items: [
      { feature: "Autenticação OAuth com ML", status: "planned", description: "Login seguro via API oficial do Mercado Livre" },
      { feature: "Importação de pedidos", status: "planned", description: "Sync automático de vendas, itens e status" },
      { feature: "Conciliação de repasses", status: "planned", description: "Match entre repasses ML e contas a receber" },
      { feature: "Sincronização de estoque", status: "planned", description: "Atualizar estoque no ML quando houver movimentação" },
      { feature: "Cálculo de taxas por venda", status: "planned", description: "Importar taxas, frete e comissões do ML" },
    ],
  },
  "/producao/perdas": {
    title: "Perdas & QC",
    description: "Controle de qualidade e rastreamento de perdas de produção para análise de eficiência.",
    items: [
      { feature: "Registro de falhas por job", status: "done", description: "Campo failure_reason no job com status 'failed'" },
      { feature: "Dashboard de taxa de falha", status: "planned", description: "KPIs de falhas por impressora, material e operador" },
      { feature: "Checklist de QC por produto", status: "planned", description: "Critérios de aprovação configuráveis por produto" },
      { feature: "Fotos de evidência (QC)", status: "done", description: "Upload de fotos por job já implementado" },
      { feature: "Rastreamento de waste por material", status: "in_progress", description: "Consumo automático com perda registrada no movimento" },
    ],
  },
  "/producao/planejamento": {
    title: "Planejamento / Gantt",
    description: "Visão de capacidade e agendamento de produção com timeline visual.",
    items: [
      { feature: "Pipeline de status dos jobs", status: "done", description: "Workflow completo: fila → impressão → QC → pronto" },
      { feature: "Explosão automática de pedidos", status: "done", description: "Pedido aprovado gera jobs automaticamente" },
      { feature: "Gantt de produção", status: "planned", description: "Timeline visual com drag-and-drop por impressora" },
      { feature: "Alocação de capacidade", status: "planned", description: "Estimativa de fila por impressora com ETA" },
      { feature: "Alertas de SLA", status: "planned", description: "Notificações quando jobs ultrapassam prazo" },
    ],
  },
};

const fallbackRoadmap: ModuleRoadmap = {
  title: "Módulo em desenvolvimento",
  description: "Este módulo está no roadmap e será implementado em breve.",
  items: [
    { feature: "Layout e navegação", status: "done", description: "Estrutura de menu e rotas configurada" },
    { feature: "CRUD principal", status: "planned", description: "Cadastro, edição e listagem de registros" },
    { feature: "Filtros e busca", status: "planned", description: "Busca por texto e filtros por status" },
    { feature: "Integração com outros módulos", status: "planned", description: "Vinculação com financeiro, estoque e produção" },
  ],
};

const statusIcon = {
  done: CheckCircle2,
  in_progress: Hammer,
  planned: Clock,
};

const statusLabel = {
  done: "Implementado",
  in_progress: "Em progresso",
  planned: "Planejado",
};

const statusColor = {
  done: "text-emerald-600 bg-emerald-50 border-emerald-200",
  in_progress: "text-amber-600 bg-amber-50 border-amber-200",
  planned: "text-muted-foreground bg-muted/50 border-border",
};

export default function ModulePlaceholder() {
  const location = useLocation();

  const roadmap = useMemo(() => roadmaps[location.pathname] ?? fallbackRoadmap, [location.pathname]);
  const segments = location.pathname.split("/").filter(Boolean);
  const breadcrumbs = segments.map((segment, index) => ({
    label: segment.charAt(0).toUpperCase() + segment.slice(1),
  }));

  const doneCount = roadmap.items.filter(i => i.status === "done").length;
  const totalCount = roadmap.items.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title={roadmap.title}
        description={roadmap.description}
        breadcrumbs={breadcrumbs}
      />

      {/* Progress */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Progresso do módulo</span>
          </div>
          <span className="text-sm font-bold text-foreground">{progress}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> {doneCount} implementados</span>
          <span className="flex items-center gap-1"><Hammer className="h-3 w-3 text-amber-600" /> {roadmap.items.filter(i => i.status === "in_progress").length} em progresso</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {roadmap.items.filter(i => i.status === "planned").length} planejados</span>
        </div>
      </div>

      {/* Feature List */}
      <div className="rounded-xl border bg-card overflow-hidden divide-y">
        {roadmap.items.map((item, i) => {
          const Icon = statusIcon[item.status];
          return (
            <div key={i} className="flex items-start gap-4 px-6 py-4">
              <div className={cn("mt-0.5 rounded-full p-1.5 border", statusColor[item.status])}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{item.feature}</p>
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border",
                    statusColor[item.status],
                  )}>
                    {statusLabel[item.status]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center">
        <AlertTriangle className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium text-foreground">Módulo em construção</p>
        <p className="text-xs text-muted-foreground mt-1">
          As funcionalidades listadas acima estão sendo implementadas progressivamente.
        </p>
      </div>
    </div>
  );
}
