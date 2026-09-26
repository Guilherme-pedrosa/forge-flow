import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const directory = 'artifacts/erp-quick'; await mkdir(directory,{recursive:true});
const product = {id:'p1',tenant_id:'test',name:'Vaso geométrico',category:'resale',is_active:true,cost_estimate:12,sale_price:35,prints_per_plate:1,num_colors:1,extras:[]};
const stock = [{id:'i1',tenant_id:'test',name:'Embalagem kraft',category:'consumable',unit:'un',is_active:true,current_stock:12,avg_cost:2}];
const writes=[];
try {
 for(const width of [1440,390]) {
  const products=[{...product}];
  const context=await browser.newContext({viewport:{width,height:960}}); const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/src/contexts/AuthContext.tsx') return route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({profile:{id:'test',user_id:'test',tenant_id:'test',display_name:'Ambiente de teste'},user:{id:'test'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`});
   if(url.pathname.includes('/rest/v1/')) {
    const table=url.pathname.split('/').pop(); let data=[];
    if(url.pathname.includes('/rpc/')) {
     if(route.request().method()==='POST') writes.push({rpc:table,...route.request().postDataJSON()});
     if(table==='save_product_with_photos') {
       const body=route.request().postDataJSON();const id=body.p_product_id||`product-${products.length}`;const previous=products.find(p=>p.id===id);const item=body.p_product.stock;
       const saved={...product,...previous,...body.p_product,id,manual_cost_override:body.p_product.manual_cost,stock_item_id:previous?.stock_item_id||`stock-${id}`,stock:item?{...previous?.stock,...item,id:previous?.stock_item_id||`stock-${id}`,current_stock:item.current_stock??previous?.stock?.current_stock??0}:previous?.stock};
       const index=products.findIndex(p=>p.id===id);if(index<0)products.push(saved);else products[index]=saved;data=id;
     } else if(table==='save_inventory_catalog') {
       const body=route.request().postDataJSON();data=`inventory-${stock.length}`;stock.push({...body.p_item,id:data});
     } else if(table==='product_material_recipe_preview') data=null; else data=['product_material_recipe_catalog'].includes(table)?[]:table==='save_quick_purchase'?'saved-purchase':table==='delete_unused_record'?null:[];
    } else if(table==='products') data=products;
    else if(table==='inventory_items') { data=stock; if(route.request().method()==='POST') {const body=route.request().postDataJSON();data={...body};stock.push({...body,avg_cost:0,current_stock:0});} }
    else if(table==='tenants') data={id:'test',name:'Operação de teste',settings:{}};
    else if(table==='bank_accounts') data=[{id:'bank',name:'Conta principal',is_active:true}];
    else if(table==='accounts_payable') data=[{id:'bill',description:'Frete de entrega',amount:45,amount_paid:0,due_date:'2026-09-26',competence_date:'2026-09-26',status:'open',origin_id:null}];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(url.hostname!=='127.0.0.1') return route.fulfill({contentType:'application/json',body:'{}'});
   return route.continue();
  });
  await page.goto('http://127.0.0.1:5173/comercial/produtos');
  await page.getByRole('button',{name:'Novo Produto',exact:true}).click();
  await page.getByLabel('Nome *',{exact:true}).fill('Produto rápido');
  await page.getByRole('tab',{name:'Valores',exact:true}).click(); await expect(page.getByLabel('Preço unitário (R$)',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Peso por placa (g)',{exact:true})).not.toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({path:`${directory}/produto-${width}.png`});
  await page.getByRole('button',{name:'Salvar e cadastrar outro',exact:true}).click();
  await expect(page.getByLabel('Nome *',{exact:true})).toHaveValue('');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Novo Produto',exact:true}).click();
  await page.getByLabel('Nome *',{exact:true}).fill('Produto com custo e estoque');
  await page.getByRole('tab',{name:'Valores',exact:true}).click(); await page.getByLabel('Preço de custo (R$)',{exact:true}).fill('100,00');
  await page.getByLabel('Despesas acessórias (R$)',{exact:true}).fill('10,00'); await page.getByLabel('Outras despesas (R$)',{exact:true}).fill('5,00'); await page.getByLabel('Lucro sobre o custo (%)',{exact:true}).fill('50'); await page.getByRole('button',{name:'Calcular preço de venda'}).click(); await expect(page.getByLabel('Preço unitário (R$)',{exact:true})).toHaveValue('172.50'); await page.screenshot({path:`${directory}/valores-gestaoclick-${width}.png`});
  await page.getByLabel('Preço unitário (R$)',{exact:true}).fill('25,00');
  await page.getByRole('tab',{name:'Estoque',exact:true}).click(); await page.getByLabel('Estoque inicial',{exact:true}).fill('20');
  await page.waitForTimeout(250);
  await page.screenshot({path:`${directory}/cadastro-completo-${width}.png`});
  await page.getByRole('button',{name:'Criar',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByText('Produto com custo e estoque',{exact:true}).click();
  await page.getByRole('tab',{name:'Valores',exact:true}).click(); await expect(page.getByLabel('Preço de custo (R$)',{exact:true})).toHaveValue('100');
  await page.getByLabel('Preço de custo (R$)',{exact:true}).fill('15,75');
  await page.getByRole('tab',{name:'Estoque',exact:true}).click(); await expect(page.getByLabel('Quantidade em estoque',{exact:true})).toHaveValue('20'); await page.getByLabel('Quantidade em estoque',{exact:true}).fill('24');
  await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByText('Produto com custo e estoque',{exact:true}).click();
  await page.getByRole('tab',{name:'Valores',exact:true}).click(); await expect(page.getByLabel('Preço de custo (R$)',{exact:true})).toHaveValue('15.75'); await page.getByRole('tab',{name:'Estoque',exact:true}).click();
  await expect(page.getByLabel('Quantidade em estoque',{exact:true})).toHaveValue('24');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.goto('http://127.0.0.1:5173/estoque/compras');
  await page.getByRole('button',{name:'Nova Compra',exact:true}).click();
  await page.getByRole('combobox',{name:'Material de estoque do item 1'}).click();
  await page.getByPlaceholder('Digite nome ou código…').fill('kraft');
  await page.getByRole('option',{name:/Embalagem kraft/}).click();
  await expect(page.getByLabel('Descrição do item 1')).toHaveValue('Embalagem kraft');
  await expect(page.getByLabel('Quantidade comprada do item 1')).toHaveValue('1');
  await page.getByLabel('Preço unitário do item 1').fill('5');
  await page.getByLabel('Frete (R$)').fill('2');
  await page.getByLabel('Número de parcelas',{exact:true}).fill('2'); await page.getByLabel('Intervalo em dias',{exact:true}).fill('15'); await expect(page.getByLabel('Valor da parcela 1')).toHaveValue('3.50'); await page.getByLabel('Valor da parcela 1').fill('3,00'); await page.getByLabel('Valor da parcela 2').fill('4,00'); await page.getByLabel('Receber os itens agora').click();
  await page.waitForTimeout(250);
  await page.screenshot({path:`${directory}/compra-${width}.png`});
  await page.getByRole('button',{name:'Salvar e receber',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const purchase=writes.filter(w=>w.rpc==='save_quick_purchase').at(-1);
  expect(purchase.p_installments.map(p=>p.amount)).toEqual([3,4]); expect(purchase.p_receive).toBe(true);expect(purchase.p_order.total).toBe(7);expect(purchase.p_items[0].stock_quantity).toBe(1);
  await page.getByRole('button',{name:'Nova Compra',exact:true}).click();
  await page.getByRole('button',{name:'+ Cadastrar item',exact:true}).click();
  await page.getByLabel('Nome *',{exact:true}).fill(`Caixa teste ${width}`);
  await page.getByRole('button',{name:'Cadastrar e selecionar',exact:true}).click();
  await expect(page.getByLabel('Descrição do item 1')).toHaveValue(`Caixa teste ${width}`);
  await page.goto('http://127.0.0.1:5173/estoque/movimentacoes?item=i1');
  await expect(page.getByRole('dialog', {name:'Nova Movimentação'})).toBeVisible();
  await expect(page.getByRole('combobox', {name:'Item de estoque'})).toContainText('Embalagem kraft'); await page.getByLabel('Movimentação',{exact:true}).selectOption('out'); await page.getByLabel('Quantidade da movimentação').fill('2,5'); await expect(page.getByText('9.5',{exact:true})).toBeVisible(); await page.getByRole('button',{name:'Registrar',exact:true}).click(); expect(writes.filter(w=>w.rpc==='post_inventory_movement').at(-1).p_movement.quantity).toBe(-2.5);
  await page.goto('http://127.0.0.1:5173/financeiro/pagar');
  await page.getByRole('button',{name:'Nova despesa',exact:true}).click();
  await page.waitForTimeout(250);
  await page.screenshot({path:`${directory}/financeiro-${width}.png`});
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
  console.log(`PASS ${width}px: product name-only save, repeated registration, searchable purchase, receipt totals, inline item registration, finance form; no browser errors.`);
  await context.close();
 }
} finally {await browser.close();}
