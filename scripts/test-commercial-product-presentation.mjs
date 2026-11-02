// Disposable PostgreSQL acceptance of optional product presentation beside unchanged pricing and production.
// No production connection.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'');process.exit(1);});
const db=new PGlite();
await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid);
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE PUBLICATION supabase_realtime;
 GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO authenticated;`);
for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')&&x<='20261102235100_restore_check_validator_permissions.sql').sort()) {
 try { await db.exec((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net);/g,'')); }
 catch(error){throw new Error(`Migration ${name}: ${error.message} ${error.where??''}`);}
}
const id=n=>`72000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),otherTenant=id(2),owner=id(3),otherOwner=id(4),viewer=id(5),white=id(6),green=id(7),foreign=id(8),printer=id(9),otherPrinter=id(10);
let sequence=100,passed=0;
const next=()=>id(sequence++),scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0],rows=async(sql,args=[])=>(await db.query(sql,args)).rows;
const login=uid=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);
const admin=async(fn)=>{await db.exec('RESET ROLE');try{return await fn();}finally{await db.exec('SET ROLE authenticated');}};
const save=(data,p=null,key=next())=>scalar("SELECT save_product_with_photos($1,$2::jsonb,'[]'::jsonb,$3)",[p,JSON.stringify(data),key]);
const repair=(p,plan,key=next())=>scalar('SELECT save_product_import_pricing($1,$2::jsonb,$3)',[p,JSON.stringify(plan),key]);
const plates=p=>rows('SELECT * FROM product_print_plates WHERE product_id=$1 AND is_active ORDER BY plate_index',[p]);
const stored=p=>scalar('SELECT to_jsonb(p) FROM products p WHERE id=$1',[p]);
const prep=plate=>scalar('SELECT product_print_plate_preparation($1)',[plate]);
const recipe=plate=>scalar('SELECT (SELECT to_jsonb(r) FROM product_material_recipe_versions r WHERE plate_id=$1 AND is_current)',[plate]);
const near=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-7,`${actual} != ${expected}`);
const policy={energy_cost_kwh:1,labor_cost_hour:60,overhead_percent:10,target_margin:30,machine_hour_cost:4,handling_minutes_per_plate:6,finishing_minutes_per_piece:2,assembly_minutes_per_product:5,extras_cost_per_product:1,printer_hour_costs:[{printer_id:printer,hour_cost:7}]};
const setPolicy=async values=>scalar('SELECT save_pricing_settings($1::jsonb,$2,$3)',[JSON.stringify(values),(await scalar('SELECT pricing_settings()')).revision,next()]);
const hash='a'.repeat(64),profile='local:'+hash;
const slicedPlate=(index=1,grams=100,seconds=3600,filaments=[{id:1,material_code:'PLA',color_hex:'#FCECD6',weight_grams:grams,length_meters:grams/3}])=>({index,label:'Placa '+index,units_per_plate:null,weight_grams:grams,time_seconds:seconds,
 slicer_estimates:{source:'3mf_slice_info',slicer_version:'02.08.02.61',printer_model_id:null,nozzle_diameters:'0.4',filaments},
 parts:[{source_key:'file-object:'+index,name:'Peça '+index,name_source:'file',quantity_per_plate:1,quantity_per_product:null}]});
const planFor=(sourcePlates,quantity=1)=>({version:1,printer_id:printer,quantity,source_profile_id:profile,source_file_sha256:hash,
 materials:[{source_key:JSON.stringify([1,'PLA','#FCECD6']),item_id:white,material_code:'PLA',color_hex:'#FCECD6',slot_id:1}],
 plates:sourcePlates.map(p=>({index:p.index,units_per_plate:quantity,lines:[{item_id:white,grams:p.weight_grams}]}))});
const local=(sourcePlates=[slicedPlate()])=>({name:'Produto importado '+sequence,manual_cost:42.1234,cost_estimate:42.1234,sale_price:75,
 catalog_details:{base_cost:42.1234,accessory_cost:0,other_cost:0},catalog_pricing:{cost_source:'manual',price_source:'manual'},
 file_composition:{profile_id:profile,file_sha256:hash,enabled:true,plates:sourcePlates},import_pricing:planFor(sourcePlates)});
