import { Thermometer, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type PrinterRow = Tables<"printers">;
type BambuDevice = Tables<"bambu_devices">;

const statusColors: Record<string, string> = {
  printing: "bg-success animate-pulse-glow",
  idle: "bg-muted-foreground",
  paused: "bg-warning",
  error: "bg-destructive",
  offline: "bg-muted-foreground/30",
  maintenance: "bg-warning",
};

const statusLabels: Record<string, string> = {
  printing: "Imprimindo",
  idle: "Ociosa",
  paused: "Pausada",
  error: "Erro",
  offline: "Offline",
  maintenance: "Manutenção",
};

export function TelemetryStrip() {
  const { data: printers } = useQuery({
    queryKey: ["telemetry-printers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("printers")
        .select("id, name, status, bambu_device_id")
        .eq("is_active", true)
        .order("name");
      return (data ?? []) as PrinterRow[];
    },
    refetchInterval: 15000,
  });

  const { data: devices } = useQuery({
    queryKey: ["telemetry-devices"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bambu_devices")
        .select("dev_id, nozzle_temp, bed_temp, progress, print_status, current_task, online");
      return (data ?? []) as BambuDevice[];
    },
    refetchInterval: 15000,
  });

  const deviceMap = new Map(devices?.map((d) => [d.dev_id, d]) ?? []);

  if (!printers?.length) return null;

  // Map Bambu print_status to our local status
  const resolveStatus = (localStatus: string, device: BambuDevice | null | undefined): string => {
    if (!device) return localStatus;
    const bs = device.print_status?.toUpperCase();
    if (bs === "RUNNING") return "printing";
    if (bs === "PAUSE") return "paused";
    if (bs === "FAILED") return "error";
    if (bs === "IDLE" || bs === "FINISH") return "idle";
    if (device.online === false) return "offline";
    return localStatus;
  };

  return (
    <div className="h-10 bg-surface-sunken border-t border-sidebar-border flex items-center px-4 gap-6 overflow-x-auto flex-shrink-0">
      {printers.map((p) => {
        const device = p.bambu_device_id ? deviceMap.get(p.bambu_device_id) : null;
        const liveStatus = resolveStatus(p.status, device);
        const nozzle = device?.nozzle_temp;
        const progress = device?.progress;
        const isPrinting = liveStatus === "printing";

        return (
          <div key={p.id} className="flex items-center gap-2 text-xs whitespace-nowrap">
            <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", statusColors[p.status] ?? "bg-muted-foreground/30")} />
            <span className="text-muted-foreground font-medium">{p.name}</span>
            <span className="text-muted-foreground/60">{statusLabels[p.status] ?? p.status}</span>

            {isPrinting && progress != null && (
              <>
                <div className="w-16 h-1 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="font-mono text-primary">{progress}%</span>
              </>
            )}

            {nozzle != null && p.status !== "offline" && (
              <span className="text-muted-foreground font-mono flex items-center gap-0.5">
                <Thermometer className="w-3 h-3" />{Math.round(nozzle)}°
              </span>
            )}

            {device?.current_task && (
              <span className="text-muted-foreground truncate max-w-[120px]">{device.current_task}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
