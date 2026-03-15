import { cn } from "@/lib/utils";

type StatusType = "aberto" | "pago" | "vencido" | "imprimindo" | "concluido" | "falhou" | "ocioso" | "pendente";

const statusConfig: Record<StatusType, { label: string; className: string }> = {
  aberto: { label: "Aberto", className: "badge-warning" },
  pago: { label: "Pago", className: "badge-success" },
  vencido: { label: "Vencido", className: "badge-destructive" },
  imprimindo: { label: "Imprimindo", className: "badge-argus" },
  concluido: { label: "Concluído", className: "badge-success" },
  falhou: { label: "Falhou", className: "badge-destructive" },
  ocioso: { label: "Ocioso", className: "bg-muted-foreground/10 text-muted-foreground border border-muted-foreground/20" },
  pendente: { label: "Pendente", className: "badge-warning" },
};

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium font-mono", config.className, className)}>
      {config.label}
    </span>
  );
}
