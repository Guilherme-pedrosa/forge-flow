import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Package, Edit, Trash2, Loader2, Image, CloudDownload, FolderOpen, History, Globe, Link,
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
const fmtDuration = (s: number | null) => {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return `${m} min`;
};

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
  const [bambuImportOpen, setBambuImportOpen] = useState(false);
  const [bambuTab, setBambuTab] = useState<"projects" | "tasks" | "makerworld">("projects");
  const [makerWorldUrl, setMakerWorldUrl] = useState(""); 
  const [makerWorldLoading, setMakerWorldLoading] = useState(false);
  const [makerWorldModels, setMakerWorldModels] = useState<any[]>([]);

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
  const [photoUrl, setPhotoUrl] = useState("");
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

  // Fetch Bambu tasks for import
  const { data: bambuTasks = [], isLoading: bambuTasksLoading } = useQuery({
    queryKey: ["bambu_tasks_for_import"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bambu_tasks")
        .select("*, bambu_devices(name)")
        .eq("status", "2")
        .order("start_time", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!profile && bambuImportOpen && bambuTab === "tasks",
  });

  // Fetch Bambu projects (saved models / collections)
  const { data: bambuProjects = [], isLoading: bambuProjectsLoading } = useQuery({
    queryKey: ["bambu_projects_for_import"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "projects" },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data.projects || [];
    },
    enabled: !!profile && bambuImportOpen && bambuTab === "projects",
  });

  const filtered = useMemo(() => {
    if (!search) return products;
    const s = search.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
  }, [products, search]);

  const resetForm = () => {
    setName(""); setDescription(""); setSku(""); setCategory("printed_part"); setMaterialId("");
    setEstGrams(""); setEstTime(""); setPostMinutes(""); setCostEstimate(""); setSalePrice(""); setPhotoUrl(""); setNotes("");
  };

  const openEdit = (p: any) => {
    setEditItem(p); setName(p.name); setDescription(p.description || ""); setSku(p.sku || "");
    setCategory(p.category); setMaterialId(p.material_id || ""); setEstGrams(p.est_grams?.toString() || "");
    setEstTime(p.est_time_minutes?.toString() || ""); setPostMinutes(p.post_process_minutes?.toString() || "");
    setCostEstimate(p.cost_estimate?.toString() || ""); setSalePrice(p.sale_price?.toString() || "");
    setPhotoUrl(p.photo_url || ""); setNotes(p.notes || "");
  };

  const importFromBambuTask = (task: any) => {
    resetForm();
    setName(task.design_title || "Produto Bambu");
    setEstGrams(task.weight_grams?.toString() || "");
    setEstTime(task.cost_time_seconds ? Math.round(task.cost_time_seconds / 60).toString() : "");
    setPhotoUrl(task.cover_url || "");
    setCategory("printed_part");
    setNotes(`Importado da Bambu Lab — Task ID: ${task.bambu_task_id}`);
    setBambuImportOpen(false);
    setCreateOpen(true);
    toast({ title: "Dados importados", description: "Preencha custo e preço para finalizar o cadastro." });
  };

  const importFromBambuProject = (proj: any) => {
    resetForm();
    setName(proj.name || "Produto Bambu");
    setEstGrams(proj.total_weight_grams ? proj.total_weight_grams.toFixed(1) : "");
    setEstTime(proj.total_time_seconds ? Math.round(proj.total_time_seconds / 60).toString() : "");
    setPhotoUrl(proj.thumbnail || "");
    setCategory("printed_part");
    const filamentInfo = proj.filaments?.length > 0
      ? proj.filaments.map((f: any) => `${f.type} ${f.grams}g`).join(", ")
      : "";
    setNotes(`Importado da Bambu Lab — Projeto: ${proj.project_id}${filamentInfo ? `\nFilamentos: ${filamentInfo}` : ""}`);
    setBambuImportOpen(false);
    setCreateOpen(true);
    toast({ title: "Dados importados", description: "Preencha custo e preço para finalizar o cadastro." });
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
        photo_url: photoUrl || null,
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
        photo_url: photoUrl || null,
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
      {/* Photo preview */}
      {photoUrl && (
        <div className="flex items-center gap-3">
          <img src={photoUrl} alt="Preview" className="w-20 h-20 rounded-lg object-cover border" />
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Foto do Produto</p>
            <Button variant="ghost" size="sm" className="text-destructive text-xs mt-1" onClick={() => setPhotoUrl("")}>Remover foto</Button>
          </div>
        </div>
      )}
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
      {!photoUrl && (
        <div>
          <Label>URL da Foto</Label>
          <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
        </div>
      )}
      <div><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Produtos" description="Catálogo de produtos e serviços"
        breadcrumbs={[{ label: "Comercial" }, { label: "Produtos" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setBambuImportOpen(true)}>
              <CloudDownload className="h-4 w-4 mr-1" /> Importar da Bambu
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo Produto
            </Button>
          </div>
        }
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
              <TableHead></TableHead><TableHead>Produto</TableHead><TableHead>Categoria</TableHead><TableHead>Material</TableHead>
              <TableHead className="text-right">Custo</TableHead><TableHead className="text-right">Preço</TableHead>
              <TableHead className="text-right">Margem</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p: any) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { openEdit(p); }}>
                  <TableCell className="w-12">
                    {p.photo_url ? (
                      <img src={p.photo_url} alt="" className="w-10 h-10 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                        <Image className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
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

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Novo Produto</DialogTitle><DialogDescription>Cadastrar produto ou serviço</DialogDescription></DialogHeader>
          {formFields}
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={() => createMut.mutate()} disabled={!name || createMut.isPending}>{createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Editar Produto</DialogTitle></DialogHeader>
          {formFields}
          <DialogFooter><Button variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>Cancelar</Button><Button onClick={() => updateMut.mutate()} disabled={!name || updateMut.isPending}>{updateMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bambu Import dialog */}
      <Dialog open={bambuImportOpen} onOpenChange={setBambuImportOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CloudDownload className="h-5 w-5 text-primary" /> Importar da Bambu Lab</DialogTitle>
            <DialogDescription>Selecione um modelo salvo ou impressão concluída para importar</DialogDescription>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-muted">
            <button
              onClick={() => setBambuTab("projects")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors",
                bambuTab === "projects" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FolderOpen className="h-4 w-4" /> Meus Projetos
            </button>
            <button
              onClick={() => setBambuTab("tasks")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors",
                bambuTab === "tasks" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <History className="h-4 w-4" /> Impressões Concluídas
            </button>
          </div>

          <div className="overflow-y-auto max-h-[50vh]">
            {bambuTab === "projects" ? (
              bambuProjectsLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : bambuProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FolderOpen className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Nenhum projeto salvo encontrado</p>
                  <p className="text-xs mt-1">Conecte-se na página de Integrações → Bambu Lab</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {bambuProjects.map((p: any) => (
                    <button
                      key={p.project_id}
                      onClick={() => importFromBambuProject(p)}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
                    >
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Image className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{p.name || "Sem nome"}</p>
                        {p.filaments?.length > 0 && (
                          <p className="text-xs text-muted-foreground truncate">
                            {p.filaments.map((f: any) => f.type).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          {p.total_weight_grams > 0 && <span>{p.total_weight_grams.toFixed(1)}g</span>}
                          {p.total_time_seconds > 0 && <span>{fmtDuration(p.total_time_seconds)}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : (
              bambuTasksLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : bambuTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CloudDownload className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm">Nenhuma impressão concluída encontrada</p>
                  <p className="text-xs mt-1">Conecte-se na página de Integrações → Bambu Lab e sincronize</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {bambuTasks.map((t: any) => (
                    <button
                      key={t.id}
                      onClick={() => importFromBambuTask(t)}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left"
                    >
                      {t.cover_url ? (
                        <img src={t.cover_url} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <Image className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{t.design_title || "Sem título"}</p>
                        <p className="text-xs text-muted-foreground">{t.bambu_devices?.name || "—"}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          {t.weight_grams != null && <span>{t.weight_grams}g</span>}
                          {t.cost_time_seconds != null && <span>{fmtDuration(t.cost_time_seconds)}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
