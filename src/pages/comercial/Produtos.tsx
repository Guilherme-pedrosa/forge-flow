import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Package, Package2, Edit, Trash2, Loader2, Image, CloudDownload, FolderOpen, History, Globe, Link, Calculator, Upload, X, Settings2,
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
import { calculateProductCost, suggestedProductPrice } from "@/lib/product-costs";
import { nonNegative, positiveInteger } from "@/lib/production";
import { allRows } from "@/lib/finance";
import { orderRequest } from "@/lib/sales-order";
import { productProductionReference } from "@/lib/product-production-reference";
import ProductPrintSources from "./ProductPrintSources";
import ProductMaterialRecipe from "./ProductMaterialRecipe";
import MakerWorldReference, { MakerWorldPrinterOption } from "./MakerWorldReference";
import { fetchMakerWorldModel, externalImportReference, legacyMakerWorldUrl, readProductExternalImport, type ProductExternalImport } from "@/lib/makerworld-import";

const fmtCurrency = (v: number | null) => v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
const fmtDuration = (s: number | null) => {
  if (!s) return "—";
  const h = (s / 3600).toFixed(1).replace(".", ",");
  return `${h}h`;
};

const categoryLabels: Record<string, string> = {
  printed_part: "Peça Impressa",
  kit: "Kit / Combo",
  service: "Serviço",
  accessory: "Acessório",
  resale: "Revenda",
  seasonal: "Sazonal / Brinde",
};

const categoryFilter: string[] = ["all", ...Object.keys(categoryLabels)];

type ExtraItem = { name: string; cost: number; costInput?: string };

