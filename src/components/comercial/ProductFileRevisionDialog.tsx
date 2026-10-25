import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import type { ImportedComposition } from "@/lib/imported-composition";
import { safePrintFileName } from "@/lib/product-print-source";

const ModelFileInput = lazy(() => import("./ModelFileInput"));
const rpc = (name: string, args: Record<string, unknown>) => Promise.resolve((supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args));
type Context = {
  revision: string; can_target_product: boolean; blocked_reason: string | null;
  components: { id: string; component_product_id: string; name: string; sku: string | null; plate_id: string | null; quantity_per_plate: number | null }[];
  active_plates: { id: string; source_id: string | null; label: string; plate_index: number }[];
};

export default function ProductFileRevisionDialog({ productId, tenantId, open, onOpenChange, onBusyChange }: {
  productId: string; tenantId: string; open: boolean; onOpenChange: (open: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [composition, setComposition] = useState<ImportedComposition | null>(null);
  const [target, setTarget] = useState<"product" | "components">("components");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<File | null>(null);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const submission = useRef<{ key: string; id: string } | null>(null);
  const fileBusy = useCallback((value: boolean) => { setReading(value); if (value) { file.current = null; setComposition(null); setMapping({}); } }, []);
  const context = useQuery({ queryKey: ["product_file_revision_context", tenantId, productId], enabled: open,
    queryFn: async () => { const result = await rpc("product_file_revision_context", { p_product_id: productId }); if (result.error) throw new Error(result.error.message); return result.data as Context; }, staleTime: 0 });
  const parts = composition?.plates.flatMap(plate => plate.parts.map(part => ({ plate, part, key: `${plate.index}:${part.source_key}` }))) || [];
  const canProduct = !!context.data?.can_target_product && parts.length === 1;
  const actualTarget = canProduct && target === "product" ? "product" : "components";
  const validMapping = actualTarget === "product" || (parts.length > 0 && parts.every(({ key }) => !!mapping[key]) && new Set(parts.map(({ key }) => mapping[key])).size === parts.length);
  const close = (next: boolean) => { if (!writing) onOpenChange(next); };
  const apply = async () => {
    if (!composition || !context.data || !validMapping) return;
    setWriting(true); onBusyChange?.(true); setError("");
    try {
      if (!file.current) throw new Error("Abra novamente o arquivo de impressão antes de aplicar a revisão.");
      let attachment: { file_path?: string; file_name?: string } = {};
      if (file.current) {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.current.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
        if (composition.profile_id !== `local:${hash}`) throw new Error("O arquivo mudou. Abra-o novamente antes de aplicar a revisão.");
        if (uploaded.current?.file !== file.current) {
          const path = `${tenantId}/${crypto.randomUUID()}/${safePrintFileName(file.current.name)}`;
          const result = await supabase.storage.from("attachments").upload(path, file.current, { contentType: "application/octet-stream", upsert: false });
          if (result.error) throw new Error(result.error.message);
          uploaded.current = { file: file.current, path };
        }
        attachment = { file_path: uploaded.current.path, file_name: file.current.name };
      }
      const args = { p_product_id: productId, p_composition: composition, p_expected_revision: context.data.revision,
        p_mapping: { target: actualTarget, parts: actualTarget === "components" ? parts.map(({ plate, part, key }) => ({ plate_index: plate.index, source_key: part.source_key, subitem_id: mapping[key] })) : [], ...attachment } };
      const key = JSON.stringify(args);
      if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
      const result = await rpc("apply_product_file_revision", { ...args, p_request_id: submission.current.id });
      if (result.error) throw new Error(result.error.message);
      if (typeof result.data !== "string") throw new Error("A revisão não foi confirmada. Confira as fontes antes de tentar novamente.");
      await Promise.all(["product_print_sources", "product_print_plates", "product_material_recipe", "product_print_plate_preparation", "product_file_revision_context", "assembly_status", "products", "product_piece_specs", "product_workspace"].map(key => qc.invalidateQueries({ queryKey: [key] })));
      toast({ title: "Ficha de impressão atualizada", description: "A revisão anterior ficou no histórico. Os produtos, as peças e seus estoques foram preservados." });
      onOpenChange(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível aplicar a revisão."); }
    finally { setWriting(false); onBusyChange?.(false); }
  };
  return <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto" onInteractOutside={event => { if (writing) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>Atualizar pelo arquivo de impressão</DialogTitle><DialogDescription>Abra o 3MF ou fatie um STL. Confira as placas e indique a qual peça cadastrada cada parte pertence.</DialogDescription></DialogHeader>
    {context.isLoading ? <p role="status">Carregando a composição atual…</p> : context.error ? <p role="alert" className="text-destructive">{context.error.message} <Button variant="outline" onClick={() => context.refetch()}>Tentar novamente</Button></p> : context.data?.blocked_reason ? <p role="alert">{context.data.blocked_reason}</p> : <>
      <Suspense fallback={<p>Carregando leitor de arquivos…</p>}><ModelFileInput revision disabled={writing} onBusyChange={fileBusy} onFileReady={value => { file.current = value; uploaded.current = null; setComposition(null); setMapping({}); setError(""); }} onChange={value => { setComposition(value); setMapping({}); setTarget(context.data?.can_target_product && value.plates.length === 1 && value.plates[0].parts.length === 1 ? "product" : "components"); setError(""); }} /></Suspense>
      {composition && <div className="space-y-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">{composition.plates.map(plate => <article key={plate.index} className="min-w-0 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Placa {plate.index} · {plate.label}</h3><p className="text-sm">{plate.weight_grams == null ? "Peso não informado pelo fatiador" : `${plate.weight_grams.toLocaleString("pt-BR")} g`} · {plate.time_seconds == null ? "Tempo não informado" : `${Math.round(plate.time_seconds / 60)} min`}</p>{plate.parts.map((part, index) => <div key={part.source_key}><Label htmlFor={`revision-count-${plate.index}-${index}`}>{part.name} · cópias nesta placa</Label><Input id={`revision-count-${plate.index}-${index}`} type="number" min={1} step={1} disabled={writing} value={part.quantity_per_plate ?? ""} onChange={event => setComposition({ ...composition, plates: composition.plates.map(item => item.index === plate.index ? { ...item, parts: item.parts.map(piece => piece.source_key === part.source_key ? { ...piece, quantity_per_plate: event.target.value ? Number(event.target.value) : null } : piece) } : item) })} /></div>)}</article>)}</div>
        {canProduct && <div><Label htmlFor="revision-target">Esta impressão produz</Label><select id="revision-target" className="min-h-11 w-full rounded-md border bg-background px-3" value={actualTarget} disabled={writing} onChange={event => setTarget(event.target.value as "product" | "components")}><option value="product">O próprio produto deste cadastro</option><option value="components">Uma peça da composição</option></select></div>}
        {actualTarget === "components" && <div className="space-y-3"><p className="text-sm font-medium">Peças existentes que receberão a ficha</p>{parts.map(({ plate, part, key }, index) => <div key={key}><Label htmlFor={`revision-part-${index}`}>Placa {plate.index} · {part.name}</Label><select id={`revision-part-${index}`} value={mapping[key] || ""} disabled={writing} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3" onChange={event => setMapping(previous => ({ ...previous, [key]: event.target.value }))}><option value="">Selecione a peça já cadastrada</option>{context.data?.components.map(component => <option key={component.id} value={component.id} disabled={Object.entries(mapping).some(([other, id]) => other !== key && id === component.id)}>{component.name}{component.sku ? ` · ${component.sku}` : ""}</option>)}</select></div>)}{!context.data?.components.length && <p role="alert" className="text-sm">Cadastre primeiro as peças na composição do produto para associar esta revisão.</p>}</div>}
        <p className="text-sm text-muted-foreground">A revisão substitui o plano de impressão ativo. A quantidade necessária na montagem e o estoque de cada peça continuam os mesmos.</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button type="button" disabled={writing || reading || !validMapping} onClick={() => void apply()}>{writing ? "Aplicando revisão…" : "Aplicar revisão"}</Button>
      </div>}
    </>}
    <Button type="button" variant="outline" disabled={writing} onClick={() => close(false)}>Fechar</Button>
  </DialogContent></Dialog>;
}
