import { webcrypto } from 'node:crypto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlicingDialog, downloadSlicedFile, encodeSlicingChunk, fileSha256, type SlicingJob } from './SlicingDialog';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: { id: 'owner-test' } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
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
});
describe('SlicingDialog private simulation transfer', () => {
  it('requires a connected real profile and never offers geometric estimates', async () => {
    mocks.rpc.mockResolvedValue({ data: { can_manage_workers: false, profiles: [{ ...profile, available: false }] }, error: null });
    render(<SlicingDialog open file={sourceFile()} onOpenChange={vi.fn()} onSliced={vi.fn()} />);
    expect(await screen.findByText('Bambu Studio 02.08.02.61 · Fatiador local desconectado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simular no Bambu Studio' })).toBeDisabled();
    expect(screen.queryByText('Filamento previsto')).not.toBeInTheDocument();
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
