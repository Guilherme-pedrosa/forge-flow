import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { priceChannel } from "@/lib/channel-pricing";
import { readChannelPolicy, saveChannelPolicy, readProductChannelPrices, type CatalogChannelPricingDraft, type ChannelAssumptions, type ChannelKey, type ChannelPolicy, type ProductChannelPrice } from "@/lib/channel-policy";
import { orderRequest } from "@/lib/sales-order";
import { pricingPolicyNumber } from "@/lib/pricing-policy";

const salesChannels = [
  ["direct", "Venda direta / WhatsApp / Instagram"], ["mercado_livre", "Mercado Livre"],
  ["shopee", "Shopee"], ["tiktok", "TikTok Shop"], ["other", "Outro canal"],
] as const;
const fields = [
  ["commission_percent", "Comissão sobre produtos (%)"], ["tax_percent", "Tributo sobre produtos (%)"],
  ["fixed_fee_per_order", "Tarifa fixa por pedido (R$)"], ["fixed_fee_per_item", "Tarifa fixa por unidade (R$)"],
  ["seller_shipping_per_order", "Frete próprio do pacote (R$)"], ["advertising_per_order", "Anúncios atribuídos ao pedido (R$)"],
  ["other_cost_per_order", "Outros gastos do pedido (R$)"], ["target_margin", "Margem desejada neste canal (%)"],
] as const;
type AssumptionDraft = Record<keyof ChannelAssumptions, string>;
export type ChannelPricingPanelState = { scope: string; channel: ChannelKey | "factory"; values: AssumptionDraft; revision: string | null; quantity: string; target: string; dirty: boolean };
type Draft = ChannelPricingPanelState;
export type ChannelPricingSelection = { channel: ChannelKey | "factory"; result: ReturnType<typeof priceChannel> | null; error: string; catalogDraft: CatalogChannelPricingDraft | null };
type Props = { unitCost: number | null; disabled?: boolean; initialDraft?: CatalogChannelPricingDraft | null;
  productId?: string;
  onSelection?: (selection: ChannelPricingSelection) => void; onBusy?: (busy: boolean) => void; showResult?: boolean;
  savedState?: ChannelPricingPanelState | null; onStateChange?: (state: ChannelPricingPanelState) => void;
  targetPrice?: string; onTargetChange?: (value: string) => void };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const draftValues = (values?: ChannelAssumptions): AssumptionDraft => Object.fromEntries(fields.map(([key]) => [key, values?.[key] == null ? "" : String(values[key]).replace(".", ",")])) as AssumptionDraft;
const initialState = (initial?: CatalogChannelPricingDraft | null, scope = ""): Draft => ({ scope, channel: initial?.channel ?? "factory", values: draftValues(initial?.assumptions),
  revision: initial?.expected_policy_revision ?? null, quantity: String(initial?.quantity ?? 1), target: initial?.unit_price == null ? "" : String(initial.unit_price), dirty: !!initial });

export function ChannelPricingPanel(props: Props) {
  const { profile, user } = useAuth();
  const scope = `${profile?.tenant_id}:${user?.id}`;
  return <ChannelPricingSession key={scope} {...props} sessionScope={scope} />;
}

