import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pricePrint, type PricingInput } from "@/lib/print-pricing";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/finance";
import { useAuth } from "@/contexts/AuthContext";
const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const initial: PricingInput = {
  quantity: "1",
  hours: "0",
  watts: "0",
  kwh: "0",
  machineHour: "0",
  laborMinutes: "0",
  laborHour: "0",
  overhead: "0",
  failure: "0",
  margin: "30",
  target: "",
  materials: [{ name: "Material 1", grams: "0", kgPrice: "0" }],
  extras: [],
};
export default function Precificacao() {
  const { profile } = useAuth();
  const company = useQuery({
    queryKey: ["pricing-company", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const result = await supabase
        .from("tenants")
        .select("settings")
        .eq("id", profile!.tenant_id)
        .single();
      if (result.error) throw result.error;
      return result.data.settings as Record<string, number> | null;
    },
  });
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  const [input, setInput] = useState(initial);
  const calculation = useMemo(() => {
    try {
      return { value: pricePrint(input), error: "" };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [input]);
  const result = calculation.value;
  const products = useQuery({
    queryKey: ["pricing-products"],
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
    queryKey: ["pricing-printers"],
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
    queryKey: ["pricing-materials"],
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
    if (result && name.trim())
      navigate("/comercial/produtos", {
        state: {
          pricing: {
            name: name.trim(),
            cost: Math.round(result.unit * 10000) / 10000,
            price: result.target,
            quantity: result.quantity,
            quote,
          },
        },
      });
  };
  return (
    <div className="space-y-5 min-w-0">
      <PageHeader
        title="Precificação 3D"
        description="Simule o lote completo, compare o custo por unidade e aproveite o resultado no cadastro ou orçamento."
        breadcrumbs={[{ label: "Comercial" }, { label: "Precificação" }]}
      />
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
                      kgPrice: "0",
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
                  kwh: company.data?.energy_cost_kwh ?? 0,
                  laborHour: company.data?.labor_cost_hour ?? 0,
                  overhead: company.data?.overhead_percent ?? 0,
                  margin: company.data?.target_margin ?? 30,
                })
              }
            >
              Usar parâmetros da empresa
            </Button>
            <SearchableItemSelect
              value=""
              options={(printers.data || []).map((p) => ({
                id: p.id,
                label: p.name,
              }))}
              label="Impressora de referência"
              emptyLabel="Preencher com uma impressora"
              searchPlaceholder="Digitar impressora..."
              onChange={(id) => {
                const p = printers.data?.find((p) => p.id === id);
                if (p)
                  setInput({
                    ...input,
                    watts: p.power_watts || 0,
                    machineHour:
                      (p.depreciation_per_hour ??
                        ((p.useful_life_hours || 0) > 0
                          ? (p.acquisition_cost || 0) / p.useful_life_hours!
                          : 0)) + (p.maintenance_cost_per_hour || 0),
                  });
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {numberField("hours", "Horas totais de impressão")}
              {numberField("watts", "Potência média (W)")}
              {numberField("kwh", "Energia (R$ / kWh)")}
              {numberField("machineHour", "Depreciação + manutenção (R$ / h)")}
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
                    { name: "", cost: "0", basis: "unit" },
                  ],
                })
              }
            >
              Adicionar extra
            </Button>
          </section>
        </div>
        <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 xl:sticky xl:top-4">
          <h2 className="text-lg font-semibold">Resultado da simulação</h2>
          {calculation.error && (
            <p role="alert" className="text-destructive">
              {calculation.error}
            </p>
          )}
          {numberField("margin", "Margem desejada sobre a venda (%)")}
          {numberField(
            "target",
            "Preço alvo por unidade (R$)",
            result ? String(result.suggested) : "Preço sugerido",
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
              <p className="text-sm">
                Preço sugerido: <strong>{money(result.suggested)} / un.</strong>
              </p>
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p>Venda do lote: {money(result.revenue)}</p>
                <p>Resultado previsto: {money(result.profit)}</p>
                <p>
                  Margem efetiva:{" "}
                  {result.margin == null ? "—" : `${result.margin.toFixed(1)}%`}
                </p>
              </div>
              {result.profit < 0 && (
                <p role="status" className="text-sm text-destructive">
                  O preço alvo não cobre o custo informado.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Estimativa com os valores informados. Inclua tributos e taxas
                nos extras quando aplicáveis.
              </p>
              <Button
                className="w-full"
                disabled={!name.trim()}
                onClick={() => transfer(false)}
              >
                Cadastrar produto com estes valores
              </Button>
              <Button
                className="w-full"
                variant="outline"
                disabled={!name.trim()}
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
                  disabled={!product}
                  onClick={() =>
                    navigate("/comercial/orcamentos", {
                      state: {
                        pricingQuote: {
                          product_id: product,
                          quantity: result.quantity,
                          unit_price: result.target,
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
      {(products.error || materials.error || printers.error) && (
        <p role="alert" className="text-sm text-destructive">
          Alguns cadastros não puderam ser carregados. Você pode simular
          preenchendo os valores manualmente.
        </p>
      )}
    </div>
  );
}
