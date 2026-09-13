import { useState, useMemo, useRef } from "react";
import { nonNegative, positiveInteger } from "@/lib/production";
import { readProductionRows } from "@/lib/production-read";
import { escapePrintHtml, orderRequest } from "@/lib/sales-order";
import { commissionPercent, unitCommission, prepareConsignmentItems } from "@/lib/consignment";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Loader2, MapPin, Package, Trash2, ArrowRightLeft,
  ArrowUpFromLine, ArrowDownToLine, RotateCcw, ShoppingCart, Eye, X, Printer, Pencil, Check, Download,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";

const fmtCurrency = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

/** Preço de venda efetivo do item consignado (custom ou do produto) */
const getItemSalePrice = (item: any) => {
  return (item as any).sale_price ?? item.products?.sale_price ?? 0;
};

const movementLabels: Record<string, { label: string; color: string; icon: typeof Plus }> = {
  placement: { label: "Colocação", color: "bg-primary/10 text-primary", icon: ArrowUpFromLine },
  sale: { label: "Venda", color: "bg-emerald-100 text-emerald-700", icon: ShoppingCart },
  replenishment: { label: "Reposição", color: "bg-amber-100 text-amber-700", icon: RotateCcw },
  return: { label: "Devolução", color: "bg-muted text-muted-foreground", icon: ArrowDownToLine },
};

