import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Loader2, MapPin, Package, Trash2, ArrowRightLeft,
  ArrowUpFromLine, ArrowDownToLine, RotateCcw, ShoppingCart, Eye, X,
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

const fmtCurrency = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

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
  const [locName, setLocName] = useState("");
  const [locCustomerId, setLocCustomerId] = useState("");
  const [locContact, setLocContact] = useState("");
  const [locPhone, setLocPhone] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locNotes, setLocNotes] = useState("");

  // Movement form
  const [movProductId, setMovProductId] = useState("");
  const [movQty, setMovQty] = useState("");
  const [movPrice, setMovPrice] = useState("");
  const [movNotes, setMovNotes] = useState("");

  // ── Queries ──
  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["consignment_locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consignment_locations")
        .select("*")
        .eq("is_active", true)
        .order("name");
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
        .select("*, products(name, photo_url, sale_price), consignment_locations(name)")
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
        .select("id, name, sale_price, photo_url")
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
  const createLocMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const { error } = await supabase.from("consignment_locations").insert({
        tenant_id: profile.tenant_id,
        name: locName,
        contact_name: locContact || null,
        phone: locPhone || null,
        address: locAddress || null,
        notes: locNotes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consignment_locations"] });
      setCreateLocOpen(false);
      setLocName(""); setLocContact(""); setLocPhone(""); setLocAddress(""); setLocNotes("");
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
      setMovementOpen(false);
      setMovProductId(""); setMovQty(""); setMovPrice(""); setMovNotes("");
      toast({ title: "Movimento registrado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

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
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
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
                      {loc.contact_name && <p className="text-xs text-muted-foreground">{loc.contact_name}</p>}
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
      <Dialog open={createLocOpen} onOpenChange={setCreateLocOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Novo Ponto de Consignação</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><Label>Nome do Ponto *</Label><Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Loja Centro" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contato</Label><Input value={locContact} onChange={(e) => setLocContact(e.target.value)} placeholder="João Silva" /></div>
              <div><Label>Telefone</Label><Input value={locPhone} onChange={(e) => setLocPhone(e.target.value)} placeholder="(62) 99999-9999" /></div>
            </div>
            <div><Label>Endereço</Label><Input value={locAddress} onChange={(e) => setLocAddress(e.target.value)} placeholder="Rua X, 123 - Centro" /></div>
            <div><Label>Observações</Label><Textarea value={locNotes} onChange={(e) => setLocNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateLocOpen(false)}>Cancelar</Button>
            <Button onClick={() => createLocMut.mutate()} disabled={!locName || createLocMut.isPending}>
              {createLocMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── View Location Dialog ── */}
      <Dialog open={!!viewLocId} onOpenChange={(o) => { if (!o) setViewLocId(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              {viewLoc?.name || "Ponto"}
            </DialogTitle>
          </DialogHeader>

          {viewLoc && (
            <div className="space-y-4">
              {/* Location info */}
              <div className="grid grid-cols-3 gap-4 text-sm">
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
                            <TableHead className="text-center">Colocados</TableHead>
                            <TableHead className="text-center">Vendidos</TableHead>
                            <TableHead className="text-center">Devolvidos</TableHead>
                            <TableHead className="text-right">Valor (estoque)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {viewLocItems.map((item: any) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-sm font-medium">
                                <div className="flex items-center gap-2">
                                  {item.products?.photo_url && (
                                    <img src={item.products.photo_url} className="h-8 w-8 rounded object-cover" />
                                  )}
                                  {item.products?.name || "—"}
                                </div>
                              </TableCell>
                              <TableCell className="text-center font-bold">{item.current_qty}</TableCell>
                              <TableCell className="text-center text-muted-foreground">{item.total_placed}</TableCell>
                              <TableCell className="text-center text-emerald-600 font-medium">{item.total_sold}</TableCell>
                              <TableCell className="text-center text-muted-foreground">{item.total_returned}</TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {fmtCurrency(item.current_qty * (item.products?.sale_price || 0))}
                              </TableCell>
                            </TableRow>
                          ))}
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
              <Select value={movProductId || "none"} onValueChange={(v) => setMovProductId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione um produto" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione…</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.sale_price ? ` (${fmtCurrency(p.sale_price)})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
