import { Fragment, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { nonNegative, gramsToStockUnit } from "@/lib/production";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Package, Edit, Trash2,
  Loader2, AlertTriangle, ChevronDown, ChevronRight, Palette,
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
import { allRows } from "@/lib/finance";
import { MATERIAL_CODES, materialColorSwatch, normalizeMaterialIdentity } from "@/lib/material-identity";

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
  const [editItem, setEditItem] = useState<any>(null);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Form state
  const [formMode, setFormMode] = useState<"group" | "color">("group");
  const [parentId, setParentId] = useState<string>("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("filament");
  const [materialType, setMaterialType] = useState("");
  const [color, setColor] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [materialDescription, setMaterialDescription] = useState("");
  const [colorCode, setColorCode] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [diameter, setDiameter] = useState("1.75");
  const [brand, setBrand] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("g");
  const [minStock, setMinStock] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [lossCoefficient, setLossCoefficient] = useState("5");
  const [notes, setNotes] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [freightCost, setFreightCost] = useState("");

  const { data: items = [], isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["inventory_items", profile?.tenant_id],
    queryFn: () => allRows((from, to) => supabase
        .from("inventory_items")
        .select("*")
        .eq("is_active", true)
        .order("material_type")
        .order("name").order("id").range(from, to)),
    enabled: !!profile,
  });

  // Group items: parents (no parent_id) and children (with parent_id)
  const { parentItems, childrenMap, orphanItems } = useMemo(() => {
    const parents: any[] = [];
    const children = new Map<string, any[]>();
    const orphans: any[] = [];

    for (const item of items) {
      const pid = (item as any).parent_id;
      if (pid) {
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid)!.push(item);
      } else {
        // Check if this item has children
        const hasChildren = items.some((i: any) => (i as any).parent_id === item.id);
        if (hasChildren) {
          parents.push(item);
        } else {
          orphans.push(item);
        }
      }
    }
    return { parentItems: parents, childrenMap: children, orphanItems: orphans };
  }, [items]);

  // Filter
  const filteredGroups = useMemo(() => {
    const s = search.toLowerCase();
    const matchSearch = (item: any) =>
      !search ||
      item.name.toLowerCase().includes(s) ||
      item.sku?.toLowerCase().includes(s) ||
      item.material_type?.toLowerCase().includes(s) ||
      item.color?.toLowerCase().includes(s) || item.material_code?.toLowerCase().includes(s) || item.color_code?.toLowerCase().includes(s);

    const filteredParents = parentItems.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      const kids = childrenMap.get(p.id) || [];
      return matchSearch(p) || kids.some(matchSearch);
    });

    const filteredOrphans = orphanItems.filter((o) => {
      if (categoryFilter !== "all" && o.category !== categoryFilter) return false;
      return matchSearch(o);
    });

    return { parents: filteredParents, orphans: filteredOrphans };
  }, [parentItems, orphanItems, childrenMap, categoryFilter, search]);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    setFormMode("group"); setParentId(""); setName(""); setCategory("filament");
    setMaterialType(""); setColor(""); setDiameter("1.75"); setBrand(""); setSku("");
    setMaterialCode(""); setMaterialDescription(""); setColorCode(""); setColorHex("");
    setUnit("g"); setMinStock(""); setAvgCost(""); setLossCoefficient("5");
    setNotes(""); setCurrentStock(""); setFreightCost("");
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    const isChild = !!item.parent_id;
    setFormMode(isChild ? "color" : "group");
    setParentId(item.parent_id || "");
    setName(item.name);
    setCategory(item.category);
    setMaterialType(item.material_type || "");
    setColor(item.color || "");
    setMaterialCode(item.material_code || ""); setMaterialDescription(item.material_description || "");
    setColorCode(item.color_code || ""); setColorHex(item.color_hex || "");
    setDiameter(item.diameter?.toString() || "1.75");
    setBrand(item.brand || "");
    setSku(item.sku || "");
    setUnit(item.unit);
    setMinStock(item.min_stock?.toString() || "");
    setAvgCost(item.avg_cost?.toString() || "");
    setLossCoefficient(String((item.loss_coefficient ?? 0.05) * 100));
    setNotes(item.notes || "");
    setCurrentStock(item.current_stock?.toString() || "0");
    setFreightCost(item.freight_cost?.toString() || "");
  };

  const openAddColor = (parent: any) => {
    resetForm();
    setFormMode("color");
    setParentId(parent.id);
    setCategory(parent.category);
    setMaterialType(parent.material_type || "");
    setMaterialCode(parent.material_code || ""); setMaterialDescription(parent.material_description || "");
    setDiameter(parent.diameter?.toString() || "1.75");
    setBrand(parent.brand || "");
    setUnit(parent.unit);
    setLossCoefficient(String((parent.loss_coefficient ?? 0.05) * 100));
    setName(`${parent.material_type || parent.name}`);
    setCreateOpen(true);
  };

  const validateItem = () => {
    if (!(formMode === "color" ? materialType || name : name).trim() || (formMode === "color" && (!parentId || !color.trim()))) throw new Error("Informe o nome e, para uma cor, o material de origem e a cor.");
    nonNegative(minStock, "Estoque mínimo");
    nonNegative(diameter, "Diâmetro");
    nonNegative(freightCost, "Frete");
    if (nonNegative(lossCoefficient, "Perda prevista") > 100) throw new Error("A perda prevista deve ficar entre 0% e 100%.");
    const parent = items.find(item => item.id === parentId);
    if (formMode === "color" && parent && parent.unit !== unit) throw new Error("A cor deve usar a mesma unidade de estoque do material de origem.");
    if (editItem && editItem.unit !== unit) throw new Error("A unidade de um item cadastrado não pode ser alterada. Cadastre um novo item para mudar a unidade.");
    normalizeMaterialIdentity({ materialCode, description: materialDescription, color, colorCode, colorHex });
  };

  const refreshMaterialQueries = () => {
    for (const key of ["inventory_items", "recipe_inventory_items", "product_material_recipe", "product_material_requirements", "products", "quote_products"]) qc.invalidateQueries({ queryKey: [key] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      validateItem();
      const payload: any = {
        tenant_id: profile.tenant_id,
        name: formMode === "color" ? `${materialType || name} ${color}`.trim() : name,
        category,
        material_type: materialType || null,
        ...normalizeMaterialIdentity({ materialCode, description: materialDescription, color, colorCode, colorHex }),
        diameter: diameter ? parseFloat(diameter) : null,
        brand: brand || null,
        sku: sku || null,
        unit,
        min_stock: minStock ? parseFloat(minStock) : 0,
        avg_cost: 0,
        current_stock: 0,
        loss_coefficient: nonNegative(lossCoefficient, "Perda prevista", 5) / 100,
        notes: notes || null,
        freight_cost: freightCost ? parseFloat(freightCost) : 0,
        parent_id: formMode === "color" && parentId ? parentId : null,
      };
      const { error } = await supabase.from("inventory_items").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshMaterialQueries();
      setCreateOpen(false);
      resetForm();
      toast({ title: formMode === "color" ? "Cor adicionada ao material" : "Material criado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro ao criar item", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editItem || !profile) return;
      validateItem();
      const payload: any = {
        name: formMode === "color" ? `${materialType || name} ${color}`.trim() : name,
        category,
        material_type: materialType || null,
        ...normalizeMaterialIdentity({ materialCode, description: materialDescription, color, colorCode, colorHex }),
        diameter: diameter ? parseFloat(diameter) : null,
        brand: brand || null,
        sku: sku || null,
        unit,
        min_stock: minStock ? parseFloat(minStock) : 0,
        loss_coefficient: nonNegative(lossCoefficient, "Perda prevista", 5) / 100,
        notes: notes || null,
        freight_cost: freightCost ? parseFloat(freightCost) : 0,
        parent_id: formMode === "color" && parentId ? parentId : null,
      };
      const { error } = await supabase.from("inventory_items").update(payload).eq("id", editItem.id);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshMaterialQueries();
      setEditItem(null);
      resetForm();
      toast({ title: "Item atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const item = items.find(value => value.id === id);
      if (!item || item.current_stock !== 0) throw new Error("Somente itens com saldo zero podem ser arquivados.");
      if (items.some(value => value.parent_id === id)) throw new Error("Arquive as cores vinculadas antes de arquivar o material.");
      const { error } = await supabase.from("inventory_items").update({ is_active: false }).eq("id", id).eq("current_stock", 0).select("id").single();
      if (error) throw error;
    },
    onSuccess: () => {
      refreshMaterialQueries();
      toast({ title: "Item arquivado", description: "O histórico de estoque foi preservado." });
    },
    onError: (e: any) => toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }),
  });

  // KPIs
  const totalItems = items.length;
  const lowStock = items.filter((i: any) => i.min_stock && i.current_stock < i.min_stock).length;
  const totalValue = items.reduce((s: number, i: any) => s + i.current_stock * i.avg_cost, 0);

  // Compute aggregated stats for a parent
  const getGroupStats = (parent: any) => {
    const kids = childrenMap.get(parent.id) || [];
    const totalStock = kids.reduce((sum: number, child: any) => {
      if (child.unit === parent.unit) return sum + child.current_stock;
      if (["g", "kg"].includes(child.unit) && ["g", "kg"].includes(parent.unit)) return sum + gramsToStockUnit(child.current_stock * (child.unit === "kg" ? 1000 : 1), parent.unit);
      return sum;
    }, parent.current_stock ?? 0);
    const totalVal = kids.reduce((s: number, k: any) => s + k.current_stock * k.avg_cost, (parent.current_stock ?? 0) * (parent.avg_cost ?? 0));
    const avgCostGroup = totalStock > 0 ? totalVal / totalStock : 0;
    const belowMin = kids.some((k: any) => k.min_stock && k.current_stock < k.min_stock);
    return { totalStock, totalVal, avgCostGroup, belowMin, count: kids.length };
  };

  const formFields = (
    <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-1">
      {/* Mode selector - only for new items */}
      {!editItem && (
        <div>
          <Label>Tipo de Cadastro</Label>
          <Select value={formMode} onValueChange={(v: "group" | "color") => { setFormMode(v); if (v === "group") setParentId(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="group">📦 Novo Material (grupo)</SelectItem>
              <SelectItem value="color">🎨 Nova Cor (de um material existente)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Parent selector for color mode */}
      {formMode === "color" && !editItem && (
        <div>
          <Label>Material Pai *</Label>
          <Select value={parentId} onValueChange={value => {
            setParentId(value);
            const parent = items.find(item => item.id === value);
            if (parent) { setName(parent.name); setCategory(parent.category); setMaterialType(parent.material_type ?? ""); setMaterialCode((parent as any).material_code ?? ""); setMaterialDescription((parent as any).material_description ?? ""); setUnit(parent.unit); setBrand(parent.brand ?? ""); setDiameter(String(parent.diameter ?? 1.75)); setLossCoefficient(String((parent.loss_coefficient ?? 0.05) * 100)); }
          }}>
            <SelectTrigger><SelectValue placeholder="Selecione o material..." /></SelectTrigger>
            <SelectContent>
              {[...parentItems, ...orphanItems]
                .filter((p) => p.category === "filament" || p.category === "resin")
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.material_type || p.category})</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {formMode === "group" ? (
          <div className="col-span-full">
            <Label>Nome do Material *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="PLA eSUN" />
          </div>
        ) : <p className="col-span-full text-sm text-muted-foreground">O item terá saldo próprio. Outra cor não substituirá este material nas composições.</p>}

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
          <Label>Material identificado</Label>
          <Select value={materialCode || "unidentified"} onValueChange={value => { setMaterialCode(value === "unidentified" ? "" : value); if (value !== "unidentified") setMaterialType(MATERIAL_CODES.find(([code]) => code === value)?.[1] ?? ""); }}>
            <SelectTrigger aria-label="Material identificado"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="unidentified">Ainda não identificado</SelectItem>{MATERIAL_CODES.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {materialCode === "OTHER" && <div className="col-span-full"><Label>Composição / variante do material</Label><Input value={materialDescription} onChange={event => setMaterialDescription(event.target.value)} placeholder="Informe a composição exata" /></div>}
        <div><Label>Nome da cor</Label><Input value={color} onChange={event => setColor(event.target.value)} placeholder="Vermelho / natural / transparente" /></div>
        <div><Label>Código estável da cor</Label><Input value={colorCode} onChange={event => setColorCode(event.target.value.toUpperCase())} placeholder="RED / NATURAL / código do fabricante" maxLength={64} /></div>
        <div><Label>Cor visual (opcional)</Label><div className="flex items-center gap-2"><span className="h-8 w-8 shrink-0 rounded-md border" style={{ backgroundColor: materialColorSwatch(colorHex) }} /><Input value={colorHex} onChange={event => setColorHex(event.target.value.toUpperCase())} placeholder="#RRGGBB" maxLength={7} /></div></div>
        <p className="col-span-full rounded-md bg-muted p-3 text-xs text-muted-foreground">{!materialCode ? `Identificação pendente${materialType ? `; descrição legada: ${materialType}` : ""}. O nome não será usado para adivinhar o material.` : "Confira material e código de cor na embalagem."} Para usar uma composição, informe material, nome e código da cor. Depois de referenciado em uma receita, outro material ou cor exige um novo item de estoque.</p>

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
          <Select value={unit} onValueChange={setUnit} disabled={!!editItem}>
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
          <Label>Estoque atual ({unit})</Label>
          <Input value={editItem ? currentStock : "0"} readOnly aria-readonly="true" className="bg-muted" />
        </div>
        <div>
          <Label>Custo Médio (R$/{unit})</Label>
          <Input value={editItem ? avgCost : "0"} readOnly aria-readonly="true" className="bg-muted" />
        </div>
        <div>
          <Label>Custo Frete (R$/kg)</Label>
          <Input type="number" step="0.01" value={freightCost} onChange={(e) => setFreightCost(e.target.value)} placeholder="10.00" />
        </div>
        <div>
          <Label>Perda prevista (%)</Label>
          <Input type="number" min="0" max="100" step="0.01" value={lossCoefficient} onChange={(e) => setLossCoefficient(e.target.value)} placeholder="5" />
        </div>
      </div>
      <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">O saldo e o custo médio são calculados pelas movimentações. Após cadastrar o item, registre a entrada em <Link className="font-medium text-primary underline" to="/estoque/movimentacoes">Movimentações</Link> ou em Compras.</p>
      <div>
        <Label>Observações</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </div>
  );

  const renderItemRow = (item: any, indent = false) => {
    const belowMin = item.min_stock != null && item.current_stock < item.min_stock;
    return (
      <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailItem(item)}>
        <TableCell>
          <div className={cn("flex items-center gap-2", indent && "pl-8")}>
            {belowMin && <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
            {indent && item.color && (
              <span className="h-4 w-4 rounded-full border flex-shrink-0" style={{ backgroundColor: materialColorSwatch(item.color_hex) }} />
            )}
            <div>
              <p className="font-medium text-sm">{indent ? (item.color || item.name) : item.name}</p>
              {item.brand && !indent && <p className="text-xs text-muted-foreground">{item.brand}</p>}
              {indent && item.sku && <p className="text-xs text-muted-foreground">{item.sku}</p>}
              {!item.material_identified_at && ["filament", "resin"].includes(item.category) && <p className="text-xs text-amber-700">Material/cor pendente de identificação</p>}
            </div>
          </div>
        </TableCell>
        <TableCell className="text-sm">{item.material_type || categoryLabels[item.category] || item.category}</TableCell>
        <TableCell>
          {item.color && !indent && (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: materialColorSwatch(item.color_hex) }} />
              {item.color}{item.color_code ? ` · ${item.color_code}` : ""}
            </span>
          )}
        </TableCell>
        <TableCell className={cn("text-right font-mono text-sm", belowMin && "text-destructive font-semibold")}>
          {(item.current_stock ?? 0).toLocaleString("pt-BR")}{item.unit}
        </TableCell>
        <TableCell className="text-right font-mono text-sm text-muted-foreground">
          {item.min_stock != null ? `${item.min_stock.toLocaleString("pt-BR")}${item.unit}` : "—"}
        </TableCell>
        <TableCell className="text-right font-mono text-sm">{fmtCurrency(item.avg_cost ?? 0)}</TableCell>
        <TableCell className="text-right font-mono text-sm">{fmtCurrency((item.current_stock ?? 0) * (item.avg_cost ?? 0))}</TableCell>
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
              <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Arquivar ${item.name}? O histórico será preservado.`)) deleteMut.mutate(item.id); }}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Arquivar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  };

  if (loadError) return <div className="space-y-4 rounded-xl border bg-card p-6"><p role="alert" className="font-medium">Não foi possível carregar os dados.</p><p className="text-sm text-muted-foreground">{loadError.message}</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Itens / Materiais"
        description="Cadastro de filamentos, insumos e componentes agrupados por tipo"
        breadcrumbs={[{ label: "Estoque", href: "/estoque/itens" }, { label: "Itens" }]}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { resetForm(); setFormMode("color"); setCreateOpen(true); }}>
              <Palette className="h-4 w-4 mr-1" /> Nova Cor
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setFormMode("group"); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo Material
            </Button>
          </div>
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, SKU, material, cor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v)}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
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
        ) : (filteredGroups.parents.length === 0 && filteredGroups.orphans.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" />
            <p className="font-medium">Nenhum item encontrado</p>
            <p className="text-xs mt-1">Cadastre materiais para começar a controlar estoque.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material / Cor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Cor</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Custo/un. estoque</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Grouped parents */}
              {filteredGroups.parents.map((parent) => {
                const expanded = expandedGroups.has(parent.id);
                const stats = getGroupStats(parent);
                const kids = childrenMap.get(parent.id) || [];

                return (
                  <Fragment key={parent.id}>
                    {/* Parent row */}
                    <TableRow
                      key={parent.id}
                      className="cursor-pointer hover:bg-muted/50 bg-muted/20 font-medium"
                      onClick={() => toggleGroup(parent.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          {stats.belowMin && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                          <div>
                            <p className="font-semibold text-sm">{parent.name}</p>
                            <p className="text-xs text-muted-foreground">{stats.count} cores · {parent.brand || ""}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{parent.material_type || categoryLabels[parent.category]}</TableCell>
                      <TableCell>
                        <div className="flex -space-x-1">
                          {kids.slice(0, 6).map((k: any) => (
                            <span
                              key={k.id}
                              className="h-4 w-4 rounded-full border-2 border-card"
                              style={{ backgroundColor: materialColorSwatch(k.color_hex) }}
                              title={k.color || ""}
                            />
                          ))}
                          {kids.length > 6 && <span className="text-xs text-muted-foreground ml-2">+{kids.length - 6}</span>}
                        </div>
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm font-semibold", stats.belowMin && "text-destructive")}>
                        {stats.totalStock.toLocaleString("pt-BR")}{parent.unit}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">—</TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">{fmtCurrency(stats.avgCostGroup)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">{fmtCurrency(stats.totalVal)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openAddColor(parent); }}>
                              <Palette className="h-3.5 w-3.5 mr-2" /> Adicionar Cor
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(parent); }}>
                              <Edit className="h-3.5 w-3.5 mr-2" /> Editar Material
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(parent.id); }}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Arquivar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>

                    {/* Child rows */}
                    {expanded && kids.map((kid: any) => renderItemRow(kid, true))}
                  </Fragment>
                );
              })}

              {/* Orphan items (no children, not a child) */}
              {filteredGroups.orphans.map((item) => renderItemRow(item, false))}
            </TableBody>
          </Table>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{formMode === "color" ? "Adicionar Cor" : "Novo Material"}</DialogTitle>
            <DialogDescription>
              {formMode === "color"
                ? "Cadastrar uma nova cor/variação de um material existente"
                : "Cadastrar um novo tipo de material (ex: PLA, PETG)"}
            </DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={
                (formMode === "group" && !name) ||
                (formMode === "color" && (!color || !parentId)) ||
                createMut.isPending
              }
            >
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {formMode === "color" ? "Adicionar Cor" : "Criar Material"}
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
              <div><span className="text-muted-foreground">Código do material:</span> {detailItem.material_code || "Pendente"}</div>
              <div><span className="text-muted-foreground">Código da cor:</span> {detailItem.color_code || "Pendente"}</div>
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
