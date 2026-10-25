import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
 const sql=(await readFile(new URL('../supabase/migrations/' + name, import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'');
 try { await db.exec(sql); }
 catch(error) { const position=Number(error.position||0); throw new Error(`Migration ${name}: ${error.message} ${error.where??''} near ${sql.slice(Math.max(0,position-140),position+140)}`); }
}
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1), otherTenant=id(2), owner=id(3), otherOwner=id(4), viewer=id(5), material=id(6);
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
let sequence=100, passed=0;
const next=()=>id(sequence++);
const login=uid=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
const save=(data,product=null,key=next())=>scalar("SELECT save_product_with_photos($1,$2::jsonb,'[]'::jsonb,$3)",[product,JSON.stringify(data),key]);
const plates=p=>rows('SELECT * FROM product_print_plates WHERE product_id=$1 ORDER BY plate_index',[p]);
const parts=p=>rows('SELECT * FROM product_subitems WHERE product_id=$1 ORDER BY id',[p]);
const spec=p=>scalar('SELECT product_piece_spec($1)',[p]);
async function test(name,fn) { try { await fn(); passed++; console.log('PASS '+name); } catch(error) { console.error('FAIL '+name+': '+error.message,error.where??''); throw error; } }
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')",[owner,otherOwner,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Slicer QA','slicer-qa'),($2,'Other','slicer-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,material_code,color,color_code,color_hex,material_identified_at) VALUES($1,$2,'PLA verde','g',0.1,'PLA','Verde','GREEN','#00AE42',now())",[material,tenant]);
await db.exec('SET ROLE authenticated'); await login(owner);
const fileHash='a'.repeat(64);
const slicedPlate=(index=1)=>({index,label:'Cubos',units_per_plate:null,weight_grams:3.63,time_seconds:1351,
 slicer_estimates:{source:'3mf_slice_info',slicer_version:'02.08.02.61',printer_model_id:null,nozzle_diameters:'0.4',filaments:[{id:1,material_code:'PLA',color_hex:'#00AE42',weight_grams:3.63,length_meters:1.22}]},
 parts:[{source_key:'file-object:'+index,name:'Cubo',name_source:'file',quantity_per_plate:1,quantity_per_product:null}]});
const local=()=>({name:'Cubo fatiado '+sequence,file_composition:{profile_id:'local:'+fileHash,file_sha256:fileHash,enabled:true,plates:[slicedPlate()]},shipping_package:{length_cm:10,width_cm:9,height_cm:8,weight_grams:40}});
const variant=extra=>({profile_id:null,printer_model:null,printer_code:null,nozzle_diameter:null,weight_grams:null,time_seconds:null,plates:null,plate_details:[],filaments:[],images:[],warnings:[],...extra});
const external=()=>({schema_version:1,provider:'makerworld',id:'1169522',design_id:'1169522',model_id:'PUBLIC-MODEL',source_url:'https://makerworld.com/pt/models/1169522-project#profileId-1177581',title:'Modular organizer',description:'Description',description_html:'<p>Description</p>',images:[],gallery:[],tags:[],categories:[],files:[],accessories:[],documentation:[],warnings:[],
 profiles:[{...variant({profile_id:'241221531',weight_grams:100,time_seconds:6000,plates:1,plate_details:[{index:1,name:'Placa 1',weight_grams:100,time_seconds:6000,filaments:[{id:'1',type:'PETG',color:'#FFFFFF',grams:100}],images:[],objects:[],warnings:[]}]}),instance_id:'1177581',name:'All parts',variants:[]}],selected_profile_id:'1177581',selected_variant_profile_id:'241221531',metadata_complete:true});
const manualPlate=(plate,grams,seconds)=>scalar('SELECT save_product_print_plate($1,$2,$3,$4::jsonb)',[plate.id,plate.product_id,plate.source_id,JSON.stringify({plate_index:plate.plate_index,label:plate.label,units_per_plate:plate.units_per_plate,material_id:plate.material_id,printer_id:plate.printer_id,est_grams:grams,est_time_seconds:seconds,est_cost_per_unit:plate.est_cost_per_unit})]);

try {
 await test('A real sliced-file plan survives atomic save and re-open without changing measured print usage or stock',async()=>{
  const data=local(),key=next(),p=await save(data,null,key),[plate]=await plates(p),[part]=await parts(p);
  assert.equal(Number(plate.est_grams),3.63); assert.equal(Number(plate.est_time_seconds),1351); assert.equal(plate.units_per_plate,null);
  assert.equal(plate.imported_plate_metadata.file_sha256,fileHash); assert.equal(plate.imported_plate_metadata.slicer_estimates.source,'3mf_slice_info');
  assert.equal(plate.imported_filaments[0].grams,3.63); assert.equal(plate.imported_filaments[0].meters,1.22); assert.equal(plate.imported_filaments[0].type,'PLA'); assert.equal(plate.imported_filaments[0].item_id,material);
  assert.equal(plate.actual_grams_per_unit,null); assert.equal(plate.actual_seconds_per_unit,null); assert.equal(plate.actual_source,null);
  const sheet=await spec(part.component_product_id); assert.equal(sheet.source,'plate'); assert.equal(sheet.grams,3.63); assert.equal(sheet.print_seconds,1351); assert.equal(sheet.materials[0].material,'PLA'); assert.equal(sheet.materials[0].color,'#00AE42');
  const prep=await scalar('SELECT product_print_plate_preparation($1)',[plate.id]); assert.equal(prep.filaments[0].grams,3.63);
  assert.equal(await scalar('SELECT count(*)::integer FROM inventory_movements'),0); assert.equal(await scalar('SELECT count(*)::integer FROM bambu_production_records'),0);
  assert.deepEqual(await scalar('SELECT shipping_package FROM products WHERE id=$1',[p]),data.shipping_package);
  assert.equal(await save(data,null,key),p); assert.equal((await plates(p)).length,1); assert.equal((await parts(p)).length,1);
 });
 await test('Homogeneous copies divide totals only by the known physical yield; mixed plates and unknown yields stay unallocated',async()=>{
  const data=local(); data.file_composition.plates[0].parts[0].quantity_per_plate=3;
  const p=await save(data),[part]=await parts(p); const sheet=await spec(part.component_product_id);
  assert.equal(sheet.grams,1.21); assert.ok(Math.abs(sheet.print_seconds-1351/3)<1e-9);
  const mixed=local(); mixed.file_composition.plates[0].parts.push({source_key:'file-object:2',name:'Folha',name_source:'file',quantity_per_plate:5,quantity_per_product:null});
  const m=await save(mixed); for(const part of await parts(m)) { const s=await spec(part.component_product_id); assert.equal(s.source,'unknown'); assert.equal(s.grams,null); assert.equal(s.plate.grams,3.63); }
  const unknown=local(); unknown.file_composition.plates[0].parts[0].quantity_per_plate=null;
  const u=await save(unknown),[unallocated]=await parts(u); assert.equal((await spec(unallocated.component_product_id)).source,'unknown');
 });
 await test('Legacy unsliced payloads remain valid and missing values stay NULL',async()=>{
  const data=local(); delete data.file_composition.file_sha256; delete data.file_composition.plates[0].slicer_estimates;
  const p=await save(data),[plate]=await plates(p); assert.equal(plate.est_grams,null); assert.equal(plate.est_time_seconds,null); assert.deepEqual(plate.imported_filaments,[]);
  const incomplete=local(); incomplete.file_composition.plates[0].weight_grams=null; incomplete.file_composition.plates[0].time_seconds=null; incomplete.file_composition.plates[0].slicer_estimates.filaments[0].weight_grams=null;
  const u=await save(incomplete),[up]=await plates(u),[part]=await parts(u); assert.equal(up.est_grams,null); assert.equal(up.est_time_seconds,null); assert.equal((await spec(part.component_product_id)).grams,null);
 });
 await test('Physical indexes, rather than array position, select each plate plan',async()=>{
  const data=local(),second=slicedPlate(2); second.weight_grams=8; second.time_seconds=600; second.slicer_estimates.filaments[0].weight_grams=8;
  data.file_composition.plates=[second,slicedPlate(1)];
  const p=await save(data),all=await plates(p); assert.deepEqual(all.map(pl=>[pl.plate_index,Number(pl.est_grams),Number(pl.est_time_seconds)]),[[1,3.63,1351],[2,8,600]]);
 });
 await test('A sliced file enriches the exact selected MakerWorld plate and source refresh cannot discard it or overwrite manual planning',async()=>{
  const source=external(),p=await save({name:'Existing MakerWorld product',external_import:source});
  const data={name:'Existing MakerWorld product',external_import:source,import_composition:{profile_id:source.selected_variant_profile_id,file_sha256:fileHash,enabled:true,plates:[slicedPlate()]}};
  await save(data,p); let [plate]=await plates(p); const [part]=await parts(p);
  assert.equal(Number(plate.est_grams),3.63); assert.equal(Number(plate.est_time_seconds),1351); assert.ok(plate.source_id);
  assert.equal(plate.imported_plate_metadata.profile_id,source.selected_variant_profile_id); assert.equal(plate.imported_plate_metadata.file_sha256,fileHash);
  await save({name:'Reopened and saved',external_import:source},p); [plate]=await plates(p);
  assert.equal(plate.imported_filaments[0].type,'PLA'); assert.equal(plate.imported_filaments[0].grams,3.63); assert.equal(Number(plate.est_grams),3.63);
  assert.equal((await spec(part.component_product_id)).grams,3.63);
  await manualPlate(plate,22,33); await save(data,p); [plate]=await plates(p);
  assert.equal(Number(plate.est_grams),22); assert.equal(Number(plate.est_time_seconds),33); assert.equal(plate.imported_plate_metadata.slicer_weight_grams,3.63);
  const manual=await spec(part.component_product_id); assert.equal(manual.grams,22); assert.equal(manual.print_seconds,33);
 });
 await test('An approved recipe and manual technical sheet remain authoritative over file filament estimates',async()=>{
  const data=local(); data.file_composition.plates[0].units_per_plate=1;
  const p=await save(data),[plate]=await plates(p),[part]=await parts(p);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,plate.id,JSON.stringify([{item_id:material,grams:8}]),next()]);
  const s=await spec(part.component_product_id); assert.equal(s.grams,8); assert.equal(s.materials[0].item_id,material);
 });
 await test('An in-flight print keeps its frozen planning and rejects a changed sliced-file plan atomically',async()=>{
  const source=external(),p=await save({name:'Working product',external_import:source}),[plate]=await plates(p);
  await scalar('SELECT save_product_print_plate($1,$2,$3,$4::jsonb)',[plate.id,p,plate.source_id,JSON.stringify({plate_index:1,label:plate.label,units_per_plate:1,est_grams:100,est_time_seconds:6000})]);
  await scalar("SELECT save_product_material_recipe($1,$2,'per_print',$3::jsonb,NULL,$4,0)",[p,plate.id,JSON.stringify([{item_id:material,grams:100}]),next()]);
  await db.exec('RESET ROLE');
  await db.query("INSERT INTO jobs(tenant_id,code,name,status,product_id,print_plate_id) VALUES($1,'SLICER-QA','Pending print','draft',$2,$3)",[tenant,p,plate.id]);
  await db.exec('SET ROLE authenticated');
  const data={name:'Must roll back',external_import:source,import_composition:{profile_id:source.selected_variant_profile_id,file_sha256:fileHash,enabled:false,plates:[slicedPlate()]}};
  await assert.rejects(save(data,p),/pendentes|produção|planejamento/);
  const [kept]=await plates(p); assert.equal(Number(kept.est_grams),100); assert.equal(kept.imported_plate_metadata.file_sha256,undefined);
  assert.equal(await scalar('SELECT name FROM products WHERE id=$1',[p]),'Working product');
 });
 await test('Malformed hashes, cross-file identity, wrong types, excess bounds and ambiguous filaments roll back atomically',async()=>{
  for(const mutate of [d=>delete d.file_composition.file_sha256,d=>d.file_composition.file_sha256='b'.repeat(64),d=>d.file_composition.plates[0].weight_grams='3.63',d=>d.file_composition.plates[0].time_seconds=-1,d=>d.file_composition.plates[0].weight_grams=1000001,d=>d.file_composition.plates[0].slicer_estimates.source='measured',d=>d.file_composition.plates[0].slicer_estimates.filaments[0].item_id=material,d=>d.file_composition.plates[0].slicer_estimates.filaments[0].weight_grams=-1,d=>d.file_composition.plates[0].slicer_estimates.filaments[0].id=true,d=>d.file_composition.plates[0].slicer_estimates.filaments.push({...d.file_composition.plates[0].slicer_estimates.filaments[0]})]) {
   const data=local(),before=await scalar('SELECT count(*)::integer FROM products'); mutate(data); await assert.rejects(save(data)); assert.equal(await scalar('SELECT count(*)::integer FROM products'),before);
  }
 });
 await test('A failed request can be corrected, while accepted retries never overwrite a manual technical sheet',async()=>{
  const data=local(),key=next(); data.file_composition.plates[0].time_seconds=-2; await assert.rejects(save(data,null,key)); data.file_composition.plates[0].time_seconds=1351;
  const p=await save(data,null,key),[part]=await parts(p);
  await scalar('SELECT save_product_piece_spec($1,$2::jsonb,$3)',[part.component_product_id,JSON.stringify({materials:[{item_id:material,grams:9}],print_seconds:99}),next()]);
  assert.equal(await save(data,null,key),p); const s=await spec(part.component_product_id); assert.equal(s.source,'manual'); assert.equal(s.grams,9); assert.equal(s.print_seconds,99);
  await assert.rejects(save({...data,name:'different'},null,key),/conteúdo|diferente|utilizado/);
 });
 await test('Tenant isolation, viewer permissions and private helper permissions protect sliced plans',async()=>{
  const p=await save(local()); await login(otherOwner); assert.equal((await plates(p)).length,0); await assert.rejects(save({name:'Stolen'},p));
  await login(viewer); await assert.rejects(save(local()),/permissão/);
  await assert.rejects(db.query("SELECT erp_private.file_slicer_filaments('{}',$1)",[tenant]),/permission denied/);
  await login(owner); await assert.rejects(db.query("UPDATE product_print_plates SET imported_filaments='[]' WHERE product_id=$1",[p]),/permission denied/);
 });
 console.log(`Validated ${passed} sliced-file persistence scenarios.`);
} finally { await db.close(); }
