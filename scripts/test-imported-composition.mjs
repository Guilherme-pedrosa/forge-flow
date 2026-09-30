import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Real PostgreSQL execution; pg_net is a local queue mock. No HTTP or real token.
const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
  CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
  GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;
  CREATE SCHEMA net; GRANT USAGE ON SCHEMA net TO PUBLIC;
  CREATE TABLE net.http_request_queue(id bigserial PRIMARY KEY,url text,params jsonb,headers jsonb,timeout_milliseconds integer);
  CREATE TABLE net._http_response(id bigint,status_code integer,content text,timed_out boolean,error_msg text,created timestamptz DEFAULT now());
  GRANT ALL ON ALL TABLES IN SCHEMA net TO PUBLIC;
  CREATE FUNCTION net.http_get(url text,params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 2000) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE request bigint; BEGIN
      INSERT INTO net.http_request_queue(url,params,headers,timeout_milliseconds) VALUES($1,$2,$3,$4) RETURNING id INTO request;
      RETURN request;
    END $$;`);
for (const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) {
  const sql=(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'');
  try { await db.exec(sql); } catch(error) { throw new Error(`Migration ${name}: ${error.message}`); }
}

const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),uid=id(3),otherUid=id(4),viewer=id(5);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
await db.query("INSERT INTO auth.users VALUES($1,'maker@test.invalid'),($2,'other@test.invalid'),($3,'viewer@test.invalid')",[uid,otherUid,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Makerworld QA','makerworld-qa'),($2,'Other','makerworld-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[uid,otherUid,viewer,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
async function owner(fn){await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}}
let sequence=100,passed=0;const next=()=>id(sequence++);
const get=request=>scalar('SELECT get_makerworld_import($1)',[request]);
const request=design=>scalar('SELECT request_makerworld_import($1)',[`https://makerworld.com/pt/models/${design}-project#profileId-${design}`]);
async function receive(requestId,content,status=200,extra={}){await owner(()=>db.query('INSERT INTO net._http_response(id,status_code,content,timed_out,error_msg) VALUES($1,$2,$3,$4,$5)',[requestId,status,typeof content==='string'?content:JSON.stringify(content),extra.timed_out??false,extra.error_msg??null]));return get(requestId);}
async function clearRequests(){await owner(()=>db.exec('DELETE FROM net._http_response;DELETE FROM net.http_request_queue;DELETE FROM makerworld_import_requests;'));}
const images=Array.from({length:35},(_,n)=>`https://cdn.example.invalid/project-photo-${n}.jpg`);
const variant=extra=>({profile_id:null,printer_model:null,printer_code:null,nozzle_diameter:null,weight_grams:null,time_seconds:null,plates:null,plate_details:[],filaments:[],images:[],warnings:[],...extra});
const reference=()=>({schema_version:1,provider:'makerworld',id:'1169522',design_id:'1169522',model_id:'PUBLIC-MODEL',source_url:'https://makerworld.com/pt/models/1169522-project#profileId-1177581',title:'Modular organizer',description:'Complete description',description_html:'<p>Complete description</p>',images,gallery:images,
  tags:['Organizer'],categories:[],files:[],accessories:[],documentation:[],warnings:[],
  profiles:[{...variant({profile_id:'241221531',weight_grams:100,time_seconds:6000,plates:3,plate_details:[{index:1,filaments:[],images:[],objects:[],warnings:[]}],filaments:[{type:'PLA',color:'Black'}]}),instance_id:'1177581',name:'All parts',variants:[variant({profile_id:'241221532',printer_model:'Other printer'})]},
    {...variant({profile_id:'241221540'}),instance_id:'1177582',name:'Second profile',variants:[]}],
  selected_profile_id:'1177581',selected_variant_profile_id:'241221532',metadata_complete:true});
