import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const output='artifacts/gc-workflow';await mkdir(output,{recursive:true});
try { for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage();const errors=[],writes=[];
 const customers=[],vendors=[],quotes=[],quoteItems=[],ops=[],jobs=[];let ready=false;
 const products=[{id:'product',tenant_id:'tenant',name:'Peça personalizada',sku:'3D-01',sale_price:30,is_active:true}];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/src/contexts/AuthContext.tsx')return route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant',display_name:'Ambiente de teste'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`});
  if(url.pathname.includes('/rest/v1/')) {
   const name=url.pathname.split('/').pop();let data=[];
   if(url.pathname.includes('/rpc/')) {
    const body=route.request().postDataJSON();writes.push({name,body});
    if(name==='save_partner') {
     data=body.p_id||`${body.p_kind}-${customers.length+vendors.length}`;
     (body.p_kind==='customer'?customers:vendors).push({...body.p_data,id:data,tenant_id:'tenant',updated_at:'2026-09-26T12:00:00Z'});
    } else if(name==='save_sales_quote') {
     data='quote';quotes.push({...body.p_quote,id:data,code:'ORC-001',status:'draft',revision:1,created_at:'2026-09-26',customer_snapshot:{name:customers[0].name},order_id:null});
     quoteItems.push(...body.p_items.map((item,i)=>({...item,id:`line-${i}`,quote_id:data,estimated_unit_cost:null,estimated_total_cost:null,product_snapshot:{complete:false,product:{id:'product',name:'Peça personalizada'},missing:['Composição a preparar'],requirements:[]}})));
    } else if(name==='transition_sales_quote') {quotes[0].status=body.p_status;data='quote';}
    else if(name==='request_production_order') {data='op';ops.push({id:'op',tenant_id:'tenant',code:'OP-001',customer_name:customers[0].name,source_quote_id:'quote',source_order_id:null,status:'preparing',due_date:null,created_at:'2026-09-26'});}
    else if(name==='production_order_preflight')data={ready,items:[{id:'opitem',product_id:'product',description:'Peça personalizada',quantity:3,jobs:ready?2:0,estimated_cost:ready?12:null,issues:ready?[]:['Complete material e tempo no produto.']}]};
    else if(name==='refresh_production_preparation'){ready=true;data='op';}
    else if(name==='release_production_order'){ops[0].status='released';jobs.push({id:'job',code:'OI-001',name:'Peça personalizada',status:'queued',planned_quantity:2,production_order_id:'op',created_at:'2026-09-26'});data='op';}
    else if(name==='product_material_variant_preview')data={complete:false,material_options:[],missing:['Composição a preparar']};
   } else data=({customers,vendors,products,sales_quotes:quotes,sales_quote_items:quoteItems,production_orders:ops,jobs,tenants:{name:'Ambiente de teste',settings:{}}})[name]||[];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.hostname!=='127.0.0.1')return route.fulfill({contentType:'application/json',body:'{}'});
  return route.continue();
 });
 await page.goto('http://127.0.0.1:5173/cadastros/fornecedores');
 await page.getByRole('button',{name:'Adicionar fornecedor',exact:true}).click();
 await page.getByLabel('Tipo de pessoa',{exact:true}).selectOption('company');await page.getByLabel('Razão social / nome *',{exact:true}).fill('Fornecedor de filamentos');
 await page.getByLabel('Nome fantasia',{exact:true}).fill('Filamentos da oficina');await page.getByLabel('CNPJ',{exact:true}).fill('00000000000100');
 await page.getByLabel('Logradouro',{exact:true}).fill('Rua do teste');await page.getByRole('button',{name:'Adicionar contato',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Setor de compras');await page.waitForTimeout(250);await page.screenshot({path:`${output}/fornecedor-${width}.png`});
 await page.getByRole('button',{name:'Salvar fornecedor',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(writes.find(w=>w.name==='save_partner').body.p_data.registration_details.contacts[0].name).toBe('Setor de compras');
 await page.goto('http://127.0.0.1:5173/comercial/orcamentos');
 await page.getByRole('button',{name:'Novo orçamento',exact:true}).click();
 await page.getByRole('button',{name:'Cadastrar cliente',exact:true}).click();await page.getByLabel('Nome *',{exact:true}).fill('Cliente de produção');
 await page.getByRole('button',{name:'Salvar cliente',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Cliente do orçamento'})).toContainText('Cliente de produção');
 await page.getByRole('combobox',{name:'Produto 1',exact:true}).click();await page.getByRole('option',{name:/3D-01 · Peça personalizada/}).click();
 await expect(page.getByLabel('Descrição para o cliente',{exact:true})).toHaveValue('Peça personalizada');
 await page.getByLabel('Quantidade',{exact:true}).fill('3');await page.getByLabel('Número de parcelas',{exact:true}).fill('2');
 await expect(page.getByLabel('Valor da parcela 1')).toHaveValue('45.00');await page.getByLabel('Valor da parcela 1').fill('40');await page.getByLabel('Valor da parcela 2').fill('50');
 await page.waitForTimeout(250);await page.screenshot({path:`${output}/orcamento-${width}.png`});
 await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();await expect(page.getByRole('button',{name:'Emitir proposta',exact:true})).toBeEnabled();
 expect(writes.find(w=>w.name==='save_sales_quote').body.p_quote.payment_schedule.map(p=>p.amount)).toEqual([40,50]);
 await page.getByRole('button',{name:'Emitir proposta',exact:true}).click();await page.getByRole('button',{name:'Registrar aprovação',exact:true}).click();
 await expect(page.getByRole('button',{name:'Converter em venda',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Gerar ordem de produção',exact:true}).click();await expect(page).toHaveURL(/producao\/ordens\?op=op/);
 await expect(page.getByText('Complete material e tempo no produto.')).toBeVisible();await expect(page.getByRole('button',{name:'Liberar para a fila'})).toBeDisabled();
 await page.waitForTimeout(250);await page.screenshot({path:`${output}/op-preparacao-${width}.png`});
 await page.getByRole('button',{name:'Atualizar composição da OP'}).click();await expect(page.getByRole('button',{name:'Liberar para a fila'})).toBeEnabled();
 await page.getByRole('button',{name:'Liberar para a fila'}).click();await expect(page.getByText('OI-001',{exact:true})).toBeVisible();
 await page.waitForTimeout(250);await page.screenshot({path:`${output}/op-liberada-${width}.png`});
 expect(writes.filter(w=>w.name==='release_production_order')).toHaveLength(1);expect(writes.some(w=>w.name==='convert_sales_quote')).toBe(false);expect(errors).toEqual([]);
 console.log(`PASS ${width}px: fornecedor completo, cliente no orçamento, parcelas, emissão sem receita e OP até a fila.`);
 await context.close();
}} finally {await browser.close();}
