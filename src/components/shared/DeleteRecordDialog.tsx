import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type DeleteTarget = { id: string; name: string; kind: "product" | "inventory" | "order" | "quote" | "purchase" | "payable" | "receivable" };
export function DeleteRecordDialog({ target, onClose, onDeleted }: { target: DeleteTarget | null; onClose: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      setError("");
      if (!target) return;
      const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
      const result = await rpc("delete_unused_record", { p_kind: target.kind, p_id: target.id });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: async () => { await qc.invalidateQueries(); onDeleted?.(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  const close = () => { if (!mutation.isPending) { setError(""); onClose(); } };
  return <Dialog open={!!target} onOpenChange={open => !open && close()}><DialogContent closeDisabled={mutation.isPending}>
    <DialogHeader><DialogTitle>Excluir {target?.name}?</DialogTitle><DialogDescription>A exclusão é definitiva. O sistema verifica os vínculos antes de excluir. Registros com produção, movimentações ou pagamentos devem ser mantidos no histórico.</DialogDescription></DialogHeader>
    {target?.kind === "product" && <p className="text-sm text-muted-foreground">Se o produto já foi utilizado, use Arquivar na lista para retirá-lo do catálogo sem perder o histórico.</p>}
    {target?.kind === "purchase" && <p className="text-sm text-muted-foreground">As parcelas sem pagamento desta compra também serão excluídas.</p>}
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={close}>Voltar</Button><Button variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Excluindo…" : "Excluir definitivamente"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
