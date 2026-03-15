import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Package, Edit, Trash2,
  Loader2, AlertTriangle, Eye, Archive,
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type ItemRow = Tables<"inventory_items">;

const fmtCurrency = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

const categoryLabels: Record<string, string> = {
  filament: "Filamento",
  resin: "Resina",
  part: "Peça/Componente",
  consumable: "Consumível",
  maintenance: "Manutenção",
};

export default function Itens() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<ItemRow | null>(null);
  const [detailItem, setDetailItem] = useState<ItemRow | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [category, setCategory] = useState("filament");
  const [materialType, setMaterialType] = useState("");
  const [color, setColor] = useState("");
  const [diameter, setDiameter] = useState("");
  const [brand, setBrand] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("g");
  const [minStock, setMinStock] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [lossCoefficient, setLossCoefficient] = useState("0.05");
  const [notes, setNotes] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [freightCost, setFreightCost] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const filtered = useMemo(() => {
    let list = items;
    if (categoryFilter !== "all") list = list.filter((i) => i.category === categoryFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(s) ||
          i.sku?.toLowerCase().includes(s) ||
          i.material_type?.toLowerCase().includes(s) ||
          i.color?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [items, categoryFilter, search]);

  const resetForm = () => {
    setName(""); setCategory("filament"); setMaterialType(""); setColor("");
    setDiameter(""); setBrand(""); setSku(""); setUnit("g"); setMinStock("");
    setAvgCost(""); setLossCoefficient("0.05"); setNotes(""); setCurrentStock(""); setFreightCost("");
  };

  const openEdit = (item: ItemRow) => {
    setEditItem(item);
    setName(item.name);
    setCategory(item.category);
    setMaterialType(item.material_type || "");
    setColor(item.color || "");
    setDiameter(item.diameter?.toString() || "");
    setBrand(item.brand || "");
    setSku(item.sku || "");
    setUnit(item.unit);
    setMinStock(item.min_stock?.toString() || "");
    setAvgCost(item.avg_cost?.toString() || "");
    setLossCoefficient(item.loss_coefficient?.toString() || "0.05");
    setNotes(item.notes || "");
    setCurrentStock(item.current_stock?.toString() || "0");
    setFreightCost((item as any).freight_cost?.toString() || "");
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const { error } = await supabase.from("inventory_items").insert({
        tenant_id: profile.tenant_id,
        name,
        category,
        material_type: materialType || null,
        color: color || null,
        diameter: diameter ? parseFloat(diameter) : null,
        brand: brand || null,
        sku: sku || null,
        unit,
        min_stock: minStock ? parseFloat(minStock) : 0,
        avg_cost: avgCost ? parseFloat(avgCost) : 0,
        current_stock: currentStock ? parseFloat(currentStock) : 0,
        loss_coefficient: parseFloat(lossCoefficient) || 0.05,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      setCreateOpen(false);
      resetForm();
      toast({ title: "Item criado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao criar item", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editItem || !profile) return;
      const newStock = currentStock ? parseFloat(currentStock) : 0;
      const { error } = await supabase.from("inventory_items").update({
        name,
        category,
        material_type: materialType || null,
        color: color || null,
        diameter: diameter ? parseFloat(diameter) : null,
        brand: brand || null,
        sku: sku || null,
        unit,
        min_stock: minStock ? parseFloat(minStock) : 0,
        avg_cost: avgCost ? parseFloat(avgCost) : 0,
        current_stock: newStock,
        loss_coefficient: parseFloat(lossCoefficient) || 0.05,
        notes: notes || null,
      }).eq("id", editItem.id);
      if (error) throw error;
      // If stock changed, create an adjustment movement for audit trail
      if (newStock !== editItem.current_stock) {
        const diff = newStock - editItem.current_stock;
        await supabase.from("inventory_movements").insert({
          tenant_id: profile.tenant_id,
          item_id: editItem.id,
          movement_type: "adjustment",
          quantity: Math.abs(diff),
          unit_cost: avgCost ? parseFloat(avgCost) : editItem.avg_cost,
          notes: `Ajuste manual de estoque: ${editItem.current_stock} → ${newStock}`,
          stock_after: newStock,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      setEditItem(null);
      resetForm();
      toast({ title: "Item atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      toast({ title: "Item removido" });
    },
    onError: (e: any) => toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }),
  });

  // KPIs
  const totalItems = items.length;
  const lowStock = items.filter((i) => i.min_stock && i.current_stock < i.min_stock).length;
  const totalValue = items.reduce((s, i) => s + i.current_stock * i.avg_cost, 0);

  const formFields = (
    <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Nome *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="PLA Branco eSUN 1kg" />
        </div>
        <div>
          <Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(categoryLabels).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tipo de Material</Label>
          <Input value={materialType} onChange={(e) => setMaterialType(e.target.value)} placeholder="PLA / PETG / ABS" />
        </div>
        <div>
          <Label>Cor</Label>
          <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Branco" />
        </div>
        <div>
          <Label>Diâmetro (mm)</Label>
          <Input type="number" step="0.01" value={diameter} onChange={(e) => setDiameter(e.target.value)} placeholder="1.75" />
        </div>
        <div>
          <Label>Marca</Label>
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="eSUN" />
        </div>
        <div>
          <Label>SKU</Label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="PLA-WH-1KG" />
        </div>
        <div>
          <Label>Unidade</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="g">Gramas (g)</SelectItem>
              <SelectItem value="kg">Quilos (kg)</SelectItem>
              <SelectItem value="ml">Mililitros (ml)</SelectItem>
              <SelectItem value="un">Unidade (un)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Estoque Mínimo</Label>
          <Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="200" />
        </div>
        <div>
          <Label>Estoque Atual</Label>
          <Input type="number" value={currentStock} onChange={(e) => setCurrentStock(e.target.value)} placeholder="0" />
        </div>
        <div>
          <Label>Custo Médio (R$)</Label>
          <Input type="number" step="0.01" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} placeholder="0.08" />
        </div>
        <div>
          <Label>Coef. Perda (%)</Label>
          <Input type="number" step="0.01" value={lossCoefficient} onChange={(e) => setLossCoefficient(e.target.value)} placeholder="0.05" />
        </div>
      </div>
      <div>
        <Label>Observações</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Itens / Materiais"
        description="Cadastro de filamentos, insumos e componentes"
        breadcrumbs={[{ label: "Estoque", href: "/estoque/itens" }, { label: "Itens" }]}
        actions={
          <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo Item
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Itens Cadastrados</p>
          <p className="text-2xl font-bold text-foreground">{totalItems}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Abaixo do Mínimo</p>
          <p className={cn("text-2xl font-bold", lowStock > 0 ? "text-destructive" : "text-foreground")}>{lowStock}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Valor Total em Estoque</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(totalValue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, SKU, material, cor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {Object.entries(categoryLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
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
            <p className="font-medium">Nenhum item encontrado</p>
            <p className="text-xs mt-1">Cadastre materiais para começar a controlar estoque.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Cor</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Custo/g</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const belowMin = item.min_stock != null && item.current_stock < item.min_stock;
                return (
                  <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailItem(item)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {belowMin && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                        <div>
                          <p className="font-medium text-sm">{item.name}</p>
                          {item.brand && <p className="text-xs text-muted-foreground">{item.brand}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{item.material_type || categoryLabels[item.category] || item.category}</TableCell>
                    <TableCell>
                      {item.color && (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: item.color.toLowerCase() }} />
                          {item.color}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono text-sm", belowMin && "text-destructive font-semibold")}>
                      {item.current_stock.toLocaleString("pt-BR")}{item.unit}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {item.min_stock != null ? `${item.min_stock.toLocaleString("pt-BR")}${item.unit}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(item.avg_cost)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(item.current_stock * item.avg_cost)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(item); }}>
                            <Edit className="h-3.5 w-3.5 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(item.id); }}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Item</DialogTitle>
            <DialogDescription>Cadastrar material ou insumo no estoque</DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMut.mutate()} disabled={!name || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Item</DialogTitle>
            <DialogDescription>Alterar dados do item "{editItem?.name}"</DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>Cancelar</Button>
            <Button onClick={() => updateMut.mutate()} disabled={!name || updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={(o) => { if (!o) setDetailItem(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{detailItem?.name}</DialogTitle>
            <DialogDescription>{detailItem?.brand} · {categoryLabels[detailItem?.category || ""] || detailItem?.category}</DialogDescription>
          </DialogHeader>
          {detailItem && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Material:</span> {detailItem.material_type || "—"}</div>
              <div><span className="text-muted-foreground">Cor:</span> {detailItem.color || "—"}</div>
              <div><span className="text-muted-foreground">Diâmetro:</span> {detailItem.diameter ? `${detailItem.diameter}mm` : "—"}</div>
              <div><span className="text-muted-foreground">SKU:</span> {detailItem.sku || "—"}</div>
              <div><span className="text-muted-foreground">Estoque:</span> <span className="font-semibold">{detailItem.current_stock}{detailItem.unit}</span></div>
              <div><span className="text-muted-foreground">Mínimo:</span> {detailItem.min_stock ?? "—"}{detailItem.unit}</div>
              <div><span className="text-muted-foreground">Custo Médio:</span> {fmtCurrency(detailItem.avg_cost)}/{detailItem.unit}</div>
              <div><span className="text-muted-foreground">Último Custo:</span> {fmtCurrency(detailItem.last_cost)}</div>
              <div><span className="text-muted-foreground">Coef. Perda:</span> {(detailItem.loss_coefficient * 100).toFixed(0)}%</div>
              <div><span className="text-muted-foreground">Valor em Estoque:</span> {fmtCurrency(detailItem.current_stock * detailItem.avg_cost)}</div>
              {detailItem.notes && (
                <div className="col-span-2"><span className="text-muted-foreground">Notas:</span> {detailItem.notes}</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
