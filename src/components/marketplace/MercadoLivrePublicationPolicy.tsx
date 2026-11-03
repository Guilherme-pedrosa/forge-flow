import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlinePricingPolicy } from "@/components/comercial/InlinePricingPolicy";
import { readChannelPolicy, saveChannelPolicy, type ChannelPolicy } from "@/lib/channel-policy";
import { pricingPolicyFields, pricingPolicyNumber, readPricingSettings } from "@/lib/pricing-policy";
import { integrationErrorMessage } from "@/lib/mercado-livre-integration";
import { orderRequest } from "@/lib/sales-order";

const fields = [["tax_percent", "Provisão de tributos (%)"], ["target_margin", "Margem desejada (%)"], ["advertising_per_order", "Publicidade por pedido (R$)"], ["other_cost_per_order", "Outros gastos por pedido (R$)"]] as const;
type Values = Record<typeof fields[number][0], string>;
const values = (policy: ChannelPolicy): Values => Object.fromEntries(fields.map(([key]) => [key, policy.assumptions[key] == null ? "" : String(policy.assumptions[key]).replace(".", ",")])) as Values;
type Props = { disabled?: boolean; onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void; onSaved: () => void | Promise<void> };
export function MercadoLivrePublicationPolicy(props: Props) {
  const { profile, user } = useAuth();
  return <PublicationPolicy key={`${profile?.tenant_id}:${user?.id}`} {...props} />;
}
function PublicationPolicy({ disabled = false, onBusyChange, onDirtyChange, onSaved }: Props) {
  const { profile, user } = useAuth(), qc = useQueryClient();
  const tenant = profile?.tenant_id, policyKey = ["channel_pricing_policy", tenant, "mercado_livre"];
  const policy = useQuery({ queryKey: policyKey, enabled: !!tenant, queryFn: () => readChannelPolicy("mercado_livre"), retry: false });
  const company = useQuery({ queryKey: ["pricing_settings", tenant], enabled: !!tenant, queryFn: readPricingSettings, retry: false });
  const [baseline, setBaseline] = useState<ChannelPolicy | null>(null), [draft, setDraft] = useState<Values | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const [productionBusy, setProductionBusy] = useState(false), [productionDirty, setProductionDirty] = useState(false);
  const alive = useRef(true), pending = useRef(false), request = useRef<{ signature: string; id: string } | null>(null), productionRevision = useRef<string | null>(null);
  const currentScope = useRef(`${tenant}:${user?.id}`), scope = `${tenant}:${user?.id}`; currentScope.current = scope;
  const active = () => alive.current && currentScope.current === scope;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (policy.data && !baseline) { setBaseline(policy.data); setDraft(values(policy.data)); } }, [policy.data, baseline]);
  const dirty = !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(values(baseline));
  useEffect(() => { onBusyChange(busy || productionBusy); return () => onBusyChange(false); }, [busy, productionBusy, onBusyChange]);
  useEffect(() => { onDirtyChange(dirty || productionDirty); return () => onDirtyChange(false); }, [dirty, productionDirty, onDirtyChange]);
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;
  useEffect(() => {
    if (!company.data?.revision) return;
    const previous = productionRevision.current; productionRevision.current = company.data.revision;
    if (previous && previous !== company.data.revision && alive.current) void savedCallback.current();
  }, [company.data?.revision]);
  const stale = !!baseline && !!policy.data && baseline.revision !== policy.data.revision;
  async function save() {
    if (!active() || pending.current || disabled || productionBusy || !draft || !baseline) return;
    pending.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const assumptions = { ...baseline.assumptions };
      for (const [key, label] of fields) assumptions[key] = pricingPolicyNumber(draft[key], label, key === "target_margin" || key === "tax_percent");
      const intent = JSON.stringify([baseline.revision, assumptions]);
      if (stale && request.current?.signature !== intent) throw new Error("As condições mudaram. Recarregue antes de salvar seus valores.");
      request.current = orderRequest(request.current, intent);
      await saveChannelPolicy("mercado_livre", assumptions, baseline.revision, request.current.id);
      if (!active()) return;
      const latest = await readChannelPolicy("mercado_livre");
      if (!active()) return;
      qc.setQueryData(policyKey, latest); setBaseline(latest); setDraft(values(latest)); request.current = null; setSaved(true);
      await qc.invalidateQueries({ queryKey: ["product_channel_pricing_preview", tenant] });
      if (active()) await onSaved();
    } catch (failure) { if (active()) { setError(integrationErrorMessage(failure)); void policy.refetch(); } }
    finally { pending.current = false; if (active()) setBusy(false); }
  }
  const missingProduction = company.data ? pricingPolicyFields.filter(field => !["target_margin", "machine_hour_cost"].includes(field.key) && company.data[field.key] == null).map(field => field.key) : [];
  return <section aria-label="Condições da empresa para publicar" className="space-y-4 rounded-lg border p-4"><div><h4 className="font-medium">Condições da empresa</h4><p className="text-xs text-muted-foreground">Comissão, tarifa e frete vêm da consulta oficial. Confirme somente os gastos e a margem da sua operação; os valores serão reutilizados.</p></div>
    {(policy.isLoading || company.isLoading) && <p role="status">Conferindo as condições cadastradas…</p>}
    {(policy.error || company.error) && <p role="alert">{integrationErrorMessage(policy.error || company.error)} <Button variant="ghost" onClick={() => { void policy.refetch(); void company.refetch(); }}>Conferir condições novamente</Button></p>}
    {draft && <><div className="grid gap-3 sm:grid-cols-2">{fields.map(([key, label]) => <div key={key}><Label htmlFor={`ml-company-${key}`}>{label}</Label><div className="flex gap-2"><Input id={`ml-company-${key}`} inputMode="decimal" value={draft[key]} placeholder="Não confirmado" disabled={disabled || busy || productionBusy} onChange={event => { setDraft({ ...draft, [key]: event.target.value }); setSaved(false); }} /><Button type="button" size="sm" variant="outline" disabled={disabled || busy || productionBusy} aria-label={`Não se aplica: ${label}`} onClick={() => { setDraft({ ...draft, [key]: "0" }); setSaved(false); }}>0</Button></div>{key === "target_margin" && company.data?.target_margin != null && <Button type="button" variant="link" size="sm" disabled={disabled || busy || productionBusy} onClick={() => setDraft({ ...draft, target_margin: String(company.data!.target_margin).replace(".", ",") })}>Usar margem da empresa ({company.data.target_margin}%)</Button>}</div>)}</div><p className="text-xs text-muted-foreground">Em branco permanece pendente. Informe 0 quando não houver o gasto. Embalagem incluída no custo do produto não deve ser repetida.</p>{stale && <p role="alert" className="text-sm">As condições mudaram em outra sessão. Seu rascunho continua aqui.</p>}<div className="flex flex-wrap gap-2"><Button disabled={disabled || busy || productionBusy || !dirty || stale && !error} onClick={() => void save()}>{busy ? "Salvando condições…" : error ? "Confirmar salvamento das condições" : "Salvar condições da empresa"}</Button>{stale && <Button variant="outline" disabled={disabled || busy || productionBusy} onClick={async () => { const result = await policy.refetch(); if (active() && result.data) { setBaseline(result.data); setDraft(values(result.data)); request.current = null; setError(""); } }}>Carregar condições atualizadas</Button>}</div></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{saved && <p role="status" className="text-sm">Condições salvas. Calcule os custos da publicação para conferir o preço.</p>}
    {company.data && !!missingProduction.length && <InlinePricingPolicy policy={company.data} missingKeys={missingProduction} onBusy={setProductionBusy} onDraft={setProductionDirty} />}
  </section>;
}