function ChannelPricingSession({ unitCost, disabled = false, initialDraft, onSelection, onBusy, showResult = true, targetPrice, onTargetChange, savedState, onStateChange, sessionScope, productId }: Props & { sessionScope: string }) {
  const { profile, user } = useAuth(); const qc = useQueryClient();
  const alive = useRef(true), currentScope = useRef(sessionScope);
  currentScope.current = `${profile?.tenant_id}:${user?.id}`;
  const active = () => alive.current && currentScope.current === sessionScope;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [draft, setDraft] = useState(() => savedState?.scope === sessionScope ? savedState : initialState(savedState ? null : initialDraft, sessionScope));
  const stateCallback = useRef(onStateChange); stateCallback.current = onStateChange;
  const draftSignature = JSON.stringify(draft);
  useEffect(() => { stateCallback.current?.(JSON.parse(draftSignature)); }, [draftSignature]);
  const [message, setMessage] = useState("");
  const saveRequest = useRef<ReturnType<typeof orderRequest> | null>(null);
  const tenant = profile?.tenant_id;
  const acceptedPrices = useQuery({ queryKey: ["product_channel_prices", tenant, productId], enabled: !!tenant && !!productId, retry: false,
    queryFn: async () => { const rows = await readProductChannelPrices(productId!); if (!Array.isArray(rows)) throw new Error("Não foi possível carregar os preços salvos por canal."); return rows; } });
  const policy = useQuery({ queryKey: ["channel_pricing_policy", tenant, draft.channel], enabled: !!tenant && draft.channel !== "factory",
    queryFn: async () => {
      const value = await readChannelPolicy(draft.channel as ChannelKey);
      if (!value || value.channel !== draft.channel || typeof value.revision !== "string" || !value.assumptions || typeof value.configured !== "boolean")
        throw new Error("Não foi possível conferir as condições cadastradas deste canal.");
      return value;
    } });
  useEffect(() => {
    if (!policy.data || policy.data.channel !== draft.channel || draft.revision != null) return;
    setDraft(current => current.channel !== policy.data!.channel || current.revision != null ? current : { ...current, values: draftValues(policy.data!.assumptions), revision: policy.data!.revision, dirty: false });
  }, [draft.channel, draft.revision, policy.data]);
  const stale = !!policy.data && draft.revision != null && policy.data.revision !== draft.revision;
  const calculation = useMemo(() => {
    if (draft.channel === "factory") return { channel: "factory", result: null, error: "", catalogDraft: null } as ChannelPricingSelection;
    try {
      if (policy.isError || !tenant) throw new Error("Não foi possível carregar as condições deste canal. Tente novamente.");
      if (!policy.data || draft.revision == null || policy.isFetching) throw new Error("Conferindo condições do canal…");
      if (stale) throw new Error("As condições da empresa mudaram. Confira a versão atual antes de salvar o preço.");
      if (unitCost == null) throw new Error("Conclua o custo do produto antes de calcular a venda neste canal.");
      const assumptions = Object.fromEntries(fields.map(([key, label]) => {
        const amount = pricingPolicyNumber(draft.values[key], label, key === "target_margin", key.endsWith("percent") ? 100 : 1000000);
        if (amount == null) throw new Error(`Confirme ${label}, inclusive zero quando não houver esse custo.`);
        return [key, amount];
      })) as ChannelAssumptions;
      const result = priceChannel({ unitCost, orderQuantity: draft.quantity, commissionPercent: assumptions.commission_percent!, taxPercent: assumptions.tax_percent!,
        fixedFeePerOrder: assumptions.fixed_fee_per_order!, fixedFeePerItem: assumptions.fixed_fee_per_item!, sellerShippingPerOrder: assumptions.seller_shipping_per_order!,
        advertisingPerOrder: assumptions.advertising_per_order!, otherCostPerOrder: assumptions.other_cost_per_order!, marginPercent: assumptions.target_margin!, targetUnitPrice: targetPrice ?? draft.target });
      if (result.target < .01 || Math.abs(result.target * 100 - Math.round(result.target * 100)) > 1e-7) throw new Error("Informe um preço de pelo menos R$ 0,01 com até duas casas decimais.");
      return { channel: draft.channel, result, error: "", catalogDraft: { channel: draft.channel, quantity: result.quantity, assumptions,
        expected_policy_revision: draft.revision, quoted_unit_cost: unitCost, unit_price: result.target } } as ChannelPricingSelection;
    } catch (error) { return { channel: draft.channel, result: null, error: (error as Error).message, catalogDraft: null } as ChannelPricingSelection; }
  }, [draft, policy.data, policy.isError, policy.isFetching, stale, tenant, unitCost, targetPrice]);
  const selectionCallback = useRef(onSelection); selectionCallback.current = onSelection;
  const signature = JSON.stringify(calculation);
  useEffect(() => { selectionCallback.current?.(JSON.parse(signature)); }, [signature]);
  const save = useMutation({ mutationFn: async () => {
    if (!active()) return;
    if (!policy.data || draft.revision == null || draft.channel === "factory") throw new Error("Atualize as condições antes de salvar.");
    // Unknown fields are retained as unknown. Saving an incomplete policy must
    // not manufacture a complete price or confirm any implicit zero.
    const assumptions = Object.fromEntries(fields.map(([key, label]) => [key, pricingPolicyNumber(draft.values[key], label, key === "target_margin", key.endsWith("percent") ? 100 : 1000000)])) as ChannelAssumptions;
    const payload = { tenant, channel: draft.channel, assumptions, revision: draft.revision };
    if (stale && saveRequest.current?.signature !== JSON.stringify(payload)) throw new Error("Atualize as condições antes de salvar.");
    saveRequest.current = orderRequest(saveRequest.current, JSON.stringify(payload));
    await saveChannelPolicy(draft.channel, assumptions, draft.revision, saveRequest.current.id);
    if (!active()) return;
    const saved = await readChannelPolicy(draft.channel);
    if (!active()) return;
    qc.setQueryData(["channel_pricing_policy", tenant, draft.channel], saved);
    setDraft(current => current.channel === saved.channel ? { ...current, revision: saved.revision, dirty: false } : current);
    await qc.invalidateQueries({ queryKey: ["product_channel_pricing_preview", tenant] });
  }, onSuccess: () => { if (active()) setMessage("Condições salvas para reutilizar neste canal."); }, onError: () => { if (active()) { setMessage(""); void policy.refetch(); } } });
  useEffect(() => { onBusy?.(save.isPending); return () => onBusy?.(false); }, [onBusy, save.isPending]);
  const waiting = disabled || save.isPending || policy.isFetching;
  function reload(value: ChannelPolicy) { save.reset(); saveRequest.current = null; setDraft(current => ({ ...current, revision: value.revision, values: draftValues(value.assumptions), dirty: false })); setMessage(""); }
  function editAccepted(value: ProductChannelPrice) {
    const next = initialState({ channel: value.channel, assumptions: value.assumptions, quantity: value.quantity, unit_price: value.unit_price,
      quoted_unit_cost: value.unit_cost, expected_policy_revision: value.policy_revision }, sessionScope);
    selectionCallback.current?.({ channel: value.channel, result: null, error: "Conferindo o preço aceito neste canal…", catalogDraft: null });
    setDraft(next); onTargetChange?.(String(value.unit_price)); save.reset(); saveRequest.current = null; setMessage("");
  }
  return <section aria-label="Preço por canal" className="space-y-3 rounded-lg border bg-muted/10 p-4">
    <div><h3 className="font-semibold">Venda por canal</h3><p className="text-sm text-muted-foreground">As condições cadastradas são reutilizadas. O preço de cada canal é salvo separado do preço base do produto.</p></div>
    {!!acceptedPrices.data?.length && <div aria-label="Preços salvos por canal" className="space-y-2">{acceptedPrices.data.map(row => <div key={row.channel} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm"><p><strong>{salesChannels.find(([key]) => key === row.channel)?.[1] ?? row.channel}</strong> · {money(row.unit_price)} / un. · pedido de {row.quantity} un.</p><Button type="button" variant="outline" disabled={disabled || save.isPending} onClick={() => editAccepted(row)}>Conferir preço de {salesChannels.find(([key]) => key === row.channel)?.[1] ?? row.channel}</Button></div>)}</div>}
    {acceptedPrices.isError && <p role="status" className="text-sm text-muted-foreground">Não foi possível carregar os preços aceitos por canal. <Button type="button" variant="link" onClick={() => void acceptedPrices.refetch()}>Atualizar preços salvos</Button></p>}
    <div><Label htmlFor="catalog-pricing-channel">Canal de venda</Label><select id="catalog-pricing-channel" className="mt-1 h-11 w-full rounded-md border bg-background px-3" value={draft.channel} disabled={disabled || save.isPending}
      onChange={event => {
        const channel = event.target.value as Draft["channel"];
        selectionCallback.current?.({ channel, result: null, error: channel === "factory" ? "" : "Conferindo condições do canal…", catalogDraft: null });
        setDraft({ ...initialState(null, sessionScope), channel }); save.reset(); saveRequest.current = null; setMessage("");
      }}>
      <option value="factory">Somente preço base do produto</option>{salesChannels.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></div>
    {draft.channel !== "factory" && <>
      {!policy.data?.configured && <p className="text-sm text-muted-foreground">Complete as condições da sua conta. Campos vazios continuam pendentes; informe zero quando não houver cobrança.</p>}
      {stale && policy.data && <div role="alert" className="space-y-2 text-sm"><p>As condições da empresa foram alteradas em outra operação.</p><Button type="button" variant="outline" onClick={() => reload(policy.data!)}>Carregar condições atualizadas</Button><Button type="button" variant="outline" onClick={() => { save.reset(); saveRequest.current = null; setDraft(current => ({ ...current, revision: policy.data!.revision })); }}>Manter os ajustes deste produto</Button></div>}
      {policy.isError && <Button type="button" variant="outline" onClick={() => void policy.refetch()}>Tentar carregar condições novamente</Button>}
      <div><Label htmlFor="catalog-channel-quantity">Unidades por pedido / pacote</Label><Input id="catalog-channel-quantity" type="number" min="1" max="10000" value={draft.quantity} disabled={waiting} onChange={event => setDraft(current => ({ ...current, quantity: event.target.value }))} /></div>
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(([key, label]) => <div key={key}><Label htmlFor={`catalog-channel-${key}`}>{label}</Label><Input id={`catalog-channel-${key}`} inputMode="decimal" value={draft.values[key]} disabled={waiting || draft.revision == null} placeholder="Confirmar"
        onChange={event => { setDraft(current => ({ ...current, dirty: true, values: { ...current.values, [key]: event.target.value } })); setMessage(""); }} /></div>)}</div>
      <p className="text-xs text-muted-foreground">Comissão e tributo incidem sobre a receita dos produtos. Tarifa por unidade acompanha a quantidade; tarifa por pedido, frete e demais gastos entram uma vez no pacote. Embalagem já incluída no custo não deve ser repetida.</p>
      <Button type="button" variant="outline" disabled={waiting || !policy.data || stale && !save.isError || !draft.dirty} onClick={() => save.mutate()}>{save.isError ? "Confirmar salvamento das condições" : "Salvar condições deste canal na empresa"}</Button>
      {message && <p role="status" className="text-sm">{message}</p>}{save.error && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
      {targetPrice === undefined && <div><Label htmlFor="catalog-channel-price">Preço escolhido neste canal (R$)</Label><Input id="catalog-channel-price" inputMode="decimal" value={draft.target} placeholder={calculation.result ? String(calculation.result.suggested).replace(".", ",") : "Calculado após confirmar os custos"} disabled={waiting} onChange={event => { setDraft(current => ({ ...current, target: event.target.value })); onTargetChange?.(event.target.value); }} /></div>}
      {calculation.error && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">{calculation.error}</p>}
      {showResult && calculation.result && <div className="space-y-2 rounded-lg bg-muted p-3 text-sm" data-testid="channel-pricing-result">
        <p>Preço sugerido no canal: <strong>{money(calculation.result.suggested)} / un.</strong></p><p>Preço escolhido: {money(calculation.result.target)} · Equilíbrio: {money(calculation.result.breakEven)} / un.</p>
        <dl className="grid gap-2 sm:grid-cols-2">{[["Custo do produto no pedido", calculation.result.manufacturingCost], ["Comissão", calculation.result.commission], ["Tributo parametrizado", calculation.result.tax], ["Tarifas por pedido e unidades", calculation.result.fixedFee + calculation.result.itemFees], ["Frete e demais gastos", calculation.result.sellerShipping + calculation.result.advertising + calculation.result.otherCost], ["Resultado após custos informados", calculation.result.includedResult]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="font-medium">{money(Number(value))}</dd></div>)}</dl>
      </div>}
    </>}
  </section>;
}
