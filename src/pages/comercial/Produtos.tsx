import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Package, Edit, Trash2, Loader2, Image, CloudDownload, FolderOpen, History, Globe, Link, Calculator, Upload, X, Settings2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [extraPhotos, setExtraPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [notes, setNotes] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [numColors, setNumColors] = useState("1");
  const [printsPerPlate, setPrintsPerPlate] = useState("1");

  // Marketplace fee config
  const [channelConfig, setChannelConfig] = useState([
    { key: "shopee", name: "Shopee", fee: 20, freeShipping: false, freeShippingExtra: 6, enabled: true },
    { key: "ml", name: "Mercado Livre", fee: 16, freeShipping: true, freeShippingExtra: 5, enabled: true },
    { key: "tiktok", name: "TikTok Shop", fee: 8, freeShipping: false, freeShippingExtra: 0, enabled: true },
    { key: "particular", name: "Particular", fee: 0, freeShipping: false, freeShippingExtra: 0, enabled: true },
  ]);
  const [showChannelConfig, setShowChannelConfig] = useState(false);

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
      const { data, error } = await supabase.from("inventory_items").select("id, name, avg_cost, freight_cost, loss_coefficient, unit").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: printers = [] } = useQuery({
    queryKey: ["printers_for_cost"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("printers")
        .select("id, name, power_watts, depreciation_per_hour, maintenance_cost_per_hour, acquisition_cost, useful_life_hours")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: tenant } = useQuery({
    queryKey: ["tenant"],
    queryFn: async () => {
      if (!profile) return null;
      const { data, error } = await supabase.from("tenants").select("*").eq("id", profile.tenant_id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const toNumber = (v: unknown) => {
    if (typeof v === "string") {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const tenantSettings = useMemo(() => {
    const s = (tenant?.settings as any) || {};
    return {
      energy_cost_kwh: toNumber(s.energy_cost_kwh),
      labor_cost_hour: toNumber(s.labor_cost_hour),
      overhead_percent: toNumber(s.overhead_percent),
      target_margin: toNumber(s.target_margin),
    };
  }, [tenant]);

  // Cost breakdown calculation
  const costBreakdown = useMemo(() => {
    const grams = parseFloat(estGrams) || 0;
    const printMinutes = parseInt(estTime) || 0;
    const postMin = parseInt(postMinutes) || 0;
    const printHours = printMinutes / 60;
    const laborHours = postMin / 60;

    // Material cost (avg_cost is per unit; if unit=g, cost is per gram; if unit=kg, divide by 1000)
    const selectedMaterial = materials.find((m) => m.id === materialId);
    const isKg = selectedMaterial?.unit === "kg";
    const baseCostPerGram = selectedMaterial ? (isKg ? selectedMaterial.avg_cost / 1000 : selectedMaterial.avg_cost) : 0;
    const freightPerGram = selectedMaterial?.freight_cost ? (isKg ? selectedMaterial.freight_cost / 1000 : selectedMaterial.freight_cost) : 0;
    const lossCoeff = selectedMaterial?.loss_coefficient || 0.05;
    const effectiveGrams = grams * (1 + lossCoeff);
    const materialCost = effectiveGrams * (baseCostPerGram + freightPerGram);

    // Energy + machine cost
    const selectedPrinter = printers.find((p) => p.id === printerId) ?? printers[0];
    const powerKw = (selectedPrinter?.power_watts || 200) / 1000;
    const energyCost = powerKw * printHours * tenantSettings.energy_cost_kwh;

    const persistedDepreciation = selectedPrinter?.depreciation_per_hour || 0;
    const derivedDepreciation = selectedPrinter && (selectedPrinter.acquisition_cost || 0) > 0 && (selectedPrinter.useful_life_hours || 0) > 0
      ? (selectedPrinter.acquisition_cost || 0) / (selectedPrinter.useful_life_hours || 1)
      : 0;
    const depreciationPerHour = persistedDepreciation > 0 ? persistedDepreciation : derivedDepreciation;
    const maintenancePerHour = selectedPrinter?.maintenance_cost_per_hour || 0;
    const machineCost = (depreciationPerHour + maintenancePerHour) * printHours;

    // Labor cost
    const laborCost = laborHours * tenantSettings.labor_cost_hour;

    const subtotalPlate = materialCost + energyCost + machineCost + laborCost;
    const overheadPlate = subtotalPlate * (tenantSettings.overhead_percent / 100);
    const totalPlate = subtotalPlate + overheadPlate;

    // Divide by prints per plate
    const ppp = Math.max(1, parseInt(printsPerPlate) || 1);
    const total = totalPlate / ppp;
    const overhead = overheadPlate / ppp;

    // Suggested sale price
    const margin = tenantSettings.target_margin || 40;
    const suggestedPrice = margin < 100 ? total / (1 - margin / 100) : total * 2;

    return {
      materialCost: materialCost / ppp,
      energyCost: energyCost / ppp,
      machineCost: machineCost / ppp,
      laborCost: laborCost / ppp,
      overhead,
      total,
      totalPlate,
      printsPerPlate: ppp,
      suggestedPrice,
      selectedPrinterName: selectedPrinter?.name || null,
      hasMachineRate: (depreciationPerHour + maintenancePerHour) > 0,
    };
  }, [estGrams, estTime, postMinutes, materialId, printerId, printsPerPlate, materials, printers, tenantSettings]);

  const applyCalculatedCost = () => {
    setCostEstimate(costBreakdown.total.toFixed(2));
    if (!salePrice || parseFloat(salePrice) === 0) {
      setSalePrice(costBreakdown.suggestedPrice.toFixed(2));
    }
  };

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
  const [bambuProjectsError, setBambuProjectsError] = useState("");
  const { data: bambuProjects = [], isLoading: bambuProjectsLoading } = useQuery({
    queryKey: ["bambu_projects_for_import"],
    queryFn: async () => {
      setBambuProjectsError("");
      const { data, error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "projects" },
      });
      if (error) throw error;
      if (data.error) {
        setBambuProjectsError(data.error);
        return data.projects || [];
      }
      return data.projects || [];
    },
    enabled: !!profile && bambuImportOpen && bambuTab === "projects",
    retry: false,
  });

  const filtered = useMemo(() => {
    if (!search) return products;
    const s = search.toLowerCase();
    return products.filter((p: any) => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
  }, [products, search]);

  const resetForm = () => {
    setName(""); setDescription(""); setSku(""); setCategory("printed_part"); setMaterialId("");
    setEstGrams(""); setEstTime(""); setPostMinutes(""); setCostEstimate(""); setSalePrice(""); setPhotoUrl(""); setExtraPhotos([]); setNotes(""); setPrinterId(""); setNumColors("1"); setPrintsPerPlate("1");
  };

  const openEdit = (p: any) => {
    setEditItem(p); setName(p.name); setDescription(p.description || ""); setSku(p.sku || "");
    setCategory(p.category); setMaterialId(p.material_id || ""); setEstGrams(p.est_grams?.toString() || "");
    setEstTime(p.est_time_minutes?.toString() || ""); setPostMinutes(p.post_process_minutes?.toString() || "");
    setCostEstimate(p.cost_estimate?.toString() || ""); setSalePrice(p.sale_price?.toString() || "");
    setPhotoUrl(p.photo_url || ""); setNotes(p.notes || ""); setPrinterId(""); setNumColors(String((p as any).num_colors || 1)); setPrintsPerPlate(String((p as any).prints_per_plate || 1));
    // Load extra photos
    if (p.id) {
      supabase.from("product_photos").select("url").eq("product_id", p.id).order("sort_order").then(({ data }) => {
        setExtraPhotos((data || []).map((d: any) => d.url));
      });
    } else {
      setExtraPhotos([]);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !profile) return;
    setUploadingPhoto(true);
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop();
        const path = `${profile.tenant_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("product-photos").upload(path, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("product-photos").getPublicUrl(path);
        const publicUrl = urlData.publicUrl;
        if (!photoUrl) {
          setPhotoUrl(publicUrl);
        } else {
          setExtraPhotos(prev => [...prev, publicUrl]);
        }
      }
      toast({ title: "Foto(s) adicionada(s)" });
    } catch (err: any) {
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePhoto = (url: string) => {
    if (url === photoUrl) {
      // Promote first extra photo to main, or clear
      if (extraPhotos.length > 0) {
        setPhotoUrl(extraPhotos[0]);
        setExtraPhotos(prev => prev.slice(1));
      } else {
        setPhotoUrl("");
      }
    } else {
      setExtraPhotos(prev => prev.filter(u => u !== url));
    }
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

  const importFromMakerWorld = (model: any) => {
    resetForm();
    setName(model.title || "Produto MakerWorld");
    setPhotoUrl(model.thumbnail || "");
    setCategory("printed_part");
    // Set gallery photos
    if (model.gallery?.length > 0) {
      const gallery = model.gallery.filter((u: string) => u !== model.thumbnail);
      setExtraPhotos(gallery.slice(0, 5));
    }
    // Use first profile data if available
    if (model.profiles?.length > 0) {
      const p = model.profiles[0];
      if (p.weight_grams) setEstGrams(p.weight_grams.toString());
      if (p.time_seconds) setEstTime(Math.round(p.time_seconds / 60).toString());
      const filInfo = p.filaments?.map((f: any) => `${f.type} ${f.grams}g`).join(", ") || "";
      setNotes(`Importado do MakerWorld — ID: ${model.id}${filInfo ? `\nFilamentos: ${filInfo}` : ""}`);
    } else {
      setNotes(`Importado do MakerWorld — ID: ${model.id}`);
    }
    setDescription(model.description || "");
    setBambuImportOpen(false);
    setCreateOpen(true);
    toast({ title: "Dados importados do MakerWorld" });
  };

  const fetchMakerWorld = async () => {
    if (!makerWorldUrl.trim()) return;
    setMakerWorldLoading(true);
    setMakerWorldModels([]);
    try {
      const { data, error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "makerworld", url: makerWorldUrl.trim() },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setMakerWorldModels(data.models || []);
      if ((data.models || []).length === 0) {
        toast({ title: "Nenhum modelo encontrado", description: "Verifique a URL e tente novamente.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro ao buscar", description: e.message, variant: "destructive" });
    } finally {
      setMakerWorldLoading(false);
    }
  };

  const saveExtraPhotos = async (productId: string) => {
    if (!profile || extraPhotos.length === 0) return;
    // Delete old extra photos
    await supabase.from("product_photos").delete().eq("product_id", productId);
    // Insert new ones
    const rows = extraPhotos.map((url, i) => ({
      product_id: productId, tenant_id: profile.tenant_id, url, sort_order: i,
    }));
    await supabase.from("product_photos").insert(rows);
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const cost = costEstimate ? parseFloat(costEstimate) : 0;
      const price = salePrice ? parseFloat(salePrice) : 0;
      const margin = price > 0 ? ((price - cost) / price) * 100 : null;
      const { data: inserted, error } = await supabase.from("products").insert({
        tenant_id: profile.tenant_id, name, description: description || null, sku: sku || null,
        category, material_id: materialId || null, est_grams: estGrams ? parseFloat(estGrams) : 0,
        est_time_minutes: estTime ? parseInt(estTime) : 0, post_process_minutes: postMinutes ? parseInt(postMinutes) : 0,
        cost_estimate: cost, sale_price: price, margin_percent: margin, notes: notes || null,
        photo_url: photoUrl || null, num_colors: parseInt(numColors) || 1,
        prints_per_plate: parseInt(printsPerPlate) || 1,
      } as any).select("id").single();
      if (error) throw error;
      if (inserted) await saveExtraPhotos(inserted.id);
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
        photo_url: photoUrl || null, num_colors: parseInt(numColors) || 1,
        prints_per_plate: parseInt(printsPerPlate) || 1,
      } as any).eq("id", editItem.id);
      if (error) throw error;
      await saveExtraPhotos(editItem.id);
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

  const allPhotos = [photoUrl, ...extraPhotos].filter(Boolean);

  const formFields = (
    <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-1">
      {/* Photos gallery */}
      <div>
        <Label className="mb-2 block">Fotos do Produto</Label>
        <div className="flex flex-wrap gap-2">
          {allPhotos.map((url, i) => (
            <div key={i} className="relative group">
              <img src={url} alt={`Foto ${i + 1}`} className="w-20 h-20 rounded-lg object-cover border" />
              {i === 0 && <span className="absolute bottom-0 left-0 right-0 bg-primary/80 text-primary-foreground text-[9px] text-center rounded-b-lg">Principal</span>}
              <button
                type="button"
                onClick={() => removePhoto(url)}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {/* Upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {uploadingPhoto ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            <span className="text-[10px]">{uploadingPhoto ? "..." : "Adicionar"}</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handlePhotoUpload}
        />
        {allPhotos.length === 0 && (
          <div className="mt-2">
            <Input
              placeholder="Ou cole uma URL de imagem..."
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="text-xs"
            />
          </div>
        )}
      </div>
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
            <SelectContent><SelectItem value="none">Nenhum</SelectItem>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({fmtCurrency(m.avg_cost)}/kg)</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Gramas Estimadas</Label><Input type="number" value={estGrams} onChange={(e) => setEstGrams(e.target.value)} placeholder="45" /></div>
        <div><Label>Impressora</Label>
          <Select value={printerId || "none"} onValueChange={(v) => setPrinterId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Automático</SelectItem>{printers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          {!printerId && costBreakdown.selectedPrinterName && (
            <p className="mt-1 text-[11px] text-muted-foreground">Usando {costBreakdown.selectedPrinterName} como referência de custo de máquina.</p>
          )}
        </div>
        <div><Label>Tempo Impressão (min)</Label><Input type="number" value={estTime} onChange={(e) => setEstTime(e.target.value)} placeholder="120" /></div>
        <div><Label>Pós-Processo (min)</Label><Input type="number" value={postMinutes} onChange={(e) => setPostMinutes(e.target.value)} placeholder="15" /></div>
        <div>
          <Label>Nº de Cores</Label>
          <Select value={numColors} onValueChange={setNumColors}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 cor</SelectItem>
              <SelectItem value="2">2 cores</SelectItem>
              <SelectItem value="3">3 cores</SelectItem>
              <SelectItem value="4">4 cores (AMS)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Impressões por Prato</Label>
          <Input type="number" min="1" value={printsPerPlate} onChange={(e) => setPrintsPerPlate(e.target.value)} placeholder="1" />
          {parseInt(printsPerPlate) > 1 && (
            <p className="mt-1 text-[11px] text-muted-foreground">Custo será dividido por {printsPerPlate} peças por impressão.</p>
          )}
        </div>
      </div>

      {/* Cost breakdown */}
      {(parseFloat(estGrams) > 0 || parseInt(estTime) > 0) && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Calculator className="h-3.5 w-3.5" /> Composição de Custo
            </p>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={applyCalculatedCost}>
              Aplicar Custo Calculado
            </Button>
          </div>
          {costBreakdown.printsPerPlate > 1 && (
            <p className="text-[11px] text-primary font-medium">📐 Custo por peça (÷ {costBreakdown.printsPerPlate} peças/prato) — Prato total: {fmtCurrency(costBreakdown.totalPlate)}</p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Material{costBreakdown.printsPerPlate > 1 ? " /peça" : ""}</span>
            <span className="text-right font-mono">{fmtCurrency(costBreakdown.materialCost)}</span>
            <span className="text-muted-foreground">Energia{costBreakdown.printsPerPlate > 1 ? " /peça" : ""}</span>
            <span className="text-right font-mono">{fmtCurrency(costBreakdown.energyCost)}</span>
            <span className="text-muted-foreground">Máquina{costBreakdown.printsPerPlate > 1 ? " /peça" : ""}</span>
            <span className="text-right font-mono">{fmtCurrency(costBreakdown.machineCost)}</span>
            <span className="text-muted-foreground">Mão de Obra{costBreakdown.printsPerPlate > 1 ? " /peça" : ""}</span>
            <span className="text-right font-mono">{fmtCurrency(costBreakdown.laborCost)}</span>
            <span className="text-muted-foreground">Overhead ({tenantSettings.overhead_percent}%)</span>
            <span className="text-right font-mono">{fmtCurrency(costBreakdown.overhead)}</span>
            <span className="font-semibold text-foreground border-t pt-1 mt-1">Custo por Peça</span>
            <span className="text-right font-mono font-semibold text-foreground border-t pt-1 mt-1">{fmtCurrency(costBreakdown.total)}</span>
            <span className="text-muted-foreground">Preço Sugerido ({tenantSettings.target_margin}% margem)</span>
            <span className="text-right font-mono text-primary">{fmtCurrency(costBreakdown.suggestedPrice)}</span>
          </div>
          {tenantSettings.energy_cost_kwh === 0 && tenantSettings.labor_cost_hour === 0 && (
            <p className="text-[11px] text-muted-foreground">⚠ Configure custos de energia/mão de obra em Configurações → Empresa</p>
          )}
          {!costBreakdown.hasMachineRate && parseInt(estTime) > 0 && (
            <p className="text-[11px] text-muted-foreground">⚠ Para calcular depreciação, preencha custo de aquisição e vida útil da impressora.</p>
          )}
        </div>
      )}

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Precificação</p>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Custo Estimado (R$)</Label><Input type="number" step="0.01" value={costEstimate} onChange={(e) => setCostEstimate(e.target.value)} placeholder="12.50" /></div>
        <div><Label>Preço de Venda (R$)</Label><Input type="number" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="39.90" /></div>
      </div>

      {/* Marketplace fee simulator */}
      {parseFloat(salePrice) > 0 && parseFloat(costEstimate) > 0 && (() => {
        const price = parseFloat(salePrice);
        const cost = parseFloat(costEstimate);
        const updateChannel = (idx: number, field: string, value: any) => {
          setChannelConfig(prev => prev.map((ch, i) => i === idx ? { ...ch, [field]: value } : ch));
        };
        return (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Simulação por Canal de Venda</p>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowChannelConfig(!showChannelConfig)}>
                <Settings2 className="h-3 w-3 mr-1" /> {showChannelConfig ? "Fechar" : "Taxas"}
              </Button>
            </div>

            {showChannelConfig && (
              <div className="rounded-md border bg-background p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Configurar Taxas por Canal</p>
                {channelConfig.map((ch, idx) => (
                  <div key={ch.key} className="grid grid-cols-[1fr_70px_auto_auto] gap-2 items-center text-xs">
                    <span className="font-medium">{ch.name}</span>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" step="0.1" min="0" max="100"
                        className="h-7 text-xs w-16 text-right"
                        value={ch.fee}
                        onChange={(e) => updateChannel(idx, "fee", parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-muted-foreground">%</span>
                    </div>
                    {ch.key !== "particular" && (
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={ch.freeShipping}
                          onCheckedChange={(v) => updateChannel(idx, "freeShipping", v)}
                          className="scale-75"
                        />
                        <span className="text-muted-foreground whitespace-nowrap">Frete grátis</span>
                        {ch.freeShipping && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">+</span>
                            <Input
                              type="number" step="0.1" min="0" max="100"
                              className="h-7 text-xs w-14 text-right"
                              value={ch.freeShippingExtra}
                              onChange={(e) => updateChannel(idx, "freeShippingExtra", parseFloat(e.target.value) || 0)}
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        )}
                      </div>
                    )}
                    {ch.key === "particular" && <span />}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-xs items-center">
              <span className="font-medium text-muted-foreground">Canal</span>
              <span className="font-medium text-muted-foreground text-right">Taxa</span>
              <span className="font-medium text-muted-foreground text-right">Líquido</span>
              <span className="font-medium text-muted-foreground text-right">Lucro</span>
              {channelConfig.filter(ch => ch.enabled).map(ch => {
                const totalFee = ch.fee + (ch.freeShipping ? ch.freeShippingExtra : 0);
                const feeAmount = price * (totalFee / 100);
                const net = price - feeAmount;
                const profit = net - cost;
                const profitPct = cost > 0 ? ((profit / cost) * 100) : 0;
                return (
                  <div key={ch.key} className="contents">
                    <span className="font-medium">
                      {ch.name}
                      {ch.freeShipping && <span className="text-[10px] text-muted-foreground ml-1">(c/ frete grátis)</span>}
                    </span>
                    <span className="text-right font-mono">
                      {totalFee > 0 ? `${totalFee.toFixed(0)}% = ${fmtCurrency(feeAmount)}` : "—"}
                    </span>
                    <span className="text-right font-mono">{fmtCurrency(net)}</span>
                    <span className={cn("text-right font-mono font-semibold", profit > 0 ? "text-green-600" : "text-destructive")}>
                      {fmtCurrency(profit)} <span className="text-muted-foreground font-normal">({profitPct.toFixed(0)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
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
              <History className="h-4 w-4" /> Impressões
            </button>
            <button
              onClick={() => setBambuTab("makerworld")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors",
                bambuTab === "makerworld" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Globe className="h-4 w-4" /> MakerWorld
            </button>
          </div>

          <div className="overflow-y-auto max-h-[50vh]">
            {bambuTab === "projects" ? (
              bambuProjectsLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : bambuProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FolderOpen className="h-8 w-8 mb-2 opacity-40" />
                  <p className="text-sm font-medium">{bambuProjectsError || "Nenhum projeto salvo encontrado"}</p>
                  <p className="text-xs mt-1 text-center max-w-sm">
                    {bambuProjectsError 
                      ? "Vá em Integrações → Bambu Lab e reconecte sua conta."
                      : "Conecte-se na página de Integrações → Bambu Lab"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {bambuProjects.map((p: any) => (
                    <button key={p.project_id} onClick={() => importFromBambuProject(p)}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left">
                      {p.thumbnail ? <img src={p.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" /> :
                        <div className="w-14 h-14 rounded bg-muted flex items-center justify-center flex-shrink-0"><Image className="h-5 w-5 text-muted-foreground" /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{p.name || "Sem nome"}</p>
                        {p.filaments?.length > 0 && <p className="text-xs text-muted-foreground truncate">{p.filaments.map((f: any) => f.type).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(", ")}</p>}
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                          {p.total_weight_grams > 0 && <span>{p.total_weight_grams.toFixed(1)}g</span>}
                          {p.total_time_seconds > 0 && <span>{fmtDuration(p.total_time_seconds)}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : bambuTab === "tasks" ? (
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
                    <button key={t.id} onClick={() => importFromBambuTask(t)}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left">
                      {t.cover_url ? <img src={t.cover_url} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" /> :
                        <div className="w-14 h-14 rounded bg-muted flex items-center justify-center flex-shrink-0"><Image className="h-5 w-5 text-muted-foreground" /></div>}
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
            ) : (
              /* MakerWorld tab */
              <div className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="https://makerworld.com/pt/@user/collections/models ou URL de modelo"
                      value={makerWorldUrl}
                      onChange={(e) => setMakerWorldUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && fetchMakerWorld()}
                    />
                  </div>
                  <Button onClick={fetchMakerWorld} disabled={makerWorldLoading || !makerWorldUrl.trim()}>
                    {makerWorldLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>

                {makerWorldLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : makerWorldModels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Globe className="h-8 w-8 mb-2 opacity-40" />
                    <p className="text-sm">Cole a URL de uma coleção ou modelo do MakerWorld</p>
                    <p className="text-xs mt-1 text-center max-w-sm">Ex: https://makerworld.com/pt/@usuario/collections/models</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {makerWorldModels.map((m: any) => (
                      <button key={m.id} onClick={() => importFromMakerWorld(m)}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left">
                        {m.thumbnail ? <img src={m.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" /> :
                          <div className="w-14 h-14 rounded bg-muted flex items-center justify-center flex-shrink-0"><Image className="h-5 w-5 text-muted-foreground" /></div>}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{m.title}</p>
                          {m.description && <p className="text-xs text-muted-foreground truncate">{m.description}</p>}
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                            {m.profiles?.[0]?.weight_grams > 0 && <span>{m.profiles[0].weight_grams}g</span>}
                            {m.profiles?.[0]?.time_seconds > 0 && <span>{fmtDuration(m.profiles[0].time_seconds)}</span>}
                            {m.print_count && <span>🖨 {m.print_count}</span>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
