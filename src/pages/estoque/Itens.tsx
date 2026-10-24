import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { orderRequest } from "@/lib/sales-order";
import { DeleteRecordDialog, type DeleteTarget } from "@/components/shared/DeleteRecordDialog";
import { Fragment, useState, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  part: "Componente comprado",
  consumable: "Insumo / embalagem",
  maintenance: "Manutenção",
};

export default function Itens() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const saveRequest = useRef<{ signature: string; id: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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

  const { data: catalog, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["inventory_items", profile?.tenant_id, "catalog-context"],
    queryFn: async () => {
      const [items, products] = await Promise.all([
        allRows((from, to) => supabase
        .from("inventory_items")
        .select("*")
        .eq("tenant_id", profile!.tenant_id)
        .eq("is_active", true)
        .order("material_type")
        .order("name").order("id").range(from, to)),
        allRows<{ id: string; name: string; stock_item_id: string | null; is_component: boolean }>((from, to) => supabase
          .from("products").select("id,name,stock_item_id,is_component").eq("tenant_id", profile!.tenant_id)
          .order("id").range(from, to).returns<{ id: string; name: string; stock_item_id: string | null; is_component: boolean }[]>()),
      ]);
      return { items, owners: new Map(products.filter(product => product.stock_item_id).map(product => [product.stock_item_id!, product])) };
    },
    enabled: !!profile,
  });
  const items = catalog?.items ?? [];
  const owners = useMemo(() => catalog?.owners ?? new Map<string, { id: string; name: string; is_component: boolean }>(), [catalog]);
  const printingMaterial = category === "filament" || category === "resin";
  const itemTitle = formMode === "color" ? "Nova cor de material" : category === "filament" ? "Novo filamento" : category === "resin" ? "Nova resina" : "Novo insumo";
  const changeCategory = (value: string) => {
    setCategory(value);
    if (!editItem) {
      const printing = value === "filament" || value === "resin";
      if (!currentStock.trim() && !avgCost.trim()) setUnit(printing ? "g" : "un");
      setDiameter(value === "filament" ? "1.75" : "");
      setMaterialCode(value === "resin" ? "RESIN" : "");
      setMaterialType(value === "resin" ? "Resina" : "");
      setMaterialDescription(""); setColor(""); setColorCode(""); setColorHex("");
      setLossCoefficient(printing ? "5" : "0"); setFreightCost("");
    }
    if (value !== "filament" && value !== "resin") { setFormMode("group"); setParentId(""); }
  };
  const openCreate = (value: "filament" | "consumable") => {
    resetForm(); setCategory(value); setUnit(value === "filament" ? "g" : "un");
    setDiameter(value === "filament" ? "1.75" : ""); setLossCoefficient(value === "filament" ? "5" : "0"); setCreateOpen(true);
  };

  // Group items: parents (no parent_id) and children (with parent_id)
  const { parentItems, childrenMap, orphanItems } = useMemo(() => {
    const parents: any[] = [];
    const children = new Map<string, any[]>();
    const orphans: any[] = [];

    for (const item of items) {
      if (owners.has(item.id)) { orphans.push(item); continue; }
      const pid = (item as any).parent_id;
      if (pid && items.some(parent => parent.id === pid) && !owners.has(pid)) {
        if (!children.has(pid)) children.set(pid, []);
        children.get(pid)!.push(item);
      } else {
        // Check if this item has children
        const hasChildren = items.some((i: any) => (i as any).parent_id === item.id && !owners.has(i.id));
        if (hasChildren) {
          parents.push(item);
        } else {
          orphans.push(item);
        }
      }
    }
    return { parentItems: parents, childrenMap: children, orphanItems: orphans };
  }, [items, owners]);

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
      if (categoryFilter === "outputs") return false;
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      const kids = childrenMap.get(p.id) || [];
      return matchSearch(p) || kids.some(matchSearch);
    });

    const filteredOrphans = orphanItems.filter((o) => {
      if (categoryFilter === "outputs") return owners.has(o.id) && matchSearch(o);
      if (categoryFilter !== "all" && owners.has(o.id)) return false;
      if (categoryFilter !== "all" && o.category !== categoryFilter) return false;
      return matchSearch(o);
    });

    return { parents: filteredParents, orphans: filteredOrphans };
  }, [parentItems, orphanItems, childrenMap, categoryFilter, search, owners]);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetForm = () => {
    saveRequest.current = null;
    setFormMode("group"); setParentId(""); setName(""); setCategory("filament");
    setMaterialType(""); setColor(""); setDiameter("1.75"); setBrand(""); setSku("");
    setMaterialCode(""); setMaterialDescription(""); setColorCode(""); setColorHex("");
    setUnit("g"); setMinStock(""); setAvgCost(""); setLossCoefficient("5");
    setNotes(""); setCurrentStock(""); setFreightCost("");
  };

  const openEdit = (item: any) => {
    const owner = owners.get(item.id);
    if (owner) { navigate(`/comercial/produtos/${owner.id}`); return; }
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
    setDiameter(item.diameter?.toString() || (item.category === "filament" ? "1.75" : ""));
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
        diameter: category === "filament" && diameter ? parseFloat(diameter) : null,
        brand: brand || null,
        sku: sku || null,
        unit,
        min_stock: minStock ? parseFloat(minStock) : 0,
        avg_cost: nonNegative(avgCost, "Custo"),
        current_stock: nonNegative(currentStock, "Estoque inicial"),
        loss_coefficient: nonNegative(lossCoefficient, "Perda prevista", 5) / 100,
        notes: notes || null,
        freight_cost: freightCost ? parseFloat(freightCost) : 0,
        parent_id: formMode === "color" && parentId ? parentId : null,
      };
      saveRequest.current = orderRequest(saveRequest.current, JSON.stringify(payload));
      const { error } = await (supabase.rpc as any)("save_inventory_catalog", { p_item_id: null, p_item: payload, p_request_id: saveRequest.current.id });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshMaterialQueries();
      setCreateOpen(false);
      resetForm();
      toast({ title: formMode === "color" ? "Cor adicionada ao material" : "Item de estoque cadastrado" });
    },
    onError: (e: any) => toast({ title: "Erro ao criar item", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editItem || !profile) return;
      if (owners.has(editItem.id)) throw new Error("Abra o cadastro do produto ou da peça para alterar este estoque.");
      validateItem();
      const payload: any = {
        name: formMode === "color" ? `${materialType || name} ${color}`.trim() : name,
        category,
        material_type: materialType || null,
        ...normalizeMaterialIdentity({ materialCode, description: materialDescription, color, colorCode, colorHex }),
        diameter: category === "filament" ? (diameter ? parseFloat(diameter) : null) : editItem.diameter ?? null,
        brand: brand || null,
        sku: sku || null,
        unit,
        min_stock: minStock ? parseFloat(minStock) : 0,
        loss_coefficient: nonNegative(lossCoefficient, "Perda prevista", 5) / 100,
        notes: notes || null,
        freight_cost: freightCost ? parseFloat(freightCost) : 0,
        parent_id: formMode === "color" && parentId ? parentId : null,
      };
      if (nonNegative(currentStock, "Estoque") !== Number(editItem.current_stock)) { payload.current_stock = nonNegative(currentStock, "Estoque"); payload.expected_stock = Number(editItem.current_stock); }
      if (nonNegative(avgCost, "Custo") !== Number(editItem.avg_cost)) payload.avg_cost = nonNegative(avgCost, "Custo");
      saveRequest.current = orderRequest(saveRequest.current, JSON.stringify([editItem.id, payload]));
      const { error } = await (supabase.rpc as any)("save_inventory_catalog", { p_item_id: editItem.id, p_item: payload, p_request_id: saveRequest.current.id });
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
      if (owners.has(id)) throw new Error("Abra o cadastro do produto ou da peça para gerenciar este estoque.");
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
    <div className="min-h-0 space-y-5 overflow-y-auto px-1 pb-1">
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">Identificação do item</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="inventory-kind">Tipo de item</Label>
            <Select value={category} onValueChange={changeCategory} disabled={formMode === "color"}>
              <SelectTrigger id="inventory-kind" aria-label="Tipo de item"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(categoryLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {formMode === "group" && <div><Label htmlFor="inventory-name">Nome do item *</Label><Input id="inventory-name" value={name} onChange={e => setName(e.target.value)} placeholder={printingMaterial ? "Ex.: PLA branco eSUN" : "Ex.: Caixa para presente 15 × 15 cm"} /></div>}
        </div>
        {formMode === "color" && <div className="space-y-2">
          {!editItem && <><Label>Material de origem *</Label><SearchableItemSelect label="Material de origem" value={parentId} emptyLabel="Selecionar material existente" options={items.filter(item => !owners.has(item.id) && !item.parent_id && ["filament", "resin"].includes(item.category)).map(item => ({ id: item.id, label: item.name, description: item.brand || categoryLabels[item.category] }))} onChange={value => {
            setParentId(value);
            const parent = items.find(item => item.id === value);
            if (parent) { setName(parent.name); setCategory(parent.category); setMaterialType(parent.material_type ?? ""); setMaterialCode(parent.material_code ?? ""); setMaterialDescription(parent.material_description ?? ""); setUnit(parent.unit); setBrand(parent.brand ?? ""); setDiameter(String(parent.diameter ?? 1.75)); setLossCoefficient(String((parent.loss_coefficient ?? 0.05) * 100)); }
          }} /></>}
          <p className="text-xs text-muted-foreground">Cada cor tem seu próprio saldo e custo. O agrupamento facilita encontrar as variações.</p>
        </div>}
        {printingMaterial && <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
          <div><Label htmlFor="inventory-material">Material identificado</Label><Select value={materialCode || "unidentified"} onValueChange={value => { setMaterialCode(value === "unidentified" ? "" : value); if (value !== "unidentified") setMaterialType(MATERIAL_CODES.find(([code]) => code === value)?.[1] ?? ""); }}><SelectTrigger id="inventory-material" aria-label="Material identificado"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unidentified">Identificar depois</SelectItem>{MATERIAL_CODES.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="inventory-color">Nome da cor{formMode === "color" ? " *" : ""}</Label><Input id="inventory-color" value={color} onChange={e => setColor(e.target.value)} placeholder="Ex.: Branco" /></div>
          {materialCode === "OTHER" && <div className="sm:col-span-2"><Label htmlFor="inventory-composition">Composição / variante do material</Label><Input id="inventory-composition" value={materialDescription} onChange={e => setMaterialDescription(e.target.value)} placeholder="Informe a composição exata" /></div>}
          <div><Label htmlFor="inventory-color-code">Código da cor</Label><Input id="inventory-color-code" value={colorCode} onChange={e => setColorCode(e.target.value.toUpperCase())} placeholder="Ex.: WHITE ou código do fabricante" maxLength={64} /></div>
          <div><Label htmlFor="inventory-color-hex">Amostra visual (opcional)</Label><div className="flex items-center gap-2"><span className="h-8 w-8 shrink-0 rounded-md border" style={{ backgroundColor: materialColorSwatch(colorHex) }} /><Input id="inventory-color-hex" value={colorHex} onChange={e => setColorHex(e.target.value.toUpperCase())} placeholder="#RRGGBB" maxLength={7} /></div></div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">Tipo e código da cor identificam o material nas receitas e impressões. Você pode registrar o estoque agora e completar a identificação depois.</p>
        </div>}
      </fieldset>
      <fieldset className="space-y-3 border-t pt-4">
        <legend className="font-semibold">Saldo e custo</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Unidade do saldo</Label><Select value={unit} onValueChange={setUnit} disabled={!!editItem}><SelectTrigger aria-label="Unidade do saldo no estoque"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="g">Gramas (g)</SelectItem><SelectItem value="kg">Quilos (kg)</SelectItem><SelectItem value="un">Unidade (un)</SelectItem><SelectItem value="ml">Mililitros (ml)</SelectItem><SelectItem value="l">Litros (l)</SelectItem><SelectItem value="m">Metros (m)</SelectItem></SelectContent></Select></div>
          <div><Label htmlFor="inventory-stock">{editItem ? "Estoque atual" : "Estoque inicial"} ({unit})</Label><Input id="inventory-stock" aria-label="Quantidade em estoque" inputMode="decimal" value={currentStock} onChange={e => setCurrentStock(e.target.value)} placeholder="0" /></div>
          <div><Label htmlFor="inventory-cost">Custo médio (R$/{unit})</Label><Input id="inventory-cost" aria-label="Custo unitário do estoque" inputMode="decimal" value={avgCost} onChange={e => setAvgCost(e.target.value)} placeholder="0,00" /></div>
        </div>
        <p className="text-xs text-muted-foreground">{printingMaterial && ["g", "kg"].includes(unit) ? `Um rolo de 1 kg corresponde a ${unit === "g" ? "1.000 g" : "1 kg"}. A impressão consome esse saldo; em Bobinas você identifica cada rolo e sua localização.` : "Informe a quantidade física existente e o custo por unidade de estoque."}</p>
        <p className="text-xs text-muted-foreground">Novas aquisições entram por <Link className="font-medium text-primary underline" to="/estoque/compras">Compras</Link>. Ajustes ficam em <Link className="font-medium text-primary underline" to="/estoque/movimentacoes">Movimentações</Link>.{category === "filament" && <> Veja os rolos em <Link className="font-medium text-primary underline" to="/estoque/bobinas">Bobinas e localização</Link>.</>}</p>
      </fieldset>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Outros detalhes</summary><div className="grid gap-3 pt-3 sm:grid-cols-2">
        <div><Label htmlFor="inventory-brand">Marca</Label><Input id="inventory-brand" value={brand} onChange={e => setBrand(e.target.value)} placeholder={printingMaterial ? "Ex.: eSUN" : "Marca ou fabricante"} /></div>
        <div><Label htmlFor="inventory-sku">SKU / código interno</Label><Input id="inventory-sku" value={sku} onChange={e => setSku(e.target.value)} /></div>
        <div><Label htmlFor="inventory-min">Estoque mínimo ({unit})</Label><Input id="inventory-min" inputMode="decimal" value={minStock} onChange={e => setMinStock(e.target.value)} placeholder="0" /></div>
        {category === "filament" && <div><Label htmlFor="inventory-diameter">Diâmetro (mm)</Label><Input id="inventory-diameter" type="number" step="0.01" value={diameter} onChange={e => setDiameter(e.target.value)} /></div>}
        {printingMaterial && <><div><Label htmlFor="inventory-freight">Frete de referência (R$/kg)</Label><Input id="inventory-freight" type="number" step="0.01" value={freightCost} onChange={e => setFreightCost(e.target.value)} /></div><div><Label htmlFor="inventory-loss">Perda prevista (%)</Label><Input id="inventory-loss" type="number" min="0" max="100" step="0.01" value={lossCoefficient} onChange={e => setLossCoefficient(e.target.value)} /></div></>}
        {printingMaterial && !editItem && <label className="sm:col-span-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={formMode === "color"} onChange={e => { setFormMode(e.target.checked ? "color" : "group"); if (!e.target.checked) setParentId(""); }} />Agrupar como outra cor de um material existente</label>}
        <div className="sm:col-span-2"><Label htmlFor="inventory-notes">Observações</Label><Textarea id="inventory-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
      </div></details>
    </div>
  );
  const renderItemRow = (item: any, indent = false) => {
    const belowMin = item.min_stock != null && item.current_stock < item.min_stock;
    const owner = owners.get(item.id);
    return (
      <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50" onClick={() => owner ? navigate(`/comercial/produtos/${owner.id}`) : setDetailItem(item)}>
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
              {!owner && !item.material_identified_at && ["filament", "resin"].includes(item.category) && <p className="text-xs text-amber-700">Tipo ou cor a completar para a produção</p>}
            </div>
          </div>
        </TableCell>
        <TableCell className="text-sm">{owner ? <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{owner.is_component ? "Peça produzida" : "Produto acabado"}</span> : categoryLabels[item.category] || item.category}{!owner && item.material_type && <p className="mt-1 text-xs text-muted-foreground">{item.material_type}</p>}</TableCell>
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
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Ações de ${item.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {owner ? <DropdownMenuItem asChild><Link onClick={e => e.stopPropagation()} to={`/comercial/produtos/${owner.id}`}>Abrir cadastro de {owner.is_component ? "peça" : "produto"}</Link></DropdownMenuItem> : <>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(item); }}>
                <Edit className="h-3.5 w-3.5 mr-2" /> Editar
              </DropdownMenuItem>
              {["filament", "resin"].includes(item.category) && !item.parent_id && <DropdownMenuItem onClick={e => { e.stopPropagation(); openAddColor(item); }}><Palette className="mr-2 h-3.5 w-3.5" />Adicionar outra cor</DropdownMenuItem>}
              <DropdownMenuItem asChild><Link onClick={e => e.stopPropagation()} to={`/estoque/movimentacoes?item=${item.id}`}>Dar entrada no estoque</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); setDeleteTarget({ id: item.id, name: item.name, kind: "inventory" }); }}>Excluir item sem uso</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Arquivar ${item.name}? O histórico será preservado.`)) deleteMut.mutate(item.id); }}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Arquivar
              </DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  };

  if (loadError) return <div className="space-y-4 rounded-xl border bg-card p-6"><p role="alert" className="font-medium">Não foi possível carregar os dados.</p><p className="text-sm text-muted-foreground">{loadError.message}</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <DeleteRecordDialog key={deleteTarget?.id} target={deleteTarget} onClose={() => setDeleteTarget(null)} />
      <PageHeader
        title="Materiais e insumos"
        description="Filamentos, resinas, embalagens e componentes comprados. O estoque também identifica os produtos e peças que você fabrica."
        breadcrumbs={[{ label: "Estoque", href: "/estoque/itens" }, { label: "Materiais e insumos" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => openCreate("consumable")}>
              <Plus className="h-4 w-4 mr-1" /> Novo insumo
            </Button>
            <Button size="sm" onClick={() => openCreate("filament")}>
              <Plus className="h-4 w-4 mr-1" /> Novo filamento
            </Button>
          </div>
        }
      />

      <nav aria-label="Estoque e produção" className="flex flex-wrap gap-2 text-sm">
        <Button size="sm" variant="outline" asChild><Link to="/estoque/bobinas">Bobinas e localização</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/comercial/produtos">Produtos e composição</Link></Button>
        <Button size="sm" variant="outline" asChild><Link to="/planejamento/fila">Fila de impressão</Link></Button>
      </nav>

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
          <SelectTrigger className="w-full sm:w-[220px]" aria-label="Filtrar tipo de estoque"><SelectValue placeholder="Tipo de item" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os itens</SelectItem>
            {Object.entries(categoryLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
            <SelectItem value="outputs">Produtos e peças produzidos</SelectItem>
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
                <TableHead>Item de estoque</TableHead>
                <TableHead>Uso do item</TableHead>
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
                            {["filament", "resin"].includes(parent.category) && <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openAddColor(parent); }}>
                              <Palette className="h-3.5 w-3.5 mr-2" /> Adicionar Cor
                            </DropdownMenuItem>}
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
      <Dialog open={createOpen} onOpenChange={value => { if (!createMut.isPending) setCreateOpen(value); }}>
        <DialogContent className="flex max-w-3xl flex-col overflow-hidden" closeDisabled={createMut.isPending}>
          <DialogHeader className="shrink-0">
            <DialogTitle>{itemTitle}</DialogTitle>
            <DialogDescription>
              {formMode === "color"
                ? "Cadastre a variação com saldo próprio, ligada ao material de origem."
                : printingMaterial ? "Identifique o material usado na impressão e informe seu saldo e custo." : "Cadastre o item consumido ou comprado, com sua unidade, saldo e custo."}
            </DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter className="shrink-0 border-t pt-3">
            <Button variant="outline" disabled={createMut.isPending} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={
                (formMode === "group" && !name) ||
                (formMode === "color" && (!color || !parentId)) ||
                createMut.isPending
              }
            >
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {formMode === "color" ? "Adicionar cor" : "Criar item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o && !updateMut.isPending) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="flex max-w-3xl flex-col overflow-hidden" closeDisabled={updateMut.isPending}>
          <DialogHeader className="shrink-0">
            <DialogTitle>Editar Item</DialogTitle>
            <DialogDescription>Alterar dados do item "{editItem?.name}"</DialogDescription>
          </DialogHeader>
          {formFields}
          <DialogFooter className="shrink-0 border-t pt-3">
            <Button variant="outline" disabled={updateMut.isPending} onClick={() => { setEditItem(null); resetForm(); }}>Cancelar</Button>
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
