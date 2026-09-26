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
  const id = useRef(crypto.randomUUID());
  const mutation = useMutation({ mutationFn: async () => {
    if (!profile || !name.trim()) throw new Error("Informe o nome do item.");
    const item = { id: id.current, tenant_id: profile.tenant_id, name: name.trim(), unit, category: category as "consumable" | "filament" | "resin" | "part" | "maintenance" };
    const result = await supabase.from("inventory_items").insert(item).select("id, name, unit").single();
    if (result.error) {
      // A retry after a lost response must not create a duplicate item.
      if (result.error.code !== "23505") throw new Error(result.error.message);
      const previous = await supabase.from("inventory_items").select("id, name, unit").eq("id", id.current).eq("tenant_id", profile.tenant_id).single();
      if (previous.error || !previous.data) throw new Error(result.error.message);
      return previous.data;
    }
    return result.data;
  }, onSuccess: async item => { await qc.invalidateQueries({ queryKey: ["inventory_items"] }); onCreated(item); onClose(); } });
  return <Dialog open={open} onOpenChange={v => !v && !mutation.isPending && onClose()}><DialogContent closeDisabled={mutation.isPending}>
    <DialogHeader><DialogTitle>Cadastrar item de estoque</DialogTitle><DialogDescription>Cadastre o básico e continue de onde parou. A quantidade será registrada na entrada ou na compra.</DialogDescription></DialogHeader>
    <div className="space-y-4"><div><Label htmlFor="quick-item-name">Nome *</Label><Input autoFocus id="quick-item-name" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="quick-item-category">Categoria</Label><select id="quick-item-category" className="h-10 w-full rounded-md border bg-background px-3" value={category} onChange={e => { setCategory(e.target.value); if (["filament", "resin"].includes(e.target.value)) setUnit("g"); }}><option value="consumable">Consumível</option><option value="filament">Filamento</option><option value="resin">Resina</option><option value="part">Peça / componente</option><option value="maintenance">Manutenção</option></select></div>
        <div><Label htmlFor="quick-item-unit">Unidade do estoque</Label><select id="quick-item-unit" className="h-10 w-full rounded-md border bg-background px-3" value={unit} onChange={e => setUnit(e.target.value)}>{["un", "g", "kg", "ml", "l", "m"].map(u => <option key={u} value={u}>{u}</option>)}</select></div></div>
      {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    </div><DialogFooter><Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Voltar</Button><Button disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Salvando…" : "Cadastrar e selecionar"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
