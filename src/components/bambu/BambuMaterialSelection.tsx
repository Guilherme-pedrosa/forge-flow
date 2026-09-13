import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bambuRpc, type BambuJobAllocation } from "@/lib/bambu-production-api";
import { bambuColor, bambuMaterialScope, bambuPlannedMaterialCost, resolveBambuMaterialSelection, selectionBase,
  type BambuMaterialOverride, type BambuMaterialSelectionPreview, type BambuStockMaterial } from "@/lib/bambu-material-selection";

export interface BambuSelectionState { overrides: BambuMaterialOverride[]; ready: boolean; error: string | null }
type Props = {
  taskId: string; productId: string; plateId: string; allocations: BambuJobAllocation[];
  bindings: Record<string, string>; setBindings: Dispatch<SetStateAction<Record<string, string>>>;
  materials: BambuStockMaterial[]; overrides: BambuMaterialOverride[]; onChange: (value: BambuSelectionState) => void;
};
const money = (value: number | null) => value == null ? "Custo pendente" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const colorText = (type: string | null | undefined, color: string | null | undefined) => [type || "Tipo não informado", bambuColor(color) || color || "Cor não informada"].join(" · ");

export default function BambuMaterialSelection({ taskId, productId, plateId, allocations, bindings, setBindings, materials, overrides, onChange }: Props) {
  const [bases, setBases] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["bambu_material_selection_preview", taskId, productId, plateId, allocations, overrides], enabled: !!productId,
    queryFn: () => bambuRpc<BambuMaterialSelectionPreview>("bambu_material_selection_preview", { p_task_id: taskId, p_product_id: productId, p_plate_id: plateId || null, p_allocations: allocations, p_material_overrides: overrides }),
    placeholderData: previous => previous, retry: false,
  });
  const selection = useMemo(() => query.data ? resolveBambuMaterialSelection(query.data, bindings, bases) : null, [query.data, bindings, bases]);
  useEffect(() => {
    if (!query.data || query.isFetching) return;
    setBindings(previous => {
      const next = { ...previous }; let changed = false;
      for (const filament of query.data.filaments) {
        const suggested = filament.item_id || filament.suggested_item_id;
        if (!next[filament.source_key] && suggested) { next[filament.source_key] = suggested; changed = true; }
      }
      return changed ? next : previous;
    });
  }, [query.data, query.isFetching, setBindings]);
  useEffect(() => {
    const problem = query.error?.message || (!productId ? "Selecione o produto desta impressão." : query.isFetching ? "Aguarde a conferência dos materiais desta execução." : selection?.errors[0] || (query.data?.complete === false ? query.data.missing[0] || "A composição desta execução ainda requer revisão." : null));
    onChange({ overrides: selection?.overrides ?? overrides, ready: !!selection && !problem, error: problem });
  }, [query.error, query.isFetching, query.data, selection, productId, overrides, onChange]);

  if (!productId) return <p className="text-sm text-muted-foreground">Selecione o produto para conferir os materiais desta execução.</p>;
  if (query.isLoading) return <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Conferindo composição e materiais…</p>;
  if (query.error) return <div role="alert" className="space-y-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><p>Não foi possível conferir os materiais. {query.error.message}</p><Button type="button" variant="outline" size="sm" className="min-h-11" disabled={query.isFetching} onClick={() => query.refetch()}>Tentar novamente</Button></div>;
  const preview = query.data;
  if (!preview) return <p role="alert" className="text-sm text-destructive">Os materiais desta execução ainda não foram carregados.</p>;
  return <div className="space-y-3" aria-label="Materiais desta execução">
    <div><h3 className="font-medium">Filamentos usados nesta execução</h3><p className="mt-1 text-xs text-muted-foreground">{preview.material_policy === "approved_order" ? "Esta impressão atende uma venda. O material e a cor devem corresponder ao que foi aprovado no pedido." : "Escolha o item físico usado na impressão. Essa escolha fica na execução e preserva a composição base do produto."}</p></div>
    {preview.filaments.map(filament => {
      const base = selectionBase(preview, filament, bases[filament.source_key]);
      const scope = base ? bambuMaterialScope(base) : null;
      const option = preview.material_options.find(option => bambuMaterialScope(option) === scope);
      const available = preview.material_policy === "legacy_unconfigured" ? materials : preview.material_policy === "approved_order"
        ? [...(option?.options ?? materials)].filter(item => item.id === base?.selected_item_id) : option?.options ?? [];
      const item = available.find(item => item.id === bindings[filament.source_key]);
      const targetColor = bambuColor(filament.target_color); const originalColor = bambuColor(filament.source_color);
      return <div key={filament.source_key} className="min-w-0 space-y-3 rounded-xl border p-3">
        <p className="break-words text-sm font-medium">{filament.label}</p>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <p className="rounded-lg bg-primary/5 p-2"><span className="block text-muted-foreground">Na execução</span><span className="mt-1 flex items-center gap-2">{targetColor && <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: targetColor }} />}{colorText(filament.target_type, filament.target_color)}</span></p>
          <p className="rounded-lg bg-muted/40 p-2"><span className="block text-muted-foreground">No arquivo original</span><span className="mt-1 flex items-center gap-2">{originalColor && <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: originalColor }} />}{colorText(filament.source_type, filament.source_color)}</span></p>
        </div>
        {(filament.ams_id != null || filament.slot_id != null) && <p className="text-xs text-muted-foreground">{filament.ams_id === 255 ? "Carretel externo" : filament.ams_id != null ? `AMS ${filament.ams_id}` : "AMS não informado"}{filament.ams_id !== 255 && filament.slot_id != null ? ` · posição ${filament.slot_id + 1}` : ""}</p>}
        {preview.material_policy !== "legacy_unconfigured" && (!filament.base_item_id || !base) && <label className="block space-y-2 text-sm"><span>Material correspondente na composição</span><select aria-label={`Composição de ${filament.label}`} className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3" value={bases[filament.source_key] || ""} onChange={event => setBases(previous => ({ ...previous, [filament.source_key]: event.target.value }))}>
          <option value="">Selecione a linha da composição</option>{preview.expected_materials.map(expected => <option key={bambuMaterialScope(expected)} value={bambuMaterialScope(expected)}>{materials.find(item => item.id === expected.selected_item_id)?.name || colorText(expected.material_code, expected.color_hex || expected.color_code)}</option>)}
        </select></label>}
        <label className="block space-y-2 text-sm"><span>Item do estoque utilizado</span><select aria-label={`Material usado em ${filament.label}`} className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3" value={bindings[filament.source_key] || ""} onChange={event => setBindings(previous => ({ ...previous, [filament.source_key]: event.target.value }))}>
          <option value="">Selecione o material e a cor</option>{bindings[filament.source_key] && !item && <option value={bindings[filament.source_key]} disabled>Seleção anterior indisponível — selecione novamente</option>}{available.map(item => <option key={item.id} value={item.id}>{item.name} · {item.color || item.color_hex || item.color_code || "Cor não identificada"}</option>)}
        </select></label>
        {filament.item_id && bindings[filament.source_key] === filament.item_id && <p className="text-xs text-muted-foreground">Vínculo de estoque identificado para este filamento. Confira antes de salvar.</p>}
        {item && <div className="rounded-lg bg-muted/30 p-2 text-xs"><p>Saldo: {item.current_stock.toLocaleString("pt-BR")} {item.unit} · {money(bambuPlannedMaterialCost(item, filament.planned_grams))} previstos neste filamento.</p><p className="mt-1 text-muted-foreground">Referência de {filament.planned_grams == null ? "peso pendente" : `${filament.planned_grams.toLocaleString("pt-BR")} g`} do fatiador. O custo médio é confirmado no lançamento.</p></div>}
      </div>;
    })}
    {query.isFetching && <p className="text-xs text-muted-foreground">Conferindo a seleção…</p>}
    {selection?.overrides.length ? <p className="rounded-lg bg-primary/5 p-3 text-sm">Material ou cor personalizados para esta execução. A composição base do produto permanece preservada.</p> : null}
    {selection?.errors.length ? <p role="alert" className="text-sm text-destructive">{selection.errors[0]}</p> : null}
    {preview.missing.length > 0 && <p className="text-xs text-muted-foreground">{preview.missing.join(" ")}</p>}
  </div>;
}
