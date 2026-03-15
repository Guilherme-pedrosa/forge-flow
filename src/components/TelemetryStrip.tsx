import { Thermometer, Clock, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type PrinterRow = Tables<"printers">;
type BambuDevice = Tables<"bambu_devices">;
type JobRow = Tables<"jobs">;

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

const fmtRemaining = (minutes: number | null | undefined) => {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h${m > 0 ? `${m}m` : ""}` : `${m}m`;
};

const fmtFilament = (grams: number | null) => {
  if (grams == null || Number.isNaN(grams)) return null;
  return `${grams.toFixed(1)}g`;
};

const deriveProgressFromJob = (job: JobRow | null): number | null => {
  if (!job || !job.started_at || !job.est_time_minutes || job.est_time_minutes <= 0) {
    return null;
  }

  const elapsedMinutes =
    (Date.now() - new Date(job.started_at).getTime()) / (1000 * 60);
  const pct = Math.max(0, Math.min(99, Math.round((elapsedMinutes / job.est_time_minutes) * 100)));
  return Number.isFinite(pct) ? pct : null;
};

export function TelemetryStrip() {
  useQuery({
    queryKey: ["telemetry-sync"],
    queryFn: async () => {
      const { error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "telemetry" },
      });
      if (error) throw error;
      return true;
    },
    refetchInterval: 30000,
    staleTime: 25000,
    retry: false,
  });

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
        .select("dev_id, nozzle_temp, progress, print_status, current_task, online, remaining_time, ams_data");
      return (data ?? []) as BambuDevice[];
    },
    refetchInterval: 15000,
  });

  const { data: activeJobs } = useQuery({
    queryKey: ["telemetry-active-jobs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, name, code, status, printer_id, started_at, est_time_minutes, est_grams")
        .in("status", ["printing", "queued", "paused"])
        .order("updated_at", { ascending: false });
      return (data ?? []) as JobRow[];
    },
    refetchInterval: 15000,
  });

  const deviceMap = new Map(devices?.map((d) => [d.dev_id, d]) ?? []);
  const jobMap = new Map((activeJobs ?? []).map((j) => [j.printer_id, j]));

  if (!printers?.length) return null;

  const resolveStatus = (localStatus: string, device: BambuDevice | null | undefined): string => {
    if (!device) return localStatus;
    const bs = device.print_status?.toUpperCase();
    if (bs === "RUNNING" || bs === "PRINTING") return "printing";
    if (bs === "PAUSE" || bs === "PAUSED") return "paused";
    if (bs === "FAILED" || bs === "ERROR") return "error";
    if (bs === "IDLE" || bs === "FINISH" || bs === "SUCCESS") return "idle";
    if (device.online === false) return "offline";
    return localStatus;
  };

  return (
    <div className="h-10 bg-surface-sunken border-t border-sidebar-border flex items-center px-4 gap-6 overflow-x-auto flex-shrink-0">
      {printers.map((p) => {
        const device = p.bambu_device_id ? deviceMap.get(p.bambu_device_id) : null;
        const liveStatus = resolveStatus(p.status, device);
        const linkedJob = jobMap.get(p.id) ?? null;

        const progressFromDevice = device?.progress ?? null;
        const progressFromJob = deriveProgressFromJob(linkedJob);
        const progress = progressFromDevice ?? progressFromJob;

        const remaining = fmtRemaining(device?.remaining_time);

        const filamentFromDevice =
          device?.ams_data && typeof device.ams_data === "object"
            ? Number((device.ams_data as Record<string, unknown>).filament_grams ?? NaN)
            : null;

        const filamentFromJob = linkedJob?.est_grams ?? null;
        const filament = fmtFilament(
          filamentFromDevice != null && !Number.isNaN(filamentFromDevice)
            ? filamentFromDevice
            : filamentFromJob
        );

        const taskName =
          device?.current_task || linkedJob?.name || (linkedJob?.code ? `Job ${linkedJob.code}` : null);

        const nozzle = device?.nozzle_temp;
        const isPrinting = liveStatus === "printing";

        return (
          <div key={p.id} className="flex items-center gap-2 text-xs whitespace-nowrap">
            <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", statusColors[liveStatus] ?? "bg-muted-foreground/30")} />
            <span className="text-muted-foreground font-medium">{p.name}</span>
            <span className="text-muted-foreground/60">{statusLabels[liveStatus] ?? liveStatus}</span>

            {isPrinting && (
              <>
                {progress != null ? (
                  <>
                    <div className="w-16 h-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="font-mono text-primary">{progress}%</span>
                  </>
                ) : (
                  <span className="text-muted-foreground/70 font-mono">% --</span>
                )}
              </>
            )}

            {isPrinting && remaining && (
              <span className="text-muted-foreground font-mono flex items-center gap-0.5">
                <Clock className="w-3 h-3" />{remaining}
              </span>
            )}

            {isPrinting && filament && (
              <span className="text-muted-foreground font-mono flex items-center gap-0.5">
                <Box className="w-3 h-3" />{filament}
              </span>
            )}

            {nozzle != null && liveStatus !== "offline" && (
              <span className="text-muted-foreground font-mono flex items-center gap-0.5">
                <Thermometer className="w-3 h-3" />{Math.round(nozzle)}°
              </span>
            )}

            {taskName && (
              <span className="text-muted-foreground truncate max-w-[170px]">{taskName}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
