import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orderRequest } from "@/lib/sales-order";
import { integrationErrorMessage, integradorSettingsDraft, integradorSettingsSignature, prepareIntegradorSettingsChanges, readIntegradorReadiness, saveIntegradorSettings,
  type IntegradorBridgeBinding, type IntegradorSettings, type IntegradorSettingsDraft, type MercadoLivreReadiness } from "@/lib/mercado-livre-integration";

export function IntegradorConfigurationEditor({ binding, value, userId, hasConnectedAccounts, disabled = false, onConfirmed, onBusyChange }: {
  binding: IntegradorBridgeBinding; value: IntegradorSettings; userId: string; hasConnectedAccounts: boolean; disabled?: boolean;
  onConfirmed: (value: MercadoLivreReadiness) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const prefix = useId(), scope = `${binding.bridge_id}:${binding.revision}:${userId}`;
  const alive = useRef(true), currentScope = useRef(scope); currentScope.current = scope;
  const active = () => alive.current && currentScope.current === scope;
  const controller = useRef<AbortController | null>(null), pending = useRef(false), request = useRef<{ signature: string; id: string } | null>(null);
  const [baseline, setBaseline] = useState(value), [draft, setDraft] = useState(() => integradorSettingsDraft(value));
  const [busy, setBusy] = useState(false), [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [retryFailed, setRetryFailed] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(integradorSettingsDraft(baseline));
  const stale = value.revision !== baseline.revision;
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (!dirty && !busy) { setBaseline(value); setDraft(integradorSettingsDraft(value)); } }, [value, dirty, busy]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  function change<K extends keyof IntegradorSettingsDraft>(key: K, next: IntegradorSettingsDraft[K]) { setDraft(previous => ({ ...previous, [key]: next })); setAcknowledged(false); setRetryFailed(false); setError(""); setMessage(""); }
  function showError(failure: unknown) { const secret = draft.client_secret.trim(); const text = integrationErrorMessage(failure); setError(secret ? text.split(secret).join("[omitido]") : text); }
  async function save() {
    if (!active() || pending.current || !dirty) return;
    if (!acknowledged) { setError("Confirme o efeito nas próximas rotinas do Integrador antes de salvar."); return; }
    pending.current = true; setBusy(true); setError(""); setMessage("");
    controller.current?.abort(); controller.current = new AbortController();
    try {
      if (!baseline.revision) throw new Error("Recarregue a configuração para confirmar a versão atual.");
      const changes = prepareIntegradorSettingsChanges(draft, baseline);
      if (!Object.keys(changes).length) throw new Error("Nenhuma alteração permitida foi preenchida.");
      const signature = await integradorSettingsSignature(changes, baseline.revision);
      if (!active()) return;
      if (stale && !(retryFailed && request.current?.signature === signature)) throw new Error("A configuração mudou. Atualize e confira seus ajustes antes de salvar.");
      request.current = orderRequest(request.current, signature);
      const context = { userId, signal: controller.current.signal };
      const saved = await saveIntegradorSettings(binding, changes, baseline.revision, request.current.id, context);
      if (!active()) return;
      const latest = await readIntegradorReadiness(binding, context);
      if (!active()) return;
      onConfirmed(latest); setBaseline(latest.settings); setDraft(integradorSettingsDraft(latest.settings)); setAcknowledged(false); setRetryFailed(false); request.current = null;
      setMessage(saved.accepted_revision === latest.settings.revision ? "Configuração salva. As próximas rotinas existentes usarão os valores confirmados." : "O salvamento foi confirmado e houve uma alteração posterior. Confira a configuração atual exibida.");
    } catch (failure) { if (active()) { showError(failure); setRetryFailed(true); } }
    finally { pending.current = false; if (active()) setBusy(false); }
  }
  async function refresh() {
    if (!active() || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage(""); controller.current?.abort(); controller.current = new AbortController();
    try {
      const latest = await readIntegradorReadiness(binding, { userId, signal: controller.current.signal });
      if (!active()) return;
      const old = integradorSettingsDraft(baseline), next = integradorSettingsDraft(latest.settings);
      for (const key of Object.keys(next) as (keyof IntegradorSettingsDraft)[]) if (draft[key] !== old[key]) Object.assign(next, { [key]: draft[key] });
      onConfirmed(latest); setBaseline(latest.settings); setDraft(next); setAcknowledged(false); setRetryFailed(false); request.current = null;
    } catch (failure) { if (active()) showError(failure); }
    finally { pending.current = false; if (active()) setBusy(false); }
  }
  let validation = "";
  try { if (dirty) prepareIntegradorSettingsChanges(draft, baseline); } catch (failure) { validation = integrationErrorMessage(failure); }
  const locked = disabled || busy;
  return <form aria-label="Editar funcionamento do Integrador" className="space-y-4 rounded-lg border p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div><h3 className="font-medium">Configuração e funcionamento</h3><p className="text-xs text-muted-foreground">Estes ajustes são usados pelas próximas rotinas existentes do Integrador, ligadas ao GC. O preço de Mercado Livre aceito no Forge continua no cadastro do produto.</p></div>
    {baseline.can_manage_settings && <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`${prefix}-enabled`}>Rotinas do Integrador</Label><select id={`${prefix}-enabled`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" disabled={locked} value={draft.enabled == null ? "" : String(draft.enabled)} onChange={event => change("enabled", event.target.value === "" ? null : event.target.value === "true")}><option value="">Não informado</option><option value="true">Habilitadas</option><option value="false">Desabilitadas</option></select></div>
      <div><Label htmlFor={`${prefix}-markup`}>Acréscimo do Integrador (%)</Label><Input id={`${prefix}-markup`} inputMode="decimal" value={draft.markup_percent} placeholder="Não informado" disabled={locked} onChange={event => change("markup_percent", event.target.value)} /></div>
      <div><Label htmlFor={`${prefix}-stock`}>Reserva de estoque (unidades)</Label><Input id={`${prefix}-stock`} inputMode="numeric" value={draft.stock_safety} placeholder="Não informado" disabled={locked} onChange={event => change("stock_safety", event.target.value)} /></div>
      <div><Label htmlFor={`${prefix}-listing`}>Tipo padrão de anúncio</Label><select id={`${prefix}-listing`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" disabled={locked} value={draft.listing_type_default} onChange={event => change("listing_type_default", event.target.value)}><option value="">Não informado</option><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option></select></div>
      <div className="sm:col-span-2"><Label htmlFor={`${prefix}-price`}>Tabela de preços usada pelo Integrador</Label><Input id={`${prefix}-price`} maxLength={40} disabled={locked} value={draft.tipo_valor_venda} onChange={event => change("tipo_valor_venda", event.target.value)} /><p className="text-xs text-muted-foreground">Mantenha o código da tabela existente no GC, salvo se quiser mudar a origem do preço dessas rotinas.</p></div></div>}
    {baseline.can_manage_app && <fieldset className="space-y-3 rounded-md border p-3"><legend className="text-sm">Aplicativo Mercado Livre</legend><div><Label htmlFor={`${prefix}-client`}>Client ID do aplicativo</Label><Input id={`${prefix}-client`} value={draft.client_id} disabled={locked || hasConnectedAccounts} onChange={event => change("client_id", event.target.value)} />{hasConnectedAccounts && <p className="text-xs text-muted-foreground">O Client ID fica protegido enquanto houver contas autorizadas.</p>}</div><div><Label htmlFor={`${prefix}-secret`}>Novo segredo do aplicativo</Label><Input id={`${prefix}-secret`} type="password" autoComplete="new-password" maxLength={4096} value={draft.client_secret} disabled={locked} placeholder="Em branco mantém o segredo salvo" onChange={event => change("client_secret", event.target.value)} /></div></fieldset>}
    {dirty && <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} /><span>Entendo que estes ajustes afetam as próximas rotinas de estoque e preço já existentes no Integrador.</span></label><div className="flex flex-wrap gap-2"><Button type="submit" disabled={locked || !acknowledged || !!validation || stale && !retryFailed || !baseline.revision}>{busy ? "Salvando configuração…" : retryFailed ? "Confirmar salvamento da configuração" : "Salvar configuração do Integrador"}</Button><Button type="button" variant="outline" disabled={locked} onClick={() => { setBaseline(value); setDraft(integradorSettingsDraft(value)); setError(""); setMessage(""); setRetryFailed(false); setAcknowledged(false); request.current = null; }}>Descartar ajustes</Button></div></>}
    {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
    {(stale || error) && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error || "A configuração foi alterada por outra operação."}</p><Button type="button" variant="outline" disabled={locked} onClick={() => void refresh()}>Atualizar configuração e manter meus ajustes</Button></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}
