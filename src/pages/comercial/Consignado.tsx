import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Loader2, MapPin, Package, Trash2, ArrowRightLeft,
  ArrowUpFromLine, ArrowDownToLine, RotateCcw, ShoppingCart, Eye, X, Printer, Pencil, Check,
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
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
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

/** Preço consignado = desconto sobre o sale_price, mas nunca abaixo do custo */
const getConsignmentPrice = (salePrice: number | null, costEstimate: number | null, discountPercent: number = 29) => {
  const sp = salePrice || 0;
  const cost = costEstimate || 0;
  const discounted = Math.round(sp * (1 - discountPercent / 100) * 100) / 100;
  return Math.max(discounted, cost);
};

/** Preço de venda efetivo do item consignado (custom ou do produto) */
const getItemSalePrice = (item: any) => {
  return (item as any).sale_price ?? item.products?.sale_price ?? 0;
};

/** Comissão do PDV = 20% do preço de venda */
const COMMISSION_PERCENT = 20;
const getCommission = (salePrice: number) => Math.round(salePrice * COMMISSION_PERCENT / 100 * 100) / 100;

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
  const [locDiscountPercent, setLocDiscountPercent] = useState("29");
  const [locDiscountInput, setLocDiscountInput] = useState("29");
  // Movement form
  const [movProductId, setMovProductId] = useState("");
  const [movQty, setMovQty] = useState("");
  const [movPrice, setMovPrice] = useState("");
  const [movNotes, setMovNotes] = useState("");
  // Inline qty edit
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editQtyValue, setEditQtyValue] = useState("");
  const [productPopoverOpen, setProductPopoverOpen] = useState(false);
  // Inline price edit
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState("");

  // ── Queries ──
  const { data: locations = [], isLoading } = useQuery({
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

  const { data: allItems = [] } = useQuery({
    queryKey: ["consignment_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consignment_items")
        .select("*, products(name, photo_url, sale_price, cost_estimate), consignment_locations(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
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

  const { data: movements = [] } = useQuery({
    queryKey: ["consignment_movements", viewLocId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consignment_movements")
        .select("*, products(name)")
        .eq("location_id", viewLocId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!viewLocId,
  });

  const viewLoc = locations.find((l: any) => l.id === viewLocId);
  const viewLocItems = allItems.filter((i: any) => i.location_id === viewLocId);

  const filtered = useMemo(() => {
    if (!search) return locations;
    const s = search.toLowerCase();
    return locations.filter((l: any) => l.name.toLowerCase().includes(s) || l.address?.toLowerCase().includes(s));
  }, [locations, search]);

  // Per-location summary
  const locationSummary = useMemo(() => {
    const map: Record<string, { totalItems: number; totalValue: number }> = {};
    for (const item of allItems as any[]) {
      if (!map[item.location_id]) map[item.location_id] = { totalItems: 0, totalValue: 0 };
      map[item.location_id].totalItems += item.current_qty;
      map[item.location_id].totalValue += item.current_qty * (item.products?.sale_price || 0);
    }
    return map;
  }, [allItems]);

  const totalItemsOut = Object.values(locationSummary).reduce((s, v) => s + v.totalItems, 0);
  const totalValueOut = Object.values(locationSummary).reduce((s, v) => s + v.totalValue, 0);

  // ── Mutations ──
  const resetLocForm = () => {
    setLocMode("existing"); setLocCustomerId(""); setLocName("");
    setNewCustName(""); setNewCustPhone(""); setNewCustEmail(""); setNewCustDocument(""); setNewCustBirthday("");
    setLocDiscountPercent("29"); setLocDiscountInput("29");
  };

  const createLocMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      if (!locName.trim()) throw new Error("Informe o nome do ponto");

      let customerId: string;

      if (locMode === "existing") {
        if (!locCustomerId) throw new Error("Selecione um cliente");
        customerId = locCustomerId;
      } else {
        if (!newCustName.trim()) throw new Error("Informe o nome do cliente");
        const { data: created, error: custErr } = await supabase
          .from("customers")
          .insert({
            tenant_id: profile.tenant_id,
            name: newCustName.trim(),
            phone: newCustPhone || null,
            email: newCustEmail || null,
            document: newCustDocument || null,
            birthday: newCustBirthday || null,
            is_active: true,
          })
          .select("id")
          .single();
        if (custErr) throw custErr;
        customerId = created.id;
      }

      const c = customers.find((x) => x.id === customerId) as any;
      const addr = c?.address as any;
      const addrStr = addr
        ? [addr.street, addr.number, addr.complement, addr.neighborhood, addr.city, addr.state].filter(Boolean).join(", ")
        : null;

      const { error } = await supabase.from("consignment_locations").insert({
        tenant_id: profile.tenant_id,
        name: locName.trim(),
        customer_id: customerId,
        contact_name: c?.name || newCustName.trim(),
        phone: c?.phone || newCustPhone || null,
        address: addrStr || null,
        discount_percent: parseFloat(locDiscountPercent) || 29,
      } as any);
      if (error) throw error;
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
      const { error } = await supabase.from("consignment_locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consignment_locations"] });
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      if (viewLocId) setViewLocId(null);
      toast({ title: "Ponto removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const movementMut = useMutation({
    mutationFn: async () => {
      if (!profile || !viewLocId) throw new Error("Sem contexto");
      const qty = parseInt(movQty);
      if (!qty || qty <= 0) throw new Error("Quantidade inválida");
      if (!movProductId) throw new Error("Selecione um produto");

      const price = parseFloat(movPrice) || null;
      const total = price ? price * qty : null;

      // Insert movement
      const { error: movErr } = await supabase.from("consignment_movements").insert({
        tenant_id: profile.tenant_id,
        location_id: viewLocId,
        product_id: movProductId,
        movement_type: movementType as any,
        quantity: qty,
        unit_price: price,
        total,
        notes: movNotes || null,
        created_by: profile.user_id,
      });
      if (movErr) throw movErr;

      // Upsert consignment_items
      const { data: existing } = await supabase
        .from("consignment_items")
        .select("*")
        .eq("location_id", viewLocId)
        .eq("product_id", movProductId)
        .maybeSingle();

      const cur = existing || { current_qty: 0, total_placed: 0, total_sold: 0, total_returned: 0 };
      let newQty = cur.current_qty;
      let newPlaced = cur.total_placed;
      let newSold = cur.total_sold;
      let newReturned = cur.total_returned;

      switch (movementType) {
        case "placement":
        case "replenishment":
          newQty += qty;
          newPlaced += qty;
          break;
        case "sale":
          newQty -= qty;
          newSold += qty;
          break;
        case "return":
          newQty -= qty;
          newReturned += qty;
          break;
      }

      // ── Auto-criar Pedido + Conta a Receber na venda ──
      if (movementType === "sale") {
        const loc = locations.find((l: any) => l.id === viewLocId);
        if (!(loc as any)?.customer_id) {
          throw new Error("Este ponto não tem um cliente vinculado. Edite o ponto e associe um cliente antes de registrar vendas.");
        }
        const product = products.find((p: any) => p.id === movProductId);
        const locDiscount = (loc as any)?.discount_percent ?? 29;
        const unitPrice = price || getConsignmentPrice(product?.sale_price ?? null, product?.cost_estimate ?? null, locDiscount);
        const saleTotal = unitPrice * qty;

        // Count existing orders for code generation
        const { count: orderCount } = await supabase
          .from("orders")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", profile.tenant_id);

        const code = `CSG-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String((orderCount ?? 0) + 1).padStart(3, "0")}`;

        const { data: order, error: orderErr } = await supabase.from("orders").insert({
          tenant_id: profile.tenant_id,
          code,
          customer_id: (loc as any)?.customer_id || null,
          total: saleTotal,
          status: "approved",
          approved_at: new Date().toISOString(),
          notes: `Venda consignado — ${loc?.name || ""}${movNotes ? `\n${movNotes}` : ""}`,
          created_by: profile.user_id,
        } as any).select("id").single();
        if (orderErr) throw orderErr;

        // Create order item
        const { error: itemErr } = await supabase.from("order_items").insert({
          tenant_id: profile.tenant_id,
          order_id: order.id,
          product_id: movProductId,
          description: product?.name || "Produto consignado",
          quantity: qty,
          unit_price: unitPrice,
          total: saleTotal,
        });
        if (itemErr) throw itemErr;

        // Create AR
        const { error: arErr } = await supabase.from("accounts_receivable").insert({
          tenant_id: profile.tenant_id,
          description: `Consignado ${loc?.name} — ${code}`,
          amount: saleTotal,
          due_date: new Date().toISOString().slice(0, 10),
          competence_date: new Date().toISOString().slice(0, 10),
          customer_id: (loc as any)?.customer_id || null,
          origin_id: order.id,
          origin_type: "order",
          created_by: profile.user_id,
          status: "open",
        });
        if (arErr) throw new Error(`Erro ao criar conta a receber: ${arErr.message}`);
      }

      if (existing) {
        const { error } = await supabase.from("consignment_items").update({
          current_qty: newQty,
          total_placed: newPlaced,
          total_sold: newSold,
          total_returned: newReturned,
        }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("consignment_items").insert({
          tenant_id: profile.tenant_id,
          location_id: viewLocId,
          product_id: movProductId,
          current_qty: newQty,
          total_placed: newPlaced,
          total_sold: newSold,
          total_returned: newReturned,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      qc.invalidateQueries({ queryKey: ["consignment_movements"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["accounts_receivable"] });
      setMovementOpen(false);
      setMovProductId(""); setMovQty(""); setMovPrice(""); setMovNotes("");
      toast({ title: "Movimento registrado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const returnAllMut = useMutation({
    mutationFn: async () => {
      if (!profile || !viewLocId) throw new Error("Sem contexto");
      const itemsToReturn = viewLocItems.filter((i: any) => i.current_qty > 0);
      if (itemsToReturn.length === 0) throw new Error("Nenhum item para recolher");

      for (const item of itemsToReturn as any[]) {
        // Insert return movement
        await supabase.from("consignment_movements").insert({
          tenant_id: profile.tenant_id,
          location_id: viewLocId,
          product_id: item.product_id,
          movement_type: "return" as any,
          quantity: item.current_qty,
          notes: "Recolhimento total",
          created_by: profile.user_id,
        }).then(({ error }) => { if (error) throw error; });

        // Zero out the item
        await supabase.from("consignment_items").update({
          current_qty: 0,
          total_returned: item.total_returned + item.current_qty,
        }).eq("id", item.id).then(({ error }) => { if (error) throw error; });
      }
    },
    onSuccess: () => {
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
      if (newQty < 0) throw new Error("Quantidade não pode ser negativa");

      const diff = newQty - item.current_qty;
      const movType = diff >= 0 ? "placement" : "return";
      const absQty = Math.abs(diff);

      if (absQty > 0) {
        // Register adjustment movement
        const { error: movErr } = await supabase.from("consignment_movements").insert({
          tenant_id: profile.tenant_id,
          location_id: viewLocId,
          product_id: item.product_id,
          movement_type: movType as any,
          quantity: absQty,
          notes: `Ajuste manual: ${item.current_qty} → ${newQty}`,
          created_by: profile.user_id,
        });
        if (movErr) throw movErr;

        const updates: any = { current_qty: newQty };
        if (diff > 0) updates.total_placed = item.total_placed + absQty;
        if (diff < 0) updates.total_returned = item.total_returned + absQty;

        const { error } = await supabase.from("consignment_items").update(updates).eq("id", itemId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      qc.invalidateQueries({ queryKey: ["consignment_movements"] });
      setEditingItemId(null);
      toast({ title: "Quantidade ajustada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updatePriceMut = useMutation({
    mutationFn: async ({ itemId, newPrice }: { itemId: string; newPrice: number }) => {
      if (newPrice < 0) throw new Error("Preço não pode ser negativo");
      const { error } = await supabase.from("consignment_items").update({ sale_price: newPrice } as any).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consignment_items"] });
      setEditingPriceItemId(null);
      toast({ title: "Preço atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const printConsignment = () => {
    if (!viewLoc) return;
    const today = new Date().toLocaleDateString("pt-BR");
    const itemsWithStock = viewLocItems.filter((i: any) => i.current_qty > 0);
    const totalValue = itemsWithStock.reduce((sum: number, i: any) => {
      const price = getItemSalePrice(i);
      return sum + i.current_qty * price;
    }, 0);
    const customerName = (viewLoc as any).customers?.name || viewLoc.contact_name || "—";

    const rows = itemsWithStock.map((item: any, idx: number) => {
      const price = getItemSalePrice(item);
      return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center">${idx + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd">${item.products?.name || "—"}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center">${item.current_qty}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">${fmtCurrency(price)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right">${fmtCurrency(item.current_qty * price)}</td>
      </tr>
    `;}).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consignado - ${viewLoc.name}</title>
      <style>
        @media print { @page { margin: 15mm; } }
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #222; font-size: 13px; }
        h2 { margin: 0 0 4px; font-size: 18px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { background: #f5f5f5; padding: 8px; text-align: left; border-bottom: 2px solid #ccc; font-size: 12px; }
        .total-row td { font-weight: bold; border-top: 2px solid #333; }
        .sig { margin-top: 60px; display: flex; justify-content: space-between; gap: 40px; }
        .sig-box { flex: 1; text-align: center; border-top: 1px solid #333; padding-top: 6px; font-size: 12px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 12px; margin-bottom: 8px; }
        .info-grid span { color: #888; }
      </style></head><body>
      <h2>Termo de Consignação</h2>
      <p class="sub">Emitido em ${today}</p>
      <div class="info-grid">
        <div><span>Ponto:</span> <strong>${viewLoc.name}</strong></div>
        <div><span>Cliente:</span> <strong>${customerName}</strong></div>
        <div><span>Contato:</span> ${viewLoc.contact_name || "—"}</div>
        <div><span>Telefone:</span> ${viewLoc.phone || "—"}</div>
        <div><span>Endereço:</span> ${viewLoc.address || "—"}</div>
      </div>
      <table>
        <thead><tr>
          <th style="text-align:center;width:40px">#</th>
          <th>Produto</th>
          <th style="text-align:center">Qtd</th>
          <th style="text-align:right">Preço Unit.</th>
          <th style="text-align:right">Total</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="4" style="padding:8px;text-align:right">TOTAL</td>
            <td style="padding:8px;text-align:right">${fmtCurrency(totalValue)}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size:11px;color:#666;margin-top:16px">
        Declaro ter recebido os produtos acima em regime de consignação, comprometendo-me a devolver os itens não vendidos ou efetuar o pagamento dos itens vendidos conforme acordado.
      </p>
      <div class="sig">
        <div class="sig-box">Responsável pela Empresa</div>
        <div class="sig-box">${customerName}<br/><span style="font-size:10px;color:#888">Consignatário(a)</span></div>
      </div>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.onload = () => { w.print(); };
    }
  };

  const openMovement = (type: string) => {
    setMovementType(type);
    setMovProductId("");
    setMovQty("");
    setMovPrice(type === "sale" ? "" : "");
    setMovNotes("");
    setMovementOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setViewLocId(loc.id); }}>
                        <Eye className="h-3.5 w-3.5 mr-2" /> Ver Detalhes
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteLocMut.mutate(loc.id); }}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
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
      <Dialog open={createLocOpen} onOpenChange={(o) => { if (!o) { setCreateLocOpen(false); resetLocForm(); } else setCreateLocOpen(true); }}>
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
              <Label>Desconto sobre preço de venda (%)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={locDiscountInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.,]/g, "");
                  setLocDiscountInput(raw);
                  const normalized = raw.replace(",", ".");
                  const parsed = parseFloat(normalized);
                  if (!isNaN(parsed)) setLocDiscountPercent(String(parsed));
                }}
                onBlur={() => {
                  const val = parseFloat(locDiscountPercent) || 29;
                  const clamped = Math.min(Math.max(val, 0), 100);
                  setLocDiscountPercent(String(clamped));
                  setLocDiscountInput(String(clamped).replace(".", ","));
                }}
                placeholder="29"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Padrão: 29%. O preço nunca ficará abaixo do custo estimado.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateLocOpen(false); resetLocForm(); }}>Cancelar</Button>
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

              {/* Edit customer link if missing */}
              {!(viewLoc as any).customer_id && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
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
                  <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => returnAllMut.mutate()} disabled={returnAllMut.isPending}>
                    {returnAllMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Package className="h-3.5 w-3.5 mr-1" />} Recolher Tudo
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => printConsignment()}>
                  <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir
                </Button>
              </div>

              <Tabs defaultValue="stock" className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="stock" className="flex-1">Estoque Atual</TabsTrigger>
                  <TabsTrigger value="movements" className="flex-1">Movimentações</TabsTrigger>
                </TabsList>

                <TabsContent value="stock">
                  {viewLocItems.length === 0 ? (
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
                                {editingItemId === item.id ? (
                                  <div className="flex items-center gap-1 justify-center">
                                    <Input
                                      type="number"
                                      min={0}
                                      className="w-16 h-7 text-center text-sm p-1"
                                      value={editQtyValue}
                                      onChange={(e) => setEditQtyValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") adjustQtyMut.mutate({ itemId: item.id, newQty: parseInt(editQtyValue) || 0 });
                                        if (e.key === "Escape") setEditingItemId(null);
                                      }}
                                      autoFocus
                                    />
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => adjustQtyMut.mutate({ itemId: item.id, newQty: parseInt(editQtyValue) || 0 })} disabled={adjustQtyMut.isPending}>
                                      {adjustQtyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingItemId(null)}>
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    className="inline-flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                                    onClick={() => { setEditingItemId(item.id); setEditQtyValue(String(item.current_qty)); }}
                                  >
                                    {item.current_qty}
                                    <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                                  </button>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm font-semibold">
                                {editingPriceItemId === item.id ? (
                                  <div className="flex items-center gap-1 justify-end">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      className="w-20 h-7 text-right text-sm p-1"
                                      value={editPriceValue}
                                      onChange={(e) => setEditPriceValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") updatePriceMut.mutate({ itemId: item.id, newPrice: parseFloat(editPriceValue) || 0 });
                                        if (e.key === "Escape") setEditingPriceItemId(null);
                                      }}
                                      autoFocus
                                    />
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updatePriceMut.mutate({ itemId: item.id, newPrice: parseFloat(editPriceValue) || 0 })} disabled={updatePriceMut.isPending}>
                                      {updatePriceMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                    </Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingPriceItemId(null)}>
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
                                <TableCell className="text-right font-mono text-sm">{fmtCurrency(mov.total)}</TableCell>
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
      <Dialog open={movementOpen} onOpenChange={setMovementOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {movementLabels[movementType]?.label || "Movimento"} — {viewLoc?.name}
            </DialogTitle>
          </DialogHeader>
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
                          // Check if there's a custom price on the consignment item
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
                          const csg = getConsignmentPrice(p.sale_price ?? null, p.cost_estimate ?? null, (viewLoc as any)?.discount_percent ?? 29);
                          return (
                            <CommandItem
                              key={p.id}
                              value={p.name}
                              onSelect={() => {
                                setMovProductId(p.id);
                                if (movementType === "sale") {
                                  setMovPrice(String(csg));
                                }
                                setProductPopoverOpen(false);
                              }}
                            >
                              <div className="flex flex-col">
                                <span>{p.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {fmtCurrency(csg)}{movementType === "sale" && p.sale_price ? ` (era ${fmtCurrency(p.sale_price)})` : ""}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade *</Label>
                <Input type="number" min={1} value={movQty} onChange={(e) => setMovQty(e.target.value)} placeholder="10" />
              </div>
              {(movementType === "sale") && (
                <div>
                  <Label>Preço Unitário</Label>
                  <Input type="number" step="0.01" value={movPrice} onChange={(e) => setMovPrice(e.target.value)} placeholder="25.00" />
                  {(() => {
                    const p = products.find((x) => x.id === movProductId);
                    const typedPrice = parseFloat(movPrice);
                    const cost = p?.cost_estimate ?? 0;
                    const suggestedPrice = p ? getConsignmentPrice(p.sale_price ?? null, p.cost_estimate ?? null, (viewLoc as any)?.discount_percent ?? 29) : 0;
                    if (p && !isNaN(typedPrice) && typedPrice > 0) {
                      if (typedPrice < (cost || 0)) {
                        return <p className="text-xs text-destructive mt-1">⚠ Abaixo do custo ({fmtCurrency(cost)})</p>;
                      }
                      if (typedPrice < suggestedPrice) {
                        return <p className="text-xs text-amber-600 mt-1">Abaixo do sugerido ({fmtCurrency(suggestedPrice)})</p>;
                      }
                    }
                    return null;
                  })()}
                </div>
              )}
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={movNotes} onChange={(e) => setMovNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementOpen(false)}>Cancelar</Button>
            <Button onClick={() => movementMut.mutate()} disabled={!movProductId || !movQty || movementMut.isPending}>
              {movementMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
