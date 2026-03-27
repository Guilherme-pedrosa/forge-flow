import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Plus, Search, MoreHorizontal, Users, Edit, Trash2, Loader2, MapPin, Cake, Building2,
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
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

type CustomerRow = Tables<"customers">;

interface AddressData {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export default function Clientes() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<CustomerRow | null>(null);
  const [detailItem, setDetailItem] = useState<CustomerRow | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [document, setDocument] = useState("");
  const [birthday, setBirthday] = useState("");
  const [notes, setNotes] = useState("");
  const [cnpjLoading, setCnpjLoading] = useState(false);

  // Address
  const [cep, setCep] = useState("");
  const [street, setStreet] = useState("");
  const [addrNumber, setAddrNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!profile,
  });

  const filtered = useMemo(() => {
    if (!search) return customers;
    const s = search.toLowerCase();
    return customers.filter((c) => c.name.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) || c.document?.toLowerCase().includes(s));
  }, [customers, search]);

  const resetForm = () => {
    setName(""); setEmail(""); setPhone(""); setDocument(""); setBirthday(""); setNotes("");
    setCep(""); setStreet(""); setAddrNumber(""); setComplement(""); setNeighborhood(""); setCity(""); setState("");
  };

  const loadAddress = (addr: any) => {
    if (!addr) return;
    setCep(addr.cep || ""); setStreet(addr.street || ""); setAddrNumber(addr.number || "");
    setComplement(addr.complement || ""); setNeighborhood(addr.neighborhood || "");
    setCity(addr.city || ""); setState(addr.state || "");
  };

  const openEdit = (c: CustomerRow) => {
    setEditItem(c); setName(c.name); setEmail(c.email || ""); setPhone(c.phone || "");
    setDocument(c.document || ""); setBirthday((c as any).birthday || ""); setNotes(c.notes || "");
    loadAddress(c.address);
  };

  const buildAddress = (): AddressData | null => {
    if (!cep && !street && !city) return null;
    return { cep, street, number: addrNumber, complement, neighborhood, city, state };
  };

  // CNPJ lookup via BrasilAPI (free, no key needed)
  const lookupCnpj = async () => {
    const cleanDoc = document.replace(/\D/g, "");
    if (cleanDoc.length !== 14) {
      toast({ title: "CNPJ inválido", description: "Digite um CNPJ com 14 dígitos.", variant: "destructive" });
      return;
    }
    setCnpjLoading(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanDoc}`);
      if (!res.ok) throw new Error("CNPJ não encontrado");
      const data = await res.json();

      // Auto-fill fields
      if (data.razao_social) setName(data.razao_social);
      if (data.email) setEmail(data.email);
      if (data.ddd_telefone_1) setPhone(data.ddd_telefone_1);
      if (data.cep) setCep(data.cep);
      if (data.logradouro) setStreet(`${data.descricao_tipo_de_logradouro || ""} ${data.logradouro}`.trim());
      if (data.numero) setAddrNumber(data.numero);
      if (data.complemento) setComplement(data.complemento);
      if (data.bairro) setNeighborhood(data.bairro);
      if (data.municipio) setCity(data.municipio);
      if (data.uf) setState(data.uf);

      toast({ title: "CNPJ encontrado", description: data.razao_social || "Dados preenchidos automaticamente." });
    } catch (e: any) {
      toast({ title: "Erro na consulta", description: e.message, variant: "destructive" });
    } finally {
      setCnpjLoading(false);
    }
  };

  // CEP lookup
  const lookupCep = async (cepValue: string) => {
    const clean = cepValue.replace(/\D/g, "");
    if (clean.length !== 8) return;
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${clean}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.street) setStreet(data.street);
      if (data.neighborhood) setNeighborhood(data.neighborhood);
      if (data.city) setCity(data.city);
      if (data.state) setState(data.state);
    } catch { /* silent */ }
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Sem perfil");
      const { error } = await supabase.from("customers").insert({
        tenant_id: profile.tenant_id, name, email: email || null, phone: phone || null,
        document: document || null, notes: notes || null, address: buildAddress(),
        birthday: birthday || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); setCreateOpen(false); resetForm(); toast({ title: "Cliente criado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editItem) return;
      const { error } = await supabase.from("customers").update({
        name, email: email || null, phone: phone || null, document: document || null,
        notes: notes || null, address: buildAddress(), birthday: birthday || null,
      } as any).eq("id", editItem.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); setEditItem(null); resetForm(); toast({ title: "Cliente atualizado" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); toast({ title: "Cliente removido" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const formFields = (
    <div className="grid gap-4 max-h-[65vh] overflow-y-auto pr-1">
      <div><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente ou razão social" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" /></div>
        <div><Label>Telefone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" /></div>
      </div>

      {/* Document + CNPJ lookup */}
      <div>
        <Label>CPF/CNPJ</Label>
        <div className="flex gap-2">
          <Input value={document} onChange={(e) => setDocument(e.target.value)} placeholder="000.000.000-00 ou 00.000.000/0001-00" className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={lookupCnpj}
            disabled={cnpjLoading || document.replace(/\D/g, "").length !== 14}
          >
            {cnpjLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
            Consultar CNPJ
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">Digite um CNPJ para buscar automaticamente na Receita Federal.</p>
      </div>

      <div>
        <Label>Data de Nascimento / Aniversário</Label>
        <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
      </div>

      {/* Address */}
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mt-1">
        <MapPin className="h-3.5 w-3.5" /> Endereço
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3">
        <div>
          <Label>CEP</Label>
          <Input
            value={cep}
            onChange={(e) => setCep(e.target.value)}
            onBlur={(e) => lookupCep(e.target.value)}
            placeholder="00000-000"
          />
        </div>
        <div>
          <Label>UF</Label>
          <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" maxLength={2} />
        </div>
      </div>
      <div>
        <Label>Logradouro</Label>
        <Input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua, Avenida..." />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-3">
        <div>
          <Label>Número</Label>
          <Input value={addrNumber} onChange={(e) => setAddrNumber(e.target.value)} placeholder="123" />
        </div>
        <div>
          <Label>Complemento</Label>
          <Input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apt, Bloco..." />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Bairro</Label>
          <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Bairro" />
        </div>
        <div>
          <Label>Cidade</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" />
        </div>
      </div>

      <div><Label>Observações</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
    </div>
  );

  const formatAddr = (addr: any) => {
    if (!addr) return null;
    const parts = [addr.street, addr.number, addr.complement, addr.neighborhood, addr.city, addr.state].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader title="Clientes" description="Cadastro e gestão de clientes"
        breadcrumbs={[{ label: "Comercial", href: "/comercial/pedidos" }, { label: "Clientes" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><a href="/comercial/pedidos">Ver Pedidos</a></Button>
            <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Cliente</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Total de Clientes</p><p className="text-2xl font-bold text-foreground">{customers.length}</p></div>
        <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Com E-mail</p><p className="text-2xl font-bold text-foreground">{customers.filter(c => c.email).length}</p></div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Aniversariantes do Mês</p>
          <p className="text-2xl font-bold text-foreground">
            {customers.filter(c => {
              const bday = (c as any).birthday;
              if (!bday) return false;
              return new Date(bday).getMonth() === new Date().getMonth();
            }).length}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, e-mail, CPF/CNPJ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mb-3 opacity-40" /><p className="font-medium">Nenhum cliente encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Telefone</TableHead><TableHead>CPF/CNPJ</TableHead><TableHead>Cidade</TableHead><TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const addr = c.address as any;
                return (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetailItem(c)}>
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-sm">{c.email || "—"}</TableCell>
                    <TableCell className="text-sm">{c.phone || "—"}</TableCell>
                    <TableCell className="text-sm font-mono">{c.document || "—"}</TableCell>
                    <TableCell className="text-sm">{addr?.city ? `${addr.city}/${addr.state || ""}` : "—"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(c); }}><Edit className="h-3.5 w-3.5 mr-2" /> Editar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteMut.mutate(c.id); }}><Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir</DropdownMenuItem>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Novo Cliente</DialogTitle><DialogDescription>Cadastrar novo cliente</DialogDescription></DialogHeader>
          {formFields}
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={() => createMut.mutate()} disabled={!name || createMut.isPending}>{createMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Criar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o) { setEditItem(null); resetForm(); } }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Editar Cliente</DialogTitle></DialogHeader>
          {formFields}
          <DialogFooter><Button variant="outline" onClick={() => { setEditItem(null); resetForm(); }}>Cancelar</Button><Button onClick={() => updateMut.mutate()} disabled={!name || updateMut.isPending}>{updateMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailItem} onOpenChange={(o) => { if (!o) setDetailItem(null); }}>
        <DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{detailItem?.name}</DialogTitle></DialogHeader>
          {detailItem && (
            <div className="grid gap-2 text-sm">
              <div><span className="text-muted-foreground">E-mail:</span> {detailItem.email || "—"}</div>
              <div><span className="text-muted-foreground">Telefone:</span> {detailItem.phone || "—"}</div>
              <div><span className="text-muted-foreground">CPF/CNPJ:</span> {detailItem.document || "—"}</div>
              {(detailItem as any).birthday && (
                <div className="flex items-center gap-1.5">
                  <Cake className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Aniversário:</span>
                  {new Date((detailItem as any).birthday + "T00:00:00").toLocaleDateString("pt-BR")}
                </div>
              )}
              {formatAddr(detailItem.address) && (
                <div className="flex items-start gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                  <div>
                    <span className="text-muted-foreground">Endereço:</span><br />
                    {formatAddr(detailItem.address)}
                    {(detailItem.address as any)?.cep && <span className="text-muted-foreground"> — CEP {(detailItem.address as any).cep}</span>}
                  </div>
                </div>
              )}
              {detailItem.notes && <div><span className="text-muted-foreground">Notas:</span> {detailItem.notes}</div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
