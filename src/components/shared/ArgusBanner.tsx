import { Info, AlertTriangle, CheckCircle2, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface ArgusBannerProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  type?: "info" | "warning" | "success";
}

export function ArgusBanner({ message, actionLabel, onAction, className, type = "info" }: ArgusBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className={cn(
      "flex flex-wrap items-center gap-3 p-4 rounded-lg border transition-all",
      type === "info" && "bg-primary/5 border-primary/10",
      type === "warning" && "bg-amber-500/5 border-amber-500/10",
      type === "success" && "bg-emerald-500/5 border-emerald-500/10",
      className
    )}>
      <div className={cn(
        "flex-shrink-0",
        type === "info" && "text-primary",
        type === "warning" && "text-amber-500",
        type === "success" && "text-emerald-500",
      )}>
        {type === "warning" ? <AlertTriangle className="h-5 w-5" /> : type === "success" ? <CheckCircle2 className="h-5 w-5" /> : <Info className="h-5 w-5" />}
      </div>
      <p className="min-w-[180px] flex-1 text-sm leading-relaxed text-foreground/90">{message}</p>
      {actionLabel && onAction && (
        <Button variant="ghost" size="sm" className="flex-shrink-0 gap-1" onClick={onAction}>
          {actionLabel}
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        aria-label="Dispensar aviso"
        size="icon"
        className="flex-shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
