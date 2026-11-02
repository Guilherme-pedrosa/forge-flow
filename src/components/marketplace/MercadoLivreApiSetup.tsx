import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orderRequest } from "@/lib/sales-order";
import { INTEGRADOR_OAUTH_CALLBACK, integrationErrorMessage, integradorSettingsSignature, readIntegradorReadiness, saveIntegradorEnrollmentApp,
  type IntegradorBridgeBinding, type IntegradorEnrollmentApp, type MercadoLivreReadiness } from "@/lib/mercado-livre-integration";

type Props = { binding: IntegradorBridgeBinding; tenantId: string; userId: string; value: IntegradorEnrollmentApp | null; disabled?: boolean;
  onConfirmed: (value: MercadoLivreReadiness) => void; onBusyChange?: (busy: boolean) => void };
type Draft = { clientId: string; secret: string };
const draftFrom = (value: IntegradorEnrollmentApp | null): Draft => ({ clientId: value?.client_id || "", secret: "" });
export function MercadoLivreApiSetup({ binding, tenantId, userId, value, disabled = false, onConfirmed, onBusyChange }: Props) {
  const prefix = useId(), scope = `${tenantId}:${userId}:${binding.bridge_id}`;
  const alive = useRef(true), currentScope = useRef(scope); currentScope.current = scope;
  const active = () => alive.current && currentScope.current === scope;
  const controller = useRef<AbortController | null>(null), pending = useRef(false), request = useRef<{ signature: string; id: string } | null>(null);
  const previousValue = useRef(value);
  const [baseline, setBaseline] = useState(value), [draft, setDraft] = useState<Draft>(() => draftFrom(value));
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const dirty = draft.clientId !== (baseline?.client_id || "") || !!draft.secret;
  const stale = !!value && !!baseline && value.revision !== baseline.revision;
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const changed = previousValue.current !== value; previousValue.current = value;
    if (changed && !dirty && !busy) { setBaseline(value); setDraft(draftFrom(value)); }
  }, [value, dirty, busy]);
  function change(key: keyof Draft, next: string) { setDraft(previous => ({ ...previous, [key]: next })); setRetry(false); setError(""); setMessage(""); }
  function showError(failure: unknown) {
    const text = integrationErrorMessage(failure), secret = draft.secret.trim();
    setError(secret ? text.split(secret).join("[omitido]") : text);
  }
  async function save() {
    if (!active() || pending.current || disabled || !dirty || baseline?.can_manage === false) return;
    if (!/^\d{1,40}$/.test(draft.clientId.trim())) { setError("Informe o Client ID da sua API, usando somente números."); return; }
    if (draft.secret.trim().length > 400) { setError("Confira o Client Secret da sua API."); return; }
    pending.current = true; setBusy(true); setError(""); setMessage(""); controller.current?.abort(); controller.current = new AbortController();
    try {
      const context = { userId, signal: controller.current.signal };
      let original = baseline;
      if (!original) {
        const latest = await readIntegradorReadiness(binding, context);
        if (!active()) return;
        if (!latest.enrollment_app) throw new Error("A configuração da sua API ainda não foi confirmada. Atualize a consulta e tente novamente.");
        original = latest.enrollment_app; setBaseline(original); onConfirmed(latest);
      }
      if (!original.can_manage) throw new Error("Um responsável financeiro desta empresa precisa salvar a configuração da API.");
      const secret = draft.secret.trim();
      if (!secret && !original.client_secret_configured) throw new Error("Preencha o Client Secret da sua API para concluir a configuração.");
      if (!secret && draft.clientId.trim() !== original.client_id) throw new Error("Informe o Client Secret do novo Client ID para trocar o aplicativo.");
      const changes = { client_id: draft.clientId.trim(), ...(secret ? { client_secret: secret } : {}) };
      const signature = await integradorSettingsSignature(changes, original.revision);
      if (!active()) return;
      if (stale && !(retry && request.current?.signature === signature)) throw new Error("A configuração da API mudou. Atualize a consulta e confira seus dados antes de salvar.");
      request.current = orderRequest(request.current, signature);
      const latest = await saveIntegradorEnrollmentApp(binding, changes, original.revision, request.current.id, context);
      if (!active()) return;
      if (!latest.enrollment_app?.configured || latest.enrollment_app.client_id !== changes.client_id) throw new Error("O salvamento ainda não confirmou a API informada. Confira a conexão e tente novamente.");
      onConfirmed(latest); setBaseline(latest.enrollment_app); setDraft(draftFrom(latest.enrollment_app)); setRetry(false); request.current = null;
      setMessage("Sua API foi salva. Agora você pode conectar a conta Mercado Livre abaixo.");
    } catch (failure) { if (active()) { showError(failure); setRetry(true); } }
    finally { pending.current = false; if (active()) setBusy(false); }
  }
  async function refresh() {
    if (!active() || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage(""); controller.current?.abort(); controller.current = new AbortController();
    try {
      const latest = await readIntegradorReadiness(binding, { userId, signal: controller.current.signal });
      if (!active()) return;
      if (!latest.enrollment_app) throw new Error("A configuração da sua API ainda não foi confirmada. Tente consultar novamente.");
      const previous = draftFrom(baseline), next = draftFrom(latest.enrollment_app);
      if (draft.clientId !== previous.clientId) next.clientId = draft.clientId;
      next.secret = draft.secret;
      onConfirmed(latest); setBaseline(latest.enrollment_app); setDraft(next); setRetry(false); request.current = null;
    } catch (failure) { if (active()) showError(failure); }
    finally { pending.current = false; if (active()) setBusy(false); }
  }
  async function copyCallback() {
    try { await navigator.clipboard.writeText(INTEGRADOR_OAUTH_CALLBACK); if (active()) setMessage("URL de retorno copiada."); }
    catch { if (active()) setError("Selecione e copie a URL de retorno exibida abaixo."); }
  }
  const locked = disabled || busy;
  return <form aria-label="Configurar minha API Mercado Livre" className="space-y-4 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div><h3 className="font-semibold">1. Configure sua API do Mercado Livre</h3><p className="text-sm text-muted-foreground">Use o aplicativo da Elevare3D. As credenciais abaixo ficam separadas das contas já existentes no Integrador.</p></div>
    <ol className="list-decimal space-y-1 pl-5 text-sm"><li>Crie ou edite seu aplicativo no <a className="underline" href="https://developers.mercadolivre.com.br/devcenter" target="_blank" rel="noreferrer">portal oficial de desenvolvedores do Mercado Livre</a>.</li><li>Cadastre a URL HTTPS de retorno abaixo, habilite Authorization Code, Refresh Token e PKCE. Nas permissões, use publicação e sincronização com leitura e escrita e vendas e envios com leitura.</li><li>Copie o Client ID e o Client Secret para estes campos, salve e depois conecte sua conta.</li></ol>
    <div><Label htmlFor={`${prefix}-callback`}>URL de retorno (Redirect URI)</Label><div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1" id={`${prefix}-callback`} value={INTEGRADOR_OAUTH_CALLBACK} readOnly /><Button type="button" variant="outline" onClick={() => void copyCallback()}>Copiar URL de retorno</Button></div></div>
    <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`${prefix}-client`}>Client ID da sua API</Label><Input id={`${prefix}-client`} value={draft.clientId} inputMode="numeric" maxLength={40} autoComplete="off" disabled={locked || baseline?.can_manage === false} onChange={event => change("clientId", event.target.value)} /></div><div><Label htmlFor={`${prefix}-secret`}>Client Secret da sua API</Label><Input id={`${prefix}-secret`} value={draft.secret} type="password" autoComplete="new-password" maxLength={400} spellCheck={false} disabled={locked || baseline?.can_manage === false} placeholder={baseline?.client_secret_configured ? "Em branco mantém o segredo salvo" : "Cole o segredo da sua API"} onChange={event => change("secret", event.target.value)} /></div></div>
    <p className="text-xs text-muted-foreground">{baseline?.client_secret_configured ? "Há um segredo salvo para a sua API; seu valor não é exibido." : "O segredo será preenchido aqui e não deve ser enviado pelo chat."} Salvar a API não autoriza uma loja nem publica estoque ou preços.</p>
    {baseline?.can_manage === false && <p className="text-sm text-muted-foreground">Somente um responsável financeiro desta empresa pode alterar a API.</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={locked || !dirty || baseline?.can_manage === false}>{busy ? "Salvando minha API…" : retry ? "Confirmar salvamento da minha API" : "Salvar minha API"}</Button><Button type="button" variant="outline" disabled={locked} onClick={() => void refresh()}>Conferir API e manter meus dados</Button></div>
    {stale && <p role="alert" className="text-sm text-destructive">A configuração da API mudou. Confira a versão atual antes de salvar; seus campos serão mantidos.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}
