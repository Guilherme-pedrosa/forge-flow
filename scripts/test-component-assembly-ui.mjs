import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const output='artifacts/component-assembly';await mkdir(output,{recursive:true});
try { for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage(),writes=[],errors=[];
 const names=['Corpo (par de metades)','Caule','Folha'],capacity=[10,100,100],balances=[30,10,20],history=[];let finished=0;
 const qcJobs=[{id:'stem-job',code:'OI-095',name:'Caule',planned_quantity:100,produced_quantity:100,component_stock_key:'key1',status:'quality_check'}];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/src/contexts/AuthContext.tsx')return route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({profile:{user_id:'user',tenant_id:'tenant',display_name:'Teste de montagem'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`});
  if(url.pathname.includes('/rest/v1/')) {
   const name=url.pathname.split('/').pop();let data=[];
   if(url.pathname.includes('/rpc/')) {
    const body=route.request().postDataJSON();writes.push({name,body});
    if(name==='assembly_product_status')data={product_id:'apple',name:'Maçã termoformada',enabled:true,item_id:null,required:body.p_quantity,assembled:0,ready_to_assemble:Math.min(...balances),finished_stock:finished,components:names.map((label,i)=>({plate_id:`plate${i}`,label,plate_index:i+1,units_per_print:capacity[i],balance:balances[i],available:balances[i],reserved:0,pending:i===1?100:0,required:body.p_quantity,missing:Math.max(0,body.p_quantity-balances[i]),to_print:Math.max(0,body.p_quantity-balances[i]-(i===1?100:0)),runs:Math.ceil(Math.max(0,body.p_quantity-balances[i]-(i===1?100:0))/capacity[i]),prepared:true,material_key:`key${i}`}))};
    else if(name==='plan_component_batch')data=['new-stem-1','new-stem-2'];
    else if(name==='assemble_product'){balances.forEach((v,i)=>balances[i]-=body.p_quantity);finished+=body.p_quantity;history.push({id:'assembly',quantity:body.p_quantity,component_cost:body.p_quantity*3,finishing_cost:body.p_finishing_cost,item_id:null,created_at:'2026-09-26T12:00:00Z',notes:body.p_notes});data='assembly';}
    else if(name==='write_off_components'){balances[Number(body.p_plate_id.slice(-1))]-=body.p_quantity;data='loss';}
    else if(name==='confirm_component_output'){balances[1]+=body.p_good_quantity;qcJobs.length=0;data='stem-job';}
   } else data=({products:[{id:'apple',name:'Maçã termoformada',assembly_enabled:true}],jobs:qcJobs,product_assemblies:history})[name]||[];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.hostname!=='127.0.0.1')return route.fulfill({contentType:'application/json',body:'{}'});
  return route.continue();
 });
 await page.goto('http://127.0.0.1:5173/producao/componentes?produto=apple');
 await page.getByLabel('Quantos produtos quero montar?').fill('20');
 const stem=page.getByRole('row',{name:/^Caule Placa 2/});
 await expect(stem).toContainText('10 para montar');
 await page.waitForTimeout(250);await page.screenshot({path:`${output}/componentes-${width}.png`,fullPage:true});
 await stem.getByRole('button',{name:'Produzir lote',exact:true}).click();await page.getByLabel('Quantidade',{exact:true}).fill('150');
 await expect(page.getByRole('dialog')).toContainText('2 impressão(ões) × 100 conjuntos = 200 conjuntos previstos');
 await page.getByRole('button',{name:'Criar lote de impressão'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(writes.find(w=>w.name==='plan_component_batch').body).toMatchObject({p_plate_id:'plate1',p_quantity:150,p_item_id:null});
 await page.getByRole('button',{name:'Registrar montagem / acabamento'}).click();await page.getByLabel('Quantidade',{exact:true}).fill('8');await page.getByLabel('Custo adicional total de montagem / acabamento (R$)').fill('4');
 await page.getByLabel('Observações',{exact:true}).fill('Termoformagem e acabamento concluídos');await page.waitForTimeout(250);await page.screenshot({path:`${output}/montagem-${width}.png`});
 await page.getByRole('button',{name:'Confirmar produtos montados'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 await expect(stem).toContainText('18 para montar');expect(balances).toEqual([22,2,12]);expect(finished).toBe(8);
 await page.getByRole('row',{name:/^Folha Placa 3/}).getByRole('button',{name:'Registrar perda'}).click();
 await page.getByLabel('Quantidade',{exact:true}).fill('2');await page.getByLabel('Motivo da perda *').fill('Quebra durante a montagem');await page.getByRole('button',{name:'Confirmar quantidade'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(balances).toEqual([22,2,10]);
 await page.getByRole('button',{name:'Conferir OI-095'}).click();await page.getByLabel('Quantidade boa').fill('95');await page.getByLabel('Motivo das rejeições (se houver)').fill('5 caules deformados');await page.getByRole('button',{name:'Confirmar quantidade'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 await expect(page.getByText('Lotes aguardando conferência')).not.toBeVisible();expect(balances[1]).toBe(97);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 console.log(`PASS ${width}px: bottleneck, independent batches, assembly, waste and partial quality`);await context.close();
} } finally {await browser.close();}
