import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type PrinterRow = {
  id: string;
  name: string;
  status: string;
  bambu_device_id: string | null;
  is_active: boolean;
};

type DeviceRow = {
  dev_id: string;
  print_status: string | null;
  online: boolean | null;
  last_seen_at: string | null;
};

type JobRow = {
  id: string;
  printer_id: string | null;
  status: string;
  completed_at: string | null;
  updated_at: string | null;
};

type BambuTaskRow = {
  bambu_device_id: string | null;
  end_time: string | null;
  start_time: string | null;
};

const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min entre avisos da mesma impressora

const resolveLiveStatus = (localStatus: string, device: DeviceRow | null | undefined) => {
  if (!device) return localStatus;
  const bs = device.print_status?.toUpperCase();
  if (bs === "RUNNING" || bs === "PRINTING") return "printing";
  if (bs === "PAUSE" || bs === "PAUSED") return "paused";
  if (bs === "FAILED" || bs === "ERROR") return "error";
  if (bs === "IDLE" || bs === "FINISH" || bs === "SUCCESS") return "idle";
  if (device.online === false) return "offline";
  return localStatus;
};

const fmtDuration = (ms: number) => {
  if (ms < 0 || !Number.isFinite(ms)) return null;
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "menos de 1min";
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

/**
 * Monitora todas as impressoras ativas. Dispara toast persistente quando
 * uma impressora está parada (idle/offline/paused/error) e ainda existem
 * jobs em fila atribuídos a ela.
 */
export function usePrinterIdleAlerts() {
  const { session } = useAuth();
  const isAuthenticated = !!session?.access_token;
  const navigate = useNavigate();
  const lastAlertRef = useRef<Map<string, number>>(new Map());

  const { data: printers } = useQuery({
    queryKey: ["idle-alerts-printers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("printers")
        .select("id, name, status, bambu_device_id, is_active")
        .eq("is_active", true);
      return (data ?? []) as PrinterRow[];
    },
    refetchInterval: 30000,
    enabled: isAuthenticated,
  });

  const { data: devices } = useQuery({
    queryKey: ["idle-alerts-devices"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bambu_devices")
        .select("dev_id, print_status, online, last_seen_at");
      return (data ?? []) as DeviceRow[];
    },
    refetchInterval: 30000,
    enabled: isAuthenticated,
  });

  const { data: queuedJobs } = useQuery({
    queryKey: ["idle-alerts-queue"],
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, printer_id, status, completed_at, updated_at")
        .in("status", ["queued", "draft"]);
      return (data ?? []) as JobRow[];
    },
    refetchInterval: 30000,
    enabled: isAuthenticated,
  });

  const { data: lastJobs } = useQuery({
    queryKey: ["idle-alerts-last-jobs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, printer_id, status, completed_at, updated_at")
        .in("status", ["completed", "failed"])
        .order("updated_at", { ascending: false })
        .limit(500);
      return (data ?? []) as JobRow[];
    },
    refetchInterval: 60000,
    enabled: isAuthenticated,
  });

  const { data: lastBambuTasks } = useQuery({
    queryKey: ["idle-alerts-bambu-tasks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bambu_tasks")
        .select("bambu_device_id, end_time, start_time")
        .order("end_time", { ascending: false })
        .limit(500);
      return (data ?? []) as BambuTaskRow[];
    },
    refetchInterval: 60000,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!printers?.length || !queuedJobs) return;

    const deviceMap = new Map(devices?.map((d) => [d.dev_id, d]) ?? []);
    const queueByPrinter = new Map<string, number>();
    let unassignedQueueCount = 0;
    queuedJobs.forEach((j) => {
      if (!j.printer_id) {
        unassignedQueueCount += 1;
        return;
      }
      queueByPrinter.set(j.printer_id, (queueByPrinter.get(j.printer_id) ?? 0) + 1);
    });

    // Última atividade conhecida por printer.id (jobs locais)
    const lastJobActivityByPrinter = new Map<string, number>();
    (lastJobs ?? []).forEach((j) => {
      if (!j.printer_id) return;
      const t = new Date(j.completed_at ?? j.updated_at ?? 0).getTime();
      if (!t) return;
      const prev = lastJobActivityByPrinter.get(j.printer_id) ?? 0;
      if (t > prev) lastJobActivityByPrinter.set(j.printer_id, t);
    });

    // Última atividade por bambu_device.id (UUID interno) via tarefas Bambu
    const lastBambuActivityByDeviceUuid = new Map<string, number>();
    (lastBambuTasks ?? []).forEach((t) => {
      if (!t.bambu_device_id) return;
      const ts = new Date(t.end_time ?? t.start_time ?? 0).getTime();
      if (!ts) return;
      const prev = lastBambuActivityByDeviceUuid.get(t.bambu_device_id) ?? 0;
      if (ts > prev) lastBambuActivityByDeviceUuid.set(t.bambu_device_id, ts);
    });

    const now = Date.now();

    const statusLabel: Record<string, string> = {
      idle: "ociosa",
      offline: "offline",
      paused: "pausada",
      error: "com erro",
    };

    printers.forEach((p) => {
      const device = p.bambu_device_id ? deviceMap.get(p.bambu_device_id) : null;
      const liveStatus = resolveLiveStatus(p.status, device);
      const assignedQueue = queueByPrinter.get(p.id) ?? 0;
      const isStopped = ["idle", "offline", "paused", "error"].includes(liveStatus);

      if (!isStopped) return;

      const effectiveQueue = assignedQueue + unassignedQueueCount;
      if (effectiveQueue === 0) return;

      const lastShown = lastAlertRef.current.get(p.id) ?? 0;
      if (now - lastShown < ALERT_COOLDOWN_MS) return;

      lastAlertRef.current.set(p.id, now);

      // Calcular há quanto tempo está parada (maior timestamp entre todas as fontes)
      const candidates: number[] = [];
      const lastSeen = device?.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
      if (lastSeen) candidates.push(lastSeen);
      const lastJob = lastJobActivityByPrinter.get(p.id);
      if (lastJob) candidates.push(lastJob);
      // bambu_devices.id (uuid) é diferente de dev_id; precisamos achar pelo dev_id
      // Como temos só dev_id no PrinterRow, buscamos diretamente:
      // (já temos device acima — mas o map de bambu_tasks usa o uuid interno; sem ele aqui não conseguimos cruzar)
      // Por isso, a melhor aproximação cliente é usar last_seen_at + last job local.
      const lastActivity = candidates.length ? Math.max(...candidates) : 0;
      const idleMs = lastActivity ? now - lastActivity : 0;
      const idleLabel = lastActivity ? fmtDuration(idleMs) : null;

      const queueDesc =
        assignedQueue > 0
          ? `${assignedQueue} job(s) atribuído(s) aguardando.`
          : `${unassignedQueueCount} job(s) na fila sem impressora atribuída.`;

      const desc = idleLabel
        ? `Parada há ${idleLabel}. ${queueDesc}`
        : queueDesc;

      toast.warning(`Impressora ${p.name} está ${statusLabel[liveStatus] ?? "parada"}`, {
        id: `printer-idle-${p.id}`,
        description: desc,
        duration: 12000,
        icon: <AlertTriangle className="h-4 w-4" />,
        action: {
          label: "Abrir fila",
          onClick: () => navigate("/planejamento/fila"),
        },
      });
    });
  }, [printers, devices, queuedJobs, lastJobs, lastBambuTasks, navigate]);
}
