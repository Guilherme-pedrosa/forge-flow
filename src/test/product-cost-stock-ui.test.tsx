import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Produtos from '@/pages/comercial/Produtos';
const mock=vi.hoisted(()=>({rpc:vi.fn(),toast:vi.fn(),existing:false}));
const product={id:'product',tenant_id:'tenant',name:'Produto com receita',category:'printed_part',is_active:true,cost_estimate:999,manual_cost_override:10,sale_price:25,prints_per_plate:1,num_colors:1,extras:[],stock_item_id:'stock',stock:{id:'stock',current_stock:20,unit:'un',min_stock:2,avg_cost:10}};
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({profile:{tenant_id:'tenant',user_id:'user'}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mock.toast})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,order:()=>query,range:()=>query,single:()=>query,is:()=>query,in:()=>query,
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='products'&&mock.existing?[product]:table==='tenants'?{settings:{}}:[],error:null}).then(resolve)};return query;
}}}));
vi.mock('@/pages/comercial/ProductPrintSources',()=>({default:()=>null}));
vi.mock('@/pages/comercial/ProductMaterialRecipe',()=>({default:()=>null}));
beforeEach(()=>{mock.existing=false;mock.rpc.mockReset();mock.toast.mockReset();mock.rpc.mockImplementation(async(name:string)=>({data:name==='product_material_recipe_catalog'?[{id:'product',configured:true,complete:true,cost_per_unit:999,plate_count:1}]:'saved',error:null}));});
afterEach(cleanup);
function mount(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Produtos/></MemoryRouter></QueryClientProvider>);}
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
  mock.existing=true;mount();fireEvent.click(await screen.findByText('Produto com receita'));
  const cost=screen.getByLabelText('Preço de custo (R$)');expect(cost).toBeEnabled();expect(cost).toHaveValue('10');
  fireEvent.change(cost,{target:{value:'15,75'}});fireEvent.change(screen.getByLabelText('Quantidade em estoque'),{target:{value:'24'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Salvar'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('save_product_with_photos',expect.objectContaining({p_product_id:'product',p_product:expect.objectContaining({manual_cost:15.75,stock:expect.objectContaining({current_stock:24,expected_stock:20,avg_cost:15.75})})})));
 });
});
