import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
const output='artifacts/imported-composition'; await mkdir(output,{recursive:true});
const raw=JSON.parse(await readFile('src/test/fixtures/apple-makerworld.json','utf8'));
const plateXml=(index,object)=>`<plate><metadata key="plater_id" value="${index}"/><model_instance><metadata key="object_id" value="${object}"/></model_instance></plate>`;
const file=zipSync({'Metadata/model_settings.config':strToU8(`<config><object id="1"><metadata key="name" value="Body.stl"/></object><object id="2"><metadata key="name" value="Stem.stl"/></object><object id="3"><metadata key="name" value="Leaf.stl"/></object>${plateXml(1,1)}${plateXml(2,2)}${plateXml(3,3)}</config>`)});
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 for(const viewport of [{width:1440,height:900},{width:1108,height:580},{width:390,height:720}]){
  const context=await browser.newContext({viewport});const page=await context.newPage(),errors=[],writes=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/src/contexts/AuthContext.tsx')return route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`});
   if(url.hostname==='api.mymemory.translated.net')return route.fulfill({contentType:'application/json',body:JSON.stringify({responseStatus:200,responseData:{translatedText:'Descrição traduzida para português: maçã termoformada para presentes.'}})});
   if(url.pathname.includes('/rest/v1/')){
    const name=url.pathname.split('/').pop();let data=[];
    if(name==='request_makerworld_import')data=123;
    if(name==='get_makerworld_import')data={status:'ready',payload:raw};
    if(name==='save_product_with_photos'){writes.push(route.request().postDataJSON());data='saved-product';}
    if(name==='tenants')data={name:'Teste',settings:{}};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   // Test actual public cover/plate responses while application records stay mocked.
   if(url.hostname==='makerworld.bblmw.com')return route.continue();
   if(url.hostname!=='127.0.0.1')return route.fulfill({contentType:'application/json',body:'{}'});
   return route.continue();
  });
  await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5175'}/comercial/produtos`);
  await page.getByRole('button',{name:'Novo Produto',exact:true}).click();
  await page.getByLabel('Importar produto completo pelo link do MakerWorld').fill('https://makerworld.com/pt/models/2626659#profileId-2899977');
  await page.getByRole('button',{name:'Carregar modelo',exact:true}).click();
  const chooser=page.getByRole('dialog',{name:'Escolha a opção de impressão'});await expect(chooser).toBeVisible();
  await chooser.getByLabel('Configuração da impressora').selectOption('1');
  await chooser.getByRole('button',{name:'Importar esta opção'}).click();
  const editor=page.getByRole('dialog',{name:'Novo Produto'});await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Nome *',{exact:true})).toHaveValue(raw.title.replace(/\s+/g,' ').trim());
  await expect(editor.getByLabel('Descrição',{exact:true})).not.toHaveValue('');
  await expect.poll(()=>editor.getByRole('img',{name:'Foto principal do produto importado'}).evaluate(img=>img.tagName==='IMG'&&img.complete&&img.naturalWidth>0)).toBe(true);
  await page.screenshot({path:`${output}/dados-${viewport.width}.png`});
  await editor.getByRole('button',{name:'Conferir peças e composição'}).click();
  const preview=editor.getByRole('region',{name:'Composição importada'});await expect(preview).toBeVisible();
  await expect(preview.getByRole('article')).toHaveCount(3);await expect(preview.getByText(/O autor não informou os nomes/)).toBeVisible();
  await expect(preview.getByLabel('Conjunto / componente',{exact:true}).first()).toHaveValue('Conjunto da placa 1');
  await expect.poll(()=>preview.locator('img').evaluateAll(images=>images.length===3&&images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  await page.screenshot({path:`${output}/placas-${viewport.width}.png`});
  await preview.getByText('Completar peças pelo arquivo 3MF',{exact:true}).click();
  await preview.getByLabel('Completar nomes e quantidades pelo arquivo 3MF').setInputFiles({name:'fixture-composto.3mf',mimeType:'application/octet-stream',buffer:Buffer.from(file)});
  await expect(preview.getByText(/Peças carregadas de fixture-composto/)).toBeVisible();
  await expect(preview.getByLabel('Conjunto / componente',{exact:true}).nth(0)).toHaveValue('Corpo');
  await expect(preview.getByLabel('Conjunto / componente',{exact:true}).nth(1)).toHaveValue('Caule');
  await expect(preview.getByLabel('Conjunto / componente',{exact:true}).nth(2)).toHaveValue('Folha');
  await preview.getByRole('button',{name:'Esta composição forma 1 produto'}).click();
  await page.screenshot({path:`${output}/arquivo-${viewport.width}.png`});
  const bounds=await editor.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);
  expect(await editor.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await editor.getByRole('button',{name:'Criar',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0].p_product.import_composition).toMatchObject({profile_id:'836978891',enabled:true});
  expect(writes[0].p_product.import_composition.plates.map(p=>p.parts[0].name)).toEqual(['Corpo','Caule','Folha']);
  expect(writes[0].p_product.import_composition.plates.every(p=>p.units_per_plate===1&&p.parts[0].quantity_per_product===1)).toBe(true);
  expect(writes[0].p_product.description.length).toBeGreaterThan(0);expect(writes[0].p_product.photo_url).toBe(raw.coverUrl);
  expect(errors).toEqual([]);console.log(`PASS real Apple metadata/photos + synthetic 3MF + atomic payload at ${viewport.width}x${viewport.height}`);await context.close();
 }
}finally{await browser.close();}
