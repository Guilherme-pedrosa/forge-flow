import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { allRows, currency } from "@/lib/finance";
import { pricePrint } from "@/lib/print-pricing";
import { readPricingSettings } from "@/lib/pricing-policy";
import { loadPricingFilaments, MISSING_FILAMENT_COST } from "@/lib/pricing-filaments";
import { printerMachineHourCost, printerMatchesSliceModels, printerModelOptions, recommendFilamentsForEstimate, type ModelPricingEstimate } from "@/lib/model-pricing";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type ImportedProductPrice = { cost: number; price: number; materialId: string | null; materialSelections: Record<string, string>; printerId: string; quantity: number; marginPercent: number };
interface Props {
  estimate: ModelPricingEstimate | null;
  error?: string;
  onCalculated: (value: ImportedProductPrice | null) => void;
  existingMaterialId?: string | null;
  existingPrinterId?: string | null;
  initialQuantity?: number;
  initialSelections?: Record<string, string>;
  showTotals?: boolean;
}
type Selection = { source: string; printerId: string; materialIds: Record<string, string>; quantity: string; editing: boolean; singleConfirmed: boolean; sameFilamentConfirmed: boolean; productionMode: "imported" | "separate" };
const blankSelection = (source: string, quantity?: number, materialIds?: Record<string, string>): Selection => ({ source, printerId: "", materialIds: { ...materialIds }, quantity: quantity != null && Number.isInteger(quantity) && quantity > 0 && quantity <= 10000 ? String(quantity) : "1", editing: false, singleConfirmed: false, sameFilamentConfirmed: false, productionMode: "imported" });

export function ImportedProductPricing(props: Props) {
  const { profile, user } = useAuth();
  return <ProductImportCalculation key={`${profile?.tenant_id ?? "none"}:${user?.id ?? "none"}`} {...props} />;
}

