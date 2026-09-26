import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { allRows } from "@/lib/finance";
import { orderRequest } from "@/lib/sales-order";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
const line = () => ({ key: crypto.randomUUID(), product_id: "", quantity: "1" });
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
export function StockProductionForm({ onCreated, onBusy }: { onCreated: (id: string) => void; onBusy: (busy: boolean) => void }) {
  const { profile } = useAuth(); const [items, setItems] = useState([line()]); const [due, setDue] = useState(""); const [notes, setNotes] = useState(""); const request = useRef<{ signature: string; id: string } | null>(null);
  const products = useQuery({ queryKey: ["stock_production_products", profile?.tenant_id], enabled: !!profile, queryFn: () => allRows((a, b) => supabase.from("products").select("id,name,sku").eq("tenant_id", profile!.tenant_id).eq("is_active", true).neq("category", "service").order("name").order("id").range(a, b)) });
  const create = useMutation({ mutationFn: async () => {
    const payload = { p_items: items.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) })), p_due_date: due || null, p_notes: notes.trim() || null };
    if (payload.p_items.some(item => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000)) throw new Error("Selecione os produtos e informe quantidades inteiras entre 1 e 100.000.");
    request.current = orderRequest(request.current, JSON.stringify(payload)); const r = await rpc("request_stock_production", { ...payload, p_request_id: request.current.id });
    if (r.error) throw new Error(r.error.message); if (!r.data) throw new Error("A criação não foi confirmada."); return r.data;
  }, onMutate: () => onBusy(true), onSuccess: onCreated, onSettled: () => onBusy(false) });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); create.mutate(); }}><p className="rounded-md bg-muted p-3 text-sm">A ordem começa em preparação. Você poderá conferir placas, componentes, materiais e tempos antes de liberar as impressões. A entrada do produto pronto acontece ao concluir a OP.</p>
    {items.map((item, index) => <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_90px_36px] items-end gap-2 rounded-lg border p-3"><div className="col-span-3 min-w-0 sm:col-span-1"><Label htmlFor={`stock-product-${item.key}`}>Produto {index + 1}</Label><SearchableItemSelect id={`stock-product-${item.key}`} label={`Produto para estoque ${index + 1}`} value={item.product_id} disabled={create.isPending} onChange={value => setItems(current => current.map(row => row.key === item.key ? { ...row, product_id: value } : row))} emptyLabel="Buscar nome ou SKU" options={(products.data || []).map(p => ({ id: p.id, label: p.name, description: p.sku || undefined }))} /></div><div className="col-span-2 sm:col-span-1"><Label htmlFor={`stock-quantity-${item.key}`}>Quantidade</Label><Input id={`stock-quantity-${item.key}`} type="number" min="1" max="100000" step="1" required disabled={create.isPending} value={item.quantity} onChange={e => setItems(current => current.map(row => row.key === item.key ? { ...row, quantity: e.target.value } : row))} /></div><Button type="button" variant="ghost" size="icon" aria-label={`Remover produto ${index + 1}`} disabled={create.isPending || items.length === 1} onClick={() => setItems(current => current.filter(row => row.key !== item.key))}><Trash2 className="h-4 w-4" /></Button></div>)}
    <Button type="button" variant="outline" disabled={create.isPending || items.length >= 100} onClick={() => setItems(current => [...current, line()])}><Plus className="mr-2 h-4 w-4" />Adicionar produto</Button>
    <div><Label htmlFor="stock-due">Previsão de conclusão</Label><Input id="stock-due" type="date" disabled={create.isPending} value={due} onChange={e => setDue(e.target.value)} /></div><div><Label htmlFor="stock-notes">Observações da produção</Label><Textarea id="stock-notes" disabled={create.isPending} value={notes} onChange={e => setNotes(e.target.value)} /></div>
    {(products.error || create.error) && <p role="alert" className="text-sm text-destructive">{products.error?.message || create.error?.message}</p>}
    <div className="flex justify-end"><Button type="submit" disabled={create.isPending || products.isLoading || !!products.error || items.some(item => !item.product_id)}>{create.isPending ? "Criando…" : "Criar produção para estoque"}</Button></div>
  </form>;
}