const variant=extra=>({profile_id:null,printer_model:null,printer_code:null,nozzle_diameter:null,weight_grams:null,time_seconds:null,plates:null,plate_details:[],filaments:[],images:[],warnings:[],...extra});
const external=()=>({schema_version:1,provider:'makerworld',id:'1169522',design_id:'1169522',model_id:'PUBLIC-MODEL',source_url:'https://makerworld.com/pt/models/1169522-project#profileId-1177581',title:'Presépio',description:'Description',description_html:'<p>Description</p>',images:[],gallery:[],tags:[],categories:[],files:[],accessories:[],documentation:[],warnings:[],
 profiles:[{...variant({profile_id:'241221531',weight_grams:119,time_seconds:16372,plates:1,plate_details:[{index:1,name:'Placa 1',weight_grams:119,time_seconds:16372,filaments:[{id:'1',type:'PLA',color:'#FCECD6',grams:null}],images:[],objects:[],warnings:[]}],filaments:[{id:'1',type:'PLA',color:'#FCECD6',grams:null}]}),instance_id:'1177581',name:'All parts',variants:[]}],selected_profile_id:'1177581',selected_variant_profile_id:'241221531',metadata_complete:true});
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+': '+error.message,error.where??'');throw error;}}
await db.query("INSERT INTO auth.users VALUES($1,'owner@qa.invalid'),($2,'other@qa.invalid'),($3,'viewer@qa.invalid')",[owner,otherOwner,viewer]);
await db.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Imported pricing QA','imported-pricing-qa'),($2,'Other','imported-pricing-other')",[tenant,otherTenant]);
await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$4,'Owner'),($2,$5,'Other'),($3,$4,'Viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$4,'owner'),($2,$5,'owner'),($3,$4,'viewer')",[owner,otherOwner,viewer,tenant,otherTenant]);
await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex,material_identified_at) VALUES($1,$4,'PLA branco','g',0.1,1000,'PLA','Branco','WHITE','#FFFFFF',now()),($2,$4,'PLA verde','kg',200,2,'PLA','Verde','GREEN','#00AE42',now()),($3,$5,'PLA outra empresa','g',0.1,1000,'PLA','Branco','WHITE','#FFFFFF',now())",[white,green,foreign,tenant,otherTenant]);
await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$3,'A1 confirmada','A1',100,2,1),($2,$4,'Outra A1','A1',100,2,1)",[printer,otherPrinter,tenant,otherTenant]);
await db.exec('SET ROLE authenticated');await login(owner);await setPolicy(policy);
const catalog=async p=>(await scalar('SELECT product_material_recipe_catalog()')).find(c=>c.id===p);
const preview=p=>scalar('SELECT product_pricing_preview($1,1,$2::jsonb)',[p,'{}']);
const snapshot=p=>admin(()=>scalar('SELECT erp_private.catalog_pricing_snapshot($1,$2)',[p,tenant]));
async function fullFixture({extra=2.5,zero=false}={}){
 const spool=next(),machine=next();await admin(async()=>{await db.query("INSERT INTO inventory_items(id,tenant_id,name,unit,avg_cost,current_stock,material_code,color,color_code,color_hex) VALUES($1,$2,$3,'g',0.1,1000,'PLA','Branco','WHITE','#FFFFFF')",[spool,tenant,'PLA cost '+sequence]);await db.query("INSERT INTO printers(id,tenant_id,name,model,power_watts,depreciation_per_hour,maintenance_cost_per_hour) VALUES($1,$2,'Cost A1','A1',100,2,1)",[machine,tenant]);});
 const settings=zero?{energy_cost_kwh:0,labor_cost_hour:0,overhead_percent:0,target_margin:0,machine_hour_cost:0,handling_minutes_per_plate:0,finishing_minutes_per_piece:0,assembly_minutes_per_product:0,extras_cost_per_product:0,printer_hour_costs:[]}:{...policy,printer_hour_costs:[{printer_id:machine,hour_cost:7}]};await setPolicy(settings);
 const data=local();data.material_id=spool;data.extras=extra===0?[]:[{name:'Ímã',cost:extra}];data.import_pricing.printer_id=machine;data.import_pricing.materials[0].item_id=spool;data.import_pricing.plates[0].lines[0].item_id=spool;
 const p=await save(data),[plate]=await plates(p);return{p,plate,spool,machine,settings};
}
async function form(p,changes={}){const a=await stored(p),c=await catalog(p),base=c.cost_per_unit;return{name:a.name,category:a.category,material_id:a.material_id,est_grams:a.est_grams??0,est_time_minutes:a.est_time_minutes??0,post_process_minutes:a.post_process_minutes??0,num_colors:a.num_colors,prints_per_plate:a.prints_per_plate,extras:a.extras,manual_cost:base==null?0:Math.round(base*10000)/10000,cost_estimate:base==null?0:Math.round(base*10000)/10000,sale_price:75,catalog_details:{base_cost:base,accessory_cost:0,other_cost:0},catalog_pricing:{cost_source:'composition',price_source:'manual',expected_composition_revision:c.revision},...changes};}
async function setPlan(p,plan){const current=await scalar('SELECT product_pricing_plan($1)',[p]);return scalar('SELECT save_product_pricing_plan($1,$2::jsonb,$3,$4)',[p,JSON.stringify(plan),current.revision,next()]);}
const generation=(changes={})=>({schema_version:1,generator:'facts-pt-BR-v1',generated_text:'Presépio com a Sagrada Família. Cor única.',input_signature:'{"subject":"Presépio com a Sagrada Família"}',title_mode:'known_translation',...changes});
const presentation=(changes={})=>({dimensions:{length_mm:125.5,width_mm:null,height_mm:100000},description_generation:generation(),...changes});
const manual=(changes={})=>({name:'Produto comercial '+sequence,description:'Descrição revisada pela operação.',manual_cost:10,cost_estimate:10,sale_price:25,catalog_details:{base_cost:10,accessory_cost:0,other_cost:0},catalog_pricing:{cost_source:'manual',price_source:'manual'},...changes});
const completeState=()=>admin(()=>scalar("SELECT jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM products p),'photos',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM product_photos p),'inventory',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM inventory_items i),'movements',(SELECT count(*) FROM inventory_movements),'requests',(SELECT count(*) FROM erp_private.requests),'acceptances',(SELECT count(*) FROM product_channel_pricing_acceptances),'audit',(SELECT count(*) FROM audit_log))"));
const channelConditions={commission_percent:0,tax_percent:0,fixed_fee_per_order:0,fixed_fee_per_item:0,seller_shipping_per_order:0,advertising_per_order:0,other_cost_per_order:0,target_margin:0};
async function channelEntry(quote=10,changes={}){const policy=await scalar("SELECT channel_pricing_policy('mercado_livre')");return{channel:'mercado_livre',quantity:1,assumptions:channelConditions,expected_policy_revision:policy.revision,quoted_unit_cost:quote,unit_price:30,...changes};}
try{
 await test('New manual products save optional partial real dimensions and generation metadata with cost and description unchanged',async()=>{
  const data=manual({commercial_presentation:presentation()}),p=await save(data),saved=await stored(p);assert.deepEqual(saved.commercial_presentation,presentation());assert.equal(saved.description,data.description);near(saved.manual_cost_override,10);near(saved.sale_price,25);assert.equal(saved.est_grams,0);assert.equal(saved.stock_item_id,null);
 });
 await test('Unknown dimensions and absent generation remain unknown; no measurements are required for a commercial save',async()=>{
  for(const value of [undefined,null,{}, {dimensions:null,description_generation:null},{dimensions:{length_mm:null,width_mm:null,height_mm:null}},{dimensions:{width_mm:.001}}]){const p=await save(manual(value===undefined?{}:{commercial_presentation:value})),saved=await stored(p);assert.deepEqual(saved.commercial_presentation,value??null);near(saved.manual_cost_override,10);}
 });
 await test('Later price or name edits omit the key and preserve presentation; explicit null alone clears the optional column',async()=>{
  const p=await save(manual({commercial_presentation:presentation()}));await save(manual({name:'Nome corrigido',sale_price:29}),p);assert.deepEqual((await stored(p)).commercial_presentation,presentation());await save(manual({commercial_presentation:null}),p);assert.equal((await stored(p)).commercial_presentation,null);
 });
 await test('An accepted retry returns before presentation updates and cannot erase a later explicit edit',async()=>{
  const data=manual({commercial_presentation:presentation()}),key=next(),p=await save(data,null,key),newer=presentation({dimensions:{height_mm:99},description_generation:null});await save(manual({commercial_presentation:newer}),p);const before=await completeState();assert.equal(await save(data,null,key),p);assert.deepEqual(await completeState(),before);assert.deepEqual((await stored(p)).commercial_presentation,newer);await assert.rejects(save({...data,commercial_presentation:null},null,key),/outra operação/);
 });
 await test('Invalid shapes, unknown keys and invalid dimensions roll back price, product, photos, inventory and request effects',async()=>{
  const invalid=[[],1,'text',true,{unknown:1},{dimensions:[]},{dimensions:{unit:'cm'}},{dimensions:{length_mm:0}},{dimensions:{width_mm:-1}},{dimensions:{height_mm:100000.001}},{dimensions:{length_mm:'125'}},{dimensions:{width_mm:true}},{dimensions:{height_mm:{value:1}}}];
  for(const value of invalid){const before=await completeState();await assert.rejects(save(manual({commercial_presentation:value,stock:{unit:'un',avg_cost:10,current_stock:3}})),/medidas e os dados/);assert.deepEqual(await completeState(),before);}
 });
 await test('Generation uses the exact version, generator, string bounds, allowed title modes and closed key set',async()=>{
  for(const title_mode of ['portuguese','known_translation','source_name','generic']){const value=presentation({description_generation:generation({title_mode})}),p=await save(manual({commercial_presentation:value}));assert.deepEqual((await stored(p)).commercial_presentation,value);}
  for(const gen of [[],{},generation({schema_version:'1'}),generation({schema_version:2}),generation({generator:'remote-ai'}),generation({generated_text:null}),generation({generated_text:'x'.repeat(20001)}),generation({input_signature:[]}),generation({input_signature:'x'.repeat(20001)}),generation({title_mode:'guessed'}),generation({extra:'not allowed'})]){const before=await completeState();await assert.rejects(save(manual({commercial_presentation:presentation({description_generation:gen})})),/medidas e os dados/);assert.deepEqual(await completeState(),before);}
  const boundary=presentation({description_generation:generation({generated_text:'ç'.repeat(20000),input_signature:'x'.repeat(20000)})}),p=await save(manual({commercial_presentation:boundary}));assert.deepEqual((await stored(p)).commercial_presentation,boundary);
 });
 await test('The column CHECK protects authenticated direct writes as well as the save RPC',async()=>{
  const p=await save(manual()),value=presentation({description_generation:null});await db.query('UPDATE products SET commercial_presentation=$2::jsonb WHERE id=$1',[p,JSON.stringify(value)]);assert.deepEqual((await stored(p)).commercial_presentation,value);
  const before=await stored(p);await assert.rejects(admin(()=>db.query('UPDATE products SET commercial_presentation=$2::jsonb WHERE id=$1',[p,JSON.stringify({dimensions:{length_mm:0}})])),/products_commercial_presentation_valid/);assert.deepEqual(await stored(p),before);
  await assert.rejects(admin(()=>db.query('UPDATE products SET commercial_presentation=$2::jsonb WHERE id=$1',[p,JSON.stringify({description_generation:{unexpected:true}})])),/products_commercial_presentation_valid/);
 });
 await test('The permission correction restores only the three pure CHECK validators and leaves business predecessors private',async()=>{
  const dependencies=await admin(()=>rows("SELECT DISTINCT p.proname,p.prosecdef,p.provolatile,has_function_privilege('authenticated',p.oid,'EXECUTE') AS allowed FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace JOIN pg_depend d ON d.classid='pg_constraint'::regclass AND d.objid=c.oid AND d.refclassid='pg_proc'::regclass JOIN pg_proc p ON p.oid=d.refobjid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE c.contype='c' AND tn.nspname='public' AND pn.nspname='erp_private' ORDER BY p.proname"));
  assert.deepEqual(dependencies.map(d=>d.proname),['product_shipping_package_valid','valid_number','valid_product_commercial_presentation']);assert.ok(dependencies.every(d=>d.allowed&&!d.prosecdef&&d.provolatile==='i'));
  for(const signature of ['erp_private.save_product_before_presentation(uuid,jsonb,jsonb,uuid)','erp_private.catalog_pricing_snapshot(uuid,uuid)','erp_private.channel_catalog_cost(uuid,uuid)'])assert.equal(await admin(()=>scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')",[signature])),false);
 });
 await test('Authenticated direct inserts and updates validate both product and package measures without adding fabricated defaults',async()=>{
  const value=presentation({description_generation:null}),p=await scalar('INSERT INTO products(tenant_id,name,commercial_presentation,shipping_package) VALUES($1,$2,$3::jsonb,$4::jsonb) RETURNING id',[tenant,'Direct draft',JSON.stringify(value),JSON.stringify({length_cm:20,width_cm:null})]);assert.deepEqual((await stored(p)).commercial_presentation,value);assert.deepEqual((await stored(p)).shipping_package,{length_cm:20,width_cm:null});
  for(const [productInfo,packageInfo,pattern] of [[{dimensions:{width_mm:0}},{length_cm:20},/products_commercial_presentation_valid/],[value,{length_cm:-1},/products_shipping_package_valid/]]){
   const before=await completeState();await assert.rejects(db.query('INSERT INTO products(tenant_id,name,commercial_presentation,shipping_package) VALUES($1,$2,$3::jsonb,$4::jsonb)',[tenant,'Invalid direct',JSON.stringify(productInfo),JSON.stringify(packageInfo)]),pattern);await assert.rejects(db.query('UPDATE products SET commercial_presentation=$2::jsonb,shipping_package=$3::jsonb WHERE id=$1',[p,JSON.stringify(productInfo),JSON.stringify(packageInfo)]),pattern);assert.deepEqual(await completeState(),before);
  }
  await login(otherOwner);await assert.rejects(db.query("INSERT INTO products(tenant_id,name,commercial_presentation) VALUES($1,'Foreign direct',$2::jsonb)",[tenant,JSON.stringify(value)]),/row-level security/);await login(viewer);await assert.rejects(db.query("INSERT INTO products(tenant_id,name,commercial_presentation) VALUES($1,'Viewer direct',$2::jsonb)",[tenant,JSON.stringify(value)]),/row-level security/);await login(owner);
 });
 await test('Composition pricing still saves complete costs with presentation and does not turn dimensions into recipe inputs',async()=>{
  const {p}=await fullFixture();await save(await form(p),p);const before=await snapshot(p),plateBefore=await plates(p),stockBefore=await rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id');
  await save(await form(p,{commercial_presentation:presentation()}),p);const after=await snapshot(p),saved=await stored(p);assert.deepEqual(saved.commercial_presentation,presentation());near(saved.cost_estimate,before.cost_per_unit);assert.equal(saved.manual_cost_override,null);assert.deepEqual(after.bom,before.bom);assert.deepEqual(await plates(p),plateBefore);assert.deepEqual(await rows('SELECT id,current_stock,avg_cost FROM inventory_items ORDER BY id'),stockBefore);assert.equal(JSON.stringify(after.bom).includes('commercial_presentation'),false);
 });
 await test('A product and channel acceptance save presentation atomically without changing the global base price',async()=>{
  const policy=await scalar("SELECT channel_pricing_policy('mercado_livre')");await scalar("SELECT save_channel_pricing_policy('mercado_livre',$1::jsonb,$2,$3)",[JSON.stringify(channelConditions),policy.revision,next()]);
  const p=await save(manual({commercial_presentation:presentation(),channel_pricing:[await channelEntry()]})),saved=await stored(p);assert.deepEqual(saved.commercial_presentation,presentation());near(saved.sale_price,25);near(saved.manual_cost_override,10);near(await scalar("SELECT unit_price FROM product_channel_prices WHERE product_id=$1 AND channel='mercado_livre'",[p]),30);assert.equal(await scalar('SELECT count(*)::int FROM product_channel_pricing_acceptances WHERE product_id=$1',[p]),1);
 });
 await test('A stale channel policy or invalid presentation rolls back the entire combined save',async()=>{
  const entry=await channelEntry(),before=await completeState();await assert.rejects(save(manual({commercial_presentation:presentation(),channel_pricing:[{...entry,expected_policy_revision:'stale'}],stock:{unit:'un',avg_cost:10,current_stock:2}})),/condições do canal mudaram/);assert.deepEqual(await completeState(),before);
  await assert.rejects(save(manual({commercial_presentation:{dimensions:{height_mm:-1}},channel_pricing:[entry]})),/medidas e os dados/);assert.deepEqual(await completeState(),before);
 });
 await test('Accepted channel-save retries keep the predecessor financial-role gate even though presentation replay returns early',async()=>{
  const operator=id(11);await admin(async()=>{await db.query("INSERT INTO auth.users VALUES($1,'operator@presentation.invalid')",[operator]);await db.query("INSERT INTO profiles(user_id,tenant_id,display_name) VALUES($1,$2,'Operator')",[operator,tenant]);await db.query("INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'operator')",[operator,tenant]);});
  const data=manual({commercial_presentation:presentation(),channel_pricing:[await channelEntry()]}),key=next(),p=await save(data,null,key),before=await completeState();await login(operator);await assert.rejects(save(data,null,key),/permissão/);await login(owner);assert.deepEqual(await completeState(),before);assert.equal(await save(data,null,key),p);
 });
 await test('Tenant scope, viewer write restrictions and private predecessor isolation still apply',async()=>{
  const p=await save(manual({commercial_presentation:presentation()})),before=await stored(p);await login(otherOwner);await assert.rejects(save(manual({commercial_presentation:null}),p),/não encontrado|outra empresa/);assert.equal((await db.query('UPDATE products SET commercial_presentation=NULL WHERE id=$1',[p])).affectedRows,0);await login(viewer);await assert.rejects(save(manual({commercial_presentation:null}),p),/permissão/);await login(owner);assert.deepEqual(await stored(p),before);await assert.rejects(scalar("SELECT erp_private.save_product_before_presentation($1,'{}','[]',$2)",[p,next()]),/permission denied/);
 });
 await test('The forward migration is retry-safe and rejects unreviewed public save or validator changes',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261102235000_commercial_product_presentation.sql',import.meta.url),'utf8');await admin(async()=>{
   const signature='public.save_product_with_photos(uuid,jsonb,jsonb,uuid)',definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);await db.exec(migration);assert.equal(await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]),definition);
   try{await db.exec(definition.replace('DECLARE t uuid:=erp_private.actor();','-- Unreviewed wrapper\nDECLARE t uuid:=erp_private.actor();'));await assert.rejects(db.exec(migration),/Review the commercial product save/);}finally{await db.exec(definition);}
   const validation='erp_private.valid_product_commercial_presentation(jsonb)',validator=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[validation]);try{await db.exec(validator.replace('DECLARE dims jsonb;','-- Unreviewed validation\nDECLARE dims jsonb;'));await assert.rejects(db.exec(migration),/Review the commercial product presentation validator/);}finally{await db.exec(validator);}
  });
 });
 await test('The CHECK privilege repair retries safely and refuses an unreviewed validator rather than granting it execution',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261102235100_restore_check_validator_permissions.sql',import.meta.url),'utf8');await admin(async()=>{await db.exec(migration);const signature='erp_private.product_shipping_package_valid(jsonb)',definition=await scalar('SELECT pg_get_functiondef($1::regprocedure)',[signature]);try{await db.exec(definition.replace('DECLARE field text;','-- Unreviewed validator\nDECLARE field text;'));await assert.rejects(db.exec(migration),/Review the pure CHECK validators/);}finally{await db.exec(definition);}});
 });
 console.log(`Commercial product presentation: ${passed} validation, pricing, atomic-save and replay groups passed.`);
}finally{await db.close();}
