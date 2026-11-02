import { webcrypto } from 'node:crypto';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlicingDialog, downloadSlicedFile, encodeSlicingChunk, fileSha256, type SlicingJob } from './SlicingDialog';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), detect: vi.fn(), slice: vi.fn(), user: { id: 'owner-test' } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/lib/local-slicer-extension', () => ({ detectLocalSlicer: mocks.detect, sliceWithLocalExtension: mocks.slice, LOCAL_SLICER_PROFILE_ID: 'bambu-a1-04-pla-020-v1' }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange: (open: boolean) => void }) => open ? <div>{children}<button onClick={() => onOpenChange(false)}>Fechar simulador</button></div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
const profile = { id: 'bambu-a1-04-pla-020-v1', name: 'Bambu A1 · PLA · 0,20 mm', engine_version: '02.08.02.61', available: true };
const bytes = new Uint8Array([80, 75, 3, 4, 42]);
function sourceFile() {
  const file = new File([bytes], 'part.stl');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) }); return file;
}
const baseJob: SlicingJob = { id: 'job-id', file_name: 'part.stl', status: 'done', source_size: bytes.length, source_sha256: 'a'.repeat(64), profile_id: profile.id, progress: 100, result_available: true, result_size: bytes.length, result_chunks: 1 };
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); sessionStorage.clear(); mocks.rpc.mockReset();
  mocks.detect.mockReset().mockResolvedValue(null); mocks.slice.mockReset();
});
afterEach(cleanup);
describe('SlicingDialog private simulation transfer', () => {
  it('prioritizes the installed extension without automatic slicing or any cloud request', async () => {
    const result = sourceFile(), sliced = vi.fn(), changed = vi.fn();
    mocks.detect.mockResolvedValue({ profile_id: profile.id, engine_version: profile.engine_version });
    mocks.slice.mockResolvedValue({ file: result, stats: { time_seconds: 3600, weight_grams: 25, engine: 'Bambu Studio', engine_version: profile.engine_version, normalizations: [] } });
    render(<SlicingDialog open file={sourceFile()} onOpenChange={changed} onSliced={sliced} />);
    const start = await screen.findByRole('button', { name: 'Fatiar neste computador' });
    expect(start).toBeEnabled(); expect(mocks.slice).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.getByText(/A2L e outros modelos precisam de um perfil compatível/)).toBeVisible();
    fireEvent.click(start);
    expect(await screen.findByText('Simulação concluída')).toBeInTheDocument();
    expect(mocks.slice).toHaveBeenCalledExactlyOnceWith(expect.any(File), expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));
    expect(mocks.rpc).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Usar no cadastro' }));
    await waitFor(() => expect(sliced).toHaveBeenCalledWith(result, expect.objectContaining({ id: expect.stringMatching(/^local:/), status: 'done', source_size: bytes.length, profile_id: profile.id, result_available: true, stats: expect.objectContaining({ time_seconds: 3600, weight_grams: 25 }) })));
    expect(changed).toHaveBeenCalledWith(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('allows cancelling an active local operation and closing aborts the native connection', async () => {
    mocks.detect.mockResolvedValue({ profile_id: profile.id, engine_version: profile.engine_version });
    mocks.slice.mockImplementation((_file, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')))));
    const changed = vi.fn();
    render(<SlicingDialog open file={sourceFile()} onOpenChange={changed} onSliced={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fatiar neste computador' }));
    await waitFor(() => expect(mocks.slice).toHaveBeenCalledTimes(1));
    const firstSignal = mocks.slice.mock.calls[0][1].signal;
    expect(screen.getByRole('button', { name: 'Cancelar simulação' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar simulação' }));
    expect(firstSignal.aborted).toBe(true); expect(await screen.findByText('Simulação cancelada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fatiar neste computador' }));
    await waitFor(() => expect(mocks.slice).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar simulador' }));
    expect(mocks.slice.mock.calls[1][1].signal.aborted).toBe(true); expect(changed).toHaveBeenCalledWith(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('aborts a local operation on unmount and shows disconnect errors without using cloud upload', async () => {
    mocks.detect.mockResolvedValue({ profile_id: profile.id, engine_version: profile.engine_version });
    mocks.slice.mockRejectedValueOnce(new Error('Fatiador desconectado'));
    const view = render(<SlicingDialog open file={sourceFile()} onOpenChange={vi.fn()} onSliced={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fatiar neste computador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fatiador desconectado');
    mocks.slice.mockImplementation((_file, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')))));
    fireEvent.click(screen.getByRole('button', { name: 'Fatiar neste computador' }));
    await waitFor(() => expect(mocks.slice).toHaveBeenCalledTimes(2));
    const signal = mocks.slice.mock.calls[1][1].signal; view.unmount(); expect(signal.aborted).toBe(true);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('keeps the company worker available as an explicit fallback after local detection', async () => {
    mocks.detect.mockResolvedValue({ profile_id: profile.id, engine_version: profile.engine_version });
    mocks.rpc.mockResolvedValue({ data: { can_manage_workers: false, profiles: [profile] }, error: null });
    render(<SlicingDialog open file={sourceFile()} onOpenChange={vi.fn()} onSliced={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Usar fatiador conectado à empresa' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simular no Bambu Studio' })).toBeEnabled());
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['slicer_profiles']);
    expect(mocks.slice).not.toHaveBeenCalled();
  });
  it('rejects an oversized local file before reading it into memory', async () => {
    mocks.detect.mockResolvedValue({ profile_id: profile.id, engine_version: profile.engine_version });
    const oversized = new File([], 'grande.3mf'), read = vi.fn();
    Object.defineProperty(oversized, 'size', { value: 67108865 }); Object.defineProperty(oversized, 'arrayBuffer', { value: read });
    render(<SlicingDialog open file={oversized} onOpenChange={vi.fn()} onSliced={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fatiar neste computador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('até 64 MB'); expect(read).not.toHaveBeenCalled();
    expect(mocks.slice).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires a connected real profile and never offers geometric estimates', async () => {
    mocks.rpc.mockResolvedValue({ data: { can_manage_workers: false, profiles: [{ ...profile, available: false }] }, error: null });
    render(<SlicingDialog open file={sourceFile()} onOpenChange={vi.fn()} onSliced={vi.fn()} />);
    expect(await screen.findByText('Bambu Studio 02.08.02.61 · Fatiador local desconectado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simular no Bambu Studio' })).toBeDisabled();
    expect(screen.queryByText('Filamento previsto')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar extensão para Chrome' })).toHaveAttribute('href', '/downloads/forge-slicer-extension.zip');
  });
  it('queues only after source chunks are uploaded, with a SHA for the original file', async () => {
    const queued = { ...baseJob, status: 'queued', result_available: false };
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'slicer_profiles') return { data: { can_manage_workers: false, profiles: [profile] }, error: null };
      if (name === 'start_slicer_upload') return { data: { ...queued, status: 'uploading', source_sha256: args.p_sha256 }, error: null };
      return { data: name === 'finish_slicer_upload' ? queued : null, error: null };
    });
    render(<SlicingDialog open file={sourceFile()} onOpenChange={vi.fn()} onSliced={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simular no Bambu Studio' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Simular no Bambu Studio' }));
    expect(await screen.findByText('Aguardando o fatiador local')).toBeInTheDocument();
    const names = mocks.rpc.mock.calls.map(call => call[0]);
    expect(names.indexOf('upload_slicer_chunk')).toBeLessThan(names.indexOf('finish_slicer_upload'));
    const upload = mocks.rpc.mock.calls.find(call => call[0] === 'start_slicer_upload')?.[1];
    expect(upload.p_sha256).toBe(await fileSha256(bytes.buffer));
    expect(upload.p_size).toBe(bytes.length);
  });
  it('verifies the downloaded 3MF hash separately from its source hash', async () => {
    const resultHash = await fileSha256(bytes.buffer), read = vi.fn().mockResolvedValue(encodeSlicingChunk(bytes));
    const file = await downloadSlicedFile({ ...baseJob, result_sha256: resultHash }, read);
    expect(file.name).toBe('part-simulado.3mf'); expect(file.size).toBe(bytes.length); expect(read).toHaveBeenCalledWith(0);
    await expect(downloadSlicedFile({ ...baseJob, result_sha256: 'b'.repeat(64) }, read)).rejects.toThrow('hash');
    await expect(downloadSlicedFile({ ...baseJob, result_sha256: resultHash }, async () => 'AA==')).rejects.toThrow('incompleta');
  });
  it('bounds each encoded chunk at 512 KiB and rejects oversize chunks', () => {
    expect(encodeSlicingChunk(new Uint8Array(393216)).length).toBe(524288);
    expect(() => encodeSlicingChunk(new Uint8Array(393217))).toThrow('Bloco inválido');
  });
});
