import { Printer, Thermometer, Box } from "lucide-react";
import { cn } from "@/lib/utils";

interface PrinterStatus {
  name: string;
  status: "printing" | "idle" | "error" | "offline";
  progress?: number;
  temp?: number;
  spoolRemaining?: number;
  jobName?: string;
}

const mockPrinters: PrinterStatus[] = [
  { name: "X1C-01", status: "printing", progress: 67, temp: 220, spoolRemaining: 412, jobName: "Engrenagem v3" },
  { name: "X1C-02", status: "idle", temp: 25, spoolRemaining: 890 },
  { name: "P1S-01", status: "printing", progress: 23, temp: 215, spoolRemaining: 156, jobName: "Suporte ABS" },
  { name: "A1-01", status: "offline" },
];

const statusColors: Record<string, string> = {
  printing: "bg-success animate-pulse-glow",
  idle: "bg-muted-foreground",
  error: "bg-destructive",
  offline: "bg-muted-foreground/30",
};

const statusLabels: Record<string, string> = {
  printing: "Imprimindo",
  idle: "Ociosa",
  error: "Erro",
  offline: "Offline",
};

export function TelemetryStrip() {
  return (
    <div className="h-10 bg-surface-sunken border-t border-sidebar-border flex items-center px-4 gap-6 overflow-x-auto flex-shrink-0">
      {mockPrinters.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs whitespace-nowrap">
          <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", statusColors[p.status])} />
          <span className="text-muted-foreground font-medium">{p.name}</span>
          
          {p.status === "printing" && p.progress !== undefined && (
            <>
              <div className="w-16 h-1 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${p.progress}%` }} />
              </div>
              <span className="font-mono text-primary">{p.progress}%</span>
            </>
          )}
          
          {p.status !== "offline" && p.temp !== undefined && (
            <span className="text-muted-foreground font-mono flex items-center gap-0.5">
              <Thermometer className="w-3 h-3" />{p.temp}°
            </span>
          )}
          
          {p.spoolRemaining !== undefined && (
            <span className="text-muted-foreground font-mono flex items-center gap-0.5">
              <Box className="w-3 h-3" />{p.spoolRemaining}g
            </span>
          )}

          {p.jobName && (
            <span className="text-muted-foreground truncate max-w-[120px]">{p.jobName}</span>
          )}
        </div>
      ))}
    </div>
  );
}
