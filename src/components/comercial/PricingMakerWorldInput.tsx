import { useEffect, useId, useRef, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { externalImportReference, fetchMakerWorldModel, type ProductExternalImport } from "@/lib/makerworld-import";
import { parseMakerWorldUrl, type MakerWorldModel, type MakerWorldVariant } from "../../../supabase/functions/_shared/makerworld";
import { printerMatchesSliceModels } from "@/lib/model-pricing";

interface Props {
  reference: ProductExternalImport | null;
  onLoaded: (reference: ProductExternalImport | null) => void;
  onPending?: () => void;
  ownedPrinters?: { model?: string | null; brand?: string | null; name?: string }[];
}
type Choice = { key: string; profileIndex: number; variant: MakerWorldVariant; label: string };
function choicesFor(model: MakerWorldModel | null, ownedPrinters?: Props["ownedPrinters"]): Choice[] {
  return model?.profiles.flatMap((profile, profileIndex) => {
    const seen = new Set<string>();
    return [profile, ...profile.variants].flatMap((variant, variantIndex) => {
      const identity = variant.profile_id ?? `unknown-${variantIndex}`;
      if (seen.has(identity)) return [];
      seen.add(identity);
      if (ownedPrinters && !ownedPrinters.some(printer => printerMatchesSliceModels(printer,
        [variant.printer_model || variant.printer_code || ""]) === true)) return [];
      return [{ key: `${profileIndex}:${variantIndex}`, profileIndex, variant,
        label: [profile.name || `Perfil ${profileIndex + 1}`, variant.printer_model || variant.printer_code,
          profile.need_ams === true ? "com AMS" : profile.need_ams === false ? "sem AMS" : null,
          variant.nozzle_diameter ? `bico ${variant.nozzle_diameter.toLocaleString("pt-BR")} mm` : null].filter(Boolean).join(" · ") }];
    });
  }) ?? [];
}
function choiceForReference(reference: ProductExternalImport | null) {
  return choicesFor(reference).find(choice => reference?.profiles[choice.profileIndex].instance_id === reference.selected_profile_id
    && choice.variant.profile_id === reference.selected_variant_profile_id)?.key ?? "";
}

/** Reuses the existing MakerWorld import service; does not infer missing metrics. */
export function PricingMakerWorldInput({ reference, onLoaded, onPending, ownedPrinters }: Props) {
  const inputId = useId();
  const [url, setUrl] = useState(reference?.source_url ?? "");
  const [model, setModel] = useState<MakerWorldModel | null>(reference);
  const [sourceUrl, setSourceUrl] = useState(reference?.source_url ?? "");
  const [selected, setSelected] = useState(choiceForReference(reference));
  const [chooseProfile, setChooseProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const expected = useRef(reference);
  const fleet = useRef(ownedPrinters); fleet.current = ownedPrinters;
  const deliver = useRef(onLoaded), pending = useRef(onPending);
  deliver.current = onLoaded; pending.current = onPending;
  const choices = choicesFor(model, ownedPrinters);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (expected.current === reference) return;
    expected.current = reference;
    request.current?.abort(); request.current = null;
    setBusy(false); setError(""); setChooseProfile(false);
    setUrl(reference?.source_url ?? ""); setSourceUrl(reference?.source_url ?? "");
    setModel(reference); setSelected(choiceForReference(reference));
  }, [reference]);

  // The import may finish before the fleet query. Reconcile once the owned
  // models arrive instead of leaving a loaded model without a selectable plan.
  useEffect(() => {
    if (!model || busy || selected || !choices.length) return;
    let requestedId: string | null = null;
    try { requestedId = parseMakerWorldUrl(sourceUrl).instanceId; } catch { /* supplied reference may lack a usable link */ }
    const requested = requestedId ? choices.filter(choice => model.profiles[choice.profileIndex].instance_id === requestedId) : [];
    const automatic = requested.length === 1 ? requested[0] : choices.length === 1 ? choices[0] : null;
    if (automatic) selectChoice(model, sourceUrl, automatic);
    else if (!chooseProfile) setChooseProfile(true);
  }, [model, busy, selected, sourceUrl, ownedPrinters, chooseProfile]);

  function emit(next: ProductExternalImport | null) {
    expected.current = next; deliver.current(next);
  }
  function selectChoice(nextModel: MakerWorldModel, link: string, choice: Choice) {
    const next = externalImportReference(nextModel, link, choice.profileIndex);
    next.selected_variant_profile_id = choice.variant.profile_id;
    setSelected(choice.key); setChooseProfile(false); setError(""); emit(next);
  }
  function editLink(value: string) {
    request.current?.abort(); request.current = null;
    setBusy(false); setError(""); setUrl(value); setModel(null); setSelected(""); setChooseProfile(false);
    emit(null);
  }
  async function load() {
    request.current?.abort();
    const current = new AbortController(); request.current = current;
    setBusy(true); setError(""); setModel(null); setSelected(""); setChooseProfile(false);
    emit(null); pending.current?.();
    try {
      const source = parseMakerWorldUrl(url.trim());
      const next = await fetchMakerWorldModel(source.url, current.signal);
      if (current.signal.aborted || request.current !== current) return;
      setModel(next); setSourceUrl(source.url);
      const all = choicesFor(next, fleet.current);
      const requested = source.instanceId ? all.filter(choice => next.profiles[choice.profileIndex].instance_id === source.instanceId) : [];
      const automatic = requested.length === 1 ? requested[0] : all.length === 1 ? all[0] : null;
      if (automatic) selectChoice(next, source.url, automatic);
      else if (all.length) setChooseProfile(true);
      else emit(externalImportReference(next, source.url, -1));
    } catch (problem) {
      if (!current.signal.aborted && request.current === current)
        setError(problem instanceof Error ? problem.message : "Não foi possível consultar este link.");
    } finally {
      if (request.current === current) setBusy(false);
    }
  }

  return <section aria-label="Link MakerWorld para precificação" className="space-y-3 rounded-lg border p-4">
    <Label htmlFor={inputId} className="flex items-center gap-2"><Link2 className="h-4 w-4" />Link do MakerWorld</Label>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input id={inputId} type="url" placeholder="https://makerworld.com/pt/models/…" value={url} onChange={event => editLink(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); if (url.trim() && !busy) void load(); }
      }} />
      <Button type="button" disabled={!url.trim() || busy} onClick={() => void load()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? "Buscando modelo…" : "Importar link"}</Button>
    </div>
    {model && <div className="space-y-2 text-sm">
      <p className="font-medium">{model.title}</p>
      {selected && <p className="text-muted-foreground">{choices.find(choice => choice.key === selected)?.label}</p>}
      {chooseProfile && <div className="space-y-2">
        <Label htmlFor={`${inputId}-profile`}>Qual perfil de impressão você vai usar?</Label>
        <select id={`${inputId}-profile`} className="h-11 w-full rounded-md border bg-background px-3" value={selected} onChange={event => {
          const choice = choices.find(option => option.key === event.target.value);
          if (choice) selectChoice(model, sourceUrl, choice);
        }}>
          <option value="">Escolha o perfil</option>
          {choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
        </select>
      </div>}
      {!chooseProfile && choices.length > 1 && <Button type="button" variant="link" className="h-auto p-0" onClick={() => setChooseProfile(true)}>Trocar perfil de impressão</Button>}
      {!choices.length && <p className="text-muted-foreground">Não há perfil disponível para os modelos cadastrados na sua empresa. Envie um 3MF fatiado para o seu modelo.</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
