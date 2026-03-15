import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Package, Edit, Trash2, Loader2, Image,
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const fmtCurrency = (v: number | null) => v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

const categoryLabels: Record<string, string> = {
  printed_part: "Peça Impressa",
  service: "Serviço",
  kit: "Kit",
  accessory: "Acessório",
};

export default function Produtos() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("printed_part");
  const [materialId, setMaterialId] = useState("");
  const [estGrams, setEstGrams] = useState("");
  const [estTime, setEstTime] = useState("");
  const [postMinutes, setPostMinutes] = useState("");
  const [costEstimate, setCostEstimate] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [notes, setNotes] = useState("");

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*, inventory_items(name)").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: materials = [] } = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_items").select("id, name, avg_cost").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const filtered = useMemo(() => {
    if (!search) return products;
    const s = search.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
  }, [products, search]);

  const resetForm = () => {
    setName(""); setDescription(""); setSku(""); setCategory("printed_part"); setMaterialId("");
    setEstGrams(""); setEstTime(""); setPostMinutes(""); setCostEstimate(""); setSalePrice(""); setNotes("");
  };

  const openEdit = (p: any) => {
    setEditItem(p); setName(p.name); setDescription(p.description || ""); setSku(p.sku || "");
    setCategory(p.category); setMaterialId(p.material_id || ""); setEstGrams(p.est_grams?.toString() || "");
    setEstTime(p.est_time_minutes?.toString() || ""); setPostMinutes(p.post_process_minutes?.toString() || "");
    setCostEstimate(p.cost_estimate?.toString() || ""); setSalePrice(p.sale_price?.toString() || ""); setNotes(p.notes || "");
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const cost = costEstimate ? parseFloat(costEstimate) : 0;
      const price = salePrice ? parseFloat(salePrice) : 0;
      const margin = price > 0 ? ((price - cost) / price) * 100 : null;
      const { error } = await supabase.from("products").insert({
        tenant_id: profile.tenant_id, name, description: description || null, sku: sku || null,
        category, material_id: materialId || null, est_grams: estGrams ? parseFloat(estGrams) : 0,
        est_time_minutes: estTime ? parseInt(estTime) : 0, post_process_minutes: postMinutes ? parseInt(postMinutes) : 0,
        cost_estimate: cost, sale_price: price, margin_percent: margin, notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setCreateOpen(false); resetForm(); toast({ title: "Produto criado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editItem) return;
      const cost = costEstimate ? parseFloat(costEstimate) : 0;
      const price = salePrice ? parseFloat(salePrice) : 0;
      const margin = price > 0 ? ((price - cost) / price) * 100 : null;
      const { error } = await supabase.from("products").update({
        name, description: description || null, sku: sku || null, category,
        material_id: materialId || null, est_grams: estGrams ? parseFloat(estGrams) : 0,
        est_time_minutes: estTime ? parseInt(estTime) : 0, post_process_minutes: postMinutes ? parseInt(postMinutes) : 0,
        cost_estimate: cost, sale_price: price, margin_percent: margin, notes: notes || null,
      }).eq("id", editItem.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setEditItem(null); resetForm(); toast({ title: "Produto atualizado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast({ title: "Produto removido" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const formFields = (
    <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vaso Geométrico P" /></div>
        <div><Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(categoryLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VASO-GEO-P" /></div>
        <div className="col-span-2"><Label>Descrição</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
      </div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receita de Produção</p>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Material</Label>
          <Select value={materialId || "none"} onValueChange={(v) => setMaterialId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Nenhum</SelectItem>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Gramas Estimadas</Label><Input type="number" value={estGrams} onChange={(e) => setEstGrams(e.target.value)} placeholder="45" /></div>
        <div><Label>Tempo Impressão (min)</Label><Input type="number" value={estTime} onChange={(e) => setEstTime(e.target.value)} placeholder="120" /></div>
        <div><Label>Pós-Processo (min)</Label><Input type="number" value={postMinutes} onChange={(e) => setPostMinutes(e.target.value)} placeholder="15" /></div>
      </div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Precificação</p>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Custo Estimado (R$)</Label><Input type="number" step="0.01" value={costEstimate} onChange={(e) => setCostEstimate(e.target.value)} placeholder="12.50" /></div>
        <div><Label>Preço de Venda (R$)</Label><Input type="number" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="39.90" /></div>
      </div>
      <div><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Produtos" description="Catálogo de produtos e serviços"
        breadcrumbs={[{ label: "Comercial" }, { label: "Produtos" }]}
        actions={<Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Produto</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Produtos Ativos</p><p className="text-2xl font-bold text-foreground">{products.filter((p: any) => p.is_active).length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Ticket Médio</p><p className="text-2xl font-bold text-foreground">{fmtCurrency(products.length > 0 ? products.reduce((s: number, p: any) => s + (p.sale_price || 0), 0) / products.length : 0)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Margem Média</p><p className="text-2xl font-bold text-foreground">{products.length > 0 ? (products.reduce((s: number, p: any) => s + (p.margin_percent || 0), 0) / products.length).toFixed(1) : "0"}%</p></div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome ou SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhum produto cadastrado</p>
          </div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Produto</TableHead><TableHead>Categoria</TableHead><TableHead>Material</TableHead>
              <TableHead className="text-right">Custo</TableHead><TableHead className="text-right">Preço</TableHead>
              <TableHead className="text-right">Margem</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p: any) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { openEdit(p); }}>
                  <TableCell>
                    <div><p className="font-medium text-sm">{p.name}</p>{p.sku && <p className="text-xs text-muted-foreground">{p.sku}</p>}</div>
                  </TableCell>
                  <TableCell className="text-sm">{categoryLabels[p.category] || p.category}</TableCell>
                  <TableCell className="text-sm">{p.inventory_items?.name || "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCurrency(p.cost_estimate)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCurrency(p.sale_price)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{p.margin_percent != null ? `${p.margin_percent.toFixed(1)}%` : "—"}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(p); }}><Edit className="h-3.5 w-3.5 mr-2" /> Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(p.id); }}><Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Novo Produto</DialogTitle><DialogDescription>Cadastrar produto ou serviço</DialogDescription></DialogHeader>
          {formFields}
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={() => createMut.mutate()} disabled={!name || createMut.isPending}>{createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Editar Produto</DialogTitle></DialogHeader>
          {formFields}
          <DialogFooter><Button variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>Cancelar</Button><Button onClick={() => updateMut.mutate()} disabled={!name || updateMut.isPending}>{updateMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
