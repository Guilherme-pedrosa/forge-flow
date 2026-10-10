import { CommercialPdfButton } from "@/components/comercial/CommercialPdfButton";
import { orderDocument } from "@/lib/commercial-document";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { DeleteRecordDialog, type DeleteTarget } from "@/components/shared/DeleteRecordDialog";
import { prepareOrder, salesOrderTransitions, orderRequest } from "@/lib/sales-order";
import { operatingDateInput, operatingDateToIso, readSalesWorkflowResult, salesOrderNextAction } from "@/lib/sales-workflow";
import { readProductionRows } from "@/lib/production-read";
import { isMissingDatabaseStructure } from "@/lib/database-readiness";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, FileText, Loader2, Trash2, CheckCircle2, Clock, Truck,
  ShoppingCart, MapPin, X, Package, DollarSign, ArrowRight, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { QuoteSnapshotSummary } from "@/components/comercial/QuoteSnapshotSummary";
import { ProductMaterialChoice } from "@/components/comercial/ProductMaterialChoice";
import { readMaterialOverrides, type MaterialOverride } from "@/lib/product-material-variant";
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

const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground" },
  approved: { label: "Aprovado", color: "bg-primary/10 text-primary" },
  in_production: { label: "Em Produção", color: "bg-amber-100 text-amber-700" },
  ready: { label: "Pronto", color: "bg-emerald-100 text-emerald-700" },
  shipped: { label: "Enviado", color: "bg-blue-100 text-blue-700" },
  delivered: { label: "Entregue", color: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelado", color: "bg-destructive/10 text-destructive" },
};

interface OrderLineItem {
  id: string;
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  notes: string;
  material_overrides: MaterialOverride[];
}

let lineCounter = 0;
const newLine = (): OrderLineItem => ({
  id: `new-${++lineCounter}`,
  product_id: "",
  description: "",
  quantity: 1,
  unit_price: 0,
  total: 0,
  notes: "",
  material_overrides: [],
});

