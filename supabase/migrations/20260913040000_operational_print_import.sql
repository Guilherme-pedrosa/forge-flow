-- Imported physical plates are useful before their commercial yield is known.
-- They never imply one sellable unit, a stock color or a published recipe.
ALTER TABLE public.product_print_plates ALTER COLUMN units_per_plate DROP NOT NULL;
ALTER TABLE public.product_print_plates ALTER COLUMN units_per_plate DROP DEFAULT;
ALTER TABLE public.product_print_plates ADD COLUMN imported_filaments jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK(jsonb_typeof(imported_filaments)='array'), ADD COLUMN imported_plate_metadata jsonb
  CHECK(imported_plate_metadata IS NULL OR jsonb_typeof(imported_plate_metadata)='object');
-- Keep full source documents out of the compact source snapshot copied to each job.
CREATE TABLE public.product_print_source_imports(source_id uuid PRIMARY KEY REFERENCES product_print_sources(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
  reference jsonb NOT NULL CHECK(jsonb_typeof(reference)='object' AND octet_length(reference::text)<=2097152),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE product_print_source_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_print_source_imports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON product_print_source_imports TO authenticated;
CREATE POLICY product_source_import_read ON product_print_source_imports FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE TRIGGER product_source_import_tenant BEFORE INSERT OR UPDATE ON product_print_source_imports FOR EACH ROW EXECUTE FUNCTION erp_check_tenant_references();

CREATE FUNCTION erp_private.import_color_hex(p_color text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN upper(btrim(p_color)) ~ '^#?[0-9A-F]{6}(FF)?$'
    THEN '#'||left(ltrim(upper(btrim(p_color)),'#'),6) END
$$;
CREATE FUNCTION erp_private.import_filament_matches(p_tenant uuid,p_filaments jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE f jsonb; result jsonb:='[]'; match_code text; match_color text; matches uuid[]; grams numeric;
BEGIN
  IF jsonb_typeof(p_filaments) IS DISTINCT FROM 'array' THEN RETURN result; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p_filaments) LOOP
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Filamento importado inválido.'; END IF;
    match_code:=upper(btrim(f->>'type'));match_color:=erp_private.import_color_hex(f->>'color');
    SELECT array_agg(i.id ORDER BY i.id) INTO matches FROM inventory_items i
      WHERE i.tenant_id=p_tenant AND i.is_active AND i.material_identified_at IS NOT NULL
        AND lower(btrim(i.unit)) IN('g','kg') AND i.material_code=match_code AND i.material_code<>'OTHER'
        AND i.color IS NOT NULL AND i.color_code IS NOT NULL AND i.color_hex=match_color;
    grams:=NULL;
    IF f ? 'grams' AND f->'grams'<>'null'::jsonb AND jsonb_typeof(f->'grams')<>'number' THEN RAISE EXCEPTION 'Peso de filamento importado inválido.'; END IF;
    IF jsonb_typeof(f->'grams')='number' THEN grams:=(f->>'grams')::numeric; END IF;
    IF grams IS NOT NULL AND (NOT erp_private.valid_number(grams) OR grams>10000000) THEN RAISE EXCEPTION 'Peso de filamento importado inválido.'; END IF;
    result:=result||jsonb_build_array((f-'item_id'-'match_status'-'candidate_count')||jsonb_build_object(
      'item_id',CASE WHEN cardinality(matches)=1 THEN matches[1] END,'candidate_count',coalesce(cardinality(matches),0),
      'match_status',CASE WHEN match_code IS NULL OR match_color IS NULL THEN 'incomplete' WHEN cardinality(matches)=1 THEN 'matched'
        WHEN cardinality(matches)>1 THEN 'ambiguous' ELSE 'unmatched' END));
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION erp_private.import_observed_filaments(p_task public.bambu_tasks) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE part jsonb; result jsonb:='[]'; grams numeric;
BEGIN
  IF jsonb_typeof(p_task.raw_data->'amsDetailMapping')='array' THEN
    FOR part IN SELECT value FROM jsonb_array_elements(p_task.raw_data->'amsDetailMapping') LOOP
      BEGIN grams:=(part->>'weight')::numeric;EXCEPTION WHEN OTHERS THEN grams:=NULL;END;
      IF NOT erp_private.valid_number(grams) THEN grams:=NULL; END IF;
      result:=result||jsonb_build_array(jsonb_build_object('id',part->>'filamentId','type',nullif(part->>'targetFilamentType',''),'source_type',part->>'filamentType',
        'type_source',CASE WHEN nullif(part->>'targetFilamentType','') IS NOT NULL THEN 'target' ELSE 'unknown' END,
        'color',nullif(part->>'targetColor',''),'source_color',part->>'sourceColor','color_source',CASE WHEN nullif(part->>'targetColor','') IS NOT NULL THEN 'target' ELSE 'unknown' END,'grams',grams,
        'ams_id',part->'amsId','slot_id',part->'slotId','weight_source','history_slicer'));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('task_id',p_task.id,'status',p_task.status,'ended_at',p_task.end_time,'filaments',result,
    'planned_grams',p_task.weight_grams,'planned_time_seconds',p_task.cost_time_seconds,'source','bambu_history');
END $$;

CREATE FUNCTION public.product_print_plate_preparation(p_plate_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); p product_print_plates; f jsonb; material inventory_items; machine printers;
  filaments jsonb; lines jsonb:='[]'; missing jsonb:='[]'; material_cost numeric:=0; all_materials boolean:=true;
  grams numeric; energy numeric; machine_cost numeric; rate numeric; depreciation numeric; settings jsonb; known_cost numeric;
BEGIN
  SELECT * INTO p FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t;
  IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Placa não encontrada.'; END IF;
  filaments:=erp_private.import_filament_matches(t,p.imported_filaments);
  IF p.units_per_plate IS NULL THEN missing:=missing||jsonb_build_array('Confirme as unidades do produto atendidas por impressão desta placa.'); END IF;
  IF p.est_time_seconds IS NULL OR p.est_time_seconds<=0 THEN missing:=missing||jsonb_build_array('Tempo previsto da placa não informado.'); END IF;
  IF jsonb_array_length(filaments)=0 THEN all_materials:=false;missing:=missing||jsonb_build_array('O arquivo não informou os filamentos desta placa.'); END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(filaments) LOOP
    IF f->>'item_id' IS NULL THEN all_materials:=false;missing:=missing||jsonb_build_array('Escolha o item exato de estoque para '||coalesce(f->>'type','material não informado')||' / '||coalesce(f->>'color','cor não informada')||'.');CONTINUE; END IF;
    grams:=(f->>'grams')::numeric;
    IF grams IS NULL OR grams<=0 THEN all_materials:=false;missing:=missing||jsonb_build_array('Gramas de um filamento não informados.');CONTINUE; END IF;
    SELECT * INTO material FROM inventory_items WHERE id=(f->>'item_id')::uuid AND tenant_id=t;
    lines:=lines||jsonb_build_array(jsonb_build_object('item_id',material.id,'grams',grams));
    IF material.avg_cost IS NULL OR NOT(material.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements WHERE tenant_id=t AND item_id=material.id)) THEN
      all_materials:=false;missing:=missing||jsonb_build_array('Custo médio ainda não confirmado: '||material.name||'.');
    ELSE material_cost:=material_cost+grams/CASE lower(btrim(material.unit)) WHEN 'kg' THEN 1000 ELSE 1 END*material.avg_cost; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',combined.item_id,'grams',combined.grams) ORDER BY combined.item_id),'[]') INTO lines
    FROM(SELECT value->>'item_id' AS item_id,sum((value->>'grams')::numeric) AS grams FROM jsonb_array_elements(lines) GROUP BY value->>'item_id') combined;
  SELECT * INTO machine FROM printers WHERE id=p.printer_id AND tenant_id=t AND is_active;
  SELECT tenants.settings INTO settings FROM tenants WHERE id=t;
  IF machine.id IS NULL THEN missing:=missing||jsonb_build_array('Selecione a impressora para prever energia e uso da máquina.');
  ELSIF erp_private.valid_number(p.est_time_seconds,0.001) THEN
    IF jsonb_typeof(settings->'energy_cost_kwh')='number' THEN rate:=(settings->>'energy_cost_kwh')::numeric; END IF;
    IF erp_private.valid_number(rate) AND erp_private.valid_number(machine.power_watts) THEN energy:=p.est_time_seconds/3600*machine.power_watts/1000*rate;
    ELSE missing:=missing||jsonb_build_array('Confirme potência da impressora e tarifa de energia.'); END IF;
    depreciation:=coalesce(machine.depreciation_per_hour,CASE WHEN machine.useful_life_hours>0 THEN machine.acquisition_cost/machine.useful_life_hours END);
    IF erp_private.valid_number(depreciation) AND erp_private.valid_number(machine.maintenance_cost_per_hour) THEN machine_cost:=p.est_time_seconds/3600*(depreciation+machine.maintenance_cost_per_hour);
    ELSE missing:=missing||jsonb_build_array('Confirme depreciação e manutenção por hora da impressora.'); END IF;
  END IF;
  IF all_materials AND energy IS NOT NULL AND machine_cost IS NOT NULL THEN known_cost:=material_cost+energy+machine_cost; END IF;
  RETURN jsonb_build_object('plate_id',p.id,'units_per_plate',p.units_per_plate,'filaments',filaments,'recipe_lines',lines,'missing',missing,
    'material_cost_per_print',CASE WHEN all_materials THEN material_cost END,'energy_cost_per_print',energy,'machine_cost_per_print',machine_cost,
    'known_cost_per_print',known_cost,'non_material_cost_per_unit_suggestion',(energy+machine_cost)/p.units_per_plate,
    'cost_scope','Somente material, energia e máquina. Confirme mão de obra, indiretos e extras na composição.',
    'has_confirmed_recipe',EXISTS(SELECT 1 FROM product_material_recipe_versions WHERE tenant_id=t AND plate_id=p.id AND is_current));
END $$;
REVOKE ALL ON FUNCTION public.product_print_plate_preparation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_print_plate_preparation(uuid) TO authenticated;

CREATE FUNCTION public.persist_source_plate_import(p_source_id uuid,p_reference jsonb,p_task_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); source product_print_sources; product products; task bambu_tasks; observed bambu_tasks;
  profile jsonb; variant jsonb; spec jsonb; filaments jsonb; metadata jsonb; old product_print_plates; result uuid; ids uuid[]:='{}';
  design text; instance text; technical text; model text; n numeric; grams numeric; seconds numeric; machine uuid; matches uuid[];
  created_count integer:=0; updated_count integer:=0; unresolved integer:=0; selected_count integer; remote_index integer; can_bind boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO source FROM product_print_sources WHERE id=p_source_id AND tenant_id=t AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fonte de impressão não encontrada.'; END IF;
  SELECT * INTO product FROM products WHERE id=source.product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND OR product.category='kit' THEN RAISE EXCEPTION 'Selecione o produto físico, não um kit.'; END IF;
  SELECT * INTO source FROM product_print_sources WHERE id=p_source_id FOR UPDATE;
  IF p_reference IS NULL OR p_reference='null'::jsonb THEN
    IF p_task_id IS NULL THEN RAISE EXCEPTION 'Selecione a impressão Bambu quando não houver referência MakerWorld pública.'; END IF;
    SELECT count(*) INTO updated_count FROM product_print_plates WHERE tenant_id=t AND source_id=source.id AND is_active;
    PERFORM public.bind_product_print_source(source.id,p_task_id);
    SELECT array_agg(id ORDER BY plate_index),count(*)-updated_count INTO ids,created_count FROM product_print_plates WHERE tenant_id=t AND source_id=source.id AND is_active;
    RETURN jsonb_build_object('source_id',source.id,'product_id',product.id,'plate_ids',coalesce(to_jsonb(ids),'[]'),'created',created_count,'updated',updated_count,
      'pending_yield',(SELECT count(*) FROM product_print_plates WHERE id=ANY(ids) AND units_per_plate IS NULL),'unresolved_materials',NULL,'source','bambu_history');
  END IF;
  IF jsonb_typeof(p_reference) IS DISTINCT FROM 'object' OR p_reference->>'provider' IS DISTINCT FROM 'makerworld' OR octet_length(p_reference::text)>2097152 THEN RAISE EXCEPTION 'Referência MakerWorld inválida.'; END IF;
  PERFORM erp_private.assert_makerworld_reference_shape(p_reference);
  design:=erp_private.makerworld_design_id(p_reference->>'source_url');
  IF coalesce(p_reference->>'design_id',p_reference->>'id') IS DISTINCT FROM design OR (source.design_id IS NOT NULL AND source.design_id<>design) THEN RAISE EXCEPTION 'O modelo importado não corresponde à fonte selecionada.'; END IF;
  instance:=coalesce(nullif(p_reference->>'selected_profile_id',''),nullif(p_reference->>'selected_instance_id',''));
  SELECT count(*),jsonb_agg(value)->0 INTO selected_count,profile FROM jsonb_array_elements(p_reference->'profiles') WHERE value->>'instance_id'=instance;
  IF selected_count<>1 THEN RAISE EXCEPTION 'Selecione exatamente um perfil público para importar suas placas.'; END IF;
  technical:=nullif(p_reference->>'selected_variant_profile_id','');
  IF technical IS NULL THEN RAISE EXCEPTION 'Selecione a configuração da impressora para importar as placas.'; END IF;
  SELECT count(*),jsonb_agg(v)->0 INTO selected_count,variant FROM(SELECT profile AS v UNION ALL SELECT value FROM jsonb_array_elements(profile->'variants')) options WHERE v->>'profile_id'=technical;
  IF selected_count<>1 THEN RAISE EXCEPTION 'A configuração da impressora é ausente ou ambígua neste perfil público.'; END IF;
  model:=nullif(p_reference->>'model_id','');
  IF (source.instance_id IS NOT NULL AND source.instance_id<>instance) OR (source.profile_id IS NOT NULL AND source.profile_id<>technical)
    OR (source.model_id IS NOT NULL AND source.model_id IS DISTINCT FROM model) THEN RAISE EXCEPTION 'Perfil ou modelo importado não corresponde aos identificadores da fonte vinculada.'; END IF;
  IF jsonb_array_length(variant->'plate_details') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'A configuração não informou placas detalhadas. Vincule uma impressão real ou um arquivo com suas placas.'; END IF;
  IF p_task_id IS NOT NULL THEN
    SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t;
    IF task.id IS NULL OR erp_private.bambu_project_key(task.raw_data) IS NULL OR task.raw_data->>'profileId' IS DISTINCT FROM technical
      OR task.raw_data->>'modelId' IS DISTINCT FROM model OR (nullif(task.raw_data->>'designId','0') IS NOT NULL AND task.raw_data->>'designId'<>design)
      OR (nullif(task.raw_data->>'instanceId','0') IS NOT NULL AND task.raw_data->>'instanceId'<>instance) THEN RAISE EXCEPTION 'A impressão Bambu não corresponde ao modelo, perfil e configuração importados.'; END IF;
    remote_index:=(task.raw_data->>'plateIndex')::integer;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(variant->'plate_details') WHERE value->>'index'=remote_index::text) THEN RAISE EXCEPTION 'A placa da impressão Bambu não existe nesta configuração.'; END IF;
    -- The original binding remains inside this transaction; any later failure rolls it back.
    PERFORM erp_private.bind_source_before_plate_import(source.id,task.id);
    SELECT printer_id INTO machine FROM bambu_devices WHERE id=task.bambu_device_id AND tenant_id=t;
  ELSE
    SELECT array_agg(p.id ORDER BY p.id) INTO matches FROM printers p WHERE p.tenant_id=t AND p.is_active AND p.model=variant->>'printer_model';
    IF cardinality(matches)=1 THEN machine:=matches[1]; END IF;
  END IF;
  IF machine IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers WHERE id=machine AND tenant_id=t AND is_active) THEN machine:=NULL; END IF;
  FOR spec IN SELECT value FROM jsonb_array_elements(variant->'plate_details') LOOP
    IF jsonb_typeof(spec->'index') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'A origem não informou o índice físico de todas as placas.'; END IF;
    n:=(spec->>'index')::numeric;
    IF n<>trunc(n) OR n NOT BETWEEN 1 AND 10000 OR (SELECT count(*) FROM jsonb_array_elements(variant->'plate_details') x WHERE x->>'index'=spec->>'index')<>1 THEN RAISE EXCEPTION 'Índice de placa ausente, repetido ou incompatível. Não é possível inventar outra numeração.'; END IF;
    grams:=NULL;seconds:=NULL;
    IF jsonb_typeof(spec->'weight_grams')='number' THEN grams:=(spec->>'weight_grams')::numeric; END IF;
    IF jsonb_typeof(spec->'time_seconds')='number' THEN seconds:=(spec->>'time_seconds')::numeric; END IF;
    IF (grams IS NOT NULL AND (NOT erp_private.valid_number(grams) OR grams>10000000)) OR (seconds IS NOT NULL AND (NOT erp_private.valid_number(seconds) OR seconds>5184000)) THEN RAISE EXCEPTION 'Peso ou tempo importado da placa inválido.'; END IF;
    filaments:=erp_private.import_filament_matches(t,spec->'filaments');
    SELECT * INTO observed FROM bambu_tasks WHERE tenant_id=t AND raw_data->>'modelId'=model AND raw_data->>'profileId'=technical AND raw_data->>'plateIndex'=n::integer::text ORDER BY end_time DESC NULLS LAST,synced_at DESC,id LIMIT 1;
    can_bind:=p_task_id IS NOT NULL OR (source.model_id=model AND source.profile_id=technical) OR observed.id IS NOT NULL;
    IF can_bind AND observed.id IS NOT NULL AND (EXISTS(SELECT 1 FROM jobs WHERE id=observed.job_id AND product_id IS NOT NULL AND product_id<>product.id)
      OR EXISTS(SELECT 1 FROM bambu_production_records WHERE task_id=observed.id AND product_id IS NOT NULL AND product_id<>product.id)) THEN
      RAISE EXCEPTION 'A impressão observada desta placa já pertence a outro produto.';
    END IF;
    metadata:=jsonb_build_object('provider','makerworld','design_id',design,'instance_id',instance,'profile_id',technical,'model_id',model,
      'plate',spec,'printer_model',variant->'printer_model','printer_code',variant->'printer_code','source_url',p_reference->>'source_url',
      'declared_plate_count',variant->'plates','imported_plate_count',jsonb_array_length(variant->'plate_details'),
      'observed',CASE WHEN observed.id IS NOT NULL THEN erp_private.import_observed_filaments(observed) END);
    SELECT * INTO old FROM product_print_plates WHERE tenant_id=t AND source_id=source.id AND plate_index=n::integer AND is_active FOR UPDATE;
    IF EXISTS(SELECT 1 FROM product_print_plates pp WHERE pp.tenant_id=t AND pp.is_active AND pp.model_id=model AND pp.profile_id=technical AND pp.plate_index=n::integer AND pp.id IS DISTINCT FROM old.id)
      OR EXISTS(SELECT 1 FROM product_print_sources ps WHERE ps.tenant_id=t AND ps.is_active AND ps.product_id<>product.id AND ps.model_id=model AND ps.profile_id=technical AND ps.plate_index=n::integer) THEN
      RAISE EXCEPTION 'Uma placa desta configuração já pertence a outro vínculo. Resolva a associação exata antes de importar.';
    END IF;
    IF FOUND THEN
      IF (old.model_id IS NOT NULL AND old.model_id IS DISTINCT FROM model) OR (old.profile_id IS NOT NULL AND old.profile_id<>technical)
        OR (old.imported_plate_metadata->>'profile_id' IS NOT NULL AND old.imported_plate_metadata->>'profile_id'<>technical) THEN RAISE EXCEPTION 'A fonte já possui placas de outra configuração. Preserve a revisão existente e selecione outra fonte.'; END IF;
      -- Source refreshes enrich metadata, never overwrite manual planning or a published BOM.
      UPDATE product_print_plates SET imported_filaments=filaments,imported_plate_metadata=metadata,
        est_grams=coalesce(est_grams,grams),est_time_seconds=coalesce(est_time_seconds,seconds),printer_id=coalesce(printer_id,machine),
        model_id=CASE WHEN can_bind THEN coalesce(model_id,model) ELSE model_id END,
        profile_id=CASE WHEN can_bind THEN coalesce(profile_id,technical) ELSE profile_id END,
        updated_at=CASE WHEN (imported_filaments,imported_plate_metadata) IS DISTINCT FROM (filaments,metadata) THEN now() ELSE updated_at END
        WHERE id=old.id;
      result:=old.id;updated_count:=updated_count+1;
    ELSE
      IF EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.tenant_id=oi.tenant_id
        WHERE oi.product_id=product.id AND oi.tenant_id=t AND o.status='approved' AND oi.product_snapshot IS NULL) THEN
        RAISE EXCEPTION 'Este produto possui pedido legado aprovado sem receita preservada. Gere suas ordens antes de acrescentar placas ao catálogo.';
      END IF;
      INSERT INTO product_print_plates(tenant_id,product_id,source_id,plate_index,label,units_per_plate,est_grams,est_time_seconds,printer_id,imported_filaments,imported_plate_metadata,model_id,profile_id)
        VALUES(t,product.id,source.id,n::integer,coalesce(nullif(spec->>'name',''),'Placa '||n::integer),NULL,grams,seconds,machine,filaments,metadata,
          CASE WHEN can_bind THEN model END,CASE WHEN can_bind THEN technical END) RETURNING id INTO result;
      created_count:=created_count+1;
    END IF;
    IF p_task_id IS NOT NULL AND remote_index=n::integer THEN PERFORM public.bind_product_print_plate(result,task.id); END IF;
    ids:=array_append(ids,result);
    unresolved:=unresolved+(SELECT count(*) FROM jsonb_array_elements(filaments) f WHERE f->>'item_id' IS NULL OR f->>'grams' IS NULL);
  END LOOP;
  INSERT INTO product_print_source_imports(source_id,tenant_id,reference) VALUES(source.id,t,p_reference)
    ON CONFLICT(source_id) DO UPDATE SET reference=excluded.reference,updated_at=CASE WHEN product_print_source_imports.reference IS DISTINCT FROM excluded.reference THEN now() ELSE product_print_source_imports.updated_at END;
  UPDATE products SET external_import=p_reference WHERE id=product.id AND tenant_id=t
    AND (external_import IS NULL OR coalesce(external_import->>'design_id',external_import->>'id')=design);
  PERFORM erp_private.update_product_print_actuals(product.id);
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'import_physical_plates','product_print_sources',source.id,
    jsonb_build_object('design_id',design,'instance_id',instance,'profile_id',technical,'task_id',p_task_id,'plate_ids',ids,'created',created_count,'recipe_changed',false));
  RETURN jsonb_build_object('source_id',source.id,'product_id',product.id,'plate_ids',to_jsonb(ids),'created',created_count,'updated',updated_count,
    'pending_yield',(SELECT count(*) FROM product_print_plates WHERE id=ANY(ids) AND units_per_plate IS NULL),'unresolved_materials',unresolved);
