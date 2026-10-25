-- Commercial simulations only: no production accounting, stock or historical
-- quote is rewritten. NULL remains unknown; an explicit zero is meaningful.
CREATE TABLE erp_private.pricing_policies(
 id uuid NOT NULL DEFAULT gen_random_uuid(),tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE erp_private.product_pricing_plans(
 product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON erp_private.pricing_policies,erp_private.product_pricing_plans FROM PUBLIC,anon,authenticated;

CREATE FUNCTION erp_private.check_pricing_values(p_data jsonb,p_tenant uuid,p_product uuid DEFAULT NULL,p_global boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE k text; v jsonb; n numeric; row jsonb; seen text[]:='{}'; ref uuid;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>65536 THEN RAISE EXCEPTION 'Parâmetros de precificação inválidos.'; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(p_data) LOOP
  IF k=ANY(ARRAY['energy_cost_kwh','labor_cost_hour','overhead_percent','target_margin','machine_hour_cost','handling_minutes_per_plate','finishing_minutes_per_piece','assembly_minutes_per_product','extras_cost_per_product']) THEN
   IF v='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'Informe um número ou deixe não informado: %.',k; END IF;
   n:=(v#>>'{}')::numeric;
   IF NOT erp_private.valid_number(n) OR n>1000000 OR (k='target_margin' AND n>=100) OR (k='overhead_percent' AND n>1000) THEN RAISE EXCEPTION 'Parâmetro de precificação fora do limite: %.',k; END IF;
  ELSIF k='cost_basis' AND NOT p_global THEN
   IF v NOT IN('"unit"'::jsonb,'"exclusive_lot"'::jsonb) THEN RAISE EXCEPTION 'Base de custo inválida.'; END IF;
  ELSIF k='printer_hour_costs' AND p_global THEN
   IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>200 THEN RAISE EXCEPTION 'Tarifas de impressoras inválidas.'; END IF;
   FOR row IN SELECT value FROM jsonb_array_elements(v) LOOP
    IF jsonb_typeof(row)<>'object' OR NOT row ? 'printer_id' OR NOT row ? 'hour_cost' OR EXISTS(SELECT 1 FROM jsonb_object_keys(row) x WHERE x NOT IN('printer_id','hour_cost')) THEN RAISE EXCEPTION 'Tarifa de impressora inválida.'; END IF;
    ref:=(row->>'printer_id')::uuid;
    IF ref IS NULL OR ref::text=ANY(seen) OR NOT EXISTS(SELECT 1 FROM printers WHERE id=ref AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'Selecione uma impressora desta empresa uma única vez.'; END IF;
    seen:=array_append(seen,ref::text);
    IF jsonb_typeof(row->'hour_cost') IS DISTINCT FROM 'number' OR NOT erp_private.valid_number((row->>'hour_cost')::numeric) OR (row->>'hour_cost')::numeric>1000000 THEN RAISE EXCEPTION 'Informe a tarifa comercial da impressora, inclusive zero quando confirmado.'; END IF;
   END LOOP;
  ELSIF k='printer_id' AND NOT p_global THEN
   ref:=(v#>>'{}')::uuid;
   IF ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers WHERE id=ref AND tenant_id=p_tenant AND is_active) THEN RAISE EXCEPTION 'Impressora indisponível nesta empresa.'; END IF;
  ELSIF k='plates' AND NOT p_global THEN
   IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>500 THEN RAISE EXCEPTION 'Ajustes de placas inválidos.'; END IF;
   FOR row IN SELECT value FROM jsonb_array_elements(v) LOOP
    IF jsonb_typeof(row)<>'object' OR NOT row ? 'plate_id' OR EXISTS(SELECT 1 FROM jsonb_object_keys(row) x WHERE x NOT IN('plate_id','printer_id','machine_hour_cost','handling_minutes')) THEN RAISE EXCEPTION 'Ajuste de placa inválido.'; END IF;
    ref:=(row->>'plate_id')::uuid;
    IF ref IS NULL OR ref::text=ANY(seen) OR NOT EXISTS(SELECT 1 FROM product_print_plates WHERE id=ref AND tenant_id=p_tenant AND product_id=p_product AND is_active) THEN RAISE EXCEPTION 'Selecione uma placa ativa deste produto uma única vez.'; END IF;
    seen:=array_append(seen,ref::text);
    PERFORM erp_private.check_pricing_values((row-'plate_id'-'handling_minutes')||CASE WHEN row ? 'handling_minutes' THEN jsonb_build_object('handling_minutes_per_plate',row->'handling_minutes') ELSE '{}'::jsonb END,p_tenant,p_product,false);
   END LOOP;
  ELSIF k='consumables' AND NOT p_global THEN
   IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>100 THEN RAISE EXCEPTION 'Insumos inválidos.'; END IF;
   FOR row IN SELECT value FROM jsonb_array_elements(v) LOOP
    IF jsonb_typeof(row)<>'object' OR NOT row ?& ARRAY['item_id','quantity'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(row) x WHERE x NOT IN('item_id','quantity')) THEN RAISE EXCEPTION 'Insumo inválido.'; END IF;
    ref:=(row->>'item_id')::uuid;
    IF ref IS NULL OR ('item:'||ref::text)=ANY(seen) OR NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=ref AND tenant_id=p_tenant AND is_active) THEN RAISE EXCEPTION 'Selecione um insumo ativo desta empresa uma única vez.'; END IF;
    seen:=array_append(seen,'item:'||ref::text);
    IF jsonb_typeof(row->'quantity') IS DISTINCT FROM 'number' OR NOT erp_private.valid_number((row->>'quantity')::numeric,0.000001) OR (row->>'quantity')::numeric>1000000 THEN RAISE EXCEPTION 'Quantidade de insumo inválida.'; END IF;
   END LOOP;
  ELSE RAISE EXCEPTION 'Campo de precificação inválido: %.',k;
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION erp_private.read_pricing_settings(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE saved jsonb:='{}'; legacy jsonb; result jsonb:='{}'; k text; v jsonb; stamp text;
BEGIN
 SELECT settings INTO legacy FROM tenants WHERE id=p_tenant;
 SELECT config,updated_at::text INTO saved,stamp FROM erp_private.pricing_policies WHERE tenant_id=p_tenant;
 saved:=coalesce(saved,'{}');
 FOREACH k IN ARRAY ARRAY['energy_cost_kwh','labor_cost_hour','overhead_percent','target_margin','machine_hour_cost','handling_minutes_per_plate','finishing_minutes_per_piece','assembly_minutes_per_product','extras_cost_per_product'] LOOP
  v:=CASE WHEN saved ? k THEN saved->k WHEN k=ANY(ARRAY['energy_cost_kwh','labor_cost_hour','overhead_percent','target_margin']) THEN legacy->k END;
  IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR NOT erp_private.valid_number((v#>>'{}')::numeric) OR (v#>>'{}')::numeric>1000000 OR (k='target_margin' AND (v#>>'{}')::numeric>=100) OR (k='overhead_percent' AND (v#>>'{}')::numeric>1000) THEN v:='null'; END IF;
  result:=result||jsonb_build_object(k,v);
 END LOOP;
 result:=result||jsonb_build_object('printer_hour_costs',coalesce(saved->'printer_hour_costs','[]'::jsonb));
 RETURN result||jsonb_build_object('revision',md5(jsonb_build_array(result,stamp)::text),'machine_rate_scope','commercial_excludes_energy');
END $$;
CREATE FUNCTION public.pricing_settings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Entre na sua empresa para consultar custos.' USING ERRCODE='42501'; END IF;
 RETURN erp_private.read_pricing_settings(t);
END $$;
CREATE FUNCTION public.save_pricing_settings(p_settings jsonb,p_expected_revision text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; current jsonb; legacy_patch jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'pricing_settings',jsonb_build_array(p_settings,p_expected_revision)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 current:=erp_private.read_pricing_settings(t);
 IF p_expected_revision IS DISTINCT FROM current->>'revision' THEN RAISE EXCEPTION 'Os parâmetros mudaram. Reabra antes de salvar.'; END IF;
 PERFORM erp_private.check_pricing_values(p_settings,t,NULL,true);
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO legacy_patch FROM jsonb_each(p_settings)
 WHERE key=ANY(ARRAY['energy_cost_kwh','labor_cost_hour','overhead_percent','target_margin']) AND value<>'null'::jsonb;
 -- Explicit tariffs become the reference for FUTURE operational calculations;
 -- already-posted records and their frozen valuation snapshots stay untouched.
 UPDATE tenants SET settings=coalesce(settings,'{}')||legacy_patch WHERE id=t;
 INSERT INTO erp_private.pricing_policies(tenant_id,config) VALUES(t,p_settings)
 ON CONFLICT(tenant_id) DO UPDATE SET config=excluded.config,updated_at=clock_timestamp() RETURNING id INTO result;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'save_pricing_settings','pricing_policies',result,p_settings);
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION erp_private.pricing_plan(p_product uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('plan',coalesce((SELECT plan FROM erp_private.product_pricing_plans WHERE product_id=p_product AND tenant_id=p_tenant),'{}'),
 'revision',md5(jsonb_build_array(p.id,p.updated_at,(SELECT jsonb_build_array(plan,updated_at) FROM erp_private.product_pricing_plans WHERE product_id=p.id AND tenant_id=p_tenant))::text))
 FROM products p WHERE p.id=p_product AND p.tenant_id=p_tenant
$$;
CREATE FUNCTION public.product_pricing_plan(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar a precificação.' USING ERRCODE='42501'; END IF;
 result:=erp_private.pricing_plan(p_product_id,get_user_tenant_id()); IF result IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF; RETURN result;
END $$;
CREATE FUNCTION public.save_product_pricing_plan(p_product_id uuid,p_plan jsonb,p_expected_revision text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; current jsonb; BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product_pricing_plan',jsonb_build_array(p_product_id,p_plan,p_expected_revision)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 current:=erp_private.pricing_plan(p_product_id,t);
 IF p_expected_revision IS DISTINCT FROM current->>'revision' THEN RAISE EXCEPTION 'O plano de precificação mudou. Reabra antes de salvar.'; END IF;
 PERFORM erp_private.check_pricing_values(p_plan,t,p_product_id,false);
 INSERT INTO erp_private.product_pricing_plans(product_id,tenant_id,plan) VALUES(p_product_id,t,p_plan)
 ON CONFLICT(product_id) DO UPDATE SET plan=excluded.plan,updated_at=clock_timestamp();
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'save_product_pricing_plan','products',p_product_id,p_plan);
 PERFORM erp_private.finish_request(t,p_request_id,p_product_id); RETURN p_product_id;
END $$;

-- Material lines are exact stock units or explicit per-kg technical rates. No
-- new item, stock balance, geometry-derived grams or opaque legacy total enters.
CREATE FUNCTION erp_private.pricing_materials(p_lines jsonb,p_tenant uuid,p_factor numeric DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE line jsonb; item inventory_items; result jsonb:='[]'; missing jsonb:='[]'; grams numeric; rate numeric; total numeric:=0; cost numeric; BEGIN
 IF jsonb_array_length(coalesce(p_lines,'[]'))=0 THEN missing:=jsonb_build_array('Consumo de filamento não informado.'); END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(coalesce(p_lines,'[]')) LOOP
  SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=p_tenant AND is_active AND unit IN('g','kg');
  grams:=(line->>'grams')::numeric; rate:=(line->>'cost_per_kg')::numeric;
  IF rate IS NULL AND item.id IS NOT NULL AND (item.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements mov WHERE mov.item_id=item.id AND mov.tenant_id=p_tenant AND mov.movement_type='purchase_in' AND mov.quantity>0 AND mov.unit_cost=0)) THEN rate:=item.avg_cost*CASE WHEN item.unit='g' THEN 1000 ELSE 1 END; END IF;
  cost:=NULL;
  IF NOT erp_private.valid_number(grams) THEN missing:=missing||jsonb_build_array('Gramas de um filamento não informados.');
  ELSIF NOT erp_private.valid_number(rate) THEN missing:=missing||jsonb_build_array('Custo do filamento não informado: '||coalesce(item.name,line->>'material','filamento')); ELSE cost:=grams*p_factor*rate/1000; total:=total+cost; END IF;
  result:=result||jsonb_build_array(line||jsonb_build_object('grams',grams*p_factor,'resolved_cost_per_kg',rate,'cost',cost,'name',coalesce(item.name,line->>'material'),'color',coalesce(line->>'color',item.color)));
 END LOOP;
 RETURN jsonb_build_object('lines',result,'material',total,'complete',jsonb_array_length(missing)=0,'missing',missing);
END $$;

CREATE FUNCTION erp_private.pricing_plate(p_plate uuid,p_tenant uuid,p_runs numeric,p_policy jsonb,p_plan jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE pp product_print_plates; machine printers; po jsonb:='{}'; recipe jsonb; learned jsonb; materials jsonb; lines jsonb; spec jsonb;
 missing jsonb:='[]'; seconds numeric; watts numeric; rate numeric; kwh numeric; labor_rate numeric; handling numeric; energy numeric; machine_cost numeric; handling_cost numeric;
 basis text:='slice_plan'; physical integer; n integer; BEGIN
 SELECT * INTO pp FROM product_print_plates WHERE id=p_plate AND tenant_id=p_tenant AND is_active;
 IF pp.id IS NULL THEN RETURN jsonb_build_object('complete',false,'missing',jsonb_build_array('Placa indisponível.'),'material',0,'energy',0,'machine',0,'handling',0); END IF;
 SELECT value INTO po FROM jsonb_array_elements(coalesce(p_plan->'plates','[]')) WHERE value->>'plate_id'=pp.id::text; po:=coalesce(po,'{}');
 SELECT * INTO machine FROM printers WHERE id=CASE WHEN po ? 'printer_id' THEN (po->>'printer_id')::uuid ELSE coalesce((p_plan->>'printer_id')::uuid,pp.printer_id) END AND tenant_id=p_tenant AND is_active;
 IF machine.id IS NULL THEN missing:=missing||jsonb_build_array('Selecione a impressora da placa '||pp.label||'.'); END IF;
 rate:=CASE WHEN po ? 'machine_hour_cost' THEN (po->>'machine_hour_cost')::numeric ELSE coalesce((SELECT (x->>'hour_cost')::numeric FROM jsonb_array_elements(coalesce(p_policy->'printer_hour_costs','[]')) x WHERE x->>'printer_id'=machine.id::text),(p_policy->>'machine_hour_cost')::numeric) END;
 kwh:=(p_policy->>'energy_cost_kwh')::numeric; labor_rate:=(p_policy->>'labor_cost_hour')::numeric; watts:=machine.power_watts;
 handling:=CASE WHEN po ? 'handling_minutes' THEN (po->>'handling_minutes')::numeric ELSE (p_plan->>'handling_minutes_per_plate')::numeric END;
 seconds:=pp.est_time_seconds;
 learned:=erp_private.read_plate_learning(pp.id,p_tenant);
 IF learned IS NOT NULL THEN
  SELECT coalesce(sum(quantity_per_plate),0)::integer INTO physical FROM (SELECT quantity_per_plate FROM product_subitems WHERE plate_id=pp.id AND tenant_id=p_tenant UNION ALL SELECT quantity_per_plate FROM product_file_piece_links WHERE plate_id=pp.id AND tenant_id=p_tenant) q;
  IF physical>0 THEN seconds:=(learned->>'print_seconds')::numeric*physical; lines:=learned->'materials'; materials:=erp_private.pricing_materials(lines,p_tenant,physical); basis:='bambu_verified'; END IF;
 END IF;
 IF materials IS NULL THEN
  recipe:=erp_private.product_material_recipe_snapshot(pp.product_id,p_tenant,pp.id);
  IF jsonb_array_length(coalesce(recipe->'lines','[]'))>0 THEN
   SELECT jsonb_agg(jsonb_build_object('item_id',x->>'item_id','grams',x->'grams_per_print','material',x->>'name','color',x->>'color')) INTO lines FROM jsonb_array_elements(recipe->'lines') x;
   basis:='confirmed_recipe';
  ELSIF jsonb_array_length(pp.imported_filaments)>0 THEN
   SELECT jsonb_agg(jsonb_build_object('item_id',x->>'item_id','grams',x->'grams','material',x->>'type','color',x->>'color')) INTO lines FROM jsonb_array_elements(erp_private.import_filament_matches(p_tenant,pp.imported_filaments)) x;
  ELSE lines:=jsonb_build_array(jsonb_build_object('item_id',pp.material_id,'grams',pp.est_grams)); END IF;
  materials:=erp_private.pricing_materials(lines,p_tenant);
 END IF;
 missing:=missing||(materials->'missing');
 IF NOT erp_private.valid_number(seconds,0.000001) THEN missing:=missing||jsonb_build_array('Tempo de impressão não informado na placa '||pp.label||'.'); END IF;
 IF NOT erp_private.valid_number(kwh) OR NOT erp_private.valid_number(watts) THEN missing:=missing||jsonb_build_array('Confirme tarifa de energia e potência da impressora.'); ELSE energy:=seconds/3600*watts/1000*kwh*p_runs; END IF;
 IF NOT erp_private.valid_number(rate) THEN missing:=missing||jsonb_build_array('Confirme a hora-máquina comercial da placa '||pp.label||'.'); ELSE machine_cost:=seconds/3600*rate*p_runs; END IF;
 IF NOT erp_private.valid_number(handling) OR NOT erp_private.valid_number(labor_rate) THEN missing:=missing||jsonb_build_array('Confirme manipulação por placa e valor da mão de obra.'); ELSE handling_cost:=handling/60*labor_rate*p_runs; END IF;
 RETURN jsonb_build_object('plate_id',pp.id,'product_id',pp.product_id,'label',pp.label,'plate_index',pp.plate_index,'runs',p_runs,'source',basis,
  'printer_id',machine.id,'printer_name',machine.name,'print_seconds_per_run',seconds,'handling_minutes_per_run',handling,'machine_hour_cost',rate,'energy_cost_kwh',kwh,'power_watts',watts,'materials',materials->'lines',
  'source_revision',erp_private.print_plate_source_fingerprint(pp.id,p_tenant),
  'material',(materials->>'material')::numeric*p_runs,'energy',energy,'machine',machine_cost,'handling',handling_cost,'complete',jsonb_array_length(missing)=0,'missing',missing,
  'production_costs',jsonb_build_object('material',(materials->>'material')::numeric*ceil(p_runs),'energy',energy*ceil(p_runs)/p_runs,'machine',machine_cost*ceil(p_runs)/p_runs,'handling',handling_cost*ceil(p_runs)/p_runs),
  'legacy_non_material_cost_reference',recipe->'non_material_cost_per_unit');
END $$;

CREATE FUNCTION erp_private.pricing_product(p_product uuid,p_tenant uuid,p_quantity integer,p_policy jsonb,p_overrides jsonb,p_path uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE p products; stored jsonb; cfg jsonb; c record; pp product_print_plates; part jsonb; item inventory_items; child jsonb; plate_result jsonb; spec jsonb; mats jsonb;
 missing jsonb:='[]'; components jsonb:='[]'; plates jsonb:='[]'; consumables jsonb:='[]'; run_map jsonb:='{}'; run_details jsonb:='[]'; req integer; runs numeric; k text;
 totals jsonb:='{"material":0,"energy":0,"machine":0,"handling":0,"finishing":0,"assembly":0,"extras":0,"overhead":0}'; production jsonb:=totals; own_production jsonb:=totals; selected jsonb; local_values jsonb;
 material_cost numeric:=0; energy numeric:=0; machine_cost numeric:=0; handling numeric:=0; finishing numeric:=0; assembly_cost numeric; extras numeric:=0; piece_extras numeric:=0; overhead numeric; production_overhead numeric; total numeric; unit_cost numeric; production_total numeric; technical_total numeric; margin numeric; assembly_minutes numeric; labor_rate numeric; finish_seconds numeric; seconds numeric; rate numeric; cost_value numeric; standalone_ratio numeric; cost_basis text; BEGIN
 IF p_product=ANY(p_path) OR cardinality(p_path)>=20 THEN RETURN jsonb_build_object('complete',false,'missing',jsonb_build_array('Composição cíclica ou muito profunda.'),'breakdown',totals); END IF;
 SELECT * INTO p FROM products WHERE id=p_product AND tenant_id=p_tenant AND is_active;
 IF p.id IS NULL THEN RETURN jsonb_build_object('complete',false,'missing',jsonb_build_array('Produto não encontrado ou arquivado.'),'breakdown',totals); END IF;
 stored:=erp_private.pricing_plan(p.id,p_tenant); cfg:=p_policy||coalesce(stored->'plan','{}')||p_overrides; cost_basis:=coalesce(cfg->>'cost_basis','unit');
 IF EXISTS(SELECT 1 FROM product_subitems WHERE product_id=p.id AND tenant_id=p_tenant) THEN
  FOR c IN SELECT b.*,cp.name FROM product_subitems b JOIN products cp ON cp.id=b.component_product_id AND cp.tenant_id=b.tenant_id WHERE b.product_id=p.id AND b.tenant_id=p_tenant ORDER BY b.sort_order,b.id LOOP
   IF c.quantity_per_product IS NULL THEN missing:=missing||jsonb_build_array('Confirme a quantidade por produto de '||c.name||'.'); CONTINUE; END IF;
   req:=p_quantity*c.quantity_per_product;
   IF req>1000000 THEN RAISE EXCEPTION 'A composição exige peças demais. Divida em lotes menores.'; END IF;
   spec:=erp_private.read_piece_spec(c.component_product_id,p_tenant,c.id);
   components:=components||jsonb_build_array(jsonb_build_object('subitem_id',c.id,'component_product_id',c.component_product_id,'name',c.name,'quantity_per_product',c.quantity_per_product,'required_quantity',req,'plate_id',c.plate_id,'quantity_per_plate',c.quantity_per_plate,'technical',erp_private.read_piece_spec(c.component_product_id,p_tenant,c.id)));
   IF c.plate_id IS NOT NULL THEN
    IF c.quantity_per_plate IS NULL THEN missing:=missing||jsonb_build_array('Confirme as cópias por placa de '||c.name||'.'); CONTINUE; END IF;
    runs:=req::numeric/c.quantity_per_plate; run_map:=jsonb_set(run_map,ARRAY[c.plate_id::text],to_jsonb(greatest(coalesce((run_map->>c.plate_id::text)::numeric,0),runs)));
    finish_seconds:=CASE WHEN (coalesce(stored->'plan','{}')||p_overrides) ? 'finishing_minutes_per_piece' THEN (cfg->>'finishing_minutes_per_piece')::numeric*60 ELSE coalesce((spec->>'finishing_seconds')::numeric,(cfg->>'finishing_minutes_per_piece')::numeric*60) END;
    labor_rate:=CASE WHEN (coalesce(stored->'plan','{}')||p_overrides) ? 'labor_cost_hour' THEN (cfg->>'labor_cost_hour')::numeric ELSE coalesce((spec->>'labor_hour_cost')::numeric,(cfg->>'labor_cost_hour')::numeric) END;
    IF finish_seconds IS NULL OR labor_rate IS NULL THEN missing:=missing||jsonb_build_array('Confirme o acabamento por peça e mão de obra de '||c.name||'.'); ELSE finishing:=finishing+finish_seconds/3600*labor_rate*req; END IF;
    piece_extras:=piece_extras+coalesce((spec->>'extra_cost')::numeric,0)*req;
   ELSE
    child:=erp_private.pricing_product(c.component_product_id,p_tenant,req,p_policy,'{}',p_path||p.id);
    components:=jsonb_set(components,ARRAY[(jsonb_array_length(components)-1)::text,'pricing'],child);
    missing:=missing||coalesce(child->'missing','[]');
    FOREACH k IN ARRAY ARRAY['material','energy','machine','handling','finishing','assembly','extras','overhead'] LOOP
     totals:=jsonb_set(totals,ARRAY[k],to_jsonb((totals->>k)::numeric+coalesce((child->'technical_breakdown'->>k)::numeric,0)));
     production:=jsonb_set(production,ARRAY[k],to_jsonb((production->>k)::numeric+coalesce((child->'production_breakdown'->>k)::numeric,0)));
    END LOOP;
   END IF;
  END LOOP;
 ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.extras,'[]')) x WHERE x ? '_kit_product_id') THEN
  FOR part IN SELECT value FROM jsonb_array_elements(p.extras) LOOP
   IF part ? '_kit_product_id' THEN
    req:=(part->>'_kit_qty')::integer*p_quantity;
    IF req IS NULL OR req NOT BETWEEN 1 AND 10000 THEN missing:=missing||jsonb_build_array('Quantidade de kit inválida.'); CONTINUE; END IF;
    child:=erp_private.pricing_product((part->>'_kit_product_id')::uuid,p_tenant,req,p_policy,'{}',p_path||p.id); components:=components||jsonb_build_array(jsonb_build_object('component_product_id',part->>'_kit_product_id','required_quantity',req,'pricing',child)); missing:=missing||coalesce(child->'missing','[]');
    FOREACH k IN ARRAY ARRAY['material','energy','machine','handling','finishing','assembly','extras','overhead'] LOOP
     totals:=jsonb_set(totals,ARRAY[k],to_jsonb((totals->>k)::numeric+coalesce((child->'technical_breakdown'->>k)::numeric,0)));
     production:=jsonb_set(production,ARRAY[k],to_jsonb((production->>k)::numeric+coalesce((child->'production_breakdown'->>k)::numeric,0)));
    END LOOP;
   END IF;
  END LOOP;
 ELSE
  FOR pp IN SELECT * FROM product_print_plates WHERE product_id=p.id AND tenant_id=p_tenant AND is_active ORDER BY plate_index,id LOOP
   IF pp.units_per_plate IS NULL THEN missing:=missing||jsonb_build_array('Confirme o rendimento da placa '||pp.label||'.'); CONTINUE; END IF;
   run_map:=jsonb_set(run_map,ARRAY[pp.id::text],to_jsonb(p_quantity::numeric/pp.units_per_plate));
  END LOOP;
  IF run_map='{}' THEN
   spec:=erp_private.read_piece_spec(p.id,p_tenant);
   IF spec->>'source'<>'unknown' THEN
    mats:=erp_private.pricing_materials(spec->'materials',p_tenant,p_quantity); missing:=missing||(mats->'missing'); material_cost:=(mats->>'material')::numeric;
    seconds:=(spec->>'print_seconds')::numeric*p_quantity;
   ELSE
    mats:=erp_private.pricing_materials(jsonb_build_array(jsonb_build_object('item_id',p.material_id,'grams',p.est_grams)),p_tenant,p_quantity/nullif(p.prints_per_plate,0)::numeric); missing:=missing||(mats->'missing'); material_cost:=(mats->>'material')::numeric;
    seconds:=p.est_time_minutes*60*p_quantity/nullif(p.prints_per_plate,0)::numeric;
   END IF;
   IF NOT erp_private.valid_number(seconds,0.000001) THEN missing:=missing||jsonb_build_array('Tempo de impressão ou rendimento não informado para '||p.name||'.'); END IF;
   SELECT coalesce((SELECT (x->>'hour_cost')::numeric FROM jsonb_array_elements(coalesce(cfg->'printer_hour_costs','[]')) x WHERE x->>'printer_id'=cfg->>'printer_id'),(cfg->>'machine_hour_cost')::numeric) INTO rate;
   IF NOT erp_private.valid_number(rate) THEN missing:=missing||jsonb_build_array('Confirme a hora-máquina comercial.'); ELSE machine_cost:=seconds/3600*rate; END IF;
   -- Without a concrete printer, watts cannot be fabricated from the time.
   SELECT power_watts INTO cost_value FROM printers WHERE id=(cfg->>'printer_id')::uuid AND tenant_id=p_tenant AND is_active;
   IF NOT erp_private.valid_number(cost_value) OR NOT erp_private.valid_number((cfg->>'energy_cost_kwh')::numeric) THEN missing:=missing||jsonb_build_array('Selecione a impressora e confirme potência e energia.'); ELSE energy:=seconds/3600*cost_value/1000*(cfg->>'energy_cost_kwh')::numeric; END IF;
   standalone_ratio:=p_quantity::numeric/nullif(coalesce((spec->>'pieces_per_plate')::integer,p.prints_per_plate),0);
   IF standalone_ratio IS NULL THEN missing:=missing||jsonb_build_array('Confirme o rendimento de peças por impressão.'); END IF;
   IF NOT erp_private.valid_number((cfg->>'handling_minutes_per_plate')::numeric) OR NOT erp_private.valid_number((cfg->>'labor_cost_hour')::numeric) THEN missing:=missing||jsonb_build_array('Confirme manipulação por impressão e mão de obra.'); ELSE handling:=standalone_ratio*(cfg->>'handling_minutes_per_plate')::numeric/60*(cfg->>'labor_cost_hour')::numeric; END IF;
   FOREACH k IN ARRAY ARRAY['material','energy','machine','handling'] LOOP
    cost_value:=CASE k WHEN 'material' THEN material_cost WHEN 'energy' THEN energy WHEN 'machine' THEN machine_cost ELSE handling END;
    own_production:=jsonb_set(own_production,ARRAY[k],to_jsonb(coalesce(cost_value*ceil(standalone_ratio)/standalone_ratio,0)));
   END LOOP;
   run_details:=run_details||jsonb_build_array(jsonb_build_object('plate_id',NULL,'label',p.name,'required_runs',standalone_ratio,'full_runs',ceil(standalone_ratio),'surplus_units',ceil(standalone_ratio)*coalesce((spec->>'pieces_per_plate')::integer,p.prints_per_plate)-p_quantity));
  END IF;
  spec:=erp_private.read_piece_spec(p.id,p_tenant);
  piece_extras:=piece_extras+coalesce((spec->>'extra_cost')::numeric,0)*p_quantity;
  finish_seconds:=CASE WHEN (coalesce(stored->'plan','{}')||p_overrides) ? 'finishing_minutes_per_piece' THEN (cfg->>'finishing_minutes_per_piece')::numeric*60 ELSE coalesce((spec->>'finishing_seconds')::numeric,(cfg->>'finishing_minutes_per_piece')::numeric*60) END;
  labor_rate:=CASE WHEN (coalesce(stored->'plan','{}')||p_overrides) ? 'labor_cost_hour' THEN (cfg->>'labor_cost_hour')::numeric ELSE coalesce((spec->>'labor_hour_cost')::numeric,(cfg->>'labor_cost_hour')::numeric) END;
  IF finish_seconds IS NULL OR labor_rate IS NULL THEN missing:=missing||jsonb_build_array('Confirme o acabamento por peça e mão de obra.'); ELSE finishing:=p_quantity*finish_seconds/3600*labor_rate; END IF;
 END IF;
 FOR k IN SELECT jsonb_object_keys(run_map) LOOP
  plate_result:=erp_private.pricing_plate(k::uuid,p_tenant,(run_map->>k)::numeric,cfg,cfg); plates:=plates||jsonb_build_array(plate_result); missing:=missing||coalesce(plate_result->'missing','[]');
  run_details:=run_details||jsonb_build_array(jsonb_build_object('plate_id',k,'label',plate_result->>'label','required_runs',(run_map->>k)::numeric,'full_runs',ceil((run_map->>k)::numeric),'source',plate_result->>'source',
   'outputs',CASE WHEN EXISTS(SELECT 1 FROM product_subitems WHERE plate_id=k::uuid AND tenant_id=p_tenant AND product_id=p.id) THEN
    (SELECT jsonb_agg(jsonb_build_object('component_product_id',b.component_product_id,'quantity_per_plate',b.quantity_per_plate,'required_quantity',p_quantity*b.quantity_per_product,'produced_quantity',ceil((run_map->>k)::numeric)*b.quantity_per_plate,'surplus_units',ceil((run_map->>k)::numeric)*b.quantity_per_plate-p_quantity*b.quantity_per_product)) FROM product_subitems b WHERE b.plate_id=k::uuid AND b.tenant_id=p_tenant AND b.product_id=p.id)
    ELSE jsonb_build_array(jsonb_build_object('product_id',p.id,'required_quantity',p_quantity,'produced_quantity',ceil((run_map->>k)::numeric)*(SELECT units_per_plate FROM product_print_plates WHERE id=k::uuid),'surplus_units',ceil((run_map->>k)::numeric)*(SELECT units_per_plate FROM product_print_plates WHERE id=k::uuid)-p_quantity)) END));
  own_production:=own_production||jsonb_build_object('material',(own_production->>'material')::numeric+coalesce((plate_result->'production_costs'->>'material')::numeric,0),'energy',(own_production->>'energy')::numeric+coalesce((plate_result->'production_costs'->>'energy')::numeric,0),'machine',(own_production->>'machine')::numeric+coalesce((plate_result->'production_costs'->>'machine')::numeric,0),'handling',(own_production->>'handling')::numeric+coalesce((plate_result->'production_costs'->>'handling')::numeric,0));
  material_cost:=material_cost+coalesce((plate_result->>'material')::numeric,0); energy:=energy+coalesce((plate_result->>'energy')::numeric,0); machine_cost:=machine_cost+coalesce((plate_result->>'machine')::numeric,0); handling:=handling+coalesce((plate_result->>'handling')::numeric,0);
 END LOOP;
 -- Final assembly and final consumables are charged once for this physical SKU.
 assembly_minutes:=(cfg->>'assembly_minutes_per_product')::numeric; labor_rate:=(cfg->>'labor_cost_hour')::numeric;
 -- A loose technical component has no final assembly/packaging stage merely
 -- because the parent uses it. Its own explicit plan can still price one.
 IF cardinality(p_path)>0 AND p.is_component THEN
  IF NOT(coalesce(stored->'plan','{}') ? 'assembly_minutes_per_product') THEN assembly_minutes:=0; END IF;
  IF NOT(coalesce(stored->'plan','{}') ? 'extras_cost_per_product') THEN cfg:=cfg||jsonb_build_object('extras_cost_per_product',0); END IF;
 END IF;
 IF NOT erp_private.valid_number(assembly_minutes) OR NOT erp_private.valid_number(labor_rate) THEN missing:=missing||jsonb_build_array('Confirme montagem/acabamento por produto e mão de obra.'); ELSE assembly_cost:=p_quantity*assembly_minutes/60*labor_rate; END IF;
 IF NOT erp_private.valid_number((cfg->>'extras_cost_per_product')::numeric) THEN missing:=missing||jsonb_build_array('Confirme os demais custos por produto, inclusive zero.'); ELSE extras:=(cfg->>'extras_cost_per_product')::numeric*p_quantity; END IF;
 extras:=extras+piece_extras;
 FOR part IN SELECT value FROM jsonb_array_elements(coalesce(p.extras,'[]')) WHERE NOT value ? '_kit_product_id' LOOP
  IF NOT erp_private.valid_number((part->>'cost')::numeric) THEN missing:=missing||jsonb_build_array('Custo adicional do cadastro não informado.'); ELSE extras:=extras+(part->>'cost')::numeric*p_quantity; END IF;
 END LOOP;
 FOR part IN SELECT value FROM jsonb_array_elements(coalesce(cfg->'consumables','[]')) LOOP
  SELECT * INTO item FROM inventory_items WHERE id=(part->>'item_id')::uuid AND tenant_id=p_tenant AND is_active;
  cost_value:=NULL;
  IF item.id IS NULL OR NOT(item.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements mov WHERE mov.item_id=item.id AND mov.tenant_id=p_tenant AND mov.movement_type='purchase_in' AND mov.quantity>0 AND mov.unit_cost=0)) THEN missing:=missing||jsonb_build_array('Custo do insumo não confirmado: '||coalesce(item.name,'insumo indisponível')); ELSE cost_value:=item.avg_cost*(part->>'quantity')::numeric*p_quantity; extras:=extras+cost_value; END IF;
  consumables:=consumables||jsonb_build_array(part||jsonb_build_object('name',item.name,'unit',item.unit,'unit_cost',item.avg_cost,'cost',cost_value));
 END LOOP;
 IF NOT erp_private.valid_number((cfg->>'overhead_percent')::numeric) THEN missing:=missing||jsonb_build_array('Confirme as despesas indiretas.'); ELSE
  overhead:=(material_cost+energy+machine_cost+handling+finishing+coalesce(assembly_cost,0))*(cfg->>'overhead_percent')::numeric/100;
  production_overhead:=((own_production->>'material')::numeric+(own_production->>'energy')::numeric+(own_production->>'machine')::numeric+(own_production->>'handling')::numeric+finishing+coalesce(assembly_cost,0))*(cfg->>'overhead_percent')::numeric/100;
 END IF;
 local_values:=jsonb_build_object('material',material_cost,'energy',energy,'machine',machine_cost,'handling',handling,'finishing',finishing,'assembly',coalesce(assembly_cost,0),'extras',extras,'overhead',coalesce(overhead,0));
 own_production:=own_production||jsonb_build_object('finishing',finishing,'assembly',coalesce(assembly_cost,0),'extras',extras,'overhead',coalesce(production_overhead,0));
 FOREACH k IN ARRAY ARRAY['material','energy','machine','handling','finishing','assembly','extras','overhead'] LOOP
  totals:=jsonb_set(totals,ARRAY[k],to_jsonb((totals->>k)::numeric+coalesce((local_values->>k)::numeric,0)));
  production:=jsonb_set(production,ARRAY[k],to_jsonb((production->>k)::numeric+(own_production->>k)::numeric));
 END LOOP;
 margin:=(cfg->>'target_margin')::numeric;
 IF margin IS NULL THEN missing:=missing||jsonb_build_array('Confirme a margem desejada sobre a venda.'); END IF;
 SELECT coalesce(jsonb_agg(v),'[]') INTO missing FROM (SELECT DISTINCT value v FROM jsonb_array_elements(missing)) m;
 selected:=CASE WHEN cost_basis='exclusive_lot' THEN production ELSE totals END;
 IF jsonb_array_length(missing)=0 THEN
  SELECT sum(v::text::numeric) INTO technical_total FROM jsonb_each(totals) AS x(key,v);
  SELECT sum(v::text::numeric) INTO production_total FROM jsonb_each(production) AS x(key,v);
  total:=CASE WHEN cost_basis='exclusive_lot' THEN production_total ELSE technical_total END; unit_cost:=total/p_quantity;
 END IF;
 RETURN jsonb_build_object('product_id',p.id,'product_name',p.name,'quantity',p_quantity,'complete',jsonb_array_length(missing)=0,'missing',missing,
  'revision',md5(jsonb_build_array(stored,p_policy,cfg,p_quantity,run_map,plates,components,consumables,totals,production,p.updated_at)::text),'plan_revision',stored->>'revision','plan',stored->'plan','components',components,'plates',plates,'runs',run_details,'consumables',consumables,'cost_basis',cost_basis,
  'breakdown',selected||jsonb_build_object('total_lot',total,'unit_cost',unit_cost),'technical_breakdown',totals||jsonb_build_object('total_lot',technical_total,'unit_cost',technical_total/p_quantity),'production_breakdown',production||jsonb_build_object('total_lot',production_total,'unit_cost',production_total/p_quantity),'margin_percent',margin,
  'suggested_unit_price',CASE WHEN unit_cost IS NOT NULL THEN ceil(unit_cost/(1-margin/100)*100)/100 END,'manual_cost_reference',p.manual_cost_override,
  'assembly_minutes_per_product',assembly_minutes,'settings_revision',p_policy->>'revision','cost_scope','commercial_simulation_no_stock_or_accounting');
END $$;

CREATE FUNCTION public.product_pricing_preview(p_product_id uuid,p_quantity integer DEFAULT 1,p_overrides jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE='42501'; END IF;
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe de 1 a 10000 produtos.'; END IF;
 PERFORM erp_private.check_pricing_values(p_overrides,t,p_product_id,false);
 RETURN erp_private.pricing_product(p_product_id,t,p_quantity,erp_private.read_pricing_settings(t),p_overrides,'{}');
END $$;
CREATE TABLE public.product_pricing_acceptances(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),product_id uuid NOT NULL REFERENCES products(id),
 quantity integer NOT NULL,cost_basis text NOT NULL,unit_cost numeric NOT NULL,unit_price numeric NOT NULL,
 preview_revision text NOT NULL,snapshot jsonb NOT NULL,created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE product_pricing_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_pricing_acceptances FROM PUBLIC,anon,authenticated;
GRANT SELECT ON product_pricing_acceptances TO authenticated;
CREATE POLICY pricing_acceptances_read ON product_pricing_acceptances FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE FUNCTION public.apply_product_pricing(p_product_id uuid,p_quantity integer,p_overrides jsonb,p_expected_revision text,p_request_id uuid,p_unit_price numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; preview jsonb; cost numeric; price numeric; BEGIN
 result:=erp_private.begin_request(t,p_request_id,'apply_product_pricing',jsonb_build_array(p_product_id,p_quantity,p_overrides,p_expected_revision,p_unit_price)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 preview:=public.product_pricing_preview(p_product_id,p_quantity,p_overrides);
 IF p_expected_revision IS DISTINCT FROM preview->>'revision' THEN RAISE EXCEPTION 'Custos ou parâmetros mudaram. Atualize a simulação antes de aplicar.'; END IF;
 IF preview->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Complete os parâmetros antes de aplicar a precificação.'; END IF;
 cost:=(preview->'breakdown'->>'unit_cost')::numeric; price:=coalesce(p_unit_price,(preview->>'suggested_unit_price')::numeric);
 IF NOT erp_private.valid_number(cost) OR cost>1000000000 OR NOT erp_private.valid_number(price,0.01) OR price>1000000000 OR price<>round(price,2) THEN RAISE EXCEPTION 'Custo ou preço aceito fora do limite.'; END IF;
 INSERT INTO product_pricing_acceptances(tenant_id,product_id,quantity,cost_basis,unit_cost,unit_price,preview_revision,snapshot,created_by)
 VALUES(t,p_product_id,p_quantity,preview->>'cost_basis',cost,price,p_expected_revision,preview,auth.uid()) RETURNING id INTO result;
 -- This is an explicit commercial acceptance. No stock valuation is changed.
 UPDATE products SET manual_cost_override=round(cost,6),cost_estimate=round(cost,6),sale_price=price,
 catalog_details=coalesce(catalog_details,'{}')||jsonb_build_object('base_cost',round(cost,6),'accessory_cost',0,'other_cost',0)
 WHERE id=p_product_id AND tenant_id=t;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'apply_product_pricing','products',p_product_id,jsonb_build_object('acceptance_id',result,'unit_cost',cost,'unit_price',price,'preview_revision',p_expected_revision));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION erp_private.check_pricing_values(jsonb,uuid,uuid,boolean),erp_private.read_pricing_settings(uuid),erp_private.pricing_plan(uuid,uuid),erp_private.pricing_materials(jsonb,uuid,numeric),erp_private.pricing_plate(uuid,uuid,numeric,jsonb,jsonb),erp_private.pricing_product(uuid,uuid,integer,jsonb,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pricing_settings(),public.save_pricing_settings(jsonb,text,uuid),public.product_pricing_plan(uuid),public.save_product_pricing_plan(uuid,jsonb,text,uuid),public.product_pricing_preview(uuid,integer,jsonb),public.apply_product_pricing(uuid,integer,jsonb,text,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pricing_settings(),public.save_pricing_settings(jsonb,text,uuid),public.product_pricing_plan(uuid),public.save_product_pricing_plan(uuid,jsonb,text,uuid),public.product_pricing_preview(uuid,integer,jsonb),public.apply_product_pricing(uuid,integer,jsonb,text,uuid,numeric) TO authenticated;
NOTIFY pgrst,'reload schema';
