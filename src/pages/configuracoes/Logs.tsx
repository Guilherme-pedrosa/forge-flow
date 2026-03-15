import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, ScrollText } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export default function Logs() {
  const { profile } = useAuth();

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit_log"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Logs de Auditoria" description="Histórico de ações do sistema"
        breadcrumbs={[{ label: "Configurações" }, { label: "Logs" }]}
      />

      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Registros</p>
        <p className="text-2xl font-bold text-foreground">{logs.length}</p>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ScrollText className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhum log registrado</p>
          </div>
        ) : (
          <Table><TableHeader><TableRow>
            <TableHead>Data/Hora</TableHead><TableHead>Ação</TableHead><TableHead>Tabela</TableHead><TableHead>Registro</TableHead>
          </TableRow></TableHeader>
            <TableBody>{logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-sm font-mono">{new Date(l.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-sm font-medium">{l.action}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{l.table_name || "—"}</TableCell>
                <TableCell className="text-sm font-mono text-muted-foreground">{l.record_id?.slice(0, 8) || "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
