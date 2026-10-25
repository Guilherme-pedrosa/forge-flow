import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pricePrint, type PricingInput } from "@/lib/print-pricing";
import { priceChannel } from "@/lib/channel-pricing";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/finance";
import { useAuth } from "@/contexts/AuthContext";
import { readPricingSettings } from "@/lib/pricing-policy";
import ProductPricingWorkspace from "./ProductPricingWorkspace";
const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const initial: PricingInput = {
  quantity: "1",
  hours: "0",
  watts: "",
  kwh: "",
  machineHour: "",
  laborMinutes: "0",
  laborHour: "",
  overhead: "",
  failure: "0",
  margin: "",
  target: "",
  materials: [{ name: "Material 1", grams: "0", kgPrice: "" }],
  extras: [],
};
const initialChannel = {
  orderQuantity: "1",
  commissionPercent: "0",
  taxPercent: "0",
  fixedFeePerOrder: "0",
  sellerShippingPerOrder: "0",
  advertisingPerOrder: "0",
  otherCostPerOrder: "0",
  variableUnitCost: "",
};
const percent = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;
export default function Precificacao() {
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<"product" | "free">("product");
  const productId = params.get("produto") ?? "";
  useEffect(() => { if (productId) setMode("product"); }, [productId]);
  return <div className="min-w-0 space-y-5">
    <PageHeader title="Precificação 3D" description="Forme o preço com a composição do produto, as placas, o trabalho e os insumos." breadcrumbs={[{ label: "Comercial" }, { label: "Precificação" }]} />
    <div className="flex flex-wrap gap-2" aria-label="Modo de precificação">
      <Button variant={mode === "product" ? "default" : "outline"} aria-pressed={mode === "product"} onClick={() => setMode("product")}>Produto cadastrado</Button>
      <Button variant={mode === "free" ? "default" : "outline"} aria-pressed={mode === "free"} onClick={() => setMode("free")}>Simulação livre</Button>
      <Button variant="ghost" asChild><a href="/configuracoes/precificacao">Configurar tarifas e custos</a></Button>
    </div>
    {mode === "product" ? <ProductPricingWorkspace productId={productId} onProductChange={id => setParams(current => { const next = new URLSearchParams(current); if (id) next.set("produto", id); else next.delete("produto"); return next; })} /> : <FreePricingSimulator />}
  </div>;
}

