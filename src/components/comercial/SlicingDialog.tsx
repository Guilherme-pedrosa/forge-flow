import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Scissors } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

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

export function SlicingDialog({ open, file, onOpenChange, onSliced }: Props) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<Profiles | null>(null), [profile, setProfile] = useState('');
  const [job, setJob] = useState<SlicingJob | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(''), [connectionSaved, setConnectionSaved] = useState(false);
  const operation = useRef(0), storageKey = useRef('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = () => rpc<Profiles>('slicer_profiles').then(data => { if (active) { setProfiles(data); setProfile(previous => previous || data.profiles[0]?.id || ''); } }).catch(e => { if (active) setError(e.message); });
    void refresh(); const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [open]);

  useEffect(() => {
    const current = ++operation.current; setJob(null); setError(''); setProgress(0); storageKey.current = '';
    if (!open || !file || !user) return;
    void file.arrayBuffer().then(fileSha256).then(async hash => {
      if (operation.current !== current) return;
      storageKey.current = `forge-slicing:${user.id}:${hash}`;
      const saved = sessionStorage.getItem(storageKey.current);
      if (!saved) return;
      try {
        const previous = await rpc<SlicingJob>('slicer_job', { p_job: JSON.parse(saved).job_id });
        if (operation.current === current && previous.source_sha256 === hash) setJob(previous);
      } catch { sessionStorage.removeItem(storageKey.current); }
    }).catch(() => { if (operation.current === current) setError('Não foi possível ler este arquivo.'); });
  }, [open, file, user]);

  useEffect(() => {
    if (!open || !job || !['queued', 'running'].includes(job.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void rpc<SlicingJob>('slicer_job', { p_job: job.id }).then(next => { if (active) { setJob(next); setError(''); } }).catch(e => { if (active) setError(e.message); });
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [open, job?.id, job?.status]);

  async function simulate() {
    if (!file || !user || !profile) return;
    setBusy(true); setError(''); const current = ++operation.current;
    try {
      if (!/\.(stl|3mf)$/i.test(file.name) || !file.size || file.size > MAX_FILE_BYTES) throw new Error('Escolha um STL ou 3MF de até 64 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer()), hash = await fileSha256(bytes.buffer);
      storageKey.current = `forge-slicing:${user.id}:${hash}`;
      const existing = sessionStorage.getItem(storageKey.current), saved = existing && !['done', 'failed', 'cancelled'].includes(job?.status ?? '') ? JSON.parse(existing) : {};
      const request = saved.request_id ?? crypto.randomUUID();
      sessionStorage.setItem(storageKey.current, JSON.stringify({ request_id: request, job_id: saved.job_id }));
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
    try {
      if (job) { await rpc('cancel_slicer_job', { p_job: job.id }); setJob({ ...job, status: 'cancelled' }); }
      if (storageKey.current) sessionStorage.removeItem(storageKey.current);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cancelar.'); }
  }
  async function useResult(downloadOnly = false) {
    if (!job) return;
    setBusy(true); setError('');
    try {
      const result = await downloadSlicedFile(job);
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
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent closeDisabled={busy} className="max-w-xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Scissors className="h-5 w-5" />Simular impressão</DialogTitle>
        <DialogDescription>O Bambu Studio local fatia o arquivo para calcular tempo e filamento por placa.</DialogDescription></DialogHeader>
      <p className="break-words text-sm font-medium">{file?.name ?? 'Escolha um arquivo STL ou 3MF.'}</p>
      <label className="space-y-2 text-sm font-medium">Perfil de impressão
        <select aria-label="Perfil de impressão" className="mt-2 h-11 w-full rounded-md border bg-background px-3" value={profile} onChange={e => setProfile(e.target.value)} disabled={Boolean(active) || busy}>
          {profiles?.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">Bambu Studio {selected?.engine_version ?? '2.8.2.61'} · {selected?.available ? 'Fatiador conectado' : 'Fatiador local desconectado'}</p>
      {file?.name.toLowerCase().endsWith('.3mf') && <p className="text-sm text-muted-foreground">Mantém as placas, cópias e cores do projeto 3MF. Neste perfil, todos os filamentos do arquivo precisam ser PLA; os materiais configurados no projeto são preservados.</p>}
      {!selected?.available && <p className="rounded-md bg-muted p-3 text-sm">Deixe o computador com o fatiador conectado ligado para processar a simulação.</p>}
      {job && <div className="space-y-2 rounded-lg border p-3" aria-live="polite">
        <p className="font-medium">{statusLabel[job.status]}</p>
        {active && <Progress aria-label="Progresso da simulação" value={job.status === 'uploading' ? progress : job.progress} />}
        {job.error && <p className="text-sm text-destructive">{job.error}</p>}
        {job.status === 'done' && job.stats && <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted-foreground">Tempo previsto</dt><dd className="font-semibold">{Math.floor(job.stats.time_seconds / 3600)}h {Math.floor(job.stats.time_seconds % 3600 / 60)}min {job.stats.time_seconds % 60}s</dd></div>
          <div><dt className="text-muted-foreground">Filamento previsto</dt><dd className="font-semibold">{job.stats.weight_grams.toLocaleString('pt-BR')} g</dd></div>
        </dl>}
      </div>}
      <p className="text-xs text-muted-foreground">São estimativas do perfil escolhido. O consumo real e a baixa do estoque acontecem na produção. Os arquivos ficam disponíveis por até 48 horas.</p>
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {active && <Button variant="outline" onClick={() => void cancel()}>Cancelar simulação</Button>}
        {job?.status === 'done' && job.result_available ? <>
          <Button variant="outline" disabled={busy} onClick={() => void useResult(true)}><Download className="mr-2 h-4 w-4" />Baixar 3MF</Button>
          <Button disabled={busy} onClick={() => void useResult()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Usar no cadastro</Button>
        </> : <Button disabled={!file || !selected?.available || busy || Boolean(job && ['queued', 'running'].includes(job.status))} onClick={() => void simulate()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{job?.status === 'uploading' ? 'Retomar envio' : 'Simular no Bambu Studio'}</Button>}
      </div>
      {profiles?.can_manage_workers && !selected?.available && <details className="border-t pt-3 text-sm">
        <summary className="cursor-pointer">Conectar um fatiador local</summary>
        <p className="my-2 text-muted-foreground">Gere o arquivo de conexão e use o instalador local do Forge no computador com o Bambu Studio oficial. A conexão acessa somente arquivos de simulação desta empresa.</p>
        <Button variant="outline" size="sm" onClick={() => void connectWorker()} disabled={busy || connectionSaved}>Gerar arquivo de conexão</Button>
        {connectionSaved && <p className="mt-2">Arquivo de conexão baixado. Guarde-o em local privado e remova a cópia baixada após instalar.</p>}
      </details>}
    </DialogContent>
  </Dialog>;
}
