import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/finance";
import { buildImportedPricingPlan, savedPlatesToComposition } from "@/lib/imported-pricing-plan";
import type { ImportedComposition } from "@/lib/imported-composition";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import { modelPricingFromComposition, modelPricingFromMakerWorld } from "@/lib/model-pricing";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { Button } from "@/components/ui/button";
import { ImportedProductPricing, type ImportedProductPrice } from "./ImportedProductPricing";

export type SavedProductImportPricingProps = {
  productId: string;
  externalImport: ProductExternalImport | null;
  savedPlan?: unknown;
  existingMaterialId?: string | null;
  initialQuantity?: number;
  requestedSourceId?: string | null;
  onBusy?: (busy: boolean) => void;
  onDraft?: (open: boolean) => void;
};
type Source = { id: string; tenant_id: string; product_id: string; label: string; profile_id: string | null; design_id: string | null;
  file_sha256: string | null; file_path: string | null; file_name: string | null; is_active: boolean };
type Plate = { id: string; tenant_id: string; product_id: string; source_id: string | null; plate_index: number; label: string | null;
  units_per_plate: number | null; est_grams: number | null; est_time_seconds: number | null; printer_id: string | null; is_active: boolean; imported_plate_metadata: unknown };
type PricingDatabase = { public: { Tables: {
  product_print_sources: { Row: Source; Insert: Partial<Source>; Update: Partial<Source>; Relationships: [] };
  product_print_plates: { Row: Plate; Insert: Partial<Plate>; Update: Partial<Plate>; Relationships: [] };
}; Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never> } };
const db = supabase as unknown as SupabaseClient<PricingDatabase>;
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10000 ? value : undefined;

function referenceForSource(reference: ProductExternalImport | null, source: Source, composition: ImportedComposition) {
  if (!reference || source.design_id && source.design_id !== reference.design_id)
    throw new Error("A referência deste perfil não está disponível. Importe o 3MF fatiado na composição do produto.");
  const matches = reference.profiles.flatMap(profile => [profile, ...profile.variants]
    .filter(variant => variant.profile_id === composition.profile_id)
    .map(variant => ({ profile, variant })));
  if (matches.length !== 1 || !matches[0].profile.instance_id)
    throw new Error("A referência não identifica o perfil desta impressão. Importe o 3MF fatiado.");
  const { profile, variant } = matches[0];
  return { ...reference, selected_profile_id: profile.instance_id, selected_instance_id: profile.instance_id, selected_variant_profile_id: variant.profile_id };
}

export function SavedProductImportPricing(props: SavedProductImportPricingProps) {
  const { profile, user } = useAuth();
  if (!profile?.tenant_id) return null;
  return <SavedSourceSelection key={`${profile.tenant_id}:${user?.id || "none"}:${props.productId}`} {...props} tenantId={profile.tenant_id} />;
}

