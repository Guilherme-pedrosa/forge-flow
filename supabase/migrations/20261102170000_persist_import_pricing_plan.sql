-- The commercial import calculator and the production plate must keep the same
-- explicit stock, printer and yield choices. Source grams remain authoritative.
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid)'))
  NOT IN('14d9d52750e86545fb4b5785928e33f9','f00cda41459e8d687bc514b2d01353f9')
  OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.product_print_plate_preparation(uuid)'))
  NOT IN('0b034214a867d9029d62b14ab75acc2c','5c11477a2e9522b8ddd5bcb4156d82c1') THEN
  RAISE EXCEPTION 'Review the saved source import and plate preparation functions before applying confirmed pricing.';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION erp_private.apply_product_import_pricing(p_product uuid,p_plan jsonb,p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); product products; machine printers; item inventory_items; plate product_print_plates;
 reference jsonb; profile jsonb; variant jsonb; f jsonb; material jsonb; plan_plate jsonb; line jsonb; stored_source product_print_sources;
 source_profile text; source_hash text; chosen_source_id uuid; plate_ids uuid[]; seen integer[]:='{}'; material_keys jsonb:='[]'; used_keys jsonb:='[]';
 expected jsonb; canonical_materials jsonb:='[]'; canonical_plates jsonb:='[]'; canonical jsonb; source_filaments jsonb; source_identity jsonb;
 n numeric; units integer; idx integer; chosen uuid; selected_ids uuid[]; mapped jsonb; source_key text; source_code text; source_color text; stable_color text;
 grams numeric; source_grams numeric; source_seconds numeric; total_grams numeric; material_cost numeric; energy numeric; machine_cost numeric; labor numeric; indirect numeric; non_material numeric;
 physical numeric; rate numeric; kwh numeric; labor_rate numeric; handling numeric; finishing numeric; assembly_minutes numeric; extras numeric; overhead numeric;
 policy jsonb; child_request uuid; first_plate boolean:=true; profile_fallback boolean; original_cost numeric; original_price numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO product FROM products WHERE id=p_product AND tenant_id=t AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um produto ativo da sua empresa.' USING ERRCODE='42501'; END IF;
 original_cost:=product.manual_cost_override; original_price:=product.sale_price;
 IF p_request IS NULL OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
  OR p_plan-ARRAY['version','printer_id','quantity','source_id','source_profile_id','source_file_sha256','materials','plates']<>'{}'
  OR p_plan->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(p_plan->'version') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_plan->'quantity') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Plano de impressão importado inválido.' USING ERRCODE='22023'; END IF;
 n:=(p_plan->>'quantity')::numeric;
 IF NOT erp_private.valid_number(n,1) OR n<>trunc(n) OR n>10000 THEN RAISE EXCEPTION 'Confirme de 1 a 10000 produtos completos neste perfil.'; END IF;
 units:=n::integer; source_profile:=nullif(btrim(p_plan->>'source_profile_id'),''); source_hash:=p_plan->>'source_file_sha256';
 IF source_profile IS NULL OR length(source_profile)>200 OR source_profile~'[[:cntrl:]]'
  OR (source_hash IS NOT NULL AND source_hash!~'^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'Identifique o mesmo arquivo e perfil de impressão.'; END IF;
 IF source_profile LIKE 'local:%' AND source_hash IS DISTINCT FROM substring(source_profile FROM 7) THEN
  RAISE EXCEPTION 'O perfil local deve identificar o mesmo SHA-256 do arquivo 3MF.';
 END IF;
 SELECT * INTO machine FROM printers WHERE id=(p_plan->>'printer_id')::uuid AND tenant_id=t AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecione uma impressora ativa da sua empresa.' USING ERRCODE='42501'; END IF;
 IF p_plan->>'source_id' IS NOT NULL THEN
  chosen_source_id:=(p_plan->>'source_id')::uuid;
  PERFORM 1 FROM product_print_sources WHERE id=chosen_source_id AND product_id=p_product AND tenant_id=t AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'A fonte deve pertencer ao produto e à empresa.' USING ERRCODE='42501'; END IF;
 END IF;
 IF jsonb_typeof(p_plan->'plates') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'plates') NOT BETWEEN 1 AND 100
  OR jsonb_typeof(p_plan->'materials') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'materials') NOT BETWEEN 1 AND 1024 THEN
  RAISE EXCEPTION 'Confirme todas as placas e os filamentos do perfil.';
 END IF;
 FOR material IN SELECT value FROM jsonb_array_elements(p_plan->'materials') LOOP
  IF jsonb_typeof(material) IS DISTINCT FROM 'object' OR material-ARRAY['source_key','item_id','material_code','color_hex','slot_id']<>'{}'
   OR jsonb_typeof(material->'source_key') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Associação de filamento inválida.'; END IF;
  source_key:=material->>'source_key';
  BEGIN source_identity:=source_key::jsonb; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Identificação de filamento inválida.'; END;
  IF jsonb_typeof(source_identity) IS DISTINCT FROM 'array' OR jsonb_array_length(source_identity)<>3 OR material_keys @> jsonb_build_array(source_identity) THEN
   RAISE EXCEPTION 'Associe cada filamento uma única vez.';
  END IF;
  SELECT * INTO item FROM inventory_items WHERE id=(material->>'item_id')::uuid AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND OR lower(btrim(item.unit)) NOT IN('g','kg') OR item.material_code IS NULL
   OR item.color IS NULL THEN RAISE EXCEPTION 'Selecione um filamento identificado e ativo da sua empresa.' USING ERRCODE='42501'; END IF;
  IF NOT erp_private.valid_number(item.avg_cost) OR NOT(item.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.tenant_id=t AND m.item_id=item.id
   AND m.movement_type='purchase_in' AND m.quantity>0 AND m.unit_cost=0)) THEN RAISE EXCEPTION 'Confira o custo de entrada do filamento selecionado.'; END IF;
  IF upper(btrim(source_identity->>1)) IS DISTINCT FROM item.material_code THEN RAISE EXCEPTION 'O material do estoque não corresponde ao filamento do perfil.'; END IF;
  -- Complete only the selected legacy item's existing structured color, using
  -- the same stable-code rule as the original material identity migration.
  -- No label, visual hex, valuation or historical recipe is inferred/changed.
  IF item.color_code IS NULL THEN
   stable_color:=upper(btrim(item.color));
   IF item.material_code<>'OTHER' AND length(stable_color)<=64 AND stable_color ~ '^[A-Z0-9#][A-Z0-9#_. /+\-]*$'
    AND NOT EXISTS(SELECT 1 FROM product_material_recipe_lines l JOIN product_material_recipe_versions v ON v.id=l.recipe_version_id
     WHERE l.item_id=item.id AND v.tenant_id=t) THEN
    UPDATE inventory_items SET color_code=stable_color WHERE id=item.id AND tenant_id=t RETURNING * INTO item;
    INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
     VALUES(t,auth.uid(),'complete_import_material_identity','inventory_items',item.id,jsonb_build_object('source','existing_structured_fields',
      'request_id',p_request,'material_code',item.material_code,'original_color',item.color,'previous_color_code',NULL,
      'color_code',item.color_code,'color_hex',item.color_hex));
   END IF;
  END IF;
  IF item.color_code IS NULL OR item.material_identified_at IS NULL THEN
   RAISE EXCEPTION 'Confirme a identificação do filamento e da cor no estoque antes de usar a composição.';
  END IF;
  material_keys:=material_keys||jsonb_build_array(source_identity);
  canonical_materials:=canonical_materials||jsonb_build_array(jsonb_build_object('source_key',source_key,'item_id',item.id,
    'material_code',item.material_code,'color_hex',source_identity->2,'slot_id',CASE WHEN jsonb_typeof(source_identity->0)='number' THEN source_identity->0 ELSE 'null'::jsonb END));
 END LOOP;
 PERFORM 1 FROM product_print_plates p LEFT JOIN product_print_sources s ON s.id=p.source_id AND s.tenant_id=t
  WHERE p.product_id=p_product AND p.tenant_id=t AND p.is_active AND (chosen_source_id IS NULL OR p.source_id=chosen_source_id)
   AND source_profile=ANY(ARRAY[p.imported_plate_metadata->>'profile_id',p.imported_plate_metadata->>'file_profile_id',p.imported_plate_metadata->>'local_file_hash',s.profile_id])
  ORDER BY p.id FOR UPDATE OF p;
 SELECT array_agg(p.id ORDER BY p.plate_index,p.id) INTO plate_ids FROM product_print_plates p LEFT JOIN product_print_sources s ON s.id=p.source_id AND s.tenant_id=t
  WHERE p.product_id=p_product AND p.tenant_id=t AND p.is_active AND (chosen_source_id IS NULL OR p.source_id=chosen_source_id)
   AND source_profile=ANY(ARRAY[p.imported_plate_metadata->>'profile_id',p.imported_plate_metadata->>'file_profile_id',p.imported_plate_metadata->>'local_file_hash',s.profile_id]);
 IF coalesce(cardinality(plate_ids),0)<>jsonb_array_length(p_plan->'plates') THEN RAISE EXCEPTION 'O plano deve corresponder a todas as placas ativas do arquivo e perfil.'; END IF;
 policy:=erp_private.read_pricing_settings(t); kwh:=(policy->>'energy_cost_kwh')::numeric; labor_rate:=(policy->>'labor_cost_hour')::numeric;
 handling:=coalesce((policy->>'handling_minutes_per_plate')::numeric,0); finishing:=coalesce((policy->>'finishing_minutes_per_piece')::numeric,0);
 assembly_minutes:=coalesce((policy->>'assembly_minutes_per_product')::numeric,0); extras:=coalesce((policy->>'extras_cost_per_product')::numeric,0);
 overhead:=(policy->>'overhead_percent')::numeric;
 SELECT coalesce((SELECT (x->>'hour_cost')::numeric FROM jsonb_array_elements(coalesce(policy->'printer_hour_costs','[]')) x WHERE x->>'printer_id'=machine.id::text),
   (policy->>'machine_hour_cost')::numeric,coalesce(machine.depreciation_per_hour,CASE WHEN machine.useful_life_hours>0 THEN machine.acquisition_cost/machine.useful_life_hours END)+machine.maintenance_cost_per_hour) INTO rate;
 IF NOT erp_private.valid_number(kwh) OR NOT erp_private.valid_number(machine.power_watts) OR NOT erp_private.valid_number(rate) OR NOT erp_private.valid_number(overhead) THEN
  RAISE EXCEPTION 'Confira as tarifas cadastradas de energia, máquina e despesas indiretas.';
 END IF;
 FOR plate IN SELECT * FROM product_print_plates WHERE id=ANY(plate_ids) ORDER BY plate_index,id LOOP
  profile_fallback:=false;
  SELECT * INTO stored_source FROM product_print_sources WHERE id=plate.source_id AND tenant_id=t;
  IF plate.imported_plate_metadata->>'file_sha256' IS NOT NULL AND stored_source.file_sha256 IS NOT NULL
   AND plate.imported_plate_metadata->>'file_sha256' IS DISTINCT FROM stored_source.file_sha256 THEN
   RAISE EXCEPTION 'O arquivo da fonte e da placa mudou. Reimporte o mesmo 3MF antes de salvar.';
  END IF;
  IF coalesce(plate.imported_plate_metadata->>'file_sha256',stored_source.file_sha256) IS NOT NULL AND source_hash IS NULL THEN
   RAISE EXCEPTION 'Confirme o SHA-256 do mesmo arquivo 3MF antes de salvar.';
  END IF;
  IF source_hash IS NOT NULL AND source_hash IS DISTINCT FROM coalesce(plate.imported_plate_metadata->>'file_sha256',stored_source.file_sha256) THEN
   RAISE EXCEPTION 'O arquivo mudou. Reimporte o mesmo 3MF antes de salvar.';
  END IF;
  SELECT value INTO plan_plate FROM jsonb_array_elements(p_plan->'plates') WHERE value->>'index'=plate.plate_index::text;
  IF plan_plate IS NULL OR jsonb_typeof(plan_plate) IS DISTINCT FROM 'object' OR plan_plate-ARRAY['index','units_per_plate','lines']<>'{}'
   OR jsonb_typeof(plan_plate->'index') IS DISTINCT FROM 'number' OR plate.plate_index=ANY(seen)
   OR jsonb_typeof(plan_plate->'units_per_plate') IS DISTINCT FROM 'number' OR (plan_plate->>'units_per_plate')::numeric<>units
   OR jsonb_typeof(plan_plate->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(plan_plate->'lines') NOT BETWEEN 1 AND 64 THEN
   RAISE EXCEPTION 'Confirme o rendimento e os materiais de cada placa uma única vez.';
  END IF;
  seen:=array_append(seen,plate.plate_index);
  IF NOT erp_private.valid_number(plate.est_grams,0.000001) OR NOT erp_private.valid_number(plate.est_time_seconds,0.000001) THEN
   RAISE EXCEPTION 'A placa não contém tempo e consumo de fatiamento completos.';
  END IF;
  IF plate.imported_plate_metadata->'slicer_estimates'->>'source'='3mf_slice_info' THEN
   source_grams:=(plate.imported_plate_metadata->>'slicer_weight_grams')::numeric;
   source_seconds:=(plate.imported_plate_metadata->>'slicer_time_seconds')::numeric;
   IF NOT erp_private.valid_number(source_grams,0.000001) OR NOT erp_private.valid_number(source_seconds,0.000001) THEN
    RAISE EXCEPTION 'O arquivo não contém tempo e consumo de fatiamento completos. Reimporte o 3MF fatiado.';
   END IF;
   source_filaments:=erp_private.file_slicer_filaments(plate.imported_plate_metadata->'slicer_estimates',t);
  ELSE
   source_grams:=(plate.imported_plate_metadata->'plate'->>'weight_grams')::numeric;
   source_seconds:=(plate.imported_plate_metadata->'plate'->>'time_seconds')::numeric;
   source_filaments:=CASE WHEN jsonb_array_length(coalesce(plate.imported_plate_metadata->'plate'->'filaments','[]'))>0
    THEN plate.imported_plate_metadata->'plate'->'filaments' ELSE plate.imported_filaments END;
  END IF;
  IF (source_grams IS NOT NULL AND plate.est_grams IS DISTINCT FROM source_grams)
   OR (source_seconds IS NOT NULL AND plate.est_time_seconds IS DISTINCT FROM source_seconds) THEN
   RAISE EXCEPTION 'O planejamento foi alterado depois da importação. Reimporte o mesmo 3MF fatiado antes de confirmar seus custos.';
  END IF;
  IF jsonb_array_length(source_filaments)=0 AND stored_source.id IS NOT NULL
   AND plate.imported_plate_metadata->'slicer_estimates'->>'source' IS DISTINCT FROM '3mf_slice_info' THEN
   SELECT r.reference INTO reference FROM product_print_source_imports r WHERE r.source_id=stored_source.id AND r.tenant_id=t;
   SELECT value INTO profile FROM jsonb_array_elements(coalesce(reference->'profiles','[]')) WHERE value->>'instance_id'=reference->>'selected_profile_id';
   SELECT v INTO variant FROM (SELECT profile v UNION ALL SELECT value FROM jsonb_array_elements(coalesce(profile->'variants','[]'))) alternatives WHERE v->>'profile_id'=source_profile LIMIT 1;
   source_filaments:=coalesce(variant->'filaments','[]');
   profile_fallback:=true;
  END IF;
  IF jsonb_typeof(source_filaments) IS DISTINCT FROM 'array' OR jsonb_array_length(source_filaments)=0 THEN RAISE EXCEPTION 'O perfil não identifica seus filamentos. Importe o 3MF fatiado.'; END IF;
  -- A single explicitly identified material may use its known plate total.
  -- Multiple unknown material shares are never divided or guessed.
  SELECT count(DISTINCT jsonb_build_array(upper(btrim(x->>'type')),erp_private.import_color_hex(x->>'color'))) INTO n FROM jsonb_array_elements(source_filaments) x;
  IF profile_fallback OR EXISTS(SELECT 1 FROM jsonb_array_elements(source_filaments) x WHERE x->>'grams' IS NULL) THEN
   IF n<>1 OR plate.imported_plate_metadata->'slicer_estimates'->>'source'='3mf_slice_info' THEN
    RAISE EXCEPTION 'Faltam gramas por filamento. Importe o 3MF fatiado.';
   END IF;
   f:=source_filaments->0; source_filaments:=jsonb_build_array(f||jsonb_build_object('grams',plate.est_grams));
  END IF;
  mapped:='[]';
  FOR f IN SELECT value FROM jsonb_array_elements(source_filaments) LOOP
   grams:=(f->>'grams')::numeric;
   IF grams=0 THEN CONTINUE; END IF;
   IF NOT erp_private.valid_number(grams,0.000001) OR grams>10000000 THEN RAISE EXCEPTION 'Consumo de filamento inválido.'; END IF;
   source_code:=upper(btrim(f->>'type')); source_color:=upper(btrim(f->>'color'));
   IF plate.imported_plate_metadata->'slicer_estimates'->>'source'='3mf_slice_info' THEN
    source_identity:=jsonb_build_array((f->>'id')::integer,source_code,source_color);
   ELSE source_identity:=jsonb_build_array('makerworld',source_code,erp_private.import_color_hex(source_color)); END IF;
   SELECT value INTO material FROM jsonb_array_elements(canonical_materials) WHERE (value->>'source_key')::jsonb=source_identity;
   IF material IS NULL THEN RAISE EXCEPTION 'Associe todos os filamentos do mesmo arquivo e perfil.'; END IF;
   chosen:=(material->>'item_id')::uuid;
   IF NOT used_keys @> jsonb_build_array(source_identity) THEN used_keys:=used_keys||jsonb_build_array(source_identity); END IF;
   mapped:=mapped||jsonb_build_array(jsonb_build_object('item_id',chosen,'grams',grams));
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',g.item_id,'grams',g.grams) ORDER BY g.item_id),'[]') INTO expected
   FROM (SELECT x->>'item_id' item_id,sum((x->>'grams')::numeric) grams FROM jsonb_array_elements(mapped) x GROUP BY x->>'item_id') g;
  IF jsonb_array_length(expected)<>jsonb_array_length(plan_plate->'lines') THEN RAISE EXCEPTION 'Os materiais da placa não correspondem ao fatiamento.'; END IF;
  selected_ids:='{}';
  FOR line IN SELECT value FROM jsonb_array_elements(plan_plate->'lines') LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['item_id','grams']<>'{}' OR jsonb_typeof(line->'grams') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Linha de material inválida.'; END IF;
   chosen:=(line->>'item_id')::uuid; grams:=(line->>'grams')::numeric;
   IF chosen=ANY(selected_ids) OR NOT erp_private.valid_number(grams,0.000001) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected) x WHERE x->>'item_id'=chosen::text AND abs((x->>'grams')::numeric-grams)<=0.000001) THEN
    RAISE EXCEPTION 'Não altere os gramas importados ao associar o material da placa.';
   END IF;
   selected_ids:=array_append(selected_ids,chosen);
  END LOOP;
  SELECT sum((x->>'grams')::numeric),sum((x->>'grams')::numeric/CASE lower(btrim(i.unit)) WHEN 'kg' THEN 1000 ELSE 1 END*i.avg_cost)
    INTO total_grams,material_cost FROM jsonb_array_elements(expected) x JOIN inventory_items i ON i.id=(x->>'item_id')::uuid AND i.tenant_id=t;
  IF abs(total_grams-plate.est_grams)>greatest(0.1,plate.est_grams*0.01) THEN RAISE EXCEPTION 'O consumo da placa não confere com o peso total.'; END IF;
  IF EXISTS(SELECT 1 FROM product_print_plate_parts part WHERE part.plate_id=plate.id AND part.tenant_id=t
   AND part.quantity_per_plate IS NOT NULL AND part.quantity_per_product IS NOT NULL
   AND part.quantity_per_plate<>units*part.quantity_per_product)
   OR EXISTS(SELECT 1 FROM product_subitems sub WHERE sub.plate_id=plate.id AND sub.product_id=p_product AND sub.tenant_id=t
    AND sub.quantity_per_plate IS NOT NULL AND sub.quantity_per_product IS NOT NULL
    AND sub.quantity_per_plate<>units*sub.quantity_per_product) THEN
   RAISE EXCEPTION 'O rendimento não corresponde às quantidades já confirmadas na composição. Confira as peças por produto e por placa antes de alterar os custos.';
  END IF;
  SELECT CASE WHEN count(*)>0 AND count(quantity_per_plate)=count(*) THEN sum(quantity_per_plate) END INTO physical FROM product_print_plate_parts WHERE plate_id=plate.id AND tenant_id=t;
  IF finishing>0 AND physical IS NULL THEN RAISE EXCEPTION 'Confira a quantidade de peças para calcular o acabamento.'; END IF;
  energy:=plate.est_time_seconds/3600*machine.power_watts/1000*kwh; machine_cost:=plate.est_time_seconds/3600*rate;
  labor:=handling+finishing*coalesce(physical,0)+CASE WHEN first_plate THEN assembly_minutes*units ELSE 0 END;
  IF labor>0 AND NOT erp_private.valid_number(labor_rate) THEN RAISE EXCEPTION 'Confira a tarifa de mão de obra.'; END IF;
  labor:=labor/60*coalesce(labor_rate,0); indirect:=(material_cost+energy+machine_cost+labor)*overhead/100;
  non_material:=(energy+machine_cost+labor+indirect)/units+CASE WHEN first_plate THEN extras ELSE 0 END;
  PERFORM public.save_product_print_plate(plate.id,p_product,plate.source_id,jsonb_build_object('plate_index',plate.plate_index,'label',plate.label,
   'units_per_plate',units,'material_id',CASE WHEN cardinality(selected_ids)=1 THEN selected_ids[1] END,'printer_id',machine.id,
   'est_grams',plate.est_grams,'est_time_seconds',plate.est_time_seconds,'est_cost_per_unit',plate.est_cost_per_unit));
  child_request:=md5(p_request::text||'/import-plate/'||plate.id::text)::uuid;
  PERFORM public.prepare_product_plate_recipe(p_product,plate.id,units,'per_print',expected,'Materiais e rendimento confirmados na precificação do cadastro.',child_request,non_material);
  UPDATE product_print_plate_parts SET quantity_per_product=quantity_per_plate/units
   WHERE plate_id=plate.id AND tenant_id=t AND quantity_per_product IS NULL AND quantity_per_plate IS NOT NULL AND quantity_per_plate%units=0;
  UPDATE product_subitems sub SET quantity_per_product=coalesce(sub.quantity_per_product,part.quantity_per_product),
   quantity_per_plate=coalesce(sub.quantity_per_plate,part.quantity_per_plate)
   FROM product_print_plate_parts part WHERE sub.source_part_id=part.id AND sub.product_id=p_product AND sub.tenant_id=t
    AND part.plate_id=plate.id AND part.tenant_id=t
    AND (sub.quantity_per_product IS NULL OR sub.quantity_per_plate IS NULL);
  canonical_plates:=canonical_plates||jsonb_build_array(jsonb_build_object('index',plate.plate_index,'units_per_plate',units,'lines',expected));
  first_plate:=false;
 END LOOP;
 IF jsonb_array_length(used_keys)<>jsonb_array_length(material_keys) THEN RAISE EXCEPTION 'O plano contém filamentos que não pertencem às placas deste perfil.'; END IF;
 SELECT CASE WHEN count(DISTINCT p.source_id)=1 THEN min(p.source_id::text)::uuid END INTO chosen_source_id FROM product_print_plates p WHERE p.id=ANY(plate_ids);
 canonical:=jsonb_build_object('version',1,'source_id',chosen_source_id,'source_profile_id',source_profile,'printer_id',machine.id,'quantity',units,'materials',canonical_materials,'plates',canonical_plates);
 IF source_hash IS NOT NULL THEN canonical:=canonical||jsonb_build_object('source_file_sha256',source_hash); END IF;
 UPDATE products SET catalog_details=coalesce(catalog_details,'{}')||jsonb_build_object('import_pricing',canonical),
  manual_cost_override=original_cost,sale_price=original_price WHERE id=p_product AND tenant_id=t;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'confirm_import_pricing','products',p_product,canonical);
