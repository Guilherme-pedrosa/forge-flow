import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, FileText, Loader2, Trash2, CheckCircle2, Clock, Truck,
  ShoppingCart, MapPin, X, Package, Printer,
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
});

export default function Pedidos() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);

  // Form state
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [shipping, setShipping] = useState("");
  const [discountVal, setDiscountVal] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [lines, setLines] = useState<OrderLineItem[]>([newLine()]);

  const resetForm = () => {
    setCustomerId(""); setDueDate(""); setNotes(""); setShipping(""); setDiscountVal("");
    setDeliveryAddress(""); setLines([newLine()]);
  };

  // Queries
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("*, customers(name, address, phone, email, document)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name, address, phone, email").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products_for_orders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, name, sku, sale_price, cost_estimate").eq("is_active", true).order("name");
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

  // Order items for viewing
  const { data: viewItems = [] } = useQuery({
    queryKey: ["order_items", viewOrderId],
    queryFn: async () => {
      const { data, error } = await supabase.from("order_items").select("*, products(name)").eq("order_id", viewOrderId!).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!viewOrderId,
  });

  // Auto-fill address when customer changes
  useEffect(() => {
    if (customerId) {
      const c = customers.find((c) => c.id === customerId);
      if (c?.address) {
        const a = c.address as any;
        const parts = [a.street, a.number, a.complement, a.neighborhood, a.city, a.state, a.zip].filter(Boolean);
        setDeliveryAddress(parts.join(", ") || (typeof a === "string" ? a : ""));
      }
    }
  }, [customerId, customers]);

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

  // Print PDF
  const handlePrint = () => {
    if (!printRef.current) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const tenantSettings = (tenant?.settings as any) || {};
    const addr = tenantSettings.address || {};
    const companyAddress = [addr.street, addr.number, addr.complement, addr.neighborhood, addr.city, addr.state, addr.zip].filter(Boolean).join(", ");

    const viewOrder = orders.find((o: any) => o.id === viewOrderId);
    if (!viewOrder) return;

    const cfg = statusConfig[viewOrder.status] || statusConfig.draft;
    const customerName = (viewOrder as any).customers?.name || "—";

    const itemsHtml = viewItems.map((item: any) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${item.description}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">${fmtCurrency(item.unit_price)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:600;">${fmtCurrency(item.total)}</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${viewOrder.code}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1a1a1a; padding:40px; max-width:800px; margin:0 auto; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; padding-bottom:24px; border-bottom:2px solid #1a1a1a; }
  .company-info { flex:1; }
  .company-name { font-size:20px; font-weight:700; margin-bottom:4px; }
  .company-detail { font-size:11px; color:#666; line-height:1.6; }
  .logo { max-height:64px; max-width:160px; object-fit:contain; }
  .doc-title { text-align:center; margin:24px 0; }
  .doc-title h1 { font-size:18px; font-weight:700; letter-spacing:1px; }
  .doc-title .badge { display:inline-block; margin-top:6px; padding:3px 12px; border-radius:20px; font-size:11px; font-weight:600; background:#f3f4f6; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .info-block label { display:block; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:#888; margin-bottom:2px; }
  .info-block p { font-size:13px; font-weight:500; }
  .notes { background:#f9fafb; border-radius:8px; padding:12px 16px; margin-bottom:24px; font-size:12px; white-space:pre-line; line-height:1.6; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  thead th { background:#f3f4f6; padding:8px 12px; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; text-align:left; border-bottom:2px solid #d1d5db; }
  .totals { display:flex; justify-content:flex-end; margin-bottom:32px; }
  .totals-box { width:260px; }
  .totals-row { display:flex; justify-content:space-between; padding:4px 0; font-size:13px; }
  .totals-row.total { border-top:2px solid #1a1a1a; padding-top:8px; margin-top:4px; font-weight:700; font-size:15px; }
  .totals-row.discount { color:#dc2626; }
  .footer { text-align:center; padding-top:24px; border-top:1px solid #e5e7eb; font-size:10px; color:#999; }
  @media print { body { padding:20px; } }
</style></head><body>
  <div class="header">
    <div class="company-info">
      <div class="company-name">${tenant?.name || "Empresa"}</div>
      ${tenantSettings.cnpj ? `<div class="company-detail">CNPJ: ${tenantSettings.cnpj}</div>` : ""}
      ${tenantSettings.phone ? `<div class="company-detail">Tel: ${tenantSettings.phone}</div>` : ""}
      ${tenantSettings.email ? `<div class="company-detail">${tenantSettings.email}</div>` : ""}
      ${companyAddress ? `<div class="company-detail">${companyAddress}</div>` : ""}
    </div>
    ${tenant?.logo_url ? `<img src="${tenant.logo_url}" class="logo" />` : ""}
  </div>

  <div class="doc-title">
    <h1>${viewOrder.code}</h1>
    <span class="badge">${cfg.label}</span>
  </div>

  <div class="info-grid">
    <div class="info-block"><label>Cliente</label><p>${customerName}</p></div>
    <div class="info-block"><label>Data de Entrega</label><p>${viewOrder.due_date ? new Date(viewOrder.due_date + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p></div>
    <div class="info-block"><label>Data de Emissão</label><p>${new Date(viewOrder.created_at).toLocaleDateString("pt-BR")}</p></div>
  </div>

  ${viewOrder.notes ? `<div class="notes">${viewOrder.notes}</div>` : ""}

  <table>
    <thead><tr>
      <th>Item</th><th style="text-align:center;width:80px;">Qtd</th><th style="text-align:right;width:120px;">Unitário</th><th style="text-align:right;width:120px;">Total</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      ${viewOrder.discount > 0 ? `<div class="totals-row discount"><span>Desconto</span><span>- ${fmtCurrency(viewOrder.discount)}</span></div>` : ""}
      <div class="totals-row total"><span>Total</span><span>${fmtCurrency(viewOrder.total)}</span></div>
    </div>
  </div>

  <div class="footer">Documento gerado em ${new Date().toLocaleString("pt-BR")}</div>
</body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  };

  // Mutations
  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      if (lines.every((l) => !l.description)) throw new Error("Adicione pelo menos um item");

      const code = `ORC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(orders.length + 1).padStart(3, "0")}`;
      const { data: order, error } = await supabase.from("orders").insert({
        tenant_id: profile.tenant_id, code, customer_id: customerId || null,
        due_date: dueDate || null, total: grandTotal, discount: discountNum,
        notes: [deliveryAddress ? `📍 Entrega: ${deliveryAddress}` : "", notes].filter(Boolean).join("\n") || null,
        created_by: profile.user_id,
      }).select("id").single();
      if (error) throw error;

      const validLines = lines.filter((l) => l.description);
      if (validLines.length > 0) {
        const { error: itemsErr } = await supabase.from("order_items").insert(
          validLines.map((l) => ({
            tenant_id: profile.tenant_id,
            order_id: order.id,
            product_id: l.product_id || null,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            total: l.total,
            notes: l.notes || null,
          }))
        );
        if (itemsErr) throw itemsErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      setCreateOpen(false); resetForm();
      toast({ title: "Orçamento criado com sucesso" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === "approved") updates.approved_at = new Date().toISOString();
      const { error } = await supabase.from("orders").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast({ title: "Status atualizado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("order_items").delete().eq("order_id", id);
      const { error } = await supabase.from("orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); toast({ title: "Pedido removido" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const totalValue = orders.reduce((s: number, o: any) => s + (o.total || 0), 0);
  const openOrders = orders.filter((o: any) => !["delivered", "cancelled"].includes(o.status)).length;

  const viewOrder = viewOrderId ? orders.find((o: any) => o.id === viewOrderId) : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Pedidos / Orçamentos" description="Gestão de orçamentos e pedidos de clientes"
        breadcrumbs={[{ label: "Comercial" }, { label: "Pedidos" }]}
        actions={<Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Orçamento</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Total de Pedidos</p><p className="text-2xl font-bold text-foreground">{orders.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Em Aberto</p><p className="text-2xl font-bold text-foreground">{openOrders}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Valor Total</p><p className="text-2xl font-bold text-foreground">{fmtCurrency(totalValue)}</p></div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por código ou cliente…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
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
          <Table>
            <TableHeader><TableRow>
              <TableHead>Código</TableHead><TableHead>Cliente</TableHead><TableHead>Status</TableHead>
              <TableHead>Entrega</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((o: any) => {
                const cfg = statusConfig[o.status] || statusConfig.draft;
                return (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setViewOrderId(o.id)}>
                    <TableCell className="font-mono text-sm font-medium">{o.code}</TableCell>
                    <TableCell className="text-sm">{o.customers?.name || "—"}</TableCell>
                    <TableCell><span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cfg.color)}>{cfg.label}</span></TableCell>
                    <TableCell className="text-sm">{o.due_date ? new Date(o.due_date + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmtCurrency(o.total)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {o.status === "draft" && <DropdownMenuItem onClick={() => updateStatusMut.mutate({ id: o.id, status: "approved" })}><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Aprovar</DropdownMenuItem>}
                          {o.status === "approved" && <DropdownMenuItem onClick={() => updateStatusMut.mutate({ id: o.id, status: "in_production" })}><Clock className="h-3.5 w-3.5 mr-2" /> Produzir</DropdownMenuItem>}
                          {o.status === "in_production" && <DropdownMenuItem onClick={() => updateStatusMut.mutate({ id: o.id, status: "ready" })}><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Pronto</DropdownMenuItem>}
                          {o.status === "ready" && <DropdownMenuItem onClick={() => updateStatusMut.mutate({ id: o.id, status: "shipped" })}><Truck className="h-3.5 w-3.5 mr-2" /> Enviar</DropdownMenuItem>}
                          {o.status === "shipped" && <DropdownMenuItem onClick={() => updateStatusMut.mutate({ id: o.id, status: "delivered" })}><CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Entregue</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(o.id); }}><Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir</DropdownMenuItem>
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

      {/* CREATE ORDER DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-primary" /> Novo Orçamento</DialogTitle>
            <DialogDescription>Preencha os dados do orçamento e adicione os itens</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            {/* Customer + Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Cliente</Label>
                <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem cliente</SelectItem>
                    {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data de Entrega</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            {/* Delivery address */}
            <div>
              <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Endereço de Entrega</Label>
              <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Rua, número, bairro, cidade - UF, CEP" />
            </div>

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens do Orçamento</Label>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setLines((prev) => [...prev, newLine()])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Item
                </Button>
              </div>

              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[40%]">Produto / Descrição</TableHead>
                      <TableHead className="w-[80px] text-center">Qtd</TableHead>
                      <TableHead className="w-[120px] text-right">Unitário</TableHead>
                      <TableHead className="w-[120px] text-right">Total</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="p-1.5">
                          <Select value={line.product_id || "custom"} onValueChange={(v) => updateLine(line.id, "product_id", v === "custom" ? "" : v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="custom">Personalizado</SelectItem>
                              {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} {p.sale_price ? `(${fmtCurrency(p.sale_price)})` : ""}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {!line.product_id && (
                            <Input className="mt-1 h-7 text-xs" value={line.description} onChange={(e) => updateLine(line.id, "description", e.target.value)} placeholder="Descrição do item" />
                          )}
                        </TableCell>
                        <TableCell className="p-1.5"><Input type="number" min={1} className="h-8 text-xs text-center" value={line.quantity} onChange={(e) => updateLine(line.id, "quantity", e.target.value)} /></TableCell>
                        <TableCell className="p-1.5"><Input type="number" step="0.01" className="h-8 text-xs text-right" value={line.unit_price} onChange={(e) => updateLine(line.id, "unit_price", e.target.value)} /></TableCell>
                        <TableCell className="p-1.5 text-right font-mono text-xs font-medium">{fmtCurrency(line.total)}</TableCell>
                        <TableCell className="p-1.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLine(line.id)}>
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar Orçamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VIEW ORDER DIALOG */}
      <Dialog open={!!viewOrderId} onOpenChange={(o) => { if (!o) setViewOrderId(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {viewOrder?.code || "Pedido"}
              {viewOrder && (
                <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ml-2", (statusConfig[viewOrder.status] || statusConfig.draft).color)}>
                  {(statusConfig[viewOrder.status] || statusConfig.draft).label}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {viewOrder && (
            <div className="space-y-4" ref={printRef}>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{(viewOrder as any).customers?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Data de Entrega</p>
                  <p className="font-medium">{viewOrder.due_date ? new Date(viewOrder.due_date + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p>
                </div>
              </div>

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
                    {viewItems.length === 0 ? (
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

              <div className="flex justify-between items-end">
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-1" /> Imprimir / PDF
                </Button>
                <div className="w-64 space-y-1 text-sm">
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
