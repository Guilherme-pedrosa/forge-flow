import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { marketplaceDb, marketplaceRpc } from "@/lib/marketplace-orders";
import { isMissingDatabaseStructure } from "@/lib/database-readiness";
import { orderRequest } from "@/lib/sales-order";

type Policy = { default_customer_id: string | null; receivable_due_days: number; safety_buffer_hours: number | string; auto_organize: boolean };
type Workflow = { organized: number; results: Array<{ marketplace_order_id: string; external_order_id?: string; order_id: string | null; outcome: string; issues: string[] }> };
const emptyPolicy: Policy = { default_customer_id: null, receivable_due_days: 30, safety_buffer_hours: 24, auto_organize: false };
const caches = ["marketplace_workflow_policies", "marketplace_orders", "marketplace_receivable_positions", "orders", "order_items", "order_stock_allocations", "accounts_receivable", "dre_ar", "jobs", "fila_jobs", "production_orders", "production_order_items", "inventory_items", "filament-planning", "capacity_data", "daily-operations", "dashboard"];

export function WorkflowPolicy({ accountId, customerOptions }: { accountId: string; customerOptions: Array<{ id: string; name: string }> }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [draft, setDraft] = useState<{ accountId: string; values: Policy } | null>(null);
  const [lastResult, setLastResult] = useState<{ accountId: string; workflow: Workflow } | null>(null);
  const requests = useRef<Record<string, { id: string; signature: string }>>({});
  const policy = useQuery({ queryKey: ["marketplace_workflow_policies", accountId], enabled: !!accountId, queryFn: async () => {
    const { data, error } = await marketplaceDb.from("marketplace_workflow_policies").select("default_customer_id,receivable_due_days,safety_buffer_hours,auto_organize").eq("account_id", accountId).maybeSingle();
    if (error) throw error; return (data as Policy | null) ?? emptyPolicy;
  } });
  const value = draft?.accountId === accountId ? draft.values : policy.data ?? emptyPolicy;
  const patch = (change: Partial<Policy>) => setDraft({ accountId, values: { ...value, ...change } });
  const mutation = useMutation({ mutationFn: async (action: "save" | "organize") => {
    if (action === "save") {
      const due = Number(value.receivable_due_days), buffer = Number(value.safety_buffer_hours);
      if (!Number.isInteger(due) || due < 0 || due > 180 || !Number.isFinite(buffer) || buffer < 0 || buffer > 168 || Number(buffer.toFixed(2)) !== buffer) throw new Error("Informe dias inteiros entre 0 e 180 e antecedência entre 0 e 168 horas, com até duas casas.");
      if (value.auto_organize && !value.default_customer_id) throw new Error("Selecione o cliente usado nos pedidos desta conta.");
      const signature = JSON.stringify({ accountId, value });
      const request = orderRequest(requests.current.save ?? null, signature); requests.current.save = request;
      await marketplaceRpc("save_marketplace_workflow_policy", { p_account_id: accountId, p_values: { ...value, receivable_due_days: due, safety_buffer_hours: buffer }, p_request_id: request.id });
      return "Configuração salva para esta conta";
    }
    const { data, error } = await marketplaceDb.from("marketplace_orders").select("id").eq("account_id", accountId).eq("normalized_state", "paid").eq("needs_review", false).is("internal_order_id", null).order("imported_at").order("id").limit(100);
    if (error) throw error;
    const ids = (data as Array<{ id: string }>).map(row => row.id);
    if (!ids.length) return "Nenhum pedido pago disponível para organizar";
    const signature = JSON.stringify({ accountId, ids });
    const request = orderRequest(requests.current.organize ?? null, signature); requests.current.organize = request;
    const workflow = await marketplaceRpc<Workflow>("organize_eligible_marketplace_orders", { p_account_id: accountId, p_order_ids: ids, p_request_id: request.id });
    setLastResult({ accountId, workflow }); return `${workflow.organized} pedido(s) organizado(s)`;
  }, onSuccess: (message, action) => { if (action === "save") setDraft(null); else delete requests.current.organize; for (const key of caches) void qc.invalidateQueries({ queryKey: [key] }); toast({ title: message }); }, onError: error => toast({ title: "Não foi possível organizar", description: error.message, variant: "destructive" }) });
  if (policy.error && isMissingDatabaseStructure(policy.error)) return <p role="status" className="text-sm text-muted-foreground">A organização automática ainda precisa ser ativada no banco. A importação e a conferência manual continuam disponíveis.</p>;
  if (policy.error) return <p role="alert">Não foi possível carregar a organização desta conta. {policy.error.message} <Button variant="outline" onClick={() => void policy.refetch()}>Tentar novamente</Button></p>;
  const busy = mutation.isPending || policy.isLoading;
  const workflow = lastResult?.accountId === accountId ? lastResult.workflow : null;
  return <section aria-label="Organização dos pedidos" className="rounded-xl border bg-card p-4 space-y-3">
    <h2 className="font-semibold">Organização dos pedidos</h2>
    <p className="text-sm text-muted-foreground">Pedidos pagos, com prazo oficial, valores conferidos e produtos vinculados podem usar o estoque pronto ou entrar na fila. Falta de ficha técnica mantém um rascunho com as pendências.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><Label htmlFor="workflow-customer">Cliente dos pedidos desta conta</Label><select id="workflow-customer" disabled={busy} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={value.default_customer_id ?? ""} onChange={e => patch({ default_customer_id: e.target.value || null })}><option value="">Selecione</option>{customerOptions.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
      <div><Label htmlFor="workflow-due-days">Previsão do recebível (dias)</Label><Input id="workflow-due-days" disabled={busy} type="number" min="0" max="180" step="1" value={Number.isFinite(value.receivable_due_days) ? value.receivable_due_days : ""} onChange={e => patch({ receivable_due_days: e.target.value === "" ? Number.NaN : Number(e.target.value) })} /></div>
      <div><Label htmlFor="workflow-buffer">Antecedência para produzir (horas)</Label><Input id="workflow-buffer" disabled={busy} type="number" min="0" max="168" step="0.01" value={value.safety_buffer_hours} onChange={e => patch({ safety_buffer_hours: e.target.value })} /></div>
    </div>
    <p className="text-xs text-muted-foreground">A previsão conta a partir da entrada da venda; confira depois a data real do repasse. A antecedência cria uma meta interna antes do despacho e preserva uma meta já ajustada no pedido.</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={busy} checked={value.auto_organize} onChange={e => patch({ auto_organize: e.target.checked })} /><span>Organizar os pedidos elegíveis ao importar nesta conta. Isso pode baixar estoque pronto, criar recebíveis e liberar ordens para a fila. A execução exige perfil de gestão.</span></label>
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => mutation.mutate("save")}>Salvar organização</Button><Button variant="outline" disabled={busy || !!draft && draft.accountId === accountId || !policy.data?.default_customer_id} onClick={() => mutation.mutate("organize")}>Organizar até 100 novos pedidos importados</Button></div>
    {!!draft && draft.accountId === accountId && <p className="text-xs text-muted-foreground">Salve a configuração antes de organizar os pedidos já importados.</p>}
    {workflow && <div role="status" className="text-sm space-y-2"><p>{workflow.organized} organizado(s) nesta operação. Rascunhos com pendências podem ser preparados e confirmados em Pedidos.</p>{workflow.results.filter(row => row.outcome === "needs_review" || row.outcome === "needs_preparation").map(row => <p key={row.marketplace_order_id}>Pedido {row.external_order_id ?? row.marketplace_order_id.slice(0, 8)}: {row.issues.join(" ")}{row.order_id && <> <Link className="underline" to={`/comercial/pedidos?pedido=${encodeURIComponent(row.order_id)}`}>Abrir pedido</Link></>}</p>)}</div>}
  </section>;
}
