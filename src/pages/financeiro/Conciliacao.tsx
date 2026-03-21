import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Loader2, CheckCircle2, Clock, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Conciliacao() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["bank_transactions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_transactions").select("*, bank_accounts(name)").order("transaction_date", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const pending = useMemo(() => transactions.filter((t) => !t.is_reconciled), [transactions]);
  const reconciled = useMemo(() => transactions.filter((t) => t.is_reconciled), [transactions]);

  const reconcileMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bank_transactions").update({ is_reconciled: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank_transactions"] }); toast({ title: "Lançamento conciliado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Conciliação" description="Conciliação de lançamentos bancários"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro/dre" }, { label: "Conciliação" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Pendentes</p><p className={cn("text-2xl font-bold", pending.length > 0 ? "text-amber-600" : "text-foreground")}>{pending.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Conciliados</p><p className="text-2xl font-bold text-foreground">{reconciled.length}</p></div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 mb-3 opacity-40 text-emerald-500" /><p className="font-medium">Tudo conciliado!</p><p className="text-xs mt-1">Não há lançamentos pendentes.</p>
          </div>
        ) : (
          <Table><TableHeader><TableRow>
            <TableHead>Data</TableHead><TableHead>Conta</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead>
            <TableHead className="text-right">Valor</TableHead><TableHead className="w-28" />
          </TableRow></TableHeader>
            <TableBody>{pending.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm">{new Date(t.transaction_date + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                <TableCell className="text-sm">{t.bank_accounts?.name || "—"}</TableCell>
                <TableCell className="text-sm">{t.description || "—"}</TableCell>
                <TableCell className="text-sm">{t.type === "credit" ? "Entrada" : "Saída"}</TableCell>
                <TableCell className={cn("text-right font-mono text-sm", t.type === "credit" ? "text-emerald-600" : "text-destructive")}>{fmtCurrency(t.amount)}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => reconcileMut.mutate(t.id)} disabled={reconcileMut.isPending}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Conciliar</Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