export default function Consignado() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const operations = useRef<Record<string, { signature: string; id: string }>>({});

  const [search, setSearch] = useState("");
  const [createLocOpen, setCreateLocOpen] = useState(false);
  const [viewLocId, setViewLocId] = useState<string | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementType, setMovementType] = useState<string>("placement");

  // Location form
  const [locMode, setLocMode] = useState<"existing" | "new">("existing");
  const [locCustomerId, setLocCustomerId] = useState("");
  const [locName, setLocName] = useState("");
  // New customer fields
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustEmail, setNewCustEmail] = useState("");
  const [newCustDocument, setNewCustDocument] = useState("");
  const [newCustBirthday, setNewCustBirthday] = useState("");
  const [locCommissionPercent, setLocCommissionPercent] = useState("20");
  const [locCommissionInput, setLocCommissionInput] = useState("20");
  // Movement form (non-sale)
  const [movProductId, setMovProductId] = useState("");
  const [movQty, setMovQty] = useState("");
  const [movPrice, setMovPrice] = useState("");
  const [movNotes, setMovNotes] = useState("");
  // Sale items (multi-item sale)
  type SaleItem = { productId: string; qty: number; unitPrice: number };
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [saleAddProductId, setSaleAddProductId] = useState("");
  const [saleAddQty, setSaleAddQty] = useState("1");
  const [saleAddPopoverOpen, setSaleAddPopoverOpen] = useState(false);
  // Inline qty edit
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editQtyValue, setEditQtyValue] = useState("");
  const [editOriginalQty, setEditOriginalQty] = useState(0);
  const [editQtyReason, setEditQtyReason] = useState("");
  const [productPopoverOpen, setProductPopoverOpen] = useState(false);
  // Inline price edit
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState("");

  // ── Queries ──
  const { data: locations = [], isLoading, error: locationsError, refetch: refetchLocations } = useQuery({
    queryKey: ["consignment_locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consignment_locations")
        .select("*, customers(name)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers_consignment"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name, phone, address").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: allItems = [], isLoading: itemsLoading, error: itemsError } = useQuery({
    queryKey: ["consignment_items"],
    queryFn: async () => {
      return readProductionRows((from, to) => supabase
        .from("consignment_items")
        .select("*, products(name, photo_url, sale_price, cost_estimate), consignment_locations(name)")
        .order("created_at", { ascending: false }).order("id").range(from, to));
    },
    enabled: !!profile,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products_active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sale_price, cost_estimate, photo_url")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: movements = [], isLoading: movementsLoading, error: movementsError } = useQuery({
    queryKey: ["consignment_movements", viewLocId],
    queryFn: async () => {
      return readProductionRows((from, to) => supabase
        .from("consignment_movements")
        .select("*, products(name)")
        .eq("location_id", viewLocId!)
        .order("created_at", { ascending: false }).order("id").range(from, to));
    },
    enabled: !!viewLocId,
  });

  const viewLoc = locations.find((l: any) => l.id === viewLocId);
  const COMMISSION_PERCENT = commissionPercent((viewLoc as unknown as { commission_percent?: number })?.commission_percent);
  const getCommission = (price: number) => Number.isFinite(price) && price >= 0 ? unitCommission(price, COMMISSION_PERCENT) : 0;
  const viewLocItems = allItems.filter((i: any) => i.location_id === viewLocId);

  const filtered = useMemo(() => {
    if (!search) return locations;
    const s = search.toLowerCase();
    return locations.filter((l: any) => l.name.toLowerCase().includes(s) || l.address?.toLowerCase().includes(s));
  }, [locations, search]);

  // Per-location summary
  const locationSummary = useMemo(() => {
    const map: Record<string, { totalItems: number; totalValue: number }> = {};
    for (const item of allItems.filter(value => locations.some(location => location.id === value.location_id))) {
      if (!map[item.location_id]) map[item.location_id] = { totalItems: 0, totalValue: 0 };
      map[item.location_id].totalItems += item.current_qty;
      map[item.location_id].totalValue += item.current_qty * getItemSalePrice(item);
    }
    return map;
  }, [allItems, locations]);

  const totalItemsOut = Object.values(locationSummary).reduce((s, v) => s + v.totalItems, 0);
  const totalValueOut = Object.values(locationSummary).reduce((s, v) => s + v.totalValue, 0);

  const invalidateConsignment = () => ["consignment_locations", "consignment_items", "consignment_movements", "orders", "accounts_receivable", "financial_ledger", "customers", "customers_consignment", "dashboard"].forEach(key => qc.invalidateQueries({ queryKey: [key] }));
  const runOperation = async (name: string, payload: Record<string, unknown>, operation: string) => {
    const signature = JSON.stringify({ name, payload });
    const request = orderRequest(operations.current[operation] ?? null, signature);
    operations.current[operation] = request;
    const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc(name, { ...payload, p_request_id: request.id });
    if (error) throw new Error(error.message);
    delete operations.current[operation];
    return data;
  };
  // ── Mutations ──
  const resetLocForm = () => {
    delete operations.current.location;
    setLocMode("existing"); setLocCustomerId(""); setLocName("");
    setNewCustName(""); setNewCustPhone(""); setNewCustEmail(""); setNewCustDocument(""); setNewCustBirthday("");
    setLocCommissionPercent("20"); setLocCommissionInput("20");
  };

  const createLocMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      if (!locName.trim()) throw new Error("Informe o nome do ponto");

      if (locMode === "existing" && !locCustomerId) throw new Error("Selecione um cliente.");
      if (locMode === "new" && !newCustName.trim()) throw new Error("Informe o nome do cliente.");
      const percent = commissionPercent(locCommissionPercent);
      const customer = customers.find(value => value.id === locCustomerId);
      const address = customer?.address;
      const addressText = typeof address === "string" ? address : address && typeof address === "object" && !Array.isArray(address) ? [address.street, address.number, address.complement, address.neighborhood, address.city, address.state].filter(Boolean).join(", ") : null;
      return runOperation("create_consignment_location", {
        p_location: { name: locName.trim(), customer_id: locMode === "existing" ? locCustomerId : null, contact_name: customer?.name || newCustName.trim(), phone: customer?.phone || newCustPhone.trim() || null, address: addressText, commission_percent: percent },
        p_customer: locMode === "new" ? { name: newCustName.trim(), phone: newCustPhone.trim() || null, email: newCustEmail.trim() || null, document: newCustDocument.trim() || null, birthday: newCustBirthday || null } : null,
      }, "location");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consignment_locations"] });
      qc.invalidateQueries({ queryKey: ["customers_consignment"] });
      setCreateLocOpen(false);
      resetLocForm();
      toast({ title: "Ponto criado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteLocMut = useMutation({
    mutationFn: async (id: string) => {
      if (allItems.some(item => item.location_id === id && item.current_qty !== 0)) throw new Error("Recolha todo o estoque do ponto antes de arquivar.");
      const { error } = await supabase.from("consignment_locations").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consignment_locations"] });
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      if (viewLocId) setViewLocId(null);
      toast({ title: "Ponto arquivado", description: "O histórico foi preservado." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const movementMut = useMutation({
    mutationFn: async () => {
      if (!profile || !viewLocId) throw new Error("Sem contexto");

      const rawItems = movementType === "sale"
        ? saleItems.map(item => ({ product_id: item.productId, quantity: item.qty, unit_price: item.unitPrice }))
        : [{ product_id: movProductId, quantity: movQty, unit_price: viewLocItems.find(item => item.product_id === movProductId)?.sale_price ?? products.find(product => product.id === movProductId)?.sale_price ?? 0 }];
      const items = prepareConsignmentItems(rawItems, movementType, viewLocItems);
      return runOperation("post_consignment_movement", { p_location_id: viewLocId, p_type: movementType, p_items: items, p_notes: movNotes.trim() || null }, "movement");
    },
    onSuccess: () => {
      invalidateConsignment();
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      qc.invalidateQueries({ queryKey: ["consignment_movements"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["accounts_receivable"] });
      setMovementOpen(false);
      setMovProductId(""); setMovQty(""); setMovPrice(""); setMovNotes("");
      setSaleItems([]);
      toast({ title: "Movimento registrado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const returnAllMut = useMutation({
    mutationFn: async () => {
      if (!profile || !viewLocId) throw new Error("Sem contexto");
      const itemsToReturn = viewLocItems.filter((i: any) => i.current_qty > 0);
      if (itemsToReturn.length === 0) throw new Error("Nenhum item para recolher");

      return runOperation("post_consignment_movement", {
        p_location_id: viewLocId, p_type: "return", p_notes: "Recolhimento total confirmado",
        p_items: itemsToReturn.map(item => ({ product_id: item.product_id, quantity: item.current_qty, unit_price: getItemSalePrice(item) })),
      }, "return-all");
    },
    onSuccess: () => {
      invalidateConsignment();
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      qc.invalidateQueries({ queryKey: ["consignment_movements"] });
      toast({ title: "Todos os itens foram recolhidos" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const adjustQtyMut = useMutation({
    mutationFn: async ({ itemId, newQty }: { itemId: string; newQty: number }) => {
      if (!profile || !viewLocId) throw new Error("Sem contexto");
      const item = viewLocItems.find((i: any) => i.id === itemId);
      if (!item) throw new Error("Item não encontrado");
      nonNegative(newQty, "Quantidade");
      if (!Number.isInteger(newQty)) throw new Error("A quantidade deve ser inteira.");
      if (!editQtyValue.trim() || !editQtyReason.trim()) throw new Error("Informe a quantidade conferida e o motivo do ajuste.");
      if (newQty === editOriginalQty) throw new Error("A quantidade informada já é o saldo atual.");
      return runOperation("adjust_consignment_stock", { p_item_id: itemId, p_new_quantity: newQty, p_expected_quantity: editOriginalQty, p_reason: editQtyReason.trim() }, "adjustment");
    },
    onSuccess: () => {
      invalidateConsignment();
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      qc.invalidateQueries({ queryKey: ["consignment_movements"] });
      setEditingItemId(null);
      toast({ title: "Quantidade ajustada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updatePriceMut = useMutation({
    mutationFn: async ({ itemId, newPrice }: { itemId: string; newPrice: number }) => {
      if (!editPriceValue.trim()) throw new Error("Informe o preço de venda.");
      nonNegative(newPrice, "Preço de venda");
      const { error } = await supabase.from("consignment_items").update({ sale_price: newPrice } as any).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateConsignment();
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      setEditingPriceItemId(null);
      toast({ title: "Preço atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const buildConsignmentHtml = () => {
    if (!viewLoc || itemsLoading || itemsError) return "";
    const today = new Date().toLocaleDateString("pt-BR");
    const itemsWithStock = viewLocItems.filter((i: any) => i.current_qty > 0);
    const totalValue = itemsWithStock.reduce((sum: number, i: any) => {
      const price = getItemSalePrice(i);
      return sum + i.current_qty * price;
    }, 0);
    const totalCommission = itemsWithStock.reduce((sum: number, i: any) => {
      const price = getItemSalePrice(i);
      return sum + i.current_qty * getCommission(price);
    }, 0);
    const customerName = (viewLoc as any).customers?.name || viewLoc.contact_name || "—";

    const rows = itemsWithStock.map((item: any, idx: number) => {
      const price = getItemSalePrice(item);
      const commission = getCommission(price);
      return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center">${idx + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd">${escapePrintHtml(item.products?.name || "—")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center">${escapePrintHtml(item.current_qty)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">${fmtCurrency(price)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">${fmtCurrency(commission)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">${fmtCurrency(item.current_qty * price)}</td>
      </tr>
    `;}).join("");

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>Consignado - ${escapePrintHtml(viewLoc.name)}</title>
      <style>
        @media print { @page { margin: 15mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #222; font-size: 13px; max-width: 800px; margin: 0 auto; padding: 20px; }
        h2 { margin: 0 0 4px; font-size: 18px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { background: #f5f5f5; padding: 8px; text-align: left; border-bottom: 2px solid #ccc; font-size: 12px; }
        .total-row td { font-weight: bold; border-top: 2px solid #333; }
        .sig { margin-top: 60px; display: flex; justify-content: space-between; gap: 40px; }
        .sig-box { flex: 1; text-align: center; border-top: 1px solid #333; padding-top: 6px; font-size: 12px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 12px; margin-bottom: 8px; }
        .info-grid span { color: #888; }
        .summary-box { margin-top: 16px; border: 1px solid #ccc; border-radius: 6px; padding: 12px; font-size: 12px; }
        .summary-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .summary-row.total { border-top: 1px solid #333; padding-top: 6px; margin-top: 6px; font-weight: bold; }
        .print-btn { position: fixed; bottom: 20px; right: 20px; background: #333; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; cursor: pointer; z-index: 100; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
        .print-btn:hover { background: #555; }
        @media print { .print-btn { display: none !important; } }
      </style></head><body>
      <h2>Termo de Consignação</h2>
      <p class="sub">Emitido em ${today}</p>
      <div class="info-grid">
        <div><span>Ponto:</span> <strong>${escapePrintHtml(viewLoc.name)}</strong></div>
        <div><span>Cliente:</span> <strong>${escapePrintHtml(customerName)}</strong></div>
        <div><span>Contato:</span> ${escapePrintHtml(viewLoc.contact_name || "—")}</div>
        <div><span>Telefone:</span> ${escapePrintHtml(viewLoc.phone || "—")}</div>
        <div><span>Endereço:</span> ${escapePrintHtml(viewLoc.address || "—")}</div>
      </div>
      <table>
        <thead><tr>
          <th style="text-align:center;width:40px">#</th>
          <th>Produto</th>
          <th style="text-align:center">Qtd</th>
          <th style="text-align:right">Preço Unit.</th>
          <th style="text-align:right">Comissão (${COMMISSION_PERCENT}%)</th>
          <th style="text-align:right">Total</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="5" style="padding:8px;text-align:right">TOTAL</td>
            <td style="padding:8px;text-align:right">${fmtCurrency(totalValue)}</td>
          </tr>
        </tbody>
      </table>
      <div class="summary-box">
        <div class="summary-row"><span>Valor Total em Produtos</span><span>${fmtCurrency(totalValue)}</span></div>
        <div class="summary-row" style="color:#b91c1c"><span>Comissão do PDV (${COMMISSION_PERCENT}%)</span><span>− ${fmtCurrency(totalCommission)}</span></div>
        <div class="summary-row total"><span>Valor a Repassar</span><span>${fmtCurrency(totalValue - totalCommission)}</span></div>
      </div>
      <p style="font-size:11px;color:#666;margin-top:16px">
        Declaro ter recebido os produtos acima em regime de consignação, comprometendo-me a devolver os itens não vendidos ou efetuar o pagamento dos itens vendidos conforme acordado.
      </p>
      <div class="sig">
        <div class="sig-box">Responsável pela Empresa</div>
        <div class="sig-box">${escapePrintHtml(customerName)}<br/><span style="font-size:10px;color:#888">Consignatário(a)</span></div>
      </div>
      <p class="print-btn">Use a opção Imprimir do navegador para salvar em PDF.</p>
    </body></html>`;
  };

  const downloadConsignment = () => {
    const html = buildConsignmentHtml();
    if (!html) return;
    const popup = window.open("", "_blank");
    if (!popup) { toast({ title: "Permita a janela de impressão", description: "O navegador bloqueou a abertura do documento." }); return; }
    popup.opener = null;
    popup.document.write(html); popup.document.close();
    popup.focus(); popup.print();
  };

  const openMovement = (type: string) => {
    if (itemsLoading || itemsError || movementMut.isPending || returnAllMut.isPending) return;
    delete operations.current.movement;
    setMovementType(type);
    setMovProductId("");
    setMovQty("");
    setMovPrice("");
    setMovNotes("");
    setSaleItems([]);
    setSaleAddProductId("");
    setSaleAddQty("1");
    setMovementOpen(true);
  };

  // Sale helpers
  const addSaleItem = () => {
    if (!saleAddProductId) return;
    let qty: number;
    try { qty = positiveInteger(saleAddQty, "Quantidade", 10000); } catch (error) { toast({ title: "Quantidade inválida", description: (error as Error).message, variant: "destructive" }); return; }
    const ci = viewLocItems.find((i: any) => i.product_id === saleAddProductId);
    const product = products.find((p: any) => p.id === saleAddProductId);
    const unitPrice = (ci as any)?.sale_price ?? product?.sale_price ?? 0;
    const existing = saleItems.find((si) => si.productId === saleAddProductId);
    if (!ci || qty + (existing?.qty ?? 0) > ci.current_qty) { toast({ title: "Saldo insuficiente no ponto", variant: "destructive" }); return; }
    if (existing) {
      setSaleItems(saleItems.map((si) => si.productId === saleAddProductId ? { ...si, qty: si.qty + qty } : si));
    } else {
      setSaleItems([...saleItems, { productId: saleAddProductId, qty, unitPrice }]);
    }
    setSaleAddProductId("");
    setSaleAddQty("1");
  };

  const removeSaleItem = (productId: string) => {
    setSaleItems(saleItems.filter((si) => si.productId !== productId));
  };

  const saleTotalValue = saleItems.reduce((s, si) => s + si.unitPrice * si.qty, 0);
  const saleTotalCommission = saleItems.reduce((s, si) => s + getCommission(si.unitPrice) * si.qty, 0);
  const saleNetReceivable = saleTotalValue - saleTotalCommission;

  if (locationsError || itemsError) return <div className="space-y-4 rounded-xl border bg-card p-6"><p role="alert">Não foi possível carregar o consignado. {(locationsError || itemsError)?.message}</p><Button variant="outline" onClick={() => { refetchLocations(); qc.invalidateQueries({ queryKey: ["consignment_items"] }); }}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Dialog open={!!editingItemId} onOpenChange={open => { if (!open && !adjustQtyMut.isPending) setEditingItemId(null); }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Conferir estoque do ponto</DialogTitle><DialogDescription>Saldo anterior: {editOriginalQty} peças. O ajuste registra a diferença e a justificativa no histórico.</DialogDescription></DialogHeader>
          <div className="space-y-4"><div className="space-y-2"><Label htmlFor="consignment-qty">Quantidade contada</Label><Input id="consignment-qty" type="number" min="0" step="1" value={editQtyValue} onChange={event => setEditQtyValue(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="consignment-reason">Motivo do ajuste</Label><Textarea id="consignment-reason" value={editQtyReason} onChange={event => setEditQtyReason(event.target.value)} placeholder="Descreva a divergência encontrada na conferência física" /></div></div>
          <DialogFooter><Button variant="outline" disabled={adjustQtyMut.isPending} onClick={() => setEditingItemId(null)}>Cancelar</Button><Button disabled={adjustQtyMut.isPending || !editQtyReason.trim() || !editQtyValue.trim()} onClick={() => adjustQtyMut.mutate({ itemId: editingItemId!, newQty: Number(editQtyValue) })}>{adjustQtyMut.isPending ? "Registrando..." : "Registrar ajuste"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <PageHeader
        title="Consignado"
        description="Gestão de produtos em consignação"
        breadcrumbs={[{ label: "Comercial" }, { label: "Consignado" }]}
        actions={
          <Button size="sm" onClick={() => setCreateLocOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo Ponto
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pontos Ativos</p>
          <p className="text-2xl font-bold text-foreground">{locations.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Itens em Consignação</p>
          <p className="text-2xl font-bold text-foreground">{totalItemsOut}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Valor Total (preço venda)</p>
          <p className="text-2xl font-bold text-foreground">{fmtCurrency(totalValueOut)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar ponto…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Locations Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground rounded-xl border bg-card">
          <MapPin className="h-10 w-10 mb-3 opacity-40" />
          <p className="font-medium">Nenhum ponto de consignação</p>
          <p className="text-sm">Crie um ponto para começar a gerenciar seus consignados.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((loc: any) => {
            const summary = locationSummary[loc.id] || { totalItems: 0, totalValue: 0 };
            return (
              <div
                key={loc.id}
                className="rounded-xl border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer group"
                onClick={() => setViewLocId(loc.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <MapPin className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{loc.name}</p>
                      {(loc as any).customers?.name && <p className="text-xs text-muted-foreground">{(loc as any).customers.name}</p>}
                      {!(loc as any).customers?.name && loc.contact_name && <p className="text-xs text-muted-foreground">{loc.contact_name}</p>}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Ações do ponto">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setViewLocId(loc.id); }}>
                        <Eye className="h-3.5 w-3.5 mr-2" /> Ver Detalhes
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Arquivar ${loc.name}? O histórico será preservado.`)) deleteLocMut.mutate(loc.id); }}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Arquivar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {loc.address && (
                  <p className="text-xs text-muted-foreground mt-2 truncate">{loc.address}</p>
                )}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Itens</p>
                    <p className="text-sm font-bold text-foreground">{summary.totalItems}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Valor</p>
                    <p className="text-sm font-bold text-foreground">{fmtCurrency(summary.totalValue)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Location Dialog ── */}
      <Dialog open={createLocOpen} onOpenChange={(o) => { if (createLocMut.isPending) return; if (!o) { setCreateLocOpen(false); resetLocForm(); } else setCreateLocOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Ponto de Consignação</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            {/* Toggle mode */}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={locMode === "existing" ? "default" : "outline"} onClick={() => setLocMode("existing")} className="flex-1">
                Cliente existente
              </Button>
              <Button type="button" size="sm" variant={locMode === "new" ? "default" : "outline"} onClick={() => setLocMode("new")} className="flex-1">
                Novo cliente
              </Button>
            </div>

            {locMode === "existing" ? (
              <div>
                <Label>Cliente *</Label>
                <Select value={locCustomerId || "none"} onValueChange={(v) => setLocCustomerId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Selecione…</SelectItem>
                    {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div><Label>Nome do Cliente *</Label><Input value={newCustName} onChange={(e) => setNewCustName(e.target.value)} placeholder="Ex: AnaLu Unhas" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Telefone</Label><Input value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} placeholder="(62) 99999-9999" /></div>
                  <div><Label>CPF/CNPJ</Label><Input value={newCustDocument} onChange={(e) => setNewCustDocument(e.target.value)} placeholder="000.000.000-00" /></div>
                </div>
                <div><Label>E-mail</Label><Input value={newCustEmail} onChange={(e) => setNewCustEmail(e.target.value)} placeholder="cliente@email.com" /></div>
                <div><Label>Data de Nascimento</Label><Input type="date" value={newCustBirthday} onChange={(e) => setNewCustBirthday(e.target.value)} /></div>
              </>
            )}

            <div>
              <Label>Nome do Ponto *</Label>
              <Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Ex: Vitrine Loja Centro" />
            </div>
            <div>
              <Label>Comissão do ponto de venda (%)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={locCommissionInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.,]/g, "");
                  setLocCommissionInput(raw);
                  const normalized = raw.replace(",", ".");
                  const parsed = parseFloat(normalized);
                  setLocCommissionPercent(normalized === "" ? "" : String(parsed));
                }}
                onBlur={() => {
                  const parsed = Number(locCommissionInput.replace(",", "."));
                  if (Number.isFinite(parsed)) { setLocCommissionPercent(String(parsed)); setLocCommissionInput(String(parsed).replace(".", ",")); }
                }}
                placeholder="20"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Comissão retida pelo ponto em cada venda. Padrão: 20%. Informe 0 para repasse integral.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={createLocMut.isPending} onClick={() => { setCreateLocOpen(false); resetLocForm(); }}>Cancelar</Button>
            <Button
              onClick={() => createLocMut.mutate()}
              disabled={
                !locName.trim() ||
                (locMode === "existing" ? !locCustomerId : !newCustName.trim()) ||
                createLocMut.isPending
              }
            >
              {createLocMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Location Dialog ── */}
      <Dialog open={!!viewLocId} onOpenChange={(o) => { if (!o) setViewLocId(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto w-[95vw] sm:w-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              {viewLoc?.name || "Ponto"}
            </DialogTitle>
          </DialogHeader>

          {viewLoc && (
            <div className="space-y-4">
              {/* Location info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{(viewLoc as any).customers?.name || <span className="text-destructive">Nenhum vinculado</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Contato</p>
                  <p className="font-medium">{viewLoc.contact_name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p className="font-medium">{viewLoc.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Endereço</p>
                  <p className="font-medium">{viewLoc.address || "—"}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">Comissão do ponto: <strong className="text-foreground">{COMMISSION_PERCENT}%</strong>. A venda registra o repasse líquido a receber; o estoque permanece rastreado no ponto.</p>
              {/* Edit customer link if missing */}
              {!(viewLoc as any).customer_id && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <span className="text-destructive">⚠ Vincule um cliente a este ponto para registrar vendas.</span>
                  <Select value="" onValueChange={async (val) => {
                    const { error } = await supabase.from("consignment_locations").update({ customer_id: val } as any).eq("id", viewLocId!);
                    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
                    qc.invalidateQueries({ queryKey: ["consignment_locations"] });
                    toast({ title: "Cliente vinculado!" });
                  }}>
                    <SelectTrigger className="w-[200px] h-8">
                      <SelectValue placeholder="Selecionar cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openMovement("placement")}>
                  <ArrowUpFromLine className="h-3.5 w-3.5 mr-1" /> Colocar Itens
                </Button>
                <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={() => openMovement("sale")}>
                  <ShoppingCart className="h-3.5 w-3.5 mr-1" /> Registrar Venda
                </Button>
                <Button size="sm" variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => openMovement("replenishment")}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Repor
                </Button>
                <Button size="sm" variant="outline" onClick={() => openMovement("return")}>
                  <ArrowDownToLine className="h-3.5 w-3.5 mr-1" /> Devolver
                </Button>
                {viewLocItems.some((i: any) => i.current_qty > 0) && (
                  <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => { if (window.confirm("Recolher todas as peças deste ponto? Confirme que a devolução física foi conferida.")) returnAllMut.mutate(); }} disabled={returnAllMut.isPending}>
                    {returnAllMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Package className="h-3.5 w-3.5 mr-1" />} Recolher Tudo
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => downloadConsignment()}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Imprimir / PDF
                </Button>
              </div>

              <Tabs defaultValue="stock" className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="stock" className="flex-1">Estoque Atual</TabsTrigger>
                  <TabsTrigger value="movements" className="flex-1">Movimentações</TabsTrigger>
                </TabsList>

                <TabsContent value="stock">
                  {itemsLoading || itemsError ? <p role={itemsError ? "alert" : "status"} className="p-4 text-sm">{itemsError ? "Não foi possível carregar o estoque deste ponto." : "Carregando estoque..."}</p> : viewLocItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                      <Package className="h-8 w-8 mb-2 opacity-40" />
                      <p className="text-sm">Nenhum item neste ponto</p>
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Produto</TableHead>
                            <TableHead className="text-center">Atual</TableHead>
                            <TableHead className="text-right">Preço Venda</TableHead>
                            <TableHead className="text-right">Comissão ({COMMISSION_PERCENT}%)</TableHead>
                            <TableHead className="text-center">Vendidos</TableHead>
                            <TableHead className="text-right">Valor (estoque)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {viewLocItems.map((item: any) => {
                            const effectivePrice = getItemSalePrice(item);
                            const commission = getCommission(effectivePrice);
                            return (
                            <TableRow key={item.id} className="group">
                              <TableCell className="text-sm font-medium">
                                <div className="flex items-center gap-2">
                                  {item.products?.photo_url && (
                                    <img src={item.products.photo_url} className="h-8 w-8 rounded object-cover" />
                                  )}
                                  {item.products?.name || "—"}
                                </div>
                              </TableCell>
                              <TableCell className="text-center font-bold">
                                <button className="inline-flex min-h-10 items-center gap-2 hover:text-primary" onClick={() => {
                                  delete operations.current.adjustment;
                                  setEditingItemId(item.id); setEditQtyValue(String(item.current_qty)); setEditOriginalQty(item.current_qty); setEditQtyReason("");
                                }} aria-label={`Conferir saldo de ${item.products?.name ?? "produto"}`}>
                                  {item.current_qty}<Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm font-semibold">
                                {editingPriceItemId === item.id ? (
                                  <div className="flex items-center gap-1 justify-end">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      className="w-24 h-10 text-right text-sm p-2"
                                      value={editPriceValue}
                                      onChange={(e) => setEditPriceValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") updatePriceMut.mutate({ itemId: item.id, newPrice: Number(editPriceValue) });
                                        if (e.key === "Escape") setEditingPriceItemId(null);
                                      }}
                                      autoFocus
                                    />
                                    <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Ações" onClick={() => updatePriceMut.mutate({ itemId: item.id, newPrice: Number(editPriceValue) })} disabled={updatePriceMut.isPending}>
                                      {updatePriceMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Ações" onClick={() => setEditingPriceItemId(null)}>
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    className="inline-flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                                    onClick={() => { setEditingPriceItemId(item.id); setEditPriceValue(String(effectivePrice)); }}
                                  >
                                    {fmtCurrency(effectivePrice)}
                                    <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                                  </button>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                                {fmtCurrency(commission)}
                              </TableCell>
                              <TableCell className="text-center text-emerald-600 font-medium">{item.total_sold}</TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {fmtCurrency(item.current_qty * effectivePrice)}
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="movements">
                  {(movementsLoading || movementsError) && <p role={movementsError ? "alert" : "status"} className="p-4 text-sm">{movementsError ? "Não foi possível carregar as movimentações." : "Carregando movimentações..."}</p>}
                  {movements.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                      <ArrowRightLeft className="h-8 w-8 mb-2 opacity-40" />
                      <p className="text-sm">Nenhuma movimentação</p>
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Produto</TableHead>
                            <TableHead className="text-center">Qtd</TableHead>
                            <TableHead className="text-right">Preço Unit.</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Justificativa</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {movements.map((mov: any) => {
                            const cfg = movementLabels[mov.movement_type] || movementLabels.placement;
                            return (
                              <TableRow key={mov.id}>
                                <TableCell className="text-xs">{new Date(mov.created_at).toLocaleDateString("pt-BR")}</TableCell>
                                <TableCell>
                                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cfg.color)}>
                                    {cfg.label}
                                  </span>
                                </TableCell>
                                <TableCell className="text-sm">{mov.products?.name || "—"}</TableCell>
                                <TableCell className="text-center font-medium">{mov.quantity}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{fmtCurrency(mov.unit_price)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{fmtCurrency(mov.total)}</TableCell><TableCell className="max-w-xs whitespace-normal text-sm">{mov.notes || "—"}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Movement Dialog ── */}
      <Dialog open={movementOpen} onOpenChange={open => { if (!movementMut.isPending) setMovementOpen(open); }}>
        <DialogContent className={cn("max-w-md", movementType === "sale" && "max-w-lg")}>
          <DialogHeader>
            <DialogTitle>
              {movementLabels[movementType]?.label || "Movimento"} — {viewLoc?.name}
            </DialogTitle>
          </DialogHeader>

          {movementType === "sale" ? (
            /* ── SALE: Multi-item ── */
            <div className="grid gap-4">
              {/* Add item row */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs">Produto</Label>
                  <Popover open={saleAddPopoverOpen} onOpenChange={setSaleAddPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9 text-sm">
                        {saleAddProductId
                          ? products.find((x) => x.id === saleAddProductId)?.name || "…"
                          : "Selecione…"}
                        <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar produto..." />
                        <CommandList>
                          <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
                          <CommandGroup>
                            {/* Show only items in stock at this location */}
                            {viewLocItems.filter((i: any) => i.current_qty > 0).map((ci: any) => {
                              const p = products.find((x) => x.id === ci.product_id);
                              if (!p) return null;
                              const price = getItemSalePrice(ci);
                              return (
                                <CommandItem
                                  key={p.id}
                                  value={p.name}
                                  onSelect={() => {
                                    setSaleAddProductId(p.id);
                                    setSaleAddPopoverOpen(false);
                                  }}
                                >
                                  <div className="flex justify-between w-full">
                                    <span>{p.name}</span>
                                    <span className="text-xs text-muted-foreground ml-2">
                                      {ci.current_qty}un · {fmtCurrency(price)}
                                    </span>
                                  </div>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="w-16">
                  <Label className="text-xs">Qtd</Label>
                  <Input type="number" min={1} className="h-9 text-sm" value={saleAddQty} onChange={(e) => setSaleAddQty(e.target.value)} />
                </div>
                <Button size="sm" className="h-9" onClick={addSaleItem} disabled={!saleAddProductId}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Items list */}
              {saleItems.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Produto</TableHead>
                        <TableHead className="text-xs text-center w-14">Qtd</TableHead>
                        <TableHead className="text-xs text-right">Preço</TableHead>
                        <TableHead className="text-xs text-right">Subtotal</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {saleItems.map((si) => {
                        const p = products.find((x) => x.id === si.productId);
                        return (
                          <TableRow key={si.productId}>
                            <TableCell className="text-sm py-2">{p?.name || "—"}</TableCell>
                            <TableCell className="text-center py-2">
                              <Input
                                type="number" min={1}
                                className="w-14 h-7 text-center text-sm p-1"
                                value={si.qty}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setSaleItems(saleItems.map((x) => x.productId === si.productId ? { ...x, qty: v } : x));
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm py-2">
                              <Input
                                type="number" step="0.01" min={0}
                                className="w-20 h-7 text-right text-sm p-1 ml-auto"
                                value={si.unitPrice}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setSaleItems(saleItems.map((x) => x.productId === si.productId ? { ...x, unitPrice: v } : x));
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm py-2">{fmtCurrency(si.unitPrice * si.qty)}</TableCell>
                            <TableCell className="py-2">
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeSaleItem(si.productId)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Financial summary */}
              {saleItems.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor Vendido</span>
                    <span className="font-semibold font-mono">{fmtCurrency(saleTotalValue)}</span>
                  </div>
                  <div className="flex justify-between text-destructive/80">
                    <span>Comissão do PDV ({COMMISSION_PERCENT}%)</span>
                    <span className="font-mono">− {fmtCurrency(saleTotalCommission)}</span>
                  </div>
                  <div className="border-t pt-1.5 flex justify-between font-bold">
                    <span>Valor a Receber (repasse)</span>
                    <span className="font-mono text-emerald-600">{fmtCurrency(saleNetReceivable)}</span>
                  </div>
                </div>
              )}

              <div>
                <Label>Observações</Label>
                <Textarea value={movNotes} onChange={(e) => setMovNotes(e.target.value)} rows={2} />
              </div>
            </div>
          ) : (
            /* ── NON-SALE: single product ── */
            <div className="grid gap-4">
              <div>
                <Label>Produto *</Label>
                <Popover open={productPopoverOpen} onOpenChange={setProductPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-10">
                      {movProductId
                        ? (() => {
                            const p = products.find((x) => x.id === movProductId);
                            if (!p) return "Selecione…";
                            const ci = viewLocItems.find((i: any) => i.product_id === movProductId);
                            const price = ci?.sale_price ?? p.sale_price ?? 0;
                            return `${p.name} — ${fmtCurrency(price)}`;
                          })()
                        : "Selecione um produto…"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar produto..." />
                      <CommandList>
                        <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
                        <CommandGroup>
                          {products.map((p) => {
                            const ci = viewLocItems.find((i: any) => i.product_id === p.id);
                            const price = ci?.sale_price ?? p.sale_price ?? 0;
                            return (
                              <CommandItem
                                key={p.id}
                                value={p.name}
                                onSelect={() => {
                                  setMovProductId(p.id);
                                  setProductPopoverOpen(false);
                                }}
                              >
                                <div className="flex flex-col">
                                  <span>{p.name}</span>
                                  <span className="text-xs text-muted-foreground">{fmtCurrency(price)}</span>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label>Quantidade *</Label>
                <Input type="number" min={1} value={movQty} onChange={(e) => setMovQty(e.target.value)} placeholder="10" />
              </div>
              <div>
                <Label>Observações</Label>
                <Textarea value={movNotes} onChange={(e) => setMovNotes(e.target.value)} rows={2} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" disabled={movementMut.isPending} onClick={() => setMovementOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => movementMut.mutate()}
              disabled={
                movementMut.isPending ||
                (movementType === "sale" ? saleItems.length === 0 : (!movProductId || !movQty))
              }
            >
              {movementMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
