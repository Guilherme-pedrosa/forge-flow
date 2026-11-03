import {webcrypto} from 'node:crypto';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MarketplaceAutomationSettings} from './MarketplaceAutomationSettings';
const mock=vi.hoisted(()=>({rpc:vi.fn(),source:vi.fn(),binding:vi.fn(),tenant:'company-a',user:'owner-a'}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({profile:{tenant_id:mock.tenant},user:{id:mock.user}})}));
vi.mock('@/lib/marketplace-orders',()=>({marketplaceRpc:mock.rpc}));
vi.mock('@/lib/mercado-livre-integration',()=>({integrationErrorMessage:(error:unknown)=>error instanceof Error?error.message:'Falha na operação.',readIntegradorBridgeBinding:mock.binding,requestIntegradorWorkspace:mock.source}));
const values={orders_auto:false,stock_auto:false,price_auto:false,safety_stock:0,listing_type_default:'gold_special' as const,interval_minutes:15 as const};
const snapshot=(change:Record<string,unknown>={})=>({policy:{...values,configured:true,revision:'policy-r1',...change},status:{last_success_at:null,last_run_at:null,next_run_at:null,last_error:null as string|null,pending_jobs:0,running_jobs:0,failed_jobs:0,needs_review_actions:[] as ('orders'|'stock'|'price')[]}});
let current= snapshot();
beforeEach(()=>{mock.tenant='company-a';mock.user='owner-a';current=snapshot();mock.binding.mockReset().mockResolvedValue({configured:true,enabled:true,bridge_id:'bridge-a',approved_seller_ids:['3694120570'],account_mappings:[{account_id:'account-a',bridge_id:'bridge-a',source_seller_id:'3694120570'}]});mock.source.mockReset().mockResolvedValue({queued:1,status:{...snapshot().status,needs_review_actions:[]}});vi.stubGlobal('crypto',webcrypto);mock.rpc.mockReset().mockImplementation(async(name,args)=>{
 if(name==='read_marketplace_automation')return structuredClone(current);
 if(name==='save_marketplace_automation'){current=snapshot({...args.p_values,revision:'policy-r2'});return structuredClone(current);}
 if(name==='request_marketplace_automation_sync')return{queued:1,status:{...current.status,pending_jobs:1}};
 throw new Error('Unexpected RPC '+name);
});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});const ui=()=> <QueryClientProvider client={client}><MarketplaceAutomationSettings accountId="account-a" /></QueryClientProvider>;const view=render(ui());return{...view,client,rerenderScope:()=>view.rerender(ui())};}
const stock=()=>screen.getByRole('checkbox',{name:/Atualizar o estoque dos anúncios/});
const save=()=>screen.getByRole('button',{name:'Salvar funcionamento'});
const run=()=>screen.getByRole('button',{name:'Executar rotinas ativas agora'});
describe('Forge company marketplace automation',()=>{
 it('starts off and only queues saved, explicitly enabled routines with canonical company options',async()=>{
  mount();await screen.findByRole('checkbox',{name:/Atualizar o estoque/});expect(stock()).not.toBeChecked();expect(run()).toBeDisabled();expect(mock.rpc).toHaveBeenCalledTimes(1);
  fireEvent.click(stock());fireEvent.change(screen.getByLabelText('Reserva de segurança (un.)'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Tipo de anúncio padrão'),{target:{value:'gold_pro'}});fireEvent.change(screen.getByLabelText('Verificar a cada'),{target:{value:'5'}});
  expect(run()).toBeDisabled();fireEvent.click(save());await screen.findByText('Funcionamento salvo para esta conta.');
  const command=mock.rpc.mock.calls.find(([name])=>name==='save_marketplace_automation');expect(command).toEqual(['save_marketplace_automation',{p_account_id:'account-a',p_values:{...values,stock_auto:true,safety_stock:2,listing_type_default:'gold_pro',interval_minutes:5},p_expected_revision:'policy-r1',p_request_id:expect.any(String)}]);
  expect(mock.rpc.mock.calls.some(([name])=>name==='request_marketplace_automation_sync')).toBe(false);fireEvent.click(run());await screen.findByText('1 rotina(s) na fila.');expect(mock.rpc.mock.calls.filter(([name])=>name==='request_marketplace_automation_sync')).toHaveLength(1);
 });
 it('does not run the old saved on-policy while the visible draft disables it or has an unknown reserve',async()=>{
  current=snapshot({stock_auto:true});mount();await waitFor(()=>expect(run()).toBeEnabled());fireEvent.click(stock());expect(stock()).not.toBeChecked();expect(run()).toBeDisabled();expect(screen.getByText(/Salve o funcionamento antes/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Reserva de segurança (un.)'),{target:{value:''}});expect(save()).toBeDisabled();expect(screen.getByRole('alert')).toHaveTextContent('Digite 0');fireEvent.change(screen.getByLabelText('Reserva de segurança (un.)'),{target:{value:'0'}});expect(save()).toBeEnabled();
  expect(mock.rpc.mock.calls.filter(([name])=>name!=='read_marketplace_automation')).toHaveLength(0);
 });
 it('keeps a failed save draft and its exact idempotency key, and blocks stale revisions until reload',async()=>{
  const implementation=mock.rpc.getMockImplementation()!;let failed=false;mock.rpc.mockImplementation(async(name,args)=>{if(name==='save_marketplace_automation'&&!failed){failed=true;throw new Error('Resposta perdida');}return implementation(name,args);});
  const view=mount();await screen.findByRole('checkbox',{name:/Atualizar o estoque/});fireEvent.click(stock());fireEvent.click(save());await screen.findByText('Resposta perdida');expect(stock()).toBeChecked();const first=mock.rpc.mock.calls.find(([name])=>name==='save_marketplace_automation');fireEvent.click(save());await screen.findByText('Funcionamento salvo para esta conta.');expect(mock.rpc.mock.calls.filter(([name])=>name==='save_marketplace_automation')[1]).toEqual(first);
  act(()=>view.client.setQueryData(['marketplace_automation','company-a','owner-a','account-a'],snapshot({revision:'policy-r3',stock_auto:false})));await screen.findByText(/A configuração mudou em outra sessão/);expect(save()).toBeDisabled();expect(run()).toBeDisabled();
  current=snapshot({revision:'policy-r3',stock_auto:false});fireEvent.click(screen.getByRole('button',{name:'Recarregar configuração'}));await waitFor(()=>expect(stock()).not.toBeChecked());expect(save()).toBeEnabled();
 });
 it('retries a lost enqueue response with the same command instead of duplicating jobs',async()=>{
  current=snapshot({orders_auto:true});const implementation=mock.rpc.getMockImplementation()!;let failed=false;mock.rpc.mockImplementation(async(name,args)=>{if(name==='request_marketplace_automation_sync'&&!failed){failed=true;throw new Error('Resposta da fila perdida');}return implementation(name,args);});
  mount();await waitFor(()=>expect(run()).toBeEnabled());fireEvent.click(run());await screen.findByText('Resposta da fila perdida');const first=mock.rpc.mock.calls.find(([name])=>name==='request_marketplace_automation_sync');fireEvent.click(run());await screen.findByText('1 rotina(s) na fila.');expect(mock.rpc.mock.calls.filter(([name])=>name==='request_marketplace_automation_sync')[1]).toEqual(first);
 });
 it('ignores a late previous-company save completion and preserves both scoped caches',async()=>{
  let finish!:(value:ReturnType<typeof snapshot>)=>void;const implementation=mock.rpc.getMockImplementation()!;mock.rpc.mockImplementation((name,args)=>name==='save_marketplace_automation'?new Promise(resolve=>{finish=resolve;}):implementation(name,args));
  const view=mount();await screen.findByRole('checkbox',{name:/Atualizar o estoque/});fireEvent.click(stock());fireEvent.click(save());await waitFor(()=>expect(finish).toBeTypeOf('function'));
  mock.tenant='company-b';mock.user='owner-b';view.rerenderScope();await waitFor(()=>expect(stock()).not.toBeChecked());await act(async()=>finish(snapshot({stock_auto:true,revision:'late-old-r2'})));
  expect(stock()).not.toBeChecked();expect(screen.queryByText('Funcionamento salvo para esta conta.')).not.toBeInTheDocument();expect(view.client.getQueryData(['marketplace_automation','company-a','owner-a','account-a'])).toEqual(snapshot());expect(view.client.getQueryData(['marketplace_automation','company-b','owner-b','account-a'])).toEqual(snapshot());
 });
 it('recovers uncertainty only through the authenticated Source lease and preserves the same review command while busy',async()=>{
  current={...snapshot({stock_auto:true}),status:{...snapshot().status,last_error:'Envio incerto.',needs_review_actions:['stock']}} as typeof current;
  mock.source.mockRejectedValueOnce(new Error('A execução anterior ainda está em andamento. Aguarde.'));
  mount();const button=await screen.findByRole('button',{name:'Conferi no canal; recalcular próxima execução'});expect(mock.source).not.toHaveBeenCalled();fireEvent.click(button);await screen.findByText(/A execução anterior ainda está em andamento/);
  const first=mock.source.mock.calls[0];expect(first[1]).toBe('automation_review');expect(first[2]).toBe('3694120570');expect(first[3]).toEqual({account_id:'account-a',automation_action:'stock',request_id:expect.any(String),acknowledge_marketplace_write:true});expect(first[4]).toEqual({userId:'owner-a'});
  fireEvent.click(button);await screen.findByText('Conferência registrada. 1 nova(s) rotina(s) para recalcular.');expect(mock.source.mock.calls[1]).toEqual(first);expect(screen.queryByRole('button',{name:'Conferi no canal; recalcular próxima execução'})).not.toBeInTheDocument();expect(mock.rpc.mock.calls.some(([name])=>name==='review_marketplace_automation')).toBe(false);
 });
});
