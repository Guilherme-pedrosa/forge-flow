import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output='artifacts/daily-erp-review';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {for(const width of [1440,390]) {
 const page=await browser.newPage({viewport:{width,height:900}}),writes=[],errors=[];
 const methods=[],accounts=[],centers=[],ops=[];
 const products=[{id:'apple',name:'Maçã completa',sku:'MACA',sale_price:30,category:'printed_part',is_active:true}];
 const quotes=[{id:'quote',code:'ORC-TESTE',status:'draft',revision:1,total:30,subtotal:30,shipping:0,discount:0,customer_snapshot:{name:'Cliente teste'},created_at:'2026-09-26T12:00:00Z'}];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/src/contexts/AuthContext.tsx')return route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant',display_name:'Revisão'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`});
  if(url.pathname.includes('/rest/v1/')) {
   const name=url.pathname.split('/').pop();let data=[];
   if(url.pathname.includes('/rpc/')){
    const body=req.postDataJSON();writes.push({name,body});
    if(name==='save_financial_catalog') {const list={payment_method:methods,account:accounts,cost_center:centers}[body.p_kind];const record={id:body.p_id||`catalog-${writes.length}`,is_active:true,...body.p_values};if(body.p_kind==='account')record.account_type=record.type;const old=list.findIndex(x=>x.id===record.id);if(old>=0)list[old]=record;else list.push(record);data=record.id;}
    else if(name==='delete_financial_catalog'){const list={payment_method:methods,account:accounts,cost_center:centers}[body.p_kind];list.splice(list.findIndex(x=>x.id===body.p_id),1);data=null;}
    else if(name==='request_stock_production'){data='new-op';ops.push({id:data,code:'OP-TESTE',source_order_id:null,source_quote_id:null,status:'preparing',notes:body.p_notes,due_date:body.p_due_date});}
    else if(name==='production_order_preflight')data={ready:false,items:[{id:'op-item',product_id:'apple',description:'Maçã completa',quantity:20,jobs:0,estimated_cost:null,issues:['Prepare corpo, caule e folha.']}]};
    else if(name==='delete_unused_record'){quotes.splice(quotes.findIndex(q=>q.id===body.p_id),1);data=null;}
    else if(name==='save_product_with_photos')data='new-product';
    else if(name==='save_quick_purchase')data='purchase';
   } else if(req.method()!=='GET') {writes.push({name,body:req.postDataJSON()});data=[];}
   else data=({products,sales_quotes:quotes,sales_quote_items:[{id:'qi',description:'Maçã completa',quantity:1,unit_price:30,total:30,product_snapshot:{complete:false,product:{name:'Maçã completa'},plates:[],requirements:[],missing:[]}}],tenants:{id:'tenant',name:'Empresa teste',settings:{}},payment_methods:methods,chart_of_accounts:accounts,cost_centers:centers,production_orders:ops,customers:[{id:'customer',name:'José Silva'}],vendors:[{id:'vendor',name:'Fornecedor São Paulo'}],inventory_items:[{id:'material',name:'PLA Vermelho',unit:'g',current_stock:2000,avg_cost:0.08,material_code:'PLA',is_active:true}]})[name]||[];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.hostname==='127.0.0.1')return route.continue();return route.fulfill({contentType:'application/json',body:'{}'});
 });
 const goto=path=>page.goto('http://127.0.0.1:5174'+path);
 const bounds=async(label)=>{const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);expect(overflow,label).toBe(false);for(const dialog of await page.getByRole('dialog').all())expect(await dialog.evaluate(x=>x.scrollWidth>x.clientWidth+1),label+' dialog').toBe(false);await page.screenshot({path:`${output}/${label}-${width}.png`});};
 const choose=async(label,text)=>{await page.getByRole('combobox',{name:label,exact:true}).click();const field=page.getByRole('combobox',{name:'Buscar '+label.toLocaleLowerCase('pt-BR'),exact:true});await expect(field).toBeFocused();await field.fill(text);await page.getByRole('option').first().click();};
 await goto('/financeiro/cadastros');await page.getByRole('button',{name:'Adicionar',exact:true}).click();await page.getByLabel('Nome *',{exact:true}).fill('Pix');await page.getByRole('button',{name:'Salvar cadastro'}).click();await expect(page.getByRole('button',{name:'Editar Pix'})).toBeVisible();
 await page.getByRole('button',{name:'Editar Pix'}).click();await page.getByLabel('Nome *',{exact:true}).fill('Pix da empresa');await page.getByRole('button',{name:'Salvar cadastro'}).click();await expect(page.getByRole('button',{name:'Editar Pix da empresa'})).toBeVisible();await bounds('cadastros-financeiros');
 await page.getByRole('tab',{name:'Plano de contas',exact:true}).click();await page.getByRole('button',{name:'Adicionar',exact:true}).click();await page.getByLabel('Nome *',{exact:true}).fill('Insumos 3D');await page.getByRole('button',{name:'Salvar cadastro'}).click();await expect(page.getByRole('button',{name:'Editar Insumos 3D'})).toBeVisible();
 await goto('/financeiro/pagar');await page.getByRole('button',{name:'Nova despesa',exact:true}).click();await page.getByLabel('Descrição *',{exact:true}).fill('Compra de material');await page.getByLabel('Valor (R$) *',{exact:true}).fill('99,90');
 await choose('Fornecedor','sao paulo');await choose('Plano de contas','insumos');
 await page.locator('label').filter({hasText:/^Centro de custo$/}).locator('..').getByRole('button',{name:'Cadastrar',exact:true}).click();await page.getByLabel('Nome *',{exact:true}).fill('Produção 3D');await page.getByRole('button',{name:'Salvar cadastro'}).click();await expect(page.getByRole('combobox',{name:'Centro de custo',exact:true})).toContainText('Produção 3D');
 await expect(page.getByLabel('Descrição *',{exact:true})).toHaveValue('Compra de material');await choose('Forma de pagamento','pix');await bounds('financeiro-despesa');await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await goto('/estoque/compras');await page.getByRole('button',{name:'Nova Compra',exact:true}).click();await choose('Fornecedor da compra','sao');await choose('Material de estoque do item 1','vermelho');await page.getByRole('button',{name:'Cadastrar forma de pagamento',exact:true}).click();await page.getByLabel('Nome *',{exact:true}).fill('Boleto 30 dias');await page.getByLabel('Tipo',{exact:true}).selectOption('boleto');await page.getByRole('button',{name:'Salvar cadastro'}).click();await expect(page.getByRole('combobox',{name:'Forma de pagamento da compra'})).toContainText('Boleto 30 dias');await bounds('nova-compra');
 await goto('/producao/ordens');await page.getByRole('button',{name:'Adicionar ordem',exact:true}).click();await choose('Produto para estoque 1','maca');await page.getByLabel('Quantidade',{exact:true}).fill('20');await page.getByLabel('Observações da produção').fill('Repor prateleira');await bounds('producao-estoque');await page.getByRole('button',{name:'Criar produção para estoque'}).click();await expect(page.getByRole('heading',{name:'OP-TESTE'})).toBeVisible();expect(writes.find(w=>w.name==='request_stock_production').body.p_items).toEqual([{product_id:'apple',quantity:20}]);await expect(page.getByRole('dialog')).toContainText('Produção para estoque.');
 await goto('/comercial/orcamentos');await page.getByRole('button',{name:'Abrir ORC-TESTE'}).click();await page.getByRole('button',{name:'Excluir',exact:true}).click();await page.getByRole('button',{name:'Excluir definitivamente'}).click();await expect(page.getByText('Nenhum orçamento encontrado')).toBeVisible();expect(writes.find(w=>w.name==='delete_unused_record').body).toEqual({p_kind:'quote',p_id:'quote'});
 await goto('/comercial/produtos');await page.getByRole('button',{name:'Novo Produto',exact:true}).click();await page.getByLabel('Nome *',{exact:true}).fill('Maçã cadastrada com saldo');await page.getByRole('tab',{name:'Valores',exact:true}).click();await page.getByLabel('Preço de custo (R$)',{exact:true}).fill('8,50');await page.getByLabel('Preço unitário (R$)',{exact:true}).fill('30');await page.getByRole('tab',{name:'Estoque',exact:true}).click();await page.getByLabel('Estoque inicial',{exact:true}).fill('12');await bounds('produto-custo-estoque');await page.getByRole('button',{name:'Criar',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const productWrite=writes.find(w=>w.name==='save_product_with_photos').body.p_product;expect(productWrite.manual_cost).toBe(8.5);expect(productWrite.sale_price).toBe(30);expect(productWrite.stock.current_stock).toBe(12);
 expect(errors).toEqual([]);console.log(`PASS ${width}px: finance create/edit/inline, searchable purchases, stock OP, quote deletion, product cost + stock.`);await page.close();
}}finally{await browser.close();}
