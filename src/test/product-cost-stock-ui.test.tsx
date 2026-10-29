import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Produtos from '@/pages/comercial/Produtos';
const mock=vi.hoisted(()=>({rpc:vi.fn(),toast:vi.fn(),existing:false,automatic:false,recipeCost:999 as number|null}));
const product={id:'product',tenant_id:'tenant',name:'Produto com receita',category:'printed_part',is_active:true,cost_estimate:999,manual_cost_override:10,sale_price:25,prints_per_plate:1,num_colors:1,extras:[],stock_item_id:'stock',stock:{id:'stock',current_stock:20,unit:'un',min_stock:2,avg_cost:10}};
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({profile:{tenant_id:'tenant',user_id:'user'}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,order:()=>query,range:()=>query,single:()=>query,is:()=>query,in:()=>query,
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='products'&&mock.existing?[{...product,...(mock.automatic?{manual_cost_override:null,catalog_details:{cost_source:'composition',price_source:'markup',markup_percent:50,base_cost:8,accessory_cost:0,other_cost:0}}:{})}]:table==='tenants'?{settings:{}}:[],error:null}).then(resolve)};return query;
}}}));
vi.mock('@/pages/comercial/ProductPrintSources',()=>({default:()=>null}));
vi.mock('@/pages/comercial/ProductMaterialRecipe',()=>({default:()=>null}));
beforeEach(()=>{mock.existing=false;mock.automatic=false;mock.recipeCost=999;mock.rpc.mockReset();mock.toast.mockReset();mock.rpc.mockImplementation(async(name:string)=>({data:name==='product_material_recipe_catalog'?[{id:'product',configured:true,complete:mock.recipeCost!=null,cost_per_unit:mock.recipeCost,revision:`recipe-${mock.recipeCost}`,missing:['Revise os materiais.'],plate_count:2}]:'saved',error:null}));});
afterEach(cleanup);
function LocationProof(){const location=useLocation();return <div data-testid="location">{location.pathname}{location.search}</div>;}
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><MemoryRouter><Produtos/><LocationProof/></MemoryRouter></QueryClientProvider>);return client;}
describe('Cadastro real de produto com custo e estoque',()=>{
 it('salva custo em reais com vírgula, venda e estoque no mesmo pedido sem receita',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Novo Produto'}));
  fireEvent.change(screen.getByLabelText('Nome *'),{target:{value:'Produto completo'}});
  fireEvent.change(screen.getByLabelText('Preço de custo (R$)'),{target:{value:'12,50'}});
  fireEvent.change(screen.getByLabelText('Preço unitário (R$)'),{target:{value:'25,00'}});
  fireEvent.change(screen.getByLabelText('Estoque inicial'),{target:{value:'20'}});
  fireEvent.click(screen.getByRole('button',{name:'Criar'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('save_product_with_photos',expect.objectContaining({p_product:expect.objectContaining({name:'Produto completo',manual_cost:12.5,cost_estimate:12.5,sale_price:25,stock:expect.objectContaining({current_stock:20,avg_cost:12.5,unit:'un'})})})));
 });
 it('permite mudar custo e saldo mesmo com composição configurada, sem sobrescrever pelo cálculo',async()=>{
  mock.existing=true;mount();fireEvent.click(await screen.findByRole('button',{name:'Editar Produto com receita'}));
  const cost=screen.getByLabelText('Preço de custo (R$)');expect(cost).toBeEnabled();expect(cost).toHaveValue('10');
  fireEvent.change(cost,{target:{value:'15,75'}});fireEvent.change(screen.getByLabelText('Quantidade em estoque'),{target:{value:'24'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Salvar'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('save_product_with_photos',expect.objectContaining({p_product_id:'product',p_product:expect.objectContaining({manual_cost:15.75,stock:expect.objectContaining({current_stock:24,expected_stock:20,avg_cost:15.75})})})));
 });
 it('confere e calcula o preço no cadastro sem salvar nem mudar de tela',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Novo Produto'}));
  fireEvent.change(screen.getByLabelText('Nome *'),{target:{value:'Produto para precificar'}});
  fireEvent.click(screen.getByRole('button',{name:'Conferir preço'}));
  expect(screen.getByRole('tab',{name:'Valores'})).toHaveAttribute('data-state','active');
  expect(mock.rpc.mock.calls.filter(([name])=>name==='save_product_with_photos')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Preço de custo (R$)'),{target:{value:'12,50'}});
  fireEvent.change(screen.getByLabelText('Lucro sobre o custo (%)'),{target:{value:'50'}});
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('18.75');
  fireEvent.change(screen.getByLabelText('Despesas acessórias (R$)'),{target:{value:'2,50'}});
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('22.50');
  fireEvent.click(screen.getByRole('button',{name:'Criar'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('save_product_with_photos',expect.objectContaining({p_product:expect.objectContaining({cost_estimate:15,sale_price:22.5,catalog_pricing:expect.objectContaining({cost_source:'manual',price_source:'markup',markup_percent:50})})})));
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
 });
 it('usa a composição vigente e recupera o percentual salvo sem copiar valores',async()=>{
  mock.existing=true;mock.automatic=true;mock.recipeCost=12;
  mount();fireEvent.click(await screen.findByRole('button',{name:'Editar Produto com receita'}));
  expect(screen.getByLabelText('Preço de custo (R$)')).toHaveValue('12');
  expect(screen.getByLabelText('Lucro sobre o custo (%)')).toHaveValue('50');
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('18.00');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Salvar'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('save_product_with_photos',expect.objectContaining({p_product:expect.objectContaining({sale_price:18,catalog_pricing:expect.objectContaining({cost_source:'composition',expected_composition_revision:'recipe-12'})})})));
 });
 it('preserva preço digitado manualmente quando os custos mudam',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Novo Produto'}));
  fireEvent.change(screen.getByLabelText('Preço de custo (R$)'),{target:{value:'10'}});
  fireEvent.change(screen.getByLabelText('Lucro sobre o custo (%)'),{target:{value:'50'}});
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('15.00');
  fireEvent.change(screen.getByLabelText('Preço unitário (R$)'),{target:{value:'19,90'}});
  fireEvent.change(screen.getByLabelText('Preço de custo (R$)'),{target:{value:'12'}});
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('19,90');
  expect(screen.getByText('Preço definido manualmente.')).toBeInTheDocument();
 });
 it('não calcula venda como zero quando o custo ainda está em branco',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Novo Produto'}));
  fireEvent.change(screen.getByLabelText('Lucro sobre o custo (%)'),{target:{value:'50'}});
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('');
  expect(screen.getByLabelText('Custo final')).toHaveTextContent('Pendente');
 });
 it('atualiza a composição enquanto o cadastro permanece aberto sem reavaliar o estoque',async()=>{
  mock.existing=true;mock.automatic=true;mock.recipeCost=12;const client=mount();
  fireEvent.click(await screen.findByRole('button',{name:'Editar Produto com receita'}));
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('18.00');
  mock.recipeCost=20;await act(async()=>{await client.invalidateQueries({queryKey:['products']});});
  expect(screen.getByLabelText('Preço de custo (R$)')).toHaveValue('20');
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('30.00');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(mock.rpc.mock.calls.some(([name])=>name==='save_product_with_photos')).toBe(true));
  const payload=mock.rpc.mock.calls.find(([name])=>name==='save_product_with_photos')![1];
  expect(payload.p_product.stock).not.toHaveProperty('avg_cost');
  expect(payload.p_product.sale_price).toBe(30);
 });
 it('não usa a última composição válida quando a composição vigente fica incompleta',async()=>{
  mock.existing=true;mock.automatic=true;mock.recipeCost=12;const client=mount();
  fireEvent.click(await screen.findByRole('button',{name:'Editar Produto com receita'}));
  mock.recipeCost=null;await act(async()=>{await client.invalidateQueries({queryKey:['products']});});
  expect(screen.getByLabelText('Preço de custo (R$)')).toHaveValue('');
  expect(screen.getByLabelText('Preço unitário (R$)')).toHaveValue('');
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Não foi possível salvar'})));
  expect(mock.rpc.mock.calls.some(([name])=>name==='save_product_with_photos')).toBe(false);
 });
 it('descarta percentual inválido ao escolher preço manual',async()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'Novo Produto'}));
  fireEvent.change(screen.getByLabelText('Nome *'),{target:{value:'Manual após erro'}});
  fireEvent.change(screen.getByLabelText('Preço de custo (R$)'),{target:{value:'10'}});
  fireEvent.change(screen.getByLabelText('Lucro sobre o custo (%)'),{target:{value:'-'}});
  fireEvent.change(screen.getByLabelText('Preço unitário (R$)'),{target:{value:'25'}});
  expect(screen.getByLabelText('Custo final')).toHaveTextContent('10,00');
  fireEvent.click(screen.getByRole('button',{name:'Criar'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('save_product_with_photos',expect.objectContaining({p_product:expect.objectContaining({sale_price:25,catalog_pricing:expect.objectContaining({price_source:'manual',markup_percent:null})})})));
 });
});
