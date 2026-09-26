import { nonNegative } from "@/lib/production";
import { orderRequest } from "@/lib/sales-order";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type QuickItem = { id: string; name: string; unit: string };
export function QuickInventoryItem({ open, initialName = "", onClose, onCreated }: { open: boolean; initialName?: string; onClose: () => void; onCreated: (item: QuickItem) => void }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState("un");
  const [category, setCategory] = useState("consumable");
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [cost, setCost] = useState("");
  const [quantity, setQuantity] = useState("0");
  const mutation = useMutation({ mutationFn: async () => {
    if (!profile || !name.trim()) throw new Error("Informe o nome do item.");
    const item = { name: name.trim(), unit, category, avg_cost: nonNegative(cost, "Custo"), current_stock: nonNegative(quantity, "Estoque inicial") };
    request.current = orderRequest(request.current, JSON.stringify(item));
    const result = await (supabase.rpc as any)("save_inventory_catalog", { p_item_id: null, p_item: item, p_request_id: request.current.id });
    if (result.error) throw new Error(result.error.message);
    if (typeof result.data !== "string") throw new Error("Cadastro não confirmado.");
    return { id: result.data, name: item.name, unit: item.unit };
  }, onSuccess: async item => { await qc.invalidateQueries({ queryKey: ["inventory_items"] }); onCreated(item); onClose(); } });
  return <Dialog open={open} onOpenChange={v => !v && !mutation.isPending && onClose()}><DialogContent closeDisabled={mutation.isPending}>
    <DialogHeader><DialogTitle>Cadastrar item de estoque</DialogTitle><DialogDescription>Informe nome, custo e o saldo que já existe. A compra será somada a esse saldo quando recebida.</DialogDescription></DialogHeader>
    <div className="space-y-4"><div><Label htmlFor="quick-item-name">Nome *</Label><Input autoFocus id="quick-item-name" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="quick-item-category">Categoria</Label><select id="quick-item-category" className="h-10 w-full rounded-md border bg-background px-3" value={category} onChange={e => { setCategory(e.target.value); if (["filament", "resin"].includes(e.target.value)) setUnit("g"); }}><option value="consumable">Consumível</option><option value="filament">Filamento</option><option value="resin">Resina</option><option value="part">Peça / componente</option><option value="maintenance">Manutenção</option></select></div>
        <div><Label htmlFor="quick-item-unit">Unidade do estoque</Label><select id="quick-item-unit" className="h-10 w-full rounded-md border bg-background px-3" value={unit} onChange={e => setUnit(e.target.value)}>{["un", "g", "kg", "ml", "l", "m"].map(u => <option key={u} value={u}>{u}</option>)}</select></div></div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="quick-item-cost">Custo unitário (R$)</Label><Input id="quick-item-cost" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0,00" /></div><div><Label htmlFor="quick-item-stock">Estoque inicial</Label><Input id="quick-item-stock" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} /></div></div>
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    </div><DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Voltar</Button><Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Salvando…" : "Cadastrar e selecionar"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
