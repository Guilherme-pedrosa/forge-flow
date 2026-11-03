import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { orderRequest } from "@/lib/sales-order";
import type { MarketplaceAccount } from "@/lib/marketplace-orders";
import { beginIntegradorEnrollment, finishIntegradorEnrollment, integrationErrorMessage, openIntegradorAuthorization, validIntegradorEnrollmentReceipt,
  type IntegradorBridgeBinding, type IntegradorEnrollmentResult } from "@/lib/mercado-livre-integration";

type Props = { binding: IntegradorBridgeBinding; tenantId: string; userId: string; accounts: MarketplaceAccount[]; allowed: boolean | null; configured: boolean | null;
  expectedClientId?: string | null;
  connectedAccount?: { seller_id: string; nickname: string | null } | null;
  callbackReceipt?: string | null; callbackError?: string | null; disabled?: boolean; onConnected: (result: IntegradorEnrollmentResult) => void | Promise<void>;
  onReceiptConsumed?: () => void; onBusyChange?: (busy: boolean) => void };
function connectionError(failure: unknown): string {
  const raw = integrationErrorMessage(failure);
  if (/already.*legacy|legacy.*account|seller_already|conta.*(?:anterior|outro vínculo)|vendedor.*(?:anterior|outro vínculo)/i.test(raw)) return "Esta conta já pertence a outro cadastro do Integrador. Entre na conta Mercado Livre correta da Elevare3D e comece novamente. Nenhuma conta anterior foi substituída.";
  if (/receipt.*(?:expired|invalid)|enrollment.*(?:expired|invalid)|expirad/i.test(raw)) return "A autorização expirou ou não pôde ser validada. Conecte a conta novamente pelo botão abaixo.";
  if (/receipt.*(?:actor|user|tenant)|enrollment.*(?:actor|user|tenant)|original.*(?:user|operator)|sessão mudou/i.test(raw)) return "Entre no Forge com o mesmo usuário e empresa que iniciaram esta conexão. A conta não foi ativada nesta sessão.";
  return raw;
}
export function IntegradorAccountConnection({ binding, tenantId, userId, accounts, allowed, configured, expectedClientId, connectedAccount, callbackReceipt, callbackError, disabled = false, onConnected, onReceiptConsumed, onBusyChange }: Props) {
  const prefix = useId(), scope = `${tenantId}:${userId}:${binding.bridge_id}`;
  const alive = useRef(true), currentScope = useRef(scope); currentScope.current = scope;
  const active = useCallback(() => alive.current && currentScope.current === scope, [scope]);
  const controller = useRef<AbortController | null>(null), pending = useRef(false), attempted = useRef<string | null>(null);
  const generation = useRef(0), latestReceipt = useRef(callbackReceipt); latestReceipt.current = callbackReceipt;
  const latestApp = useRef(expectedClientId); latestApp.current = expectedClientId;
  const previousContext = useRef({ receipt: callbackReceipt, clientId: expectedClientId });
  const targetInitialized = useRef(false), targetTouched = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null), finishRequest = useRef<{ signature: string; id: string } | null>(null);
  const [target, setTarget] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(false), [completed, setCompleted] = useState<IntegradorEnrollmentResult | null>(null);
  const confirmed = connectedAccount === undefined ? completed : connectedAccount;
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const appChanged = previousContext.current.clientId !== expectedClientId;
    if (previousContext.current.receipt === callbackReceipt && !appChanged) return;
    previousContext.current = { receipt: callbackReceipt, clientId: expectedClientId }; ++generation.current; controller.current?.abort(); pending.current = false;
    setBusy(false); setRetry(false); setError(""); if (callbackReceipt || appChanged) setCompleted(null);
  }, [callbackReceipt, expectedClientId]);
  const eligible = accounts.filter(account => account.channel === "mercado_livre" && !account.external_seller_id && ["pending_credentials", "pending_access", "import_only"].includes(account.connection_state));
  useEffect(() => {
    if (targetInitialized.current || targetTouched.current || eligible.length !== 1) return;
    targetInitialized.current = true; setTarget(eligible[0].id);
  }, [eligible]);
  const callbackValid = !!callbackReceipt && validIntegradorEnrollmentReceipt(callbackReceipt);
  const callbackPending = callbackValid && !retry && !completed;
  async function finish() {
    if (!active() || pending.current || disabled || allowed === false || configured === false || !callbackValid) return;
    const version = ++generation.current, receipt = callbackReceipt;
    const current = () => active() && generation.current === version && latestReceipt.current === receipt && latestApp.current === expectedClientId;
    pending.current = true; setBusy(true); setRetry(false); setError(""); controller.current?.abort(); controller.current = new AbortController();
    try {
      finishRequest.current = orderRequest(finishRequest.current, JSON.stringify([scope, callbackReceipt]));
      const result = await finishIntegradorEnrollment(binding, callbackReceipt!, finishRequest.current.id, { userId, signal: controller.current.signal });
      if (!current()) return;
      // The Source completed the verified enrollment and Forge association atomically. No browser token/link write follows.
      setCompleted(result); onReceiptConsumed?.(); await onConnected(result);
    } catch (failure) { if (current()) { setError(connectionError(failure)); setRetry(true); } }
    finally { if (generation.current === version) pending.current = false; if (current()) setBusy(false); }
  }
  const finishLatest = useRef(finish); finishLatest.current = finish;
  useEffect(() => {
    if (!callbackValid || allowed !== true || configured === false || disabled || attempted.current === callbackReceipt) return;
    // Defer until the mounted auth scope is stable; StrictMode cleanup cancels the first scheduled attempt.
    const timer = setTimeout(() => { if (active() && attempted.current !== callbackReceipt) { attempted.current = callbackReceipt!; void finishLatest.current(); } }, 0);
    return () => clearTimeout(timer);
  }, [callbackReceipt, callbackValid, allowed, configured, disabled, scope, active]);
  async function begin() {
    if (!active() || pending.current || disabled || allowed === false || configured === false || !target) return;
    if (target !== "new" && !eligible.some(account => account.id === target)) { setError("Escolha um cadastro pendente válido para conectar a Elevare3D."); return; }
    const version = ++generation.current, receipt = callbackReceipt;
    const current = () => active() && generation.current === version && latestReceipt.current === receipt && latestApp.current === expectedClientId;
    pending.current = true; setBusy(true); setError(""); setRetry(false); controller.current?.abort(); controller.current = new AbortController();
    try {
      request.current = orderRequest(request.current, JSON.stringify([scope, target, window.location.origin]));
      const result = await beginIntegradorEnrollment(binding, target === "new" ? null : target, window.location.origin, request.current.id, { userId, signal: controller.current.signal });
      if (!current()) return;
      if (expectedClientId && new URL(result.authorization_url).searchParams.get("client_id") !== expectedClientId) throw new Error("A autorização retornou outro aplicativo. Confira a sua API antes de conectar a conta.");
      onReceiptConsumed?.(); openIntegradorAuthorization(result.authorization_url);
    } catch (failure) { if (current()) setError(connectionError(failure)); }
    finally { if (generation.current === version) pending.current = false; if (current()) setBusy(false); }
  }
  return <section aria-label="Conectar minha conta Mercado Livre" className="space-y-3 rounded-lg border p-4">
    <div><h3 className="font-semibold">{confirmed ? "2. Conta Elevare3D conectada" : "2. Conecte sua conta Elevare3D"}</h3><p className="text-sm text-muted-foreground">{confirmed ? "Confira os anúncios e pedidos desta conta no Forge." : "Depois de salvar sua API, conecte a conta Mercado Livre que vende pela Elevare3D. A autorização abre no site oficial e retorna a este cadastro no Forge."}</p></div>
    {!confirmed && <p className="text-sm">Entre na conta administradora Elevare3D no Mercado Livre antes de autorizar; confira a conta exibida pelo Mercado Livre.</p>}
    {confirmed ? <p role="status" className="text-sm">Conta conectada: {confirmed.nickname || "Elevare3D"} · vendedor {confirmed.seller_id}. Os anúncios e pedidos desta conta já podem ser conferidos abaixo.</p>
      : <><div><Label htmlFor={`${prefix}-target`}>Cadastro no Forge para esta conexão</Label><select id={`${prefix}-target`} className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={target} disabled={disabled || busy || callbackPending} onChange={event => { targetTouched.current = true; setTarget(event.target.value); request.current = null; setError(""); }}><option value="">Escolha o cadastro da Elevare3D</option><option value="new">Criar novo cadastro da Elevare3D</option>{eligible.map(account => <option key={account.id} value={account.id}>{account.name} · cadastro pendente</option>)}</select></div>
      <Button type="button" disabled={disabled || busy || allowed === false || configured === false || !target || callbackPending} onClick={() => void begin()}>Conectar Mercado Livre</Button>
      {(allowed === null || configured === null) && <p className="text-sm text-muted-foreground">A conexão ainda não foi conferida. Ao continuar, vamos validar o acesso antes de abrir o Mercado Livre.</p>}
      {allowed === false && <p className="text-sm text-muted-foreground">A conexão de novas contas precisa ser habilitada para esta empresa e para um usuário responsável.</p>}
      {configured === false && <p className="text-sm text-muted-foreground">Salve e confirme a configuração da sua API na etapa 1 antes de conectar a conta.</p>}
      {callbackReceipt && !callbackValid && <p role="alert" className="text-sm text-destructive">O retorno da autorização não trouxe um recibo válido. Comece a conexão novamente.</p>}
      {(retry || allowed === null) && callbackValid && <Button type="button" variant="outline" disabled={disabled || busy || allowed === false || configured === false} onClick={() => void finish()}>Conferir conclusão desta conexão</Button>}
    </>}
    {busy && <p role="status" className="text-sm">{callbackReceipt && !completed ? "Conferindo a autorização e o cadastro da conta…" : "Abrindo a autorização oficial do Mercado Livre…"}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {callbackError && !confirmed && <p role="alert" className="text-sm text-destructive">O retorno da autorização expirou ou já foi usado. Conecte a conta novamente para continuar.</p>}
    <p className="text-xs text-muted-foreground">As credenciais ficam no servidor. Conectar a conta não publica estoque nem altera preços no Mercado Livre.</p>
  </section>;
}
