import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { orderRequest } from "@/lib/sales-order";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export type PartnerKind = "customer" | "vendor";
type Address = { type: string; cep: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string };
type Contact = { name: string; role: string; email: string; phone: string };
type Details = { person_type?: string; trade_name?: string; mobile?: string; state_registration?: string; municipal_registration?: string; taxpayer_type?: string; responsible?: string; addresses?: Address[]; contacts?: Contact[]; [key: string]: unknown };
export type Partner = { id: string; name: string; email: string | null; phone: string | null; document: string | null; notes: string | null; address: unknown; birthday?: string | null; is_active: boolean; updated_at: string; registration_details?: Details };
const blankAddress = (): Address => ({ type: "Principal", cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" });
const blank = () => ({ name: "", email: "", phone: "", document: "", birthday: "", notes: "", is_active: true, person_type: "individual", trade_name: "", mobile: "", state_registration: "", municipal_registration: "", taxpayer_type: "", responsible: "" });
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
export const partnerQueryKeys = ["customers", "vendors", "quote_customers", "order_customers", "ledger_partners"];

export function PartnerDialog({ kind, open, record, onClose, onSaved }: { kind: PartnerKind; open: boolean; record?: Partner | null; onClose: () => void; onSaved?: (id: string, name: string) => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [form, setForm] = useState(blank); const [addresses, setAddresses] = useState<Address[]>([blankAddress()]); const [contacts, setContacts] = useState<Contact[]>([]); const [lookup, setLookup] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null); const session = useRef(0);
  const label = kind === "customer" ? "cliente" : "fornecedor";
  useEffect(() => {
    session.current++; request.current = null; setLookup(false);
    const d = record?.registration_details || {};
    setForm({ ...blank(), ...(record ? { name: record.name, email: record.email || "", phone: record.phone || "", document: record.document || "", birthday: record.birthday || "", notes: record.notes || "", is_active: record.is_active } : {}),
      person_type: String(d.person_type || (record?.document?.replace(/\D/g, "").length === 14 ? "company" : "individual")),
      ...Object.fromEntries(["trade_name", "mobile", "state_registration", "municipal_registration", "taxpayer_type", "responsible"].map(key => [key, String(d[key] || "")])) });
    setAddresses(d.addresses?.length ? d.addresses.map(a => ({ ...blankAddress(), ...a })) : [{ ...blankAddress(), ...(record?.address && typeof record.address === "object" ? record.address : {}) }]);
    setContacts(d.contacts || []);
  }, [open, record]);
  const change = (key: keyof ReturnType<typeof blank>, value: string | boolean) => setForm(current => ({ ...current, [key]: value }));
  const save = useMutation({ mutationFn: async () => {
    if (!form.name.trim()) throw new Error("Informe o nome.");
    const { person_type, trade_name, mobile, state_registration, municipal_registration, taxpayer_type, responsible, ...fields } = form;
    const p_data = { ...fields, address: addresses[0] || null, expected_updated_at: record?.updated_at || null,
      registration_details: { ...record?.registration_details, person_type, trade_name, mobile, state_registration, municipal_registration, taxpayer_type, responsible, addresses, contacts } };
    const payload = { p_kind: kind, p_id: record?.id || null, p_data };
    request.current = orderRequest(request.current, JSON.stringify(payload));
    const result = await rpc("save_partner", { ...payload, p_request_id: request.current.id });
    if (result.error) throw new Error(result.error.message); if (!result.data) throw new Error("Salvamento não confirmado."); return result.data;
  }, onSuccess: async id => {
    await Promise.all(partnerQueryKeys.map(key => qc.invalidateQueries({ queryKey: [key] })));
    toast({ title: `${kind === "customer" ? "Cliente" : "Fornecedor"} salvo` }); onSaved?.(id, form.name); onClose();
  }, onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }) });
  const lookupCnpj = async () => {
    const doc = form.document.replace(/\D/g, ""); if (doc.length !== 14) return;
    const current = session.current; setLookup(true);
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${doc}`); if (!response.ok) throw new Error("CNPJ não encontrado. Você pode preencher os dados manualmente.");
      const data = await response.json(); if (current !== session.current) return;
      setForm(f => ({ ...f, name: data.razao_social || f.name, trade_name: data.nome_fantasia || f.trade_name, email: data.email || f.email, phone: data.ddd_telefone_1 || f.phone, person_type: "company" }));
      setAddresses(rows => rows.map((a, i) => i ? a : { ...a, cep: data.cep || a.cep, street: [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(" ") || a.street, number: data.numero || a.number, complement: data.complemento || a.complement, neighborhood: data.bairro || a.neighborhood, city: data.municipio || a.city, state: data.uf || a.state }));
    } catch (e) { toast({ title: "Consulta de CNPJ", description: (e as Error).message, variant: "destructive" }); } finally { if (current === session.current) setLookup(false); }
  };
  const lookupCep = async (index: number, value: string) => {
    const cep = value.replace(/\D/g, ""); if (cep.length !== 8) return;
    const current = session.current;
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`); if (!response.ok) return;
      const data = await response.json(); if (current !== session.current) return;
      setAddresses(rows => rows.map((a, i) => i === index && a.cep.replace(/\D/g, "") === cep ? { ...a, street: data.street || a.street, neighborhood: data.neighborhood || a.neighborhood, city: data.city || a.city, state: data.state || a.state } : a));
    } catch { /* Manual address entry remains available when the lookup is offline. */ }
  };
  const field = (key: keyof ReturnType<typeof blank>, title: string, type = "text") => <div key={key}><Label htmlFor={`partner-${key}`}>{title}</Label><Input id={`partner-${key}`} type={type} value={String(form[key])} onChange={e => change(key, e.target.value)} disabled={save.isPending || lookup} /></div>;
  return <Dialog open={open} onOpenChange={value => { if (!value && !save.isPending) onClose(); }}><DialogContent className="flex h-[94dvh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="border-b p-5 pr-12"><DialogTitle>{record ? "Editar" : "Adicionar"} {label}</DialogTitle><DialogDescription>Dados gerais, documentos, endereços e contatos.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-muted/20 p-5">
      <section className="rounded-lg border bg-card p-5"><h2 className="mb-4 font-semibold">Dados gerais</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><Label htmlFor="partner-person-type">Tipo de pessoa</Label><select id="partner-person-type" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.person_type} onChange={e => change("person_type", e.target.value)} disabled={save.isPending}><option value="individual">Pessoa física</option><option value="company">Pessoa jurídica</option><option value="foreign">Estrangeiro</option></select></div>
        <div><Label htmlFor="partner-active">Situação</Label><select id="partner-active" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={String(form.is_active)} onChange={e => change("is_active", e.target.value === "true")} disabled={save.isPending}><option value="true">Ativo</option><option value="false">Inativo</option></select></div>
        <div className="sm:col-span-2 lg:col-span-1">{field("name", form.person_type === "company" ? "Razão social / nome *" : "Nome *")}</div>
        {form.person_type === "company" && field("trade_name", "Nome fantasia")}
        <div><Label htmlFor="partner-document">{form.person_type === "company" ? "CNPJ" : form.person_type === "foreign" ? "Documento" : "CPF"}</Label><div className="flex gap-2"><Input id="partner-document" value={form.document} onChange={e => change("document", e.target.value)} disabled={save.isPending || lookup} />{form.person_type === "company" && <Button variant="outline" aria-label="Consultar CNPJ" disabled={lookup || save.isPending || form.document.replace(/\D/g, "").length !== 14} onClick={lookupCnpj}>{lookup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button>}</div></div>
        {field("email", "E-mail", "email")}{field("phone", "Telefone")}{field("mobile", "Celular / WhatsApp")}{field("responsible", "Responsável")}
        {kind === "customer" && field("birthday", "Aniversário", "date")}
        {form.person_type === "company" && <>{field("state_registration", "Inscrição estadual / ISENTO")}{field("municipal_registration", "Inscrição municipal")}<div><Label htmlFor="partner-taxpayer">Tipo de contribuinte</Label><select id="partner-taxpayer" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.taxpayer_type} onChange={e => change("taxpayer_type", e.target.value)}><option value="">Não informado</option><option value="contributor">Contribuinte ICMS</option><option value="exempt">Contribuinte isento</option><option value="non_contributor">Não contribuinte</option></select></div></>}
      </div></section>
      <section className="rounded-lg border bg-card p-5"><h2 className="font-semibold">Endereços</h2><p className="mb-4 text-sm text-muted-foreground">O primeiro endereço é usado como principal.</p><div className="space-y-5">{addresses.map((address, index) => <div key={index} className="grid gap-3 border-b pb-4 sm:grid-cols-2 lg:grid-cols-4">{([["type", "Tipo"], ["cep", "CEP"], ["street", "Logradouro"], ["number", "Número"], ["complement", "Complemento"], ["neighborhood", "Bairro"], ["city", "Cidade"], ["state", "UF"]] as const).map(([key, label]) => <div key={key}><Label htmlFor={`address-${index}-${key}`}>{label}</Label><Input id={`address-${index}-${key}`} value={address[key]} onBlur={e => { if (key === "cep") void lookupCep(index, e.target.value); }} disabled={save.isPending} onChange={e => setAddresses(rows => rows.map((a, i) => i === index ? { ...a, [key]: e.target.value } : a))} /></div>)}{addresses.length > 1 && <Button variant="ghost" className="justify-self-start" disabled={save.isPending} onClick={() => setAddresses(rows => rows.filter((_, i) => i !== index))}><Trash2 className="mr-2 h-4 w-4" />Remover endereço</Button>}</div>)}</div><Button variant="outline" className="mt-4" disabled={save.isPending} onClick={() => setAddresses(rows => [...rows, blankAddress()])}><Plus className="mr-2 h-4 w-4" />Adicionar endereço</Button></section>
      <section className="rounded-lg border bg-card p-5"><h2 className="mb-4 font-semibold">Contatos adicionais</h2>{contacts.map((contact, index) => <div key={index} className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">{([["name", "Nome"], ["role", "Cargo / setor"], ["email", "E-mail"], ["phone", "Telefone"]] as const).map(([key, label]) => <div key={key}><Label htmlFor={`contact-${index}-${key}`}>{label}</Label><Input id={`contact-${index}-${key}`} value={contact[key]} disabled={save.isPending} onChange={e => setContacts(rows => rows.map((c, i) => i === index ? { ...c, [key]: e.target.value } : c))} /></div>)}<Button variant="ghost" className="self-end" aria-label={`Remover contato ${index + 1}`} disabled={save.isPending} onClick={() => setContacts(rows => rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}<Button variant="outline" disabled={save.isPending} onClick={() => setContacts(rows => [...rows, { name: "", role: "", email: "", phone: "" }])}><Plus className="mr-2 h-4 w-4" />Adicionar contato</Button></section>
      <section className="rounded-lg border bg-card p-5"><Label htmlFor="partner-notes">Observações</Label><Textarea id="partner-notes" className="mt-2" rows={4} value={form.notes} onChange={e => change("notes", e.target.value)} disabled={save.isPending} /></section>
    </div><DialogFooter className="border-t bg-card p-4"><Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancelar</Button><Button disabled={save.isPending || lookup || !form.name.trim()} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar {label}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
