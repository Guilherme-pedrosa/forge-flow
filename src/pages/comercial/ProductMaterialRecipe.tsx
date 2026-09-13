import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FlaskConical, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { allRows } from "@/lib/finance";
import { materialColorSwatch } from "@/lib/material-identity";
import { importedPlateFilaments, importedRecipeDraft, observedPlateFilaments, type ImportedPlatePreparation } from "@/lib/imported-plate-materials";
import { orderRequest } from "@/lib/sales-order";
import { convertRecipeBasis, prepareRecipeLines, recipeNonMaterialCost, type ProductMaterialSnapshot, type RecipeBasis, type RecipeDraftLine } from "@/lib/product-material-recipe";

type Material = { id: string; tenant_id: string; name: string; unit: string; material_code: string | null; material_description: string | null; color: string | null; color_code: string | null; color_hex: string | null; material_identified_at: string | null; is_active: boolean; current_stock: number; avg_cost: number };
type Version = { id: string; tenant_id: string; product_id: string; plate_id: string | null; version: number; basis: RecipeBasis; units_per_print: number; notes: string | null; created_at: string; is_current: boolean };
type Table<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
type RecipeDatabase = { public: { Tables: { inventory_items: Table<Material>; product_material_recipe_versions: Table<Version> }; Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never> } };
const db = supabase as unknown as SupabaseClient<RecipeDatabase>;
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const fmt = (value: number | null | undefined) => value == null ? "Pendente" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 4 });
const grams = (value: number) => `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} g`;
const materialLabel = (item: Material) => `${item.name} · ${item.material_code === "OTHER" ? item.material_description : item.material_code} · ${item.color} [${item.color_code}]`;
const selectClass = "flex min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export async function fetchProductMaterialRecipe(productId: string): Promise<ProductMaterialSnapshot> {
  const { data, error } = await rpc("product_material_recipe_preview", { p_product_id: productId });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") throw new Error("A composição não retornou dados. Tente novamente.");
  return data as ProductMaterialSnapshot;
}

export async function fetchProductPlatePreparation(plateId: string): Promise<ImportedPlatePreparation> {
  const { data, error } = await rpc("product_print_plate_preparation", { p_plate_id: plateId });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Não foi possível consultar a preparação da placa.");
  return data as ImportedPlatePreparation;
}

