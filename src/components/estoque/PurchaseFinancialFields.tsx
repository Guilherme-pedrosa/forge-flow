import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { allRows } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchableItemSelect } from '@/components/shared/SearchableItemSelect';
import { FinancialCatalogDialog, type CatalogKind } from '@/components/shared/FinancialCatalogDialog';

export type PurchaseClassification = { paymentMethodId: string; accountId: string; costCenterId: string };
export const blankPurchaseClassification = (): PurchaseClassification => ({ paymentMethodId: '', accountId: '', costCenterId: '' });
type Option = { id: string; name: string; code?: string; type?: string; account_type?: string };
export type PurchasePaymentMethod = Pick<Option,'id'|'name'|'type'>;
export function PurchaseFinancialFields({ value, onChange, disabled = false, onBusyChange, onMethodsLoaded }: {
  value: PurchaseClassification; onChange: (value: PurchaseClassification) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
  onMethodsLoaded?: (methods:PurchasePaymentMethod[])=>void;
}) {
  const { profile } = useAuth();
  const [creating, setCreating] = useState<CatalogKind | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['financial_options', profile?.tenant_id, 'purchase'], enabled: !!profile,
    queryFn: async () => {
      const tenant = profile!.tenant_id;
      const results = await Promise.allSettled([
        allRows<Option>((from,to) => supabase.from('payment_methods').select('id,name,type').eq('tenant_id',tenant).eq('is_active',true).order('name').order('id').range(from,to)),
        allRows<Option>((from,to) => supabase.from('chart_of_accounts').select('id,code,name,account_type').eq('tenant_id',tenant).eq('is_active',true).order('code').order('id').range(from,to)),
        allRows<Option>((from,to) => supabase.from('cost_centers').select('id,code,name').eq('tenant_id',tenant).eq('is_active',true).order('code').order('id').range(from,to)),
      ]);
      const rows = results.map(result => { if(result.status === 'rejected') throw result.reason; return result.value; });
      return { methods: rows[0], accounts: rows[1].filter(row => row.account_type !== 'revenue'), centers: rows[2] };
    },
  });
  useEffect(() => { onBusyChange?.(!!creating); return () => onBusyChange?.(false); }, [creating,onBusyChange]);
  useEffect(() => { if(data)onMethodsLoaded?.(data.methods); },[data,onMethodsLoaded]);
  const fields = [
    { kind:'payment_method' as const, key:'paymentMethodId' as const, label:'Forma de pagamento', options:data?.methods },
    { kind:'account' as const, key:'accountId' as const, label:'Plano de contas', options:data?.accounts },
    { kind:'cost_center' as const, key:'costCenterId' as const, label:'Centro de custo', options:data?.centers },
  ];
  return <section className="space-y-3" aria-label="Classificação do pagamento"><div className="grid gap-4 sm:grid-cols-3">{fields.map(field => <div className="min-w-0 space-y-2" key={field.key}>
    <div className="flex flex-wrap items-center justify-between gap-2"><Label>{field.label}</Label><Button type="button" variant="link" className="h-auto p-0 text-xs" disabled={disabled || !!creating} onClick={() => setCreating(field.kind)}>Cadastrar {field.label.toLocaleLowerCase('pt-BR')}</Button></div>
    <SearchableItemSelect label={field.label} value={value[field.key]} emptyLabel="Selecionar" disabled={disabled || isLoading || !!error || !!creating} options={(field.options ?? []).map(option => ({id:option.id,label:[option.code,option.name].filter(Boolean).join(' · ')}))} onChange={id => onChange({...value,[field.key]:id})}/>
  </div>)}</div>{isLoading && <p role="status" className="text-sm text-muted-foreground">Carregando os cadastros financeiros…</p>}{error && <p role="alert" className="text-sm text-destructive">Não foi possível carregar as opções financeiras. <Button type="button" variant="link" onClick={() => void refetch()}>Tentar novamente</Button></p>}
    {creating && <FinancialCatalogDialog key={`${profile?.tenant_id}:${creating}`} kind={creating} defaultType={creating === 'account' ? 'expense' : undefined} onClose={() => setCreating(null)} onSaved={id => { const field = fields.find(field => field.kind === creating)!; onChange({...value,[field.key]:id}); }}/>}</section>;
}