function SavedSourceSelection(props: SavedProductImportPricingProps & { tenantId: string }) {
  const [chosenSource, setChosenSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const { productId, tenantId, requestedSourceId, onBusy, onDraft } = props;
  const reportBusy = useCallback((busy: boolean) => { setSaving(busy); onBusy?.(busy); }, [onBusy]);
  const reportDraft = useCallback((open: boolean) => { setDraftOpen(open); onDraft?.(open); }, [onDraft]);
  const sources = useQuery({ queryKey: ["product_print_sources", tenantId, productId, "pricing"],
    queryFn: () => allRows((from, to) => db.from("product_print_sources")
      .select("id,tenant_id,product_id,label,profile_id,design_id,file_sha256,file_path,file_name,is_active")
      .eq("tenant_id", tenantId).eq("product_id", productId).eq("is_active", true).order("id").range(from, to)) });
  const plates = useQuery({ queryKey: ["product_print_plates", tenantId, productId, "pricing"],
    queryFn: () => allRows((from, to) => db.from("product_print_plates")
      .select("id,tenant_id,product_id,source_id,plate_index,label,units_per_plate,est_grams,est_time_seconds,printer_id,is_active,imported_plate_metadata")
      .eq("tenant_id", tenantId).eq("product_id", productId).eq("is_active", true).order("plate_index").order("id").range(from, to)) });
  const candidates = useMemo(() => (sources.data ?? []).filter(source => (plates.data ?? []).some(plate => plate.source_id === source.id))
    .map(source => {
      const sourcePlates = (plates.data ?? []).filter(plate => plate.source_id === source.id);
      try { return { source, plates: sourcePlates, composition: savedPlatesToComposition(source, sourcePlates), error: "" }; }
      catch (error) { return { source, plates: sourcePlates, composition: null, error: (error as Error).message }; }
    }), [sources.data, plates.data]);
  if (sources.isPending || plates.isPending) return <p role="status" className="text-sm text-muted-foreground">Carregando dados da impressão…</p>;
  if (sources.error || plates.error) return <p role="alert" className="text-sm text-destructive">Não foi possível carregar os dados da impressão. <button type="button" className="underline" onClick={() => { void sources.refetch(); void plates.refetch(); }}>Tentar novamente</button></p>;
  if (!candidates.length) {
    const orphanedImport = plates.data?.some(plate => !plate.source_id && (object(plate.imported_plate_metadata).file_profile_id || object(plate.imported_plate_metadata).local_file_hash));
    return requestedSourceId ? <p role="alert">A impressão solicitada não está disponível neste produto.</p>
      : orphanedImport ? <p role="alert" className="text-sm text-muted-foreground">Este arquivo antigo não tem uma fonte salva. Abra Composição / produção e importe novamente o 3MF fatiado para vincular seus dados ao cadastro.</p> : null;
  }
  const saved = object(props.savedPlan);
  const preferred = chosenSource || requestedSourceId || (saved.version === 1 && typeof saved.source_id === "string" && candidates.some(candidate => candidate.source.id === saved.source_id) ? saved.source_id : "");
  const selected = candidates.find(candidate => candidate.source.id === preferred) || (!preferred && candidates.length === 1 ? candidates[0] : null);
  const sameProfileSources = selected?.composition ? candidates.filter(candidate => candidate.composition?.profile_id === selected.composition?.profile_id
    && (candidate.composition?.file_sha256 ?? null) === (selected.composition?.file_sha256 ?? null)).length : 0;
  const matchesSaved = !!selected?.composition && saved.version === 1 && saved.source_profile_id === selected.composition.profile_id
    && (saved.source_file_sha256 ?? null) === (selected.composition.file_sha256 ?? null)
    && (saved.source_id ? saved.source_id === selected.source.id : sameProfileSources === 1);
  return <section aria-label="Dados da impressão cadastrada" className="space-y-3">
    {candidates.length > 1 && <SearchableItemSelect label="Perfil de impressão do produto" value={selected?.source.id || ""} disabled={saving || draftOpen}
      options={candidates.map(candidate => ({ id: candidate.source.id, label: candidate.source.label || candidate.source.file_name || "Perfil de impressão" }))}
      emptyLabel="Escolha a impressão que deseja preparar" onChange={setChosenSource} />}
    {!selected ? requestedSourceId && !chosenSource && !candidates.some(candidate => candidate.source.id === requestedSourceId)
      ? <p role="alert" className="text-sm text-destructive">A impressão solicitada não está disponível neste produto.</p>
      : <p className="text-sm text-muted-foreground">Escolha o perfil para conferir os filamentos, a impressora e a quantidade.</p>
      : selected.error || !selected.composition ? <p role="alert" className="text-sm text-destructive">{selected.error} Importe novamente o 3MF fatiado na composição do produto.</p>
        : <SavedSourcePreparation key={selected.source.id} {...props} source={selected.source} plates={selected.plates} composition={selected.composition}
          saved={matchesSaved ? saved : {}} allowLegacy={candidates.length === 1} onBusy={reportBusy} onDraft={reportDraft} />}
  </section>;
}

function SavedSourcePreparation({ productId, tenantId, externalImport, existingMaterialId, initialQuantity, onBusy, onDraft, source, plates, composition, saved, allowLegacy }:
  SavedProductImportPricingProps & { tenantId: string; source: Source; plates: Plate[]; composition: ImportedComposition; saved: Record<string, unknown>; allowLegacy: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [calculated, setCalculated] = useState<ImportedProductPrice | null>(null);
  const [auxiliaryBusy, setAuxiliaryBusy] = useState(false), [auxiliaryDraft, setAuxiliaryDraft] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const prepared = useMemo(() => {
    try {
      if (composition.plates.some(plate => !!plate.slicer_estimates) || composition.profile_id.startsWith("local:"))
        return { estimate: modelPricingFromComposition(composition), reference: null, error: "" };
      const reference = referenceForSource(externalImport, source, composition);
      return { estimate: modelPricingFromMakerWorld(reference), reference, error: "" };
    } catch (error) { return { estimate: null, reference: null, error: (error as Error).message }; }
  }, [composition, externalImport, source]);
  const mappings = Object.fromEntries((Array.isArray(saved.materials) ? saved.materials : []).flatMap(value => {
    const material = object(value);
    return typeof material.source_key === "string" && typeof material.item_id === "string" ? [[material.source_key, material.item_id]] : [];
  }));
  const savedPrinters = [...new Set(plates.map(plate => plate.printer_id).filter((value): value is string => !!value))];
  const savedQuantity = plates.every(plate => count(plate.units_per_plate) != null) && new Set(plates.map(plate => plate.units_per_plate)).size === 1 ? count(plates[0].units_per_plate) : undefined;
  let plan: ReturnType<typeof buildImportedPricingPlan> | null = null, problem = "";
  if (calculated && prepared.estimate) {
    try { plan = buildImportedPricingPlan(prepared.estimate, composition, { ...calculated, sourceId: source.id }, prepared.reference); }
    catch (error) { problem = (error as Error).message; }
  }
  const save = useMutation({ mutationFn: async () => {
    if (auxiliaryBusy || auxiliaryDraft) throw new Error("Conclua ou cancele o cadastro do filamento antes de salvar a impressão.");
    if (!plan) throw new Error(problem || "Confirme os dados da impressão antes de salvar.");
    const signature = JSON.stringify(plan);
    const transaction = request.current?.signature === signature ? request.current : { signature, id: crypto.randomUUID() };
    request.current = transaction;
    const { data, error } = await rpc("save_product_import_pricing", { p_product_id: productId, p_plan: plan, p_request_id: transaction.id });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("A impressão não foi confirmada. Atualize os dados antes de tentar novamente.");
  }, onSuccess: async () => {
    await Promise.all(["products", "product_print_sources", "product_print_plates", "product_material_recipe", "product_print_plate_preparation", "assembly_status", "piece_spec", "product_plate_learning"]
      .map(key => qc.invalidateQueries({ queryKey: [key] })));
    toast({ title: "Dados da impressão salvos", description: "Filamentos, impressora e quantidade estão disponíveis nos detalhes e na produção." });
  }, onError: (error: Error) => toast({ title: "Não foi possível salvar a impressão", description: error.message, variant: "destructive" }) });
  useEffect(() => { onBusy?.(save.isPending || auxiliaryBusy); return () => onBusy?.(false); }, [onBusy, save.isPending, auxiliaryBusy]);
  useEffect(() => { onDraft?.(auxiliaryDraft); return () => onDraft?.(false); }, [onDraft, auxiliaryDraft]);
  if (prepared.error) return <p role="alert" className="text-sm text-destructive">{prepared.error}</p>;
  return <fieldset className="space-y-3" disabled={save.isPending}>
    <ImportedProductPricing estimate={prepared.estimate} onCalculated={setCalculated} showTotals={false}
      onAuxiliaryBusy={setAuxiliaryBusy} onAuxiliaryDraft={setAuxiliaryDraft}
      existingMaterialId={allowLegacy ? existingMaterialId : null}
      existingPrinterId={typeof saved.printer_id === "string" ? saved.printer_id : savedPrinters.length === 1 && plates.every(plate => plate.printer_id === savedPrinters[0]) ? savedPrinters[0] : null}
      initialQuantity={count(saved.quantity) ?? savedQuantity ?? (allowLegacy && composition.plates.length === 1 ? count(initialQuantity) : undefined)} initialSelections={mappings} />
    {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    <Button type="button" disabled={!plan || save.isPending || auxiliaryBusy || auxiliaryDraft} onClick={() => save.mutate()}>{save.isPending ? "Salvando impressão…" : "Salvar dados da impressão"}</Button>
  </fieldset>;
}

export default SavedProductImportPricing;
