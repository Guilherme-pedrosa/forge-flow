import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductDimensionsFields } from "@/components/comercial/ProductDimensionsFields";
import { ChannelPricingPanel, type ChannelPricingSelection } from "@/components/comercial/ChannelPricingPanel";
import { readProductDimensionsDraft, prepareProductPresentation } from "@/lib/product-presentation";
import { applyProductChannelPricing, readProductChannelPricing } from "@/lib/channel-policy";
import { saveMercadoLivreProductDetails, type MercadoLivrePublication } from "@/lib/mercado-livre-workspace";
import { integrationErrorMessage } from "@/lib/mercado-livre-integration";
import { supabase } from "@/integrations/supabase/client";
import { orderRequest } from "@/lib/sales-order";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const packageFields = [["length_cm", "Comprimento embalado (cm)"], ["width_cm", "Largura embalada (cm)"], ["height_cm", "Altura embalada (cm)"], ["weight_grams", "Peso embalado (g)"]] as const;
const numeric = (value: string, label: string) => { if (!value.trim()) return null; const n = Number(value.replace(",", ".")); if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value) || !Number.isFinite(n) || n <= 0) throw new Error(`${label}: informe uma medida maior que zero.`); return n; };
export function MercadoLivrePublicationProductFields({ value, accountId, disabled = false, onSaved, onDirtyChange, section, onBusyChange }: { value: MercadoLivrePublication; accountId: string; disabled?: boolean; onSaved: () => void | Promise<void>; onDirtyChange?: (dirty: boolean) => void; section?: "product" | "dimensions" | "shipping" | "photos"; onBusyChange?: (busy: boolean) => void }) {
  const { profile } = useAuth();
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [name, setName] = useState(value.product.name), [description, setDescription] = useState(value.product.description);
  const [dimensions, setDimensions] = useState(() => readProductDimensionsDraft({ dimensions: value.product.dimensions }));
  const [pack, setPack] = useState(() => Object.fromEntries(packageFields.map(([key]) => [key, object(value.product.shipping_package)[key] == null ? "" : String(object(value.product.shipping_package)[key])])) as Record<typeof packageFields[number][0], string>);
  const [photos, setPhotos] = useState(value.product.photos.map(photo => photo.url));
  const original = useRef(JSON.stringify([name, description, dimensions, pack, photos]));
  useEffect(() => { onDirtyChange?.(JSON.stringify([name, description, dimensions, pack, photos]) !== original.current); }, [name, description, dimensions, pack, photos, onDirtyChange]);
  const request = useRef<{ signature: string; id: string } | null>(null), uploadInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({ mutationFn: async (files: File[]) => {
    if (!profile?.tenant_id) throw new Error("Entre novamente na empresa para adicionar fotos.");
    if (photos.length + files.length > 12) throw new Error("Use até doze fotos por produto.");
    const added: string[] = [];
    for (const file of files) {
      if (!alive.current) throw new Error("A sessão mudou. Confira as fotos novamente nesta empresa.");
      const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
      if (!ext || file.size > 8 * 1024 * 1024) throw new Error("Use fotos JPG, PNG ou WebP de até 8 MB.");
      const path = `${profile.tenant_id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-photos").upload(path, file, { contentType: file.type });
      if (error) throw error;
      if (!alive.current) throw new Error("A sessão mudou. Confira as fotos novamente nesta empresa.");
      added.push(supabase.storage.from("product-photos").getPublicUrl(path).data.publicUrl);
    }
    return added;
  }, onSuccess: added => { if (alive.current) setPhotos(previous => [...previous, ...added]); } });
  const save = useMutation({ mutationFn: async () => {
    const changes = { name: name.trim(), description: description.trim(), dimensions: prepareProductPresentation(dimensions)?.dimensions || { length_mm: null, width_mm: null, height_mm: null },
      shipping_package: Object.fromEntries(packageFields.map(([key, label]) => [key, numeric(pack[key], label)])) as { length_cm: number | null; width_cm: number | null; height_cm: number | null; weight_grams: number | null }, photos };
    request.current = orderRequest(request.current, JSON.stringify([value.product_id, value.forge_revision, changes]));
    return saveMercadoLivreProductDetails(accountId, value.product_id, changes, value.forge_revision, request.current.id);
  }, onSuccess: async () => { if (!alive.current) return; request.current = null; await onSaved(); } });
  const busy = disabled || save.isPending || upload.isPending;
  const operationBusy = save.isPending || upload.isPending;
  useEffect(() => { onBusyChange?.(operationBusy); return () => onBusyChange?.(false); }, [operationBusy, onBusyChange]);
  return <div className="space-y-4"><section hidden={!!section && section !== "product" && section !== "dimensions"} className="space-y-4"><div hidden={section === "dimensions"}><h3 className="font-medium">Dados do produto para o anúncio</h3><div><Label htmlFor="ml-publication-name">Nome comercial em português</Label><Input id="ml-publication-name" value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} /></div><div><Label htmlFor="ml-publication-description">Descrição para o cliente</Label><Textarea id="ml-publication-description" className="min-h-36" value={description} maxLength={20000} disabled={busy} onChange={event => setDescription(event.target.value)} /></div>
    </div><ProductDimensionsFields value={dimensions} onChange={setDimensions} disabled={busy} idPrefix="ml-product-dimensions" />
    </section><section hidden={!!section && section !== "shipping"} className="space-y-3"><h3 className="font-medium">Embalagem para envio</h3><p className="text-sm text-muted-foreground">Informe a peça já embalada. Estas medidas são usadas para o envio e não substituem as medidas da peça.</p><div className="grid gap-3 sm:grid-cols-2">{packageFields.map(([key, label]) => <div key={key}><Label htmlFor={`ml-package-${key}`}>{label}</Label><Input id={`ml-package-${key}`} inputMode="decimal" value={pack[key]} placeholder="Não informado" disabled={busy} onChange={event => setPack(previous => ({ ...previous, [key]: event.target.value }))} /></div>)}</div></section>
    <section hidden={!!section && section !== "photos"} className="space-y-3"><h3 className="font-medium">Fotos do produto</h3><p className="text-sm text-muted-foreground">Escolha fotos que mostrem exatamente a peça ou o conjunto vendido. A primeira foto será a principal.</p><div className="flex flex-wrap gap-3">{photos.map((photo, index) => <figure key={photo} className="w-28"><img src={photo} alt={`Foto ${index + 1} do produto`} className="h-24 w-28 rounded-lg border object-contain" /><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPhotos(previous => previous.filter((_, i) => i !== index))}>Retirar foto {index + 1}</Button></figure>)}</div><Input ref={uploadInput} aria-label="Adicionar fotos ao produto" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy || photos.length >= 12} onChange={event => { if (event.target.files?.length) upload.mutate(Array.from(event.target.files)); event.target.value = ""; }} /></section>
    {(save.error || upload.error) && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(save.error || upload.error)}</p>}<Button disabled={busy || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? "Salvando…" : "Salvar dados e conferir publicação"}</Button><p className="text-xs text-muted-foreground">Os dados são salvos no cadastro do produto e usados também na loja Elevare3D.</p>
  </div>;
}
export function MercadoLivrePublicationPricing({ productId, onSaved, disabled = false, onBusyChange }: { productId: string; onSaved: () => void | Promise<void>; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const { profile, user } = useAuth();
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const query = useQuery({ queryKey: ["ml_publication_price", profile?.tenant_id, user?.id, productId], queryFn: () => readProductChannelPricing({ productId, channel: "mercado_livre", quantity: 1 }), retry: false });
  const [selection, setSelection] = useState<ChannelPricingSelection | null>(null), [panelBusy, setPanelBusy] = useState(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const save = useMutation({ mutationFn: async () => {
    const draft = selection?.catalogDraft;
    if (!draft || draft.channel !== "mercado_livre" || draft.quantity !== 1) throw new Error("Confira o preço de Mercado Livre para uma unidade.");
    const fresh = await readProductChannelPricing({ productId, channel: "mercado_livre", quantity: 1, overrides: draft.assumptions, unitPrice: draft.unit_price });
    if (!alive.current) throw new Error("A sessão mudou. Confira o preço novamente nesta empresa.");
    if (!fresh.complete || fresh.unit_cost !== draft.quoted_unit_cost || fresh.policy_revision !== draft.expected_policy_revision) throw new Error("O custo ou as condições mudaram. Atualize a simulação antes de aceitar.");
    request.current = orderRequest(request.current, JSON.stringify([productId, fresh.revision]));
    return applyProductChannelPricing({ productId, channel: "mercado_livre", quantity: 1, overrides: draft.assumptions, unitPrice: draft.unit_price,
      expectedCostRevision: fresh.cost_revision, expectedPolicyRevision: fresh.policy_revision, expectedRevision: fresh.revision, requestId: request.current.id });
  }, onSuccess: async () => { if (!alive.current) return; request.current = null; await query.refetch(); if (alive.current) await onSaved(); } });
  useEffect(() => { onBusyChange?.(panelBusy || save.isPending); return () => onBusyChange?.(false); }, [panelBusy, save.isPending, onBusyChange]);
  return <section aria-label="Preço de Mercado Livre nesta publicação" className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">Preço de venda no Mercado Livre</h3>{query.isLoading && <p role="status">Conferindo o custo do produto…</p>}{query.error && <p role="alert">{integrationErrorMessage(query.error)}</p>}{query.data && <><ChannelPricingPanel key={productId} productId={productId} unitCost={query.data.unit_cost} initialDraft={{ channel: "mercado_livre", quantity: 1, assumptions: query.data.assumptions, expected_policy_revision: query.data.policy_revision, quoted_unit_cost: query.data.unit_cost || 0, unit_price: null }} onSelection={setSelection} onBusy={setPanelBusy} disabled={disabled || save.isPending} /><Button disabled={disabled || panelBusy || save.isPending || !selection?.catalogDraft || selection.catalogDraft.channel !== "mercado_livre" || selection.catalogDraft.quantity !== 1} onClick={() => save.mutate()}>Aceitar preço para esta publicação</Button>{query.data.missing.map((issue, index) => <p className="text-sm text-muted-foreground" key={index}>{issue}</p>)}</>}{save.error && <p role="alert" className="text-sm text-destructive">{integrationErrorMessage(save.error)}</p>}</section>;
}