export default function ProductMaterialRecipe({ productId, tenantId, plateId = null, importedFilaments, importedPlateMetadata, startEditing = false, suggestedNonMaterialCost, onBusyChange, onDraftChange, onSaved }: {
  productId: string; tenantId: string; plateId?: string | null;
  importedFilaments?: unknown; importedPlateMetadata?: unknown; startEditing?: boolean; suggestedNonMaterialCost?: number | null; onBusyChange?: (busy: boolean) => void; onDraftChange?: (editing: boolean) => void; onSaved?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const request = useRef<{ signature: string; id: string } | null>(null);
  const autoStarted = useRef(false);
  const [editing, setEditing] = useState(false);
  const [basis, setBasis] = useState<RecipeBasis>("per_print");
  const [lines, setLines] = useState<RecipeDraftLine[]>([]);
  const [otherCost, setOtherCost] = useState("");
  const [notes, setNotes] = useState("");
  const [conversionNotice, setConversionNotice] = useState(false);
  const [yieldDraft, setYieldDraft] = useState("");
  const queryKey = ["product_material_recipe", tenantId, productId];
  const preview = useQuery({ queryKey, queryFn: () => fetchProductMaterialRecipe(productId) });
  const inventory = useQuery({ queryKey: ["recipe_inventory_items", tenantId], enabled: editing || !!plateId, queryFn: () => allRows((from, to) => db.from("inventory_items").select("*").eq("tenant_id", tenantId).eq("is_active", true).in("unit", ["g", "kg"]).order("name").order("id").range(from, to)) });
  const history = useQuery({ queryKey: ["product_material_recipe_history", tenantId, productId, plateId], queryFn: () => allRows((from, to) => {
    let query = db.from("product_material_recipe_versions").select("*").eq("tenant_id", tenantId).eq("product_id", productId);
    query = plateId ? query.eq("plate_id", plateId) : query.is("plate_id", null);
    return query.order("version", { ascending: false }).order("id").range(from, to);
  }) });
  const plate = plateId ? preview.data?.plates.find(value => value.id === plateId) : null;
  const recipe = plateId ? plate?.recipe : preview.data?.recipe;
  const rawUnits = plateId ? plate?.units_per_plate : preview.data?.product.prints_per_plate;
  const confirmedUnits = rawUnits != null && Number.isInteger(rawUnits) && rawUnits >= 1 && rawUnits <= 10_000 ? rawUnits : null;
  const pendingUnits = /^\d+$/.test(yieldDraft) && Number(yieldDraft) >= 1 && Number(yieldDraft) <= 10_000 ? Number(yieldDraft) : null;
  const units = confirmedUnits ?? pendingUnits;
  const imported = importedPlateFilaments(plate?.imported_filaments ?? importedFilaments);
  const observed = observedPlateFilaments(plate?.imported_plate_metadata ?? importedPlateMetadata);
  const preparation = useQuery({ queryKey: ["product_print_plate_preparation", tenantId, plateId], enabled: !!plateId && (imported.length > 0 || observed.length > 0), queryFn: () => fetchProductPlatePreparation(plateId!) });
  const perPrintEnergy = preparation.data?.energy_cost_per_print;
  const perPrintMachine = preparation.data?.machine_cost_per_print;
  const suggestedCost = suggestedNonMaterialCost ?? preparation.data?.non_material_cost_per_unit_suggestion
    ?? (units != null && perPrintEnergy != null && perPrintMachine != null ? (perPrintEnergy + perPrintMachine) / units : null);
  const materials = (inventory.data ?? []).filter(item => item.material_code && item.color && item.color_code && item.material_identified_at);
  const save = useMutation({ mutationFn: async () => {
    if (units == null) throw new Error("Informe quantas unidades do produto esta impressão atende.");
    const prepared = prepareRecipeLines(lines);
    if (prepared.some(line => !materials.some(item => item.id === line.item_id))) throw new Error("Cada linha precisa de um item ativo, em g/kg, com material e cor identificados no estoque.");
    const prepareYield = plateId != null && confirmedUnits == null;
    const payload = { p_product_id: productId, p_plate_id: plateId, p_basis: basis, p_lines: prepared, p_notes: notes.trim() || null, p_non_material_cost_per_unit: recipeNonMaterialCost(otherCost), ...(prepareYield ? { p_units_per_plate: units } : {}) };
    request.current = orderRequest(request.current, JSON.stringify(payload));
    const { data, error } = await rpc(prepareYield ? "prepare_product_plate_recipe" : "save_product_material_recipe", { ...payload, p_request_id: request.current.id });
    if (error) throw new Error(error.message);
    if (typeof data !== "string") throw new Error("Não foi possível confirmar o salvamento da composição. Tente novamente.");
    return data;
  }, onSuccess: () => {
    setEditing(false); request.current = null;
    void Promise.all([
      qc.invalidateQueries({ queryKey: ["product_material_recipe"] }),
      qc.invalidateQueries({ queryKey: ["product_material_recipe_history", tenantId, productId] }),
      qc.invalidateQueries({ queryKey: ["product_material_requirements"] }),
      qc.invalidateQueries({ queryKey: ["product_print_plate_preparation"] }),
      qc.invalidateQueries({ queryKey: ["product_print_plates"] }),
      qc.invalidateQueries({ queryKey: ["products"] }),
      qc.invalidateQueries({ queryKey: ["quote_products"] }),
    ]);
    onSaved?.();
    toast({ title: "Nova versão da composição salva", description: "Orçamentos já emitidos mantêm a versão aprovada." });
  }, onError: error => toast({ title: "Composição não salva", description: error.message, variant: "destructive" }) });
  // Opening a draft must never lock its containing dialog. Only an active write does.
  useEffect(() => { onBusyChange?.(save.isPending); return () => onBusyChange?.(false); }, [save.isPending, onBusyChange]);
  useEffect(() => { onDraftChange?.(editing); return () => onDraftChange?.(false); }, [editing, onDraftChange]);
  const cancelEdit = () => {
    if (save.isPending) return;
    setEditing(false); setLines([]); setOtherCost(""); setNotes(""); setConversionNotice(false); setYieldDraft("");
  };
  useEffect(() => { setEditing(false); setLines([]); setOtherCost(""); setNotes(""); setConversionNotice(false); setYieldDraft(""); request.current = null; autoStarted.current = false; }, [productId, plateId]);
  const beginEdit = (useObserved = false) => {
    setYieldDraft(confirmedUnits == null ? "" : String(confirmedUnits));
    setBasis(recipe?.basis ?? "per_print");
    const reference = useObserved ? observed : imported;
    setLines(recipe?.lines.map(line => ({ item_id: line.item_id, grams: String(line.grams) })) ?? (reference.length ? importedRecipeDraft(reference, materials) : [{ item_id: "", grams: "" }]));
    setOtherCost(recipe?.non_material_cost_per_unit == null ? "" : String(recipe.non_material_cost_per_unit));
    setNotes(recipe?.notes ?? (useObserved ? "Composição baseada no material usado nesta impressão Bambu; revisar cor e consumo para este produto." : "")); setConversionNotice(false); setEditing(true);
  };
  const changeBasis = (next: RecipeBasis) => {
    try { setLines(convertRecipeBasis(lines, basis, next, units)); setBasis(next); setConversionNotice(true); }
    catch (error) { toast({ title: "Revise a quantidade", description: (error as Error).message, variant: "destructive" }); }
  };
  useEffect(() => {
    if (startEditing && !autoStarted.current && preview.data && !preview.error && !inventory.isLoading && !inventory.error) {
      autoStarted.current = true; beginEdit();
    }
  }, [startEditing, preview.data, preview.error, inventory.isLoading, inventory.error]);
  if (preview.isLoading) return <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando composição…</div>;
  if (preview.error) return <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm"><p>{preview.error.message}</p><Button type="button" variant="outline" size="sm" onClick={() => preview.refetch()}>Tentar novamente</Button></div>;
  if (!plateId && (preview.data?.plates.length || preview.data?.components.length)) return <p className="text-sm text-muted-foreground">A composição deste produto é a soma das receitas de suas placas ou dos componentes do kit. Edite cada parte correspondente.</p>;
  if (plateId && !plate) return <p role="alert" className="text-sm text-destructive">Esta placa não está ativa. Atualize o produto para continuar.</p>;
  return <section className="min-w-0 space-y-4 rounded-lg border bg-card p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4 shrink-0" />Composição de materiais{plateId ? " da placa" : " do produto"}</h3><p className="mt-1 text-xs text-muted-foreground">Materiais e cores exatos do estoque. Cada alteração cria uma versão.</p></div>
      {!editing && <Button type="button" variant="outline" size="sm" disabled={!recipe && imported.length > 0 && inventory.isLoading} onClick={() => beginEdit()}>{!recipe && imported.length > 0 && inventory.isLoading ? "Carregando estoque…" : recipe ? "Revisar composição" : "Definir composição"}</Button>}
    </div>
    {units == null ? !editing && <p role="status" className="text-sm text-muted-foreground">Rendimento pendente. Informe a quantidade ao preparar a composição abaixo.</p> : <p className="text-sm">Uma impressão atende <strong>{units} unidade(s)</strong>{plateId ? " deste produto, para esta placa." : " deste produto."}</p>}
    {!recipe && imported.length > 0 && <p className="text-xs text-muted-foreground">A composição será preenchida com os filamentos e os gramas por impressão importados. Apenas correspondências únicas de material e amostra de cor do estoque são selecionadas automaticamente; revise antes de salvar.</p>}
    {!recipe && observed.length > 0 && <div className="space-y-2 rounded-md border p-3 text-xs"><p className="font-medium">Material usado nesta impressão</p><p className="text-muted-foreground">A cor usada pode ser diferente do arquivo. Escolha esta referência para fabricar a versão correspondente.</p><Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={save.isPending || inventory.isLoading || !!inventory.error} onClick={() => { if (!editing) beginEdit(true); else { setBasis("per_print"); setLines(importedRecipeDraft(observed, materials)); setNotes("Composição baseada no material usado nesta impressão Bambu; revisar cor e consumo para este produto."); } }}>Usar esta execução como referência</Button></div>}
    {!editing && <>
      {recipe ? <>
        <div className="flex items-center gap-2 text-sm">{recipe.complete ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}<span>Versão {recipe.version} · {recipe.complete ? "Composição e custo completos" : "Composição com pendências"}</span></div>
        {recipe.lines.map(line => <div key={line.item_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-3 text-sm">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{line.name}</p><p className="flex items-center gap-2 text-xs text-muted-foreground"><span className="inline-block h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: materialColorSwatch(line.color_hex) }} /><span className="break-words">{line.material_code} · {line.color} · {line.color_code}</span></p></div>
          <div className="text-xs tabular-nums"><p>{grams(line.grams_per_unit)} / unidade</p><p className="text-muted-foreground">{grams(line.grams_per_print)} / impressão</p></div>
        </div>)}
        {!!recipe.missing.length && <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">{recipe.missing.map((item, index) => <li key={index}>{item}</li>)}</ul>}
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Materiais / unidade{!recipe.complete ? " (previsão parcial)" : ""}</p><strong className="tabular-nums">{fmt(recipe.material_cost_per_unit)}</strong></div><div><p className="text-xs text-muted-foreground">Demais custos / unidade</p><strong className="tabular-nums">{fmt(recipe.non_material_cost_per_unit)}</strong></div><div><p className="text-xs text-muted-foreground">Custo completo / unidade</p><strong className="tabular-nums">{fmt(recipe.cost_per_unit)}</strong></div></div>
        <p className="text-xs text-muted-foreground">A previsão usa o custo médio atual de cada item do estoque. Valores aprovados em orçamentos ficam preservados no documento.</p>
      </> : <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">{imported.length ? "Confira os materiais sugeridos e confirme somente as informações pendentes." : "Defina os materiais, as cores e os gramas necessários. O material legado do produto não é convertido automaticamente em uma receita."}</p>}
    </>}
    {editing && <div className="space-y-4">
      {plateId && confirmedUnits == null && <label className="block space-y-1.5 rounded-md bg-primary/5 p-3"><span className="text-sm font-medium">Quantas unidades do produto esta impressão atende?</span><Input aria-label="Quantas unidades do produto esta impressão atende?" type="number" inputMode="numeric" min="1" max="10000" step="1" value={yieldDraft} disabled={save.isPending} onChange={event => setYieldDraft(event.target.value)} placeholder="Ex.: 4" /><span className="block text-xs text-muted-foreground">Quatro bases para quatro produtos = 4. Os gramas abaixo continuam por impressão inteira. Rendimento e composição serão salvos juntos.</span></label>}
      <label className="block space-y-1.5"><span className="text-xs font-medium">Os gramas informados correspondem a</span><select className={selectClass} value={basis} disabled={save.isPending || units == null} onChange={event => changeBasis(event.target.value as RecipeBasis)}><option value="per_unit">Uma unidade do produto{plateId ? ", nesta placa" : ""}</option><option value="per_print">{units == null ? "Uma impressão inteira (rendimento pendente)" : `Uma impressão inteira (${units} unidades)`}</option></select></label>
      {conversionNotice && <p className="text-xs text-muted-foreground">Os gramas foram convertidos para preservar a mesma composição. Revise antes de salvar.</p>}
      {recipe && units != null && recipe.units_per_print !== units && <p className="text-xs text-amber-700">A capacidade mudou de {recipe.units_per_print} para {units} unidades. Confira os gramas e os demais custos desta nova versão.</p>}
      {inventory.isLoading && <p className="text-sm text-muted-foreground">Carregando materiais…</p>}
      {inventory.error && <p role="alert" className="text-sm text-destructive">Falha ao carregar o estoque. <button type="button" className="underline" onClick={() => inventory.refetch()}>Tentar novamente</button></p>}
      {!inventory.isLoading && !inventory.error && !materials.length && <p className="rounded-md border border-amber-500/30 p-3 text-sm">Identifique primeiro o material, o nome e o código da cor em Estoque → Itens. A unidade do estoque deve ser g ou kg.</p>}
      {lines.map((line, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border p-3">
        {line.imported_reference && <p className="col-span-2 break-words text-xs text-muted-foreground">Referência de filamento: {line.imported_reference}.{!line.item_id && <span className="block mt-1 text-amber-800 dark:text-amber-300">{line.imported_match === "ambiguous" ? "Há mais de um item com esse material e cor. Escolha o estoque correto." : "Sem correspondência única no estoque. Selecione o material e a cor corretos."}</span>}</p>}
        <label className="col-span-2 block min-w-0 space-y-1.5"><span className="text-xs font-medium">Material e cor · linha {index + 1}</span><select className={selectClass} value={line.item_id} disabled={save.isPending} onChange={event => setLines(lines.map((value, row) => row === index ? { ...value, item_id: event.target.value } : value))}><option value="">Selecione o item exato do estoque</option>{line.item_id && !materials.some(item => item.id === line.item_id) && <option value={line.item_id} disabled>{recipe?.lines.find(item => item.item_id === line.item_id)?.name ?? "Item atual"} · indisponível ou não identificado</option>}{materials.map(item => <option key={item.id} value={item.id}>{materialLabel(item)}</option>)}</select></label>
        <label className="block space-y-1.5"><span className="text-xs font-medium">Gramas / {basis === "per_print" ? "impressão inteira" : "unidade"}</span><Input inputMode="decimal" value={line.grams} disabled={save.isPending} onChange={event => setLines(lines.map((value, row) => row === index ? { ...value, grams: event.target.value } : value))} placeholder="Ex.: 25,5" /></label>
        <Button type="button" variant="ghost" size="icon" className="self-end" disabled={save.isPending || lines.length === 1} aria-label={`Remover material ${index + 1}`} onClick={() => setLines(lines.filter((_, row) => row !== index))}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
      <Button type="button" variant="outline" size="sm" disabled={save.isPending || lines.length >= 64} onClick={() => setLines([...lines, { item_id: "", grams: "" }])}><Plus className="mr-2 h-4 w-4" />Adicionar material ou outra cor</Button>
      <div className="space-y-2 rounded-md bg-muted/40 p-3"><label className="block space-y-1.5"><span className="text-xs font-medium">Demais custos por unidade: energia, máquina, trabalho e adicionais</span><Input inputMode="decimal" value={otherCost} onChange={event => setOtherCost(event.target.value)} disabled={save.isPending} placeholder="Informe o valor em R$, inclusive 0" /></label><p className="text-xs text-muted-foreground">{plateId ? "Informe somente o custo desta placa por unidade do produto. " : ""}Inclua acabamento e extras correspondentes uma única vez. Este valor exige confirmação, mesmo quando for zero.</p>{suggestedCost != null && Number.isFinite(suggestedCost) && suggestedCost >= 0 && <><Button type="button" variant="outline" size="sm" className="h-auto min-h-11 whitespace-normal text-left" disabled={save.isPending} onClick={() => setOtherCost(String(Number(suggestedCost.toFixed(6))))}>{suggestedNonMaterialCost == null ? "Preencher energia e máquina" : "Preencher sugestão do cálculo"}: {fmt(suggestedCost)}</Button>{suggestedNonMaterialCost == null && <p className="text-xs text-muted-foreground">Energia e máquina já calculadas a partir da impressão e da impressora. Acrescente trabalho, acabamento e outros adicionais que se aplicarem.</p>}</>}</div>
      <label className="block space-y-1.5"><span className="text-xs font-medium">Motivo ou observações desta versão</span><Textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={save.isPending} placeholder="Ex.: ajuste de suporte ou revisão do consumo de cada cor" /></label>
      <p className="text-xs text-muted-foreground">Ao trocar um item, você declara uma nova composição. O sistema não substitui cor ou material apenas por nome semelhante.</p>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" className="min-h-11" variant="outline" disabled={save.isPending} onClick={cancelEdit}>Cancelar composição</Button><Button type="button" className="min-h-11" disabled={save.isPending || inventory.isLoading || !!inventory.error || units == null} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar nova versão</Button></div>
    </div>}
    {history.error && <p className="text-xs text-destructive">Não foi possível consultar o histórico de versões.</p>}
    {!!history.data?.length && <details className="border-t pt-3 text-xs"><summary className="cursor-pointer font-medium">Histórico · {history.data.length} versão(ões)</summary><ol className="mt-3 space-y-2">{history.data.map(version => <li key={version.id} className="break-words text-muted-foreground"><strong className="text-foreground">v{version.version}{version.is_current ? " · atual" : ""}</strong> · {new Date(version.created_at).toLocaleString("pt-BR")} · {version.units_per_print} un./impressão{version.notes ? ` · ${version.notes}` : ""}</li>)}</ol></details>}
  </section>;
}
