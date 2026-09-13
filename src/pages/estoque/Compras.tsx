import { useState, useMemo, useRef, useEffect } from "react";
import { allRows, localDate, money, positiveMoney, validDate, monthlyInstallments } from "@/lib/finance";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Loader2, Upload, FileText,
  Trash2, Eye, CheckCircle2, Package, ShoppingCart, Camera,
  Image as ImageIcon, Sparkles, AlertTriangle, ArrowRight,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PurchaseStockQuantity } from "@/components/estoque/PurchaseStockQuantity";
import { purchaseMaterialLabel, purchaseStockQuantity } from "@/lib/purchase-stock";

const fmtCurrency = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

const fmtDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "—";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "outline" },
  pending: { label: "Pendente", variant: "secondary" },
  partial: { label: "Parcial", variant: "default" },
  received: { label: "Recebida", variant: "default" },
  cancelled: { label: "Cancelada", variant: "destructive" },
};

interface NfeItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  cfop: string;
  ncm: string;
  inventoryItemId: string;
  stockQuantity?: string;
  purchaseUnit: string;
}

interface NfeData {
  nfeNumber: string;
  nfeKey: string;
  vendorName: string;
  vendorDoc: string;
  issueDate: string;
  items: NfeItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  additionalCosts: number;
  total: number;
}

export function parseNfeXml(xmlText: string): NfeData | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    if (doc.querySelector("parsererror")) return null;

    const ns = "http://www.portalfiscal.inf.br/nfe";
    const getTag = (parent: Element | Document, tag: string) =>
      parent.getElementsByTagNameNS(ns, tag)[0]?.textContent || parent.getElementsByTagName(tag)[0]?.textContent || "";

    const ide = doc.getElementsByTagNameNS(ns, "ide")[0] || doc.getElementsByTagName("ide")[0];
    const emit = doc.getElementsByTagNameNS(ns, "emit")[0] || doc.getElementsByTagName("emit")[0];
    const infNFe = doc.getElementsByTagNameNS(ns, "infNFe")[0] || doc.getElementsByTagName("infNFe")[0];
    const ICMSTot = doc.getElementsByTagNameNS(ns, "ICMSTot")[0] || doc.getElementsByTagName("ICMSTot")[0];

    const nfeNumber = ide ? getTag(ide, "nNF") : "";
    const nfeKey = infNFe?.getAttribute("Id")?.replace("NFe", "") || "";
    const issueDate = ide ? (getTag(ide, "dhEmi") || getTag(ide, "dEmi")).slice(0, 10) : "";

    const vendorName = emit ? (getTag(emit, "xFant") || getTag(emit, "xNome")) : "";
    const vendorDoc = emit ? (getTag(emit, "CNPJ") || getTag(emit, "CPF")) : "";

    const detElements = doc.getElementsByTagNameNS(ns, "det").length > 0
      ? doc.getElementsByTagNameNS(ns, "det")
      : doc.getElementsByTagName("det");

    const items: NfeItem[] = [];
    for (let i = 0; i < detElements.length; i++) {
      const det = detElements[i];
      const prod = det.getElementsByTagNameNS(ns, "prod")[0] || det.getElementsByTagName("prod")[0];
      if (!prod) continue;
      items.push({
        description: getTag(prod, "xProd"),
        quantity: parseFloat(getTag(prod, "qCom") || "0"),
        purchaseUnit: getTag(prod, "uCom").trim(),
        unitPrice: parseFloat(getTag(prod, "vUnCom") || "0"),
        total: parseFloat(getTag(prod, "vProd") || "0"),
        cfop: getTag(prod, "CFOP"),
        ncm: getTag(prod, "NCM"),
        inventoryItemId: "",
      });
    }

    const subtotal = ICMSTot ? parseFloat(getTag(ICMSTot, "vProd") || "0") : items.reduce((s, i) => s + i.total, 0);
    const discount = ICMSTot ? parseFloat(getTag(ICMSTot, "vDesc") || "0") : 0;
    const shipping = ICMSTot ? parseFloat(getTag(ICMSTot, "vFrete") || "0") : 0;
    const total = ICMSTot ? parseFloat(getTag(ICMSTot, "vNF") || "0") : subtotal - discount + shipping;

    const additionalCosts = money(total - subtotal + discount - shipping);
    return { nfeNumber, nfeKey, vendorName, vendorDoc, issueDate, items, subtotal, discount, shipping, additionalCosts, total };
  } catch {
    return null;
  }
}