const save=(product,photos=images,p=null,requestId=next())=>scalar('SELECT save_product_with_photos($1,$2::jsonb,$3::jsonb,$4)',[p,JSON.stringify(product),JSON.stringify(photos),requestId]);
const draft=()=>({name:'Imported product',material_id:null,est_grams:100,est_time_minutes:100,prints_per_plate:1,cost_estimate:null,sale_price:null,external_import:reference()});
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message+' '+(error.where??''));throw error;}}
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const physicalReference=()=>{
  const r=reference();r.model_id='US43322ca98eb5f0';r.design_id=r.id='1403296';r.source_url='https://makerworld.com/models/1403296#profileId-1455750';r.selected_profile_id='1455750';r.selected_variant_profile_id='297891629';
  r.profiles=[{...variant({profile_id:'297891629',printer_model:'A1',plates:3,weight_grams:139,time_seconds:15526,
    plate_details:[[57,6370],[65,5796],[17,3360]].map(([weight_grams,time_seconds],i)=>({index:i+1,name:'Part '+(i+1),weight_grams,time_seconds,filaments:[{id:'1',type:'PLA',color:'#A7A9AA',grams:weight_grams,meters:null}],images:[],objects:[],warnings:[]}))}),instance_id:'1455750',name:'A1 gray',variants:[variant({profile_id:'OTHER-PRINTER',printer_model:'P1S',plates:1,plate_details:[{index:1,weight_grams:999,time_seconds:999,filaments:[],images:[],objects:[],warnings:[]}]})]},
    {...variant({profile_id:'OTHER-PROFILE',plates:5}),instance_id:'1455751',variants:[]}];return r;
};
const newProduct=async(ref=physicalReference())=>save({...draft(),external_import:ref},[]);
const plates=async p=>(await db.query('SELECT * FROM product_print_plates WHERE product_id=$1 AND is_active ORDER BY plate_index',[p])).rows;
const sourceFor=p=>scalar('SELECT id FROM product_print_sources WHERE product_id=$1 AND is_active ORDER BY created_at LIMIT 1',[p]);
const hydrate=(source,ref=physicalReference(),task=null)=>scalar('SELECT persist_source_plate_import($1,$2::jsonb,$3)',[source,JSON.stringify(ref),task]);
const preparation=p=>scalar('SELECT product_print_plate_preparation($1)',[p]);
const preview=p=>scalar('SELECT product_material_recipe_preview($1)',[p]);
const setPlate=(plate,overrides={})=>scalar('SELECT save_product_print_plate($1,$2,$3,$4::jsonb)',[plate.id,plate.product_id,plate.source_id,JSON.stringify({plate_index:plate.plate_index,label:plate.label,units_per_plate:plate.units_per_plate,material_id:plate.material_id,printer_id:plate.printer_id,est_grams:Number(plate.est_grams),est_time_seconds:Number(plate.est_time_seconds),est_cost_per_unit:plate.est_cost_per_unit,...overrides})]);
const material=async({color='#A7A9AA',name='Gray stock',unit='g',cost=.1,code='PLA',tenantId=tenant,identified=true}={})=>owner(()=>scalar('INSERT INTO inventory_items(tenant_id,name,unit,avg_cost,material_code,color,color_code,color_hex) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[tenantId,name,unit,cost,identified?code:null,identified?'Gray':null,identified?'GRAY':null,identified?color:null]));
const composition=()=>({profile_id:'297891629',enabled:true,plates:[1,2,3].map(index=>({index,label:['Corpo','Tampa','Encaixe'][index-1],units_per_plate:index===1?null:20,parts:[{source_key:'object:1',name:['Base','Tampa','Trava'][index-1],photo_url:images[index],quantity_per_product:null,quantity_per_plate:index+1,name_source:'source'}]}))});
const payload=()=>({...draft(),description:'Descrição do produto composta e preservada',photo_url:images[0],external_import:physicalReference(),import_composition:composition()});
const parts=p=>db.query('SELECT * FROM product_print_plate_parts WHERE product_id=$1 ORDER BY plate_id,source_key',[p]).then(r=>r.rows);
const status=p=>scalar('SELECT assembly_product_status($1,1,NULL)',[p]);
try{
await test('Parent, description, gallery, all plates, parts and assembly mode save in one transaction',async()=>{
 const p=await save(payload(),images.slice(1));
 assert.equal((await parts(p)).length,3); assert.equal((await status(p)).enabled,true);
 assert.equal(await scalar('SELECT description FROM products WHERE id=$1',[p]),payload().description);
 assert.equal(await scalar('SELECT count(*)::integer FROM product_photos WHERE product_id=$1',[p]),34);
 assert.deepEqual((await plates(p)).map(x=>x.label),['Corpo','Tampa','Encaixe']);
 assert.deepEqual((await plates(p)).map(x=>x.units_per_plate),[null,20,20]);
 assert.equal((await status(p)).individual_stock,true); assert.equal((await status(p)).components[0].label,'Base'); assert.equal(await scalar('SELECT count(*)::integer FROM product_subitems WHERE product_id='+String.fromCharCode(36)+'1',[p]),3);
});
await test('Same request replay and fresh source refresh keep identities, names, photos and counts without duplicates',async()=>{
 const data=payload(),key=next(),p=await save(data,[],null,key); const before=await parts(p);
 assert.equal(await save(data,[],null,key),p); await save(data,[],p);
 assert.deepEqual((await parts(p)).map(x=>x.id).sort(),before.map(x=>x.id).sort()); assert.equal((await plates(p)).length,3);
 await assert.rejects(save({...data,name:'Changed during retry'},[],null,key),/já utilizado|conteúdo|diferente/i);
});
await test('Refresh preserves later manual label and confirmed yield',async()=>{
 const p=await save(payload(),[]),[plate]=await plates(p); await setPlate(plate,{label:'Corpo comercial ajustado',units_per_plate:12});
 await save(payload(),[],p); await save(payload(),[],p); const after=(await plates(p))[0];assert.equal(after.label,'Corpo comercial ajustado');assert.equal(after.units_per_plate,12);
});
await test('A failed composition rolls back product, photos, stock, plates and idempotency record',async()=>{
 const before=await scalar('SELECT count(*)::integer FROM products'); const data=payload(); data.stock={unit:'un',current_stock:3,avg_cost:1};data.import_composition.plates[2].parts[0].name='';const key=next();
 await assert.rejects(save(data,images,null,key),/peça inválida/);
 assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
 data.import_composition.plates[2].parts[0].name='Trava';const p=await save(data,images,null,key);assert.equal((await parts(p)).length,3);
});
await test('Unknown public object names stay explicit and do not acquire guessed unit counts',async()=>{
 const data=payload();data.import_composition.plates.forEach(p=>{p.units_per_plate=null;p.parts=[{source_key:'plate',name:'Conjunto da placa '+p.index,name_source:'unknown',photo_url:images[p.index],quantity_per_product:null,quantity_per_plate:null}];});
 const p=await save(data,[]);assert.ok((await parts(p)).every(x=>x.quantity_per_product===null&&x.quantity_per_plate===null&&x.name_source==='unknown'));
 assert.ok((await plates(p)).every(x=>x.units_per_plate===null));
 const nextData=payload();nextData.import_composition.plates.forEach(pl=>{pl.parts[0].source_key='file-object:7';pl.parts[0].name_source='file';});
 await save(nextData,[],p);assert.equal((await parts(p)).length,3);assert.ok((await parts(p)).every(x=>x.name_source==='file'));
 await save(data,[],p);assert.equal((await parts(p)).length,3);assert.ok((await parts(p)).every(x=>x.name_source==='file'));
});
await test('Reject mismatched profile, duplicate plates, duplicate parts, fractional count and unsafe photo URL atomically',async()=>{
 for(const mutate of [x=>{x.profile_id='999';},x=>{x.plates[2].index=1;},x=>{x.plates[0].parts.push({...x.plates[0].parts[0]});},x=>{x.plates[1].parts[0].quantity_per_product=1.5;},x=>{x.plates[0].parts[0].photo_url='javascript:alert(1)';}]){
  const data=payload();mutate(data.import_composition);const count=await scalar('SELECT count(*)::integer FROM products');await assert.rejects(save(data,[]));assert.equal(await scalar('SELECT count(*)::integer FROM products'),count);
 }
});
await test('Tenant and role protection applies to writes and reads of imported parts',async()=>{
 const p=await save(payload(),[]);
 await assert.rejects(db.query("UPDATE product_print_plate_parts SET name='Forged' WHERE product_id=$1",[p]),/permission denied/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);assert.equal((await parts(p)).length,0);await assert.rejects(save(payload(),[],p),/não encontrad|permissão/i);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[viewer]);await assert.rejects(save(payload(),[]),/permissão/);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
await test('Local 3MF composition saves atomically and repeat requests do not duplicate parts',async()=>{
 const composition={profile_id:'local:'+'a'.repeat(64),enabled:true,plates:[{index:1,label:'Folhas',units_per_plate:10,parts:[{source_key:'file-object:1',name:'Folha',quantity_per_product:1,quantity_per_plate:10,name_source:'file'}]},{index:2,label:'Caules',units_per_plate:10,parts:[{source_key:'file-object:2',name:'Caule',quantity_per_product:1,quantity_per_plate:10,name_source:'file'}]}]};
 const data={name:'Local project',file_composition:composition},key=next();const p=await save(data,[],null,key);
 assert.equal(await save(data,[],null,key),p);assert.equal((await parts(p)).length,2);assert.equal((await status(p)).enabled,true);
 const before=await scalar('SELECT count(*) FROM products');await assert.rejects(save({...data,file_composition:{...composition,plates:[composition.plates[0],composition.plates[0]]}},[]),/repetida/);assert.equal(await scalar('SELECT count(*) FROM products'),before);
});
await test('Consignment transfers, simultaneous sale/return, stale protection and request replay',async()=>{
 const p=await save({name:'Consigned product',sale_price:20,manual_cost:5,stock:{unit:'un',current_stock:20,avg_cost:5}},[]);
 const customer=await owner(()=>scalar("INSERT INTO customers(tenant_id,name) VALUES($1,'Point customer') RETURNING id",[tenant]));
 const loc=await scalar('SELECT create_consignment_location($1::jsonb,NULL,$2)',[JSON.stringify({name:'Point',customer_id:customer,commission_percent:20}),next()]);
 const move=(type,qty,key=next())=>scalar('SELECT post_consignment_movement($1,$2,$3::jsonb,NULL,$4)',[loc,type,JSON.stringify([{product_id:p,quantity:qty,unit_price:20}]),key]);
 const central=()=>scalar('SELECT current_stock FROM inventory_items WHERE id=(SELECT stock_item_id FROM products WHERE id=$1)',[p]);
 const point=()=>row('SELECT current_qty,warehouse_tracked_qty FROM consignment_items WHERE location_id=$1 AND product_id=$2',[loc,p]);
 await move('placement',10);assert.equal(Number(await central()),10);assert.equal((await point()).warehouse_tracked_qty,10);
 const lines=[{product_id:p,expected_qty:10,unit_price:20,sold:3,returned:2}],key=next();
 const reconcile=(items,k=next())=>scalar('SELECT reconcile_consignment($1,$2::jsonb,20,NULL,$3)',[loc,JSON.stringify(items),k]);
 const result=await reconcile(lines,key);assert.equal(await reconcile(lines,key),result);assert.equal(Number(await central()),12);assert.equal(Number((await point()).current_qty),5);assert.equal((await point()).warehouse_tracked_qty,5);
 assert.equal(Number(await scalar("SELECT sum(amount) FROM accounts_receivable WHERE customer_id=$1",[customer])),48);
 await assert.rejects(reconcile(lines),/saldo mudou/);await assert.rejects(move('replenishment',99),/insuficiente/);assert.equal(Number(await central()),12);assert.equal(Number((await point()).current_qty),5);
 const receivables=await scalar('SELECT count(*) FROM accounts_receivable');await assert.rejects(reconcile([{...lines[0],expected_qty:5,sold:5,returned:1}]),/excedem/);assert.equal(await scalar('SELECT count(*) FROM accounts_receivable'),receivables);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[otherUid]);await assert.rejects(reconcile([{...lines[0],expected_qty:5}]),/inválido/);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
});
console.log(`Validated ${passed} automatic composition and reconciliation scenarios.`);
}finally{await db.close();}
const publish=(p,plate,item,grams=57,other=1)=>scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,$5)",[p,plate,JSON.stringify([{item_id:item,grams}]),next(),other]);
