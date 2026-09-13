-- A SKU keeps its base recipe. Each quote, sale and physical execution may
-- select another identified color of the same material, with its own cost.
ALTER TABLE public.sales_quote_items ADD COLUMN material_overrides jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(material_overrides)='array');
ALTER TABLE public.order_items ADD COLUMN material_overrides jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(material_overrides)='array');
ALTER TABLE public.bambu_production_records ADD COLUMN material_overrides jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(material_overrides)='array'),ADD COLUMN material_snapshot jsonb;
ALTER TABLE public.bambu_production_profiles ADD COLUMN material_overrides jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(material_overrides)='array'),ADD COLUMN material_snapshot jsonb;
ALTER TABLE public.jobs ADD COLUMN material_selection_snapshot jsonb;

CREATE FUNCTION erp_private.variant_missing(p_missing jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(value),'[]') FROM jsonb_array_elements(coalesce(p_missing,'[]'))
    WHERE value#>>'{}' NOT LIKE 'Material/cor inativo, não identificado ou unidade incompatível:%'
      AND value#>>'{}' NOT LIKE 'Custo médio ainda não confirmado por entrada de estoque:%'
$$;

CREATE FUNCTION erp_private.variant_recipe(p_recipe jsonb,p_product uuid,p_plate uuid,p_overrides jsonb,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE line jsonb; replacement jsonb; selected inventory_items; lines jsonb:='[]'; missing jsonb; known boolean; ready boolean;
  material_total numeric:=0; all_known boolean:=true; amount numeric; total numeric; base uuid; chosen uuid;
BEGIN
  IF p_recipe IS NULL OR p_recipe='null'::jsonb THEN RETURN p_recipe; END IF;
  missing:=erp_private.variant_missing(p_recipe->'missing');
  FOR line IN SELECT value FROM jsonb_array_elements(p_recipe->'lines') LOOP
    base:=coalesce(nullif(line->>'base_item_id',''),line->>'item_id')::uuid;
    SELECT value INTO replacement FROM jsonb_array_elements(p_overrides) WHERE value->>'product_id'=p_product::text
      AND nullif(value->>'plate_id','')::uuid IS NOT DISTINCT FROM p_plate AND value->>'base_item_id'=base::text;
    chosen:=coalesce((replacement->>'item_id')::uuid,(line->>'item_id')::uuid);
    SELECT * INTO selected FROM inventory_items WHERE id=chosen AND tenant_id=p_tenant;
    IF selected.id IS NULL OR selected.material_code IS DISTINCT FROM line->>'material_code' THEN RAISE EXCEPTION 'A cor escolhida deve ser do mesmo material da composição e da mesma empresa.'; END IF;
    ready:=selected.is_active AND selected.material_identified_at IS NOT NULL AND selected.color IS NOT NULL AND selected.color_code IS NOT NULL
      AND lower(btrim(selected.unit)) IN('g','kg');
    IF replacement IS NOT NULL AND NOT ready THEN RAISE EXCEPTION 'Selecione um material ativo, identificado e com estoque em g ou kg.'; END IF;
    known:=selected.avg_cost IS NOT NULL AND (selected.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements WHERE tenant_id=p_tenant AND item_id=selected.id));
    IF NOT ready THEN missing:=missing||jsonb_build_array('Material/cor inativo, não identificado ou unidade incompatível: '||selected.name); END IF;
    IF NOT known THEN missing:=missing||jsonb_build_array('Custo médio ainda não confirmado por entrada de estoque: '||selected.name);all_known:=false; END IF;
    amount:=CASE WHEN known THEN (line->>'grams_per_unit')::numeric/CASE lower(btrim(selected.unit)) WHEN 'kg' THEN 1000 ELSE 1 END*selected.avg_cost END;
    material_total:=material_total+coalesce(amount,0);
    lines:=lines||jsonb_build_array(line||jsonb_build_object('base_item_id',base,'item_id',chosen,'name',selected.name,'unit',selected.unit,
      'material_type',selected.material_type,'material_code',selected.material_code,'material_description',selected.material_description,
      'color',selected.color,'color_code',selected.color_code,'color_hex',selected.color_hex,'unit_cost',CASE WHEN known THEN selected.avg_cost END,
      'cost_per_unit',amount,'cost_per_print',CASE WHEN known THEN (line->>'grams_per_print')::numeric/CASE lower(btrim(selected.unit)) WHEN 'kg' THEN 1000 ELSE 1 END*selected.avg_cost END,
      'material_ready',ready,'cost_known',known,'selection_origin',CASE WHEN chosen=base THEN 'base_recipe' ELSE 'material_variant' END));
  END LOOP;
  IF jsonb_array_length(missing)=0 AND all_known THEN total:=material_total+(p_recipe->>'non_material_cost_per_unit')::numeric; END IF;
  RETURN p_recipe||jsonb_build_object('lines',lines,'material_cost_per_unit',CASE WHEN all_known THEN material_total END,'cost_per_unit',total,'missing',missing,'complete',jsonb_array_length(missing)=0 AND total IS NOT NULL);
