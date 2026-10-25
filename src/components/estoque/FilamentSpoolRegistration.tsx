import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { MaterialColorPicker } from "./MaterialColorPicker";
import { MATERIAL_CODES } from "@/lib/material-identity";
import { orderRequest } from "@/lib/sales-order";
import { supabase } from "@/integrations/supabase/client";
import type { FilamentMaterial } from "@/lib/filament-planning";
import { existingCostPerKg, newSpoolDraft, readSpoolRegistrationResult, registrationStockMode, spoolNetGrams, spoolRegistrationPayload,
  type SpoolRegistrationDraft, type SpoolRegistrationResult } from "@/lib/filament-spool-registration";

const selectStyle = "mt-1 h-11 w-full min-w-0 rounded-md border bg-background px-3";
const grams = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} g`;
const balance = (value: number, unit: string) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unit}`;
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export function FilamentSpoolRegistration({ items, printers, onClose, onSaved }: {
  items: (FilamentMaterial & { avg_cost?: number | null })[]; printers: { id: string; name: string }[];
  onClose: () => void; onSaved: (result: SpoolRegistrationResult) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(() => newSpoolDraft(items.length > 0));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const request = useRef<ReturnType<typeof orderRequest> | null>(null);
  const material = items.find(item => item.id === draft.itemId);
  const addsStock = registrationStockMode(draft) === "add_to_stock";
  let net: number | null = null;
  try { net = spoolNetGrams(draft); } catch { /* An unfinished input is not a zero weight. */ }
  const current = draft.materialMode === "new" ? 0 : Number(material?.current_stock);
  const unit = draft.materialMode === "new" ? "g" : material?.unit ?? "g";
  const after = Number.isFinite(current) && net != null ? current + (addsStock ? net / (unit.toLowerCase().trim() === "kg" ? 1000 : 1) : 0) : null;
  const save = useMutation({
    mutationFn: async () => {
      const payload = spoolRegistrationPayload(draft, items, printers);
      request.current = orderRequest(request.current, JSON.stringify(payload));
      const result = await rpc("register_filament_spool", { ...payload, p_request_id: request.current.id });
      if (result.error) throw new Error(result.error.message);
      return readSpoolRegistrationResult(result.data);
    },
    onSuccess: result => onSaved(result),
    onError: (error: Error) => { if (/Localização e detalhes/.test(error.message)) setDetailsOpen(true); },
  });
  const change = <K extends keyof SpoolRegistrationDraft>(key: K, value: SpoolRegistrationDraft[K]) => {
    if (save.isPending) return;
    request.current = null; save.reset(); setDraft(previous => ({ ...previous, [key]: value }));
  };
  function chooseMaterial(id: string) {
    if (save.isPending) return;
    request.current = null; save.reset();
    setDraft(previous => ({ ...previous, itemId: id, stockMode: "already_in_stock", costPerKg: existingCostPerKg(items.find(item => item.id === id)) }));
  }
  function chooseMode(mode: SpoolRegistrationDraft["materialMode"]) {
    if (save.isPending) return;
    request.current = null; save.reset();
    setDraft(previous => ({ ...previous, materialMode: mode, stockMode: "already_in_stock", costPerKg: mode === "existing" ? existingCostPerKg(material) : "" }));
  }
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent closeDisabled={save.isPending} className="flex max-h-[94dvh] w-[96vw] max-w-2xl flex-col overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b px-4 pb-4 pt-5 pr-14 sm:px-6 sm:pr-14"><DialogTitle>Cadastrar filamento e bobina</DialogTitle><DialogDescription>Cadastre a cor, a bobina e o saldo aqui, sem passar por outros cadastros.</DialogDescription></DialogHeader>
      <form id="register-filament-spool" noValidate onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <fieldset disabled={save.isPending} className="min-w-0 space-y-5">
          <fieldset className="min-w-0 space-y-3"><legend className="mb-3 text-sm font-semibold">Filamento</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{([["existing", "Usar filamento cadastrado"], ["new", "Filamento novo"]] as const).map(([value, label]) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm ${draft.materialMode === value ? "border-primary bg-primary/5" : ""}`}><input type="radio" name="spool-material-mode" value={value} checked={draft.materialMode === value} onChange={() => chooseMode(value)} />{label}</label>)}</div>
            {draft.materialMode === "existing" ? <div className="min-w-0 space-y-2"><SearchableItemSelect id="registration-item" label="Filamento cadastrado" value={draft.itemId} onChange={chooseMaterial} disabled={save.isPending} emptyLabel="Buscar material, cor ou marca" searchPlaceholder="Digite o material, a cor ou a marca…" options={items.map(item => ({ id: item.id, label: item.name, description: [item.material_code, item.color, item.color_code].filter(Boolean).join(" · ") }))} />{!items.length && <p className="text-sm text-muted-foreground">Nenhum filamento cadastrado. Escolha Filamento novo para cadastrar tudo aqui.</p>}</div> : <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="min-w-0"><Label htmlFor="registration-material">Material</Label><select id="registration-material" className={selectStyle} value={draft.materialCode} onChange={event => change("materialCode", event.target.value)}><option value="">Escolha o material</option>{MATERIAL_CODES.filter(([code]) => code !== "RESIN").map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
              <div className="min-w-0"><Label htmlFor="registration-brand">Marca (opcional)</Label><Input id="registration-brand" className="mt-1" value={draft.brand} onChange={event => change("brand", event.target.value)} placeholder="Ex.: F3D, Bambu Lab" /></div>
              {draft.materialCode === "OTHER" && <div className="min-w-0 sm:col-span-2"><Label htmlFor="registration-material-other">Qual material?</Label><Input id="registration-material-other" className="mt-1" value={draft.materialDescription} onChange={event => change("materialDescription", event.target.value)} /></div>}
              <div className="min-w-0"><Label htmlFor="registration-color">Cor do filamento</Label><Input id="registration-color" className="mt-1" value={draft.color.name} onChange={event => change("color", { ...draft.color, name: event.target.value })} placeholder="Ex.: Framboesa" /></div>
              <div className="min-w-0"><Label htmlFor="registration-palette">Amostra visual (opcional)</Label><div className="mt-1"><MaterialColorPicker id="registration-palette" value={draft.color} onChange={value => change("color", value)} /></div></div>
            </div>}
          </fieldset>
          <section className="space-y-3 border-t pt-5" aria-labelledby="registration-weight-title"><h3 id="registration-weight-title" className="text-sm font-semibold">Quanto filamento há nesta bobina?</h3>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={draft.weighed} onChange={event => change("weighed", event.target.checked)} />Pesar com carretel</label>
            {draft.weighed ? <div className="grid min-w-0 gap-4 sm:grid-cols-2"><div className="min-w-0"><Label htmlFor="registration-gross">Peso bruto da balança (g)</Label><Input id="registration-gross" className="mt-1" inputMode="decimal" value={draft.gross} onChange={event => change("gross", event.target.value)} placeholder="Ex.: 1100" /></div><div className="min-w-0"><Label htmlFor="registration-tare">Tara do carretel vazio (g)</Label><Input id="registration-tare" className="mt-1" inputMode="decimal" value={draft.tare} onChange={event => change("tare", event.target.value)} placeholder="Ex.: 200" /></div></div> : <div className="min-w-0"><Label htmlFor="registration-remaining">Filamento restante (g)</Label><Input id="registration-remaining" className="mt-1" inputMode="decimal" value={draft.remaining} onChange={event => change("remaining", event.target.value)} placeholder="Ex.: 900" /><p className="mt-1 text-xs text-muted-foreground">Informe somente o filamento, sem o peso do carretel.</p></div>}
            {net != null && <p role="status" className="rounded-lg bg-muted p-3 text-sm">Filamento nesta bobina: <strong>{grams(net)}</strong>{draft.weighed && <span className="block mt-1 text-xs text-muted-foreground">Peso bruto menos a tara do carretel.</span>}</p>}
          </section>
          <section className="space-y-3 border-t pt-5" aria-labelledby="registration-stock-title"><h3 id="registration-stock-title" className="text-sm font-semibold">Estoque e custo</h3>
            {draft.materialMode === "existing" && <><label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={draft.stockMode === "add_to_stock"} onChange={event => change("stockMode", event.target.checked ? "add_to_stock" : "already_in_stock")} /><span>Somar esta bobina ao estoque<span className="mt-1 block text-xs text-muted-foreground">Marque apenas se este filamento ainda não entrou no saldo. Deixe desmarcado para identificar uma bobina já contabilizada.</span></span></label>{draft.stockMode === "already_in_stock" && <p className="text-sm text-muted-foreground">O saldo do filamento será mantido. Apenas a bobina e sua localização serão registradas.</p>}</>}
            {addsStock && <div className="min-w-0"><Label htmlFor="registration-cost">Custo do filamento (R$/kg)</Label><Input id="registration-cost" className="mt-1" inputMode="decimal" value={draft.costPerKg} onChange={event => change("costPerKg", event.target.value)} placeholder="Ex.: 100,00" /><p className="mt-1 text-xs text-muted-foreground">Use o custo por quilo. Se não houve custo, informe 0.</p></div>}
            {after != null && <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm" aria-live="polite"><p>{addsStock ? "Entrada no estoque" : "Entrada adicional"}: <strong>{addsStock && net != null ? grams(net) : "Nenhuma"}</strong></p><p>Saldo do filamento: <strong>{balance(current, unit)} → {balance(after, unit)}</strong></p></div>}
          </section>
          <details open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)} className="rounded-lg border p-3"><summary className="cursor-pointer py-1 text-sm font-medium">Localização e detalhes (opcional)</summary><div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0"><Label htmlFor="registration-location-kind">Posição da bobina</Label><select id="registration-location-kind" className={selectStyle} value={draft.locationKind} onChange={event => change("locationKind", event.target.value as SpoolRegistrationDraft["locationKind"])}><option value="storage">Depósito / prateleira</option><option value="printer">Carretel externo da impressora</option><option value="ams">AMS / slot</option></select></div>
            {draft.locationKind === "storage" ? <div className="min-w-0"><Label htmlFor="registration-location">Depósito ou prateleira</Label><Input id="registration-location" className="mt-1" value={draft.location} onChange={event => change("location", event.target.value)} /></div> : <div className="min-w-0"><Label htmlFor="registration-printer">Impressora</Label><select id="registration-printer" className={selectStyle} value={draft.printerId} onChange={event => change("printerId", event.target.value)}><option value="">Selecione a impressora</option>{printers.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}</select></div>}
            {draft.locationKind === "ams" && <><div><Label htmlFor="registration-ams">Número do AMS</Label><Input id="registration-ams" className="mt-1" type="number" min={1} max={16} value={draft.amsUnit} onChange={event => change("amsUnit", event.target.value)} /></div><div><Label htmlFor="registration-slot">Slot (1 a 4)</Label><Input id="registration-slot" className="mt-1" type="number" min={1} max={4} value={draft.amsSlot} onChange={event => change("amsSlot", event.target.value)} /></div></>}
            <div><Label htmlFor="registration-capacity">Capacidade inicial de filamento (g)</Label><Input id="registration-capacity" className="mt-1" inputMode="decimal" value={draft.initial} onChange={event => change("initial", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">Capacidade original da bobina; o estoque recebe somente o filamento restante.</p></div>
            <div><Label htmlFor="registration-label">Identificação da bobina (opcional)</Label><Input id="registration-label" className="mt-1" value={draft.label} onChange={event => change("label", event.target.value)} placeholder="Gerada automaticamente" /></div>
            {draft.materialMode === "new" && <div><Label htmlFor="registration-color-code">Código da cor (opcional)</Label><Input id="registration-color-code" className="mt-1" value={draft.color.code} onChange={event => change("color", { ...draft.color, code: event.target.value })} placeholder="Gerado automaticamente" /></div>}
            <div className="sm:col-span-2"><Label htmlFor="registration-notes">Observação (opcional)</Label><Input id="registration-notes" className="mt-1" value={draft.notes} onChange={event => change("notes", event.target.value)} /></div>
          </div></details>
        </fieldset>
        {save.error && <p role="alert" className="mt-4 break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{save.error.message}</p>}
      </form>
      <DialogFooter className="shrink-0 gap-2 border-t bg-card px-4 py-3 sm:px-6"><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancelar</Button><Button type="submit" form="register-filament-spool" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{save.isPending ? "Salvando…" : "Cadastrar filamento e bobina"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
