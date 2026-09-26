import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { orderRequest } from "@/lib/sales-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type CatalogKind = "payment_method" | "account" | "cost_center";
export type CatalogRecord = { id: string; name: string; code?: string; type?: string; account_type?: string; is_active: boolean; is_system?: boolean; description?: string | null };
export const catalogLabels = { payment_method: "Forma de pagamento", account: "Classificação financeira", cost_center: "Centro de custo" };
export const catalogTables = { payment_method: "payment_methods", account: "chart_of_accounts", cost_center: "cost_centers" } as const;
export const accountTypes = { revenue: "Receita", expense: "Despesa", asset: "Ativo / investimento", liability: "Passivo / obrigação", equity: "Patrimônio líquido" };
export const paymentTypes = { pix: "Pix", cash: "Dinheiro", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", bank_transfer: "Transferência", boleto: "Boleto", other: "Outro" };
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string | null; error: { message: string } | null }>;

// Mount with a record key so a new draft never inherits another record's values.
export function FinancialCatalogDialog({ kind, record, defaultType, onClose, onSaved }: { kind: CatalogKind; record?: CatalogRecord; defaultType?: string; onClose: () => void; onSaved?: (id: string, name: string) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: record?.name || "", code: record?.code || "", type: record?.account_type || record?.type || defaultType || (kind === "account" ? "expense" : "pix"), is_active: record?.is_active ?? true, description: record?.description || "" });
  const request = useRef<{ signature: string; id: string } | null>(null);
  const save = useMutation({ mutationFn: async () => {
    const values = { ...form, ...(record ? { expected: record } : {}) };
    const payload = { p_kind: kind, p_id: record?.id || null, p_values: values };
    request.current = orderRequest(request.current, JSON.stringify(payload));
    const r = await rpc("save_financial_catalog", { ...payload, p_request_id: request.current.id });
    if (r.error) throw new Error(r.error.message); if (!r.data) throw new Error("O salvamento não foi confirmado."); return r.data;
  }, onSuccess: async id => {
    await Promise.all(["financial_catalog", "financial_options", "payment_methods", "purchase_payment_methods", "chart_of_accounts", "cost_centers"].map(key => qc.invalidateQueries({ queryKey: [key] })));
    onSaved?.(id, form.name.trim()); onClose();
  } });
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}><DialogContent closeDisabled={save.isPending} className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{record ? "Editar" : "Cadastrar"} {catalogLabels[kind].toLocaleLowerCase("pt-BR")}</DialogTitle><DialogDescription>{kind === "account" ? "Classifique receitas e despesas para acompanhar o resultado da empresa." : kind === "cost_center" ? "Separe os gastos por área, projeto ou atividade." : "Esta opção ficará disponível nas compras e nos lançamentos financeiros."}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
      <div><Label htmlFor="catalog-name">Nome *</Label><Input id="catalog-name" autoFocus maxLength={160} required minLength={2} disabled={save.isPending} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={kind === "account" ? "Ex.: Venda de peças 3D" : kind === "cost_center" ? "Ex.: Produção 3D" : "Ex.: Pix"} /></div>
      {kind !== "payment_method" && <div><Label htmlFor="catalog-code">Código</Label><Input id="catalog-code" maxLength={40} disabled={save.isPending} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="Gerado automaticamente se deixar vazio" /></div>}
      {kind !== "cost_center" && <div><Label htmlFor="catalog-type">{kind === "account" ? "Natureza" : "Tipo"}</Label><select id="catalog-type" className="h-11 w-full rounded-md border bg-background px-3 text-sm" disabled={save.isPending} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{Object.entries(kind === "account" ? accountTypes : paymentTypes).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>}
      {kind === "account" && <div><Label htmlFor="catalog-description">Observação</Label><Input id="catalog-description" disabled={save.isPending} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>}
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" disabled={save.isPending} checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /><span>Disponível para novos lançamentos<span className="mt-1 block text-xs text-muted-foreground">Desative para retirar das opções e manter o histórico.</span></span></label>
      {save.error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{save.error.message}</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={save.isPending || form.name.trim().length < 2}>{save.isPending ? "Salvando…" : "Salvar cadastro"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