END $$;

CREATE FUNCTION erp_private.variant_snapshot_recursive(p_snapshot jsonb,p_overrides jsonb,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb:=p_snapshot; child jsonb; component jsonb; plate jsonb; recipe jsonb; line jsonb;
  components jsonb:='[]'; plates jsonb:='[]'; requirements jsonb:='[]'; missing jsonb:=erp_private.variant_missing(p_snapshot->'missing');
  total numeric:=0; material_total numeric:=0; material_known boolean:=true; quantity numeric; product uuid:=(p_snapshot->'product'->>'id')::uuid;
BEGIN
  IF jsonb_array_length(coalesce(p_snapshot->'components','[]'))>0 THEN
    FOR component IN SELECT value FROM jsonb_array_elements(p_snapshot->'components') LOOP
      quantity:=(component->>'quantity')::numeric;child:=erp_private.variant_snapshot_recursive(component->'snapshot',p_overrides,p_tenant);
      components:=components||jsonb_build_array(component||jsonb_build_object('snapshot',child));
      IF NOT coalesce((child->>'complete')::boolean,false) THEN missing:=missing||coalesce(child->'missing','[]'); END IF;
      total:=total+coalesce((child->>'cost_per_unit')::numeric,0)*quantity;
      IF child->>'material_cost_per_unit' IS NULL THEN material_known:=false;ELSE material_total:=material_total+(child->>'material_cost_per_unit')::numeric*quantity;END IF;
      FOR line IN SELECT value FROM jsonb_array_elements(child->'requirements') LOOP
        requirements:=requirements||jsonb_build_array(line||jsonb_build_object('component_quantity',coalesce((line->>'component_quantity')::numeric,1)*quantity,
          'grams_per_unit',(line->>'grams_per_unit')::numeric*quantity,'cost_per_unit',(line->>'cost_per_unit')::numeric*quantity));
      END LOOP;
    END LOOP;
    total:=total+coalesce((p_snapshot->>'kit_extras_cost_per_unit')::numeric,0);
    result:=result||jsonb_build_object('components',components);
  ELSE
    FOR plate IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(p_snapshot->'plates','[]'))>0 THEN p_snapshot->'plates' ELSE '[{}]'::jsonb END) LOOP
      recipe:=erp_private.variant_recipe(CASE WHEN plate ? 'id' THEN plate->'recipe' ELSE p_snapshot->'recipe' END,product,(plate->>'id')::uuid,p_overrides,p_tenant);
      IF recipe IS NULL OR recipe='null'::jsonb THEN
        IF plate ? 'id' THEN plates:=plates||jsonb_build_array(plate);END IF;
        CONTINUE;
      END IF;
      IF NOT coalesce((recipe->>'complete')::boolean,false) THEN missing:=missing||coalesce(recipe->'missing','[]'); END IF;
      total:=total+coalesce((recipe->>'cost_per_unit')::numeric,0);
      IF recipe->>'material_cost_per_unit' IS NULL THEN material_known:=false;ELSE material_total:=material_total+(recipe->>'material_cost_per_unit')::numeric;END IF;
      FOR line IN SELECT value FROM jsonb_array_elements(recipe->'lines') LOOP requirements:=requirements||jsonb_build_array(line||jsonb_build_object('product_id',product,'plate_id',plate->>'id','recipe_version_id',recipe->>'version_id'));END LOOP;
      IF plate ? 'id' THEN plates:=plates||jsonb_build_array(plate||jsonb_build_object('recipe',recipe));ELSE result:=result||jsonb_build_object('recipe',recipe);END IF;
    END LOOP;
    result:=result||jsonb_build_object('plates',plates);
  END IF;
  SELECT coalesce(jsonb_agg(value),'[]') INTO missing FROM(SELECT DISTINCT value FROM jsonb_array_elements(missing)) reasons;
  RETURN result||jsonb_build_object('requirements',requirements,'material_overrides',p_overrides,'material_cost_per_unit',CASE WHEN material_known AND jsonb_array_length(requirements)>0 THEN material_total END,
    'cost_per_unit',CASE WHEN jsonb_array_length(missing)=0 AND jsonb_array_length(requirements)>0 THEN total END,'complete',jsonb_array_length(missing)=0 AND jsonb_array_length(requirements)>0,'missing',missing);
END $$;

