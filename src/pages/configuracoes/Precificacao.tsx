import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/finance";
import { orderRequest } from "@/lib/sales-order";
import { emptyPricingPolicyDraft, pricingPolicyDraft, pricingPolicyFields, pricingPolicyPayload, readPricingSettings, savePricingSettings } from "@/lib/pricing-policy";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PricingSettings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(emptyPricingPolicyDraft);
  const [revision, setRevision] = useState("");
  const [dirty, setDirty] = useState(false);
  const hydratedTenant = useRef<string | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const settings = useQuery({ queryKey: ["pricing_settings", profile?.tenant_id], enabled: !!profile?.tenant_id, queryFn: readPricingSettings });
  const printers = useQuery({ queryKey: ["pricing_settings_printers", profile?.tenant_id], enabled: !!profile?.tenant_id,
    queryFn: () => allRows((from, to) => supabase.from("printers").select("id,name,power_watts,is_active").eq("tenant_id", profile!.tenant_id).order("name").order("id").range(from, to)) });
  useEffect(() => {
    if (!settings.data || dirty && hydratedTenant.current === profile?.tenant_id) return;
    hydratedTenant.current = profile?.tenant_id || null;
    setDraft(pricingPolicyDraft(settings.data)); setRevision(settings.data.revision); setDirty(false);
  }, [settings.data, dirty, profile?.tenant_id]);
  const save = useMutation({ mutationFn: async () => {
    if (!settings.data || !revision || settings.error || printers.error) throw new Error("Carregue os parâmetros atuais antes de salvar.");
    const payload = pricingPolicyPayload(draft);
    request.current = orderRequest(request.current, JSON.stringify([payload, revision]));
    return savePricingSettings(payload, revision, request.current.id);
  }, onSuccess: async () => {
    setDirty(false); request.current = null;
    await Promise.all(["pricing_settings", "product_pricing_preview", "pricing-company", "tenant"].map(key => qc.invalidateQueries({ queryKey: [key] })));
    toast({ title: "Custos e precificação salvos", description: "As próximas simulações usarão estas tarifas e os dados das peças e placas." });
  }, onError: (error: Error) => toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }) });
  const blocked = save.isPending || settings.isPending || !settings.data || !!settings.error || !!printers.error;
  const fields = (start: number, end: number) => pricingPolicyFields.slice(start, end).map(field => <div key={field.key} className="min-w-0 space-y-1.5"><Label htmlFor={`policy-${field.key}`}>{field.label}</Label><Input id={`policy-${field.key}`} inputMode="decimal" placeholder="Não definido" disabled={save.isPending} value={draft.values[field.key]} onChange={event => { setDirty(true); setDraft(previous => ({ ...previous, values: { ...previous.values, [field.key]: event.target.value } })); }} /><p className="text-xs leading-relaxed text-muted-foreground">{field.hint}</p></div>);
  return <div className="mx-auto max-w-5xl space-y-5">
    <PageHeader title="Custos e precificação" description="Defina as tarifas padrão e use os consumos e tempos das peças para formar o preço do produto completo." breadcrumbs={[{ label: "Configurações", href: "/configuracoes" }, { label: "Custos e precificação" }]} actions={<Button variant="outline" asChild><Link to="/comercial/precificacao"><Calculator className="mr-2 h-4 w-4" />Precificar produto</Link></Button>} />
    {settings.isPending ? <p role="status">Carregando as tarifas…</p> : settings.error ? <div role="alert" className="rounded-lg border border-destructive/30 p-4">Não foi possível carregar os parâmetros. <Button variant="outline" onClick={() => settings.refetch()}>Tentar novamente</Button></div> : <>
      <p className="rounded-lg border bg-muted/30 p-3 text-sm">Em branco significa não definido. Informe <strong>0</strong> quando quiser considerar um custo ou tempo como zero.</p>
      <section className="space-y-4 rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">Tarifas e margem padrão</h2><div className="grid gap-5 sm:grid-cols-2">{fields(0, 4)}</div></section>
      <section className="space-y-4 rounded-xl border bg-card p-5"><div><h2 className="text-lg font-semibold">Tempo de trabalho e demais custos</h2><p className="mt-1 text-sm text-muted-foreground">Estes padrões podem ser ajustados na precificação de cada produto.</p></div><div className="grid gap-5 sm:grid-cols-2">{fields(4, 9)}</div></section>
      <section className="space-y-4 rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Hora da máquina por impressora</h2><p className="mt-1 text-sm text-muted-foreground">Preencha somente as exceções à tarifa padrão.</p></div><Button variant="outline" size="sm" asChild><Link to="/producao/impressoras">Cadastro das impressoras</Link></Button></div>
        {printers.isPending ? <p role="status">Carregando impressoras…</p> : printers.error ? <p role="alert" className="text-destructive">Não foi possível carregar as impressoras. <button className="underline" onClick={() => printers.refetch()}>Tentar novamente</button></p> : !printers.data?.length ? <p className="text-sm text-muted-foreground">Cadastre uma impressora para definir suas exceções e a potência usada no cálculo de energia.</p> : <div className="space-y-3">{printers.data.map(printer => <div key={printer.id} className="grid min-w-0 items-center gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]"><div><p className="break-words font-medium">{printer.name}{!printer.is_active ? " · arquivada" : ""}</p><p className="text-xs text-muted-foreground">Potência cadastrada: {printer.power_watts == null ? "não definida" : `${Number(printer.power_watts).toLocaleString("pt-BR")} W`}</p></div><div><Label htmlFor={`policy-printer-${printer.id}`}>Hora da máquina (R$/h)</Label><Input id={`policy-printer-${printer.id}`} inputMode="decimal" placeholder="Usar tarifa padrão" disabled={save.isPending} value={draft.printerHours[printer.id] || ""} onChange={event => { setDirty(true); setDraft(previous => ({ ...previous, printerHours: { ...previous.printerHours, [printer.id]: event.target.value } })); }} /></div></div>)}</div>}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">{dirty ? "Há alterações para salvar." : "As tarifas salvas serão carregadas na precificação."}</p><Button disabled={blocked || !dirty} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar parâmetros</Button></div>
      {save.error && <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"><p>{save.error.message}</p><Button type="button" variant="outline" size="sm" onClick={() => { setDirty(false); request.current = null; save.reset(); void settings.refetch(); }}>Recarregar parâmetros salvos</Button></div>}
    </>}
  </div>;
}
