import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  subvalue?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "destructive" | "argus";
}

export function KpiCard({ label, value, subvalue, trend, trendValue, icon, variant = "default" }: KpiCardProps) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3.5 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4 sm:gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon && <span className="hidden rounded-md bg-muted/60 p-2 text-muted-foreground min-[380px]:inline-flex">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "break-words text-lg font-semibold tracking-tight tabular-nums sm:text-2xl",
            variant === "success" && "text-success",
            variant === "destructive" && "text-destructive",
            variant === "argus" && "text-primary"
          )}
        >
          {value}
        </span>
      </div>
      {subvalue && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{subvalue}</p>}
      {trend && trendValue && (
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "text-xs font-mono",
              trend === "up" && "text-success",
              trend === "down" && "text-destructive",
              trend === "neutral" && "text-muted-foreground"
            )}
          >
            {trend === "up" ? "▲" : trend === "down" ? "▼" : "—"} {trendValue}
          </span>
        </div>
      )}
    </div>
  );
}