export default function Compras() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<any>(null);
  const [xmlImportOpen, setXmlImportOpen] = useState(false);
  const [marketplaceImportOpen, setMarketplaceImportOpen] = useState(false);
  const [marketplaceImages, setMarketplaceImages] = useState<string[]>([]);
  const [marketplaceParsing, setMarketplaceParsing] = useState(false);
  const [marketplaceParsed, setMarketplaceParsed] = useState<any[]>([]);
  const [marketplaceSelectedIdx, setMarketplaceSelectedIdx] = useState(0);
  const [marketplacePaymentMethodId, setMarketplacePaymentMethodId] = useState("");
  const [marketplaceInstallments, setMarketplaceInstallments] = useState("1");
  const [marketplaceDueDate, setMarketplaceDueDate] = useState("");
  const marketplaceFileRef = useRef<HTMLInputElement>(null);
  const [nfeData, setNfeData] = useState<NfeData | null>(null);
  const [xmlRaw, setXmlRaw] = useState("");
  const [nfeMarkReceived, setNfeMarkReceived] = useState(false);

  // Manual create form
  const [vendorId, setVendorId] = useState("");
  const [orderDate, setOrderDate] = useState(localDate());
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [installments, setInstallments] = useState("1");
  const [dueDate, setDueDate] = useState("");
  const [manualItems, setManualItems] = useState<{ description: string; quantity: string; unitPrice: string; inventoryItemId: string; stockQuantity?: string }[]>([
    { description: "", quantity: "1", unitPrice: "0", inventoryItemId: "" },
  ]);

  // NFe form
  const [nfeInstallments, setNfeInstallments] = useState("1");
  const [nfeDueDate, setNfeDueDate] = useState("");

  // Receive confirmation dialog
  const [receiveConfirmOpen, setReceiveConfirmOpen] = useState(false);
  const [receiveOrderId, setReceiveOrderId] = useState<string | null>(null);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);

  // Helper: parse "3x de R$ 41,20" → 3
  const parseInstallmentCount = (str: string | null | undefined): number => {
    if (!str) return 1;
    const match = str.match(/^(\d+)x/i);
    return match ? parseInt(match[1], 10) : 1;
  };

  const purchaseRequests = useRef(new Map<string, { payload: string; id: string }>());
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  useEffect(() => () => marketplaceImages.forEach(url => URL.revokeObjectURL(url)), [marketplaceImages]);

  const persistPurchase = async (key: string, order: any, items: any[], count: number, firstDue: string, method: string | null) => {
    if (!profile) throw new Error("Sessão indisponível.");
    if (!validDate(order.order_date) || (order.expected_date && !validDate(order.expected_date))) throw new Error("Informe datas válidas para a compra.");
    if (!items.length || items.some(i => !i.description?.trim() || !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.unit_price) || i.unit_price < 0 || !Number.isFinite(i.total) || i.total < 0)) throw new Error("Revise os itens: descrição, quantidade positiva e preço válido são obrigatórios.");
    order.total = positiveMoney(order.total);
    order.additional_costs = money(order.additional_costs ?? 0);
    for (const field of ["subtotal", "shipping", "discount"]) { order[field] = money(order[field] ?? 0); if (order[field] < 0) throw new Error("Totais, frete e desconto não podem ser negativos."); }
    const installments = monthlyInstallments(order.total, count, firstDue).map((part, i) => ({ ...part,
      description: `Compra${order.nfe_number ? ` NFe ${order.nfe_number}` : ""}${count > 1 ? ` (${i + 1}/${count})` : ""}`,
      competence_date: order.order_date, vendor_id: order.vendor_id, payment_method_id: method,
      installment_number: i + 1, installment_total: count, notes: order.notes || null,
    }));
    const payload = JSON.stringify([order, items, installments]);
    let request = purchaseRequests.current.get(key);
    if (!request || request.payload !== payload) { request = { payload, id: crypto.randomUUID() }; purchaseRequests.current.set(key, request); }
    const { data, error } = await (supabase.rpc as any)("create_purchase_order", { p_order: order, p_items: items, p_installments: installments, p_request_id: request.id });
    if (error) throw error;
    if (typeof data !== "string") throw new Error("A criação não retornou o identificador da compra. Atualize a lista antes de repetir.");
    return data as string;
  };

  const { data: orders = [], isLoading, error: ordersError } = useQuery({
    queryKey: ["purchase_orders", profile?.tenant_id],
    queryFn: async () => {
      return allRows<any>((from, to) => supabase.from("purchase_orders").select("*, vendors(name)").order("created_at", { ascending: false }).order("id").range(from, to));
    },
    enabled: !!profile,
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: inventoryItems = [], error: inventoryError, refetch: refetchInventory } = useQuery({
    queryKey: ["inventory_items", profile?.tenant_id, "purchase-selection"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("inventory_items") as any).select("id, name, sku, unit, category, material_code, color, color_code").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: paymentMethods = [] } = useQuery({
    queryKey: ["payment_methods"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payment_methods").select("id, name, type").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: orderItems = [], refetch: refetchOrderItems } = useQuery({
    queryKey: ["purchase_order_items", detailOrder?.id],
    queryFn: async () => {
      if (!detailOrder) return [];
      const { data, error } = await supabase
        .from("purchase_order_items")
        .select("*")
        .eq("purchase_order_id", detailOrder.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!detailOrder,
  });

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== "all") list = list.filter((o: any) => o.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((o: any) =>
        o.code.toLowerCase().includes(s) ||
        o.nfe_number?.toLowerCase().includes(s) ||
        (o.vendors as any)?.name?.toLowerCase().includes(s)
      );
    }
    return list;
  }, [orders, statusFilter, search]);

  const nextCode = "Gerado ao salvar";

  const createMut = useMutation({
    mutationFn: async () => {
      const items = manualItems.map(i => ({ description: i.description.trim(), quantity: Number(i.quantity.replace(",", ".")), unit_price: Number(i.unitPrice.replace(",", ".")), total: money(Number(i.quantity.replace(",", ".")) * Number(i.unitPrice.replace(",", "."))), inventory_item_id: i.inventoryItemId || null, stock_quantity: i.inventoryItemId ? purchaseStockQuantity(i.stockQuantity || "") : null }));
      const subtotal = money(items.reduce((sum, i) => sum + i.total, 0));
      return persistPurchase("manual", { vendor_id: vendorId || null, order_date: orderDate, expected_date: expectedDate || null, subtotal, discount: 0, shipping: 0, total: subtotal, notes: notes.trim() || null }, items, Number(installments), dueDate || expectedDate || orderDate, paymentMethodId || null);
    },
    onSuccess: () => {
      purchaseRequests.current.delete("manual");
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["accounts_payable"] });
      setCreateOpen(false);
      resetForm();
      toast({ title: "Pedido de compra criado", description: "Vincule os itens ao estoque e clique em 'Receber' quando o pedido chegar." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const importXmlMut = useMutation({
    mutationFn: async () => {
      if (!profile || !nfeData) throw new Error("Sem dados para importar.");
      if (!/^\d{44}$/.test(nfeData.nfeKey)) throw new Error("A chave da NFe deve conter 44 dígitos.");
      let vid: string | null = null;
      if (nfeData.vendorDoc) {
        const { data: vendor, error: lookupError } = await supabase.from("vendors").select("id").eq("document", nfeData.vendorDoc).maybeSingle();
        if (lookupError) throw lookupError;
        if (vendor) vid = vendor.id;
        else {
          const { data, error } = await supabase.from("vendors").insert({ tenant_id: profile.tenant_id, name: nfeData.vendorName || "Fornecedor NFe", document: nfeData.vendorDoc }).select("id").single();
          if (error) throw error;
          vid = data.id;
        }
      }
      const items = nfeData.items.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unitPrice, total: i.total, cfop: i.cfop || null, ncm: i.ncm || null, inventory_item_id: i.inventoryItemId || null, stock_quantity: i.inventoryItemId ? purchaseStockQuantity(i.stockQuantity || "") : null }));
      if (nfeMarkReceived && items.some(i => i.inventory_item_id && !(i.stock_quantity > 0))) throw new Error("Informe a quantidade na unidade do estoque de cada item vinculado antes de receber.");
      const id = await persistPurchase("xml", { vendor_id: vid, order_date: nfeData.issueDate, subtotal: nfeData.subtotal, discount: nfeData.discount, shipping: nfeData.shipping, additional_costs: nfeData.additionalCosts, total: nfeData.total, nfe_number: nfeData.nfeNumber, nfe_key: nfeData.nfeKey, nfe_xml: xmlRaw }, items, Number(nfeInstallments), nfeDueDate || nfeData.issueDate, null);
      let receiveError = "";
      if (nfeMarkReceived) {
        const { error } = await (supabase.rpc as any)("receive_purchase_order", { p_order_id: id, p_received_date: localDate() });
        if (error) receiveError = error.message;
      }
      return { shouldReceive: nfeMarkReceived && !receiveError, linkedCount: items.filter(i => i.inventory_item_id).length, totalItems: items.length, receiveError };
    },
    onSuccess: (result) => {
      purchaseRequests.current.delete("xml");
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["accounts_payable"] });
      if (result?.shouldReceive) {
        qc.invalidateQueries({ queryKey: ["inventory_items"] });
        qc.invalidateQueries({ queryKey: ["inventory_movements"] });
      }
      setXmlImportOpen(false);
      setNfeData(null);
      setXmlRaw("");
      setNfeMarkReceived(false);
      const msg = result?.shouldReceive
        ? `NFe importada! ${result.linkedCount} de ${result.totalItems} itens deram entrada no estoque.`
        : "NFe importada como pendente. Vincule os itens ao estoque e clique em 'Receber' quando o pedido chegar.";
      toast({ title: result?.receiveError ? "NFe criada; recebimento pendente" : "NFe importada", description: result?.receiveError ? `A compra e as parcelas foram criadas. Abra a compra para concluir o recebimento: ${result.receiveError}` : msg, variant: result?.receiveError ? "destructive" : "default" });
    },
    onError: (e: any) => toast({ title: "Erro ao importar", description: e.message, variant: "destructive" }),
  });

  const receiveOrderMut = useMutation({
    mutationFn: async (orderId: string) => {
      if (!profile) throw new Error("Sessão indisponível.");
      const { error } = await (supabase.rpc as any)("receive_purchase_order", { p_order_id: orderId, p_received_date: localDate() });
      if (error) throw error;
      return { linked: receiveItems.filter(i => i.inventory_item_id).length, total: receiveItems.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["inventory_movements"] });
      setReceiveConfirmOpen(false);
      setReceiveOrderId(null);
      setReceiveItems([]);
      setDetailOrder(null);
      const msg = result && result.linked > 0
        ? `${result.linked} de ${result.total} itens deram entrada no estoque.`
        : "Pedido marcado como recebido. Nenhum item estava vinculado ao estoque.";
      toast({ title: "Pedido recebido!", description: msg });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.rpc as any)("cancel_purchase_order", { p_order_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["accounts_payable"] });
      setCancelOrderId(null); setDetailOrder(null);
      toast({ title: "Compra cancelada", description: "Pedido e títulos preservados no histórico." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setVendorId("");
    setOrderDate(localDate());
    setExpectedDate("");
    setNotes("");
    setPaymentMethodId("");
    setInstallments("1");
    setDueDate("");
    setManualItems([{ description: "", quantity: "1", unitPrice: "0", inventoryItemId: "" }]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setXmlRaw(text);
      const parsed = parseNfeXml(text);
      if (parsed && parsed.items.length > 0) {
        setNfeData(parsed);
      } else {
        toast({ title: "XML inválido", description: "Não foi possível extrair dados da NFe.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const addManualItem = () => setManualItems([...manualItems, { description: "", quantity: "1", unitPrice: "0", inventoryItemId: "" }]);
  const removeManualItem = (idx: number) => setManualItems(manualItems.filter((_, i) => i !== idx));
  const updateManualItem = (idx: number, field: string, value: string) => {
    const updated = [...manualItems];
    updated[idx] = { ...updated[idx], [field]: value, ...(["quantity", "inventoryItemId"].includes(field) ? { stockQuantity: "" } : {}) };
    setManualItems(updated);
  };

  const updateNfeItem = (idx: number, inventoryItemId: string) => {
    if (!nfeData) return;
    const updatedItems = [...nfeData.items];
    updatedItems[idx] = { ...updatedItems[idx], inventoryItemId, stockQuantity: "" };
    setNfeData({ ...nfeData, items: updatedItems });
  };

  const updateStockMut = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: { inventory_item_id?: string | null; stock_quantity?: number | null } }) => {
      if (values.stock_quantity != null && (!Number.isFinite(values.stock_quantity) || values.stock_quantity <= 0)) throw new Error("Informe uma quantidade de estoque maior que zero.");
      const { data, error } = await supabase.from("purchase_order_items").update(values as any).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("O item não foi atualizado. Reabra o pedido.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase_order_items", detailOrder?.id] }),
    onError: (error: any) => { toast({ title: "Vínculo não salvo", description: error.message, variant: "destructive" }); qc.invalidateQueries({ queryKey: ["purchase_order_items", detailOrder?.id] }); },
  });

  const openReceiveConfirm = async (orderId: string) => {
    const { data: items, error } = await supabase.from("purchase_order_items").select("*").eq("purchase_order_id", orderId);
    if (error) { toast({ title: "Não foi possível carregar os itens", description: error.message, variant: "destructive" }); return; }
    if (!items?.length) { toast({ title: "A compra não tem itens para receber", variant: "destructive" }); return; }
    if (items.some((i: any) => i.inventory_item_id && !(i.stock_quantity > 0))) {
      setDetailOrder(orders.find(o => o.id === orderId));
      toast({ title: "Revise a quantidade de estoque", description: "Informe a quantidade na unidade de cada material. Exemplo: 1 rolo de 1 kg corresponde a 1.000 g.", variant: "destructive" });
      return;
    }
    setReceiveOrderId(orderId); setReceiveItems(items); setReceiveConfirmOpen(true);
  };

  // ── Marketplace Screenshot Import ──
  const handleMarketplaceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const previews: string[] = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);
      previews.push(url);
    }
    setMarketplaceImages(previews);
    setMarketplaceParsing(true);
    setMarketplaceParsed([]);

    try {
      const allPurchases: any[] = [];
      for (const file of files) {
        const base64 = await fileToBase64(file);
        const { data, error } = await supabase.functions.invoke("parse-purchase-receipt", {
          body: { imageBase64: base64, mimeType: file.type },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (data?.purchases) allPurchases.push(...data.purchases);
      }
      setMarketplaceParsed(allPurchases);
      setMarketplaceSelectedIdx(0);
      if (allPurchases.length > 0) {
        const firstPurchase = allPurchases[0];
        const detectedInst = parseInstallmentCount(firstPurchase.payment_installments);
        setMarketplaceInstallments(String(detectedInst));
      }
      if (allPurchases.length === 0) {
        toast({ title: "Nenhuma compra identificada", description: "Não foi possível extrair dados da imagem.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro ao processar", description: err.message, variant: "destructive" });
    } finally {
      setMarketplaceParsing(false);
    }
    e.target.value = "";
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const marketplaceLabels: Record<string, string> = {
    mercado_livre: "Mercado Livre",
    shopee: "Shopee",
    tiktok_shop: "TikTok Shop",
    amazon: "Amazon",
    magalu: "Magazine Luiza",
    outro: "Outro",
  };

  const updateMarketplace = (field: string, value: string) => setMarketplaceParsed(list => list.map((p, index) => index === marketplaceSelectedIdx ? { ...p, [field]: ["shipping", "discount", "total"].includes(field) ? Number(value) : value } : p));
  const updateMarketplaceItem = (rowIndex: number, field: string, value: string) => setMarketplaceParsed(list => list.map((p, index) => {
    if (index !== marketplaceSelectedIdx) return p;
    const items = p.items.map((item: any, itemIndex: number) => {
      if (itemIndex !== rowIndex) return item;
      const row = { ...item, [field]: field === "description" ? value : Number(value) };
      row.total = Math.round(Number(row.quantity) * Number(row.unit_price) * 100) / 100;
      return row;
    });
    return { ...p, items };
  }));

  const importMarketplaceMut = useMutation({
    mutationFn: async (purchase: any) => {
      if (!profile || !purchase) throw new Error("Sem dados para importar.");
      let vid: string | null = null;
      if (purchase.vendor_name?.trim()) {
        const { data: vendor, error } = await supabase.from("vendors").select("id").eq("name", purchase.vendor_name.trim()).maybeSingle();
        if (error) throw error;
        if (vendor) vid = vendor.id;
        else {
          const { data, error } = await supabase.from("vendors").insert({ tenant_id: profile.tenant_id, name: purchase.vendor_name.trim() }).select("id").single();
          if (error) throw error;
          vid = data.id;
        }
      }
      const marketplace = marketplaceLabels[purchase.marketplace] || "Marketplace";
      const items = (purchase.items || []).map((i: any) => ({ description: `${i.description || ""}${i.color ? ` - ${i.color}` : ""}${i.variant ? ` (${i.variant})` : ""}`, quantity: Number(i.quantity), unit_price: Number(i.unit_price), total: money(i.total ?? Number(i.quantity) * Number(i.unit_price)), stock_quantity: null }));
      const subtotal = money(items.reduce((sum: number, i: any) => sum + i.total, 0));
      const total = money(purchase.total);
      if (Math.abs(money(subtotal + Number(purchase.shipping || 0) - Number(purchase.discount || 0)) - total) > 0.01) throw new Error("O total não confere com itens, frete e desconto. Corrija os valores extraídos antes de importar.");
      return persistPurchase("marketplace", { vendor_id: vid, order_date: purchase.order_date || localDate(), subtotal, discount: Number(purchase.discount || 0), shipping: Number(purchase.shipping || 0), total, notes: `Importado de ${marketplace}${purchase.notes ? ` | ${purchase.notes}` : ""}` }, items, Number(marketplaceInstallments || parseInstallmentCount(purchase.payment_installments)), marketplaceDueDate || purchase.order_date || localDate(), marketplacePaymentMethodId || null);
    },
    onSuccess: () => {
      purchaseRequests.current.delete("marketplace");
      qc.invalidateQueries({ queryKey: ["purchase_orders"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["accounts_payable"] });
      setMarketplaceParsed(prev => prev.filter((_, i) => i !== marketplaceSelectedIdx));
      setMarketplaceSelectedIdx(0);
      toast({ title: "Compra importada!", description: "Vincule os itens ao estoque e clique em 'Receber' quando chegar." });
      if (marketplaceParsed.length <= 1) {
        setMarketplaceImportOpen(false);
        setMarketplaceImages([]);
        setMarketplaceParsed([]);
        setMarketplacePaymentMethodId("");
        setMarketplaceInstallments("1");
        setMarketplaceDueDate("");
      }
    },
    onError: (e: any) => toast({ title: "Erro ao importar", description: e.message, variant: "destructive" }),
  });

  const totalOrders = orders.length;
  const pendingOrders = orders.filter((o: any) => ["draft", "pending", "partial"].includes(o.status)).length;
  const totalValue = orders.filter(o => o.status !== "cancelled").reduce((s: number, o: any) => s + (o.total || 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Pedidos de Compra"
        description="Gerencie compras de materiais e importe NFes"
        breadcrumbs={[{ label: "Estoque", href: "/estoque/itens" }, { label: "Compras" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { setMarketplaceImages([]); setMarketplaceParsed([]); setMarketplaceImportOpen(true); }}>
              <Camera className="h-4 w-4 mr-1" /> Screenshot Compra
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setNfeData(null); setXmlRaw(""); setNfeMarkReceived(false); setXmlImportOpen(true); }}>
              <Upload className="h-4 w-4 mr-1" /> Importar XML
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Nova Compra
            </Button>
          </div>
        }
      />
      {inventoryError && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">Não foi possível carregar os materiais para vincular ao estoque. <Button variant="outline" size="sm" onClick={() => refetchInventory()}>Tentar novamente</Button></div>}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total de Pedidos</p>
          <p className="text-2xl font-bold text-foreground">{totalOrders}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pendentes</p>
          <p className={cn("text-2xl font-bold", pendingOrders > 0 ? "text-amber-600" : "text-foreground")}>{pendingOrders}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Valor Total</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(totalValue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por código, NFe, fornecedor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(statusConfig).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {ordersError && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Não foi possível carregar as compras. Atualize a página para tentar novamente.</p>}
      {/* Table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <ShoppingCart className="h-10 w-10 mb-3 opacity-40" />
            <p className="font-medium">Nenhum pedido de compra</p>
            <p className="text-xs mt-1">Crie manualmente ou importe uma NFe XML.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>NFe</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o: any) => {
                const sc = statusConfig[o.status] || statusConfig.draft;
                return (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => setDetailOrder(o)}>
                    <TableCell className="font-mono text-sm font-medium">{o.code}</TableCell>
                    <TableCell className="text-sm">{(o.vendors as any)?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{fmtDate(o.order_date)}</TableCell>
                    <TableCell className="text-sm font-mono">{o.nfe_number || "—"}</TableCell>
                    <TableCell><Badge variant={sc.variant}>{sc.label}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(o.total)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Ações da compra ${o.code}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDetailOrder(o); }}>
                            <Eye className="h-3.5 w-3.5 mr-2" /> Ver Detalhes
                          </DropdownMenuItem>
                          {(["draft", "pending", "partial"].includes(o.status)) && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openReceiveConfirm(o.id); }}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Receber
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setCancelOrderId(o.id); }}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Cancelar compra
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

      {/* Create Manual Dialog */}
      <Dialog open={createOpen} onOpenChange={v => !createMut.isPending && setCreateOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Compra</DialogTitle>
            <DialogDescription>Código: {nextCode}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fornecedor</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data do Pedido</Label>
                <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </div>
              <div>
                <Label>Previsão de Entrega</Label>
                <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              <div>
                <Label>Forma de Pagamento</Label>
                <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map((pm: any) => <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Parcelas</Label>
                <Select value={installments} onValueChange={setInstallments}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => <SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vencimento 1ª parcela</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">Parcelas mensais no mesmo dia, ajustado ao último dia do mês</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Itens</Label>
                <Button variant="outline" size="sm" onClick={addManualItem}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
              </div>
              <div className="space-y-2">
                {manualItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_140px_80px_100px_32px] gap-2 items-end rounded-lg border p-3 sm:border-0 sm:p-0">
                    <div>
                      <Label className="text-xs">Descrição</Label>
                      <Input aria-label={`Descrição do item ${idx + 1}`} value={item.description} onChange={(e) => updateManualItem(idx, "description", e.target.value)} placeholder="Material..." />
                    </div>
                    <div>
                      <Label className="text-xs">Item de estoque</Label>
                      <Select value={item.inventoryItemId || "none"} onValueChange={(v) => updateManualItem(idx, "inventoryItemId", v === "none" ? "" : v)}>
                        <SelectTrigger aria-label={`Material de estoque do item ${idx + 1}`} className="h-11 text-xs"><SelectValue placeholder="Vincular..." /></SelectTrigger>
                        <SelectContent className="max-w-[calc(100vw-2rem)]">
                          <SelectItem value="none">— Nenhum —</SelectItem>
                          {inventoryItems.map((inv: any) => (
                            <SelectItem key={inv.id} value={inv.id} className="min-h-11 whitespace-normal break-words">{purchaseMaterialLabel(inv)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Quantidade comprada</Label>
                      <Input aria-label={`Quantidade comprada do item ${idx + 1}`} type="number" value={item.quantity} onChange={(e) => updateManualItem(idx, "quantity", e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Preço unitário</Label>
                      <Input aria-label={`Preço unitário do item ${idx + 1}`} type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateManualItem(idx, "unitPrice", e.target.value)} />
                    </div>
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => removeManualItem(idx)} disabled={manualItems.length <= 1}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    {item.inventoryItemId && <div className="col-span-full rounded-md bg-muted/30 p-3"><PurchaseStockQuantity key={item.inventoryItemId} label={item.description || `item ${idx + 1}`} value={item.stockQuantity || ""} purchasedQuantity={Number(item.quantity.replace(",", "."))} stockUnit={inventoryItems.find(inv => inv.id === item.inventoryItemId)?.unit || "un"} onChange={value => updateManualItem(idx, "stockQuantity", value)} disabled={createMut.isPending} /></div>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Total: {fmtCurrency(manualItems.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"), 0))}
              </p>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMut.mutate()} disabled={!manualItems.some((i) => i.description.trim()) || createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar Pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* XML Import Dialog */}
      <Dialog open={xmlImportOpen} onOpenChange={v => !importXmlMut.isPending && setXmlImportOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar NFe XML</DialogTitle>
            <DialogDescription>Faça upload de um arquivo XML de Nota Fiscal Eletrônica</DialogDescription>
          </DialogHeader>

          {!nfeData ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
                <FileText className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Selecione o arquivo XML da NFe</p>
              <input ref={fileInputRef} type="file" accept=".xml" className="hidden" onChange={handleFileUpload} />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Selecionar Arquivo XML
              </Button>
            </div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div className="rounded-lg border bg-muted/50 p-4 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">NFe:</span> {nfeData.nfeNumber}</div>
                <div><span className="text-muted-foreground">Data:</span> {nfeData.issueDate}</div>
                <div><span className="text-muted-foreground">Fornecedor:</span> {nfeData.vendorName}</div>
                <div><span className="text-muted-foreground">CNPJ:</span> {nfeData.vendorDoc}</div>
                <div><span className="text-muted-foreground">Subtotal:</span> {fmtCurrency(nfeData.subtotal)}</div>
                <div><span className="text-muted-foreground">Desconto:</span> {fmtCurrency(nfeData.discount)}</div>
                <div><span className="text-muted-foreground">Frete:</span> {fmtCurrency(nfeData.shipping)}</div>
                <div><span className="text-muted-foreground">Outros componentes do total da NF-e:</span> {fmtCurrency(nfeData.additionalCosts)}</div>
                <div><span className="text-muted-foreground font-semibold">Total:</span> <span className="font-semibold">{fmtCurrency(nfeData.total)}</span></div>
              </div>

              <div>
                <Label className="mb-2 block">Itens ({nfeData.items.length}) — Vincule ao estoque para dar entrada automática</Label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Vincular ao Estoque</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Valor Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nfeData.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm max-w-[160px] truncate">{item.description}</TableCell>
                        <TableCell>
                          <Select
                            value={item.inventoryItemId || "none"}
                            onValueChange={(val) => updateNfeItem(idx, val === "none" ? "" : val)}
                          >
                            <SelectTrigger aria-label={`Material de estoque de ${item.description}`} className="h-11 text-xs w-[240px] max-w-full">
                              <SelectValue placeholder="Vincular..." />
                            </SelectTrigger>
                            <SelectContent className="max-w-[calc(100vw-2rem)]">
                              <SelectItem value="none">— Não vincular —</SelectItem>
                              {inventoryItems.map((inv: any) => (
                                <SelectItem key={inv.id} value={inv.id} className="min-h-11 whitespace-normal break-words">{purchaseMaterialLabel(inv)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {item.inventoryItemId && <div className="mt-2"><PurchaseStockQuantity key={item.inventoryItemId} label={item.description} value={item.stockQuantity || ""} purchasedQuantity={item.quantity} purchaseUnit={item.purchaseUnit} stockUnit={inventoryItems.find(inv => inv.id === item.inventoryItemId)?.unit || "un"} onChange={value => setNfeData({ ...nfeData, items: nfeData.items.map((row, index) => index === idx ? { ...row, stockQuantity: value } : row) })} disabled={importXmlMut.isPending} /></div>}
                        </TableCell>
                        <TableCell className="text-right text-sm">{item.quantity} {item.purchaseUnit}</TableCell>
                        <TableCell className="text-right text-sm">{fmtCurrency(item.unitPrice)}</TableCell>
                        <TableCell className="text-right text-sm font-mono">{fmtCurrency(item.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {nfeData.items.some(i => i.inventoryItemId) && (
                  <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    {nfeData.items.filter(i => i.inventoryItemId).length} de {nfeData.items.length} itens vinculados ao estoque
                  </p>
                )}
              </div>

              {/* Mark as received toggle */}
              <div className="rounded-lg border bg-muted/30 p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Já recebi este pedido</p>
                  <p className="text-xs text-muted-foreground">
                    {nfeMarkReceived 
                      ? "Os itens vinculados darão entrada no estoque automaticamente."
                      : "O pedido será salvo como pendente. Você poderá receber depois."}
                  </p>
                </div>
                <Switch checked={nfeMarkReceived} onCheckedChange={setNfeMarkReceived} />
              </div>

              {nfeMarkReceived && !nfeData.items.some(i => i.inventoryItemId) && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700">
                    Nenhum item está vinculado ao estoque. O pedido será marcado como recebido mas <strong>nenhuma movimentação de estoque</strong> será criada. Vincule os itens acima para dar entrada automática.
                  </p>
                </div>
              )}
            </div>
          )}

          {nfeData && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-2 block">Parcelas</Label>
                <Select value={nfeInstallments} onValueChange={setNfeInstallments}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => <SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Vencimento 1ª parcela</Label>
                <Input type="date" value={nfeDueDate} onChange={(e) => setNfeDueDate(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground col-span-2">Parcelas mensais no mesmo dia, ajustado ao último dia do mês</p>
            </div>
          )}

          <DialogFooter>
            {nfeData && (
              <>
                <Button variant="outline" onClick={() => { setNfeData(null); setXmlRaw(""); }}>Trocar Arquivo</Button>
                <Button onClick={() => importXmlMut.mutate()} disabled={importXmlMut.isPending}>
                  {importXmlMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {nfeMarkReceived ? "Importar e Receber" : "Importar NFe"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailOrder} onOpenChange={(o) => { if (!o) setDetailOrder(null); }}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pedido {detailOrder?.code}</DialogTitle>
            <DialogDescription>
              {(detailOrder?.vendors as any)?.name || "Sem fornecedor"} · {fmtDate(detailOrder?.order_date)}
              {detailOrder?.nfe_number && ` · NFe ${detailOrder.nfe_number}`}
            </DialogDescription>
          </DialogHeader>
          {detailOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status:</span> <Badge variant={statusConfig[detailOrder.status]?.variant || "outline"}>{statusConfig[detailOrder.status]?.label || detailOrder.status}</Badge></div>
                <div><span className="text-muted-foreground">Previsão:</span> {fmtDate(detailOrder.expected_date)}</div>
                <div><span className="text-muted-foreground">Recebimento:</span> {fmtDate(detailOrder.received_date)}</div>
                <div><span className="text-muted-foreground">Total:</span> <span className="font-semibold">{fmtCurrency(detailOrder.total)}</span></div>
                {detailOrder.nfe_key && <div className="col-span-2"><span className="text-muted-foreground">Chave NFe:</span> <span className="font-mono text-xs break-all">{detailOrder.nfe_key}</span></div>}
                {detailOrder.notes && <div className="col-span-2"><span className="text-muted-foreground">Obs:</span> {detailOrder.notes}</div>}
              </div>

              <div>
                <Label className="mb-2 block">
                  Itens
                  {detailOrder.status !== "received" && (
                    <span className="text-xs text-muted-foreground font-normal ml-2">
                      Vincule ao estoque antes de receber
                    </span>
                  )}
                </Label>
                {orderItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum item.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Vincular ao Estoque</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Unit.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm max-w-[160px] truncate">{item.description}</TableCell>
                          <TableCell>
                            {!["received", "cancelled"].includes(detailOrder?.status) ? (
                              <Select
                                value={item.inventory_item_id || "none"}
                                disabled={updateStockMut.isPending}
                                onValueChange={val => updateStockMut.mutate({ id: item.id, values: { inventory_item_id: val === "none" ? null : val, stock_quantity: null } })}
                              >
                                <SelectTrigger aria-label={`Material de estoque de ${item.description}`} className="h-11 text-xs w-[240px] max-w-full"><SelectValue placeholder="Vincular..." /></SelectTrigger>
                                <SelectContent className="max-w-[calc(100vw-2rem)]">
                                  <SelectItem value="none">— Não vincular —</SelectItem>
                                  {inventoryItems.map((inv: any) => (
                                    <SelectItem key={inv.id} value={inv.id} className="min-h-11 whitespace-normal break-words">{purchaseMaterialLabel(inv)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {item.inventory_item_id
                                  ? <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{inventoryItems.find((inv: any) => inv.id === item.inventory_item_id) ? purchaseMaterialLabel(inventoryItems.find((inv: any) => inv.id === item.inventory_item_id)) : "Vinculado"}</span>
                                  : "— Não vinculado"}
                              </span>
                            )}
                            {item.inventory_item_id && <div className="mt-2 space-y-1">
                              {!["received", "cancelled"].includes(detailOrder?.status) ? <PurchaseStockQuantity key={`${item.id}-${item.inventory_item_id}`} label={item.description} value={String(item.stock_quantity ?? "")} purchasedQuantity={item.quantity} stockUnit={inventoryItems.find(inv => inv.id === item.inventory_item_id)?.unit || "un"} disabled={updateStockMut.isPending} onCommit={raw => { try { const value = purchaseStockQuantity(raw); if (value !== item.stock_quantity) updateStockMut.mutate({ id: item.id, values: { stock_quantity: value } }); } catch (error) { toast({ title: "Quantidade não salva", description: (error as Error).message, variant: "destructive" }); } }} /> : <p className="text-sm tabular-nums">Entrada: {item.stock_quantity ?? "Não informada"} {inventoryItems.find(inv => inv.id === item.inventory_item_id)?.unit}</p>}
                            </div>}
                          </TableCell>
                          <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                          <TableCell className="text-right text-sm">{fmtCurrency(item.unit_price)}</TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmtCurrency(item.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {detailOrder?.status !== "received" && orderItems.length > 0 && (
                  <div className="mt-2">
                    {orderItems.some((i: any) => i.inventory_item_id) ? (
                      <p className="text-xs text-emerald-600 flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {orderItems.filter((i: any) => i.inventory_item_id).length} de {orderItems.length} itens vinculados — darão entrada no estoque ao receber
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Nenhum item vinculado ao estoque. Vincule acima para dar entrada automática ao receber.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Receive button */}
              {detailOrder?.status !== "received" && detailOrder?.status !== "cancelled" && (
                <div className="flex justify-end pt-3 border-t gap-2">
                  <Button
                    variant="default"
                    size="lg"
                    onClick={() => openReceiveConfirm(detailOrder.id)}
                    disabled={receiveOrderMut.isPending || updateStockMut.isPending}
                    className="gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Receber Pedido
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {detailOrder?.status === "received" && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <p className="text-sm text-emerald-700">
                    Pedido recebido em {fmtDate(detailOrder.received_date)}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive Confirmation Dialog */}
      <Dialog open={receiveConfirmOpen} onOpenChange={v => !receiveOrderMut.isPending && setReceiveConfirmOpen(v)}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Confirmar Recebimento
            </DialogTitle>
            <DialogDescription>
              Revise os itens que darão entrada no estoque
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {receiveItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum item neste pedido.</p>
            ) : (
              <>
                {receiveItems.filter((i: any) => i.inventory_item_id).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-600 mb-2 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Itens que darão entrada no estoque:
                    </p>
                    <div className="space-y-1">
                      {receiveItems.filter((i: any) => i.inventory_item_id).map((item: any) => {
                        const inv = inventoryItems.find((inv: any) => inv.id === item.inventory_item_id);
                        return (
                          <div key={item.id} className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm">
                            <div>
                              <span className="font-medium">{item.description}</span>
                              <span className="block text-xs text-muted-foreground">→ {inv ? purchaseMaterialLabel(inv) : "Estoque"}</span>
                            </div>
                            <span className="font-mono text-emerald-600 font-semibold">+{item.stock_quantity}{inv?.unit || ""}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {receiveItems.filter((i: any) => !i.inventory_item_id).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-amber-600 mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Itens SEM vínculo (não movimentam estoque):
                    </p>
                    <div className="space-y-1">
                      {receiveItems.filter((i: any) => !i.inventory_item_id).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm">
                          <span className="text-muted-foreground">{item.description}</span>
                          <span className="text-xs text-amber-600">Sem vínculo</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReceiveConfirmOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => receiveOrderId && receiveOrderMut.mutate(receiveOrderId)}
              disabled={receiveOrderMut.isPending || updateStockMut.isPending || !receiveItems.length}
              className="gap-2"
            >
              {receiveOrderMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <CheckCircle2 className="h-4 w-4" /> Confirmar Recebimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelOrderId} onOpenChange={v => !v && !deleteMut.isPending && setCancelOrderId(null)}><DialogContent><DialogHeader><DialogTitle>Cancelar compra?</DialogTitle><DialogDescription>O pedido e as parcelas em aberto serão cancelados juntos e preservados no histórico. Compras recebidas ou com pagamentos precisam de um estorno específico.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setCancelOrderId(null)}>Voltar</Button><Button variant="destructive" disabled={deleteMut.isPending} onClick={() => cancelOrderId && deleteMut.mutate(cancelOrderId)}>Cancelar compra</Button></DialogFooter></DialogContent></Dialog>
      {/* Marketplace Screenshot Import Dialog */}
      <Dialog open={marketplaceImportOpen} onOpenChange={setMarketplaceImportOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Importar via Screenshot
            </DialogTitle>
            <DialogDescription>
              Envie screenshots de compras do Mercado Livre, Shopee, TikTok Shop e outros marketplaces
            </DialogDescription>
          </DialogHeader>

          {marketplaceParsed.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-8">
              {marketplaceParsing ? (
                <>
                  <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  </div>
                  <p className="text-sm text-muted-foreground">Analisando imagem com IA...</p>
                  <p className="text-xs text-muted-foreground">Reconhecendo itens, preços e fornecedor</p>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
                    <ImageIcon className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">Envie uma ou mais screenshots</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Suporta Mercado Livre, Shopee, TikTok Shop, Amazon, Magazine Luiza
                    </p>
                  </div>
                  <input
                    ref={marketplaceFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleMarketplaceUpload}
                  />
                  <Button onClick={() => marketplaceFileRef.current?.click()}>
                    <Camera className="h-4 w-4 mr-2" /> Selecionar Screenshots
                  </Button>
                </>
              )}

              {marketplaceImages.length > 0 && (
                <div className="flex gap-2 flex-wrap justify-center">
                  {marketplaceImages.map((src, i) => (
                    <img key={i} src={src} alt={`Screenshot ${i + 1}`} className="h-24 rounded-lg border object-cover" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {marketplaceParsed.length > 1 && (
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {marketplaceParsed.map((p, i) => (
                    <Button
                      key={i}
                      variant={marketplaceSelectedIdx === i ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setMarketplaceSelectedIdx(i); setMarketplaceInstallments(String(parseInstallmentCount(p.payment_installments))); setMarketplaceDueDate(""); setMarketplacePaymentMethodId(""); }}
                      className="text-xs whitespace-nowrap"
                    >
                      {marketplaceLabels[p.marketplace] || "Compra"} #{i + 1}
                    </Button>
                  ))}
                </div>
              )}

              {(() => {
                const p = marketplaceParsed[marketplaceSelectedIdx];
                if (!p) return null;
                return (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-muted/50 p-4 grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-muted-foreground">Marketplace:</span> <span className="font-medium">{marketplaceLabels[p.marketplace] || p.marketplace}</span></div>
                      <div><span className="text-muted-foreground">Loja:</span> <span className="font-medium">{p.vendor_name || "—"}</span></div>
                      <div><span className="text-muted-foreground">Data:</span> {p.order_date || "—"}</div>
                      <div><span className="text-muted-foreground">Status:</span> {p.status || "—"}</div>
                      {p.shipping > 0 && <div><span className="text-muted-foreground">Frete:</span> {fmtCurrency(p.shipping)}</div>}
                      {p.discount > 0 && <div><span className="text-muted-foreground">Desconto:</span> {fmtCurrency(p.discount)}</div>}
                      <div className="col-span-2"><span className="text-muted-foreground font-semibold">Total:</span> <span className="font-bold text-lg">{fmtCurrency(p.total)}</span></div>
                      {p.payment_installments && (
                        <div className="col-span-2"><span className="text-muted-foreground">Pagamento:</span> {p.payment_installments}</div>
                      )}
                      {p.payment_method && (
                        <div className="col-span-2"><span className="text-muted-foreground">Forma:</span> {
                          p.payment_method === "credit_card" ? "Cartão de Crédito" :
                          p.payment_method === "debit_card" ? "Cartão de Débito" :
                          p.payment_method === "pix" ? "PIX" :
                          p.payment_method === "boleto" ? "Boleto" : p.payment_method
                        }</div>
                      )}
                    </div>

                    <div className="rounded-xl border p-4 space-y-3">
                      <p className="text-sm font-medium">Revise os dados extraídos antes de importar</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><Label>Fornecedor</Label><Input aria-label="Fornecedor extraído" value={p.vendor_name || ""} onChange={e => updateMarketplace("vendor_name", e.target.value)} /></div><div><Label>Data da compra</Label><Input aria-label="Data extraída" type="date" value={p.order_date || ""} onChange={e => updateMarketplace("order_date", e.target.value)} /></div></div>
                      <div className="grid grid-cols-3 gap-3">{[["shipping", "Frete"], ["discount", "Desconto"], ["total", "Total da compra"]].map(([field, label]) => <div key={field}><Label>{label} (R$)</Label><Input aria-label={label} type="number" min="0" step="0.01" value={p[field] ?? 0} onChange={e => updateMarketplace(field, e.target.value)} /></div>)}</div>
                      <p className="text-xs text-muted-foreground">Corrija também quantidade e preço de cada item abaixo. O total da compra deve conferir com a soma dos itens, frete e desconto.</p>
                    </div>
                    <div>
                      <Label className="mb-2 block">Forma de Pagamento</Label>
                      <Select value={marketplacePaymentMethodId} onValueChange={setMarketplacePaymentMethodId}>
                        <SelectTrigger><SelectValue placeholder="Selecione a forma de pagamento..." /></SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map((pm: any) => <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="mb-2 block">Parcelas</Label>
                        <Select value={marketplaceInstallments || String(parseInstallmentCount(p.payment_installments))} onValueChange={setMarketplaceInstallments}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => <SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="mb-2 block">Vencimento 1ª parcela</Label>
                        <Input type="date" value={marketplaceDueDate} onChange={(e) => setMarketplaceDueDate(e.target.value)} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Será usada para gerar a(s) conta(s) a pagar. Demais parcelas: mesmo dia dos meses seguintes, ajustado ao último dia do mês.</p>

                    <div>
                      <Label className="mb-2 block">Itens ({p.items?.length || 0})</Label>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Descrição</TableHead>
                            <TableHead className="text-right">Qtd</TableHead>
                            <TableHead className="text-right">Preço</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(p.items || []).map((item: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell className="text-sm">
                                <Input aria-label={`Descrição do item ${idx + 1}`} value={item.description || ""} onChange={e => updateMarketplaceItem(idx, "description", e.target.value)} className="min-w-40" />
                                {item.color && <span className="text-xs text-muted-foreground ml-1">({item.color})</span>}
                              </TableCell>
                              <TableCell className="text-right text-sm"><Input aria-label={`Quantidade do item ${idx + 1}`} type="number" min="0.01" step="any" className="w-24" value={item.quantity ?? ""} onChange={e => updateMarketplaceItem(idx, "quantity", e.target.value)} /></TableCell>
                              <TableCell className="text-right text-sm"><Input aria-label={`Preço do item ${idx + 1}`} type="number" min="0" step="0.01" className="w-28" value={item.unit_price ?? ""} onChange={e => updateMarketplaceItem(idx, "unit_price", e.target.value)} /></TableCell>
                              <TableCell className="text-right text-sm font-mono">{fmtCurrency(item.total)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <DialogFooter>
            {marketplaceParsed.length > 0 && (
              <>
                <Button variant="outline" onClick={() => { setMarketplaceParsed([]); setMarketplaceImages([]); }}>
                  Enviar outra
                </Button>
                <Button
                  onClick={() => importMarketplaceMut.mutate(marketplaceParsed[marketplaceSelectedIdx])}
                  disabled={importMarketplaceMut.isPending}
                >
                  {importMarketplaceMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Importar Compra
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