export default function Produtos() {
  const [searchParams] = useSearchParams();
  const requestedProductId = searchParams.get("produto");
  const openedFromLink = useRef<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const productRequest = useRef<{ signature: string; id: string } | null>(null);
  const kitRequest = useRef<{ signature: string; id: string } | null>(null);

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [bambuImportOpen, setBambuImportOpen] = useState(false);
  const [bambuTab, setBambuTab] = useState<"projects" | "tasks" | "makerworld">("projects");
  const [makerWorldUrl, setMakerWorldUrl] = useState("");
  const [makerWorldLoading, setMakerWorldLoading] = useState(false);
  const [myCollectionsLoading, setMyCollectionsLoading] = useState(false);
  const [makerWorldModels, setMakerWorldModels] = useState<any[]>([]);
  const [makerOptionOpen, setMakerOptionOpen] = useState(false);
  const [makerModelToImport, setMakerModelToImport] = useState<any | null>(null);
  const [makerOptionIndex, setMakerOptionIndex] = useState("0");
  const [makerVariantIndex, setMakerVariantIndex] = useState("0");
  const [externalImport, setExternalImport] = useState<ProductExternalImport | null>(null);
  const makerRequest = useRef<AbortController | null>(null);
  const makerImportTarget = useRef<string | null>(null);
  useEffect(() => () => makerRequest.current?.abort(), []);
  useEffect(() => {
    if (!bambuImportOpen && !editItem && !makerOptionOpen) { makerRequest.current?.abort(); setMakerWorldLoading(false); }
  }, [bambuImportOpen, editItem, makerOptionOpen]);

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
  const [photosLoading, setPhotosLoading] = useState(false);
  const [sourceBusy, setPrintSourceBusy] = useState(false);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(false);
  const [recipeDraft, setRecipeDraft] = useState(false);
  const printSourceBusy = sourceBusy || recipeBusy;
  const hasProductionDraft = sourceDraft || recipeDraft;
  const photoLoadVersion = useRef(0);
  const [notes, setNotes] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [numColors, setNumColors] = useState("1");
  const [extras, setExtras] = useState<ExtraItem[]>([]);
  const [printsPerPlate, setPrintsPerPlate] = useState("1");
  const [kitComponents, setKitComponents] = useState<{ productId: string; qty: number }[]>([]);

  // Standalone Kit Builder dialog
  const [kitBuilderOpen, setKitBuilderOpen] = useState(false);
  const [kitName, setKitName] = useState("");
  const [kitSku, setKitSku] = useState("");
  const [kitDescription, setKitDescription] = useState("");
  const [kitMarginAdjust, setKitMarginAdjust] = useState("0"); // % de desconto/acréscimo sobre soma dos preços
  const [kitItems, setKitItems] = useState<{ productId: string; qty: number }[]>([{ productId: "", qty: 1 }]);

  // Marketplace fee config
  const [channelConfig, setChannelConfig] = useState([
    { key: "shopee", name: "Shopee", fee: 0, freeShipping: false, freeShippingExtra: 0, freeShippingType: "percent" as "percent" | "fixed", enabled: true },
    { key: "ml", name: "Mercado Livre", fee: 0, freeShipping: false, freeShippingExtra: 0, freeShippingType: "percent" as "percent" | "fixed", enabled: true },
    { key: "tiktok", name: "TikTok Shop", fee: 0, freeShipping: false, freeShippingExtra: 0, freeShippingType: "percent" as "percent" | "fixed", enabled: true },
    { key: "particular", name: "Particular", fee: 0, freeShipping: false, freeShippingExtra: 0, freeShippingType: "percent" as "percent" | "fixed", enabled: true },
  ]);
  const [showChannelConfig, setShowChannelConfig] = useState(false);

  const { data: products = [], isLoading, error: productsError, refetch: refetchProducts } = useQuery({
    queryKey: ["products", profile?.tenant_id],
    queryFn: async () => {
      const [rows, recipes] = await Promise.all([
        allRows((from, to) => supabase.from("products").select("*, inventory_items(name)").eq("tenant_id", profile!.tenant_id).order("name").order("id").range(from, to)),
        supabase.rpc("product_material_recipe_catalog"),
      ]);
      if (recipes.error) throw recipes.error;
      const summary = recipes.data as unknown as {id: string; configured: boolean; complete: boolean; cost_per_unit: number | null; plate_count: number}[];
      return rows.map(row => { const recipe = summary.find(value => value.id === row.id); return { ...row,
        cost_estimate: recipe?.configured ? recipe.cost_per_unit : row.cost_estimate,
        recipe_configured: recipe?.configured ?? false, recipe_complete: recipe?.complete ?? false, recipe_plate_count: recipe?.plate_count ?? 0,
      }; });
    },
    enabled: !!profile,
  });

  const editedRecipeProduct = products.find(product => product.id === editItem?.id);
  useEffect(() => {
    if (editedRecipeProduct?.recipe_configured) setCostEstimate(editedRecipeProduct.cost_estimate == null ? "" : String(editedRecipeProduct.cost_estimate));
  }, [editedRecipeProduct?.id, editedRecipeProduct?.recipe_configured, editedRecipeProduct?.cost_estimate]);

  const { data: materials = [], error: materialsError } = useQuery({
    queryKey: ["inventory_items", "product-costs", profile?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_items").select("id, name, avg_cost, freight_cost, loss_coefficient, unit").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: printers = [], error: printersError } = useQuery({
    queryKey: ["printers_for_cost", profile?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("printers")
        .select("id, name, power_watts, depreciation_per_hour, maintenance_cost_per_hour, acquisition_cost, useful_life_hours")
        .eq("tenant_id", profile!.tenant_id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: tenant, error: tenantError } = useQuery({
    queryKey: ["tenant", profile?.tenant_id],
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
    const settingValue = (value: unknown) => value == null ? 0 : Number(String(value).replace(",", "."));
    return {
      energy_cost_kwh: settingValue(s.energy_cost_kwh),
      labor_cost_hour: settingValue(s.labor_cost_hour),
      overhead_percent: settingValue(s.overhead_percent),
      target_margin: s.target_margin == null ? 40 : settingValue(s.target_margin),
    };
  }, [tenant]);

  // Weight, print time and finishing time are per plate. Extras are per unit.
  const costBreakdown = useMemo(() => {
    try {
      return { ...calculateProductCost({
        grams: estGrams, printHours: estTime, postMinutes, printsPerPlate,
        material: materials.find(material => material.id === materialId),
        printer: printers.find(printer => printer.id === printerId),
        settings: tenantSettings, extras,
      }), error: null as string | null };
    } catch (error) {
      return { materialCost: 0, energyCost: 0, machineCost: 0, laborCost: 0, overhead: 0,
        totalPerPiece: 0, total: 0, extrasCost: 0, totalPlate: 0, printsPerPlate: 1,
        suggestedPrice: 0, selectedPrinterName: null, hasMachineRate: false,
        error: error instanceof Error ? error.message : "Revise os parâmetros de custo." };
    }
  }, [estGrams, estTime, postMinutes, printsPerPlate, materialId, printerId, materials, printers, tenantSettings, extras]);
  const applyCalculatedCost = () => {
    if (materialsError || printersError || tenantError || !tenant) { toast({ title: "Parâmetros indisponíveis", description: "Aguarde o carregamento ou atualize a página antes de calcular.", variant: "destructive" }); return; }
    if (costBreakdown.error) { toast({ title: "Não foi possível calcular", description: costBreakdown.error, variant: "destructive" }); return; }
    setCostEstimate(costBreakdown.total.toFixed(2));
    if (!salePrice || parseFloat(salePrice) === 0) {
      setSalePrice(costBreakdown.suggestedPrice.toFixed(2));
    }
  };

  // Fetch Bambu tasks for import
  const { data: bambuTasks = [], isLoading: bambuTasksLoading } = useQuery({
    queryKey: ["bambu_tasks_for_import", profile?.tenant_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bambu_tasks")
        .select("*, bambu_devices(name)")
        .eq("tenant_id", profile!.tenant_id)
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
    queryKey: ["bambu_projects_for_import", profile?.tenant_id],
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
    const s = search.trim().toLowerCase();
    return products.filter(p => (showArchived || p.is_active) && (!s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s)));
  }, [products, search, showArchived]);

  const resetForm = () => {
    productRequest.current = null;
    setExternalImport(null);
    photoLoadVersion.current += 1;
    setPhotosLoading(false);
    setPrintSourceBusy(false); setRecipeBusy(false);
    setSourceDraft(false); setRecipeDraft(false);
    setName(""); setDescription(""); setSku(""); setCategory("printed_part"); setMaterialId("");
    setEstGrams(""); setEstTime(""); setPostMinutes(""); setCostEstimate(""); setSalePrice(""); setPhotoUrl(""); setExtraPhotos([]); setNotes(""); setPrinterId(""); setNumColors("1"); setPrintsPerPlate("1"); setExtras([]); setKitComponents([]);
  };

  const openEdit = (p: any) => {
    makerRequest.current?.abort(); setMakerWorldLoading(false);
    setExternalImport(readProductExternalImport(p.external_import));
    makerImportTarget.current = p.id;
    setPrintSourceBusy(false); setRecipeBusy(false);
    setSourceDraft(false); setRecipeDraft(false);
    setEditItem(p); setName(p.name); setDescription(p.description || ""); setSku(p.sku || "");
    setCategory(p.category); setMaterialId(p.material_id || ""); setEstGrams(p.est_grams?.toString() || "");
    setEstTime(p.est_time_minutes ? (p.est_time_minutes / 60).toFixed(2) : ""); setPostMinutes(p.post_process_minutes?.toString() || "");
    setCostEstimate(p.cost_estimate?.toString() || ""); setSalePrice(p.sale_price?.toString() || "");
    setPhotoUrl(p.photo_url || ""); setNotes(p.notes || ""); setPrinterId(""); setNumColors(String((p as any).num_colors || 1)); setPrintsPerPlate(String((p as any).prints_per_plate || 1));
    const rawExtras = Array.isArray((p as any).extras) ? (p as any).extras : [];
    // Separate kit components from regular extras
    const kitItems: { productId: string; qty: number }[] = [];
    const regularExtras: ExtraItem[] = [];
    for (const e of rawExtras) {
      if (e?._kit_product_id) {
        kitItems.push({ productId: e._kit_product_id, qty: e._kit_qty || 1 });
      } else {
        regularExtras.push({
          name: e?.name ?? "",
          cost: typeof e?.cost === "number" ? e.cost : parseFloat(String(e?.cost || 0)) || 0,
          costInput: typeof e?.cost === "number" ? e.cost.toFixed(2).replace(".", ",") : String(e?.cost || "").replace(".", ","),
        });
      }
    }
    setExtras(regularExtras);
    setKitComponents(kitItems);
    setExtraPhotos([]);
    const loadVersion = ++photoLoadVersion.current;
    // Keep the previous product's photos out of a newly opened editor.
    if (p.id) {
      setPhotosLoading(true);
      supabase.from("product_photos").select("url").eq("tenant_id", profile!.tenant_id).eq("product_id", p.id).order("sort_order").then(({ data, error }) => {
        if (loadVersion !== photoLoadVersion.current) return;
        if (error) { toast({ title: "Não foi possível carregar as fotos", description: "Feche e abra o produto novamente antes de salvar.", variant: "destructive" }); return; }
        setExtraPhotos((data || []).map(d => d.url));
        setPhotosLoading(false);
      });
    } else {
      setExtraPhotos([]);
    }
  };

  useEffect(() => {
    if (!requestedProductId || openedFromLink.current === requestedProductId) return;
    const product = products.find(product => product.id === requestedProductId);
    if (product) { openedFromLink.current = requestedProductId; openEdit(product); }
  }, [requestedProductId, products]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !profile) return;
    setUploadingPhoto(true);
    try {
      let hasMainPhoto = !!photoUrl;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) throw new Error("Envie somente imagens de até 10 MB cada.");
        const ext = file.name.split(".").pop();
        const path = `${profile.tenant_id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("product-photos").upload(path, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("product-photos").getPublicUrl(path);
        const publicUrl = urlData.publicUrl;
        if (!hasMainPhoto) {
          setPhotoUrl(publicUrl);
          hasMainPhoto = true;
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
    setEstTime(task.cost_time_seconds ? (task.cost_time_seconds / 3600).toFixed(2) : "");
    setPhotoUrl(task.cover_url || "");
    setCategory("printed_part");
    setNotes(`Importado da Bambu Lab — Task ID: ${task.bambu_task_id}\nPeso e tempo previstos pelo fatiador para a placa; consumo realizado é apurado na produção.`);
    setBambuImportOpen(false);
    setCreateOpen(true);
    toast({ title: "Dados importados", description: "Preencha custo e preço para finalizar o cadastro." });
  };

  const importFromBambuProject = (proj: any) => {
    resetForm();
    setName(proj.name || "Produto Bambu");
    setEstGrams(proj.total_weight_grams ? proj.total_weight_grams.toFixed(1) : "");
    setEstTime(proj.total_time_seconds ? (proj.total_time_seconds / 3600).toFixed(2) : "");
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

  const importFromMakerWorld = (model: any, selectedProfileIndex?: number, selectedVariantIndex = 0) => {
    const profiles = Array.isArray(model.profiles) ? model.profiles : [];
    if (selectedProfileIndex == null && profiles.length > 0) {
      setMakerModelToImport(model);
      const requested = profiles.findIndex((entry: any) => entry.instance_id === model.selected_instance_id);
      setMakerOptionIndex(String(Math.max(0, requested)));
      setMakerVariantIndex("0");
      setBambuImportOpen(false);
      setMakerOptionOpen(true);
      return;
    }
    const index = selectedProfileIndex ?? 0;
    const selected = profiles[index];
    const variant = selectedVariantIndex > 0 ? selected?.variants?.[selectedVariantIndex - 1] : selected;
    const updating = makerImportTarget.current != null && makerImportTarget.current === editItem?.id;
    if (!updating) {
      resetForm(); setName(model.title); setCategory("printed_part");
      const colors = new Set((variant?.filaments || []).map((filament: any) => filament.color).filter(Boolean));
      if (colors.size > 0 && colors.size <= 16) setNumColors(String(colors.size));
    }
    const imported = externalImportReference(model, model.source_url, index);
    imported.selected_variant_profile_id = variant?.profile_id || null;
    setExternalImport(imported);
    setDescription(model.description || (updating ? description : ""));
    const images = [...new Set([model.thumbnail, ...(model.gallery || [])].filter(Boolean))] as string[];
    if (updating) {
      if (!photoUrl && images[0]) setPhotoUrl(images[0]);
      setExtraPhotos(previous => [...new Set([...previous, ...images])].filter(url => url !== (photoUrl || images[0])));
    } else {
      setPhotoUrl(images[0] || ""); setExtraPhotos(images.slice(1));
      setNotes(`Importado do MakerWorld — ID: ${model.id}
${selected?.name ? `Perfil: ${selected.name}
` : ""}Placas, pesos, tempos e filamentos importados. Confirme o rendimento e os materiais do estoque para calcular o custo por produto.`);
    }
    setMakerOptionOpen(false); setMakerModelToImport(null); setBambuImportOpen(false);
    if (!updating) setCreateOpen(true);
    toast({ title: updating ? "Dados carregados para revisão" : "Modelo carregado", description: `${images.length} fotos e ${variant?.plate_details?.length || 0} placas nesta configuração. Salve para preparar os materiais e calcular o custo.` });
  };

  const loadMakerWorld = async (url: string, applyToEditor = false) => {
    makerRequest.current?.abort();
    const request = new AbortController(); makerRequest.current = request;
    setMakerWorldLoading(true);
    if (!applyToEditor) setMakerWorldModels([]);
    try {
      const model = await fetchMakerWorldModel(url, request.signal);
      if (request.signal.aborted) return;
      if (applyToEditor) importFromMakerWorld(model);
      else setMakerWorldModels([model]);
    } catch (error) {
      if (!request.signal.aborted) toast({ title: "Não foi possível consultar o modelo", description: (error as Error).message, variant: "destructive" });
    } finally {
      if (makerRequest.current === request) setMakerWorldLoading(false);
    }
  };
  const fetchMakerWorld = () => {
    makerImportTarget.current = null;
    return loadMakerWorld(makerWorldUrl.trim());
  };
  const selectMakerWorld = (model: any) => {
    makerImportTarget.current = null;
    if (model.schema_version === 1) importFromMakerWorld(model);
    else void loadMakerWorld(`https://makerworld.com/pt/models/${model.id}`, true);
  };
  const refreshMakerWorld = () => {
    const url = externalImport?.source_url || legacyMakerWorldUrl(notes);
    if (url) { makerImportTarget.current = editItem.id; void loadMakerWorld(url, true); }
  };

  const fetchMyCollections = async () => {
    setMyCollectionsLoading(true);
    setMakerWorldModels([]);
    try {
      const { data, error } = await supabase.functions.invoke("bambu-cloud-sync", {
        body: { action: "makerworld_my_collections" },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const models = data.models || [];
      setMakerWorldModels(models);
      if (data.collection_url) setMakerWorldUrl(data.collection_url);

      if (models.length === 0) {
        toast({ title: "Nenhum modelo encontrado", description: "Não encontrei modelos nas suas coleções públicas.", variant: "destructive" });
      } else {
        toast({ title: "Coleções carregadas", description: `${models.length} modelo(s) importável(eis).` });
      }
    } catch (e: any) {
      toast({ title: "Erro ao buscar coleções", description: e.message, variant: "destructive" });
    } finally {
      setMyCollectionsLoading(false);
    }
  };

  // Build combined extras array (regular extras + kit components stored as special entries)
  const buildExtrasPayload = () => {
    const regularExtras = extras
      .filter((e) => e.name.trim())
      .map(({ name: extraName, cost: extraCost }) => ({ name: extraName, cost: Math.round((extraCost || 0) * 100) / 100 }));
    const kitEntries = kitComponents
      .filter((kc) => kc.productId)
      .map((kc) => {
        const prod = products.find((p: any) => p.id === kc.productId);
        return {
          name: `🧩 ${prod?.name || "Produto"}${kc.qty > 1 ? ` ×${kc.qty}` : ""}`,
          cost: Math.round(((prod as any)?.cost_estimate || 0) * kc.qty * 100) / 100,
          _kit_product_id: kc.productId,
          _kit_qty: kc.qty,
        };
      });
    return [...regularExtras, ...kitEntries];
  };

  // Kit cost calculation
  const kitTotalCost = useMemo(() => {
    return kitComponents.reduce((sum, kc) => {
      const prod = products.find((p: any) => p.id === kc.productId);
      return sum + ((prod as any)?.cost_estimate || 0) * kc.qty;
    }, 0);
  }, [kitComponents, products]);

  // Standalone Kit Builder totals (sum of components × qty)
  const kitBuilderTotals = useMemo(() => {
    let totalCost = 0;
    let totalPrice = 0;
    for (const ki of kitItems) {
      const prod = products.find((p: any) => p.id === ki.productId);
      if (!prod) continue;
      totalCost += ((prod as any).cost_estimate || 0) * ki.qty;
      totalPrice += ((prod as any).sale_price || 0) * ki.qty;
    }
    const adjust = parseFloat(kitMarginAdjust) || 0;
    const adjustedPrice = totalPrice * (1 + adjust / 100);
    const margin = adjustedPrice > 0 ? ((adjustedPrice - totalCost) / adjustedPrice) * 100 : 0;
    return { totalCost, totalPrice, adjustedPrice, margin };
  }, [kitItems, products, kitMarginAdjust]);

  const resetKitBuilder = () => {
    kitRequest.current = null;
    setKitName(""); setKitSku(""); setKitDescription(""); setKitMarginAdjust("0");
    setKitItems([{ productId: "", qty: 1 }]);
  };

  const createKitMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      if (!kitName.trim()) throw new Error("Informe o nome do kit.");
      const validItems = kitItems.filter(ki => ki.productId);
      if (validItems.length === 0) throw new Error("Adicione pelo menos um produto ao kit");
      const adjustment = Number(kitMarginAdjust);
      if (!Number.isFinite(adjustment) || adjustment < -100) throw new Error("O ajuste de preço deve ser maior ou igual a -100%.");
      for (const item of validItems) {
        positiveInteger(item.qty, "Quantidade do componente", 10000);
        const product = products.find(product => product.id === item.productId && product.is_active);
        if (!product || product.cost_estimate == null || product.sale_price == null) throw new Error("Todos os componentes precisam ter custo e preço cadastrados.");
      }
      const { totalCost, adjustedPrice, margin } = kitBuilderTotals;
      const extrasPayload = validItems.map(ki => {
        const prod = products.find((p: any) => p.id === ki.productId);
        return {
          name: `🧩 ${prod?.name || "Produto"}${ki.qty > 1 ? ` ×${ki.qty}` : ""}`,
          cost: Math.round(((prod as any)?.cost_estimate || 0) * ki.qty * 100) / 100,
          _kit_product_id: ki.productId,
          _kit_qty: ki.qty,
        };
      });
      const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
      const payload = { p_product_id: null, p_product: {
        name: kitName.trim(),
        description: kitDescription || null,
        sku: kitSku || null,
        category: "kit",
        cost_estimate: Math.round(totalCost * 100) / 100,
        sale_price: Math.round(adjustedPrice * 100) / 100,
        margin_percent: margin,
        extras: extrasPayload,
      }, p_photos: [] };
      kitRequest.current = orderRequest(kitRequest.current, JSON.stringify(payload));
      const { error } = await rpc("save_product_with_photos", { ...payload, p_request_id: kitRequest.current.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setKitBuilderOpen(false);
      resetKitBuilder();
      toast({ title: "Kit criado", description: "O kit foi cadastrado como um novo produto." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });


  const saveProduct = async (productId: string | null) => {
    if (!profile) throw new Error("Sua sessão expirou. Entre novamente.");
    if (!name.trim()) throw new Error("Informe o nome do produto.");
    if (hasProductionDraft) throw new Error("Salve ou cancele a composição, fonte ou placa em edição antes de salvar o cadastro.");
    if (uploadingPhoto || photosLoading || printSourceBusy || makerWorldLoading) throw new Error("Aguarde o carregamento das fotos e fontes de impressão antes de salvar.");
    const cost = costEstimate.trim() ? nonNegative(costEstimate, "Custo estimado") : null;
    const price = salePrice.trim() ? nonNegative(salePrice, "Preço de venda") : null;
    const grams = nonNegative(estGrams, "Peso por placa");
    const selectedMaterial = materials.find(material => material.id === materialId);
    if (grams > 0 && !selectedMaterial) throw new Error("Selecione o material da receita de impressão.");
    if (grams > 0 && selectedMaterial && !["g", "kg"].includes(selectedMaterial.unit)) throw new Error("O material de impressão deve usar gramas (g) ou quilogramas (kg).");
    for (const extra of extras) {
      nonNegative(extra.cost, "Custo do item extra");
      if (extra.cost > 0 && !extra.name.trim()) throw new Error("Informe o nome de cada item extra com custo.");
    }
    for (const component of kitComponents) {
      if (!component.productId || !products.some(product => product.id === component.productId && product.is_active)) throw new Error("Revise os componentes do kit.");
      positiveInteger(component.qty, "Quantidade do componente", 10000);
    }
    const photos = [...new Set(extraPhotos.map(url => url.trim()).filter(Boolean))];
    for (const url of [photoUrl.trim(), ...photos].filter(Boolean)) {
      let valid = false;
      try { valid = ["https:", "http:"].includes(new URL(url).protocol); } catch { /* invalid address */ }
      if (!valid) throw new Error("Informe uma URL válida para as fotos do produto.");
    }
    const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
    const payload = {
      p_product_id: productId,
      p_product: {
        name: name.trim(), description: description.trim() || null, sku: sku.trim() || null, category,
        material_id: materialId || null, est_grams: grams,
        est_time_minutes: Math.round(nonNegative(estTime, "Tempo por placa") * 60),
        post_process_minutes: nonNegative(postMinutes, "Pós-processo por placa"),
        cost_estimate: cost, sale_price: price,
        margin_percent: price != null && price > 0 && cost != null ? ((price - cost) / price) * 100 : null,
        notes: notes.trim() || null, photo_url: photoUrl.trim() || null,
        num_colors: positiveInteger(numColors, "Número de cores", 16),
        prints_per_plate: positiveInteger(printsPerPlate, "Peças por placa", 10000),
        extras: buildExtrasPayload(),
        ...(externalImport ? { external_import: externalImport } : {}),
      },
      p_photos: photos,
    };
    productRequest.current = orderRequest(productRequest.current, JSON.stringify(payload));
    const { data, error } = await rpc("save_product_with_photos", { ...payload, p_request_id: productRequest.current.id });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("O salvamento não foi confirmado. Atualize a lista antes de repetir.");
    return { id: data, imported: !!externalImport };
  };
  const createMut = useMutation({
    mutationFn: () => saveProduct(null),
    onSuccess: async result => {
      setCreateOpen(false); resetForm();
      await qc.invalidateQueries({ queryKey: ["products"] });
      if (result.imported) {
        const refreshed = await refetchProducts(); const product = refreshed.data?.find(product => product.id === result.id);
        if (product) openEdit(product);
        toast({ title: "Produto e placas cadastrados", description: "Confira os materiais e o rendimento das placas para concluir a precificação." });
      } else toast({ title: "Produto criado" });
    },
    onError: (error: Error) => toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: () => saveProduct(editItem?.id ?? null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); setEditItem(null); resetForm(); toast({ title: "Produto atualizado" }); },
    onError: (error: Error) => toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });
  const editWritePending = updateMut.isPending || uploadingPhoto || printSourceBusy;
  const closeEditProduct = () => {
    if (editWritePending) return;
    setEditItem(null); resetForm();
  };
  const closeCreateProduct = () => {
    if (createMut.isPending || uploadingPhoto) return;
    setCreateOpen(false); resetForm();
  };
  const deleteMut = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase.from("products").update({ is_active: active }).eq("tenant_id", profile!.tenant_id).eq("id", id).select("id").single();
      if (error) throw error;
      if (!data) throw new Error("Produto não encontrado.");
    },
    onSuccess: (_, input) => { qc.invalidateQueries({ queryKey: ["products"] }); toast({ title: input.active ? "Produto reativado" : "Produto arquivado", description: "O histórico de pedidos e produção foi preservado." }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const allPhotos = [photoUrl, ...extraPhotos].filter(Boolean);
  const activeProducts = products.filter(product => product.is_active);
  const pricedProducts = activeProducts.filter(product => product.sale_price != null);
  const marginProducts = activeProducts.filter(product => product.sale_price != null && product.sale_price > 0 && product.cost_estimate != null);
  const catalogRevenue = marginProducts.reduce((sum, product) => sum + product.sale_price!, 0);
  const catalogCost = marginProducts.reduce((sum, product) => sum + product.cost_estimate!, 0);
  const productionReference = productProductionReference(editItem);

  const formFields = (
    <div className="grid min-w-0 grid-cols-1 gap-4 max-h-[60dvh] overflow-y-auto pr-1 [&>*]:min-w-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Label htmlFor="product-name">Nome *</Label><Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vaso Geométrico P" /></div>
        <div><Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(categoryLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>SKU</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VASO-GEO-P" /></div>
        <div className="sm:col-span-2"><Label htmlFor="product-description">Descrição</Label><Textarea id="product-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
      </div>
      {productionReference && (
        <section aria-label="Referência da produção" className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Base na produção</h3>
            <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium">{productionReference.sampleLabel}</span>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Material por peça</dt><dd className="mt-1 font-mono font-semibold">{productionReference.gramsLabel}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Tempo decorrido por peça</dt><dd className="mt-1 font-mono font-semibold">{productionReference.durationLabel}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Custo médio por peça</dt><dd className="mt-1 font-mono font-semibold">{productionReference.costLabel}</dd></div>
          </dl>
          <p className="text-xs leading-relaxed">{productionReference.materialSource}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Referência das execuções concluídas e contabilizadas. Em produtos com várias placas, soma a base por unidade de cada placa. Usa o custo de estoque registrado, energia e máquina pelo tempo decorrido, além de mão de obra, indiretos e extras confirmados na apuração. O tempo pode incluir pausas. A produção atualiza esta referência; o preço de venda continua definido no cadastro.</p>
          {productionReference.updatedLabel && <p className="text-xs text-muted-foreground">Atualizada em {productionReference.updatedLabel}</p>}
        </section>
      )}
      {editItem?.id && profile?.tenant_id && <ProductPrintSources key={editItem.id} productId={editItem.id} tenantId={profile.tenant_id} onBusyChange={setPrintSourceBusy} onDraftChange={setSourceDraft} />}
      {editItem?.id && profile?.tenant_id && category !== "kit" && (products.find(product => product.id === editItem.id)?.recipe_plate_count ?? 0) === 0 &&
        <ProductMaterialRecipe key={`recipe-${editItem.id}`} productId={editItem.id} tenantId={profile.tenant_id} onBusyChange={setRecipeBusy} onDraftChange={setRecipeDraft}
          suggestedNonMaterialCost={!costBreakdown.error ? Math.max(0, costBreakdown.total - costBreakdown.materialCost) : null} />}
      {!editItem && category !== "kit" && <p className="rounded-lg border bg-muted/30 p-3 text-sm">Salve o produto para cadastrar a composição exata de materiais, cores e arquivos. Produtos com várias placas terão uma composição por placa.</p>}
      {(materialsError || printersError || tenantError) && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">Não foi possível carregar todos os parâmetros de custo. Atualize a página antes de aplicar o cálculo.</p>}
      {(externalImport || legacyMakerWorldUrl(notes)) && <div className="space-y-3">
        {editItem && <Button type="button" variant="outline" className="min-h-11 w-full whitespace-normal" disabled={makerWorldLoading || photosLoading} onClick={refreshMakerWorld}>{makerWorldLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}Atualizar fotos e detalhes do link</Button>}
        {externalImport && <MakerWorldReference value={externalImport} />}
      </div>}
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
                aria-label={`Remover foto ${i + 1}`}
                className="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
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
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Referência geral de produção</p>
      <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">Para produtos sem placas separadas, informe peso, impressão e acabamento da placa inteira. O cálculo divide esses custos pelas peças da placa; extras são cobrados por unidade. Em produtos com várias placas, cadastre cada uma em Arquivos e links de impressão; as referências por unidade se somam para formar o produto completo.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>Material</Label>
          <Select value={materialId || "none"} onValueChange={(v) => setMaterialId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Nenhum</SelectItem>{materials.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({fmtCurrency(m.avg_cost)}/{m.unit || 'un'})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="product-grams">Peso por placa (g)</Label><Input id="product-grams" type="number" min="0" step="0.01" value={estGrams} onChange={(e) => setEstGrams(e.target.value)} placeholder="45" /></div>
        <div><Label>Impressora de referência</Label>
          <Select value={printerId || "none"} onValueChange={(v) => setPrinterId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Selecionar para calcular</SelectItem>{printers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          {!printerId && costBreakdown.selectedPrinterName && (
            <p className="mt-1 text-[11px] text-muted-foreground">Usando {costBreakdown.selectedPrinterName} como referência de custo de máquina.</p>
          )}
        </div>
        <div><Label htmlFor="product-hours">Impressão por placa (h)</Label><Input id="product-hours" type="number" min="0" step="0.1" value={estTime} onChange={(e) => setEstTime(e.target.value)} placeholder="2.5" /></div>
        <div><Label htmlFor="product-post">Acabamento por placa (min)</Label><Input id="product-post" type="number" min="0" value={postMinutes} onChange={(e) => setPostMinutes(e.target.value)} placeholder="15" /></div>
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
          <Label>Peças por placa</Label>
          <Input type="number" min="1" value={printsPerPlate} onChange={(e) => setPrintsPerPlate(e.target.value)} placeholder="1" />
          {parseInt(printsPerPlate) > 1 && (
            <p className="mt-1 text-[11px] text-muted-foreground">Custo será dividido por {printsPerPlate} peças por prato.</p>
          )}
        </div>
      </div>

      {/* Kit Components */}
      {category === "kit" && (
        <div className="space-y-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">🧩 Produtos do Kit</p>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setKitComponents([...kitComponents, { productId: "", qty: 1 }])}>
              <Plus className="h-3 w-3 mr-1" /> Adicionar Produto
            </Button>
          </div>
          {kitComponents.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Selecione os produtos que compõem este kit.</p>
          )}
          {kitComponents.map((kc, idx) => {
            const prod = products.find((p: any) => p.id === kc.productId);
            const unitCost = (prod as any)?.cost_estimate || 0;
            return (
              <div key={idx} className="grid min-w-0 grid-cols-[minmax(0,1fr)_60px_auto] gap-2 items-center sm:grid-cols-[minmax(0,1fr)_70px_90px_auto] [&>*]:min-w-0">
                <Select value={kc.productId || "none"} onValueChange={(v) => {
                  const updated = [...kitComponents];
                  updated[idx] = { ...updated[idx], productId: v === "none" ? "" : v };
                  setKitComponents(updated);
                }}>
                <SelectTrigger className="col-span-3 h-8 min-w-0 text-xs sm:col-span-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione...</SelectItem>
                    {products.filter((p: any) => p.is_active && p.category !== "kit").map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({fmtCurrency(p.cost_estimate)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number" min={1} className="h-8 text-xs text-center"
                  value={kc.qty}
                  onChange={(e) => {
                    const updated = [...kitComponents];
                    updated[idx] = { ...updated[idx], qty: Math.max(1, parseInt(e.target.value) || 1) };
                    setKitComponents(updated);
                  }}
                />
                <span className="text-xs font-mono text-muted-foreground text-right">{fmtCurrency(unitCost * kc.qty)}</span>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setKitComponents(kitComponents.filter((_, i) => i !== idx))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
          {kitComponents.length > 0 && (
            <div className="flex justify-between items-center text-xs border-t pt-2 mt-1">
              <span className="font-medium text-muted-foreground">Custo Total do Kit (componentes)</span>
              <span className="font-mono font-semibold text-foreground">{fmtCurrency(kitTotalCost)}</span>
            </div>
          )}
          {kitComponents.length > 0 && (
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs w-full" onClick={() => {
              const totalExtras = extras.reduce((s, e) => s + (e.cost || 0), 0);
              setCostEstimate((kitTotalCost + totalExtras).toFixed(2));
              if (!salePrice || parseFloat(salePrice) === 0) {
                const total = kitTotalCost + totalExtras;
                try { setSalePrice(suggestedProductPrice(total, tenantSettings.target_margin).toFixed(2)); }
                catch (error) { toast({ title: "Revise a margem desejada", description: (error as Error).message, variant: "destructive" }); return; }
              }
              toast({ title: "Custo do kit aplicado" });
            }}>
              <Calculator className="h-3 w-3 mr-1" /> Aplicar Custo do Kit
            </Button>
          )}
        </div>
      )}


      <div className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">🎁 Itens Extras / Acompanhamentos</p>
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setExtras([...extras, { name: "", cost: 0, costInput: "" }])}>
            <Plus className="h-3 w-3 mr-1" /> Adicionar Item
          </Button>
        </div>
        {extras.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nenhum item extra. Adicione chocolates, embalagens, laços, chaveiros, etc.</p>
        )}
        {extras.map((extra, idx) => (
          <div key={idx} className="grid min-w-0 grid-cols-[minmax(0,1fr)_80px_auto] gap-2 items-center sm:grid-cols-[minmax(0,1fr)_100px_auto] [&>*]:min-w-0">
            <Input
              placeholder="Ex: Chocolate, Embalagem, Laço..."
              value={extra.name}
              onChange={(e) => {
                const updated = [...extras];
                updated[idx] = { ...updated[idx], name: e.target.value };
                setExtras(updated);
              }}
              className="h-8 text-sm"
            />
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={extra.costInput ?? (extra.cost ? extra.cost.toFixed(2).replace(".", ",") : "")}
                onChange={(e) => {
                  const costInput = e.target.value.replace(/[^0-9,\.]/g, "");
                  const normalized = costInput.replace(",", ".");
                  const parsed = parseFloat(normalized);
                  const updated = [...extras];
                  updated[idx] = { ...updated[idx], costInput, cost: isNaN(parsed) ? 0 : parsed };
                  setExtras(updated);
                }}
                onBlur={() => {
                  const normalized = (extra.costInput || "").replace(",", ".");
                  const parsed = parseFloat(normalized);
                  const updated = [...extras];
                  if (isNaN(parsed)) {
                    updated[idx] = { ...updated[idx], cost: 0, costInput: "" };
                  } else {
                    const rounded = Math.round(parsed * 100) / 100;
                    updated[idx] = { ...updated[idx], cost: rounded, costInput: rounded.toFixed(2).replace(".", ",") };
                  }
                  setExtras(updated);
                }}
                className="h-8 text-sm pl-7 text-right"
              />
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setExtras(extras.filter((_, i) => i !== idx))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {extras.length > 0 && (
          <div className="flex justify-end text-xs font-medium text-muted-foreground">
            Total Extras: <span className="ml-1 font-mono text-foreground">{fmtCurrency(extras.reduce((s, e) => s + (e.cost || 0), 0))}</span>
          </div>
        )}
      </div>

      {/* Cost breakdown */}
      {(parseFloat(estGrams) > 0 || parseFloat(estTime) > 0 || extras.length > 0) && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-3 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Calculator className="h-3.5 w-3.5" /> Composição de Custo Total
            </p>
            <Button type="button" variant="outline" size="sm" className="h-9 text-xs" onClick={applyCalculatedCost} disabled={!!costBreakdown.error || products.find(product => product.id === editItem?.id)?.recipe_configured}>
              Aplicar Custo Calculado
            </Button>
          </div>
          {costBreakdown.error && <p role="alert" className="rounded-md bg-warning/10 p-3 text-xs leading-relaxed text-amber-800">{costBreakdown.error}</p>}
          {!costBreakdown.error && <>
          {costBreakdown.printsPerPlate > 1 && (
            <p className="text-[11px] text-primary font-medium">📐 Custo impressão por peça (÷ {costBreakdown.printsPerPlate} peças/prato) — Prato total: {fmtCurrency(costBreakdown.totalPlate)}</p>
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
            {costBreakdown.extrasCost > 0 && (
              <>
                <span className="text-muted-foreground border-t pt-1 mt-1">Subtotal Impressão</span>
                <span className="text-right font-mono border-t pt-1 mt-1">{fmtCurrency(costBreakdown.totalPerPiece)}</span>
                <span className="text-muted-foreground">Extras / Acompanhamentos</span>
                <span className="text-right font-mono">{fmtCurrency(costBreakdown.extrasCost)}</span>
              </>
            )}
            <span className="font-semibold text-foreground border-t pt-1 mt-1">Custo Total por Unidade</span>
            <span className="text-right font-mono font-semibold text-foreground border-t pt-1 mt-1">{fmtCurrency(costBreakdown.total)}</span>
            <span className="text-muted-foreground">Preço Sugerido ({tenantSettings.target_margin}% margem)</span>
            <span className="text-right font-mono text-primary">{fmtCurrency(costBreakdown.suggestedPrice)}</span>
          </div>
          {tenantSettings.energy_cost_kwh === 0 && tenantSettings.labor_cost_hour === 0 && (
            <p className="text-[11px] text-muted-foreground">⚠ Configure custos de energia/mão de obra em Configurações → Empresa</p>
          )}
          {!costBreakdown.hasMachineRate && parseFloat(estTime) > 0 && (
            <p className="text-[11px] text-muted-foreground">⚠ Para calcular depreciação, preencha custo de aquisição e vida útil da impressora.</p>
          )}
          </>}
        </div>
      )}

      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Precificação</p>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="product-cost">Custo unitário de referência (R$)</Label><Input id="product-cost" type="number" min="0" step="0.01" value={costEstimate} onChange={(e) => setCostEstimate(e.target.value)} placeholder="12.50" disabled={products.find(product => product.id === editItem?.id)?.recipe_configured} />{products.find(product => product.id === editItem?.id)?.recipe_configured && <p className="mt-1 text-xs text-muted-foreground">O catálogo e os novos orçamentos usam o custo médio atual dos materiais da composição, somado aos demais custos confirmados. Edite a composição para atualizar.</p>}</div>
        <div><Label htmlFor="product-price">Preço unitário (R$)</Label><Input id="product-price" type="number" min="0" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="39.90" /></div>
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
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Simulação por Canal de Venda</p>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowChannelConfig(!showChannelConfig)}>
                <Settings2 className="h-3 w-3 mr-1" /> {showChannelConfig ? "Fechar" : "Taxas"}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">Preencha as taxas do seu contrato. Os valores começam em zero e esta simulação não é salva nem representa tarifas oficiais dos canais.</p>

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
                      <div className="flex items-center gap-1.5 flex-wrap">
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
                              type="number" step="0.01" min="0"
                              className="h-7 text-xs w-16 text-right"
                              value={ch.freeShippingExtra}
                              onChange={(e) => updateChannel(idx, "freeShippingExtra", parseFloat(e.target.value) || 0)}
                            />
                            <button
                              type="button"
                              className={cn(
                                "h-7 px-1.5 rounded text-xs font-medium border transition-colors",
                                ch.freeShippingType === "percent"
                                  ? "bg-primary/10 text-primary border-primary/30"
                                  : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                              )}
                              onClick={() => updateChannel(idx, "freeShippingType", ch.freeShippingType === "percent" ? "fixed" : "percent")}
                              title="Clique para alternar entre % e R$"
                            >
                              {ch.freeShippingType === "percent" ? "%" : "R$"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {ch.key === "particular" && <span />}
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto"><div className="grid min-w-[470px] grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-1.5 text-xs items-center">
              <span className="font-medium text-muted-foreground">Canal</span>
              <span className="font-medium text-muted-foreground text-right">Taxa</span>
              <span className="font-medium text-muted-foreground text-right">Líquido</span>
              <span className="font-medium text-muted-foreground text-right">Custo</span>
              <span className="font-medium text-muted-foreground text-right">Resultado estimado</span>
              {channelConfig.filter(ch => ch.enabled).map(ch => {
                const baseFeeAmount = price * (ch.fee / 100);
                const shippingAmount = ch.freeShipping
                  ? (ch.freeShippingType === "percent" ? price * (ch.freeShippingExtra / 100) : ch.freeShippingExtra)
                  : 0;
                const totalDeduction = baseFeeAmount + shippingAmount;
                const net = price - totalDeduction;
                const profit = net - cost;
                const profitPct = price > 0 ? (profit / price) * 100 : 0;
                const totalPct = ch.fee + (ch.freeShipping && ch.freeShippingType === "percent" ? ch.freeShippingExtra : 0);
                return (
                  <div key={ch.key} className="contents">
                    <span className="font-medium">
                      {ch.name}
                      {ch.freeShipping && <span className="text-[10px] text-muted-foreground ml-1">(c/ frete grátis)</span>}
                    </span>
                    <span className="text-right font-mono">
                      {totalDeduction > 0 ? (
                        <span className="flex flex-col items-end leading-tight">
                          <span>{fmtCurrency(totalDeduction)}</span>
                          {ch.freeShipping && shippingAmount > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {ch.fee}% + {ch.freeShippingType === "percent" ? `${ch.freeShippingExtra}%` : fmtCurrency(ch.freeShippingExtra)} frete
                            </span>
                          )}
                        </span>
                      ) : "—"}
                    </span>
                    <span className="text-right font-mono">{fmtCurrency(net)}</span>
                    <span className="text-right font-mono text-muted-foreground">{fmtCurrency(cost)}</span>
                    <span className={cn("text-right font-mono font-semibold", profit > 0 ? "text-success" : "text-destructive")}>
                      {fmtCurrency(profit)} <span className="text-muted-foreground font-normal">({profitPct.toFixed(0)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div></div>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setBambuImportOpen(true)}>
              <CloudDownload className="h-4 w-4 mr-1" /> Importar da Bambu
            </Button>
            <Button size="sm" variant="outline" onClick={() => { resetKitBuilder(); setKitBuilderOpen(true); }}>
              <Package2 className="h-4 w-4 mr-1" /> Novo Kit
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Novo Produto
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Produtos Ativos</p><p className="text-2xl font-bold text-foreground">{products.filter((p: any) => p.is_active).length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Preço médio do catálogo ativo</p><p className="text-2xl font-bold text-foreground">{fmtCurrency(pricedProducts.length ? pricedProducts.reduce((sum, product) => sum + product.sale_price!, 0) / pricedProducts.length : null)}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Margem do catálogo, ponderada por preço</p><p className="text-2xl font-bold text-foreground">{catalogRevenue > 0 ? `${((catalogRevenue - catalogCost) / catalogRevenue * 100).toFixed(1)}%` : "—"}</p><p className="mt-1 text-xs text-muted-foreground">Produtos ativos com preço e custo. Não é margem das vendas.</p></div>
      </div>

      {productsError && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm">Não foi possível carregar o catálogo.<Button variant="link" onClick={() => void refetchProducts()}>Tentar novamente</Button></div>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome ou SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground"><Switch checked={showArchived} onCheckedChange={setShowArchived} />Mostrar arquivados</label>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : productsError && products.length === 0 ? null : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">{search ? "Nenhum produto encontrado" : "Nenhum produto ativo cadastrado"}</p>
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
                    <div><p className="font-medium text-sm">{p.name}{!p.is_active && <span className="ml-2 rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Arquivado</span>}</p>{p.sku && <p className="text-xs text-muted-foreground">{p.sku}</p>}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {categoryLabels[p.category] || p.category}
                    {Array.isArray((p as any).extras) && (p as any).extras.length > 0 && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">+{(p as any).extras.length} extras</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{p.inventory_items?.name || "—"}</TableCell>
                  <TableCell className="text-right text-sm">
                    <span className="font-mono">{fmtCurrency(p.cost_estimate)}</span>
                    {(() => { const reference = productProductionReference(p); return reference && (
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground" title={`${reference.sampleLabel}; ${reference.durationLabel}/peça; ${reference.costLabel}/peça. ${reference.materialSource}`}>
                        <span className="inline-flex rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">Base na produção</span>
                        <span className="mt-0.5 block">{reference.sampleLabel}</span>
                      </span>
                    ); })()}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtCurrency(p.sale_price)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{p.margin_percent != null ? `${p.margin_percent.toFixed(1)}%` : "—"}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(p); }}><Edit className="h-3.5 w-3.5 mr-2" /> Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={deleteMut.isPending} onClick={(e) => { e.stopPropagation(); deleteMut.mutate({ id: p.id, active: !p.is_active }); }}><Package className="h-3.5 w-3.5 mr-2" /> {p.is_active ? "Arquivar" : "Reativar"}</DropdownMenuItem>
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
      <Dialog open={createOpen} onOpenChange={open => { if (open) setCreateOpen(true); else closeCreateProduct(); }}>
        <DialogContent className="max-w-2xl" closeDisabled={createMut.isPending || uploadingPhoto}><DialogHeader className="pr-10"><DialogTitle>Novo Produto</DialogTitle><DialogDescription>Cadastro e custo unitário do produto ou serviço.</DialogDescription></DialogHeader>
          {formFields}
          <DialogFooter className="gap-2"><Button type="button" className="min-h-11" variant="outline" disabled={createMut.isPending || uploadingPhoto} onClick={closeCreateProduct}>Cancelar</Button><Button type="button" className="min-h-11" onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending || uploadingPhoto || photosLoading || makerWorldLoading}>{createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={open => { if (!open) closeEditProduct(); }}>
        <DialogContent className="max-w-2xl" closeDisabled={editWritePending} aria-busy={editWritePending}><DialogHeader className="pr-10"><DialogTitle>Editar Produto</DialogTitle><DialogDescription>Atualize o cadastro, a receita e a precificação.</DialogDescription></DialogHeader>
          {formFields}
          {printSourceBusy && <p role="status" className="text-xs text-muted-foreground">Salvando composição ou fonte de impressão. Aguarde a confirmação.</p>}
          {hasProductionDraft && !printSourceBusy && <p role="status" className="text-xs text-amber-800 dark:text-amber-300">Salve ou cancele a composição, fonte ou placa em edição antes de salvar o cadastro. Fechar ou cancelar o produto descarta esses rascunhos.</p>}
          <DialogFooter className="gap-2"><Button type="button" className="min-h-11" variant="outline" disabled={editWritePending} onClick={closeEditProduct}>Cancelar</Button><Button type="button" className="min-h-11" onClick={() => updateMut.mutate()} disabled={!name.trim() || editWritePending || hasProductionDraft || photosLoading || makerWorldLoading}>{updateMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} {photosLoading ? "Carregando fotos..." : "Salvar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kit Builder dialog */}
      <Dialog open={kitBuilderOpen} onOpenChange={(o) => { setKitBuilderOpen(o); if (!o) resetKitBuilder(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Package2 className="h-5 w-5 text-primary" /> Novo Kit</DialogTitle>
            <DialogDescription>Combine produtos já cadastrados em um kit. Custos e preços de venda são somados automaticamente.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2"><Label>Nome do Kit *</Label><Input value={kitName} onChange={(e) => setKitName(e.target.value)} placeholder="Ex: Kit Páscoa Premium" /></div>
              <div><Label>SKU</Label><Input value={kitSku} onChange={(e) => setKitSku(e.target.value)} placeholder="KIT-PASCOA-01" /></div>
              <div className="sm:col-span-3"><Label>Descrição</Label><Textarea value={kitDescription} onChange={(e) => setKitDescription(e.target.value)} rows={2} placeholder="O que vem no kit, observações..." /></div>
            </div>

            <div className="space-y-2">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">🧩 Produtos do Kit</p>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setKitItems([...kitItems, { productId: "", qty: 1 }])}>
                  <Plus className="h-3 w-3 mr-1" /> Adicionar Produto
                </Button>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2 space-y-2">
                <div className="grid grid-cols-[1fr_70px_110px_110px_auto] gap-2 px-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Produto</span>
                  <span className="text-center">Qtd</span>
                  <span className="text-right">Custo</span>
                  <span className="text-right">Preço</span>
                  <span></span>
                </div>
                {kitItems.map((ki, idx) => {
                  const prod = products.find((p: any) => p.id === ki.productId);
                  const unitCost = (prod as any)?.cost_estimate || 0;
                  const unitPrice = (prod as any)?.sale_price || 0;
                  return (
                    <div key={idx} className="grid grid-cols-[1fr_70px_110px_110px_auto] gap-2 items-center">
                      <Select value={ki.productId || "none"} onValueChange={(v) => {
                        const updated = [...kitItems];
                        updated[idx] = { ...updated[idx], productId: v === "none" ? "" : v };
                        setKitItems(updated);
                      }}>
                        <SelectTrigger className="h-8 text-xs bg-background"><SelectValue placeholder="Selecione um produto" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Selecione...</SelectItem>
                          {products.filter((p: any) => p.is_active && p.category !== "kit").map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number" min={1} className="h-8 text-xs text-center bg-background"
                        value={ki.qty}
                        onChange={(e) => {
                          const updated = [...kitItems];
                          updated[idx] = { ...updated[idx], qty: Math.max(1, parseInt(e.target.value) || 1) };
                          setKitItems(updated);
                        }}
                      />
                      <span className="text-xs font-mono text-muted-foreground text-right">{fmtCurrency(unitCost * ki.qty)}</span>
                      <span className="text-xs font-mono text-foreground text-right">{fmtCurrency(unitPrice * ki.qty)}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setKitItems(kitItems.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
                {kitItems.length === 0 && (
                  <p className="text-xs text-muted-foreground italic px-2 py-3 text-center">Nenhum produto adicionado.</p>
                )}
              </div>
            </div>

            <div>
              <Label>Ajuste de Preço (%)</Label>
              <Input type="number" step="0.1" value={kitMarginAdjust} onChange={(e) => setKitMarginAdjust(e.target.value)} placeholder="0" />
              <p className="text-[11px] text-muted-foreground mt-1">Use valores negativos para desconto no kit (ex: -10) ou positivos para acréscimo.</p>
            </div>

            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Custo Total (componentes)</span><span className="font-mono font-medium">{fmtCurrency(kitBuilderTotals.totalCost)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Soma dos Preços de Venda</span><span className="font-mono">{fmtCurrency(kitBuilderTotals.totalPrice)}</span></div>
              {parseFloat(kitMarginAdjust) !== 0 && (
                <div className="flex justify-between text-xs"><span className="text-muted-foreground">Preço Final do Kit ({kitMarginAdjust}%)</span><span className="font-mono font-semibold text-primary">{fmtCurrency(kitBuilderTotals.adjustedPrice)}</span></div>
              )}
              <div className="flex justify-between text-sm border-t border-primary/20 pt-1.5 mt-1.5"><span className="font-medium">Margem do Kit</span><span className="font-mono font-bold text-primary">{kitBuilderTotals.margin.toFixed(1)}%</span></div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setKitBuilderOpen(false); resetKitBuilder(); }}>Cancelar</Button>
            <Button onClick={() => createKitMut.mutate()} disabled={!kitName || kitItems.filter(k => k.productId).length === 0 || createKitMut.isPending}>
              {createKitMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar Kit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bambuImportOpen} onOpenChange={setBambuImportOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-10"><CloudDownload className="h-5 w-5 text-primary" /> Importar da Bambu Lab</DialogTitle>
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
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
                          {t.weight_grams != null && <span>{t.weight_grams}g previstos</span>}
                          {t.cost_time_seconds != null && <span>{fmtDuration(t.cost_time_seconds)} previstas</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : (
              /* MakerWorld tab */
              <div className="space-y-4">

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="https://makerworld.com/pt/models/..." aria-label="Link do modelo MakerWorld"
                      value={makerWorldUrl}
                      onChange={(e) => setMakerWorldUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && fetchMakerWorld()}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button aria-label="Buscar modelo do MakerWorld" onClick={fetchMakerWorld} disabled={makerWorldLoading || myCollectionsLoading || !makerWorldUrl.trim()}>
                      {makerWorldLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </Button>
                    <Button variant="outline" onClick={fetchMyCollections} disabled={myCollectionsLoading || makerWorldLoading}>
                      {myCollectionsLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FolderOpen className="h-4 w-4 mr-1" />} Minhas coleções
                    </Button>
                  </div>
                </div>

                {makerWorldLoading || myCollectionsLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : makerWorldModels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Globe className="h-8 w-8 mb-2 opacity-40" />
                    <p className="text-sm">Cole o link público do modelo MakerWorld</p>
                    <p className="text-xs mt-1 text-center max-w-sm">Para um projeto privado do MakerLab, publique o modelo no MakerWorld ou vincule o arquivo 3MF ao produto.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {makerWorldModels.map((m: any) => (
                      <button key={m.id} onClick={() => selectMakerWorld(m)}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors text-left">
                        {m.thumbnail ? <img src={m.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" /> :
                          <div className="w-14 h-14 rounded bg-muted flex items-center justify-center flex-shrink-0"><Image className="h-5 w-5 text-muted-foreground" /></div>}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{m.title}</p>
                          {m.description && <p className="text-xs text-muted-foreground truncate">{m.description}</p>}
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            {m.profiles?.length > 1 && <span>⚙ {m.profiles.length} opções</span>}
                            {m.plates > 0 && <span>📋 {m.plates} placas</span>}
                            {m.profiles?.[0]?.filaments?.length > 0 && <span>🎨 {m.profiles[0].filaments.length} cores</span>}
                            {m.profiles?.[0]?.weight_grams > 0 && <span>⚖ {m.profiles[0].weight_grams}g</span>}
                            {m.profiles?.[0]?.time_seconds > 0 && <span>⏱ {fmtDuration(m.profiles[0].time_seconds)}</span>}
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

      {/* MakerWorld option picker */}
      <Dialog open={makerOptionOpen} onOpenChange={(open) => {
        setMakerOptionOpen(open);
        if (!open) {
          setMakerModelToImport(null);
          setMakerOptionIndex("0");
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pr-10">
            <DialogTitle>Escolha a opção de impressão</DialogTitle>
            <DialogDescription>
              Escolha o perfil e a impressora. Todas as fotos, placas e opções ficam guardadas no cadastro; as previsões variam conforme esta escolha.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {(makerModelToImport?.profiles || []).map((p: any, idx: number) => {
              const isActive = makerOptionIndex === String(idx);
              return (
                <button
                  key={`${makerModelToImport?.id || "model"}-${idx}`}
                  type="button"
                  onClick={() => { setMakerOptionIndex(String(idx)); setMakerVariantIndex("0"); }}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-colors",
                    isActive ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                  )}
                >
                  <p className="text-sm font-medium text-foreground">{p.name || `Opção ${idx + 1}`}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    {p.plates > 0 && <span>📋 {p.plates} placas</span>}
                    {p.filaments?.length > 0 && <span>🎨 {p.filaments.length} cores</span>}
                    {p.weight_grams > 0 && <span>⚖ {p.weight_grams}g</span>}
                    {p.time_seconds > 0 && <span>⏱ {fmtDuration(p.time_seconds)}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          <MakerWorldPrinterOption profile={makerModelToImport?.profiles?.[Number(makerOptionIndex)]} value={makerVariantIndex} onChange={setMakerVariantIndex} />
          <DialogFooter className="gap-2">
            <Button className="min-h-11" variant="outline" onClick={() => {
              setMakerOptionOpen(false);
              setMakerModelToImport(null);
              setMakerOptionIndex("0");
            }}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!makerModelToImport) return;
                importFromMakerWorld(makerModelToImport, Number(makerOptionIndex), Number(makerVariantIndex));
              }}
              disabled={!makerModelToImport}
            >
              Importar esta opção
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
