import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MATERIAL_COLOR_PRESETS, MaterialColorPicker } from "./MaterialColorPicker";
import { MATERIAL_CODES } from "@/lib/material-identity";
import { orderRequest } from "@/lib/sales-order";
import { supabase } from "@/integrations/supabase/client";
import { filamentName, filamentRegistrationPayload, newFilamentDraft, readFilamentRegistrationId,
  type FilamentRegistrationDraft, type FilamentRegistrationItem } from "@/lib/filament-registration";

export type FilamentRegistrationProps = {
  item?: FilamentRegistrationItem | null;
  defaults?: Partial<FilamentRegistrationItem>;
  initialColor?: { name?: string; hex?: string };
  initialName?: string;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onSaved: (itemId: string) => void | Promise<void>;
};
const selectStyle = "mt-1 h-11 w-full rounded-md border bg-background px-3";
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export function FilamentRegistration({ item, defaults, initialColor, initialName, onBusyChange, onClose, onSaved }: FilamentRegistrationProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => {
    const next = newFilamentDraft(item, defaults);
    if (!item && initialName?.trim()) next.name = initialName.trim();
    if (!item && initialColor) {
      const hex = initialColor.hex?.trim().toUpperCase().replace(/^(#[0-9A-F]{6})FF$/, "$1") || "";
      const validHex = /^#[0-9A-F]{6}$/.test(hex) ? hex : "";
      const preset = MATERIAL_COLOR_PRESETS.find(value => value.hex === validHex);
      const name = initialColor.name?.trim() || preset?.name || "";
      next.color = { hex: validHex, name, code: preset && name === preset.name ? preset.code : "" };
    }
    return next;
  });
  const expectedHex = initialColor?.hex?.trim().toUpperCase().replace(/^(#[0-9A-F]{6})FF$/, "$1") || "";
  const request = useRef<ReturnType<typeof orderRequest> | null>(null);
  const inFlight = useRef(false);
  const save = useMutation({ mutationFn: async () => {
    const payload = filamentRegistrationPayload(draft, item);
    request.current = orderRequest(request.current, JSON.stringify(payload));
    const result = await rpc("save_inventory_catalog", { ...payload, p_request_id: request.current.id });
    if (result.error) throw new Error(result.error.message);
    return readFilamentRegistrationId(result.data);
  }, onSuccess: itemId => onSaved(itemId) });
  useEffect(() => { onBusyChange?.(save.isPending); return () => onBusyChange?.(false); }, [onBusyChange, save.isPending]);
  const change = <K extends keyof FilamentRegistrationDraft>(key: K, value: FilamentRegistrationDraft[K]) => {
    if (inFlight.current) return;
    save.reset(); setDraft(previous => ({ ...previous, [key]: value }));
  };
  const submit = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    save.mutate(undefined, { onSettled: () => { inFlight.current = false; } });
  };
  return <Dialog open onOpenChange={open => { if (!open && !inFlight.current) onClose(); }}>
    <DialogContent closeDisabled={save.isPending} className="flex max-h-[94dvh] w-[96vw] max-w-xl flex-col overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b px-4 pb-4 pt-5 pr-14 sm:px-6 sm:pr-14"><DialogTitle>{item ? "Editar filamento" : "Cadastrar filamento"}</DialogTitle><DialogDescription>Informe material, cor e marca. O saldo pode ser cadastrado agora ou nas próximas compras.</DialogDescription></DialogHeader>
      <form id={`${id}-form`} noValidate onSubmit={event => { event.preventDefault(); submit(); }} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <fieldset disabled={save.isPending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor={`${id}-material`}>Material</Label><select id={`${id}-material`} className={selectStyle} value={draft.materialCode} onChange={event => change("materialCode", event.target.value)}><option value="">Escolha o material</option>{MATERIAL_CODES.filter(([code]) => code !== "RESIN").map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div>
            <div><Label htmlFor={`${id}-color`}>Cor *</Label><Input autoFocus id={`${id}-color`} className="mt-1" value={draft.color.name} onChange={event => change("color", { ...draft.color, name: event.target.value, code: event.target.value === item?.color ? item.color_code ?? "" : "" })} placeholder="Ex.: Branco" /></div>
            {draft.materialCode === "OTHER" && <div className="sm:col-span-2"><Label htmlFor={`${id}-other`}>Qual material?</Label><Input id={`${id}-other`} className="mt-1" value={draft.materialDescription} onChange={event => change("materialDescription", event.target.value)} /></div>}
            <div><Label htmlFor={`${id}-brand`}>Marca (opcional)</Label><Input id={`${id}-brand`} className="mt-1" value={draft.brand} onChange={event => change("brand", event.target.value)} placeholder="Ex.: F3D, Bambu Lab" /></div>
            <div><Label htmlFor={`${id}-palette`}>Amostra visual (opcional)</Label><div className="mt-1"><MaterialColorPicker id={`${id}-palette`} value={draft.color} onChange={value => change("color", value)} /></div></div>
          </div>
          {!item && /^#[0-9A-F]{6}$/.test(expectedHex) && <p className="text-xs text-muted-foreground">Cor do arquivo: <strong>{expectedHex}</strong>. Confira o nome da cor do seu filamento.</p>}
          <p className="text-sm text-muted-foreground">Nome no cadastro: <strong>{draft.name.trim() || filamentName(draft)}</strong></p>
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
            <div><Label htmlFor={`${id}-quantity`}>{item ? "Estoque atual" : "Estoque inicial"} ({draft.quantityUnit})</Label><Input id={`${id}-quantity`} className="mt-1" inputMode="decimal" value={draft.quantity} onChange={event => change("quantity", event.target.value)} />{!item && <select aria-label="Unidade da quantidade informada" className={selectStyle} value={draft.quantityUnit} onChange={event => {
              const next = event.target.value as "g" | "kg", current = Number(draft.quantity.trim().replace(",", "."));
              const quantity = draft.quantity.trim() && Number.isFinite(current) ? String(current * (next === "g" ? 1000 : .001)) : draft.quantity;
              if (!inFlight.current) { save.reset(); setDraft(previous => ({ ...previous, quantityUnit: next, quantity })); }
            }}><option value="kg">Quilos (kg)</option><option value="g">Gramas (g)</option></select>}</div>
            <div><Label htmlFor={`${id}-cost`}>Custo médio (R$/kg)</Label><Input id={`${id}-cost`} className="mt-1" inputMode="decimal" value={draft.costPerKg} onChange={event => change("costPerKg", event.target.value)} placeholder="0,00" /><p className="mt-1 text-xs text-muted-foreground">Informe o custo do saldo inicial, se houver.</p></div>
          </div>
          <p className="rounded-lg bg-muted p-3 text-sm">Compras recebidas atualizam saldo e custo médio automaticamente.</p>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Outros detalhes (opcional)</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor={`${id}-name`}>Nome personalizado (opcional)</Label><Input id={`${id}-name`} className="mt-1" value={draft.name} onChange={event => change("name", event.target.value)} placeholder={filamentName(draft)} /></div>
            <div><Label htmlFor={`${id}-sku`}>SKU / código interno</Label><Input id={`${id}-sku`} className="mt-1" value={draft.sku} onChange={event => change("sku", event.target.value)} /></div>
            <div><Label htmlFor={`${id}-diameter`}>Diâmetro (mm)</Label><Input id={`${id}-diameter`} className="mt-1" inputMode="decimal" value={draft.diameter} onChange={event => change("diameter", event.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor={`${id}-notes`}>Observações</Label><Input id={`${id}-notes`} className="mt-1" value={draft.notes} onChange={event => change("notes", event.target.value)} /></div>
          </div></details>
        </fieldset>
        {save.error && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{save.error.message}</p>}
      </form>
      <DialogFooter className="shrink-0 gap-2 border-t bg-card px-4 py-3 sm:px-6"><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancelar</Button><Button type="submit" form={`${id}-form`} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{save.isPending ? "Salvando…" : item ? "Salvar filamento" : "Cadastrar filamento"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default FilamentRegistration;
