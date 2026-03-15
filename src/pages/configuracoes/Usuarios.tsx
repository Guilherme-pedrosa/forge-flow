import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, Users, Shield } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const roleLabels: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gerente",
  operator: "Operador",
  viewer: "Visualizador",
};

export default function UsuariosPage() {
  const { profile } = useAuth();

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

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Usuários" description="Gestão de usuários e permissões"
        breadcrumbs={[{ label: "Configurações" }, { label: "Usuários" }]}
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
                  <div className="flex gap-1.5">{p.roles.map((r: string) => (
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
    </div>
  );
}