END $$;
REVOKE ALL ON FUNCTION erp_private.apply_product_import_pricing(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;

-- Wrap the private source-persistence stage so the outer catalog validation and
-- request signatures remain intact. It sees the final saved native plate data.
DO $$ DECLARE definition text; source_hash text; BEGIN
 definition:=pg_get_functiondef('erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid)'::regprocedure);
 SELECT md5(replace(prosrc,chr(13),'')) INTO source_hash FROM pg_proc WHERE oid='erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid)'::regprocedure;
 IF strpos(definition,'apply_product_import_pricing')=0 THEN
  IF source_hash IS DISTINCT FROM '14d9d52750e86545fb4b5785928e33f9' THEN
   RAISE EXCEPTION 'Review the saved source import function before applying confirmed pricing.';
  END IF;
  ALTER FUNCTION erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_import_pricing;
 ELSIF source_hash IS DISTINCT FROM 'f00cda41459e8d687bc514b2d01353f9' THEN
  RAISE EXCEPTION 'Review the confirmed import pricing wrapper before reapplying this migration.';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION erp_private.save_product_before_live_pricing(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; previous_plan jsonb; BEGIN
 IF p_product_id IS NOT NULL THEN SELECT catalog_details->'import_pricing' INTO previous_plan FROM products WHERE id=p_product_id AND tenant_id=t; END IF;
 result:=erp_private.save_product_before_import_pricing(p_product_id,p_product,p_photos,p_request_id);
 IF nullif(p_product->'import_pricing','null'::jsonb) IS NOT NULL THEN
  PERFORM erp_private.apply_product_import_pricing(result,p_product->'import_pricing',p_request_id);
 ELSIF previous_plan IS NOT NULL AND NOT(p_product ? 'file_composition' OR p_product ? 'import_composition') THEN
  UPDATE products SET catalog_details=coalesce(catalog_details,'{}')||jsonb_build_object('import_pricing',previous_plan) WHERE id=result AND tenant_id=t;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid),erp_private.save_product_before_import_pricing(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_product_import_pricing(p_product_id uuid,p_plan jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product_import_pricing',jsonb_build_array(p_product_id,p_plan));
 IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM erp_private.apply_product_import_pricing(p_product_id,p_plan,p_request_id);
 PERFORM erp_private.finish_request(t,p_request_id,p_product_id); RETURN p_product_id;
END $$;
REVOKE ALL ON FUNCTION public.save_product_import_pricing(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_import_pricing(uuid,jsonb,uuid) TO authenticated;

-- Confirmed stock selections are authoritative. Never rematch them by the
-- downloaded model's display color after the operator chose a different spool.
CREATE OR REPLACE FUNCTION public.product_print_plate_preparation(p_plate_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); p product_print_plates; f jsonb; material inventory_items; machine printers; recipe jsonb;
 filaments jsonb; lines jsonb:='[]'; missing jsonb:='[]'; material_cost numeric:=0; all_materials boolean:=true;
 grams numeric; energy numeric; machine_cost numeric; rate numeric; depreciation numeric; policy jsonb; known_cost numeric; confirmed boolean:=false;
BEGIN
 SELECT * INTO p FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t;
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Placa não encontrada.'; END IF;
 recipe:=erp_private.product_material_recipe_snapshot(p.product_id,t,p.id); confirmed:=jsonb_array_length(coalesce(recipe->'lines','[]'))>0;
 IF confirmed THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',x->>'item_id','type',x->>'material_code','color',x->>'color_hex','grams',x->'grams_per_print','match_status','matched','candidate_count',1)),'[]')
   INTO filaments FROM jsonb_array_elements(recipe->'lines') x;
 ELSE filaments:=erp_private.import_filament_matches(t,p.imported_filaments); END IF;
 IF p.units_per_plate IS NULL THEN missing:=missing||jsonb_build_array('Confirme as unidades do produto atendidas por impressão desta placa.'); END IF;
 IF confirmed AND (recipe->>'units_per_print')::integer IS DISTINCT FROM p.units_per_plate THEN
  missing:=missing||jsonb_build_array('Capacidade por impressão mudou; publique uma nova versão da composição.');
 END IF;
 IF p.est_time_seconds IS NULL OR p.est_time_seconds<=0 THEN missing:=missing||jsonb_build_array('Tempo previsto da placa não informado.'); END IF;
 IF jsonb_array_length(filaments)=0 THEN all_materials:=false;missing:=missing||jsonb_build_array('O arquivo não informou os filamentos desta placa.'); END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(filaments) LOOP
  IF f->>'item_id' IS NULL THEN all_materials:=false;missing:=missing||jsonb_build_array('Escolha o item exato de estoque para '||coalesce(f->>'type','material não informado')||' / '||coalesce(f->>'color','cor não informada')||'.');CONTINUE; END IF;
  grams:=(f->>'grams')::numeric;
  IF grams IS NULL OR grams<=0 THEN all_materials:=false;missing:=missing||jsonb_build_array('Gramas de um filamento não informados.');CONTINUE; END IF;
  SELECT * INTO material FROM inventory_items WHERE id=(f->>'item_id')::uuid AND tenant_id=t AND is_active;
  IF NOT FOUND OR material.material_identified_at IS NULL OR lower(btrim(material.unit)) NOT IN('g','kg') THEN all_materials:=false;missing:=missing||jsonb_build_array('Confira o material ativo e identificado do estoque.');CONTINUE; END IF;
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',material.id,'grams',grams));
  IF material.avg_cost IS NULL OR NOT(material.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements WHERE tenant_id=t AND item_id=material.id AND movement_type='purchase_in' AND quantity>0 AND unit_cost=0)) THEN
   all_materials:=false;missing:=missing||jsonb_build_array('Custo médio ainda não confirmado: '||material.name||'.');
  ELSE material_cost:=material_cost+grams/CASE lower(btrim(material.unit)) WHEN 'kg' THEN 1000 ELSE 1 END*material.avg_cost; END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',g.item_id,'grams',g.grams) ORDER BY g.item_id),'[]') INTO lines
  FROM(SELECT value->>'item_id' item_id,sum((value->>'grams')::numeric) grams FROM jsonb_array_elements(lines) GROUP BY value->>'item_id') g;
 SELECT * INTO machine FROM printers WHERE id=p.printer_id AND tenant_id=t AND is_active;
 policy:=erp_private.read_pricing_settings(t);
 IF machine.id IS NULL THEN missing:=missing||jsonb_build_array('Selecione a impressora para prever energia e uso da máquina.');
 ELSIF erp_private.valid_number(p.est_time_seconds,0.001) THEN
  IF erp_private.valid_number((policy->>'energy_cost_kwh')::numeric) AND erp_private.valid_number(machine.power_watts) THEN energy:=p.est_time_seconds/3600*machine.power_watts/1000*(policy->>'energy_cost_kwh')::numeric;
  ELSE missing:=missing||jsonb_build_array('Confirme potência da impressora e tarifa de energia.'); END IF;
  SELECT coalesce((SELECT (x->>'hour_cost')::numeric FROM jsonb_array_elements(coalesce(policy->'printer_hour_costs','[]')) x WHERE x->>'printer_id'=machine.id::text),
   (policy->>'machine_hour_cost')::numeric,coalesce(machine.depreciation_per_hour,CASE WHEN machine.useful_life_hours>0 THEN machine.acquisition_cost/machine.useful_life_hours END)+machine.maintenance_cost_per_hour) INTO rate;
  IF erp_private.valid_number(rate) THEN machine_cost:=p.est_time_seconds/3600*rate; ELSE missing:=missing||jsonb_build_array('Confirme a tarifa de uso da impressora.'); END IF;
 END IF;
 IF all_materials AND energy IS NOT NULL AND machine_cost IS NOT NULL THEN known_cost:=material_cost+energy+machine_cost; END IF;
 RETURN jsonb_build_object('plate_id',p.id,'units_per_plate',p.units_per_plate,'filaments',filaments,'recipe_lines',lines,'missing',missing,
  'material_cost_per_print',CASE WHEN all_materials THEN material_cost END,'energy_cost_per_print',energy,'machine_cost_per_print',machine_cost,
  'known_cost_per_print',known_cost,'non_material_cost_per_unit_suggestion',(energy+machine_cost)/p.units_per_plate,
  'cost_scope','Materiais, energia e máquina desta placa. O custo comercial aceito permanece no cadastro.','has_confirmed_recipe',confirmed);
END $$;
REVOKE ALL ON FUNCTION public.product_print_plate_preparation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_print_plate_preparation(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