function FreePricingSimulator() {
  const { profile } = useAuth();
  const company = useQuery({
    queryKey: ["pricing_settings", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: readPricingSettings,
  });
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  const [input, setInput] = useState(initial);
  const [printerId, setPrinterId] = useState("");
  const hydrated = useRef<string | null>(null);
  useEffect(() => {
    if (!company.data || !profile?.tenant_id || hydrated.current === profile.tenant_id) return;
    hydrated.current = profile.tenant_id;
    const settings = company.data;
    setInput(current => ({ ...current,
      kwh: current.kwh === "" ? settings.energy_cost_kwh ?? "" : current.kwh,
      machineHour: current.machineHour === "" ? settings.machine_hour_cost ?? "" : current.machineHour,
      laborHour: current.laborHour === "" ? settings.labor_cost_hour ?? "" : current.laborHour,
      overhead: current.overhead === "" ? settings.overhead_percent ?? "" : current.overhead,
      margin: current.margin === "" ? settings.target_margin ?? "" : current.margin,
    }));
  }, [company.data, profile?.tenant_id]);
  const [channel, setChannel] = useState("factory");
  const [channelInput, setChannelInput] = useState(initialChannel);
  const channelEnabled = channel !== "factory";
  const calculation = useMemo(() => {
    try {
      return { value: pricePrint(input), error: "" };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [input]);
  const result = calculation.value;
  const commercial = useMemo(() => {
    if (!channelEnabled || !result) return { value: null, error: "" };
    try {
      return {
        value: priceChannel({
          ...channelInput,
          unitCost: result.unit,
          marginPercent: input.margin,
          targetUnitPrice: input.target,
        }),
        error: "",
      };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [channelEnabled, channelInput, input.margin, input.target, result]);
  const sale = commercial.value;
  const selectedPrice = channelEnabled ? sale?.target : result?.target;
  const selectedQuantity = channelEnabled ? sale?.quantity : result?.quantity;
  const canTransfer = !!result && selectedPrice != null && selectedQuantity != null;
  const products = useQuery({
    queryKey: ["pricing-products", profile?.tenant_id],
    queryFn: () =>
      allRows((a, b) =>
        supabase
          .from("products")
          .select("id,name,sku")
          .eq("is_active", true)
          .order("name")
          .order("id")
          .range(a, b),
      ),
  });
  const printers = useQuery({
    queryKey: ["pricing-printers", profile?.tenant_id],
    queryFn: () =>
      allRows((a, b) =>
        supabase
          .from("printers")
          .select("*")
          .eq("is_active", true)
          .order("name")
          .order("id")
          .range(a, b),
      ),
  });
  const materials = useQuery({
    queryKey: ["pricing-materials", profile?.tenant_id],
    queryFn: () =>
      allRows((a, b) =>
        supabase
          .from("inventory_items")
          .select("id,name,unit,avg_cost")
          .eq("is_active", true)
          .in("unit", ["g", "kg"])
          .order("name")
          .order("id")
          .range(a, b),
      ),
  });
  const numberField = (
    key: keyof Omit<PricingInput, "materials" | "extras">,
    label: string,
    placeholder?: string,
  ) => (
    <div key={key}>
      <Label htmlFor={`price-${key}`}>{label}</Label>
      <Input
        id={`price-${key}`}
        type="number"
        min={0}
        step="any"
        value={input[key]}
        placeholder={placeholder}
        onChange={(e) => setInput({ ...input, [key]: e.target.value })}
      />
    </div>
  );
  const transfer = (quote: boolean) => {
    if (result && canTransfer && name.trim())
      navigate("/comercial/produtos", {
        state: {
          pricing: {
            name: name.trim(),
            cost: Math.round(result.unit * 10000) / 10000,
            price: selectedPrice!,
            quantity: selectedQuantity!,
            quote,
          },
        },
      });
  };
  const channelField = (key: keyof typeof initialChannel, label: string, placeholder?: string) => (
    <div key={key}>
      <Label htmlFor={`channel-${key}`}>{label}</Label>
      <Input
        id={`channel-${key}`}
        type="number"
        min={0}
        step={key === "orderQuantity" ? "1" : "any"}
        value={channelInput[key]}
        placeholder={placeholder}
        onChange={e => setChannelInput({ ...channelInput, [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="space-y-5 min-w-0">
      <p className="text-sm text-muted-foreground">Simule um novo projeto informando os totais do lote. Para aproveitar a ficha e as placas existentes, escolha Produto cadastrado.</p>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <section className="space-y-4 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Produto e lote</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="pricing-name">Nome do produto</Label>
                <Input
                  id="pricing-name"
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Maçã com caule e folha"
                />
              </div>
              {numberField("quantity", "Unidades prontas no lote")}
            </div>
            <p className="text-sm text-muted-foreground">
              Informe peso e tempo totais de todas as placas necessárias para
              este lote.
            </p>
            {input.materials.map((material, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_120px_120px_auto]"
              >
                <div>
                  <Label htmlFor={`material-name-${i}`}>Material {i + 1}</Label>
                  <Input
                    id={`material-name-${i}`}
                    value={material.name}
                    onChange={(e) =>
                      setInput({
                        ...input,
                        materials: input.materials.map((m, j) =>
                          j === i ? { ...m, name: e.target.value } : m,
                        ),
                      })
                    }
                  />
                  <SearchableItemSelect
                    value=""
                    options={(materials.data || []).map((m) => ({
                      id: m.id,
                      label: m.name,
                    }))}
                    label="Material do estoque"
                    emptyLabel="Usar custo do estoque"
                    searchPlaceholder="Digitar material..."
                    onChange={(id) => {
                      const m = materials.data?.find((m) => m.id === id);
                      if (m)
                        setInput({
                          ...input,
                          materials: input.materials.map((v, j) =>
                            j === i
                              ? {
                                  ...v,
                                  name: m.name,
                                  kgPrice: String(
                                    (m.avg_cost || 0) *
                                      (m.unit === "g" ? 1000 : 1),
                                  ),
                                }
                              : v,
                          ),
                        });
                    }}
                  />
                </div>
                {(
                  [
                    ["grams", "Gramas no lote"],
                    ["kgPrice", "Custo / kg (R$)"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <Label htmlFor={`material-${key}-${i}`}>{label}</Label>
                    <Input
                      id={`material-${key}-${i}`}
                      type="number"
                      min={0}
                      step="any"
                      value={material[key]}
                      onChange={(e) =>
                        setInput({
                          ...input,
                          materials: input.materials.map((m, j) =>
                            j === i ? { ...m, [key]: e.target.value } : m,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <Button
                  variant="ghost"
                  disabled={input.materials.length === 1}
                  onClick={() =>
                    setInput({
                      ...input,
                      materials: input.materials.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remover
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setInput({
                  ...input,
                  materials: [
                    ...input.materials,
                    {
                      name: `Material ${input.materials.length + 1}`,
                      grams: "0",
                      kgPrice: "",
                    },
                  ],
                })
              }
            >
              Adicionar material / cor
            </Button>
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Impressão e trabalho</h2>
            <Button
              variant="outline"
              disabled={!company.data}
              onClick={() =>
                setInput({
                  ...input,
                  kwh: company.data?.energy_cost_kwh ?? "",
                  machineHour: company.data?.printer_hour_costs.find(p => p.printer_id === printerId)?.hour_cost ?? company.data?.machine_hour_cost ?? "",
                  laborHour: company.data?.labor_cost_hour ?? "",
                  overhead: company.data?.overhead_percent ?? "",
                  margin: company.data?.target_margin ?? "",
                })
              }
            >
              Usar parâmetros da empresa
            </Button>
            <SearchableItemSelect
              value={printerId}
              options={(printers.data || []).map((p) => ({
                id: p.id,
                label: p.name,
              }))}
              label="Impressora de referência"
              emptyLabel="Preencher com uma impressora"
              searchPlaceholder="Digitar impressora..."
              onChange={(id) => {
                const p = printers.data?.find((p) => p.id === id);
                setPrinterId(id);
                if (p)
                  setInput({
                    ...input,
                    watts: p.power_watts ?? "",
                    machineHour: company.data?.printer_hour_costs.find(rate => rate.printer_id === p.id)?.hour_cost ?? company.data?.machine_hour_cost ?? "",
                  });
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {numberField("hours", "Horas totais de impressão")}
              {numberField("watts", "Potência média (W)")}
              {numberField("kwh", "Energia (R$ / kWh)")}
              {numberField("machineHour", "Hora-máquina sem energia (R$ / h)")}
              {numberField("laborMinutes", "Trabalho manual no lote (min)")}
              {numberField("laborHour", "Mão de obra (R$ / h)")}
              {numberField("overhead", "Despesas indiretas (%)")}
              {numberField("failure", "Reserva adicional para falhas (%)")}
            </div>
            <p className="text-xs text-muted-foreground">
              A reserva adiciona uma porcentagem ao custo de produção. Inclua
              purga e suportes no peso; evite contabilizar a mesma perda duas
              vezes.
            </p>
          </section>
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Embalagem, componentes e extras</h2>
            {input.extras.map((extra, i) => (
              <div
                key={i}
                className="grid gap-2 sm:grid-cols-[1fr_110px_140px_auto]"
              >
                <Input
                  aria-label={`Nome do extra ${i + 1}`}
                  value={extra.name}
                  placeholder="Embalagem"
                  onChange={(e) =>
                    setInput({
                      ...input,
                      extras: input.extras.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
                <Input
                  aria-label={`Custo do extra ${i + 1}`}
                  type="number"
                  min={0}
                  step=".01"
                  value={extra.cost}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      extras: input.extras.map((x, j) =>
                        j === i ? { ...x, cost: e.target.value } : x,
                      ),
                    })
                  }
                />
                <select
                  aria-label={`Base do extra ${i + 1}`}
                  className="rounded-md border p-2 text-sm"
                  value={extra.basis}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      extras: input.extras.map((x, j) =>
                        j === i
                          ? { ...x, basis: e.target.value as "lot" | "unit" }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="unit">Por unidade</option>
                  <option value="lot">No lote inteiro</option>
                </select>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setInput({
                      ...input,
                      extras: input.extras.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remover
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setInput({
                  ...input,
                  extras: [
                    ...input.extras,
                    { name: "", cost: "", basis: "unit" },
                  ],
                })
              }
            >
              Adicionar extra
            </Button>
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Venda por canal</h2>
            <div>
              <Label htmlFor="pricing-channel">Canal da simulação</Label>
              <select
                id="pricing-channel"
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={channel}
                onChange={e => setChannel(e.target.value)}
              >
                <option value="factory">Somente custo fabril</option>
                <option value="direct">Venda direta / WhatsApp / Instagram</option>
                <option value="mercado_livre">Mercado Livre</option>
                <option value="shopee">Shopee</option>
                <option value="other">Outro canal</option>
              </select>
            </div>
            {channelEnabled && (
              <>
                <p className="text-sm text-muted-foreground">
                  O canal identifica esta simulação. Preencha as condições da sua
                  conta; a seleção não aplica tarifas automaticamente.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {channelField("orderQuantity", "Unidades por pedido / pacote")}
                  {channelField("commissionPercent", "Comissão sobre produtos (%)")}
                  {channelField("taxPercent", "Tributo sobre produtos (%)")}
                  {channelField("fixedFeePerOrder", "Tarifa fixa por pedido (R$)")}
                  {channelField("sellerShippingPerOrder", "Frete próprio do pacote (R$)")}
                  {channelField("advertisingPerOrder", "Anúncios atribuídos ao pedido (R$)")}
                  {channelField("otherCostPerOrder", "Outros gastos do pedido (R$)")}
                  {channelField("variableUnitCost", "Parcela variável do custo / unidade (R$)", result ? String(result.unit) : "Custo completo")}
                </div>
                <p className="text-xs text-muted-foreground">
                  Comissão e tributo usam a receita dos produtos, sem frete do
                  comprador. Tarifa, frete próprio, anúncios e outros gastos
                  entram uma vez por pedido. Embalagem já incluída nos extras
                  permanece no custo fabril. Informe cada gasto em um só lugar.
                </p>
                <p className="text-xs text-muted-foreground">
                  Para estimar contribuição, informe a parcela variável do custo.
                  Em branco, a simulação considera todo o custo fabril como
                  variável. Estas condições valem para o pacote informado;
                  tarifas por item devem ser somadas na tarifa do pedido.
                </p>
              </>
            )}
          </section>
        </div>
        <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 xl:sticky xl:top-4">
          <h2 className="text-lg font-semibold">Resultado da simulação</h2>
          {calculation.error && (
            <p role="alert" className="text-destructive">
              {calculation.error}
            </p>
          )}
          {commercial.error && (
            <p role="alert" className="text-destructive">{commercial.error}</p>
          )}
          {numberField("margin", "Margem desejada sobre a venda (%)")}
          {numberField(
            "target",
            "Preço alvo por unidade (R$)",
            channelEnabled
              ? (sale ? String(sale.suggested) : "Preço sugerido no canal")
              : (result ? String(result.suggested) : "Preço sugerido"),
          )}
          {result && (
            <>
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ["Materiais", result.materials],
                    ["Energia", result.energy],
                    ["Máquina", result.machine],
                    ["Trabalho", result.labor],
                    ["Indiretos", result.overhead],
                    ["Reserva de falhas", result.failures],
                    ["Extras", result.extras],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt>{label} · lote</dt>
                    <dd>{money(value)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-3 font-semibold">
                  <dt>Custo do lote</dt>
                  <dd>{money(result.lot)}</dd>
                </div>
                <div className="flex justify-between text-lg font-semibold">
                  <dt>Custo / unidade</dt>
                  <dd>{money(result.unit)}</dd>
                </div>
              </dl>
              {!channelEnabled && (
                <>
                  <p className="text-sm">
                    Preço sugerido: <strong>{money(result.suggested)} / un.</strong>
                  </p>
                  <div className="rounded-lg bg-muted p-3 text-sm">
                    <p>Venda do lote: {money(result.revenue)}</p>
                    <p>Resultado previsto: {money(result.profit)}</p>
                    <p>Margem efetiva: {percent(result.margin)}</p>
                  </div>
                </>
              )}
              {channelEnabled && sale && (
                <div className="space-y-3 text-sm" data-testid="channel-pricing-result">
                  <p>
                    Preço sugerido no canal: <strong>{money(sale.suggested)} / un.</strong>
                  </p>
                  <p>Equilíbrio dos custos informados: {money(sale.breakEven)} / un.</p>
                  <p className="text-xs text-muted-foreground">
                    Preços para um pedido de {sale.quantity} {sale.quantity === 1 ? "unidade" : "unidades"}.
                  </p>
                  <dl className="space-y-2">
                    {([
                      ["Receita de produtos · pedido", sale.revenue],
                      ["Custo fabril · pedido", sale.manufacturingCost],
                      ["Comissão", sale.commission],
                      ["Tributo parametrizado", sale.tax],
                      ["Tarifa fixa", sale.fixedFee],
                      ["Frete próprio", sale.sellerShipping],
                      ["Anúncios", sale.advertising],
                      ["Outros gastos", sale.otherCost],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-2">
                        <dt>{label}</dt><dd>{money(value)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="space-y-1 rounded-lg bg-muted p-3">
                    <p>Resultado após custos informados: <strong>{money(sale.includedResult)}</strong></p>
                    <p>Margem sobre receita: {percent(sale.includedMargin)}</p>
                    <p>Markup sobre custo total: {percent(sale.markup)}</p>
                    <p>Contribuição estimada: {money(sale.contribution)}</p>
                    <p>Margem de contribuição: {percent(sale.contributionMargin)}</p>
                  </div>
                </div>
              )}
              {(channelEnabled ? sale && sale.includedResult < 0 : result.profit < 0) && (
                <p role="status" className="text-sm text-destructive">
                  O preço alvo não cobre os custos informados.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {channelEnabled
                  ? "Estimativa local com os valores informados, antes de gastos não incluídos. Resultado e contribuição não são lucro líquido nem repasse da plataforma. Regras com faixas, tetos ou outras bases exigem ajuste dos parâmetros."
                  : "Estimativa com os valores informados. Selecione um canal para compor taxas, tributo e gastos do pedido."}
              </p>
              <Button
                className="w-full"
                disabled={!name.trim() || !canTransfer}
                onClick={() => transfer(false)}
              >
                Cadastrar produto com estes valores
              </Button>
              <Button
                className="w-full"
                variant="outline"
                disabled={!name.trim() || !canTransfer}
                onClick={() => transfer(true)}
              >
                Cadastrar produto e orçar
              </Button>
              <div className="space-y-2 border-t pt-4">
                <Label>Ou usar um produto já cadastrado</Label>
                <SearchableItemSelect
                  value={product}
                  onChange={setProduct}
                  options={(products.data || []).map((p) => ({
                    id: p.id,
                    label: p.name,
                    description: p.sku || undefined,
                  }))}
                  label="Produto para orçamento"
                  emptyLabel="Selecionar produto"
                  searchPlaceholder="Digitar nome ou SKU..."
                />
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={!product || !canTransfer}
                  onClick={() =>
                    navigate("/comercial/orcamentos", {
                      state: {
                        pricingQuote: {
                          product_id: product,
                          quantity: selectedQuantity!,
                          unit_price: selectedPrice!,
                        },
                      },
                    })
                  }
                >
                  Usar preço no novo orçamento
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>
      {(products.error || materials.error || printers.error || company.error) && (
        <p role="alert" className="text-sm text-destructive">
          Alguns cadastros não puderam ser carregados. Você pode simular
          preenchendo os valores manualmente.
        </p>
      )}
    </div>
  );
}