CREATE FUNCTION erp_private.apply_material_variants(p_snapshot jsonb,p_overrides jsonb,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE entry jsonb; key text; seen text[]:='{}'; identity text;
BEGIN
  IF jsonb_typeof(p_overrides) IS DISTINCT FROM 'array' OR jsonb_array_length(p_overrides)>256 THEN RAISE EXCEPTION 'Seleção de materiais inválida.'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_overrides) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Cada seleção precisa identificar o componente, placa e material.'; END IF;
    FOR key IN SELECT jsonb_object_keys(entry) LOOP IF key NOT IN('product_id','plate_id','base_item_id','item_id') THEN RAISE EXCEPTION 'Campo da seleção de material não permitido.'; END IF; END LOOP;
    identity:=jsonb_build_array(entry->>'product_id',nullif(entry->>'plate_id',''),entry->>'base_item_id')::text;
    IF identity=ANY(seen) OR entry->>'item_id' IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_snapshot->'requirements','[]')) line
      WHERE line->>'product_id'=entry->>'product_id' AND nullif(line->>'plate_id','') IS NOT DISTINCT FROM nullif(entry->>'plate_id','')
        AND coalesce(line->>'base_item_id',line->>'item_id')=entry->>'base_item_id') THEN RAISE EXCEPTION 'Seleção repetida ou fora dos componentes e placas desta composição.'; END IF;
    PERFORM erp_private.assert_ref('inventory_items',(entry->>'item_id')::uuid,p_tenant);seen:=array_append(seen,identity);
  END LOOP;
  RETURN erp_private.variant_snapshot_recursive(p_snapshot,p_overrides,p_tenant);
END $$;
CREATE FUNCTION erp_private.product_material_variant_snapshot(p_product uuid,p_tenant uuid,p_overrides jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT erp_private.apply_material_variants(erp_private.product_bom_snapshot(p_product,p_tenant),p_overrides,p_tenant) $$;

CREATE FUNCTION erp_private.material_variant_options(p_snapshot jsonb,p_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',line->>'product_id','plate_id',line->>'plate_id',
    'product_name',(SELECT name FROM products WHERE id=(line->>'product_id')::uuid AND tenant_id=p_tenant),
    'plate_label',(SELECT label FROM product_print_plates WHERE id=(line->>'plate_id')::uuid AND tenant_id=p_tenant),
    'base_item_id',coalesce(line->>'base_item_id',line->>'item_id'),
    'selected_item_id',line->>'item_id','options',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'material_code',i.material_code,
      'color',i.color,'color_code',i.color_code,'color_hex',i.color_hex,'unit',i.unit,'avg_cost',i.avg_cost,'current_stock',i.current_stock,
      'cost_known',i.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements WHERE tenant_id=p_tenant AND item_id=i.id)) ORDER BY i.color,i.name,i.id),'[]')
      FROM inventory_items i WHERE i.tenant_id=p_tenant AND i.is_active AND i.material_identified_at IS NOT NULL AND i.color_code IS NOT NULL AND i.color IS NOT NULL
        AND lower(btrim(i.unit)) IN('g','kg') AND i.material_code=line->>'material_code'))),'[]')
  FROM(SELECT DISTINCT ON(value->>'product_id',nullif(value->>'plate_id',''),coalesce(value->>'base_item_id',value->>'item_id')) value AS line
    FROM jsonb_array_elements(coalesce(p_snapshot->'requirements','[]'))
    ORDER BY value->>'product_id',nullif(value->>'plate_id',''),coalesce(value->>'base_item_id',value->>'item_id')) lines
$$;
CREATE FUNCTION public.product_material_variant_preview(p_product_id uuid,p_material_overrides jsonb DEFAULT '[]',p_quantity integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); snapshot jsonb; estimate numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t) THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe uma quantidade válida para prever os lotes completos.'; END IF;
  snapshot:=erp_private.product_material_variant_snapshot(p_product_id,t,p_material_overrides);estimate:=erp_private.quote_estimated_cost(snapshot,p_quantity);
  RETURN jsonb_build_object('snapshot',snapshot,'material_options',erp_private.material_variant_options(snapshot,t),'complete',snapshot->'complete','missing',snapshot->'missing',
    'cost_per_unit',snapshot->'cost_per_unit','estimated_total_cost',estimate,'estimated_unit_cost',estimate/p_quantity);
