import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeMaterialOverride, materialChoiceKey, type MaterialOverride, type MaterialVariantPreview } from "@/lib/product-material-variant";
import { suggestedProductPrice } from "@/lib/product-costs";
import { quoteMoney } from "@/lib/sales-quote";

export function ProductMaterialChoice({ productId, tenantId, quantity, unitPrice, overrides, onChange, onUnitPriceChange, disabled = false }: {
  productId: string; tenantId?: string; quantity: number; unitPrice: number | null; overrides: MaterialOverride[];
  onChange: (value: MaterialOverride[]) => void; onUnitPriceChange: (value: number) => void; disabled?: boolean;
}) {
  const id = useId(); const [margin, setMargin] = useState("");
  const validQuantity = Number.isInteger(quantity) && quantity > 0 && quantity <= 10000;
  const preview = useQuery({ queryKey: ["product_material_variant", tenantId, productId, quantity, overrides], enabled: !!productId && !!tenantId && validQuantity, retry: false,
    queryFn: async () => {
      const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      const result = await rpc("product_material_variant_preview", { p_product_id: productId, p_material_overrides: overrides, p_quantity: quantity });
      if (result.error) throw new Error(result.error.message);
      const value = result.data as MaterialVariantPreview | null;
      if (!value || !Array.isArray(value.material_options) || !Array.isArray(value.missing)) throw new Error("Não foi possível conferir materiais e custo deste produto.");
      return value;
    },
  });
  if (!productId) return null;
  const value = preview.data;
  const cost = value?.complete && typeof value.estimated_unit_cost === "number" && Number.isFinite(value.estimated_unit_cost) ? value.estimated_unit_cost : null;
  const marginNumber = margin.trim() === "" ? null : Number(margin.replace(",", "."));
  const suggested = cost != null && marginNumber != null && Number.isFinite(marginNumber) && marginNumber >= 0 && marginNumber < 100 ? Math.ceil((suggestedProductPrice(cost, marginNumber) - 1e-9) * 100) / 100 : null;
  const unitResult = cost != null && unitPrice != null && Number.isFinite(unitPrice) ? unitPrice - cost : null;
  return <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3" aria-label="Cor, material e custo deste item">
    <h4 className="flex items-center gap-2 text-sm font-semibold"><Palette className="h-4 w-4" />Cor e material deste item</h4>
    {!validQuantity ? <p className="text-xs text-muted-foreground">Informe a quantidade para calcular a produção.</p> : preview.isLoading ? <p className="flex items-center gap-2 text-xs"><Loader2 className="h-4 w-4 animate-spin" />Conferindo materiais, estoque e custo…</p> : preview.error ? <div role="alert" className="space-y-2 text-xs text-destructive"><p>{preview.error.message}</p><Button type="button" size="sm" variant="outline" onClick={() => preview.refetch()}>Tentar novamente</Button></div> : <>
      {value?.material_options.map((choice, index) => {
        const selected = choice.options.find(option => option.id === choice.selected_item_id);
        return <div key={materialChoiceKey(choice)} className="space-y-1.5"><Label htmlFor={`${id}-material-${index}`}>{choice.plate_label || (choice.plate_id ? `Parte ${index + 1}` : choice.product_name || "Filamento")}</Label>
          <div className="flex items-center gap-2">{selected?.color_hex && /^#[0-9a-f]{6}$/i.test(selected.color_hex) && <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border" style={{ backgroundColor: selected.color_hex }} />}
            <select id={`${id}-material-${index}`} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm" disabled={disabled || preview.isFetching} value={choice.selected_item_id} onChange={event => onChange(changeMaterialOverride(overrides, choice, event.target.value))}>
              {!selected && <option value={choice.selected_item_id}>Material indisponível — selecione outro</option>}
              {choice.options.map(option => <option key={option.id} value={option.id}>{option.name} · {option.material_code} · {option.color}</option>)}
            </select>
          </div>
          {selected && <p className="text-xs text-muted-foreground">Estoque: {Number(selected.current_stock).toLocaleString("pt-BR")} {selected.unit} · Custo médio: {selected.cost_known && selected.avg_cost != null ? quoteMoney(Number(selected.avg_cost) * (selected.unit === "g" ? 1000 : 1)) : "pendente"}/kg</p>}
        </div>;
      })}
      {!value?.material_options.length && <p className="text-xs text-muted-foreground">Cadastre a composição do produto para escolher as cores e calcular o custo. <Link className="underline" to={`/comercial/produtos?produto=${productId}`} target="_blank" rel="noopener noreferrer">Abrir produto em outra aba</Link></p>}
      {!!value?.missing.length && <details className="text-xs text-amber-800 dark:text-amber-300"><summary className="min-h-9 cursor-pointer py-2">Ver o que falta para calcular</summary><ul className="list-disc space-y-1 pl-4">{value.missing.map((message, index) => <li key={index}>{message}</li>)}</ul></details>}
      <div className="grid grid-cols-2 gap-3 rounded-md bg-background p-3 text-sm"><div><p className="text-xs text-muted-foreground">Custo por unidade</p><p className="font-semibold">{quoteMoney(cost)}</p></div><div><p className="text-xs text-muted-foreground">Resultado por unidade</p><p className="font-semibold">{quoteMoney(unitResult)}</p></div></div>
      <p className="text-xs text-muted-foreground">Resultado antes de frete, descontos e taxas da venda.</p>
      <p className="text-xs text-muted-foreground">A previsão considera as cores escolhidas e as impressões necessárias para {quantity} {quantity === 1 ? "unidade" : "unidades"}. A apuração usa o consumo registrado e o custo do estoque naquele momento.</p>
      {cost != null && <div className="flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><Label htmlFor={`${id}-margin`}>Margem desejada (%)</Label><Input id={`${id}-margin`} type="number" min="0" max="99.99" step="0.1" value={margin} placeholder="Ex.: 40" disabled={disabled} onChange={event => setMargin(event.target.value)} /></div><Button type="button" variant="outline" className="min-h-11" disabled={disabled || suggested == null} onClick={() => { if (suggested != null) onUnitPriceChange(suggested); }}>{suggested == null ? "Calcular preço" : `Usar ${quoteMoney(suggested)}`}</Button></div>}
    </>}
  </section>;
}
