import { useSearchParams } from "react-router-dom";
import { QuickInventoryItem } from "@/components/estoque/QuickInventoryItem";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { orderRequest } from "@/lib/sales-order";
import { nonNegative, validateMovement, movementDirection } from "@/lib/production";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, Loader2, ArrowUpCircle, ArrowDownCircle, Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Tables, Enums } from "@/integrations/supabase/types";

type MovementRow = Tables<"inventory_movements">;
type MovementType = Enums<"movement_type">;

const typeLabels: Record<MovementType, { label: string; direction: "in" | "out" }> = {
  purchase_in: { label: "Compra/Entrada", direction: "in" },
  job_consumption: { label: "Consumo (Job)", direction: "out" },
  loss: { label: "Perda", direction: "out" },
  maintenance: { label: "Manutenção", direction: "out" },
  adjustment: { label: "Ajuste", direction: "in" },
  return: { label: "Devolução", direction: "in" },
};

const fmtCurrency = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

export default function Movimentacoes() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const request = useRef<{ signature: string; id: string } | null>(null);

  const [params] = useSearchParams();
  const itemFromLink = params.get("item");
  const historyOnly = params.get("historico") === "1";
  const [quickItemOpen, setQuickItemOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(!!itemFromLink && !historyOnly);

  // Form
  const [itemId, setItemId] = useState(itemFromLink || "");
  const [movementType, setMovementType] = useState<MovementType>("purchase_in");
  const [direction, setDirection] = useState("in");
  const [extraRows, setExtraRows] = useState<{itemId:string;quantity:string;unitCost:string}[]>([]);
  const [page, setPage] = useState(0);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [notes, setNotes] = useState("");

  const { data: movements = [], isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["inventory_movements", profile?.tenant_id, page, typeFilter, itemFromLink],
    queryFn: async () => {
      let query = supabase
        .from("inventory_movements")
        .select("*, inventory_items(name, unit)")
        .order("created_at", { ascending: false }).order("id", { ascending: false });
      if (itemFromLink) query = query.eq("item_id", itemFromLink);
      if (typeFilter !== "all") query = query.eq("movement_type", typeFilter as MovementType);
      const { data, error } = await query.range(page * 100, page * 100 + 99);
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["inventory_items", "movement-select"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_items").select("id, name, unit, avg_cost, current_stock").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const appliedItemLink = useRef<string | null>(null);
  useEffect(() => { const item = items.find(i => i.id === itemFromLink); if (item && appliedItemLink.current !== item.id) { appliedItemLink.current = item.id; setItemId(item.id); setUnitCost(String(item.avg_cost)); setCreateOpen(!historyOnly); } }, [items, itemFromLink, historyOnly]);

  const filtered = useMemo(() => {
    let list = movements;
    if (typeFilter !== "all") list = list.filter((m) => m.movement_type === typeFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((m) =>
        (m as any).inventory_items?.name?.toLowerCase().includes(s) ||
        m.notes?.toLowerCase().includes(s) ||
        m.lot_number?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [movements, typeFilter, search]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const rows = [{itemId,quantity,unitCost}, ...extraRows];
      if (new Set(rows.map(row => row.itemId)).size !== rows.length) throw new Error("Inclua cada item uma vez e some suas quantidades.");
      const movements = rows.map(row => {
        const item = items.find(value => value.id === row.itemId);
        if (!item) throw new Error("Selecione um item ativo em cada linha.");
        const qty = nonNegative(row.quantity, "Quantidade");
        const amount = direction === "out" ? -qty : direction === "count" ? qty - item.current_stock : qty;
        const type = direction === "in" ? "purchase_in" : "adjustment";
        const reason = notes.trim() || (direction === "out" ? "Saída avulsa de estoque" : direction === "count" ? "Conferência de estoque" : "Entrada avulsa de estoque");
        validateMovement(type, amount, item.current_stock, reason);
        const cost = direction === "in" ? nonNegative(row.unitCost, "Custo unitário") : null;
        return {item_id:row.itemId,movement_type:type,quantity:amount,unit_cost:cost,lot_number:lotNumber.trim() || null,notes:reason};
      });
      request.current = orderRequest(request.current, JSON.stringify(movements));
      const rpc = supabase.rpc.bind(supabase) as unknown as (name:string,args:Record<string,unknown>) => PromiseLike<{error:{message:string}|null}>;
      const {error} = movements.length === 1
        ? await rpc("post_inventory_movement", {p_movement:movements[0],p_request_id:request.current.id})
        : await rpc("post_inventory_batch", {p_movements:movements,p_request_id:request.current.id});
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      request.current = null;
      qc.invalidateQueries({ queryKey: ["inventory_movements"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      setCreateOpen(false);
      setExtraRows([]); setItemId(""); setQuantity(""); setUnitCost(""); setLotNumber(""); setNotes("");
      toast({ title: "Movimentação registrada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (loadError) return <div className="space-y-4 rounded-xl border bg-card p-6"><p role="alert" className="font-medium">Não foi possível carregar os dados.</p><p className="text-sm text-muted-foreground">{loadError.message}</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {quickItemOpen && <QuickInventoryItem open onClose={() => setQuickItemOpen(false)} onCreated={item => setItemId(item.id)} />}
      <PageHeader
        title="Movimentações"
        description="Entradas, saídas e ajustes de estoque"
        breadcrumbs={[{ label: "Estoque", href: "/estoque/itens" }, { label: "Movimentações" }]}
        actions={
          <Button size="sm" onClick={() => { request.current = null; setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova Movimentação
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por item, lote, notas…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={value => { setTypeFilter(value); setPage(0); }}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(typeLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" />
            <p className="font-medium">Nenhuma movimentação encontrada</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Custo Unit.</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Estoque Após</TableHead>
                <TableHead>Lote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => {
                const cfg = { ...typeLabels[m.movement_type], direction: movementDirection(m.movement_type, m.quantity) };
                const itemData = (m as any).inventory_items;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">{new Date(m.created_at).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell>
                      <span className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium",
                        cfg.direction === "in" ? "text-emerald-600" : "text-destructive"
                      )}>
                        {cfg.direction === "in" ? <ArrowUpCircle className="h-3.5 w-3.5" /> : <ArrowDownCircle className="h-3.5 w-3.5" />}
                        {cfg.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm font-medium">{itemData?.name || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {cfg.direction === "out" ? "-" : "+"}{Math.abs(m.quantity).toLocaleString("pt-BR")}{itemData?.unit || ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(m.unit_cost)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(m.total_cost)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{m.stock_after != null ? m.stock_after.toLocaleString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.lot_number || "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>Página {page + 1} · {movements.length} registros. A busca filtra esta página.</span>
        <div className="flex gap-2"><Button variant="outline" disabled={page === 0 || isLoading} onClick={() => setPage(value => value - 1)}>Anterior</Button><Button variant="outline" disabled={movements.length < 100 || isLoading} onClick={() => setPage(value => value + 1)}>Próxima</Button></div>
      </div>
      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={open => { if (!createMut.isPending) setCreateOpen(open); }}>
        <DialogContent className="flex max-h-[94dvh] w-[96vw] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle>Nova Movimentação</DialogTitle>
            <DialogDescription>Entrada ou saída avulsa, sem gerar contas a pagar. Para registrar também a despesa, use Compras.</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-4 overflow-y-auto pr-1">
            <div>
              <Label>Item *</Label>
              <SearchableItemSelect value={itemId} label="Item de estoque" emptyLabel="Selecione o item" options={items.map(item => ({ id: item.id, label: `${item.name} (${item.unit})` }))} onChange={id => { setItemId(id); const item = items.find(i => i.id === id); setUnitCost(item ? String(item.avg_cost) : ""); }} />
              <Button type="button" variant="link" className="px-0" onClick={() => setQuickItemOpen(true)}>+ Cadastrar item sem sair da entrada</Button>
            </div>
            <div><Label htmlFor="stock-operation">Movimentação</Label><select id="stock-operation" className="h-11 w-full rounded-md border bg-background px-3" value={direction} onChange={e => setDirection(e.target.value)}><option value="in">Entrada</option><option value="out">Saída</option><option value="count">Conferência de saldo</option></select></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{direction === "count" ? "Quantidade contada" : "Quantidade"} ({items.find(item => item.id === itemId)?.unit ?? "unidade"}) *</Label>
                <Input aria-label="Quantidade da movimentação" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1000" />
              </div>
              <div>
                <Label>Custo (R$/{items.find(item => item.id === itemId)?.unit ?? "unidade"})</Label>
                <Input aria-label="Custo unitário da movimentação" disabled={direction !== "in"} inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.08" />
              </div>
            </div>
            <p className="rounded-lg bg-muted p-3 text-sm">Saldo atual: <strong>{items.find(item => item.id === itemId)?.current_stock ?? 0}</strong> · Saldo após salvar: <strong>{(() => {const current=items.find(item => item.id === itemId)?.current_stock ?? 0;const qty=Number(quantity.replace(",",".")) || 0;return direction === "count" ? qty : current + (direction === "out" ? -qty : qty);})()}</strong></p>
            {extraRows.map((row,idx) => <div key={idx} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_120px_120px_auto]"><SearchableItemSelect label={`Item adicional ${idx+1}`} value={row.itemId} emptyLabel="Selecione outro produto" options={items.map(i => ({id:i.id,label:`${i.name} (${i.unit}) · saldo ${i.current_stock}`}))} onChange={id => setExtraRows(rows => rows.map((r,i) => i===idx ? {...r,itemId:id,unitCost:String(items.find(x=>x.id===id)?.avg_cost ?? 0)} : r))}/><Input aria-label={`Quantidade adicional ${idx+1}`} inputMode="decimal" placeholder="Quantidade" value={row.quantity} onChange={e => setExtraRows(rows => rows.map((r,i) => i===idx ? {...r,quantity:e.target.value} : r))}/><Input aria-label={`Custo adicional ${idx+1}`} inputMode="decimal" disabled={direction!=="in"} value={row.unitCost} onChange={e => setExtraRows(rows => rows.map((r,i) => i===idx ? {...r,unitCost:e.target.value} : r))}/><Button variant="ghost" onClick={() => setExtraRows(rows => rows.filter((_,i)=>i!==idx))}>Remover</Button></div>)}
            <Button type="button" variant="outline" onClick={() => setExtraRows(rows => [...rows,{itemId:"",quantity:"1",unitCost:"0"}])}>Adicionar outro produto</Button>

            <div>
              <Label>Lote</Label>
              <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="LOT-2026-03" />
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={createMut.isPending} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMut.mutate()} disabled={!itemId || !quantity || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
