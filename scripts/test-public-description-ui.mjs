import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output='artifacts/public-description';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],translations=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Short public model text keeps the live translation check within the provider's free quota.
 const text='A fresh take on the classic teacher apple—this thermoformed apple doubles as a lightweight container, perfect for small gifts.';
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/src/contexts/AuthContext.tsx')return route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`});
  if(url.pathname.includes('/rest/v1/')) {
   const name=url.pathname.split('/').pop();let data=[];
   if(name==='request_makerworld_import')data='request';
   else if(name==='get_makerworld_import')data={status:'ready',payload:{id:2626659,title:'Maçã para presentear',summary:`<p>${text}</p>`}};
   else if(name==='save_product_with_photos'){writes.push(req.postDataJSON());data='saved';}
   else if(name==='tenants')data={name:'Empresa de teste',settings:{}};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.hostname==='api.mymemory.translated.net'){translations.push({q:url.searchParams.get('q'),langpair:url.searchParams.get('langpair')});return route.continue();}
  if(url.hostname==='127.0.0.1')return route.continue();return route.fulfill({contentType:'application/json',body:'{}'});
 });
 await page.goto('http://127.0.0.1:5174/comercial/produtos');
 await page.getByRole('button',{name:'Importar da Bambu',exact:true}).click();await page.getByRole('button',{name:'MakerWorld',exact:true}).click();
 await page.getByLabel('Link do modelo MakerWorld').fill('https://makerworld.com/pt/models/2626659-thermoformed-apple-teacher-appreciation-gift');
 await page.getByRole('button',{name:'Buscar modelo do MakerWorld'}).click();await page.getByRole('button',{name:/Maçã para presentear/}).click();
 await expect(page.getByRole('dialog',{name:'Novo Produto'})).toBeVisible();
 await expect(page.getByText('Descrição traduzida para português. Revise o texto antes de salvar.')).toBeVisible({timeout:30000});
 const description=await page.getByLabel('Descrição',{exact:true}).inputValue();expect(description).toMatch(/maçã/i);expect(description).not.toBe(text);
 expect(translations).toEqual([{q:text,langpair:'en|pt-BR'}]);
 expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(false);
 await page.screenshot({path:`${output}/portugues-390.png`});
 await page.getByRole('button',{name:'Criar',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes).toHaveLength(1);expect(writes[0].p_product.description).toBe(description);expect(writes[0].p_product.external_import.description).toBe(text);expect(errors).toEqual([]);
 console.log('PASS: real public translation in mobile product editor, Portuguese save, original preserved; all ERP database writes mocked.');
 console.log(description);
}finally{await browser.close();}
