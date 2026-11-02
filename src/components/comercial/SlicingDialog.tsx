import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Scissors } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { detectLocalSlicer, LOCAL_SLICER_PROFILES, sliceWithLocalExtension, type LocalSlicerInfo } from '@/lib/local-slicer-extension';

const CHUNK_BYTES = 393216, MAX_FILE_BYTES = 67108864;
export interface SlicingJob {
  id: string; file_name: string; status: 'uploading' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  source_sha256: string; source_size: number; profile_id: string; progress: number; error?: string;
  result_available: boolean; result_size?: number; result_sha256?: string; result_chunks: number;
  stats?: { time_seconds: number; weight_grams: number; engine: string; engine_version: string; normalizations: string[] };
}
interface Profiles {
  can_manage_workers: boolean;
  profiles: { id: string; name: string; engine_version: string; available: boolean }[];
}
interface Props {
  open: boolean; file: File | null; onOpenChange: (open: boolean) => void;
  onSliced: (file: File, metadata: SlicingJob) => void | Promise<void>;
  resultLabel?: string;
  profileId?: string;
  ownedPrinterModels?: string[];
}
type RpcClient = { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function fileSha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function encodeSlicingChunk(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > CHUNK_BYTES) throw new Error('Bloco inválido.');
  let binary = ''; for (let n = 0; n < bytes.length; n += 8192) binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return btoa(binary);
}
export async function downloadSlicedFile(job: SlicingJob, readChunk = (part: number) => rpc<string>('slicer_result_chunk', { p_job: job.id, p_part: part })): Promise<File> {
  if (!job.result_available || !job.result_size || job.result_size > MAX_FILE_BYTES || job.result_chunks !== Math.ceil(job.result_size / CHUNK_BYTES) || !/^[0-9a-f]{64}$/.test(job.result_sha256 ?? '')) throw new Error('O arquivo da simulação não está disponível.');
  const bytes = new Uint8Array(job.result_size);
  for (let part = 0; part < job.result_chunks; part++) {
    const encoded = await readChunk(part);
    if (encoded.length > 524288 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Bloco do resultado inválido.');
    const decoded = atob(encoded), expected = Math.min(CHUNK_BYTES, job.result_size - part * CHUNK_BYTES);
    if (decoded.length !== expected) throw new Error('O resultado foi recebido de forma incompleta.');
    for (let n = 0; n < decoded.length; n++) bytes[part * CHUNK_BYTES + n] = decoded.charCodeAt(n);
  }
  if (await fileSha256(bytes.buffer) !== job.result_sha256) throw new Error('O hash do resultado não confere. Baixe novamente.');
  return new File([bytes], job.file_name.replace(/\.(?:stl|3mf)$/i, '') + '-simulado.3mf', { type: 'model/3mf' });
}
function saveDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const statusLabel = { uploading: 'Enviando arquivo', queued: 'Aguardando o fatiador local', running: 'Simulando no Bambu Studio', done: 'Simulação concluída', failed: 'Não foi possível simular', cancelled: 'Simulação cancelada' };

export function SlicingDialog({ open, file, onOpenChange, onSliced, resultLabel = 'Usar no cadastro', profileId, ownedPrinterModels }: Props) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profiles | null>(null), [profile, setProfile] = useState('');
  const [job, setJob] = useState<SlicingJob | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(''), [connectionSaved, setConnectionSaved] = useState(false);
  const operation = useRef(0), storageKey = useRef('');
  const [local, setLocal] = useState<LocalSlicerInfo | null>(null), [detecting, setDetecting] = useState(true);
  const [useCloud, setUseCloud] = useState(false), [detectVersion, setDetectVersion] = useState(0);
  const [localProfile, setLocalProfile] = useState('');
  const ownedProfileIds = ownedPrinterModels === undefined ? null : LOCAL_SLICER_PROFILES.filter(option => ownedPrinterModels.some(model => model.replace(/^Bambu\s+(?:Lab\s+)?/i, '').trim().toUpperCase() === option.label)).map(option => option.id);
  const ownedProfilesKey = JSON.stringify(ownedProfileIds);
  const eligibleProfiles = LOCAL_SLICER_PROFILES.filter(option => (!profileId || option.id === profileId) && (!ownedProfileIds || ownedProfileIds.includes(option.id)));
  const localProfiles = eligibleProfiles.filter(option => Boolean(local && (local.profiles ?? [local.profile_id]).includes(option.id)));
  const selectedLocalProfile = localProfiles.find(option => option.id === localProfile) ?? localProfiles[0];
  const [localFile, setLocalFile] = useState<File | null>(null), [jobSource, setJobSource] = useState<'local' | 'cloud' | null>(null);
  const localOperation = useRef<AbortController | null>(null);
  const cloudEnabled = !detecting && useCloud;
  const cloudOwnedKey = cloudEnabled ? ownedProfilesKey : '';
  const jobId = job?.id, jobStatus = job?.status;
  const resultProfileAllowed = !!job && (!profileId || job.profile_id === profileId) && (!ownedProfileIds || ownedProfileIds.includes(job.profile_id))
    && (jobSource !== 'local' || selectedLocalProfile?.id === job.profile_id);
  useEffect(() => {
    if (!jobId || resultProfileAllowed) return;
    ++operation.current; localOperation.current?.abort(); localOperation.current = null;
    setJob(null); setLocalFile(null); setJobSource(null); setBusy(false); setError(''); setProgress(0);
  }, [jobId, resultProfileAllowed]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setDetecting(true); setLocal(null); setUseCloud(false); setProfiles(null);
    void detectLocalSlicer({ signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setLocal(value); setDetecting(false);
    });
    return () => controller.abort();
  }, [open, profileId, detectVersion]);

  useEffect(() => {
    if (!open || !cloudEnabled) return;
    let active = true;
    const refresh = () => rpc<Profiles>('slicer_profiles').then(data => { if (active) {
      const allowed: string[] | null = JSON.parse(ownedProfilesKey);
      const available = { ...data, profiles: data.profiles.filter(p => (!profileId || p.id === profileId) && (!allowed || allowed.includes(p.id))) };
      setProfiles(available); setProfile(previous => available.profiles.some(p => p.id === previous) ? previous : available.profiles[0]?.id || '');
    } }).catch(e => { if (active) setError(e.message); });
    void refresh(); const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [open, profileId, cloudEnabled, ownedProfilesKey]);

  useEffect(() => {
    const current = ++operation.current; localOperation.current?.abort(); localOperation.current = null;
    const cleanup = () => { ++operation.current; localOperation.current?.abort(); localOperation.current = null; };
    setJob(null); setLocalFile(null); setJobSource(null); setBusy(false); setError(''); setProgress(0); storageKey.current = '';
    if (!open || !file || !user || !cloudEnabled) return cleanup;
    void file.arrayBuffer().then(fileSha256).then(async hash => {
      if (operation.current !== current) return;
      storageKey.current = `forge-slicing:${user.id}:${hash}`;
      const saved = sessionStorage.getItem(storageKey.current);
      if (!saved) return;
      try {
        const previous = await rpc<SlicingJob>('slicer_job', { p_job: JSON.parse(saved).job_id });
        if (operation.current === current && previous.source_sha256 === hash && (!profileId || previous.profile_id === profileId)) { setJob(previous); setJobSource('cloud'); }
      } catch { sessionStorage.removeItem(storageKey.current); }
    }).catch(() => { if (operation.current === current) setError('Não foi possível ler este arquivo.'); });
    return cleanup;
  }, [open, file, user, profileId, cloudEnabled, cloudOwnedKey]);

  useEffect(() => {
    if (!open || !jobId || jobSource !== 'cloud' || !['queued', 'running'].includes(jobStatus ?? '')) return;
    let active = true;
    const timer = setInterval(() => {
      void rpc<SlicingJob>('slicer_job', { p_job: jobId }).then(next => { if (active) { setJob(next); setError(''); } }).catch(e => { if (active) setError(e.message); });
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [open, jobId, jobStatus, jobSource]);

  async function simulateLocal() {
    if (!file || !local || !selectedLocalProfile || busy) return;
    const selectedProfileId = selectedLocalProfile.id;
    const current = ++operation.current, controller = new AbortController(); localOperation.current = controller;
    const id = `local:${crypto.randomUUID()}`;
    setBusy(true); setError(''); setProgress(0); setLocalFile(null); setJobSource('local');
    setJob({ id, file_name: file.name, status: 'running', source_sha256: '', source_size: file.size, profile_id: selectedProfileId, progress: 0, result_available: false, result_chunks: 0 });
    try {
      if (!/\.(stl|3mf)$/i.test(file.name) || !file.size || file.size > MAX_FILE_BYTES) throw new Error('Escolha um STL ou 3MF de até 64 MB.');
      const sourceHash = await file.arrayBuffer().then(fileSha256);
      if (current !== operation.current || controller.signal.aborted) return;
      const result = await sliceWithLocalExtension(file, { profileId: selectedProfileId, signal: controller.signal, onProgress: value => {
        if (current === operation.current) { setProgress(value); setJob(previous => previous && { ...previous, progress: value }); }
      } });
      const resultHash = await result.file.arrayBuffer().then(fileSha256);
      if (current !== operation.current || controller.signal.aborted) return;
      setLocalFile(result.file);
      setJob({ id, file_name: file.name, status: 'done', source_sha256: sourceHash, source_size: file.size, profile_id: selectedProfileId,
        progress: 100, result_available: true, result_size: result.file.size, result_sha256: resultHash, result_chunks: Math.ceil(result.file.size / CHUNK_BYTES), stats: result.stats });
    } catch (failure) {
      if (current === operation.current) {
        const cancelled = controller.signal.aborted || failure instanceof Error && failure.name === 'AbortError';
        const message = failure instanceof Error ? failure.message : 'Não foi possível fatiar neste computador.';
        setJob(previous => previous && { ...previous, status: cancelled ? 'cancelled' : 'failed' });
        if (!cancelled) setError(message);
      }
    } finally { if (current === operation.current) { localOperation.current = null; setBusy(false); } }
  }

  async function simulate() {
    if (!file || !user || !profile) return;
    setBusy(true); setError(''); setJobSource('cloud'); const current = ++operation.current;
    try {
      if (!/\.(stl|3mf)$/i.test(file.name) || !file.size || file.size > MAX_FILE_BYTES) throw new Error('Escolha um STL ou 3MF de até 64 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer()), hash = await fileSha256(bytes.buffer);
      storageKey.current = `forge-slicing:${user.id}:${hash}`;
      const existing = sessionStorage.getItem(storageKey.current), saved = existing && !['done', 'failed', 'cancelled'].includes(job?.status ?? '') ? JSON.parse(existing) : {};
      // A previous profile may share this file's cache key. Reuse only its own in-flight request.
      let cached = saved;
      if (saved.job_id && (!job || job.profile_id !== profile)) {
        const prior = await rpc<SlicingJob>('slicer_job', { p_job: saved.job_id });
        if (current !== operation.current) return;
        if (prior.profile_id !== profile || ['done', 'failed', 'cancelled'].includes(prior.status)) cached = {};
      }
      const request = cached.request_id ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey.current, JSON.stringify({ request_id: request, job_id: cached.job_id }));
      let next = await rpc<SlicingJob>('start_slicer_upload', { p_name: file.name, p_size: file.size, p_sha256: hash, p_profile: profile, p_request: request });
      if (current !== operation.current) { await rpc('cancel_slicer_job', { p_job: next.id }); return; }
      setJob(next); sessionStorage.setItem(storageKey.current, JSON.stringify({ request_id: request, job_id: next.id }));
      if (next.status === 'uploading') {
        for (let part = 0; part < Math.ceil(bytes.length / CHUNK_BYTES); part++) {
          if (current !== operation.current) return;
          await rpc('upload_slicer_chunk', { p_job: next.id, p_part: part, p_base64: encodeSlicingChunk(bytes.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES)) });
          setProgress(Math.round(Math.min(bytes.length, (part + 1) * CHUNK_BYTES) / bytes.length * 100));
        }
        if (current !== operation.current) return;
        next = await rpc<SlicingJob>('finish_slicer_upload', { p_job: next.id }); setJob(next);
      }
    } catch (e) { if (current === operation.current) setError(e instanceof Error ? e.message : 'Falha ao enviar o arquivo.'); }
    finally { setBusy(false); }
  }

  async function cancel() {
    ++operation.current; setError('');
    if (jobSource === 'local') {
      localOperation.current?.abort(); localOperation.current = null; setBusy(false); setLocalFile(null);
      setJob(previous => previous && { ...previous, status: 'cancelled', result_available: false }); return;
    }
    try {
      if (job) { await rpc('cancel_slicer_job', { p_job: job.id }); setJob({ ...job, status: 'cancelled' }); }
      if (storageKey.current) sessionStorage.removeItem(storageKey.current);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cancelar.'); }
  }
  async function applyResult(downloadOnly = false) {
    if (!job || !resultProfileAllowed) return;
    const current = operation.current;
    setBusy(true); setError('');
    try {
      const result = jobSource === 'local' ? localFile : await downloadSlicedFile(job);
      if (current !== operation.current) return;
      if (!result) throw new Error('O resultado local não está mais disponível. Fatie novamente.');
      if (downloadOnly) saveDownload(result, result.name);
      else { await onSliced(result, job); onOpenChange(false); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível receber o resultado.'); }
    finally { setBusy(false); }
  }
  async function connectWorker() {
    setBusy(true); setError('');
    try {
      const connection = await rpc<{ worker_id: string; worker_token: string }>('create_slicer_worker', { p_name: 'Fatiador local ' + new Date().toLocaleDateString('pt-BR') });
      saveDownload(new Blob([JSON.stringify({ api_origin: import.meta.env.VITE_SUPABASE_URL, public_key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, ...connection })], { type: 'application/json' }), 'forge-slicer-conexao.private.json');
      setConnectionSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar a conexão.'); }
    finally { setBusy(false); }
  }
  const selected = profiles?.profiles.find(p => p.id === profile), active = job && ['uploading', 'queued', 'running'].includes(job.status);
  return <Dialog open={open} onOpenChange={value => {
    if (!value && jobSource === 'local' && active) { ++operation.current; localOperation.current?.abort(); localOperation.current = null; setBusy(false); onOpenChange(false); }
    else if (!busy) onOpenChange(value);
  }}>
    <DialogContent closeDisabled={busy && !(jobSource === 'local' && Boolean(active))} className="max-w-xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Scissors className="h-5 w-5" />Simular impressão</DialogTitle>
        <DialogDescription>Fatie o arquivo aqui para calcular tempo e filamento por placa. O motor do Bambu Studio trabalha em segundo plano; você não precisa abrir o projeto nele.</DialogDescription></DialogHeader>
      <p className="break-words text-sm font-medium">{file?.name ?? 'Escolha um arquivo STL ou 3MF.'}</p>
      {detecting && <p role="status" className="text-sm text-muted-foreground">Verificando a extensão deste computador…</p>}
      {local && !useCloud && <div className="space-y-2"><p className="font-medium">Extensão local conectada</p>
        {localProfiles.length > 1 && <label className="block text-sm font-medium">Modelo de impressão<select aria-label="Modelo para fatiamento" value={selectedLocalProfile?.id ?? ''} onChange={event => { setLocalProfile(event.target.value); setJob(null); setLocalFile(null); setJobSource(null); setError(''); }} disabled={busy || Boolean(active)} className="mt-2 h-11 w-full rounded-md border bg-background px-3">{localProfiles.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
        {selectedLocalProfile ? <p className="text-sm text-muted-foreground">Bambu {selectedLocalProfile.label} · bico 0,4 mm · PLA · camada 0,20 mm · Bambu Studio {local.engine_version}</p>
          : eligibleProfiles.length === 0 ? <p role="status" className="text-sm">Aguardando um modelo cadastrado compatível para fatiar: A1 ou A2L.</p>
          : <p role="alert" className="text-sm">Atualize o conector local para usar o modelo selecionado. <a className="text-primary underline" href="/downloads/forge-slicer-extension.zip" download>Baixar atualização</a></p>}
        <p className="text-sm text-muted-foreground">O arquivo é processado neste computador, sem envio para a fila da empresa.</p></div>}
      {cloudEnabled && <><label className="space-y-2 text-sm font-medium">Perfil de impressão da empresa
        <select aria-label="Perfil de impressão" className="mt-2 h-11 w-full rounded-md border bg-background px-3" value={profile} onChange={e => { if (storageKey.current) sessionStorage.removeItem(storageKey.current); setProfile(e.target.value); setJob(null); setLocalFile(null); setJobSource(null); setError(''); }} disabled={Boolean(active) || busy}>
          {profiles?.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">Bambu Studio {selected?.engine_version ?? '02.08.02.61'} · {selected?.available ? 'Fatiador da empresa conectado' : 'Nenhum fatiador da empresa conectado'}</p></>}
      {file?.name.toLowerCase().endsWith('.3mf') && <p className="text-sm text-muted-foreground">Mantém as placas, cópias e cores do projeto 3MF. Neste perfil, todos os filamentos do arquivo precisam ser PLA; os materiais configurados no projeto são preservados.</p>}
      <p className="text-xs text-muted-foreground">A1 e A2L usam seus perfis oficiais. O projeto determina as trocas de cores e a torre; imprimir sem AMS exige placas preparadas para essa produção.</p>
      {cloudEnabled && !selected?.available && <p className="rounded-md bg-muted p-3 text-sm">A fila da empresa precisa de um computador conectado. Para usar a extensão deste Chrome, volte ao fatiamento neste computador.</p>}
      {!local && !detecting && !useCloud && <div role="status" className="space-y-2 rounded-md border p-3 text-sm"><p className="font-medium">O Forge não conseguiu se conectar à extensão deste Chrome.</p><p className="text-muted-foreground">Se o popup já mostra “Conectado”, recarregue a extensão em chrome://extensions e atualize esta página. A versão atual aceita elevare3d.com.br e elevare3d.lovable.app.</p><Button variant="outline" size="sm" disabled={busy || Boolean(active)} onClick={() => setDetectVersion(value => value + 1)}>Verificar extensão novamente</Button><details><summary className="cursor-pointer text-muted-foreground">Ainda não instalou?</summary><p className="my-2 text-muted-foreground">Instale a extensão e o conector local com o Bambu Studio oficial.</p><a className="font-medium text-primary underline" href="/downloads/forge-slicer-extension.zip" download>Baixar extensão para Chrome</a></details></div>}
      {job && <div className="space-y-2 rounded-lg border p-3" aria-live="polite">
        <p className="font-medium">{statusLabel[job.status]}</p>
        {active && <Progress aria-label="Progresso da simulação" value={job.status === 'uploading' ? progress : job.progress} />}
        {job.error && <p className="text-sm text-destructive">{job.error}</p>}
        {job.status === 'done' && job.stats && <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted-foreground">Tempo previsto</dt><dd className="font-semibold">{Math.floor(job.stats.time_seconds / 3600)}h {Math.floor(job.stats.time_seconds % 3600 / 60)}min {job.stats.time_seconds % 60}s</dd></div>
          <div><dt className="text-muted-foreground">Filamento previsto</dt><dd className="font-semibold">{job.stats.weight_grams.toLocaleString('pt-BR')} g</dd></div>
        </dl>}
      </div>}
      <p className="text-xs text-muted-foreground">Totais do fatiamento escolhido, contabilizando uma vez a purga e a torre que o motor informou. O consumo real e a baixa do estoque acontecem na produção.{jobSource !== 'local' && ' Os arquivos da fila ficam disponíveis por até 48 horas.'}</p>
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {active && <Button variant="outline" onClick={() => void cancel()}>Cancelar simulação</Button>}
        {job?.status === 'done' && job.result_available && resultProfileAllowed ? <>
          <Button variant="outline" disabled={busy} onClick={() => void applyResult(true)}><Download className="mr-2 h-4 w-4" />Baixar 3MF</Button>
          <Button disabled={busy} onClick={() => void applyResult()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{resultLabel}</Button>
        </> : !useCloud ? <Button disabled={detecting || !selectedLocalProfile || !file || busy || Boolean(active)} onClick={() => void simulateLocal()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fatiar neste computador</Button> : <Button disabled={detecting || !file || !selected?.available || busy || Boolean(job && ['queued', 'running'].includes(job.status))} onClick={() => void simulate()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{job?.status === 'uploading' ? 'Retomar envio' : 'Simular no Bambu Studio'}</Button>}
      </div>
      {!detecting && <Button type="button" variant="link" disabled={busy || Boolean(active)} className="h-auto p-0 text-xs" onClick={() => setUseCloud(value => !value)}>{useCloud ? 'Usar extensão deste computador' : 'Usar fatiador conectado à empresa'}</Button>}
      {cloudEnabled && profiles?.can_manage_workers && !selected?.available && <details className="border-t pt-3 text-sm">
        <summary className="cursor-pointer">Conectar um computador à fila da empresa</summary>
        <p className="my-2 text-muted-foreground">Gere o arquivo de conexão e use o instalador local do Forge no computador com o Bambu Studio oficial. A conexão acessa somente arquivos de simulação desta empresa.</p>
        <Button variant="outline" size="sm" onClick={() => void connectWorker()} disabled={busy || connectionSaved}>Gerar arquivo de conexão</Button>
        {connectionSaved && <p className="mt-2">Arquivo de conexão baixado. Guarde-o em local privado e remova a cópia baixada após instalar.</p>}
      </details>}
    </DialogContent>
  </Dialog>;
}
