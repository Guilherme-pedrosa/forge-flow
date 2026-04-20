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
};

type JobRow = {
  id: string;
  printer_id: string | null;
  status: string;
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
        .select("dev_id, print_status, online");
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
        .select("id, printer_id, status")
        .in("status", ["queued", "draft"]);
      return (data ?? []) as JobRow[];
    },
    refetchInterval: 30000,
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

      // Conta jobs sem impressora também (qualquer impressora parada pode pegá-los)
      const effectiveQueue = assignedQueue + unassignedQueueCount;
      if (effectiveQueue === 0) return;

      const lastShown = lastAlertRef.current.get(p.id) ?? 0;
      if (now - lastShown < ALERT_COOLDOWN_MS) return;

      lastAlertRef.current.set(p.id, now);

      const desc =
        assignedQueue > 0
          ? `${assignedQueue} job(s) atribuído(s) aguardando.`
          : `${unassignedQueueCount} job(s) na fila sem impressora atribuída.`;

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
  }, [printers, devices, queuedJobs, navigate]);
}
