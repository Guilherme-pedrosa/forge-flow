import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProductionPlatePlan } from './ProductionPlatePlan';
import type { ProductionPlate } from '@/lib/production-plates';

const mock = vi.hoisted(() => ({ readStatus: vi.fn() }));
vi.mock('@/lib/assembly', () => ({ readAssemblyStatus: mock.readStatus }));
const plate = { id: 'plate', product_id: 'product', source_id: null, plate_index: 1, label: 'Caule', units_per_plate: 10, material_id: null, printer_id: null, est_grams: 30, est_time_seconds: 600, est_cost_per_unit: 0.5, is_active: true } satisfies ProductionPlate;
function show(productId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ProductionPlatePlan plates={[plate]} quantity="20" productId={productId} /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { cleanup(); mock.readStatus.mockReset(); });

describe('Planejamento de placas com estoque físico', () => {
  it('shows a stock lookup failure instead of a legacy plan and can recover through retry', async () => {
    mock.readStatus.mockRejectedValueOnce(new Error('Falha ao consultar os componentes.'));
    mock.readStatus.mockResolvedValue({
      individual_stock: true,
      components: [{ id: 'stem', label: 'Caule verde', required: 20, available: 15, to_print: 5, runs: 1 }],
    });
    show('product');
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao consultar os componentes.');
    expect(screen.queryByText('Produção do conjunto completo')).not.toBeInTheDocument();
    expect(screen.queryByText(/2 impressão/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conferir estoque novamente' }));
    await screen.findByText('Caule verde');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/20 necessárias · 15 disponíveis · 5 a imprimir/)).toBeInTheDocument();
    expect(mock.readStatus).toHaveBeenCalledTimes(2);
  });

  it('waits for the physical stock before displaying a plan', () => {
    mock.readStatus.mockReturnValue(new Promise(() => {}));
    show('product');
    expect(screen.getByRole('status')).toHaveTextContent('Conferindo o estoque e a fila das peças');
    expect(screen.queryByText('Produção do conjunto completo')).not.toBeInTheDocument();
  });

  it('keeps plate-only legacy planning when no physical product is requested', () => {
    show();
    expect(screen.getByText('Produção do conjunto completo')).toBeInTheDocument();
    expect(screen.getByText(/2 impressão\(ões\) · capacidade de 10 peça/)).toBeInTheDocument();
    expect(mock.readStatus).not.toHaveBeenCalled();
  });
});
