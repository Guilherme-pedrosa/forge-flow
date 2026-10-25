import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/finance";
import { priceChannel } from "@/lib/channel-pricing";
import { readPricingSettings } from "@/lib/pricing-policy";
import {
  applyProductPricing, costLabels, previewProductPricing, pricingNumber, pricingProductionRows,
  readProductPricingPlan, saveProductPricingPlan,
  type CostBreakdown, type PricingPlan, type ProductPricingPreview,
} from "@/lib/product-pricing";

const money = (value: number | null | undefined) => value == null ? "Não informado" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const decimal = (value: number | null | undefined, unit = "") => value == null ? "Não informado" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}${unit}`;
const sourceLabel: Record<string, string> = { bambu_verified: "Referência Bambu aprovada", confirmed_recipe: "Consumo confirmado", slice_plan: "Plano do fatiador" };
const inputStyle = "mt-1 w-full rounded-md border bg-background p-2 text-sm";

export default function ProductPricingWorkspace({ productId, onProductChange }: { productId: string; onProductChange: (id: string) => void }) {
  const { profile } = useAuth();
  const products = useQuery({
    queryKey: ["pricing-products", profile?.tenant_id], enabled: !!profile?.tenant_id,
    queryFn: () => allRows((a, b) => supabase.from("products").select("id,name,sku").eq("is_active", true).order("name").order("id").range(a, b)),
  });
  return <div className="space-y-5">
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Qual produto vamos precificar?</h2>
      <SearchableItemSelect value={productId} onChange={onProductChange}
        options={(products.data ?? []).map(p => ({ id: p.id, label: p.name, description: p.sku || undefined }))}
        label="Produto para precificar" emptyLabel="Selecione um produto cadastrado" searchPlaceholder="Digite nome ou SKU..." />
      <p className="text-sm text-muted-foreground">A composição, os filamentos, as placas e os tempos vêm do cadastro do produto. Os parâmetros de custos vêm das configurações.</p>
      {products.error && <p role="alert" className="text-destructive">Não foi possível carregar os produtos. Tente novamente.</p>}
    </section>
    {productId ? <ProductPricingSession key={`${profile?.tenant_id}:${productId}`} productId={productId} /> :
      <p className="rounded-xl border border-dashed p-6 text-muted-foreground">Selecione o produto acima para conferir cada peça, calcular o custo e definir o preço de venda.</p>}
  </div>;
}

function Breakdown({ value, pending = false }: { value: CostBreakdown; pending?: boolean }) {
  return <dl className="space-y-2 text-sm">{Object.entries(costLabels).map(([key, label]) => <div key={key} className="flex justify-between gap-3">
    <dt>{label}</dt><dd className="text-right tabular-nums">{money(value[key as keyof typeof costLabels])}</dd>
  </div>)}
    <div className="flex justify-between gap-3 border-t pt-3 font-semibold"><dt>Custo para a quantidade</dt><dd>{pending ? "Pendente" : money(value.total_lot)}</dd></div>
    <div className="flex justify-between gap-3 text-lg font-semibold"><dt>Custo por unidade</dt><dd>{pending ? "Pendente" : money(value.unit_cost)}</dd></div>
  </dl>;
}

function ProductPricingSession({ productId }: { productId: string }) {
  const { profile } = useAuth();
  const tenant = profile?.tenant_id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [quantityInput, setQuantityInput] = useState("1");
  const [changes, setChanges] = useState<PricingPlan>({});
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  const [channel, setChannel] = useState("factory");
  const [channelInputs, setChannelInputs] = useState({ commissionPercent: "0", taxPercent: "0", fixedFeePerOrder: "0", sellerShippingPerOrder: "0", advertisingPerOrder: "0", otherCostPerOrder: "0", variableUnitCost: "" });
  const quantity = /^\d+$/.test(quantityInput) ? Number(quantityInput) : 0;
  const validQuantity = quantity >= 1 && quantity <= 10000;
  const policy = useQuery({ queryKey: ["pricing_settings", tenant], queryFn: readPricingSettings, enabled: !!tenant });
  const plan = useQuery({ queryKey: ["product_pricing_plan", tenant, productId], queryFn: () => readProductPricingPlan(productId), enabled: !!tenant });
  const effectivePlan: PricingPlan = { ...plan.data?.plan, ...changes };
  const basis = effectivePlan.cost_basis ?? "unit";
  const consumables = effectivePlan.consumables ?? [];
  const validPlan = !consumables.some(c => !c.item_id || c.quantity <= 0);
  const overrides = useMemo(() => ({ ...changes, cost_basis: basis }), [changes, basis]);
  const preview = useQuery({
    queryKey: ["product_pricing_preview", tenant, productId, quantity, overrides, plan.data?.revision, policy.data?.revision],
    queryFn: () => previewProductPricing(productId, quantity, overrides),
    enabled: !!tenant && !!plan.data && validQuantity && !fieldError && validPlan,
    placeholderData: keepPreviousData,
  });
  const printers = useQuery({
    queryKey: ["pricing-printers", tenant], enabled: !!tenant,
    queryFn: () => allRows((a, b) => supabase.from("printers").select("id,name").eq("is_active", true).order("name").order("id").range(a, b)),
  });
  const items = useQuery({
    queryKey: ["pricing-consumables", tenant], enabled: !!tenant,
    queryFn: () => allRows((a, b) => supabase.from("inventory_items").select("id,name,unit,avg_cost").eq("is_active", true).order("name").order("id").range(a, b)),
  });
  const result = validQuantity && !fieldError ? preview.data : undefined;
  const rows = result ? pricingProductionRows(result) : { components: [], plates: [], runs: [] };
  const commercial = useMemo(() => {
    if (channel === "factory" || !result?.complete) return { value: null, error: "" };
    try { return { value: priceChannel({ ...channelInputs, orderQuantity: quantity, unitCost: result.breakdown.unit_cost!, marginPercent: result.margin_percent!, targetUnitPrice: target }), error: "" }; }
    catch (error) { return { value: null, error: (error as Error).message }; }
  }, [channel, channelInputs, quantity, result, target]);
  let targetPrice: number | null = null;
  let targetError = "";
  try {
    targetPrice = target.trim() ? pricingNumber(target, "Preço alvo", 1e9) : result?.suggested_unit_price ?? null;
    if (target.trim() && targetPrice != null && (targetPrice < .01 || Math.abs(Math.round(targetPrice * 100) - targetPrice * 100) > 1e-7)) throw new Error("Informe um preço de pelo menos R$ 0,01, com até duas casas decimais.");
  }
  catch (error) { targetError = (error as Error).message; }
  const selectedPrice = channel === "factory" ? targetPrice : commercial.value?.target;
  const canApply = !!result?.complete && validPlan && !preview.isError && !plan.isError && !preview.isFetching && !preview.isPlaceholderData && !targetError && !commercial.error && selectedPrice != null && selectedPrice >= .01;

  async function invalidatePricing() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["product_pricing_preview", tenant, productId] }),
      qc.invalidateQueries({ queryKey: ["products"] }), qc.invalidateQueries({ queryKey: ["product", productId] }),
      qc.invalidateQueries({ queryKey: ["product-workspace"] }),
    ]);
  }
  const savePlan = useMutation({
    mutationFn: async () => {
      if (!plan.data || fieldError || !validPlan) throw new Error("Confira os parâmetros antes de salvar.");
      await saveProductPricingPlan(productId, { ...effectivePlan, cost_basis: basis }, plan.data.revision, crypto.randomUUID());
      const saved = await readProductPricingPlan(productId);
      qc.setQueryData(["product_pricing_plan", tenant, productId], saved);
      setChanges({});
      await invalidatePricing();
    },
    onSuccess: () => setMessage("Plano salvo. Tempos, impressoras e insumos serão usados nas próximas simulações deste produto."),
    onError: () => setMessage(""),
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (!canApply || !result || selectedPrice == null) throw new Error("Atualize a prévia e resolva as pendências antes de aplicar.");
      await applyProductPricing(productId, quantity, overrides, result.revision, selectedPrice, crypto.randomUUID());
      await Promise.all([qc.invalidateQueries({ queryKey: ["product_pricing_plan", tenant, productId] }), invalidatePricing()]);
    },
    onSuccess: () => setMessage("Custo e preço aplicados ao cadastro do produto."),
    onError: () => setMessage(""),
  });
  const pending = savePlan.isPending || apply.isPending;

  function update(key: keyof PricingPlan, raw: string) {
    setMessage("");
    try {
      const number = pricingNumber(raw, "Parâmetro", key === "target_margin" ? 99.999999 : key === "overhead_percent" ? 1000 : 1000000);
      setChanges(current => ({ ...current, [key]: number }));
      setFieldError("");
    } catch (error) { setFieldError((error as Error).message); }
  }
  const effectiveValue = (key: keyof PricingPlan) => effectivePlan[key] ?? (Object.prototype.hasOwnProperty.call(effectivePlan, key) ? null : policy.data?.[key as keyof typeof policy.data]);
  const numberField = (key: keyof PricingPlan, label: string, hint?: string) => <div key={key}>
    <Label htmlFor={`product-pricing-${key}`}>{label}</Label>
    <Input id={`product-pricing-${key}`} type="number" min="0" step="any" disabled={pending}
      value={effectiveValue(key) as number ?? ""} placeholder="Não informado" onChange={e => update(key, e.target.value)} />
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>;
  const setConsumables = (next: NonNullable<PricingPlan["consumables"]>) => { setChanges(current => ({ ...current, consumables: next })); setMessage(""); };
  function updatePlate(plateId: string, key: "printer_id" | "machine_hour_cost" | "handling_minutes", value: string) {
    try {
      const adjusted = { ...(effectivePlan.plates ?? []).find(p => p.plate_id === plateId), plate_id: plateId, [key]: key === "printer_id" ? value || null : pricingNumber(value, "Ajuste da placa") };
      setChanges(current => ({ ...current, plates: [...(effectivePlan.plates ?? []).filter(p => p.plate_id !== plateId), adjusted] }));
      setFieldError(""); setMessage("");
    } catch (error) { setFieldError((error as Error).message); }
  }

  return <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="min-w-0 space-y-5">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="product-pricing-quantity">Quantidade de produtos prontos</Label><Input id="product-pricing-quantity" type="number" min="1" max="10000" step="1" value={quantityInput} disabled={pending} onChange={e => { setQuantityInput(e.target.value); setMessage(""); }} /></div>
          <div><Label htmlFor="product-pricing-basis">Base do custo e do preço</Label><select id="product-pricing-basis" className={inputStyle} value={basis} disabled={pending} onChange={e => { setChanges(current => ({ ...current, cost_basis: e.target.value as PricingPlan["cost_basis"] })); setMessage(""); }}>
            <option value="unit">Padrão por unidade · rateia pelo rendimento</option><option value="exclusive_lot">Lote exclusivo · cobra impressões completas</option>
          </select></div>
        </div>
        <p className="text-sm text-muted-foreground">{basis === "unit" ? "O custo por unidade aproveita o rendimento cadastrado de cada placa. A produção necessária e as sobras aparecem no planejamento abaixo." : "Este pedido assume todo o custo das impressões necessárias, inclusive as peças que sobrarem. As sobras aparecem separadas no planejamento."}</p>
        {!validQuantity && <p role="alert" className="text-destructive">Informe uma quantidade inteira entre 1 e 10.000.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {numberField("handling_minutes_per_plate", "Preparação e retirada por placa (min)", "Trabalho ativo em cada impressão; o tempo automático da impressora é calculado à parte.")}
          {numberField("finishing_minutes_per_piece", "Acabamento padrão por peça (min)", "A ficha individual tem prioridade sobre o padrão. Editar este campo informa um ajuste para as peças deste produto.")}
          {numberField("assembly_minutes_per_product", "Montagem por produto completo (min)")}
          {numberField("extras_cost_per_product", "Outros custos por produto (R$)", "Não repita os insumos do estoque ou os extras já cadastrados.")}
        </div>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Tarifas e impressora deste produto</summary>
          <p className="my-3 text-sm text-muted-foreground">Os padrões vêm de <a className="underline" href="/configuracoes/precificacao">Custos e precificação</a>. Ajustes aqui valem para este produto. A tarifa de máquina exclui energia.</p>
          <SearchableItemSelect value={effectivePlan.printer_id ?? ""} disabled={pending} label="Impressora padrão do produto" emptyLabel="Usar impressora de cada placa" options={(printers.data ?? []).map(p => ({ id: p.id, label: p.name }))} onChange={id => setChanges(current => ({ ...current, printer_id: id || null }))} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {numberField("machine_hour_cost", "Hora-máquina padrão (R$ / h)", "Tarifas específicas por impressora ou placa têm prioridade sobre este padrão.")}
            {numberField("energy_cost_kwh", "Energia (R$ / kWh)")}
            {numberField("labor_cost_hour", "Hora de manipulação (R$ / h)")}
            {numberField("overhead_percent", "Despesas indiretas (%)")}
          </div>
        </details>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Insumos por produto pronto</h2>
        <p className="text-sm text-muted-foreground">Escolha embalagem, ímã e outros insumos já cadastrados. O custo usa a unidade e o custo médio do estoque; não altera o saldo.</p>
        {consumables.map((item, i) => <div key={`${item.item_id}:${i}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_130px_auto]">
          <SearchableItemSelect value={item.item_id} label={`Insumo ${i + 1}`} disabled={pending} emptyLabel="Escolher insumo" options={(items.data ?? []).filter(x => x.id === item.item_id || !consumables.some(c => c.item_id === x.id)).map(x => ({ id: x.id, label: x.name, description: `${x.unit} · ${money(x.avg_cost)} por ${x.unit}` }))} onChange={id => setConsumables(consumables.map((x, j) => j === i ? { ...x, item_id: id } : x))} />
          <div><Label htmlFor={`consumable-${i}`}>Qtd. por produto ({items.data?.find(x => x.id === item.item_id)?.unit ?? "unidade"})</Label><Input id={`consumable-${i}`} type="number" min="0.000001" step="any" disabled={pending} value={item.quantity || ""} onChange={e => {
            try { setConsumables(consumables.map((x, j) => j === i ? { ...x, quantity: pricingNumber(e.target.value, "Quantidade do insumo") ?? 0 } : x)); setFieldError(""); }
            catch (error) { setFieldError((error as Error).message); }
          }} /></div>
          <Button variant="ghost" disabled={pending} onClick={() => setConsumables(consumables.filter((_, j) => i !== j))}>Remover insumo {i + 1}</Button>
        </div>)}
        <Button variant="outline" disabled={pending || consumables.some(c => !c.item_id || c.quantity <= 0)} onClick={() => setConsumables([...consumables, { item_id: "", quantity: 1 }])}>Adicionar insumo do estoque</Button>
        {items.error && <p role="alert" className="text-destructive">Não foi possível carregar os insumos.</p>}
      </section>
      {result && <>
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Peças e placas que formam {result.product_name}</h2>
          {rows.components.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{rows.components.map((component, i) => {
            const grams = component.technical?.grams ?? component.technical?.materials?.reduce<number | null>((sum, m) => sum == null || m.grams == null ? null : sum + m.grams, 0);
            return <div key={`${component.component_product_id}:${i}`} className="rounded-lg border p-3 text-sm">
              <h3 className="font-medium">{component.name ?? component.pricing?.product_name ?? "Peça da composição"}</h3>
              <p>{decimal(component.required_quantity, " peças necessárias")}{component.quantity_per_product != null ? ` · ${decimal(component.quantity_per_product)} por produto` : ""}</p>
              <p className="text-muted-foreground">Referência por peça: {decimal(grams, " g")} · {decimal(component.technical?.print_seconds == null ? null : component.technical.print_seconds / 60, " min")}</p>
              {component.plate_id && <p>Placa: {rows.plates.find(p => p.plate_id === component.plate_id)?.label ?? "Confira a composição"} · {decimal(component.quantity_per_plate, " peças por impressão")}</p>}
            </div>;
          })}</div>}
          {rows.plates.map((plate, i) => {
            const adjusted = effectivePlan.plates?.find(p => p.plate_id === plate.plate_id);
            const plateValue = (key: "printer_id" | "machine_hour_cost" | "handling_minutes") => adjusted && Object.prototype.hasOwnProperty.call(adjusted, key) ? adjusted[key] : key === "handling_minutes" ? plate.handling_minutes_per_run : plate[key];
            return <details key={`${plate.plate_id}:${i}`} className="rounded-lg border p-3" open={rows.plates.length === 1}>
            <summary className="cursor-pointer font-medium">{plate.label} · {decimal(plate.print_seconds_per_run == null ? null : plate.print_seconds_per_run / 60, " min por impressão")}</summary>
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-muted-foreground">{sourceLabel[plate.source] ?? "Referência técnica do cadastro"} · Impressora: {plate.printer_name ?? "não definida"}</p>
              {(plate.materials ?? []).map((m, j) => <p key={j}>{m.name ?? m.material ?? "Filamento"}{m.color ? ` · ${m.color}` : ""}: {decimal(m.grams, " g por impressão")}</p>)}
              <p>Hora-máquina: {money(plate.machine_hour_cost)} · Preparação e retirada: {decimal(plate.handling_minutes_per_run, " min")}</p>
              {plate.product_id === productId ? <div className="grid gap-3 sm:grid-cols-2">
                <SearchableItemSelect value={plateValue("printer_id") as string ?? ""} disabled={pending} label={`Impressora de ${plate.label}`} emptyLabel="Selecionar impressora" options={(printers.data ?? []).map(p => ({ id: p.id, label: p.name }))} onChange={id => updatePlate(plate.plate_id, "printer_id", id)} />
                <div><Label htmlFor={`plate-rate-${plate.plate_id}`}>Hora-máquina desta placa (R$ / h)</Label><Input id={`plate-rate-${plate.plate_id}`} type="number" min="0" step="any" disabled={pending} value={plateValue("machine_hour_cost") ?? ""} onChange={e => updatePlate(plate.plate_id, "machine_hour_cost", e.target.value)} /></div>
                <div><Label htmlFor={`plate-work-${plate.plate_id}`}>Manipulação desta placa (min)</Label><Input id={`plate-work-${plate.plate_id}`} type="number" min="0" step="any" disabled={pending} value={plateValue("handling_minutes") ?? ""} onChange={e => updatePlate(plate.plate_id, "handling_minutes", e.target.value)} /></div>
              </div> : <a className="inline-block underline" href={`/comercial/precificacao?produto=${encodeURIComponent(plate.product_id)}`}>Ajustar o plano desta peça</a>}
            </div>
          </details>; })}
          {rows.components.length === 0 && rows.plates.length === 0 && <p className="text-sm text-muted-foreground">Referência da ficha técnica do produto. Confira as pendências caso falte consumo, tempo ou rendimento.</p>}
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="pricing-production-plan">
          <h2 className="font-semibold">Planejamento das impressões completas</h2>
          <p className="text-sm text-muted-foreground">Quantidade a produzir para atender {result.quantity} {result.quantity === 1 ? "produto" : "produtos"}. As sobras são peças adicionais; não entram no estoque nesta simulação.</p>
          {rows.runs.map((run, i) => <div key={`${run.plate_id}:${i}`} className="rounded-lg border p-3 text-sm">
            <h3 className="font-medium">{run.label}: {decimal(run.full_runs, " impressões completas")}</h3>
            <p className="text-muted-foreground">Rateio técnico para a quantidade: {decimal(run.required_runs, " impressões")}</p>
            {run.outputs?.map((output, j) => <p key={j}>{rows.components.find(c => c.component_product_id === output.component_product_id)?.name ?? result.product_name}: {decimal(output.required_quantity, " necessárias")} · {decimal(output.produced_quantity, " produzidas")} · <strong>{decimal(output.surplus_units, " de sobra")}</strong></p>)}
            {run.surplus_units != null && <p>Sobras: {decimal(run.surplus_units, " peças")}</p>}
          </div>)}
          <details><summary className="cursor-pointer text-sm font-medium">Conferir custo das rodadas completas</summary><div className="mt-3"><Breakdown value={result.production_breakdown} pending={!result.complete} /></div></details>
        </section>
      </>}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Venda por canal</h2>
        <Label htmlFor="product-pricing-channel">Canal da simulação</Label><select id="product-pricing-channel" className={inputStyle} value={channel} disabled={pending} onChange={e => setChannel(e.target.value)}>
          <option value="factory">Somente preço do produto</option><option value="direct">Venda direta / WhatsApp / Instagram</option><option value="mercado_livre">Mercado Livre</option><option value="shopee">Shopee</option><option value="other">Outro canal</option>
        </select>
        {channel !== "factory" && <><p className="text-sm text-muted-foreground">Informe as condições da sua conta. A escolha do canal não aplica tarifas automaticamente; o custo do produto vem da base selecionada acima.</p>
          <p className="text-sm font-medium">Quantidade por pedido: {quantity} {quantity === 1 ? "produto" : "produtos"}, conforme o cálculo de produção acima.</p>
          <div className="grid gap-3 sm:grid-cols-2">{([
            ["commissionPercent", "Comissão sobre produtos (%)"], ["taxPercent", "Tributo sobre produtos (%)"], ["fixedFeePerOrder", "Tarifa fixa por pedido (R$)"], ["sellerShippingPerOrder", "Frete próprio do pacote (R$)"], ["advertisingPerOrder", "Anúncios atribuídos ao pedido (R$)"], ["otherCostPerOrder", "Outros gastos do pedido (R$)"], ["variableUnitCost", "Parcela variável do custo / unidade (R$)"],
          ] as const).map(([key, label]) => <div key={key}><Label htmlFor={`product-channel-${key}`}>{label}</Label><Input id={`product-channel-${key}`} type="number" min="0" step="any" value={channelInputs[key]} disabled={pending} onChange={e => setChannelInputs(current => ({ ...current, [key]: e.target.value }))} /></div>)}</div>
          <p className="text-xs text-muted-foreground">Comissão e tributo incidem sobre a receita dos produtos. Os gastos fixos entram uma vez por pedido. Embalagens e insumos já incluídos no custo não devem ser repetidos aqui.</p>
        </>}
      </section>
    </div>
    <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 xl:sticky xl:top-4">
      <h2 className="text-lg font-semibold">Custo e preço do produto</h2>
      {numberField("target_margin", "Margem desejada sobre a venda (%)", "Margem sobre o valor vendido, sem alterar o custo de produção.")}
      <div><Label htmlFor="product-pricing-target">Preço alvo por unidade (R$)</Label><Input id="product-pricing-target" type="number" min="0" step=".01" value={target} disabled={pending} placeholder={money(channel === "factory" ? result?.suggested_unit_price : commercial.value?.suggested)} onChange={e => { setTarget(e.target.value); setMessage(""); }} /></div>
      {[fieldError, targetError, commercial.error, plan.error?.message, preview.error?.message, savePlan.error?.message, apply.error?.message].filter(Boolean).map((error, i) => <p key={i} role="alert" className="text-sm text-destructive">{error}</p>)}
      {!validPlan && <p className="text-sm text-amber-700" role="status">Selecione cada insumo e informe uma quantidade maior que zero para atualizar o custo.</p>}
      {(plan.isLoading || preview.isFetching) && <p role="status" className="text-sm text-muted-foreground">Conferindo ficha, placas e custos...</p>}
      <Button size="sm" variant="ghost" disabled={pending || !validQuantity || !validPlan || !!fieldError} onClick={() => {
        setMessage(""); savePlan.reset(); apply.reset();
        void Promise.all([qc.invalidateQueries({ queryKey: ["pricing_settings", tenant] }), qc.invalidateQueries({ queryKey: ["product_pricing_plan", tenant, productId] }), qc.invalidateQueries({ queryKey: ["product_pricing_preview", tenant, productId] })]);
      }}>Atualizar prévia</Button>
      {result && <>
        <p className="text-sm font-medium">{result.cost_basis === "unit" ? "Padrão por unidade" : "Lote exclusivo"} · {result.quantity} {result.quantity === 1 ? "produto" : "produtos"}</p>
        {!result.complete && <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950" role="status"><p className="font-medium">Falta confirmar para fechar o custo:</p><ul className="list-disc space-y-1 pl-4">{result.missing.map((item, i) => <li key={i}>{item}</li>)}</ul><p>Os valores abaixo mostram apenas parcelas já conhecidas.</p></div>}
        <div data-testid="product-pricing-breakdown"><Breakdown value={result.breakdown} pending={!result.complete} /></div>
        <p className="text-sm">Custo manual atual: <strong>{money(result.manual_cost_reference)}</strong></p>
        {result.complete && channel === "factory" && <div className="space-y-1 rounded-lg bg-muted p-3 text-sm"><p>Preço sugerido: <strong>{money(result.suggested_unit_price)} / un.</strong></p><p>Preço escolhido: {money(selectedPrice)} / un.</p>{selectedPrice != null && <p>Resultado para a quantidade: {money(selectedPrice * result.quantity - result.breakdown.total_lot!)}</p>}</div>}
        {commercial.value && <ChannelResult value={commercial.value} />}
        {selectedPrice != null && result.breakdown.unit_cost != null && selectedPrice < result.breakdown.unit_cost && <p role="status" className="text-sm text-destructive">O preço alvo não cobre o custo do produto.</p>}
      </>}
      <Button className="w-full" variant="outline" disabled={!plan.data || plan.isError || pending || !!fieldError || !validPlan} onClick={() => { setMessage(""); savePlan.mutate(); }}>{savePlan.isPending ? "Salvando plano..." : "Salvar tempos e insumos do produto"}</Button>
      <Button className="w-full" disabled={!canApply || pending} onClick={() => { setMessage(""); apply.mutate(); }}>{apply.isPending ? "Aplicando..." : "Aplicar custo e preço ao cadastro"}</Button>
      <p className="text-xs text-muted-foreground">Salvar o plano guarda os parâmetros. Aplicar atualiza explicitamente o custo e o preço do produto após conferir novamente os dados.</p>
      <Button className="w-full" variant="outline" disabled={!canApply || pending} onClick={() => navigate("/comercial/orcamentos", { state: { pricingQuote: { product_id: productId, quantity: channel === "factory" ? quantity : commercial.value!.quantity, unit_price: selectedPrice! } } })}>Usar preço no novo orçamento</Button>
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {policy.error && <p className="text-sm text-destructive">Não foi possível carregar as configurações de custos. A prévia informa o que ainda falta confirmar.</p>}
    </aside>
  </div>;
}

function ChannelResult({ value }: { value: ReturnType<typeof priceChannel> }) {
  return <div className="space-y-2 rounded-lg bg-muted p-3 text-sm" data-testid="product-channel-result">
    <p>Preço sugerido no canal: <strong>{money(value.suggested)} / un.</strong></p><p>Pedido de {value.quantity} unidades · Equilíbrio: {money(value.breakEven)} / un.</p>
    <dl className="space-y-1">{([
      ["Receita de produtos", value.revenue], ["Custo fabril", value.manufacturingCost], ["Comissão", value.commission], ["Tributo parametrizado", value.tax], ["Tarifa fixa", value.fixedFee], ["Frete próprio", value.sellerShipping], ["Anúncios", value.advertising], ["Outros gastos", value.otherCost],
    ] as const).map(([label, amount]) => <div key={label} className="flex justify-between gap-2"><dt>{label}</dt><dd>{money(amount)}</dd></div>)}</dl>
    <p>Resultado após custos informados: <strong>{money(value.includedResult)}</strong></p><p>Contribuição estimada: {money(value.contribution)}</p>
    <p className="text-xs text-muted-foreground">Estimativa do pedido com os gastos informados. Não representa lucro líquido nem repasse da plataforma.</p>
  </div>;
}
