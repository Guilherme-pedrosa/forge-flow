import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Link2, Mail, KeyRound, Loader2, RefreshCw, CheckCircle2,
  Printer, Clock, AlertTriangle, Wifi, WifiOff, CloudDownload,
  LogOut, ShieldCheck, Image,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const fmtDate = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR") : "—";
const fmtDuration = (s: number | null) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
};

const taskStatusLabels: Record<string, { label: string; color: string }> = {
  "0": { label: "Imprimindo", color: "text-blue-400" },
  "1": { label: "Pausada", color: "text-yellow-400" },
  "2": { label: "Concluída", color: "text-emerald-400" },
  "3": { label: "Falha", color: "text-red-400" },
};

export default function BambuLab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [loginOpen, setLoginOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [step, setStep] = useState<"login" | "verify">("login");
  const [pendingEmail, setPendingEmail] = useState("");

  // Fetch connection status
  const { data: connection, isLoading: connLoading } = useQuery({
    queryKey: ["bambu_connection"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bambu_connections")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  // Fetch devices
  const { data: devices = [], isLoading: devicesLoading } = useQuery({
    queryKey: ["bambu_devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bambu_devices")
        .select("*, printers(name, status)")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile && !!connection,
  });

  // Fetch task history
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["bambu_tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bambu_tasks")
        .select("*, bambu_devices(name)")
        .order("start_time", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!profile && !!connection,
  });

  // Login mutation
  const loginMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "login", email, password },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data.step === "verify_code") {
        setPendingEmail(email);
        setStep("verify");
        toast({ title: "Código enviado", description: "Verifique seu e-mail e insira o código de verificação." });
      } else {
        setLoginOpen(false);
        setStep("login");
        resetLoginForm();
        qc.invalidateQueries({ queryKey: ["bambu_connection"] });
        qc.invalidateQueries({ queryKey: ["bambu_devices"] });
        qc.invalidateQueries({ queryKey: ["bambu_tasks"] });
        toast({ title: "Conectado!", description: data.message });
      }
    },
    onError: (e: any) => toast({ title: "Erro no login", description: e.message, variant: "destructive" }),
  });

  // Verify code mutation
  const verifyMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "verify_code", email: pendingEmail, code: verifyCode },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setLoginOpen(false);
      setStep("login");
      resetLoginForm();
      qc.invalidateQueries({ queryKey: ["bambu_connection"] });
      qc.invalidateQueries({ queryKey: ["bambu_devices"] });
      qc.invalidateQueries({ queryKey: ["bambu_tasks"] });
      toast({ title: "Conectado!", description: data.message });
    },
    onError: (e: any) => toast({ title: "Código inválido", description: e.message, variant: "destructive" }),
  });

  // Sync mutation
  const syncMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "sync" },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["bambu_devices"] });
      qc.invalidateQueries({ queryKey: ["bambu_tasks"] });
      qc.invalidateQueries({ queryKey: ["bambu_connection"] });
      toast({ title: "Sincronizado!", description: data.message });
    },
    onError: (e: any) => toast({ title: "Erro ao sincronizar", description: e.message, variant: "destructive" }),
  });

  // Disconnect mutation
  const disconnectMut = useMutation({
    mutationFn: async () => {
      if (!connection) return;
      const { error } = await supabase
        .from("bambu_connections")
        .update({ is_active: false, access_token_encrypted: null })
        .eq("id", connection.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bambu_connection"] });
      qc.invalidateQueries({ queryKey: ["bambu_devices"] });
      qc.invalidateQueries({ queryKey: ["bambu_tasks"] });
      toast({ title: "Desconectado", description: "Conexão Bambu Lab removida." });
    },
  });

  const resetLoginForm = () => {
    setEmail("");
    setPassword("");
    setVerifyCode("");
    setPendingEmail("");
  };

  const isConnected = !!connection;

  const totalPrints = tasks.length;
  const completedPrints = tasks.filter((t: any) => t.status === "2").length;
  const failedPrints = tasks.filter((t: any) => t.status === "3").length;
  const totalTimeSeconds = tasks.reduce((s: number, t: any) => s + (t.cost_time_seconds || 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Bambu Lab"
        description="Integração com Bambu Lab Cloud — impressoras, tarefas e histórico"
        breadcrumbs={[{ label: "Integrações" }, { label: "Bambu Lab" }]}
        actions={
          <div className="flex items-center gap-2">
            {isConnected && (
              <>
                <Button size="sm" variant="outline" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
                  {syncMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  Sincronizar
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => disconnectMut.mutate()}>
                  <LogOut className="h-4 w-4 mr-1" /> Desconectar
                </Button>
              </>
            )}
            {!isConnected && (
              <Button size="sm" onClick={() => { resetLoginForm(); setStep("login"); setLoginOpen(true); }}>
                <Link2 className="h-4 w-4 mr-1" /> Conectar Bambu Lab
              </Button>
            )}
          </div>
        }
      />

      {/* Connection Status */}
      {connLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !isConnected ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Link2 className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Conecte sua conta Bambu Lab</h3>
          <p className="text-sm text-muted-foreground max-w-md mb-6">
            Faça login com seu e-mail e senha da Bambu Lab para sincronizar automaticamente impressoras, tarefas e consumo de filamento.
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-6">
            <span className="flex items-center gap-1"><Printer className="h-3.5 w-3.5" /> Impressoras</span>
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Histórico</span>
            <span className="flex items-center gap-1"><Image className="h-3.5 w-3.5" /> Fotos</span>
          </div>
          <Button onClick={() => { resetLoginForm(); setStep("login"); setLoginOpen(true); }}>
            <Link2 className="h-4 w-4 mr-2" /> Conectar Bambu Lab
          </Button>
          <p className="text-[11px] text-muted-foreground mt-4 max-w-sm">
            ⚠️ Se você usa login via Google na Bambu Lab, precisa definir uma senha na sua conta antes de conectar.
          </p>
        </Card>
      ) : (
        <>
          {/* Status & KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="p-4 flex items-center gap-3 col-span-1 sm:col-span-2 lg:col-span-1">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-sm font-semibold text-emerald-500">Conectado</p>
                <p className="text-[10px] text-muted-foreground">{connection.bambu_email}</p>
              </div>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Impressoras</p>
              <p className="text-2xl font-bold text-foreground">{devices.length}</p>
              <p className="text-[10px] text-muted-foreground">{devices.filter((d: any) => d.online).length} online</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Impressões</p>
              <p className="text-2xl font-bold text-foreground">{totalPrints}</p>
              <p className="text-[10px] text-muted-foreground">{completedPrints} concluídas</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Falhas</p>
              <p className="text-2xl font-bold text-destructive">{failedPrints}</p>
              <p className="text-[10px] text-muted-foreground">{totalPrints > 0 ? ((failedPrints / totalPrints) * 100).toFixed(1) : 0}% taxa</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Tempo Total</p>
              <p className="text-2xl font-bold text-foreground">{Math.round(totalTimeSeconds / 3600)}h</p>
              <p className="text-[10px] text-muted-foreground">Última sync: {fmtDate(connection.last_sync_at)}</p>
            </Card>
          </div>

          {/* Devices */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Impressoras Conectadas</h3>
            {devicesLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : devices.length === 0 ? (
              <Card className="flex items-center justify-center py-8 text-muted-foreground text-sm">Nenhuma impressora encontrada</Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {devices.map((d: any) => (
                  <Card key={d.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Printer className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground">{d.name || d.dev_id}</span>
                      </div>
                      {d.online ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500"><Wifi className="h-3 w-3" /> Online</span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground"><WifiOff className="h-3 w-3" /> Offline</span>
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>Modelo: <span className="text-foreground">{d.model || "—"}</span></p>
                      <p>Status: <span className="text-foreground">{d.print_status || "idle"}</span></p>
                      {d.nozzle_temp != null && <p>Nozzle: <span className="text-foreground">{d.nozzle_temp}°C</span> | Bed: <span className="text-foreground">{d.bed_temp}°C</span></p>}
                      {d.progress != null && d.progress > 0 && (
                        <div className="mt-2">
                          <div className="flex justify-between text-[10px] mb-1">
                            <span>Progresso</span>
                            <span className="text-foreground font-medium">{d.progress}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${d.progress}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Task History */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Histórico de Impressões</h3>
            {tasksLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : tasks.length === 0 ? (
              <Card className="flex items-center justify-center py-8 text-muted-foreground text-sm">Nenhuma tarefa sincronizada</Card>
            ) : (
              <div className="rounded-xl border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead></TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead>Impressora</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duração</TableHead>
                      <TableHead className="text-right">Gramas</TableHead>
                      <TableHead>Início</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((t: any) => {
                      const statusCfg = taskStatusLabels[t.status] || { label: t.status || "—", color: "text-muted-foreground" };
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="w-12">
                            {t.cover_url ? (
                              <img src={t.cover_url} alt="" className="w-10 h-10 rounded object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                <Image className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="text-sm font-medium text-foreground truncate max-w-[200px]">{t.design_title || "Sem título"}</p>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t.bambu_devices?.name || "—"}</TableCell>
                          <TableCell><span className={cn("text-sm font-medium", statusCfg.color)}>{statusCfg.label}</span></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{fmtDuration(t.cost_time_seconds)}</TableCell>
                          <TableCell className="text-right text-sm font-mono">{t.weight_grams != null ? `${t.weight_grams}g` : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{fmtDate(t.start_time)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Login Dialog */}
      <Dialog open={loginOpen} onOpenChange={(o) => { if (!o) { setLoginOpen(false); setStep("login"); resetLoginForm(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {step === "login" ? "Login Bambu Lab" : "Verificação 2FA"}
            </DialogTitle>
            <DialogDescription>
              {step === "login"
                ? "Insira suas credenciais da conta Bambu Lab (bambulab.com)"
                : `Código de verificação enviado para ${pendingEmail}`
              }
            </DialogDescription>
          </DialogHeader>

          {step === "login" ? (
            <div className="grid gap-4">
              <div>
                <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> E-mail</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" />
              </div>
              <div>
                <Label className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Senha</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                ⚠️ Se você faz login via Google, defina uma senha em bambulab.com → Account Settings antes de conectar.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              <div>
                <Label>Código de Verificação</Label>
                <Input
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="123456"
                  maxLength={6}
                  className="text-center text-lg tracking-widest"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setLoginOpen(false); setStep("login"); resetLoginForm(); }}>Cancelar</Button>
            {step === "login" ? (
              <Button onClick={() => loginMut.mutate()} disabled={!email || !password || loginMut.isPending}>
                {loginMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Entrar
              </Button>
            ) : (
              <Button onClick={() => verifyMut.mutate()} disabled={!verifyCode || verifyMut.isPending}>
                {verifyMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Verificar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}