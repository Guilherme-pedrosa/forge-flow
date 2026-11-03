import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Loader2, Scissors } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import { downloadMakerWorldProject, makerWorldProjectPending, makerWorldPublicProjects } from "@/lib/makerworld-project";
import type { SlicingJob } from "./SlicingDialog";

const SlicingDialog = lazy(() => import("./SlicingDialog").then(module => ({ default: module.SlicingDialog })));
type Props = {
  reference: ProductExternalImport;
  ownedPrinterModels: string[];
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onSliced: (file: File, metadata: SlicingJob) => void | Promise<void>;
};

/** A public profile is metadata; only downloaded project bytes enter the motor. */
export function MakerWorldProjectSlicer({ reference, ownedPrinterModels, disabled, onBusyChange, onSliced }: Props) {
  const { profile, user } = useAuth();
  const inputId = useId();
  const projects = makerWorldPublicProjects(reference);
  const key = JSON.stringify([profile?.tenant_id, user?.id, reference.design_id, reference.selected_profile_id,
    reference.selected_variant_profile_id, projects.map(project => project.url)]);
  const latestKey = useRef(key); latestKey.current = key;
  const delivery = useRef(onSliced); delivery.current = onSliced;
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const active = downloading || file !== null;
  useEffect(() => { onBusyChange?.(active); }, [active, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    setSelected(""); setFile(null); setDownloading(false); setError("");
    return () => { alive.current = false; request.current?.abort(); request.current = null; };
  }, [key]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  async function download() {
    const project = projects.length === 1 ? projects[0] : projects.find(project => project.url === selected);
    if (!project || request.current || !profile?.tenant_id || !user?.id) return;
    const current = new AbortController(), startedKey = key;
    request.current = current; setDownloading(true); setError("");
    try {
      const downloaded = await downloadMakerWorldProject(project, current.signal);
      if (alive.current && !current.signal.aborted && request.current === current && latestKey.current === startedKey) setFile(downloaded);
    } catch (failure) {
      if (alive.current && !current.signal.aborted && request.current === current && latestKey.current === startedKey)
        setError(failure instanceof Error ? failure.message : "Não foi possível baixar o projeto público.");
    } finally {
      if (request.current === current) { request.current = null; setDownloading(false); }
    }
  }

  return <section className="space-y-3 rounded-lg border p-3" aria-label="Fatiar projeto público do MakerWorld">
    <p className="font-medium">Calcular pelo projeto 3MF</p>
    {projects.length ? <>
      <p className="text-sm text-muted-foreground">Baixa o projeto público e fatia neste computador em segundo plano, sem abrir o Bambu Studio. O 3MF preserva as placas e cores; tempo e consumo serão os do novo fatiamento, incluindo a purga e a torre informadas pelo motor.</p>
      {projects.length > 1 && <div className="space-y-2"><Label htmlFor={inputId}>Projeto 3MF público</Label><select id={inputId} value={selected} disabled={active || disabled} className="h-11 w-full rounded-md border bg-background px-3" onChange={event => setSelected(event.target.value)}><option value="">Escolha o arquivo do projeto</option>{projects.map(project => <option key={project.url} value={project.url}>{project.name}</option>)}</select></div>}
      {projects.length === 1 && <p className="break-words text-sm">{projects[0].name}</p>}
      <Button type="button" variant="outline" disabled={disabled || active || projects.length > 1 && !selected || !profile?.tenant_id || !user?.id} onClick={() => void download()}>{downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scissors className="mr-2 h-4 w-4" />}{downloading ? "Baixando projeto…" : "Baixar projeto e fatiar"}</Button>
      {downloading && <Button type="button" variant="ghost" onClick={() => { request.current?.abort(); request.current = null; setDownloading(false); }}>Cancelar download</Button>}
    </> : <p role="status" className="text-sm text-muted-foreground">{makerWorldProjectPending(reference)}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {file && <Suspense fallback={<p role="status">Carregando fatiador…</p>}><SlicingDialog open file={file} ownedPrinterModels={ownedPrinterModels} onOpenChange={open => { if (!open) setFile(null); }} onSliced={async (result, metadata) => {
      const startedKey = key;
      if (!alive.current || latestKey.current !== startedKey) throw new Error("O modelo ou a sessão mudou. Baixe o projeto novamente.");
      await delivery.current(result, metadata);
      if (alive.current && latestKey.current === startedKey) setFile(null);
    }} /></Suspense>}
  </section>;
}