function ProductImportCalculation({ estimate, error, onCalculated, existingMaterialId, existingPrinterId, initialQuantity, initialSelections, showTotals = true }: Props) {
  const { profile } = useAuth();
  const quantityId = useId();
  const source = JSON.stringify(estimate);
  const [selection, setSelection] = useState(() => blankSelection(source, initialQuantity, initialSelections));
  const edits = selection.source === source ? selection : blankSelection(source, initialQuantity, initialSelections);
  const update = (patch: Partial<Selection>) => setSelection({ ...edits, ...patch });
  const deliver = useRef(onCalculated); deliver.current = onCalculated;
  const enabled = !!profile?.tenant_id && !!estimate;
  const company = useQuery({ queryKey: ["pricing_settings", profile?.tenant_id], enabled, queryFn: readPricingSettings });
  const printers = useQuery({ queryKey: ["import-pricing-printers", profile?.tenant_id], enabled,
    queryFn: () => allRows((a, b) => supabase.from("printers")
      .select("id,name,brand,model,power_watts,depreciation_per_hour,acquisition_cost,useful_life_hours,maintenance_cost_per_hour")
      .eq("is_active", true).order("name").order("id").range(a, b)) });
  const filaments = useQuery({ queryKey: ["import-pricing-filaments", profile?.tenant_id], enabled,
    queryFn: loadPricingFilaments });
  const slots = estimate?.materials ?? [];
  const colorIdentity = (color: string | null) => color?.trim().toUpperCase().replace(/^(#[0-9A-F]{6})FF$/, "$1") || null;
  const multipleColors = new Set(slots.map(slot => colorIdentity(slot.colorHex)).filter(Boolean)).size > 1;
  const mixedPlate = slots.some((slot, index) => slots.slice(index + 1).some(other => slot.plateIndices.some(plate => other.plateIndices.includes(plate))));
  const showProductionMode = estimate?.needAms === true || (multipleColors && mixedPlate);
  const modelOptions = printerModelOptions(printers.data ?? [], edits.printerId || existingPrinterId);
  const compatibleOptions = estimate ? modelOptions.filter(option => printerMatchesSliceModels(printers.data!.find(printer => printer.id === option.id)!, estimate.printerModelIds) === true) : [];
  const suggestedOption = compatibleOptions.length === 1 ? compatibleOptions[0] : modelOptions.length === 1 && estimate
    && printerMatchesSliceModels(printers.data!.find(printer => printer.id === modelOptions[0].id)!, estimate.printerModelIds) !== false ? modelOptions[0] : null;
  const existingPrinter = printers.data?.find(printer => printer.id === existingPrinterId
    && estimate && printerMatchesSliceModels(printer, estimate.printerModelIds) !== false);
  const printerId = edits.printerId || existingPrinter?.id || suggestedOption?.id || "";
  const printer = printers.data?.find(candidate => candidate.id === printerId);
  const suggestedFilaments = estimate ? recommendFilamentsForEstimate(estimate, filaments.data ?? []) : {};
  const unknownSingle = slots.length === 1 && !slots[0].materialCode && slots[0].slotId == null;
  const selectedFilaments = slots.map(slot => {
    const existing = slots.length === 1 ? filaments.data?.find(item => item.id === existingMaterialId
      && (unknownSingle || item.material_code?.trim().toUpperCase() === slot.materialCode?.trim().toUpperCase())) : null;
    const id = edits.materialIds[slot.key] || existing?.id || suggestedFilaments[slot.key];
    return filaments.data?.find(item => item.id === id);
  });
  const sameFilamentForAllColors = multipleColors && selectedFilaments.every(Boolean) && new Set(selectedFilaments.map(item => item!.id)).size === 1;
  const loading = !!estimate && (company.isPending || printers.isPending || filaments.isPending);
  let result: ImportedProductPrice | null = null, problem = error ?? "";
  if (!problem) {
    try {
      if (!estimate) throw new Error("Importe o modelo para calcular o custo por peça.");
      if (!profile?.tenant_id) throw new Error("Entre na empresa para calcular o custo.");
      if (loading) throw new Error("Carregando custos e materiais cadastrados…");
      if (company.error || printers.error || filaments.error || !company.data)
        throw new Error("Não foi possível carregar os custos cadastrados. Tente novamente.");
      if (!slots.length || !Number.isFinite(estimate.hours) || estimate.hours <= 0)
        throw new Error("O arquivo não informa tempo e consumo completos. Importe um 3MF fatiado.");
      if (edits.productionMode === "separate")
        throw new Error("Para produzir sem AMS em placas separadas, separe as peças no fatiador e importe o novo 3MF fatiado. O tempo e o consumo do perfil atual não servem para essa configuração.");
      if (!printer) throw new Error("Escolha o modelo de impressão usado neste perfil.");
      if (printerMatchesSliceModels(printer, estimate.printerModelIds) === false)
        throw new Error("O perfil foi fatiado para outra impressora. Escolha uma impressora compatível ou outro perfil.");
      if (selectedFilaments.some(item => !item)) throw new Error("Escolha o filamento do estoque para calcular o custo.");
      if (sameFilamentForAllColors && !edits.sameFilamentConfirmed)
        throw new Error("O perfil tem cores diferentes. Confirme se deseja produzir todas com o mesmo filamento.");
      if (unknownSingle && !edits.singleConfirmed) throw new Error("Confirme que esta impressão usa um único filamento.");
      if (selectedFilaments.some((item, index) => !item?.material_code
        || (slots[index].materialCode ? item.material_code.trim().toUpperCase() !== slots[index].materialCode!.trim().toUpperCase()
          : !unknownSingle || !(edits.materialIds[slots[index].key] || existingMaterialId))))
        throw new Error("O filamento escolhido não corresponde ao material do perfil. Confira o cadastro ou escolha outro perfil.");
      if (selectedFilaments.some(item => item?.cost_confirmed === false)) throw new Error(MISSING_FILAMENT_COST);
      const policy = company.data;
      if ((policy.finishing_minutes_per_piece ?? 0) > 0 && estimate.partCount == null)
        throw new Error("O modelo não informa a quantidade de peças para calcular o acabamento. Importe a composição completa.");
      const quantity = Number(edits.quantity);
      const labor = (policy.handling_minutes_per_plate ?? 0) * estimate.plateCount
        + (policy.finishing_minutes_per_piece ?? 0) * (estimate.partCount ?? 0)
        + (policy.assembly_minutes_per_product ?? 0) * quantity;
      const priced = pricePrint({ quantity: edits.quantity, hours: estimate.hours, watts: printer.power_watts ?? "",
        kwh: policy.energy_cost_kwh ?? "", machineHour: printerMachineHourCost(printer,
          policy.printer_hour_costs.find(rate => rate.printer_id === printer.id)?.hour_cost, policy.machine_hour_cost) ?? "",
        laborMinutes: labor, laborHour: policy.labor_cost_hour ?? "", overhead: policy.overhead_percent ?? "",
        failure: 0, margin: policy.target_margin ?? "", target: "",
        materials: slots.map((slot, index) => ({ name: selectedFilaments[index]!.name, grams: slot.grams,
          kgPrice: selectedFilaments[index]!.avg_cost == null ? "" : selectedFilaments[index]!.avg_cost * (selectedFilaments[index]!.unit === "g" ? 1000 : 1) })),
        extras: policy.extras_cost_per_product == null ? [] : [{ name: "Insumos padrão", cost: policy.extras_cost_per_product, basis: "unit" }],
      });
      const materialIds = [...new Set(selectedFilaments.map(item => item!.id))];
      result = { cost: Math.round(priced.unit * 10000) / 10000, price: priced.suggested,
        materialId: materialIds.length === 1 ? materialIds[0] : null,
        materialSelections: Object.fromEntries(slots.map((slot, index) => [slot.key, selectedFilaments[index]!.id])),
        printerId: printer.id, quantity: priced.quantity, marginPercent: policy.target_margin! };
    } catch (failure) { problem = failure instanceof Error ? failure.message : "Não foi possível calcular o custo."; }
  }
  const signature = JSON.stringify(result);
  useEffect(() => { deliver.current(JSON.parse(signature) as ImportedProductPrice | null); }, [signature, source]);

  const showSelectors = edits.editing || !printer || selectedFilaments.some(item => !item);
  return <section aria-label="Custo do produto importado" className="space-y-3 rounded-lg border bg-muted/20 p-4">
    <h3 className="font-medium">Custo da impressão</h3>
    {estimate && <>
      <p className="text-sm text-muted-foreground">{estimate.hours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h · {estimate.weightGrams.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} g · {estimate.plateCount} placa(s) no perfil.</p>
      <p className="text-xs text-muted-foreground">Tempo e gramas vêm do fatiamento escolhido. A purga só entra quando já está incluída no consumo informado pelo perfil; não acrescentamos uma taxa fixa de AMS.</p>
      {estimate.needAms === true ? <p className="text-sm">Este perfil informa uso de AMS.</p> : estimate.needAms === false ? <p className="text-sm">Este perfil foi informado sem necessidade de AMS.</p> : mixedPlate ? <p className="text-sm">Há mais de um filamento na mesma placa. O arquivo não confirma se usa AMS.</p> : null}
      {showProductionMode && <fieldset className="space-y-2"><legend className="text-sm font-medium">Como você vai produzir?</legend><div className="flex flex-wrap gap-2"><Button type="button" variant={edits.productionMode === "imported" ? "default" : "outline"} aria-pressed={edits.productionMode === "imported"} onClick={() => update({ productionMode: "imported" })}>Como o perfil importado (AMS/multicor)</Button><Button type="button" variant={edits.productionMode === "separate" ? "default" : "outline"} aria-pressed={edits.productionMode === "separate"} onClick={() => update({ productionMode: "separate" })}>Sem AMS, em placas separadas</Button></div></fieldset>}
      {!loading && showSelectors && <div className="space-y-3">
        {(edits.editing || !printer) && <SearchableItemSelect label="Modelo de impressão" value={printerId}
          options={modelOptions}
          emptyLabel="Qual modelo você vai usar?" onChange={id => update({ printerId: id })} />}
        {slots.map((slot, index) => (edits.editing || !selectedFilaments[index]) && <div key={slot.key} className="space-y-1">
          <p className="text-xs text-muted-foreground">{slot.name} · {slot.grams.toLocaleString("pt-BR")} g</p>
          <SearchableItemSelect label={`Filamento ${index + 1} do produto importado`} value={selectedFilaments[index]?.id ?? ""}
            options={(filaments.data ?? []).map(item => ({ id: item.id, label: item.name, description: item.material_code ?? undefined }))}
            emptyLabel="Qual filamento do estoque você vai usar?" onChange={id => update({ materialIds: { ...edits.materialIds, [slot.key]: id }, sameFilamentConfirmed: false })} />
        </div>)}
      </div>}
      {printer && <p className="text-sm">Modelo: {modelOptions.find(option => option.id === printer.id)?.label || printer.model || "Modelo não informado"}</p>}
      {selectedFilaments.every(Boolean) && !!slots.length && (slots.length === 1 ? <p className="text-sm">Filamento: {selectedFilaments[0]!.name}</p> : !showSelectors && <dl aria-label="Filamentos do perfil" className="space-y-2 text-sm">{slots.map((slot, index) => <div key={slot.key}><dt className="text-xs text-muted-foreground">{slot.name} · {slot.grams.toLocaleString("pt-BR")} g</dt><dd>{selectedFilaments[index]!.name}</dd></div>)}</dl>)}
      {unknownSingle && <div className="flex items-center gap-2"><Checkbox id={`${quantityId}-single`} checked={edits.singleConfirmed} onCheckedChange={checked => update({ singleConfirmed: checked === true })} /><Label htmlFor={`${quantityId}-single`}>Esta impressão usa um único filamento</Label></div>}
      {sameFilamentForAllColors && <div className="flex items-center gap-2"><Checkbox id={`${quantityId}-same`} checked={edits.sameFilamentConfirmed} onCheckedChange={checked => update({ sameFilamentConfirmed: checked === true })} /><Label htmlFor={`${quantityId}-same`}>Quero produzir todas as cores com o mesmo filamento</Label></div>}
      {!showSelectors && <Button type="button" variant="link" className="h-auto p-0" onClick={() => update({ editing: true })}>Alterar modelo ou filamento</Button>}
      <div><Label htmlFor={quantityId}>Produtos completos neste perfil</Label><Input id={quantityId} type="number" min={1} max={10000} step={1} value={edits.quantity} onChange={event => update({ quantity: event.target.value })} /></div>
      <p className="text-xs text-muted-foreground">Começa com um produto completo. Se este perfil produz mais unidades, ajuste a quantidade para dividir o custo.</p>
    </>}
    {result ? showTotals && <dl className="grid grid-cols-2 gap-3 text-sm" role="status">
      <div><dt>Custo por peça</dt><dd className="font-semibold">{currency(result.cost)}</dd></div>
      <div><dt>Preço sugerido</dt><dd className="font-semibold">{currency(result.price)}</dd></div>
    </dl> : <p role={loading ? "status" : "alert"} className="text-sm text-muted-foreground">{problem}</p>}
    <Link className="text-xs underline" to="/configuracoes/precificacao">Configurações de custos da empresa</Link>
  </section>;
}
