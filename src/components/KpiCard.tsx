import { motion } from "framer-motion";
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
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
      className="forge-card rounded-md p-4 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-data-sm text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-2xl font-semibold tracking-tight font-mono",
            variant === "success" && "text-success",
            variant === "destructive" && "text-destructive",
            variant === "argus" && "text-primary"
          )}
        >
          {value}
        </span>
        {subvalue && (
          <span className="text-data-sm text-muted-foreground font-mono">{subvalue}</span>
        )}
      </div>
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
    </motion.div>
  );
}
