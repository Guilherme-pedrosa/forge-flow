import { nonNegative } from "@/lib/production";
import { orderRequest } from "@/lib/sales-order";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type QuickItem = { id: string; name: string; unit: string };
type QuickItemProps = { open: boolean; initialName?: string; purchaseContext?: boolean; onBusyChange?: (busy: boolean) => void; onClose: () => void; onCreated: (item: QuickItem) => void };
export function QuickInventoryItem(props:QuickItemProps) {
  const {profile,user}=useAuth();
  return <QuickInventoryItemSession key={`${profile?.tenant_id}:${user?.id}`} {...props}/>;
}
function QuickInventoryItemSession({ open, initialName = "", purchaseContext = false, onBusyChange, onClose, onCreated }: QuickItemProps) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState("un");
  const [category, setCategory] = useState("consumable");
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [cost, setCost] = useState("");
  const [quantity, setQuantity] = useState("0");
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const mutation = useMutation({ mutationFn: async () => {
    if (!profile || !name.trim()) throw new Error("Informe o nome do item.");
    const item = { name: name.trim(), unit, category, avg_cost: purchaseContext ? 0 : nonNegative(cost, "Custo"), current_stock: purchaseContext ? 0 : nonNegative(quantity, "Estoque inicial") };
    request.current = orderRequest(request.current, JSON.stringify(item));
    const result = await (supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>)("save_inventory_catalog", { p_item_id: null, p_item: item, p_request_id: request.current.id });
    if (result.error) throw new Error(result.error.message);
    if (typeof result.data !== "string") throw new Error("Cadastro não confirmado.");
    return { id: result.data, name: item.name, unit: item.unit };
  }, onSuccess: async item => { if(!alive.current)return;await qc.invalidateQueries({ queryKey: ["inventory_items"] });if(!alive.current)return;onCreated(item); onClose(); } });
  useEffect(() => { onBusyChange?.(mutation.isPending); return () => onBusyChange?.(false); }, [mutation.isPending, onBusyChange]);
  return <Dialog open={open} onOpenChange={v => !v && !mutation.isPending && onClose()}><DialogContent closeDisabled={mutation.isPending}>
    <DialogHeader><DialogTitle>Cadastrar item de estoque</DialogTitle><DialogDescription>{purchaseContext ? "Defina o nome e a unidade do insumo. Saldo e custo serão atualizados ao receber esta compra." : "Informe nome, custo e o saldo que já existe. A compra será somada a esse saldo quando recebida."}</DialogDescription></DialogHeader>
    <fieldset disabled={mutation.isPending} className="space-y-4"><div><Label htmlFor="quick-item-name">Nome *</Label><Input autoFocus id="quick-item-name" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="quick-item-category">Categoria</Label><select id="quick-item-category" className="h-10 w-full rounded-md border bg-background px-3" value={category} disabled={mutation.isPending} onChange={e => { setCategory(e.target.value); if (["filament", "resin"].includes(e.target.value)) setUnit("g"); }}><option value="consumable">Consumível</option>{!purchaseContext && <option value="filament">Filamento</option>}<option value="resin">Resina</option><option value="part">Peça / componente</option><option value="maintenance">Manutenção</option></select></div>
        <div><Label htmlFor="quick-item-unit">Unidade do estoque</Label><select id="quick-item-unit" className="h-10 w-full rounded-md border bg-background px-3" value={unit} onChange={e => setUnit(e.target.value)}>{["un", "g", "kg", "ml", "l", "m"].map(u => <option key={u} value={u}>{u}</option>)}</select></div></div>
      {!purchaseContext && <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="quick-item-cost">Custo unitário (R$)</Label><Input id="quick-item-cost" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0,00" /></div><div><Label htmlFor="quick-item-stock">Estoque inicial</Label><Input id="quick-item-stock" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} /></div></div>}
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    </fieldset><DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Voltar</Button><Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Salvando…" : "Cadastrar e selecionar"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
