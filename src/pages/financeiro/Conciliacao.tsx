import { useMemo, useState } from "react";
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

import { allRows, displayDate } from "@/lib/finance";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Conciliacao() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [confirmTx, setConfirmTx] = useState<any>(null);

  const { data: transactions = [], isLoading, error: loadError } = useQuery({
    queryKey: ["bank_transactions", "reconciliation", profile?.tenant_id],
    queryFn: async () => {
      return allRows((from, to) => supabase.from("bank_transactions").select("*, bank_accounts(name)").order("transaction_date", { ascending: false }).order("id").range(from, to));
    },
    enabled: !!profile,
  });

  const pending = useMemo(() => transactions.filter((t) => !t.is_reconciled), [transactions]);
  const reconciled = useMemo(() => transactions.filter((t) => t.is_reconciled), [transactions]);

  const visible = filter === "all" ? transactions : filter === "pending" ? pending : reconciled;

  const reconcileMut = useMutation({
    mutationFn: async () => {
      if (!confirmTx) throw new Error("Selecione um lançamento.");
      const { data, error } = await supabase.from("bank_transactions").update({ is_reconciled: !confirmTx.is_reconciled }).eq("id", confirmTx.id).eq("is_reconciled", confirmTx.is_reconciled).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Este lançamento mudou. Atualize a lista.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank_transactions"] }); setConfirmTx(null); toast({ title: "Conferência atualizada" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Conciliação" description="Conferência manual dos lançamentos com o extrato da conta."
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro/dre" }, { label: "Conciliação" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Pendentes</p><p className={cn("text-2xl font-bold", pending.length > 0 ? "text-amber-600" : "text-foreground")}>{isLoading || loadError ? "—" : pending.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Conciliados</p><p className="text-2xl font-bold text-foreground">{isLoading || loadError ? "—" : reconciled.length}</p></div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">Confira conta, data e valor no seu extrato antes de marcar. Esta tela não importa extratos automaticamente.</p><Select value={filter} onValueChange={setFilter}><SelectTrigger aria-label="Situação da conferência" className="sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pendentes</SelectItem><SelectItem value="reconciled">Conferidos</SelectItem><SelectItem value="all">Todos</SelectItem></SelectContent></Select></div>
      {loadError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Não foi possível carregar os lançamentos. A situação da conferência está indisponível.</p>}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckCircle2 className="h-10 w-10 mb-3 opacity-40 text-emerald-500" /><p className="font-medium">Nenhum lançamento nesta seleção</p><p className="text-xs mt-1">Ajuste o filtro para consultar os demais lançamentos.</p>
          </div>
        ) : (
          <Table><TableHeader><TableRow>
            <TableHead>Data</TableHead><TableHead>Conta</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead>
            <TableHead className="text-right">Valor</TableHead><TableHead className="w-28" />
          </TableRow></TableHeader>
            <TableBody>{visible.map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="text-sm">{new Date(t.transaction_date + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                <TableCell className="text-sm">{t.bank_accounts?.name || "—"}</TableCell>
                <TableCell className="text-sm">{t.description || "—"}</TableCell>
                <TableCell className="text-sm">{t.type === "credit" ? "Entrada" : "Saída"}</TableCell>
                <TableCell className={cn("text-right font-mono text-sm", t.type === "credit" ? "text-emerald-600" : "text-destructive")}>{fmtCurrency(t.amount)}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setConfirmTx(t)} disabled={reconcileMut.isPending}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {t.is_reconciled ? "Reabrir" : "Conferir"}</Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </div>
      <Dialog open={!!confirmTx} onOpenChange={v => !v && !reconcileMut.isPending && setConfirmTx(null)}><DialogContent><DialogHeader><DialogTitle>{confirmTx?.is_reconciled ? "Reabrir conferência" : "Confirmar com o extrato"}</DialogTitle><DialogDescription>{confirmTx?.is_reconciled ? "O lançamento voltará para a lista de pendentes." : "Marque como conferido somente após localizar este lançamento no extrato."}</DialogDescription></DialogHeader>{confirmTx && <div className="rounded-xl bg-muted p-4 space-y-2"><p className="font-medium">{confirmTx.bank_accounts?.name}</p><p className="text-sm">{displayDate(confirmTx.transaction_date)} · {confirmTx.type === "credit" ? "Entrada" : "Saída"}</p><p className="text-2xl font-semibold tabular-nums">{fmtCurrency(confirmTx.amount)}</p><p className="text-sm text-muted-foreground">{confirmTx.description}</p></div>}<DialogFooter><Button variant="outline" onClick={() => setConfirmTx(null)}>Voltar</Button><Button disabled={reconcileMut.isPending} onClick={() => reconcileMut.mutate()}>{confirmTx?.is_reconciled ? "Reabrir" : "Conferido no extrato"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
