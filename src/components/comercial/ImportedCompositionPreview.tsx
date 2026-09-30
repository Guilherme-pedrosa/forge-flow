import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ImportedModelImage } from "./ImportedModelImage";
import type { ImportedComposition } from "@/lib/imported-composition";
import { useEffect, useRef, useState } from "react";
import { compositionFrom3mf } from "@/lib/three-mf-composition";

export function ImportedCompositionPreview({ value, onChange, onBusyChange }: { value: ImportedComposition; onChange: (value: ImportedComposition) => void; onBusyChange?: (busy: boolean) => void }) {
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onBusyChange?.(reading); return () => onBusyChange?.(false); }, [reading, onBusyChange]);
  const missing = value.plates.filter(p => p.parts.some(part => part.name_source === "unknown"));
  const update = (index: number, patch: Partial<ImportedComposition["plates"][number]>) => onChange({ ...value, plates: value.plates.map(p => p.index === index ? { ...p, ...patch } : p) });
  return <section aria-label="Composição importada" className="space-y-4 rounded-xl border bg-muted/10 p-4">
    <div><h3 className="font-semibold">Peças que formam o produto</h3><p className="mt-1 text-sm text-muted-foreground">{value.plates.length} placa(s) carregada(s), com fotos, peso e tempo. Cada peça identificada será cadastrada como subitem, com SKU e estoque próprios.</p></div>
    <div className="flex items-center gap-3"><Switch id="import-assembly" checked={value.enabled} onCheckedChange={enabled => onChange({ ...value, enabled })} /><Label htmlFor="import-assembly">Controlar estoque dos componentes e montar o produto final</Label></div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{value.plates.map(plate => <article key={plate.index} className="min-w-0 rounded-lg border bg-background p-3">
      <ImportedModelImage src={plate.photo_url} alt={`Peças da placa ${plate.index}`} className="h-32 w-full rounded-md bg-muted object-contain" />
      <p className="my-2 text-xs text-muted-foreground">Placa {plate.index} · {plate.weight_grams == null ? "Peso não informado" : `${plate.weight_grams} g`} · {plate.time_seconds == null ? "Tempo não informado" : `${Math.round(plate.time_seconds / 60)} min`}</p>
      <Label htmlFor={`import-plate-${plate.index}`}>Nome da placa</Label><Input id={`import-plate-${plate.index}`} value={plate.label} onChange={e => update(plate.index, { label: e.target.value })} />
      <div className="mt-3 space-y-3">{plate.parts.map((part, index) => <div key={part.source_key} className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
        <div><Label htmlFor={`import-part-${plate.index}-${index}`}>Peça {index + 1}</Label><Input id={`import-part-${plate.index}-${index}`} value={part.name} onChange={e => update(plate.index, { parts: plate.parts.map((p, i) => i === index ? { ...p, name: e.target.value, name_source: "manual" } : p) })} />{part.quantity_per_plate != null && <p className="mt-1 text-xs text-muted-foreground">{part.quantity_per_plate} peça(s) nesta placa do arquivo.</p>}</div>
        <div><Label htmlFor={`import-qty-${plate.index}-${index}`}>Por produto</Label><Input id={`import-qty-${plate.index}-${index}`} type="number" min={1} placeholder="—" value={part.quantity_per_product ?? ""} onChange={e => update(plate.index, { parts: plate.parts.map((p, i) => i === index ? { ...p, quantity_per_product: e.target.value ? Number(e.target.value) : null } : p) })} /></div>
      </div>)}</div>
      <div className="mt-3"><Label htmlFor={`import-yield-${plate.index}`}>Produtos atendidos por esta impressão</Label><Input id={`import-yield-${plate.index}`} type="number" min={1} value={plate.units_per_plate ?? ""} placeholder="Confirmar pelo arquivo de impressão" onChange={e => update(plate.index, { units_per_plate: e.target.value ? Number(e.target.value) : null })} /></div>
    </article>)}</div>
    {missing.length > 0 && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">O autor não informou os nomes das peças em {missing.length} placa(s). As imagens estão abaixo. As placas serão preservadas, mas ainda não há peças identificadas para criar os subitens. Use o 3MF para completar todas de uma vez.</p>}
    <details className="space-y-2 rounded-lg border bg-background p-3"><summary className="cursor-pointer text-sm font-medium">Completar peças pelo arquivo 3MF</summary><Label htmlFor="import-composition-3mf">Completar nomes e quantidades pelo arquivo 3MF</Label><Input id="import-composition-3mf" type="file" accept=".3mf" disabled={reading} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      setReading(true); setFileError(""); setFileName("");
      try {
        if (!/\.3mf$/i.test(file.name) || file.size > 80 * 1024 * 1024) throw new Error("Selecione um projeto 3MF de até 80 MB.");
        const next = compositionFrom3mf(new Uint8Array(await file.arrayBuffer()), value);
        if (alive.current) { onChange(next); setFileName(file.name); }
      } catch (error) { if (alive.current) setFileError((error as Error).message); } finally { if (alive.current) setReading(false); event.target.value = ""; }
    }} /><p className="text-xs text-muted-foreground">Quando o link não expõe as peças, o projeto baixado do mesmo perfil permite preencher todas de uma vez. A leitura acontece neste navegador.</p>{reading && <p role="status" className="text-sm">Lendo peças e placas…</p>}{fileName && <p role="status" className="text-sm text-emerald-700">Peças carregadas de {fileName}. Confira abaixo antes de salvar.</p>}{fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}</details>
    {value.plates.every(p => p.parts.every(part => part.quantity_per_plate != null)) && <div className="space-y-2 rounded-lg border p-3"><p className="text-sm">Se todas as peças deste arquivo, juntas, formam uma unidade do produto, confirme abaixo para preencher as quantidades de uma vez.</p><Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => onChange({ ...value, plates: value.plates.map(p => ({ ...p, units_per_plate: 1, parts: p.parts.map(part => ({ ...part, quantity_per_product: part.quantity_per_plate })) })) })}>Esta composição forma 1 produto</Button></div>}
    <p className="text-xs text-muted-foreground">Quantidade de objetos e rendimento são coisas diferentes: uma placa pode conter várias peças de um único produto. Valores ausentes não são preenchidos como 1.</p>
  </section>;
}
