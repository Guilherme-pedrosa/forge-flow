import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { FileBox, Loader2, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { modelPricingFromComposition, type ModelPricingEstimate } from "@/lib/model-pricing";
import type { SlicingJob } from "./SlicingDialog";

const PricingSlicingDialog = lazy(() => import("./SlicingDialog").then(module => ({ default: module.SlicingDialog })));

interface Props {
  sourceFile: File | null;
  estimate: ModelPricingEstimate | null;
  onLoaded: (file: File, estimate: ModelPricingEstimate | null) => void;
  printer: { model: string; brand: string } | null;
  materialCodes: string[];
}

async function readEstimate(file: File) {
  if (!/\.(stl|3mf)$/i.test(file.name) || !file.size || file.size > 80 * 1024 * 1024)
    throw new Error("Escolha um arquivo STL ou 3MF de até 80 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { parseModelFile, disposeModel } = await import("@/lib/model-file");
  const model = parseModelFile(bytes, file.name);
  try {
    try {
      return { estimate: modelPricingFromComposition(model.composition), notice: "" };
    } catch (error) {
      return { estimate: null, notice: error instanceof Error ? error.message : "Fatie este arquivo para obter tempo e filamento." };
    }
  } finally {
    disposeModel(model.group);
  }
}

/** Reads native slicer metrics locally. Geometry alone cannot supply a print plan. */
export function PricingModelFile({ sourceFile, estimate, onLoaded, printer, materialCodes }: Props) {
  const inputId = useId();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slicing, setSlicing] = useState(false);
  const operation = useRef(0);
  const alive = useRef(true);
  const source = useRef(sourceFile);
  const expectedSource = useRef(sourceFile);
  const deliver = useRef(onLoaded);
  const selection = JSON.stringify([printer?.brand, printer?.model, materialCodes]);
  const selected = useRef(selection);
  source.current = sourceFile;
  selected.current = selection;
  deliver.current = onLoaded;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++operation.current; };
  }, []);
  useEffect(() => {
    if (expectedSource.current === sourceFile) return;
    expectedSource.current = sourceFile;
    ++operation.current;
    setReading(false); setError(""); setNotice(""); setSlicing(false);
  }, [sourceFile]);
  useEffect(() => { setSlicing(false); }, [selection]);

  const a1 = !!printer && /bambu/i.test(`${printer.brand} ${printer.model}`)
    && /\ba1\b/i.test(printer.model) && !/mini/i.test(printer.model);
  const pla = materialCodes.length > 0 && materialCodes.every(code => code.trim().toUpperCase() === "PLA");
  const canSlice = a1 && pla && !!sourceFile && sourceFile.size <= 64 * 1024 * 1024;

  async function load(file: File) {
    const current = ++operation.current;
    setReading(true); setError(""); setNotice(""); setSlicing(false);
    // Clear the previous calculation before any asynchronous read. A failed
    // replacement must never leave the old part's cost available for saving.
    expectedSource.current = file;
    deliver.current(file, null);
    try {
      const result = await readEstimate(file);
      if (!alive.current || operation.current !== current) return;
      deliver.current(file, result.estimate);
      setNotice(result.notice);
    } catch (problem) {
      if (alive.current && operation.current === current)
        setError(problem instanceof Error ? problem.message : "Não foi possível ler este arquivo.");
    } finally {
      if (alive.current && operation.current === current) setReading(false);
    }
  }

  async function useSliced(file: File, job: SlicingJob) {
    const original = sourceFile, context = selection, current = ++operation.current;
    const result = await readEstimate(file);
    if (!alive.current || operation.current !== current || source.current !== original || selected.current !== context)
      throw new Error("A peça ou a seleção mudou. Confira a seleção e simule novamente.");
    if (!original || !result.estimate) throw new Error(result.notice || "O resultado não contém tempo e filamento completos.");
    // The worker profile is authoritative even when slice_info omits its model.
    const next = job.profile_id === "bambu-a1-04-pla-020-v1" && !result.estimate.printerModelIds.length
      ? { ...result.estimate, printerModelIds: ["Bambu Lab A1"] } : result.estimate;
    // The estimate belongs to these returned bytes. Keep the generated 3MF
    // available for import and hashing instead of attaching the original STL.
    expectedSource.current = file;
    deliver.current(file, next);
    setError(""); setNotice("");
  }

  return <section aria-label="Arquivo para precificação" className="space-y-3 rounded-lg border p-4">
    <div className="flex items-center gap-2 font-medium"><FileBox className="h-4 w-4" />Arquivo da peça</div>
    <p className="text-sm text-muted-foreground">Envie um 3MF fatiado para preencher tempo e filamento automaticamente. Arquivos STL e projetos 3MF sem estimativas precisam ser fatiados.</p>
    <Label htmlFor={inputId}>Arquivo STL ou 3MF</Label>
    <Input id={inputId} type="file" accept=".stl,.3mf" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (file) void load(file);
    }} />
    {reading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Lendo arquivo da peça…</p>}
    {sourceFile && <p className="break-words text-sm">Arquivo: <span className="font-medium">{sourceFile.name}</span></p>}
    {estimate && <div role="status" className="space-y-2">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-muted-foreground">Tempo total do arquivo</dt><dd className="font-semibold">{Math.floor(estimate.timeSeconds / 3600)}h {Math.floor(estimate.timeSeconds % 3600 / 60)}min</dd></div>
        <div><dt className="text-muted-foreground">Filamento total do arquivo</dt><dd className="font-semibold">{estimate.weightGrams.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} g</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">Estimativas nativas de {estimate.plateCount} placa(s). Informe quantas peças o arquivo produz para calcular o custo por peça.</p>
    </div>}
    {sourceFile && !estimate && !reading && <p className="text-sm text-muted-foreground">{notice || "Este arquivo ainda precisa de tempo e consumo do fatiador."}</p>}
    {sourceFile && <div className="space-y-2">
      {canSlice ? <Button type="button" variant="outline" disabled={reading} onClick={() => setSlicing(true)}><Scissors className="mr-2 h-4 w-4" />{estimate ? "Simular novamente no Bambu Studio" : "Calcular tempo e filamento"}</Button>
        : <p className="text-xs text-muted-foreground">A simulação local disponível usa Bambu Lab A1 (0,4 mm), PLA e camada de 0,20 mm, com arquivo de até 64 MB. Para outra impressora ou material, importe um 3MF já fatiado no perfil correspondente. Selecione a A1 e todos os filamentos PLA para habilitar a simulação.</p>}
      <p className="text-xs text-muted-foreground">Trocar a impressora ou o tipo de material exige um fatiamento compatível. O custo usa os filamentos escolhidos abaixo.</p>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {slicing && canSlice && <Suspense fallback={<p role="status" className="text-sm">Abrindo simulação…</p>}><PricingSlicingDialog open file={sourceFile} onOpenChange={setSlicing} onSliced={useSliced} resultLabel="Usar na precificação" profileId="bambu-a1-04-pla-020-v1" /></Suspense>}
  </section>;
}
