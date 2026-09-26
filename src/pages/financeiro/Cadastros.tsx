import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { allRows } from "@/lib/finance";
import { FinancialCatalogDialog, catalogLabels, catalogTables, accountTypes, paymentTypes, type CatalogKind, type CatalogRecord } from "@/components/shared/FinancialCatalogDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const tabs: { id: CatalogKind; label: string }[] = [{ id: "payment_method", label: "Formas de pagamento" }, { id: "account", label: "Plano de contas" }, { id: "cost_center", label: "Centros de custo" }];
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
export default function CadastrosFinanceiros() {
  const { profile } = useAuth(); const qc = useQueryClient();
  const [kind, setKind] = useState<CatalogKind>("payment_method"); const [search, setSearch] = useState(""); const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<{ kind: CatalogKind; record?: CatalogRecord } | null>(null); const [deleting, setDeleting] = useState<CatalogRecord | null>(null);
  const records = useQuery({ queryKey: ["financial_catalog", profile?.tenant_id, kind], enabled: !!profile, queryFn: () => allRows<CatalogRecord>((a, b) => supabase.from(catalogTables[kind]).select("*").eq("tenant_id", profile!.tenant_id).order("name").order("id").range(a, b)) });
  const remove = useMutation({ mutationFn: async () => { const r = await rpc("delete_financial_catalog", { p_kind: kind, p_id: deleting?.id }); if (r.error) throw new Error(r.error.message); }, onSuccess: async () => { await qc.invalidateQueries(); setDeleting(null); } });
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const rows = (records.data || []).filter(row => (showInactive || row.is_active) && normalize(`${row.code || ""} ${row.name}`).includes(normalize(search)));
  return <div className="space-y-5"><PageHeader title="Cadastros financeiros" description="Organize as formas de pagamento, classificações e centros de custo da empresa." breadcrumbs={[{ label: "Financeiro" }, { label: "Cadastros" }]} actions={<Button onClick={() => setEditor({ kind })}><Plus className="mr-2 h-4 w-4" />Adicionar</Button>} />
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Cadastros financeiros">{tabs.map(tab => <Button key={tab.id} role="tab" aria-selected={tab.id === kind} variant={tab.id === kind ? "default" : "outline"} onClick={() => { setKind(tab.id); setSearch(""); }}>{tab.label}</Button>)}</div>
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4"><Input className="min-w-48 flex-1" aria-label="Buscar cadastro financeiro" placeholder="Digite nome ou código para buscar…" value={search} onChange={e => setSearch(e.target.value)} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />Mostrar inativos</label></div>
    {records.error ? <p role="alert" className="text-destructive">{records.error.message}</p> : records.isLoading ? <p>Carregando cadastros…</p> : <div className="divide-y rounded-lg border bg-card">{rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="break-words font-medium">{row.name}</p><p className="mt-1 text-sm text-muted-foreground">{[row.code, kind === "account" ? accountTypes[row.account_type as keyof typeof accountTypes] : kind === "payment_method" ? paymentTypes[row.type as keyof typeof paymentTypes] : null, row.is_active ? "Ativo" : "Inativo"].filter(Boolean).join(" · ")}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={row.is_system} aria-label={`Editar ${row.name}`} onClick={() => setEditor({ kind, record: row })}><Pencil className="mr-2 h-4 w-4" />Editar</Button><Button variant="ghost" size="icon" disabled={row.is_system} aria-label={`Excluir ${row.name}`} onClick={() => { remove.reset(); setDeleting(row); }}><Trash2 className="h-4 w-4" /></Button></div></article>)}{!rows.length && <div className="space-y-3 p-8 text-center"><p>Nenhum cadastro encontrado.</p><Button variant="outline" onClick={() => setEditor({ kind })}>Cadastrar {catalogLabels[kind].toLocaleLowerCase("pt-BR")}</Button></div>}</div>}
    {editor && <FinancialCatalogDialog key={`${editor.kind}-${editor.record?.id || "new"}`} {...editor} onClose={() => setEditor(null)} />}
    <Dialog open={!!deleting} onOpenChange={open => { if (!open && !remove.isPending) setDeleting(null); }}><DialogContent closeDisabled={remove.isPending}><DialogHeader><DialogTitle>Excluir {deleting?.name}?</DialogTitle><DialogDescription>Cadastros sem uso podem ser excluídos. Se já houver lançamentos, edite e desative o cadastro para preservar o histórico.</DialogDescription></DialogHeader>{remove.error && <p role="alert" className="text-sm text-destructive">{remove.error.message}</p>}<DialogFooter><Button variant="outline" disabled={remove.isPending} onClick={() => setDeleting(null)}>Voltar</Button><Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? "Excluindo…" : "Excluir definitivamente"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
