import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockProductionForm } from './StockProductionForm';

type Product = { id: string; tenant_id: string; name: string; sku: string; is_active: boolean; is_component: boolean; category: string };
const mock = vi.hoisted(() => ({ products: [] as Product[], rpc: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { tenant_id: 'tenant' } }) }));
vi.mock('@/components/shared/SearchableItemSelect', () => ({ SearchableItemSelect: ({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}><option value="">Selecione</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mock.rpc,
    from: () => {
      let rows = [...mock.products];
      const query = {
        select: () => query,
        eq: (key: keyof Product, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
        filter: (key: keyof Product, operator: string, value: unknown) => { if (operator === 'eq') rows = rows.filter(row => row[key] === value); return query; },
        neq: (key: keyof Product, value: unknown) => { rows = rows.filter(row => row[key] !== value); return query; },
        order: () => query,
        range: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return query;
    },
  },
}));
beforeEach(() => {
  cleanup();
  mock.products = [
    { id: 'finished', tenant_id: 'tenant', name: 'Maçã completa', sku: 'MACA', is_active: true, is_component: false, category: 'printed_part' },
    { id: 'leaf', tenant_id: 'tenant', name: 'Folha avulsa', sku: 'FOLHA', is_active: true, is_component: true, category: 'printed_part' },
    { id: 'service', tenant_id: 'tenant', name: 'Serviço de modelagem', sku: 'MODEL', is_active: true, is_component: false, category: 'service' },
  ];
  mock.rpc.mockReset().mockResolvedValue({ data: 'new-order', error: null });
});

describe('Produção para estoque de produtos finais', () => {
  it('offers finished products and creates their production without mixing in loose components or services', async () => {
    const created = vi.fn();
    const busy = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><StockProductionForm onCreated={created} onBusy={busy} /></QueryClientProvider>);
    await screen.findByRole('option', { name: 'Maçã completa' });
    expect(screen.queryByRole('option', { name: 'Folha avulsa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Serviço de modelagem' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Produto para estoque 1' }), { target: { value: 'finished' } });
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar produção para estoque' }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith('request_stock_production', expect.objectContaining({ p_items: [{ product_id: 'finished', quantity: 5 }] })));
    expect(created.mock.calls[0]?.[0]).toBe('new-order');
    expect(busy).toHaveBeenCalledWith(true);
  });
});
