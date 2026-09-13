import { Thermometer, Clock, Box, AlertTriangle, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";

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
  const { session, profile } = useAuth();
  const tenantId = profile?.tenant_id;
  const isAuthenticated = !!session?.access_token && !!tenantId;

  useQuery({
    queryKey: ["telemetry-sync", tenantId],
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
    enabled: isAuthenticated,
  });

  const { data: printers, error: printersError } = useQuery({
    queryKey: ["telemetry-printers", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("printers")
        .select("id, name, status, bambu_device_id")
        .eq("tenant_id", tenantId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as PrinterRow[];
    },
    refetchInterval: 15000,
    enabled: isAuthenticated,
  });

  const { data: devices, error: devicesError } = useQuery({
    queryKey: ["telemetry-devices", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bambu_devices")
        .select("dev_id, nozzle_temp, progress, print_status, current_task, online, remaining_time, ams_data, last_seen_at, updated_at")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return (data ?? []) as BambuDevice[];
    },
    refetchInterval: 15000,
    enabled: isAuthenticated,
  });

  const { data: activeJobs } = useQuery({
    queryKey: ["telemetry-active-jobs", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, name, code, status, printer_id, started_at, est_time_minutes, est_grams")
        .eq("tenant_id", tenantId!)
        .in("status", ["printing", "queued", "paused"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as JobRow[];
    },
    refetchInterval: 15000,
    enabled: isAuthenticated,
  });

  const deviceMap = new Map(devices?.map((d) => [d.dev_id, d]) ?? []);
  const jobMap = new Map<string | null, JobRow>();
  for (const job of activeJobs ?? []) {
    const previous = jobMap.get(job.printer_id);
    if (!previous || (job.status === "printing" && previous.status !== "printing")) jobMap.set(job.printer_id, job);
  }

  if (printersError || devicesError) return <div role="status" className="hidden shrink-0 items-center gap-2 border-t bg-card px-6 py-2 text-xs text-muted-foreground md:flex"><AlertTriangle className="h-3.5 w-3.5" />Telemetria indisponível.<Link className="text-primary hover:underline" to="/integracoes/bambu">Ver integração</Link></div>;
  if (!printers?.length) return null;

  const resolveStatus = (localStatus: string, device: BambuDevice | null | undefined): string => {
    if (!device) return localStatus;
    if (device.online === false) return "offline";
    const lastSeen = device.last_seen_at || device.updated_at;
    if (!lastSeen || Date.now() - new Date(lastSeen).getTime() > 5 * 60_000) return "stale";
    const bs = device.print_status?.toUpperCase();
    if (bs === "RUNNING" || bs === "PRINTING") return "printing";
    if (bs === "PAUSE" || bs === "PAUSED") return "paused";
    if (bs === "FAILED" || bs === "ERROR") return "error";
    if (bs === "IDLE" || bs === "FINISH" || bs === "SUCCESS") return "idle";
    return localStatus;
  };

  return (
    <div aria-label="Resumo das impressoras" className="hidden h-11 shrink-0 items-center gap-6 overflow-x-auto border-t bg-card px-6 md:flex">
      <Link className="flex items-center gap-2 whitespace-nowrap text-xs font-medium text-muted-foreground" to="/integracoes/bambu"><Printer className="h-3.5 w-3.5" />Impressoras</Link>
      {printers.map((p) => {
        const device = p.bambu_device_id ? deviceMap.get(p.bambu_device_id) : null;
        const liveStatus = resolveStatus(p.status, device);
        const linkedJob = jobMap.get(p.id) ?? null;

        const progressFromDevice = device?.progress ?? null;
        const progressFromJob = deriveProgressFromJob(linkedJob);
        const progress = progressFromDevice != null ? Math.max(0, Math.min(100, Number(progressFromDevice))) : progressFromJob;

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
            <span className="text-muted-foreground/70">{liveStatus === "stale" ? "Sem atualização recente" : statusLabels[liveStatus] ?? liveStatus}</span>

            {isPrinting && (
              <>
                {progress != null ? (
                  <>
                    <div className="w-16 h-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="font-mono text-primary">{progressFromDevice == null ? "~" : ""}{progress}%</span>
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

            {nozzle != null && !["offline", "stale"].includes(liveStatus) && (
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
