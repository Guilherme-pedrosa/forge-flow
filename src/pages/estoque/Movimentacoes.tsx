import { useState, useMemo } from "react";
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

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  // Form
  const [itemId, setItemId] = useState("");
  const [movementType, setMovementType] = useState<MovementType>("purchase_in");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [notes, setNotes] = useState("");

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ["inventory_movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("*, inventory_items(name, unit)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_items").select("id, name, unit, avg_cost").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

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
      const { error } = await supabase.from("inventory_movements").insert({
        tenant_id: profile.tenant_id,
        item_id: itemId,
        movement_type: movementType,
        quantity: parseFloat(quantity),
        unit_cost: unitCost ? parseFloat(unitCost) : null,
        lot_number: lotNumber || null,
        notes: notes || null,
        created_by: profile.user_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_movements"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      setCreateOpen(false);
      setItemId(""); setQuantity(""); setUnitCost(""); setLotNumber(""); setNotes("");
      toast({ title: "Movimentação registrada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Movimentações"
        description="Entradas, saídas e ajustes de estoque"
        breadcrumbs={[{ label: "Estoque", href: "/estoque/itens" }, { label: "Movimentações" }]}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nova Movimentação
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por item, lote, notas…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
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
                const cfg = typeLabels[m.movement_type];
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
                      {cfg.direction === "out" ? "-" : "+"}{m.quantity.toLocaleString("pt-BR")}{itemData?.unit || ""}
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Movimentação</DialogTitle>
            <DialogDescription>Registrar entrada ou saída de estoque</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Item *</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder="Selecione o item" /></SelectTrigger>
                <SelectContent>
                  {items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo *</Label>
              <Select value={movementType} onValueChange={(v) => setMovementType(v as MovementType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(typeLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade *</Label>
                <Input type="number" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1000" />
              </div>
              <div>
                <Label>Custo Unitário (R$)</Label>
                <Input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0.08" />
              </div>
            </div>
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMut.mutate()} disabled={!itemId || !quantity || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
