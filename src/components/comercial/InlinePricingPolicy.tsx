import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { orderRequest } from "@/lib/sales-order";
import { pricingPolicyDraft, pricingPolicyFields, pricingPolicyPayload, readPricingSettings, savePricingSettings, type PricingPolicy, type PricingPolicyKey } from "@/lib/pricing-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  policy: PricingPolicy;
  missingKeys?: PricingPolicyKey[];
  printers?: { id: string; name: string }[];
  onBusy?: (busy: boolean) => void;
  onDraft?: (dirty: boolean) => void;
}

/** Edit the company defaults where they are needed, without losing the product draft. */
export function InlinePricingPolicy({ policy, missingKeys = [], printers = [], onBusy, onDraft }: Props) {
  const { profile, user } = useAuth();
  const scope = `${profile?.tenant_id}:${user?.id}`;
  const alive = useRef(true), currentScope = useRef(scope);
  currentScope.current = scope;
  const active = () => alive.current && currentScope.current === scope;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const qc = useQueryClient();
  const prefix = useId();
  const [baseline, setBaseline] = useState(policy);
  const [draft, setDraft] = useState(() => pricingPolicyDraft(policy));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const pending = useRef(false);
  const observedPolicy = useRef(policy);
  useEffect(() => { if (!dirty && !busy && observedPolicy.current !== policy) { observedPolicy.current = policy; setBaseline(policy); setDraft(pricingPolicyDraft(policy)); } }, [policy, dirty, busy]);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => { onDraft?.(dirty); return () => onDraft?.(false); }, [dirty, onDraft]);
  function change(key: PricingPolicyKey, value: string) {
    setDraft(current => ({ ...current, values: { ...current.values, [key]: value } })); setDirty(true); setSaved(false);
  }
  async function refresh() {
    if (pending.current || !active()) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const latest = await readPricingSettings();
      if (!active()) return;
      const original = pricingPolicyDraft(baseline), next = pricingPolicyDraft(latest);
      for (const field of pricingPolicyFields) if (draft.values[field.key] !== original.values[field.key]) next.values[field.key] = draft.values[field.key];
      for (const id of new Set([...Object.keys(original.printerHours), ...Object.keys(draft.printerHours)]))
        if ((draft.printerHours[id] ?? "") !== (original.printerHours[id] ?? "")) next.printerHours[id] = draft.printerHours[id] ?? "";
      setBaseline(latest); setDraft(next); request.current = null;
      qc.setQueryData(["pricing_settings", profile?.tenant_id], latest);
    } catch (failure) { if (active()) setError(failure instanceof Error ? failure.message : "Não foi possível atualizar os parâmetros."); }
    finally { pending.current = false; if (active()) setBusy(false); }
  }
  async function save() {
    if (pending.current || !dirty || !active()) return;
    pending.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const payload = pricingPolicyPayload(draft);
      request.current = orderRequest(request.current, JSON.stringify([payload, baseline.revision]));
      await savePricingSettings(payload, baseline.revision, request.current.id);
      if (!active()) return;
      // Confirm the saved revision before calculating with it. A lost response
      // retries the same request instead of writing the company settings twice.
      const latest = await readPricingSettings();
      if (!active()) return;
      setBaseline(latest); setDraft(pricingPolicyDraft(latest));
      qc.setQueryData(["pricing_settings", profile?.tenant_id], latest);
      await Promise.all(["pricing_settings", "product_pricing_preview", "pricing-company", "products", "product_material_recipe", "product_material_recipe_catalog", "product_print_plate_preparation"].map(key => qc.invalidateQueries({ queryKey: [key] })));
      if (!active()) return;
      setDirty(false); request.current = null; setSaved(true);
    } catch (failure) { if (active()) setError(failure instanceof Error ? failure.message : "Não foi possível salvar os parâmetros."); }
    finally { pending.current = false; if (active()) setBusy(false); }
  }
  const field = (key: PricingPolicyKey) => {
    const info = pricingPolicyFields.find(item => item.key === key)!;
    return <div key={key} className="min-w-0 space-y-1.5"><Label htmlFor={`${prefix}-${key}`}>{info.label}</Label><div className="flex flex-wrap gap-2"><Input id={`${prefix}-${key}`} className="min-w-0 flex-1" inputMode="decimal" placeholder="Não definido" disabled={busy} value={draft.values[key]} onChange={event => change(key, event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } }} /><Button type="button" size="sm" variant="outline" disabled={busy} aria-label={`Considerar zero: ${info.label}`} onClick={() => change(key, "0")}>Não se aplica (0)</Button></div><p className="text-xs text-muted-foreground">{info.hint}</p></div>;
  };
  const printerIds = [...new Set([...printers.map(printer => printer.id), ...Object.keys(draft.printerHours)])];
  return <section aria-label="Parâmetros de custo da empresa" className="space-y-3 rounded-lg border p-3">
    {!!missingKeys.length && <><p className="text-sm font-medium">Confirme os custos que faltam</p><p className="text-xs text-muted-foreground">Estes padrões serão reutilizados nos próximos produtos. Em branco fica pendente; escolha zero apenas quando não houver esse custo ou trabalho.</p><div className="grid gap-4 sm:grid-cols-2">{missingKeys.map(field)}</div></>}
    <Button type="button" variant="link" className="h-auto px-0 text-xs" aria-expanded={expanded} disabled={busy} onClick={() => setExpanded(value => !value)}>{expanded ? "Recolher parâmetros da empresa" : "Conferir todos os parâmetros da empresa"}</Button>
    {expanded && <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2">{pricingPolicyFields.filter(info => !missingKeys.includes(info.key)).map(info => field(info.key))}</div>{!!printerIds.length && <fieldset className="space-y-3"><legend className="text-sm font-medium">Exceções de hora-máquina por impressora</legend><p className="text-xs text-muted-foreground">Em branco usa a tarifa padrão ou os custos de depreciação e manutenção cadastrados.</p>{printerIds.map(id => <div key={id}><Label htmlFor={`${prefix}-printer-${id}`}>Hora-máquina: {printers.find(printer => printer.id === id)?.name ?? id} (R$/h)</Label><Input id={`${prefix}-printer-${id}`} inputMode="decimal" disabled={busy} value={draft.printerHours[id] ?? ""} placeholder="Usar padrão" onChange={event => { setDraft(current => ({ ...current, printerHours: { ...current.printerHours, [id]: event.target.value } })); setDirty(true); setSaved(false); }} /></div>)}</fieldset>}</div>}
    {(dirty || busy) && <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Salvando parâmetros…" : "Salvar parâmetros e recalcular"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setDraft(pricingPolicyDraft(policy)); setBaseline(policy); setDirty(false); setError(""); request.current = null; }}>Cancelar alterações de custos</Button></div>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><p>Se os parâmetros mudaram, atualize e confira seus valores antes de salvar novamente.</p><Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>Atualizar parâmetros e manter meus valores</Button></div>}
    {saved && <p role="status" className="text-sm">Parâmetros salvos. O custo usa os valores confirmados da empresa.</p>}
  </section>;
}