export default function Pedidos() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const saveRequest = useRef<{ signature: string; id: string } | null>(null);
  const confirmRequest = useRef<{ signature: string; id: string } | null>(null);
  const deadlineRequest = useRef<{ signature: string; id: string } | null>(null);

  const [stockOrderId, setStockOrderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(() => statusConfig[searchParams.get("status") ?? ""] ? searchParams.get("status")! : "all");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewOrderId, setViewOrderId] = useState<string | null>(searchParams.get("pedido"));
  useEffect(() => { const id = searchParams.get("pedido"); if (id) setViewOrderId(id); }, [searchParams]);
  useEffect(() => { const status = searchParams.get("status"); setStatusFilter(status && statusConfig[status] ? status : "all"); }, [searchParams]);
  const [editMode, setEditMode] = useState(false);
  const [editingDeadlines, setEditingDeadlines] = useState(false);

  // Form state
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [shipBy, setShipBy] = useState("");
  const [internalDue, setInternalDue] = useState("");
  const [bufferHours, setBufferHours] = useState("24");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [shipping, setShipping] = useState("");
  const [discountVal, setDiscountVal] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [lines, setLines] = useState<OrderLineItem[]>([newLine()]);

  const resetForm = () => {
    saveRequest.current = null;
    confirmRequest.current = null;
    deadlineRequest.current = null;
    setEditingDeadlines(false);
    setCustomerId(""); setDueDate(""); setPaymentDueDate(""); setNotes(""); setShipping(""); setDiscountVal("");
    setShipBy(""); setInternalDue(""); setBufferHours("24");
    setDeliveryAddress(""); setLines([newLine()]);
  };

  // Populate form from existing order for editing
  const startEdit = () => {
    if (!viewOrder || viewOrder.source_quote_id || viewOrder.status !== "draft" || itemsLoading || itemsError || linkedLoading || linkedError || linkedJobs.length) return;
    let loadedLines: OrderLineItem[];
    try { loadedLines = viewItems.map((item: any) => ({ id: item.id, product_id: item.product_id || "", description: item.description, quantity: item.quantity, unit_price: item.unit_price, total: item.total, notes: item.notes || "", material_overrides: readMaterialOverrides(item.material_overrides) })); }
    catch (error) { toast({ title: "Não foi possível editar o pedido", description: (error as Error).message, variant: "destructive" }); return; }
    saveRequest.current = null;
    confirmRequest.current = null;
    setEditingDeadlines(false);
    setCustomerId(viewOrder.customer_id || "");
    setDueDate(viewOrder.due_date || "");
    setShipBy(operatingDateInput((viewOrder as unknown as { ship_by_at?: string }).ship_by_at));
    setInternalDue(operatingDateInput((viewOrder as unknown as { internal_due_at?: string }).internal_due_at));
    setPaymentDueDate((viewOrder as any).payment_due_date || "");
    setDiscountVal(viewOrder.discount ? String(viewOrder.discount) : "");
    // Extract delivery address and notes from notes field
    const rawNotes = viewOrder.notes || "";
    const addressMatch = rawNotes.match(/^📍 Entrega: (.+?)(\n|$)/);
    if (addressMatch) {
      setDeliveryAddress(addressMatch[1]);
      setNotes(rawNotes.replace(/^📍 Entrega: .+?\n?/, ""));
    } else {
      setDeliveryAddress("");
      setNotes(rawNotes);
    }
    setShipping(String((viewOrder as unknown as { shipping?: number }).shipping ?? 0));
    // Load existing items into lines
    if (viewItems.length > 0) {
      setLines(loadedLines);
    } else {
      setLines([newLine()]);
    }
    setEditMode(true);
  };

  // Queries
  const workflowAvailability = useQuery({
    queryKey: ["sales_workflow_available", profile?.tenant_id],
    queryFn: async () => {
      const { error } = await supabase.from("orders").select("ship_by_at, internal_due_at").limit(0);
      if (error) {
        if (isMissingDatabaseStructure(error)) return false;
        throw new Error(error.message);
      }
      return true;
    },
    enabled: !!profile?.tenant_id,
    retry: false,
  });
  const workflowAvailable = workflowAvailability.data === true;
  const nextAction = (order: { status: string; workflow_issues?: unknown }) => !workflowAvailable && ["draft", "approved"].includes(order.status)
    ? order.status === "draft" ? "Conferir e aprovar" : "Produzir ou atender com estoque"
    : salesOrderNextAction(order);
  const { data: orders = [], isLoading, error: ordersError, refetch } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      return readProductionRows((from, to) => supabase.from("orders").select("*, customers(name, address, phone, email, document)").order("created_at", { ascending: false }).order("id").range(from, to));
    },
    enabled: !!profile,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "order-select"],
    queryFn: async () => {
      return readProductionRows((from, to) => supabase.from("customers").select("id, name, address, phone, email").eq("is_active", true).order("name").order("id").range(from, to));
    },
    enabled: !!profile,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products_for_orders"],
    queryFn: async () => {
      return readProductionRows((from, to) => supabase.from("products").select("id, name, sku, sale_price, cost_estimate, stock_item_id").eq("is_active", true).order("name").order("id").range(from, to));
    },
    enabled: !!profile,
  });

  // Order items for viewing
  const { data: viewItems = [], isLoading: itemsLoading, error: itemsError } = useQuery({
    queryKey: ["order_items", viewOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from("order_items").select("*, products(name, photo_url)").eq("order_id", viewOrderId!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!viewOrderId,
  });

  // Jobs linked to this order
  const { data: linkedJobs = [], isLoading: linkedLoading, error: linkedError } = useQuery({
    queryKey: ["order_jobs", viewOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("id, code, name, status, est_total_cost, actual_total_cost").eq("order_id", viewOrderId!).order("code");
      if (error) throw error;
      return data;
    },
    enabled: !!viewOrderId,
  });

  const selectCustomer = (id: string) => {
    setCustomerId(id);
    const customer = customers.find(value => value.id === id);
    const address = customer?.address;
    if (typeof address === "string") setDeliveryAddress(address);
    else if (address && typeof address === "object" && !Array.isArray(address)) {
      setDeliveryAddress([address.street, address.number, address.complement, address.neighborhood, address.city, address.state, address.zip].filter(Boolean).join(", "));
    } else setDeliveryAddress("");
  };

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== "all") list = list.filter((o: any) => o.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((o: any) => o.code.toLowerCase().includes(s) || o.customers?.name?.toLowerCase().includes(s));
    }
    return list;
  }, [orders, statusFilter, search]);

  // Line item helpers
  const updateLine = (id: string, field: keyof OrderLineItem, value: any) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, [field]: value };
        if (field === "product_id" && value !== l.product_id) updated.material_overrides = [];
        if (field === "product_id" && value) {
          const prod = products.find((p) => p.id === value);
          if (prod) {
            updated.description = prod.name;
            updated.unit_price = prod.sale_price || 0;
            updated.total = updated.quantity * (prod.sale_price || 0);
          }
        }
        if (field === "quantity" || field === "unit_price") {
          const qty = field === "quantity" ? Number(value) : updated.quantity;
          const price = field === "unit_price" ? Number(value) : updated.unit_price;
          updated.total = qty * price;
        }
        return updated;
      })
    );
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.length > 1 ? prev.filter((l) => l.id !== id) : prev);
  };

  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const shippingVal = parseFloat(shipping) || 0;
  const discountNum = parseFloat(discountVal) || 0;
  const grandTotal = subtotal + shippingVal - discountNum;

  const invalidateOrder = () => {
    ["products", "inventory_items", "inventory_movements", "order_stock_allocations", "orders", "order_items", "order_jobs", "jobs", "fila_jobs", "accounts_receivable", "dre_ar", "marketplace_receivable_positions", "financial_ledger", "dashboard", "hoje", "daily_operations", "daily-operations", "production_orders", "production_order_items", "filament_planning", "filament-planning", "marketplace_orders", "capacity_data"].forEach(key => qc.invalidateQueries({ queryKey: [key] }));
  };
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const operationalDates = () => {
    const ship = operatingDateToIso(shipBy, "o prazo de postagem");
    let target = operatingDateToIso(internalDue, "a meta interna");
    if (ship && !target) {
      const hours = Number(bufferHours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 720) throw new Error("Informe uma folga entre 0 e 720 horas.");
      target = new Date(new Date(ship).getTime() - hours * 3_600_000).toISOString();
    }
    if (target && ship && target > ship) throw new Error("A meta interna deve ser anterior ao prazo de postagem.");
    return { ship_by_at: ship, internal_due_at: target };
  };
  const orderPayload = (id: string | null) => {
    if (!profile) throw new Error("Sua sessão expirou. Entre novamente.");
    const values = prepareOrder(lines, shipping, discountVal);
    return {
      p_order_id: id,
      p_order: { customer_id: customerId || null, due_date: dueDate || null, payment_due_date: paymentDueDate || null,
        ...(workflowAvailable ? operationalDates() : {}),
        total: values.total, discount: values.discount, shipping: values.shipping,
        notes: [deliveryAddress.trim() ? `📍 Entrega: ${deliveryAddress.trim()}` : "", notes.trim()].filter(Boolean).join("\n") || null },
      p_items: values.items,
    };
  };
  const saveOrder = async (id: string | null) => {
    const payload = orderPayload(id);
    saveRequest.current = orderRequest(saveRequest.current, JSON.stringify(payload));
    const { data, error } = await rpc("save_sales_order", { ...payload, p_request_id: saveRequest.current.id });
    if (error) throw new Error(error.message);
    return String(data);
  };
  const createMut = useMutation({
    mutationFn: () => saveOrder(null),
    onSuccess: (id) => {
      invalidateOrder(); setCreateOpen(false); resetForm(); setViewOrderId(id);
      toast({ title: "Pedido criado", description: "Itens, frete e total foram salvos juntos." });
    },
    onError: (error: Error) => toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });
  const confirmOrder = useMutation({
    mutationFn: async ({ id, form = false }: { id: string | null; form?: boolean }) => {
      if (!workflowAvailable) throw new Error("A organização automática ainda não está disponível. Salve o rascunho e use as ações de aprovação existentes.");
      const payload = form ? orderPayload(id) : { p_order_id: id, p_order: null, p_items: null };
      confirmRequest.current = orderRequest(confirmRequest.current, JSON.stringify(payload));
      const { data, error } = await rpc("confirm_sales_workflow", { ...payload, p_request_id: confirmRequest.current.id });
      if (error) throw new Error(error.message);
      return readSalesWorkflowResult(data);
    },
    onSuccess: result => {
      invalidateOrder(); confirmRequest.current = null; setCreateOpen(false); setEditMode(false); resetForm(); setViewOrderId(result.order_id);
      toast({ title: result.outcome === "needs_preparation" ? "Pedido salvo com pendências" : "Pedido organizado", description: result.outcome === "stock_ready" ? "Produtos separados do estoque. Próxima etapa: embalar e postar." : result.outcome === "production_queued" ? "Produção liberada para a fila, com a venda e o recebimento vinculados." : result.outcome === "needs_preparation" ? result.issues.join(" ") : "Acompanhe a próxima etapa do pedido." });
    },
    onError: (error: Error) => toast({ title: "Não foi possível confirmar", description: error.message, variant: "destructive" }),
  });
  const fulfillStock = useMutation({
    mutationFn: async () => { const { error } = await rpc("fulfill_order_from_stock", { p_order_id: stockOrderId }); if (error) throw new Error(error.message); },
    onSuccess: () => { invalidateOrder(); setStockOrderId(null); toast({ title: "Pedido atendido com estoque", description: "Estoque baixado e conta a receber registrada. O pedido está pronto para envio." }); },
    onError: (error: Error) => toast({ title: "Não foi possível atender", description: error.message, variant: "destructive" }),
  });
  const updateStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (status === "in_production") {
        const result = await rpc("request_production_order", { p_order_id: id, p_quote_id: null, p_request_id: crypto.randomUUID() });
        if (result.error) throw new Error(result.error.message);
        if (!result.data) throw new Error("A ordem de produção não foi confirmada.");
        return String(result.data);
      }
      const { error } = await rpc("transition_sales_order", { p_order_id: id, p_status: status });
      if (error) throw new Error(error.message);
    },
    onSuccess: (op) => { invalidateOrder(); if (op) { navigate(`/producao/ordens?op=${op}`); return; } toast({ title: "Venda atualizada" }); },
    onError: (error: Error) => toast({ title: "Não foi possível avançar", description: error.message, variant: "destructive" }),
  });
  const updateOrderMut = useMutation({
    mutationFn: () => saveOrder(viewOrderId),
    onSuccess: () => { invalidateOrder(); saveRequest.current = null; setEditMode(false); toast({ title: "Pedido atualizado" }); },
    onError: (error: Error) => toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }),
  });
  const updateDeadlines = useMutation({
    mutationFn: async () => {
      if (!workflowAvailable || !viewOrderId) throw new Error("A revisão de prazos ainda não está disponível.");
      const payload = { p_order_id: viewOrderId, p_dates: operationalDates(), p_reason: "Revisão do prazo de postagem e da meta interna na tela de pedidos" };
      deadlineRequest.current = orderRequest(deadlineRequest.current, JSON.stringify(payload));
      const { data, error } = await rpc("update_sales_order_deadlines", { ...payload, p_request_id: deadlineRequest.current.id });
      if (error) throw new Error(error.message);
      if (data !== viewOrderId) throw new Error("A revisão dos prazos não foi confirmada. Atualize o pedido antes de repetir.");
    },
    onSuccess: () => { invalidateOrder(); deadlineRequest.current = null; setEditingDeadlines(false); toast({ title: "Prazos atualizados", description: "A venda, a produção e o financeiro foram preservados. Simule a capacidade com os novos prazos." }); },
    onError: (error: Error) => toast({ title: "Não foi possível revisar os prazos", description: error.message, variant: "destructive" }),
  });
  const requestStatus = (id: string, status: string) => {
    if (updateStatusMut.isPending || confirmOrder.isPending || fulfillStock.isPending || updateDeadlines.isPending) return;
    if (status === "cancelled" && !window.confirm("Cancelar este pedido? O histórico será preservado. Pedidos com pagamentos ou produção iniciada exigem regularização antes do cancelamento.")) return;
    updateStatusMut.mutate({ id, status });
  };

  const totalValue = orders.filter(order => !["draft", "cancelled"].includes(order.status)).reduce((s: number, o: any) => s + (o.total || 0), 0);
  const openOrders = orders.filter((o: any) => !["delivered", "cancelled"].includes(o.status)).length;

  const viewOrder = viewOrderId ? orders.find((o: any) => o.id === viewOrderId) : null;
  const formPending = createMut.isPending || updateOrderMut.isPending || confirmOrder.isPending || updateDeadlines.isPending;
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const renderOperatingDates = () => workflowAvailable ? <section className="space-y-3 rounded-lg border bg-muted/20 p-3" aria-label="Prazo de postagem">
    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="order-ship-by">Postar até</Label><Input id="order-ship-by" type="datetime-local" value={shipBy} disabled={formPending} onChange={event => setShipBy(event.target.value)} /></div>
      <div><Label htmlFor="order-internal-due">Meta interna (opcional)</Label><Input id="order-internal-due" type="datetime-local" value={internalDue} disabled={formPending} onChange={event => setInternalDue(event.target.value)} /></div>
    </div>
    {!internalDue && <div className="flex flex-wrap items-center gap-2"><Label htmlFor="order-buffer">Folga antes da postagem (horas)</Label><Input className="w-24" id="order-buffer" type="number" min="0" max="720" value={bufferHours} disabled={formPending} onChange={event => setBufferHours(event.target.value)} /></div>}
    <p className="text-xs text-muted-foreground">Horários em {localTimezone}. A meta interna usa a folga quando não é informada. A data de entrega ao cliente continua separada. <Link className="text-primary underline" to="/planejamento/capacidade">Simule a capacidade antes de prometer o prazo.</Link></p>
  </section> : null;

  const renderLineItems = (pending: boolean) => <div className="min-w-0 sm:overflow-hidden sm:rounded-lg sm:border">
    <Table aria-label="Itens editáveis do pedido" className="block min-w-0 sm:table">
      <TableHeader className="hidden sm:table-header-group"><TableRow className="bg-muted/50">
        <TableHead className="w-[40%]">Produto / Descrição</TableHead><TableHead className="w-[80px] text-center">Qtd</TableHead><TableHead className="w-[120px] text-right">Unitário</TableHead><TableHead className="w-[120px] text-right">Total</TableHead><TableHead className="w-10" />
      </TableRow></TableHeader>
      {lines.map((line, index) => <TableBody key={line.id} aria-label={`Item ${index + 1} do pedido`} className="mb-3 block min-w-0 rounded-lg border bg-card p-3 last:mb-0 sm:mb-0 sm:table-row-group sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
        <TableRow className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-0 hover:bg-transparent sm:table-row sm:border-b sm:hover:bg-muted/50">
          <TableCell className="col-span-2 block min-w-0 p-0 sm:table-cell sm:p-1.5">
            <span className="mb-1.5 block text-xs font-medium sm:hidden">Item {index + 1} · Produto</span>
            <SearchableItemSelect value={line.product_id} label={`Produto do item ${index + 1}`} emptyLabel="Personalizado" searchPlaceholder="Digite nome ou SKU do produto…" disabled={pending} onChange={value => updateLine(line.id, "product_id", value)} options={products.map(product => ({ id: product.id, label: product.name, description: [product.sku, product.sale_price != null ? fmtCurrency(product.sale_price) : "Preço a definir"].filter(Boolean).join(" · ") }))} />
            {!line.product_id && <Input aria-label={`Descrição do item ${index + 1}`} className="mt-1 h-11 min-w-0 text-sm sm:h-10" value={line.description} disabled={pending} onChange={event => updateLine(line.id, "description", event.target.value)} placeholder="Descrição do item" />}
          </TableCell>
          <TableCell className="block min-w-0 p-0 sm:table-cell sm:p-1.5"><label className="block"><span className="mb-1.5 block text-xs font-medium sm:hidden">Quantidade</span><Input aria-label={`Quantidade do item ${index + 1}`} type="number" inputMode="numeric" min={1} className="h-11 min-w-0 text-sm sm:h-10 sm:text-center" value={line.quantity} disabled={pending} onChange={event => updateLine(line.id, "quantity", event.target.value)} /></label></TableCell>
          <TableCell className="block min-w-0 p-0 sm:table-cell sm:p-1.5"><label className="block"><span className="mb-1.5 block text-xs font-medium sm:hidden">Preço unitário (R$)</span><Input aria-label={`Preço unitário do item ${index + 1}`} type="number" inputMode="decimal" step="0.01" className="h-11 min-w-0 text-sm sm:h-10 sm:text-right" value={line.unit_price} disabled={pending} onChange={event => updateLine(line.id, "unit_price", event.target.value)} /></label></TableCell>
          <TableCell className="flex min-w-0 flex-col justify-center p-0 text-sm font-medium sm:table-cell sm:p-1.5 sm:text-right sm:text-xs"><span className="text-xs text-muted-foreground sm:hidden">Total do item</span><output aria-label={`Total do item ${index + 1}`} className="break-words font-mono">{fmtCurrency(line.total)}</output></TableCell>
          <TableCell className="block min-w-0 p-0 text-right sm:table-cell sm:p-1.5"><Button type="button" variant="ghost" className="h-11 gap-1 px-2 sm:h-10 sm:w-10 sm:p-0" aria-label={`Remover item ${index + 1}`} disabled={pending || lines.length <= 1} onClick={() => removeLine(line.id)}><X className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs sm:hidden">Remover</span></Button></TableCell>
        </TableRow>
        {line.product_id && <TableRow className="mt-3 block min-w-0 border-0 hover:bg-transparent sm:mt-0 sm:table-row sm:hover:bg-muted/50"><TableCell colSpan={5} className="block min-w-0 border-t p-0 pt-3 sm:table-cell sm:border-0 sm:p-3">{products.find(p => p.id === line.product_id)?.stock_item_id ? <div className="space-y-2"><p className="text-sm">{workflowAvailable ? <>Use <strong>Confirmar e organizar</strong> para atender com produtos prontos quando houver saldo suficiente; os itens sob encomenda seguem pela produção.</> : <>Salve o rascunho e use <strong>Atender com estoque</strong> quando houver produtos prontos suficientes.</>}</p><details><summary className="cursor-pointer text-sm text-primary">Configurar produção sob encomenda (opcional)</summary><ProductMaterialChoice key={line.product_id} productId={line.product_id} tenantId={profile?.tenant_id} quantity={Number(line.quantity)} unitPrice={Number.isFinite(Number(line.unit_price)) ? Number(line.unit_price) : null} overrides={line.material_overrides} onChange={value => updateLine(line.id, "material_overrides", value)} onUnitPriceChange={value => updateLine(line.id, "unit_price", value)} disabled={pending} /></details></div> : <ProductMaterialChoice key={line.product_id} productId={line.product_id} tenantId={profile?.tenant_id} quantity={Number(line.quantity)} unitPrice={Number.isFinite(Number(line.unit_price)) ? Number(line.unit_price) : null} overrides={line.material_overrides} onChange={value => updateLine(line.id, "material_overrides", value)} onUnitPriceChange={value => updateLine(line.id, "unit_price", value)} disabled={pending} />}</TableCell></TableRow>}
      </TableBody>)}
    </Table>
  </div>;

  if (ordersError) return <div className="space-y-4 rounded-xl border bg-card p-6"><p role="alert">Não foi possível carregar os pedidos. {ordersError.message}</p><Button variant="outline" onClick={() => refetch()}>Tentar novamente</Button></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Dialog open={!!stockOrderId} onOpenChange={v => !v && !fulfillStock.isPending && setStockOrderId(null)}><DialogContent closeDisabled={fulfillStock.isPending}><DialogHeader><DialogTitle>Atender pedido com estoque?</DialogTitle><DialogDescription>Usa os produtos já disponíveis, baixa as quantidades e registra o valor a receber. Não exige composição nem gera ordens de impressão.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={fulfillStock.isPending} onClick={() => setStockOrderId(null)}>Voltar</Button><Button disabled={fulfillStock.isPending} onClick={() => fulfillStock.mutate()}>{fulfillStock.isPending ? "Processando…" : "Confirmar atendimento"}</Button></DialogFooter></DialogContent></Dialog>
      <DeleteRecordDialog key={deleteTarget?.id} target={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => setViewOrderId(null)} />
      <PageHeader title="Pedidos" description="Confira o prazo e a próxima ação de cada venda."
        breadcrumbs={[{ label: "Comercial" }, { label: "Pedidos" }]}
        actions={<Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Novo pedido</Button>}
      />
      {workflowAvailability.data === false && <p className="rounded-lg border bg-muted/30 p-3 text-sm">Organização automática de pedidos ainda não disponível. Salve o rascunho e use as ações de aprovação existentes.</p>}
      {workflowAvailability.error && <div className="rounded-lg border border-destructive/30 p-3 text-sm"><p role="alert">Não foi possível verificar a organização automática. {workflowAvailability.error.message}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => workflowAvailability.refetch()}>Verificar novamente</Button></div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Total de Pedidos</p><p className="text-2xl font-bold text-foreground">{orders.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Em Aberto</p><p className="text-2xl font-bold text-foreground">{openOrders}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Vendas confirmadas</p><p className="text-2xl font-bold text-foreground">{fmtCurrency(totalValue)}</p></div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por código ou cliente…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhum pedido encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Código</TableHead><TableHead>Cliente</TableHead><TableHead>Status</TableHead>
              <TableHead>Prazo</TableHead><TableHead>Próxima ação</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((o: any) => {
                const cfg = statusConfig[o.status] || statusConfig.draft;
                return (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setViewOrderId(o.id)}>
                    <TableCell className="font-mono text-sm font-medium">{o.code}</TableCell>
                    <TableCell className="text-sm">{o.customers?.name || "—"}</TableCell>
                    <TableCell><span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cfg.color)}>{cfg.label}</span></TableCell>
                    <TableCell className="text-sm">{o.ship_by_at ? <><span className="block">Postar {new Date(o.ship_by_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>{o.internal_due_at && <span className="block text-xs text-muted-foreground">Meta {new Date(o.internal_due_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>}</> : o.due_date ? `Entrega ${new Date(o.due_date + "T00:00:00").toLocaleDateString("pt-BR")}` : "Prazo a informar"}</TableCell>
                    <TableCell className="text-sm">{nextAction(o)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(o.total)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Ações"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {workflowAvailable && ["draft", "approved"].includes(o.status) && <DropdownMenuItem disabled={confirmOrder.isPending} onClick={event => { event.stopPropagation(); confirmOrder.mutate({ id: o.id }); }}><CheckCircle2 className="mr-2 h-3.5 w-3.5" />Confirmar e organizar</DropdownMenuItem>}
                          {["draft", "approved"].includes(o.status) && <DropdownMenuItem onClick={() => setStockOrderId(o.id)}><Package className="mr-2 h-3.5 w-3.5" />Atender com estoque</DropdownMenuItem>}
                          {o.status === "draft" && <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => requestStatus(o.id, "approved")}><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Aprovar</DropdownMenuItem>}
                          {o.status === "approved" && <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => requestStatus(o.id, "in_production")}><Clock className="h-3.5 w-3.5 mr-2" /> Produzir</DropdownMenuItem>}
                          {o.status === "in_production" && <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => requestStatus(o.id, "ready")}><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Pronto</DropdownMenuItem>}
                          {o.status === "ready" && <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => requestStatus(o.id, "shipped")}><Truck className="h-3.5 w-3.5 mr-2" /> Enviar</DropdownMenuItem>}
                          {o.status === "shipped" && <DropdownMenuItem disabled={updateStatusMut.isPending} onClick={() => requestStatus(o.id, "delivered")}><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Entregue</DropdownMenuItem>}
                          {o.status !== "draft" && (
                            <DropdownMenuItem onClick={() => navigate(`/financeiro/receber?pedido=${o.code}`)}>
                              <DollarSign className="h-3.5 w-3.5 mr-2" /> Ver no Financeiro
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {["draft", "cancelled"].includes(o.status) && <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); setDeleteTarget({ id: o.id, name: o.code, kind: "order" }); }}><Trash2 className="mr-2 h-3.5 w-3.5" />Excluir pedido</DropdownMenuItem>}
                          {(salesOrderTransitions[o.status] ?? []).includes("cancelled") && <DropdownMenuItem className="text-destructive" disabled={updateStatusMut.isPending} onClick={(event) => { event.stopPropagation(); requestStatus(o.id, "cancelled"); }}><X className="h-3.5 w-3.5 mr-2" /> Cancelar pedido</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </div>

      {/* CREATE ORDER DIALOG */}
      <Dialog open={createOpen} onOpenChange={open => { if (!formPending) setCreateOpen(open); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col w-[95vw] sm:w-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-primary" /> Novo pedido</DialogTitle>
            <DialogDescription>{workflowAvailable ? "Informe os itens e o prazo. Confirme para usar estoque pronto ou organizar a produção; você também pode salvar um rascunho." : "Informe os itens e salve o rascunho. Depois, siga as ações de aprovação e produção do pedido."}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            {/* Customer + Date */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Cliente · necessário para confirmar</Label>
                <SearchableItemSelect label="Cliente do pedido" value={customerId} disabled={formPending} onChange={selectCustomer} emptyLabel="Sem cliente" searchPlaceholder="Digite o nome do cliente…" options={customers.map(c => ({ id: c.id, label: c.name }))} />
              </div>
              <div>
                <Label htmlFor="order-delivery-date">Data de Entrega</Label>
                <Input id="order-delivery-date" disabled={formPending} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="order-payment-due">Receber em · necessário para confirmar</Label>
                <Input id="order-payment-due" disabled={formPending} type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
              </div>
            </div>
            {renderOperatingDates()}

            {/* Delivery address */}
            <div>
              <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Endereço de Entrega</Label>
              <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Rua, número, bairro, cidade - UF, CEP" />
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens do pedido</Label>
                <Button type="button" variant="outline" size="sm" className="h-11 text-xs sm:h-7" aria-label="Adicionar item ao pedido" onClick={() => setLines((prev) => [...prev, newLine()])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Item
                </Button>
              </div>

              {renderLineItems(formPending)}
            </div>

            {/* Totals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Observações</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Condições de pagamento, prazo, etc." />
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Frete (R$)</Label><Input type="number" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0,00" /></div>
                  <div><Label className="text-xs">Desconto (R$)</Label><Input type="number" step="0.01" value={discountVal} onChange={(e) => setDiscountVal(e.target.value)} placeholder="0,00" /></div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Subtotal ({lines.filter((l) => l.description || l.product_id).length} itens)</span>
                    <span className="font-mono">{fmtCurrency(subtotal)}</span>
                  </div>
                  {shippingVal > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Frete</span><span className="font-mono">+ {fmtCurrency(shippingVal)}</span>
                    </div>
                  )}
                  {discountNum > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Desconto</span><span className="font-mono text-destructive">- {fmtCurrency(discountNum)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold text-foreground border-t pt-1.5">
                    <span>Total</span><span className="font-mono">{fmtCurrency(grandTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" disabled={formPending} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button variant="outline" onClick={() => createMut.mutate()} disabled={formPending} title="Salvar como rascunho">
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar pedido
            </Button>
            {workflowAvailable && <Button onClick={() => confirmOrder.mutate({ id: null, form: true })} disabled={formPending}>
              {confirmOrder.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirmar e organizar
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VIEW / EDIT ORDER DIALOG */}
      <Dialog open={!!viewOrderId} onOpenChange={(o) => { if (!o && !formPending) { setViewOrderId(null); setEditMode(false); setEditingDeadlines(false); } }}>
        <DialogContent className={cn("w-[95vw] sm:w-auto", editMode ? "max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" : "max-w-2xl max-h-[90dvh] overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {viewOrder?.code || "Pedido"}
              {editMode && <span className="text-xs font-normal text-muted-foreground ml-1">— Editando</span>}
            </DialogTitle>
            <DialogDescription>{editMode ? "Edite os produtos, as cores e os valores deste rascunho." : "Confira os itens, a composição escolhida e o andamento da venda."}</DialogDescription>
          </DialogHeader>

          {viewOrder && !editMode && (
            <div className="space-y-4">
              <section className="space-y-2 rounded-lg border bg-primary/5 p-3"><p className="text-sm font-semibold">Próxima ação: {nextAction(viewOrder)}</p>
                {Array.isArray((viewOrder as unknown as { workflow_issues?: unknown }).workflow_issues) && ((viewOrder as unknown as { workflow_issues: string[] }).workflow_issues).length > 0 && <ul className="list-inside list-disc text-sm text-amber-800">{(viewOrder as unknown as { workflow_issues: string[] }).workflow_issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
                {workflowAvailable && ["draft", "approved"].includes(viewOrder.status) && <Button disabled={formPending || editingDeadlines || itemsLoading || !!itemsError || updateStatusMut.isPending} onClick={() => confirmOrder.mutate({ id: viewOrder.id })}>{confirmOrder.isPending ? "Organizando…" : "Confirmar e organizar"}</Button>}
                {Array.isArray((viewOrder as unknown as { workflow_issues?: unknown }).workflow_issues) && (viewOrder as unknown as { workflow_issues: string[] }).workflow_issues.length > 0 && <div className="flex flex-wrap gap-2">{viewItems.filter(item => item.product_id).map(item => <Button key={item.id} variant="outline" size="sm" asChild><Link to={`/comercial/produtos?produto=${item.product_id}`}>Preparar {item.description}</Link></Button>)}</div>}
                {viewOrder.status === "in_production" && <Button variant="outline" asChild><Link to="/planejamento/fila">Acompanhar produção</Link></Button>}
                {viewOrder.status === "ready" && <Button disabled={updateStatusMut.isPending} onClick={() => requestStatus(viewOrder.id, "shipped")}>Confirmar postagem</Button>}
                {viewOrder.status === "shipped" && <Button disabled={updateStatusMut.isPending} onClick={() => requestStatus(viewOrder.id, "delivered")}>Confirmar entrega</Button>}
              </section>
              {workflowAvailable && ["draft", "approved", "in_production", "ready"].includes(viewOrder.status) && <section className="space-y-3">
                {editingDeadlines ? <>{renderOperatingDates()}<div className="flex gap-2"><Button variant="outline" disabled={formPending} onClick={() => setEditingDeadlines(false)}>Cancelar revisão de prazos</Button><Button disabled={formPending || updateStatusMut.isPending} onClick={() => updateDeadlines.mutate()}>{updateDeadlines.isPending ? "Salvando…" : "Salvar prazos"}</Button></div></> : <Button variant="outline" size="sm" disabled={formPending || updateStatusMut.isPending} onClick={() => { deadlineRequest.current = null; setShipBy(operatingDateInput(viewOrder.ship_by_at)); setInternalDue(operatingDateInput(viewOrder.internal_due_at)); setBufferHours("24"); setEditingDeadlines(true); }}>Revisar prazos</Button>}
              </section>}
              {viewOrder.source_quote_id && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">Venda originada de orçamento aprovado. Os preços, materiais e cores combinados estão preservados. <Link className="text-primary underline" to="/comercial/orcamentos">Ver orçamentos</Link></div>}
              {/* ── Status editável ── */}
              {(() => {
                const cfg = statusConfig[viewOrder.status] || statusConfig.draft;
                return (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">Status do Pedido</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={viewOrder.status}
                        onValueChange={(nextStatus) => {
                          if (nextStatus !== viewOrder.status) {
                            requestStatus(viewOrder.id, nextStatus);
                          }
                        }}
                      >
                        <SelectTrigger className="w-[220px]" disabled={updateStatusMut.isPending}>
                          <SelectValue placeholder="Selecione o status" />
                        </SelectTrigger>
                        <SelectContent>
                          {[viewOrder.status, ...(salesOrderTransitions[viewOrder.status] ?? [])].map(status => (
                            <SelectItem key={status} value={status}>{statusConfig[status].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cfg.color)}>
                        {cfg.label}
                      </span>
                      {updateStatusMut.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{(viewOrder as any).customers?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Data de Entrega</p>
                  <p className="font-medium">{viewOrder.due_date ? new Date(viewOrder.due_date + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vencimento Financeiro</p>
                  <p className="font-medium">{(viewOrder as any).payment_due_date ? new Date((viewOrder as any).payment_due_date + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p>
                </div>
              </div>
              {(viewOrder as unknown as { ship_by_at?: string }).ship_by_at && <div className="rounded-lg border p-3 text-sm"><p>Postar até: <strong>{new Date((viewOrder as unknown as { ship_by_at: string }).ship_by_at).toLocaleString("pt-BR")}</strong></p>{(viewOrder as unknown as { internal_due_at?: string }).internal_due_at && <p>Meta interna: {new Date((viewOrder as unknown as { internal_due_at: string }).internal_due_at).toLocaleString("pt-BR")}</p>}<p className="mt-1 text-xs text-muted-foreground">Horários em {localTimezone}.</p></div>}

              {viewOrder.notes && (
                <div className="text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Observações</p>
                  <p className="whitespace-pre-line text-foreground">{viewOrder.notes}</p>
                </div>
              )}

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center w-20">Qtd</TableHead>
                      <TableHead className="text-right w-28">Unitário</TableHead>
                      <TableHead className="text-right w-28">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsLoading || itemsError ? <TableRow><TableCell colSpan={4} role={itemsError ? "alert" : "status"}>{itemsError ? "Não foi possível carregar os itens. Tente abrir novamente." : "Carregando itens..."}</TableCell></TableRow> : viewItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          <Package className="h-6 w-6 mx-auto mb-1 opacity-40" />
                          <p className="text-xs">Nenhum item registrado</p>
                        </TableCell>
                      </TableRow>
                    ) : viewItems.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{item.description}</p>
                          {item.product_snapshot && <QuoteSnapshotSummary snapshot={item.product_snapshot} quantity={item.quantity} />}
                          {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                        </TableCell>
                        <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtCurrency(item.unit_price)}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">{fmtCurrency(item.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Linked Jobs */}
              {linkedJobs.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
                    <span>Ordens de Impressão ({linkedJobs.length})</span>
                    <Link to="/producao/jobs" className="text-primary text-[11px] hover:underline flex items-center gap-1 normal-case font-medium" onClick={() => setViewOrderId(null)}>
                      Ver na Produção <ArrowRight className="w-3 h-3" />
                    </Link>
                  </p>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Código</TableHead>
                          <TableHead>Peça</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Custo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linkedJobs.map((j: any) => {
                          const jCfg = { draft: "bg-muted text-muted-foreground", queued: "bg-primary/10 text-primary", printing: "bg-emerald-100 text-emerald-700", completed: "bg-emerald-100 text-emerald-700", failed: "bg-destructive/10 text-destructive" } as Record<string, string>;
                          const statusLabels: Record<string, string> = { draft: "Rascunho", queued: "Na fila", printing: "Imprimindo", paused: "Pausado", failed: "Falhou", reprint: "Reimpressão", post_processing: "Pós-processo", quality_check: "QC", ready: "Pronto", shipped: "Enviado", completed: "Concluído" };
                          return (
                            <TableRow key={j.id}>
                              <TableCell className="font-mono text-xs">{j.code}</TableCell>
                              <TableCell className="text-sm">{j.name}</TableCell>
                              <TableCell>
                                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", jCfg[j.status] || "bg-muted text-muted-foreground")}>
                                  {statusLabels[j.status] || j.status}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">{j.actual_total_cost == null ? `${fmtCurrency(j.est_total_cost)} (est.)` : fmtCurrency(j.actual_total_cost)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
                <div className="flex flex-wrap gap-2">
                  {["draft", "approved"].includes(viewOrder.status) && <Button variant="outline" disabled={formPending || updateStatusMut.isPending} onClick={() => setStockOrderId(viewOrder.id)}><Package className="mr-2 h-4 w-4" />Atender com estoque</Button>}
                  <CommercialPdfButton document={orderDocument(viewOrder, viewItems)} tenantId={profile?.tenant_id} orderId={viewOrder.id} sourceQuoteId={viewOrder.source_quote_id} disabled={itemsLoading || !!itemsError} />
                  {viewOrder.status === "draft" && !viewOrder.source_quote_id && linkedJobs.length === 0 && <Button variant="outline" size="sm" disabled={itemsLoading || !!itemsError || linkedLoading || !!linkedError} onClick={startEdit}>
                    <Pencil className="h-4 w-4 mr-1" /> Editar rascunho
                  </Button>}
                </div>
                <div className="w-full sm:w-64 space-y-1 text-sm">
                  {Number((viewOrder as unknown as { shipping?: number }).shipping ?? 0) > 0 && <div className="flex justify-between text-muted-foreground"><span>Frete</span><span>{fmtCurrency(Number((viewOrder as unknown as { shipping?: number }).shipping))}</span></div>}
                  {viewOrder.discount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Desconto</span><span className="font-mono text-destructive">- {fmtCurrency(viewOrder.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold text-foreground border-t pt-1">
                    <span>Total</span><span className="font-mono">{fmtCurrency(viewOrder.total)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* EDIT MODE */}
          {viewOrder && editMode && (
            <div className="flex-1 overflow-y-auto space-y-5 pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Cliente</Label>
                  <SearchableItemSelect label="Cliente do pedido" value={customerId} onChange={selectCustomer} emptyLabel="Sem cliente" searchPlaceholder="Digite o nome do cliente…" options={customers.map(c => ({ id: c.id, label: c.name }))} />
                </div>
                <div>
                  <Label htmlFor="order-delivery-date">Data de Entrega</Label>
                  <Input id="order-delivery-date" disabled={formPending} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="order-payment-due">Receber em · necessário para confirmar</Label>
                  <Input id="order-payment-due" disabled={formPending} type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
                </div>
              </div>
              {renderOperatingDates()}
              <div>
                <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Endereço de Entrega</Label>
                <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Rua, número, bairro, cidade - UF, CEP" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens do pedido</Label>
                  <Button type="button" variant="outline" size="sm" className="h-11 text-xs sm:h-7" aria-label="Adicionar item ao pedido" onClick={() => setLines((prev) => [...prev, newLine()])}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Item
                  </Button>
                </div>
                {renderLineItems(formPending)}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Observações</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Condições de pagamento, prazo, etc." />
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Frete (R$)</Label><Input type="number" step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0,00" /></div>
                    <div><Label className="text-xs">Desconto (R$)</Label><Input type="number" step="0.01" value={discountVal} onChange={(e) => setDiscountVal(e.target.value)} placeholder="0,00" /></div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Subtotal ({lines.filter((l) => l.description || l.product_id).length} itens)</span>
                      <span className="font-mono">{fmtCurrency(subtotal)}</span>
                    </div>
                    {shippingVal > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Frete</span><span className="font-mono">+ {fmtCurrency(shippingVal)}</span>
                      </div>
                    )}
                    {discountNum > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Desconto</span><span className="font-mono text-destructive">- {fmtCurrency(discountNum)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold text-foreground border-t pt-1.5">
                      <span>Total</span><span className="font-mono">{fmtCurrency(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" disabled={formPending} onClick={() => setEditMode(false)}>Cancelar</Button>
                <Button variant="outline" onClick={() => updateOrderMut.mutate()} disabled={formPending}>
                  {updateOrderMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar Alterações
                </Button>
                {workflowAvailable && <Button onClick={() => confirmOrder.mutate({ id: viewOrder.id, form: true })} disabled={formPending}>{confirmOrder.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirmar e organizar</Button>}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