END $$;
REVOKE ALL ON FUNCTION public.persist_source_plate_import(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.persist_source_plate_import(uuid,jsonb,uuid) TO authenticated;

-- Preserve the original cloud binding for the atomic import RPC above.
ALTER FUNCTION public.bind_product_print_source(uuid,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.bind_product_print_source(uuid,uuid) RENAME TO bind_source_before_plate_import;
CREATE FUNCTION public.bind_product_print_source(p_source_id uuid,p_task_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); source product_print_sources; task bambu_tasks; reference jsonb; profile jsonb; variant jsonb;
  plate product_print_plates; metadata jsonb; filaments jsonb; observed jsonb; index integer; machine uuid; result uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO source FROM product_print_sources WHERE id=p_source_id AND tenant_id=t AND is_active;
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t;
  IF source.id IS NULL OR task.id IS NULL OR erp_private.bambu_project_key(task.raw_data) IS NULL THEN RAISE EXCEPTION 'Selecione fonte e impressão Bambu da mesma empresa.'; END IF;
  IF (source.model_id IS NOT NULL AND source.model_id IS DISTINCT FROM task.raw_data->>'modelId') OR
    (source.profile_id IS NOT NULL AND source.profile_id IS DISTINCT FROM task.raw_data->>'profileId') THEN RAISE EXCEPTION 'A impressão não corresponde ao modelo/perfil já vinculado nesta fonte.'; END IF;
  SELECT external_import INTO reference FROM products WHERE id=source.product_id AND tenant_id=t FOR UPDATE;
  IF reference IS NOT NULL THEN
    SELECT value INTO profile FROM jsonb_array_elements(reference->'profiles') WHERE value->>'instance_id'=task.raw_data->>'instanceId';
    IF profile IS NOT NULL THEN
      SELECT v INTO variant FROM(SELECT profile AS v UNION ALL SELECT value FROM jsonb_array_elements(profile->'variants')) options WHERE v->>'profile_id'=task.raw_data->>'profileId' LIMIT 1;
      IF variant IS NOT NULL AND jsonb_array_length(variant->'plate_details')>0 THEN
        PERFORM public.persist_source_plate_import(source.id,reference||jsonb_build_object('selected_profile_id',profile->>'instance_id','selected_variant_profile_id',variant->>'profile_id'),task.id);
        RETURN source.id;
      END IF;
    END IF;
  END IF;
  PERFORM erp_private.bind_source_before_plate_import(source.id,task.id);
  index:=(task.raw_data->>'plateIndex')::integer;
  IF index NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Índice da placa Bambu inválido.'; END IF;
  observed:=erp_private.import_observed_filaments(task);
  -- History colors are observations, not the MakerWorld author's planned colors.
  filaments:='[]'::jsonb;
  metadata:=jsonb_build_object('provider','bambu_history','model_id',task.raw_data->>'modelId','profile_id',task.raw_data->>'profileId',
    'design_id',nullif(task.raw_data->>'designId','0'),'instance_id',nullif(task.raw_data->>'instanceId','0'),'observed',observed,
    'plate',jsonb_build_object('index',index,'weight_grams',task.weight_grams,'time_seconds',task.cost_time_seconds),'planned_filaments_available',false);
  SELECT printer_id INTO machine FROM bambu_devices WHERE id=task.bambu_device_id AND tenant_id=t;
  SELECT * INTO plate FROM product_print_plates WHERE tenant_id=t AND source_id=source.id AND plate_index=index AND is_active FOR UPDATE;
  IF FOUND THEN
    IF plate.imported_plate_metadata->>'provider'='makerworld' THEN
      UPDATE product_print_plates SET imported_plate_metadata=jsonb_set(imported_plate_metadata,'{observed}',observed),updated_at=now() WHERE id=plate.id;
    ELSE UPDATE product_print_plates SET imported_plate_metadata=metadata,est_grams=coalesce(est_grams,task.weight_grams),est_time_seconds=coalesce(est_time_seconds,task.cost_time_seconds),printer_id=coalesce(printer_id,machine) WHERE id=plate.id;END IF;
    result:=plate.id;
  ELSE
    IF EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.tenant_id=oi.tenant_id WHERE oi.tenant_id=t AND oi.product_id=source.product_id AND o.status='approved' AND oi.product_snapshot IS NULL) THEN RAISE EXCEPTION 'Gere as ordens do pedido legado aprovado antes de acrescentar placas ao catálogo.'; END IF;
    INSERT INTO product_print_plates(tenant_id,product_id,source_id,plate_index,label,units_per_plate,est_grams,est_time_seconds,printer_id,imported_filaments,imported_plate_metadata)
      VALUES(t,source.product_id,source.id,index,coalesce(task.design_title,'Placa Bambu')||' · '||index,NULL,task.weight_grams,task.cost_time_seconds,machine,filaments,metadata) RETURNING id INTO result;
  END IF;
  PERFORM public.bind_product_print_plate(result,task.id);
  PERFORM erp_private.update_product_print_actuals(source.product_id);
  RETURN source.id;
END $$;
REVOKE ALL ON FUNCTION public.bind_product_print_source(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bind_product_print_source(uuid,uuid) TO authenticated;

CREATE FUNCTION public.save_source_with_plate_import(p_source_id uuid,p_product_id uuid,p_source jsonb,p_reference jsonb,p_request_id uuid,p_task_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; source uuid; result jsonb;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'source_plate_import',jsonb_build_array(p_source_id,p_product_id,p_source,p_reference,p_task_id));
  IF prior IS NOT NULL THEN RETURN jsonb_build_object('source_id',prior,'product_id',p_product_id,'plate_ids',(SELECT coalesce(jsonb_agg(id ORDER BY plate_index),'[]') FROM product_print_plates WHERE tenant_id=t AND source_id=prior AND is_active),
    'created',0,'updated',(SELECT count(*) FROM product_print_plates WHERE tenant_id=t AND source_id=prior AND is_active),
    'pending_yield',(SELECT count(*) FROM product_print_plates WHERE tenant_id=t AND source_id=prior AND is_active AND units_per_plate IS NULL),'unresolved_materials',NULL,'replayed',true); END IF;
  source:=public.save_product_print_source(p_source_id,p_product_id,p_source);
  result:=public.persist_source_plate_import(source,p_reference,p_task_id);
  PERFORM erp_private.finish_request(t,p_request_id,source);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_source_with_plate_import(uuid,uuid,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_source_with_plate_import(uuid,uuid,jsonb,jsonb,uuid,uuid) TO authenticated;

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_plate_import;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; result uuid; source uuid; reference jsonb; selected text; variant jsonb; profile jsonb;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  result:=erp_private.save_product_before_plate_import(p_product_id,p_product,p_photos,p_request_id);
  reference:=nullif(p_product->'external_import','null'::jsonb);
  IF reference IS NOT NULL THEN
    selected:=coalesce(nullif(reference->>'selected_profile_id',''),nullif(reference->>'selected_instance_id',''));
    SELECT value INTO profile FROM jsonb_array_elements(reference->'profiles') WHERE value->>'instance_id'=selected;
    SELECT v INTO variant FROM(SELECT profile AS v UNION ALL SELECT value FROM jsonb_array_elements(coalesce(profile->'variants','[]'))) options WHERE v->>'profile_id'=reference->>'selected_variant_profile_id' LIMIT 1;
    IF p_product_id IS NULL AND variant IS NOT NULL AND jsonb_array_length(variant->'plate_details')=0 THEN RAISE EXCEPTION 'A configuração selecionada não informou as placas. Escolha outra configuração ou vincule uma impressão Bambu real.'; END IF;
    IF variant IS NOT NULL AND jsonb_array_length(variant->'plate_details')>0 THEN
      SELECT id INTO source FROM product_print_sources WHERE tenant_id=t AND product_id=result AND is_active AND design_id=reference->>'design_id' AND source_url IS NOT NULL ORDER BY created_at,id LIMIT 1;
      PERFORM public.persist_source_plate_import(source,reference,NULL);
    END IF;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

ALTER FUNCTION erp_private.product_bom_snapshot_recursive(uuid,uuid,uuid[]) RENAME TO product_bom_before_pending_plates;
CREATE FUNCTION erp_private.product_bom_snapshot_recursive(p_product_id uuid,p_tenant_id uuid,p_path uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; plate product_print_plates; missing jsonb:='[]';
BEGIN
  result:=erp_private.product_bom_before_pending_plates(p_product_id,p_tenant_id,p_path);
  FOR plate IN SELECT * FROM product_print_plates WHERE product_id=p_product_id AND tenant_id=p_tenant_id AND is_active LOOP
    IF plate.units_per_plate IS NULL THEN missing:=missing||jsonb_build_array('Confirme as unidades atendidas por impressão da placa '||plate.label||'.'); END IF;
    IF jsonb_typeof(plate.imported_plate_metadata->'declared_plate_count')='number' AND (plate.imported_plate_metadata->>'declared_plate_count')::numeric>(plate.imported_plate_metadata->>'imported_plate_count')::numeric THEN
      missing:=missing||jsonb_build_array('A fonte não detalhou todas as placas desta configuração. Complete os dados do arquivo antes de orçar ou produzir.');
    END IF;
  END LOOP;
  IF jsonb_array_length(missing)>0 THEN result:=result||jsonb_build_object('complete',false,'cost_per_unit',NULL,'missing',coalesce(result->'missing','[]')||missing); END IF;
  RETURN result;
END $$;

-- Existing confirmed values remain valid. Missing values are no longer coerced to one.
DO $$ DECLARE definition text; needle text; BEGIN
  definition:=pg_get_functiondef('public.save_product_print_plate(uuid,uuid,uuid,jsonb)'::regprocedure);
  needle:='plate.units_per_plate:=coalesce(plate.units_per_plate,1);';
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review the plate yield contract.'; END IF;
  EXECUTE replace(definition,needle,'-- NULL yield remains pending until explicitly confirmed.');
  definition:=pg_get_functiondef('public.save_product_material_recipe(uuid,uuid,text,jsonb,text,uuid,numeric)'::regprocedure);
  needle:='units:=plate.units_per_plate;';
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review recipe yield validation.'; END IF;
  EXECUTE replace(definition,needle,needle||E'\n    IF units IS NULL THEN RAISE EXCEPTION ''Confirme as unidades atendidas por impressão desta placa antes de publicar a composição.''; END IF;');
  definition:=pg_get_functiondef('public.plan_product_plates(uuid,integer,uuid)'::regprocedure);
  needle:='IF jsonb_array_length(coalesce(snapshot->''requirements'',''[]''))=0 THEN';
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review production planning fallback.'; END IF;
  EXECUTE replace(definition,needle,'IF jsonb_array_length(coalesce(snapshot->''requirements'',''[]''))=0 AND NOT EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=p_product_id AND tenant_id=t AND is_active AND imported_plate_metadata IS NOT NULL) THEN');
END $$;

CREATE FUNCTION public.prepare_product_plate_recipe(p_product_id uuid,p_plate_id uuid,p_units_per_plate integer,p_basis text,p_lines jsonb,p_notes text,p_request_id uuid,p_non_material_cost_per_unit numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; plate product_print_plates; result uuid; recipe_request uuid;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'prepare_plate_recipe',jsonb_build_array(p_product_id,p_plate_id,p_units_per_plate,p_basis,p_lines,p_notes,p_non_material_cost_per_unit));
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF p_units_per_plate IS NULL OR p_units_per_plate NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Confirme de 1 a 10000 unidades do produto atendidas por impressão desta placa.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  SELECT * INTO plate FROM product_print_plates WHERE id=p_plate_id AND product_id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione uma placa ativa deste produto.'; END IF;
  IF plate.units_per_plate IS DISTINCT FROM p_units_per_plate THEN
    PERFORM public.save_product_print_plate(plate.id,plate.product_id,plate.source_id,jsonb_build_object('plate_index',plate.plate_index,'label',plate.label,
      'units_per_plate',p_units_per_plate,'material_id',plate.material_id,'printer_id',plate.printer_id,'est_grams',plate.est_grams,
      'est_time_seconds',plate.est_time_seconds,'est_cost_per_unit',plate.est_cost_per_unit));
  END IF;
  recipe_request:=md5(p_request_id::text||'/plate-recipe')::uuid;
  result:=public.save_product_material_recipe(p_product_id,p_plate_id,p_basis,p_lines,p_notes,recipe_request,p_non_material_cost_per_unit);
  PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.prepare_product_plate_recipe(uuid,uuid,integer,text,jsonb,text,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_product_plate_recipe(uuid,uuid,integer,text,jsonb,text,uuid,numeric) TO authenticated;

CREATE FUNCTION public.erp_imported_plate_job_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- Never reinterpret pre-existing jobs or the snapshot of an approved sale.
  IF TG_OP='INSERT' AND NEW.order_item_id IS NULL AND NEW.reprint_of IS NULL AND NEW.status IN('draft','queued')
    AND EXISTS(SELECT 1 FROM product_print_plates WHERE tenant_id=NEW.tenant_id AND product_id=NEW.product_id AND is_active AND imported_plate_metadata IS NOT NULL)
    AND NOT coalesce((NEW.production_snapshot->>'complete')::boolean,false) THEN
    RAISE EXCEPTION 'Confirme rendimento, materiais e custos das placas importadas antes de criar produção. Os pesos e tempos já estão preenchidos.';
  END IF;
  RETURN NEW;
END $$;
-- Alphabetically follows erp_job_production_snapshot, which captures the recipe.
CREATE TRIGGER erp_z_imported_plate_job_guard BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION erp_imported_plate_job_guard();
REVOKE ALL ON FUNCTION public.erp_imported_plate_job_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.import_color_hex(text),erp_private.import_filament_matches(uuid,jsonb),erp_private.import_observed_filaments(public.bambu_tasks),
  erp_private.bind_source_before_plate_import(uuid,uuid),erp_private.save_product_before_plate_import(uuid,jsonb,jsonb,uuid),
  erp_private.product_bom_before_pending_plates(uuid,uuid,uuid[]),erp_private.product_bom_snapshot_recursive(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
