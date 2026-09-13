import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Archive, Download, FileBox, Link2, Loader2, Pencil, Plus, Printer, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { allRows } from "@/lib/finance";
import { makerWorldDesignId, normalizePrintSourceUrl, PRINT_FILE_ACCEPT, printSourceHasIdentifiers, printSourceIdentifiers, printSourceNeedsTaskBinding, safePrintFileName, validatePrintFile, type PrintSourceIdentifiers } from "@/lib/product-print-source";
import ProductPrintPlates from "./ProductPrintPlates";
import { fetchPrintSourceImport, getPrintSourceImportIdentity, PrintSourceImportError, resolvePrintSourceImport, type PrintSourceImportIdentity } from "@/lib/print-source-import";
import type { ProductExternalImport } from "@/lib/makerworld-import";
import type { MakerWorldModel } from "../../../supabase/functions/_shared/makerworld";
import { MakerWorldPrinterOption } from "./MakerWorldReference";

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
const rpc = (name: string, args: Record<string, unknown>) => Promise.resolve((supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args));
type ImportResult = { source_id: string; created: number; updated: number; pending_yield?: number };
type ImportChoice = { model: MakerWorldModel; sourceId: string | null; profile: string; variant: string; identity: PrintSourceImportIdentity };
const emptyDraft = () => ({ label: "", source_url: "", design_id: "", instance_id: "", model_id: "", profile_id: "", plate_index: "" });
type FileMetadata = { file_path: string; file_name: string; file_sha256: string };
const taskStatus: Record<string, string> = { "1": "Em andamento", "2": "Concluída", "3": "Falha / interrupção", "4": "Em andamento" };
const dateLabel = (value: string | null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Data não informada";

export default function ProductPrintSources({ productId, tenantId, onBusyChange, onDraftChange }: {
  productId: string; tenantId: string; onBusyChange?: (busy: boolean) => void; onDraftChange?: (editing: boolean) => void;
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
  const [importChoice, setImportChoice] = useState<ImportChoice | null>(null);
  const [writing, setWriting] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const submittedImport = useRef<{ key: string; args: Record<string, unknown> } | null>(null);
  useEffect(() => () => importAbort.current?.abort(), []);
  const [platesBusy, setPlatesBusy] = useState<Record<string, boolean>>({});
  const [platesDraft, setPlatesDraft] = useState<Record<string, boolean>>({});
  const handlePlateDraft = useCallback((sourceId: string, value: boolean) => {
    setPlatesDraft(previous => previous[sourceId] === value ? previous : { ...previous, [sourceId]: value });
  }, []);
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
    queryKey: ["product_print_source_tasks", tenantId, "import"],
    queryFn: () => allRows((from, to) => supabase.from("bambu_tasks").select("id,bambu_task_id,design_title,status,start_time,end_time,raw_data,weight_grams,cost_time_seconds,bambu_devices(name)").eq("tenant_id", tenantId).order("start_time", { ascending: false }).order("id").range(from, to)),
    enabled: !!bindingSource,
  });
  const selectedTask = tasks.find(task => task.id === taskId);
  const filteredTasks = tasks.filter(task => !taskSearch.trim() || `${task.design_title || ""} ${task.bambu_task_id} ${task.bambu_devices?.name || ""}`.toLocaleLowerCase("pt-BR").includes(taskSearch.trim().toLocaleLowerCase("pt-BR")));

  const resetForm = () => {
    importAbort.current?.abort(); importAbort.current = null; setImportChoice(null); requestId.current = crypto.randomUUID(); submittedImport.current = null;
    setFormOpen(false); setEditing(null); setDraft(emptyDraft()); setFile(null); uploaded.current = null;
    if (fileInput.current) fileInput.current.value = "";
  };
  const refreshSources = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["product_print_sources", tenantId, productId] }),
    qc.invalidateQueries({ queryKey: ["product_print_plates", tenantId, productId] }),
    qc.invalidateQueries({ queryKey: ["product_material_recipe", tenantId, productId] }),
    qc.invalidateQueries({ queryKey: ["product_print_plate_preparation", tenantId] }),
    qc.invalidateQueries({ queryKey: ["products"] }),
  ]);
  const importReference = async (identity: PrintSourceImportIdentity, sourceId: string | null, task?: typeof selectedTask) => {
    importAbort.current?.abort();
    const controller = new AbortController(); importAbort.current = controller;
    if (!task && importChoice?.sourceId === sourceId && importChoice.profile !== "" && importChoice.variant !== "") {
      const profile = importChoice.model.profiles[Number(importChoice.profile)];
      const variant = [profile, ...profile.variants][Number(importChoice.variant)];
      return resolvePrintSourceImport(importChoice.model, { ...identity, instance_id: profile.instance_id, profile_id: variant.profile_id,
        source_url: `https://makerworld.com/en/models/${importChoice.model.design_id}#profileId-${profile.instance_id}` });
    }
    try { return await fetchPrintSourceImport(identity, task, controller.signal); }
    catch (error) {
      if (error instanceof PrintSourceImportError && error.code === "profile_choice_required" && error.model && !task) {
        const profileIndex = error.model.profiles.findIndex(profile => profile.instance_id === identity.instance_id);
        setImportChoice({ model: error.model, sourceId, identity, profile: profileIndex >= 0 ? String(profileIndex) : "", variant: "" });
        return null;
      }
      throw error;
    }
  };
  const writeImport = async (name: string, args: Record<string, unknown>): Promise<ImportResult> => {
    importAbort.current?.signal.throwIfAborted(); setWriting(true);
    try {
      const { data, error } = await rpc(name, args);
      if (error) throw new Error(error.message);
      if (!data || typeof data !== "object" || !("source_id" in data)) throw new Error("A importação não foi confirmada. Atualize a lista antes de tentar novamente.");
      return data as ImportResult;
    } finally { setWriting(false); }
  };
  const imported = (result: ImportResult) => {
    const count = result.created + result.updated;
    toast({ title: `${count} ${count === 1 ? "placa preenchida" : "placas preenchidas"}`, description: "Peso, tempo e filamentos disponíveis foram carregados. Confira o rendimento e os materiais na composição de cada placa." });
  };
  const save = useMutation({
    mutationFn: async () => {
      const submissionKey = JSON.stringify([editing?.id, draft, file && [file.name, file.size, file.lastModified], importChoice?.profile, importChoice?.variant]);
      if (submittedImport.current?.key === submissionKey) {
        const result = await writeImport("save_source_with_plate_import", submittedImport.current.args);
        return { id: result.source_id, needsTaskBinding: false, imported: result };
      }
      if (submittedImport.current) { submittedImport.current = null; requestId.current = crypto.randomUUID(); }
      const sourceUrl = normalizePrintSourceUrl(draft.source_url);
      const identifiers = printSourceIdentifiers(draft);
      if (!sourceUrl && !file && !editing?.file_path && !printSourceHasIdentifiers(identifiers)) throw new Error("Adicione um arquivo, link ou identificadores de impressão.");
      let reference: ProductExternalImport | null = null;
      if (makerWorldDesignId(sourceUrl || "") || identifiers.design_id) {
        reference = await importReference({ ...identifiers, source_url: sourceUrl }, editing?.id || null);
        if (!reference) return null;
      }
      let metadata: Partial<FileMetadata> = editing ? { file_path: editing.file_path || undefined, file_name: editing.file_name || undefined, file_sha256: editing.file_sha256 || undefined } : {};
      if (file) {
        validatePrintFile(file);
        if (uploaded.current?.file === file) metadata = uploaded.current.metadata;
        else {
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          const fileHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
          const path = `${tenantId}/${crypto.randomUUID()}/${safePrintFileName(file.name)}`;
          importAbort.current?.signal.throwIfAborted(); setWriting(true);
          const { error: uploadError } = await supabase.storage.from("attachments").upload(path, file, { contentType: "application/octet-stream", upsert: false }).finally(() => setWriting(false));
          if (uploadError) throw new Error(uploadError.message);
          metadata = { file_path: path, file_name: file.name, file_sha256: fileHash };
          uploaded.current = { file, metadata: metadata as FileMetadata };
        }
      }
      const payload = { ...identifiers, ...metadata, source_url: sourceUrl, label: draft.label.trim() || null };
      if (reference) {
        const args = { p_source_id: editing?.id || null, p_product_id: productId,
          p_source: { ...payload, source_url: reference.source_url, instance_id: reference.selected_instance_id, profile_id: reference.selected_variant_profile_id }, p_reference: reference, p_request_id: requestId.current };
        submittedImport.current = { key: submissionKey, args };
        const result = await writeImport("save_source_with_plate_import", args);
        return { id: result.source_id, needsTaskBinding: false, imported: result };
      }
      importAbort.current?.signal.throwIfAborted(); setWriting(true);
      const { data, error: saveError } = await rpc("save_product_print_source", {
        p_source_id: editing?.id || null, p_product_id: productId,
        p_source: payload,
      }).finally(() => setWriting(false));
      if (saveError) throw new Error(saveError.message);
      if (typeof data !== "string") throw new Error("O vínculo não foi confirmado. Atualize a lista antes de tentar novamente.");
      return { id: data, needsTaskBinding: printSourceNeedsTaskBinding(identifiers), imported: null };
    },
    onSuccess: result => {
      if (!result) return;
      resetForm(); void refreshSources();
      if (result.needsTaskBinding) { setBindingSource(result.id); setTaskId(""); setTaskSearch(""); }
      if (result.imported) imported(result.imported);
      else toast({ title: "Fonte de impressão salva", description: result.needsTaskBinding ? "Escolha uma impressão Bambu para carregar os dados da placa e concluir o vínculo com o SKU." : "Os identificadores serão conferidos na conciliação Bambu." });
    },
    onError: (err: Error) => toast({ title: "Não foi possível salvar o vínculo", description: err.message, variant: "destructive" }),
  });
  const bind = useMutation({
    mutationFn: async () => {
      importAbort.current = new AbortController();
      if (!bindingSource || !taskId || !selectedTask) throw new Error("Selecione uma impressão do histórico Bambu.");
      const source = sources.find(source => source.id === bindingSource);
      if (!source) throw new Error("A fonte não está mais disponível. Atualize a lista.");
      let reference: ProductExternalImport | null = null;
      if (getPrintSourceImportIdentity(source, selectedTask).design_id) reference = await importReference(source, source.id, selectedTask);
      return writeImport("persist_source_plate_import", { p_source_id: bindingSource, p_task_id: taskId, p_reference: reference });
    },
    onSuccess: result => {
      void refreshSources(); setBindingSource(null); setTaskId("");
      imported(result);
    },
    onError: (err: Error) => toast({ title: "Não foi possível vincular a impressão", description: err.message, variant: "destructive" }),
  });
  const hydrate = useMutation({
    mutationFn: async (source: Source) => {
      const reference = await importReference(source, source.id);
      if (!reference) return null;
      return writeImport("persist_source_plate_import", { p_source_id: source.id, p_reference: reference });
    },
    onSuccess: result => { if (result) { setImportChoice(null); void refreshSources(); imported(result); } },
    onError: (err: Error) => toast({ title: "Não foi possível carregar as placas", description: err.message, variant: "destructive" }),
  });
  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error: archiveError } = await rpc("archive_product_print_source", { p_source_id: id });
      if (archiveError) throw new Error(archiveError.message);
    },
    onSuccess: (_, id) => {
      if (bindingSource === id) setBindingSource(null);
      void refreshSources(); toast({ title: "Fonte arquivada", description: "O arquivo e o histórico foram preservados." });
    },
    onError: (err: Error) => toast({ title: "Não foi possível arquivar", description: err.message, variant: "destructive" }),
  });
  const writePending = writing || archive.isPending || Object.values(platesBusy).some(Boolean);
  const busy = writePending || save.isPending || bind.isPending || hydrate.isPending || !!downloadId;
  useEffect(() => { onBusyChange?.(writePending); return () => onBusyChange?.(false); }, [writePending, onBusyChange]);
  const hasDraft = formOpen || !!importChoice || (!!bindingSource && !!taskId) || Object.values(platesDraft).some(Boolean);
  useEffect(() => { onDraftChange?.(hasDraft); return () => onDraftChange?.(false); }, [hasDraft, onDraftChange]);

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
  const chooseProfile = (sourceId: string | null) => importChoice?.sourceId === sourceId && <div className="space-y-3 rounded-lg border border-primary/30 bg-background p-3" aria-label="Escolher configuração de impressão">
    <p className="text-sm font-medium">Escolha a configuração que será produzida</p>
    <p className="text-xs text-muted-foreground">{importChoice.model.title}. Cada configuração pode ter placas, pesos e tempos diferentes.</p>
    <div><Label htmlFor="source-import-profile">Perfil de impressão</Label><select id="source-import-profile" className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-base" value={importChoice.profile} disabled={busy} onChange={event => setImportChoice({ ...importChoice, profile: event.target.value, variant: "" })}>
      <option value="">Selecione o perfil</option>{importChoice.model.profiles.map((profile, index) => <option key={index} value={index}>{profile.name || `Perfil ${index + 1}`}</option>)}
    </select></div>
    {importChoice.profile !== "" && <MakerWorldPrinterOption profile={importChoice.model.profiles[Number(importChoice.profile)]} value={importChoice.variant} onChange={variant => setImportChoice({ ...importChoice, variant })} />}
    {sourceId && !formOpen && <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy || importChoice.profile === "" || importChoice.variant === ""} onClick={() => { const source = sources.find(source => source.id === sourceId); if (source) hydrate.mutate(source); }}>Importar placas desta configuração</Button><Button type="button" variant="outline" size="sm" disabled={writing} onClick={() => { importAbort.current?.abort(); setImportChoice(null); }}>Cancelar importação</Button></div>}
  </div>;

  return <section aria-label="Arquivos e links de impressão" className="rounded-xl border p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold flex items-center gap-2"><FileBox className="h-4 w-4" /> Arquivos e links de impressão</h3>
      {!formOpen && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { resetForm(); setFormOpen(true); }}><Plus className="mr-1 h-3.5 w-3.5" /> Adicionar fonte</Button>}
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">O link MakerWorld carrega as placas, o peso, o tempo e os filamentos do perfil escolhido. Vincular uma impressão Bambu identifica a configuração usada e registra os materiais observados.</p>
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
        {(source.design_id || makerWorldDesignId(source.source_url || "")) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => hydrate.mutate(source)}>{hydrate.isPending && hydrate.variables?.id === source.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Atualizar placas e materiais</Button>}
      </div>
      {importChoice?.sourceId === source.id && !formOpen && chooseProfile(source.id)}
      {printSourceHasIdentifiers(source) && <details className="text-xs text-muted-foreground"><summary className="min-h-8 cursor-pointer py-2">Identificação do arquivo</summary><p className="break-all text-[11px] leading-relaxed">{[
        source.design_id && `Design ${source.design_id}`, source.instance_id && `Instance ${source.instance_id}`,
        source.model_id && `Model ${source.model_id}`, source.profile_id && `Profile ${source.profile_id}`,
        source.plate_index != null && `Placa ${source.plate_index}`,
      ].filter(Boolean).join(" · ")}</p></details>}
      {bindingSource === source.id && <div className="border-t pt-3 space-y-3">
        <div className="flex justify-between items-center gap-2"><p className="text-sm font-medium">Selecione a impressão deste produto</p><Button type="button" size="icon" variant="ghost" className="h-11 w-11" aria-label="Fechar vínculo da impressão" disabled={writing} onClick={() => { importAbort.current?.abort(); setBindingSource(null); setTaskId(""); setTaskSearch(""); }}><X className="h-4 w-4" /></Button></div>
        <div><Label htmlFor={`task-search-${source.id}`}>Buscar por nome, impressora ou ID Bambu</Label><Input id={`task-search-${source.id}`} value={taskSearch} onChange={event => { setTaskSearch(event.target.value); setTaskId(""); }} disabled={busy} /></div>
        {tasksError ? <p role="alert" className="text-xs text-destructive">Não foi possível carregar as impressões. <Button type="button" size="sm" variant="ghost" onClick={() => refetchTasks()}>Tentar novamente</Button></p> : <div>
          <Label htmlFor={`source-task-${source.id}`}>Impressão do histórico</Label>
          <select id={`source-task-${source.id}`} className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm" value={taskId} onChange={event => setTaskId(event.target.value)} disabled={busy || tasksLoading}>
            <option value="">{tasksLoading ? "Carregando impressões…" : "Selecione a impressão correta"}</option>
            {filteredTasks.map(task => <option key={task.id} value={task.id}>{task.design_title || "Sem título"} · {dateLabel(task.start_time)} · {task.bambu_devices?.name || "Impressora"} · #{task.bambu_task_id}</option>)}
          </select>
          {!tasksLoading && !filteredTasks.length && <p className="mt-1 text-xs text-muted-foreground">Nenhuma impressão encontrada. Sincronize a Bambu ou ajuste a busca.</p>}
        </div>}
        {selectedTask && <p className="rounded-md bg-background p-3 text-xs leading-relaxed">{selectedTask.design_title || "Impressão sem título"} · {taskStatus[selectedTask.status || ""] || "Status não informado"} · {dateLabel(selectedTask.start_time)}. O vínculo carrega as placas disponíveis e os filamentos usados nesta impressão. Rendimento e correspondências com o estoque podem precisar de confirmação.</p>}
        <Button type="button" size="sm" disabled={busy || !selectedTask || !!tasksError} onClick={() => bind.mutate()}>{bind.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Confirmar vínculo com este produto</Button>
      </div>}
      <ProductPrintPlates productId={productId} tenantId={tenantId} sourceId={source.id} showProductTotal={sourceIndex === 0} onBusyChange={handlePlateBusy} onDraftChange={handlePlateDraft} />
    </article>)}
    {formOpen && <div className="border-t pt-3 space-y-3">
      <p className="text-sm font-medium">{editing ? "Editar fonte" : "Nova fonte"}</p>
      <div><Label htmlFor="print-source-label">Nome da fonte</Label><Input id="print-source-label" value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} placeholder="Ex.: Vaso — placa com 4 peças" disabled={busy} /></div>
      <div><Label htmlFor="print-source-url">Link do modelo ou perfil</Label><Input id="print-source-url" type="url" value={draft.source_url} onChange={event => { setImportChoice(null); requestId.current = crypto.randomUUID(); setDraft({ ...draft, source_url: event.target.value, design_id: "", instance_id: "", model_id: "", profile_id: "", plate_index: "" }); }} onBlur={() => { const id = makerWorldDesignId(draft.source_url); if (id && !draft.design_id) setDraft(previous => ({ ...previous, design_id: id })); }} placeholder="https://makerworld.com/..." disabled={busy} /></div>
      {chooseProfile(editing?.id || null)}
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
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" size="sm" className="min-h-11" disabled={writing} onClick={resetForm}>Cancelar fonte</Button><Button type="button" size="sm" className="min-h-11" disabled={busy || (!!importChoice && (importChoice.profile === "" || importChoice.variant === ""))} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar fonte</Button></div>
    </div>}
  </section>;
}