END $$;
REVOKE ALL ON FUNCTION public.product_material_variant_preview(uuid,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_material_variant_preview(uuid,jsonb,integer) TO authenticated;

-- Extend existing atomic commercial operations without introducing a second save.
DO $$ DECLARE definition text; needle text; BEGIN
  definition:=pg_get_functiondef('public.save_sales_quote(uuid,jsonb,jsonb,uuid)'::regprocedure);
  definition:=replace(definition,'ARRAY[''product_id'',''description'',''quantity'',''unit_price'',''total'',''notes'']','ARRAY[''product_id'',''description'',''quantity'',''unit_price'',''total'',''notes'',''material_overrides'']');
  needle:='snapshot:=erp_private.product_bom_snapshot(product.id,t);';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review quotation snapshot capture.'; END IF;
  definition:=replace(definition,needle,'snapshot:=erp_private.product_material_variant_snapshot(product.id,t,coalesce(item->''material_overrides'',''[]''));');
  definition:=replace(definition,'estimated_total_cost,product_snapshot)','estimated_total_cost,product_snapshot,material_overrides)');
  definition:=replace(definition,'erp_private.quote_estimated_cost(snapshot,qty::integer),snapshot);','erp_private.quote_estimated_cost(snapshot,qty::integer),snapshot,coalesce(item->''material_overrides'',''[]''));');EXECUTE definition;
  definition:=pg_get_functiondef('public.transition_sales_quote(uuid,text,text)'::regprocedure);
  needle:='erp_private.product_bom_snapshot(item.product_id,t)';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review quotation emission.'; END IF;
  EXECUTE replace(definition,needle,'erp_private.product_material_variant_snapshot(item.product_id,t,item.material_overrides)');
  definition:=pg_get_functiondef('public.convert_sales_quote(uuid,uuid)'::regprocedure);
  definition:=replace(definition,'product_snapshot,quoted_estimated_cost)','product_snapshot,quoted_estimated_cost,material_overrides)');
  definition:=replace(definition,'item.product_snapshot,item.estimated_total_cost);','item.product_snapshot,item.estimated_total_cost,item.material_overrides);');EXECUTE definition;
  definition:=pg_get_functiondef('public.save_sales_order(uuid,jsonb,jsonb,uuid)'::regprocedure);
  needle:='subtotal:=subtotal+round(qty*price,2);';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review order item validation.'; END IF;
  definition:=replace(definition,needle,'IF jsonb_array_length(coalesce(item->''material_overrides'',''[]''))>0 THEN PERFORM erp_private.product_material_variant_snapshot(nullif(item->>''product_id'','''')::uuid,t,item->''material_overrides''); END IF;'||E'\n    '||needle);
  definition:=replace(definition,'product_id,description,quantity,unit_price,total,notes)','product_id,description,quantity,unit_price,total,notes,material_overrides)');
  definition:=replace(definition,'(item->>''total'')::numeric,item->>''notes'');','(item->>''total'')::numeric,item->>''notes'',coalesce(item->''material_overrides'',''[]''));');EXECUTE definition;
  definition:=pg_get_functiondef('public.transition_sales_order(uuid,text)'::regprocedure);
  needle:='snapshot:=erp_private.product_bom_snapshot(item.product_id,t);';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review direct sale approval.'; END IF;
  EXECUTE replace(definition,needle,'snapshot:=erp_private.product_material_variant_snapshot(item.product_id,t,item.material_overrides);');
END $$;

CREATE FUNCTION public.erp_order_material_selection_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.material_overrides IS DISTINCT FROM OLD.material_overrides AND EXISTS(SELECT 1 FROM orders WHERE id=OLD.order_id AND status<>'draft') THEN
    RAISE EXCEPTION 'A seleção de cores e materiais foi aprovada com a venda e está congelada.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_order_material_selection_guard BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION erp_order_material_selection_guard();
REVOKE ALL ON FUNCTION public.erp_order_material_selection_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.variant_missing(jsonb),erp_private.variant_recipe(jsonb,uuid,uuid,jsonb,uuid),erp_private.variant_snapshot_recursive(jsonb,jsonb,uuid),
  erp_private.apply_material_variants(jsonb,jsonb,uuid),erp_private.product_material_variant_snapshot(uuid,uuid,jsonb),erp_private.material_variant_options(jsonb,uuid) FROM PUBLIC,anon,authenticated;

-- Enrich existing source keys; their identity stays byte-for-byte unchanged.
DO $$ DECLARE definition text; needle text; BEGIN
  definition:=pg_get_functiondef('erp_private.bambu_filaments(jsonb,numeric)'::regprocedure);
  needle:='''planned_grams'',n));';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review AMS source-key format.'; END IF;
  EXECUTE replace(definition,needle,'''planned_grams'',n,''source_type'',part->>''filamentType'',''source_color'',part->>''sourceColor'',''target_type'',part->>''targetFilamentType'',''target_color'',part->>''targetColor'',''ams_id'',part->''amsId'',''slot_id'',part->''slotId''));');
END $$;

CREATE FUNCTION erp_private.bambu_material_context(p_task_id uuid,p_product uuid,p_plate uuid,p_allocations jsonb,p_overrides jsonb,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE task bambu_tasks; job jobs; allocation jsonb; snapshot jsonb; first_snapshot jsonb; snapshots jsonb:='[]'; expected jsonb:='[]';
  policy text:='execution_variant'; missing jsonb:='[]'; line jsonb; entry jsonb; f jsonb; filaments jsonb:='[]'; saved jsonb; config bambu_production_profiles; rec bambu_production_records;
  picked inventory_items; suggested uuid; candidates uuid[]; base_candidates uuid[]; history_candidates uuid[]; base uuid; saved_id uuid; mapped uuid; actual_ids uuid[]; expected_ids uuid[]; saved_history boolean;
BEGIN
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=p_tenant;
  IF task.id IS NULL OR NOT EXISTS(SELECT 1 FROM products WHERE id=p_product AND tenant_id=p_tenant AND is_active) THEN RAISE EXCEPTION 'Selecione a impressão e o produto da mesma empresa.'; END IF;
  IF p_plate IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_print_plates WHERE id=p_plate AND tenant_id=p_tenant AND product_id=p_product AND is_active) THEN RAISE EXCEPTION 'Placa inválida para este produto.'; END IF;
  IF jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' OR jsonb_typeof(p_overrides) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Alocações e seleção de materiais inválidas.'; END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    SELECT * INTO job FROM jobs WHERE id=(allocation->>'job_id')::uuid AND tenant_id=p_tenant AND product_id=p_product AND print_plate_id IS NOT DISTINCT FROM p_plate;
    IF NOT FOUND THEN RAISE EXCEPTION 'A ordem escolhida não pertence ao produto e placa desta execução.'; END IF;
    IF job.order_item_id IS NOT NULL THEN policy:='approved_order'; END IF;
    snapshot:=coalesce(job.material_selection_snapshot,job.production_snapshot);
    IF snapshot IS NOT NULL THEN snapshots:=snapshots||jsonb_build_array(snapshot); END IF;
  END LOOP;
  IF jsonb_array_length(snapshots)=0 THEN snapshots:=jsonb_build_array(erp_private.product_bom_snapshot(p_product,p_tenant));END IF;
  FOR snapshot IN SELECT value FROM jsonb_array_elements(snapshots) LOOP
    IF policy='approved_order' THEN
      FOR entry IN SELECT value FROM jsonb_array_elements(p_overrides) LOOP
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'requirements') x WHERE x->>'product_id'=entry->>'product_id'
          AND nullif(x->>'plate_id','') IS NOT DISTINCT FROM nullif(entry->>'plate_id','') AND coalesce(x->>'base_item_id',x->>'item_id')=entry->>'base_item_id' AND x->>'item_id'=entry->>'item_id') THEN
          RAISE EXCEPTION 'As cores da venda já estão aprovadas. Esta execução deve usar os materiais preservados no pedido.';
        END IF;
      END LOOP;
    ELSIF jsonb_array_length(coalesce(snapshot->'requirements','[]'))>0 THEN snapshot:=erp_private.apply_material_variants(snapshot,p_overrides,p_tenant);
    ELSIF jsonb_array_length(p_overrides)>0 THEN RAISE EXCEPTION 'Esta execução ainda não possui uma linha-base de composição para substituir.';
    END IF;
    SELECT array_agg(DISTINCT (value->>'item_id')::uuid ORDER BY (value->>'item_id')::uuid) INTO actual_ids FROM jsonb_array_elements(coalesce(snapshot->'requirements','[]')) WHERE nullif(value->>'plate_id','')::uuid IS NOT DISTINCT FROM p_plate;
    IF first_snapshot IS NULL THEN first_snapshot:=snapshot;expected_ids:=actual_ids;
    ELSIF expected_ids IS DISTINCT FROM actual_ids THEN missing:=missing||jsonb_build_array('As ordens escolhidas exigem cores ou materiais diferentes. Separe as execuções ou revise a alocação.');END IF;
  END LOOP;
  IF expected_ids IS NULL AND policy<>'approved_order' THEN policy:='legacy_unconfigured'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',x->>'product_id','plate_id',x->>'plate_id','base_item_id',coalesce(x->>'base_item_id',x->>'item_id'),
    'selected_item_id',x->>'item_id','item_id',x->>'item_id','name',x->>'name','material_code',x->>'material_code','color',x->>'color',
    'color_code',x->>'color_code','color_hex',x->>'color_hex','unit',x->>'unit','unit_cost',x->'unit_cost','grams_per_print',x->'grams_per_print')),'[]') INTO expected
    FROM(SELECT DISTINCT ON(value->>'product_id',nullif(value->>'plate_id',''),coalesce(value->>'base_item_id',value->>'item_id')) value AS x
      FROM jsonb_array_elements(coalesce(first_snapshot->'requirements','[]')) WHERE nullif(value->>'plate_id','')::uuid IS NOT DISTINCT FROM p_plate
      ORDER BY value->>'product_id',nullif(value->>'plate_id',''),coalesce(value->>'base_item_id',value->>'item_id')) requirements;
  SELECT * INTO rec FROM bambu_production_records WHERE task_id=task.id AND product_id=p_product AND plate_id IS NOT DISTINCT FROM p_plate;
  SELECT * INTO config FROM bambu_production_profiles WHERE tenant_id=p_tenant AND bambu_device_id=task.bambu_device_id AND project_key=erp_private.bambu_project_key(task.raw_data) AND product_id=p_product AND plate_id IS NOT DISTINCT FROM p_plate;
  FOR f IN SELECT value FROM jsonb_array_elements(erp_private.bambu_filaments(task.raw_data,task.weight_grams)) LOOP
    SELECT array_agg(DISTINCT (x->>'base_item_id')::uuid) INTO base_candidates FROM jsonb_array_elements(expected) x
      JOIN inventory_items base_item ON base_item.id=(x->>'base_item_id')::uuid AND base_item.tenant_id=p_tenant
      WHERE base_item.material_code=upper(btrim(f->>'source_type')) AND base_item.color_hex=erp_private.import_color_hex(f->>'source_color');
    base:=CASE WHEN cardinality(base_candidates)=1 THEN base_candidates[1] END;
    SELECT array_agg(i.id ORDER BY i.id) INTO candidates FROM inventory_items i WHERE i.tenant_id=p_tenant AND i.is_active AND i.material_identified_at IS NOT NULL
      AND lower(btrim(i.unit)) IN('g','kg') AND i.material_code=upper(btrim(f->>'target_type')) AND i.color_hex=erp_private.import_color_hex(f->>'target_color');
    suggested:=CASE WHEN cardinality(candidates)=1 THEN candidates[1] END;
    SELECT value INTO saved FROM jsonb_array_elements(coalesce(rec.materials,config.materials,'[]')) WHERE value->>'source_key'=f->>'source_key' LIMIT 1;
    saved_id:=(saved->>'item_id')::uuid;saved_history:=false;
    IF saved_id IS NULL THEN
      SELECT array_agg(DISTINCT (m->>'item_id')::uuid) INTO history_candidates
        FROM bambu_production_records previous JOIN bambu_tasks historical ON historical.id=previous.task_id AND historical.tenant_id=previous.tenant_id
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(previous.materials,'[]')) m
        JOIN inventory_items stock ON stock.id=(m->>'item_id')::uuid AND stock.tenant_id=p_tenant AND stock.is_active AND lower(btrim(stock.unit)) IN('g','kg')
        WHERE previous.tenant_id=p_tenant AND previous.product_id=p_product AND previous.plate_id IS NOT DISTINCT FROM p_plate
          AND historical.bambu_device_id=task.bambu_device_id AND erp_private.bambu_project_key(historical.raw_data)=erp_private.bambu_project_key(task.raw_data)
          AND m->>'source_key'=f->>'source_key';
      IF cardinality(history_candidates)=1 THEN saved_id:=history_candidates[1];saved_history:=true; END IF;
    END IF;
    SELECT * INTO picked FROM inventory_items WHERE id=saved_id AND tenant_id=p_tenant AND is_active AND lower(btrim(unit)) IN('g','kg');
    IF picked.id IS NULL OR (picked.material_code IS NOT NULL AND nullif(f->>'target_type','') IS NOT NULL AND picked.material_code<>upper(btrim(f->>'target_type')))
      OR (picked.color_hex IS NOT NULL AND erp_private.import_color_hex(f->>'target_color') IS NOT NULL AND picked.color_hex<>erp_private.import_color_hex(f->>'target_color')) THEN saved_id:=NULL; END IF;
    mapped:=coalesce(saved_id,suggested);
    filaments:=filaments||jsonb_build_array(f||jsonb_build_object('base_item_id',base,'suggested_item_id',suggested,'item_id',mapped,
      'mapping_source',CASE WHEN saved_id IS NOT NULL AND saved_history THEN 'saved_history' WHEN saved_id IS NOT NULL THEN 'saved' WHEN suggested IS NOT NULL THEN 'exact_unique' END));
  END LOOP;
  RETURN jsonb_build_object('snapshot',first_snapshot,'material_policy',policy,'expected_materials',expected,'filaments',filaments,
    'material_options',erp_private.material_variant_options(first_snapshot,p_tenant),'complete',jsonb_array_length(missing)=0,'missing',missing,'cost_per_unit',first_snapshot->'cost_per_unit');
END $$;
CREATE FUNCTION public.bambu_material_selection_preview(p_task_id uuid,p_product_id uuid,p_plate_id uuid,p_allocations jsonb,p_material_overrides jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id();BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesse sua conta para revisar a impressão.'; END IF;
  RETURN erp_private.bambu_material_context(p_task_id,p_product_id,p_plate_id,p_allocations,p_material_overrides,t);
END $$;
REVOKE ALL ON FUNCTION public.bambu_material_selection_preview(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bambu_material_selection_preview(uuid,uuid,uuid,jsonb,jsonb) TO authenticated;

CREATE FUNCTION erp_private.assert_execution_materials(p_snapshot jsonb,p_plate uuid,p_materials jsonb,p_task public.bambu_tasks) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE expected uuid[]; actual uuid[]; m jsonb; f jsonb; item inventory_items; line jsonb;
BEGIN
  SELECT array_agg(DISTINCT (value->>'item_id')::uuid ORDER BY (value->>'item_id')::uuid) INTO expected FROM jsonb_array_elements(coalesce(p_snapshot->'requirements','[]')) WHERE nullif(value->>'plate_id','')::uuid IS NOT DISTINCT FROM p_plate;
  SELECT array_agg(DISTINCT (value->>'item_id')::uuid ORDER BY (value->>'item_id')::uuid) INTO actual FROM jsonb_array_elements(coalesce(p_materials,'[]'));
  IF expected IS NOT NULL AND expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Os filamentos devem corresponder aos materiais e cores selecionados nesta execução ou aprovados na venda.'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(coalesce(p_materials,'[]')) LOOP
    SELECT * INTO item FROM inventory_items WHERE id=(m->>'item_id')::uuid AND tenant_id=p_task.tenant_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material indisponível ou de outra empresa.'; END IF;
    SELECT value INTO f FROM jsonb_array_elements(erp_private.bambu_filaments(p_task.raw_data,p_task.weight_grams)) WHERE value->>'source_key'=m->>'source_key';
    IF item.material_code IS NOT NULL AND nullif(f->>'target_type','') IS NOT NULL AND item.material_code<>upper(btrim(f->>'target_type')) THEN RAISE EXCEPTION 'O material do estoque difere do tipo informado pelo AMS. Não substitua PLA por outra resina sem um perfil compatível.'; END IF;
    IF item.color_hex IS NOT NULL AND erp_private.import_color_hex(f->>'target_color') IS NOT NULL AND item.color_hex<>erp_private.import_color_hex(f->>'target_color') THEN RAISE EXCEPTION 'A cor do estoque difere da cor usada informada pelo AMS. Confira a bobina e sua identificação.'; END IF;
  END LOOP;
  FOR line IN SELECT value FROM jsonb_array_elements(coalesce(p_snapshot->'requirements','[]')) WHERE nullif(value->>'plate_id','')::uuid IS NOT DISTINCT FROM p_plate LOOP
    SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=p_task.tenant_id AND is_active;
    IF item.id IS NULL OR item.material_code IS DISTINCT FROM line->>'material_code' OR item.color_code IS DISTINCT FROM line->>'color_code'
      OR lower(btrim(item.unit)) IS DISTINCT FROM lower(btrim(line->>'unit')) THEN RAISE EXCEPTION 'A identidade do material selecionado mudou. Revise esta execução antes de apurar.'; END IF;
  END LOOP;
END $$;

ALTER FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) RENAME TO configure_bambu_base_selection_guard;
CREATE FUNCTION public.configure_bambu_production(p_task_id uuid,p_product_id uuid,p_units integer,p_materials jsonb,p_auto boolean,p_use_slicer boolean,
  p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_allocations jsonb,p_plate_id uuid DEFAULT NULL,p_material_overrides jsonb DEFAULT '[]') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); context jsonb; result uuid; task bambu_tasks; allocation jsonb; selected uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  context:=erp_private.bambu_material_context(p_task_id,p_product_id,p_plate_id,p_allocations,p_material_overrides,t);
  IF NOT(context->>'complete')::boolean THEN RAISE EXCEPTION '%',context->'missing'; END IF;
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t;
  PERFORM erp_private.assert_execution_materials(context->'snapshot',p_plate_id,p_materials,task);
  -- Reuse the physical-accounting validator, bypassing only the old global-color assertion.
  result:=erp_private.configure_bambu_before_recipe(p_task_id,p_product_id,p_units,p_materials,p_auto,p_use_slicer,p_labor_cost,p_overhead,p_extras_cost,p_allocations,p_plate_id);
  UPDATE bambu_production_records SET material_snapshot=context->'snapshot',material_overrides=p_material_overrides WHERE task_id=p_task_id;
  UPDATE bambu_production_profiles SET material_snapshot=context->'snapshot',material_overrides=p_material_overrides WHERE id=result AND tenant_id=t;
  IF context->>'material_policy'<>'approved_order' THEN
    SELECT array_agg(DISTINCT (value->>'item_id')::uuid ORDER BY (value->>'item_id')::uuid) INTO selected FROM jsonb_array_elements(p_materials);
    FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
      UPDATE jobs SET material_selection_snapshot=context->'snapshot',material_id=selected[1],secondary_material_id=selected[2]
        WHERE id=(allocation->>'job_id')::uuid AND tenant_id=t AND order_item_id IS NULL AND inventory_posted_at IS NULL;
    END LOOP;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION erp_private.post_bambu_production(p_task_id uuid,p_materials jsonb,p_seconds numeric,p_units integer,
  p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rec bambu_production_records; task bambu_tasks; allocation jsonb; snapshot jsonb;
BEGIN
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id FOR UPDATE;
  SELECT * INTO rec FROM bambu_production_records WHERE task_id=p_task_id FOR UPDATE;
  IF rec.posted_at IS NULL AND rec.product_id IS NOT NULL THEN
    IF rec.material_snapshot IS NULL THEN PERFORM erp_private.assert_bambu_recipe(rec.tenant_id,rec.product_id,rec.plate_id,rec.allocations,coalesce(p_materials,rec.materials));
    ELSE PERFORM erp_private.assert_execution_materials(rec.material_snapshot,rec.plate_id,coalesce(p_materials,rec.materials),task);END IF;
    FOR allocation IN SELECT value FROM jsonb_array_elements(coalesce(rec.allocations,'[]')) LOOP
      SELECT coalesce(material_selection_snapshot,production_snapshot) INTO snapshot FROM jobs WHERE id=(allocation->>'job_id')::uuid AND tenant_id=rec.tenant_id;
      IF snapshot IS NOT NULL THEN PERFORM erp_private.assert_execution_materials(snapshot,rec.plate_id,coalesce(p_materials,rec.materials),task); END IF;
    END LOOP;
  END IF;
  RETURN erp_private.post_bambu_before_recipe(p_task_id,p_materials,p_seconds,p_units,p_labor_cost,p_overhead,p_extras_cost,p_reason);
END $$;

-- Keep base job snapshots immutable and use a separately audited material choice
-- only for work without a commercially approved order.
CREATE FUNCTION public.erp_job_material_selection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.material_selection_snapshot IS NOT NULL) OR (TG_OP='UPDATE' AND NEW.material_selection_snapshot IS DISTINCT FROM OLD.material_selection_snapshot) THEN
    IF current_user IN('authenticated','anon','service_role') OR NEW.order_item_id IS NOT NULL OR (TG_OP='UPDATE' AND OLD.inventory_posted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'A seleção de material da execução deve ser confirmada pela preparação, antes da baixa, e não pode alterar uma venda aprovada.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_job_material_selection_guard BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_job_material_selection_guard();
REVOKE ALL ON FUNCTION public.erp_job_material_selection_guard() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE definition text; needle text; BEGIN
  definition:=pg_get_functiondef('public.bambu_production_preview(uuid)'::regprocedure);
  needle:='RETURN jsonb_build_object(''task_id'',task.id';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review contextual material-selection availability.'; END IF;
  EXECUTE replace(definition,needle,'RETURN jsonb_build_object(''material_policy'',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(rec.allocations,''[]'')) allocation JOIN jobs j ON j.id=(allocation->>''job_id'')::uuid AND j.tenant_id=task.tenant_id WHERE j.order_item_id IS NOT NULL) THEN ''approved_order'' WHEN coalesce(rec.product_id,config.product_id,(candidate->>''candidate_product_id'')::uuid) IS NOT NULL THEN ''execution_variant'' ELSE ''legacy_unconfigured'' END)||jsonb_build_object(''task_id'',task.id');
  definition:=pg_get_functiondef('public.erp_job_production_snapshot()'::regprocedure);
  needle:='NEW.production_snapshot:=parent.production_snapshot;';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review reprint material-selection preservation.'; END IF;
  definition:=replace(definition,needle,'NEW.production_snapshot:=parent.production_snapshot; NEW.material_selection_snapshot:=parent.material_selection_snapshot;');
  definition:=replace(definition,'OLD.production_snapshot->''requirements''','coalesce(NEW.material_selection_snapshot,OLD.material_selection_snapshot,OLD.production_snapshot)->''requirements''');EXECUTE definition;
  definition:=pg_get_functiondef('public.job_production_review(uuid)'::regprocedure);
  needle:='j.production_snapshot->''requirements''';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review job material-selection display.'; END IF;
  EXECUTE replace(definition,needle,'coalesce(j.material_selection_snapshot,j.production_snapshot)->''requirements''');
  definition:=pg_get_functiondef('erp_private.post_bambu_before_recipe(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text)'::regprocedure);
  needle:='description,print_plate_id,planned_quantity)';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review physical job snapshot capture.'; END IF;
  definition:=replace(definition,needle,'description,print_plate_id,planned_quantity,production_snapshot,production_snapshot_origin)');
  needle:='rec.plate_id,units);';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review physical job insert.'; END IF;
  EXECUTE replace(definition,needle,'rec.plate_id,units,rec.material_snapshot,CASE WHEN rec.material_snapshot IS NOT NULL THEN ''execution_variant'' END);');
  definition:=pg_get_functiondef('erp_private.reconcile_bambu_task(uuid)'::regprocedure);
  needle:='labor_cost,overhead,extras_cost,plate_id)';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review auto-tracking snapshot capture.'; END IF;
  definition:=replace(definition,needle,'labor_cost,overhead,extras_cost,plate_id,material_snapshot,material_overrides)');
  needle:='config.labor_cost,config.overhead,config.extras_cost,config.plate_id)';IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review auto-tracking configuration.'; END IF;
  EXECUTE replace(definition,needle,'config.labor_cost,config.overhead,config.extras_cost,config.plate_id,config.material_snapshot,coalesce(config.material_overrides,''[]''))');
END $$;
REVOKE ALL ON FUNCTION erp_private.bambu_material_context(uuid,uuid,uuid,jsonb,jsonb,uuid),erp_private.assert_execution_materials(jsonb,uuid,jsonb,public.bambu_tasks),
  erp_private.configure_bambu_base_selection_guard(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) FROM PUBLIC,anon,authenticated;
