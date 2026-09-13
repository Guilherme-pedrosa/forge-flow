import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Archive, Download, FileBox, Link2, Loader2, Pencil, Plus, Printer, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { allRows } from "@/lib/finance";
import { makerWorldDesignId, normalizePrintSourceUrl, PRINT_FILE_ACCEPT, printSourceHasIdentifiers, printSourceIdentifiers, printSourceNeedsTaskBinding, safePrintFileName, validatePrintFile, type PrintSourceIdentifiers } from "@/lib/product-print-source";
import ProductPrintPlates from "./ProductPrintPlates";

type Source = PrintSourceIdentifiers & {
  id: string; tenant_id: string; product_id: string; source_url: string | null;
  file_path: string | null; file_name: string | null; file_sha256: string | null;
  label: string | null; is_active: boolean; created_at: string;
};
type SourcesDatabase = { public: {
  Tables: { product_print_sources: { Row: Source; Insert: Partial<Source>; Update: Partial<Source>; Relationships: [] } };
  Views: Record<string, never>; Functions: Record<string, never>; Enums: Record<string, never>; CompositeTypes: Record<string, never>;
} };
const sourcesDb = supabase as unknown as SupabaseClient<SourcesDatabase>;
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
const emptyDraft = () => ({ label: "", source_url: "", design_id: "", instance_id: "", model_id: "", profile_id: "", plate_index: "" });
type FileMetadata = { file_path: string; file_name: string; file_sha256: string };
const taskStatus: Record<string, string> = { "1": "Em andamento", "2": "Concluída", "3": "Falha / interrupção", "4": "Em andamento" };
const dateLabel = (value: string | null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Data não informada";

export default function ProductPrintSources({ productId, tenantId, onBusyChange }: {
  productId: string; tenantId: string; onBusyChange?: (busy: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [file, setFile] = useState<File | null>(null);
  const [bindingSource, setBindingSource] = useState<string | null>(null);
  const [taskId, setTaskId] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [platesBusy, setPlatesBusy] = useState<Record<string, boolean>>({});
  const handlePlateBusy = useCallback((sourceId: string, value: boolean) => {
    setPlatesBusy(previous => previous[sourceId] === value ? previous : { ...previous, [sourceId]: value });
  }, []);
  const uploaded = useRef<{ file: File; metadata: FileMetadata } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: sources = [], isLoading, error, refetch } = useQuery({
    queryKey: ["product_print_sources", tenantId, productId],
    queryFn: () => allRows((from, to) => sourcesDb.from("product_print_sources").select("*").eq("tenant_id", tenantId).eq("product_id", productId).eq("is_active", true).order("created_at", { ascending: false }).order("id").range(from, to)),
  });
  const { data: tasks = [], isLoading: tasksLoading, error: tasksError, refetch: refetchTasks } = useQuery({
    queryKey: ["product_print_source_tasks", tenantId],
    queryFn: () => allRows((from, to) => supabase.from("bambu_tasks").select("id,bambu_task_id,design_title,status,start_time,bambu_devices(name)").eq("tenant_id", tenantId).order("start_time", { ascending: false }).order("id").range(from, to)),
    enabled: !!bindingSource,
  });
  const selectedTask = tasks.find(task => task.id === taskId);
  const filteredTasks = tasks.filter(task => !taskSearch.trim() || `${task.design_title || ""} ${task.bambu_task_id} ${task.bambu_devices?.name || ""}`.toLocaleLowerCase("pt-BR").includes(taskSearch.trim().toLocaleLowerCase("pt-BR")));

  const resetForm = () => {
    setFormOpen(false); setEditing(null); setDraft(emptyDraft()); setFile(null); uploaded.current = null;
    if (fileInput.current) fileInput.current.value = "";
  };
  const refreshSources = () => qc.invalidateQueries({ queryKey: ["product_print_sources", tenantId, productId] });
  const save = useMutation({
    mutationFn: async () => {
      const sourceUrl = normalizePrintSourceUrl(draft.source_url);
      const identifiers = printSourceIdentifiers(draft);
      if (!sourceUrl && !file && !editing?.file_path && !printSourceHasIdentifiers(identifiers)) throw new Error("Adicione um arquivo, link ou identificadores de impressão.");
      let metadata: Partial<FileMetadata> = editing ? { file_path: editing.file_path || undefined, file_name: editing.file_name || undefined, file_sha256: editing.file_sha256 || undefined } : {};
      if (file) {
        validatePrintFile(file);
        if (uploaded.current?.file === file) metadata = uploaded.current.metadata;
        else {
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          const fileHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
          const path = `${tenantId}/${crypto.randomUUID()}/${safePrintFileName(file.name)}`;
          const { error: uploadError } = await supabase.storage.from("attachments").upload(path, file, { contentType: "application/octet-stream", upsert: false });
          if (uploadError) throw new Error(uploadError.message);
          metadata = { file_path: path, file_name: file.name, file_sha256: fileHash };
          uploaded.current = { file, metadata: metadata as FileMetadata };
        }
      }
      const { data, error: saveError } = await rpc("save_product_print_source", {
        p_source_id: editing?.id || null, p_product_id: productId,
        p_source: { ...identifiers, ...metadata, source_url: sourceUrl, label: draft.label.trim() || null },
      });
      if (saveError) throw new Error(saveError.message);
      if (!data) throw new Error("O vínculo não foi confirmado. Atualize a lista antes de tentar novamente.");
      return { id: data, needsTaskBinding: printSourceNeedsTaskBinding(identifiers) };
    },
    onSuccess: async result => {
      resetForm(); await refreshSources();
      if (result.needsTaskBinding) { setBindingSource(result.id); setTaskId(""); setTaskSearch(""); }
      toast({ title: "Fonte de impressão salva", description: result.needsTaskBinding ? "Escolha uma impressão Bambu para concluir o vínculo com o SKU." : "Os identificadores serão conferidos na conciliação Bambu." });
    },
    onError: (err: Error) => toast({ title: "Não foi possível salvar o vínculo", description: err.message, variant: "destructive" }),
  });
  const bind = useMutation({
    mutationFn: async () => {
      if (!bindingSource || !taskId || !selectedTask) throw new Error("Selecione uma impressão do histórico Bambu.");
      const { data, error: bindError } = await rpc("bind_product_print_source", { p_source_id: bindingSource, p_task_id: taskId });
      if (bindError) throw new Error(bindError.message);
      if (!data) throw new Error("O vínculo não foi confirmado. Atualize a lista antes de tentar novamente.");
    },
    onSuccess: async () => {
      await refreshSources(); setBindingSource(null); setTaskId("");
      toast({ title: "Impressão vinculada ao produto", description: "Os identificadores Bambu foram registrados para reconhecer o SKU." });
    },
    onError: (err: Error) => toast({ title: "Não foi possível vincular a impressão", description: err.message, variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: archiveError } = await rpc("archive_product_print_source", { p_source_id: id });
      if (archiveError) throw new Error(archiveError.message);
    },
    onSuccess: async (_, id) => {
      if (bindingSource === id) setBindingSource(null);
      await refreshSources(); toast({ title: "Fonte arquivada", description: "O arquivo e o histórico foram preservados." });
    },
    onError: (err: Error) => toast({ title: "Não foi possível arquivar", description: err.message, variant: "destructive" }),
  });
  const busy = save.isPending || bind.isPending || archive.isPending || !!downloadId || Object.values(platesBusy).some(Boolean);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  const download = async (source: Source) => {
    if (!source.file_path) return;
    setDownloadId(source.id);
    try {
      const { data, error: urlError } = await supabase.storage.from("attachments").createSignedUrl(source.file_path, 60);
      if (urlError) throw new Error(urlError.message);
      if (!data?.signedUrl) throw new Error("Não foi possível preparar o arquivo.");
      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error("Não foi possível baixar o arquivo. Tente novamente.");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = blobUrl; anchor.download = source.file_name || "impressao";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) { toast({ title: "Arquivo indisponível", description: (err as Error).message, variant: "destructive" }); }
    finally { setDownloadId(null); }
  };

  return <section aria-label="Arquivos e links de impressão" className="rounded-xl border p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold flex items-center gap-2"><FileBox className="h-4 w-4" /> Arquivos e links de impressão</h3>
      {!formOpen && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { resetForm(); setFormOpen(true); }}><Plus className="mr-1 h-3.5 w-3.5" /> Adicionar fonte</Button>}
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">Associe o modelo ao SKU deste produto. Para reconhecer a produção automaticamente, vincule uma impressão do histórico Bambu. Nome de arquivo e quantidade de peças não identificam o produto.</p>
    {error && <div role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm">Não foi possível carregar os vínculos. <Button type="button" size="sm" variant="ghost" onClick={() => refetch()}>Tentar novamente</Button></div>}
    {isLoading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando vínculos…</p> : !sources.length && !error && <p className="text-xs text-muted-foreground">Nenhum arquivo ou link associado.</p>}
    {sources.map((source, sourceIndex) => <article key={source.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{source.label || source.file_name || "Modelo de impressão"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{printSourceHasIdentifiers(source) ? "Identificadores cadastrados" : "Aguardando vínculo com uma impressão Bambu"}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Editar fonte ${source.label || source.file_name || "de impressão"}`} disabled={busy} onClick={() => {
            setEditing(source); setFormOpen(true); setFile(null); uploaded.current = null;
            setDraft({ label: source.label || "", source_url: source.source_url || "", design_id: source.design_id || "", instance_id: source.instance_id || "", model_id: source.model_id || "", profile_id: source.profile_id || "", plate_index: source.plate_index == null ? "" : String(source.plate_index) });
          }}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Arquivar fonte ${source.label || source.file_name || "de impressão"}`} disabled={busy} onClick={() => archive.mutate(source.id)}><Archive className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {source.file_path && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => download(source)}>{downloadId === source.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />} Baixar arquivo</Button>}
        {source.source_url && (() => { let href: string | null = null; try { href = normalizePrintSourceUrl(source.source_url); } catch { /* no unsafe saved link */ } return href && <Button type="button" variant="outline" size="sm" asChild><a href={href} target="_blank" rel="noopener noreferrer"><Link2 className="mr-1 h-3.5 w-3.5" /> Abrir link</a></Button>; })()}
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setBindingSource(source.id); setTaskId(""); setTaskSearch(""); }}><Printer className="mr-1 h-3.5 w-3.5" /> Vincular impressão</Button>
      </div>
      {printSourceHasIdentifiers(source) && <p className="break-all text-[11px] leading-relaxed text-muted-foreground">{[
        source.design_id && `Design ${source.design_id}`, source.instance_id && `Instance ${source.instance_id}`,
        source.model_id && `Model ${source.model_id}`, source.profile_id && `Profile ${source.profile_id}`,
        source.plate_index != null && `Placa ${source.plate_index}`,
      ].filter(Boolean).join(" · ")}</p>}
      {bindingSource === source.id && <div className="border-t pt-3 space-y-3">
        <div className="flex justify-between items-center gap-2"><p className="text-sm font-medium">Selecione a impressão deste produto</p><Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Fechar vínculo da impressão" disabled={busy} onClick={() => setBindingSource(null)}><X className="h-4 w-4" /></Button></div>
        <div><Label htmlFor={`task-search-${source.id}`}>Buscar por nome, impressora ou ID Bambu</Label><Input id={`task-search-${source.id}`} value={taskSearch} onChange={event => { setTaskSearch(event.target.value); setTaskId(""); }} disabled={busy} /></div>
        {tasksError ? <p role="alert" className="text-xs text-destructive">Não foi possível carregar as impressões. <Button type="button" size="sm" variant="ghost" onClick={() => refetchTasks()}>Tentar novamente</Button></p> : <div>
          <Label htmlFor={`source-task-${source.id}`}>Impressão do histórico</Label>
          <select id={`source-task-${source.id}`} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={taskId} onChange={event => setTaskId(event.target.value)} disabled={busy || tasksLoading}>
            <option value="">{tasksLoading ? "Carregando impressões…" : "Selecione a impressão correta"}</option>
            {filteredTasks.map(task => <option key={task.id} value={task.id}>{task.design_title || "Sem título"} · {dateLabel(task.start_time)} · {task.bambu_devices?.name || "Impressora"} · #{task.bambu_task_id}</option>)}
          </select>
          {!tasksLoading && !filteredTasks.length && <p className="mt-1 text-xs text-muted-foreground">Nenhuma impressão encontrada. Sincronize a Bambu ou ajuste a busca.</p>}
        </div>}
        {selectedTask && <p className="rounded-md bg-background p-3 text-xs leading-relaxed">{selectedTask.design_title || "Impressão sem título"} · {taskStatus[selectedTask.status || ""] || "Status não informado"} · {dateLabel(selectedTask.start_time)}. Os identificadores desta impressão serão associados ao SKU. Isso não registra consumo nem altera a quantidade produzida.</p>}
        <Button type="button" size="sm" disabled={busy || !selectedTask || !!tasksError} onClick={() => bind.mutate()}>{bind.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Confirmar vínculo com este produto</Button>
      </div>}
      <ProductPrintPlates productId={productId} tenantId={tenantId} sourceId={source.id} showProductTotal={sourceIndex === 0} onBusyChange={handlePlateBusy} />
    </article>)}
    {formOpen && <div className="border-t pt-3 space-y-3">
      <p className="text-sm font-medium">{editing ? "Editar fonte" : "Nova fonte"}</p>
      <div><Label htmlFor="print-source-label">Nome da fonte</Label><Input id="print-source-label" value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} placeholder="Ex.: Vaso — placa com 4 peças" disabled={busy} /></div>
      <div><Label htmlFor="print-source-url">Link do modelo ou perfil</Label><Input id="print-source-url" type="url" value={draft.source_url} onChange={event => setDraft({ ...draft, source_url: event.target.value })} onBlur={() => { const id = makerWorldDesignId(draft.source_url); if (id && !draft.design_id) setDraft(previous => ({ ...previous, design_id: id })); }} placeholder="https://makerworld.com/..." disabled={busy} /></div>
      <div><Label htmlFor="print-source-file">Arquivo STL, 3MF ou GCODE · até 50 MB</Label><Input ref={fileInput} id="print-source-file" type="file" accept={PRINT_FILE_ACCEPT} disabled={busy} className="h-auto min-h-11 py-2 text-xs" onChange={event => {
        const chosen = event.target.files?.[0]; if (!chosen) { setFile(null); return; }
        try { validatePrintFile(chosen); setFile(chosen); uploaded.current = null; }
        catch (err) { event.target.value = ""; setFile(null); toast({ title: "Arquivo inválido", description: (err as Error).message, variant: "destructive" }); }
      }} />{editing?.file_name && !file && <p className="mt-1 break-words text-xs text-muted-foreground">Arquivo atual: {editing.file_name}</p>}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">O arquivo fica privado. Ele é associado ao cadastro; não é enviado à impressora nem executado.</p>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-medium">Identificadores avançados da Bambu</summary>
        <p className="my-2 text-xs leading-relaxed text-muted-foreground">Opcional. Use os IDs exatos do histórico. O perfil do link MakerWorld pode ter um identificador diferente do Profile ID da Bambu. Vincular uma impressão preenche esses campos automaticamente.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{([
          ["design_id", "Design ID"], ["instance_id", "Instance ID"], ["model_id", "Model ID"], ["profile_id", "Profile ID"], ["plate_index", "Placa no histórico"],
        ] as const).map(([key, label]) => <div key={key}><Label htmlFor={`print-source-${key}`}>{label}</Label><Input id={`print-source-${key}`} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} type={key === "plate_index" ? "number" : "text"} min={key === "plate_index" ? 0 : undefined} step={key === "plate_index" ? 1 : undefined} disabled={busy} /></div>)}</div>
      </details>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={resetForm}>Cancelar fonte</Button><Button type="button" size="sm" disabled={busy} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar fonte</Button></div>
    </div>}
  </section>;
}
