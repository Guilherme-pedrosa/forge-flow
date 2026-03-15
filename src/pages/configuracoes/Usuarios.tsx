import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, Users, Shield, Plus, Eye, EyeOff } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gerente",
  operator: "Operador",
  viewer: "Visualizador",
};

export default function UsuariosPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({ display_name: "", email: "", password: "", role: "operator" });

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles_with_roles"],
    queryFn: async () => {
      if (!profile) return [];
      const { data: profs, error: e1 } = await supabase.from("profiles").select("*").eq("tenant_id", profile.tenant_id);
      if (e1) throw e1;
      const { data: roles, error: e2 } = await supabase.from("user_roles").select("*");
      if (e2) throw e2;
      return (profs || []).map((p) => ({
        ...p,
        roles: (roles || []).filter((r) => r.user_id === p.user_id).map((r) => r.role),
      }));
    },
    enabled: !!profile,
  });

  const createUser = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");

      const res = await supabase.functions.invoke("create-user", {
        body: payload,
      });

      if (res.error) throw new Error(res.error.message || "Erro ao criar usuário");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      toast({ title: "Usuário criado com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["profiles_with_roles"] });
      setOpen(false);
      setForm({ display_name: "", email: "", password: "", role: "operator" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const canCreate = form.display_name.trim() && form.email.trim() && form.password.length >= 6;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Usuários"
        description="Gestão de usuários e permissões"
        breadcrumbs={[{ label: "Configurações" }, { label: "Usuários" }]}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Novo Usuário
          </Button>
        }
      />

      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Total de Usuários</p>
        <p className="text-2xl font-bold text-foreground">{profiles.length}</p>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground"><Users className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhum usuário</p></div>
        ) : (
          <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Perfis</TableHead><TableHead>Desde</TableHead></TableRow></TableHeader>
            <TableBody>{profiles.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-sm">{p.display_name}</TableCell>
                <TableCell className="text-sm">{p.email || "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1.5 flex-wrap">{p.roles.map((r: string) => (
                    <span key={r} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-semibold">
                      <Shield className="h-3 w-3" /> {roleLabels[r] || r}
                    </span>
                  ))}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{new Date(p.created_at).toLocaleDateString("pt-BR")}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </div>

      {/* Dialog Criar Usuário */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" placeholder="Nome completo" value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" placeholder="usuario@empresa.com" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input id="password" type={showPw ? "text" : "password"} placeholder="Mínimo 6 caracteres"
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Perfil</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="manager">Gerente</SelectItem>
                  <SelectItem value="operator">Operador</SelectItem>
                  <SelectItem value="viewer">Visualizador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={!canCreate || createUser.isPending} onClick={() => createUser.mutate(form)}>
              {createUser.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
