-- Production is planned from the commercially approved recipe, never today's catalogue.
-- Existing orders retain their historical workflow; every new sale must declare its recipe.
ALTER TABLE public.orders ADD COLUMN requires_material_recipe boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ALTER COLUMN requires_material_recipe SET DEFAULT true;
CREATE FUNCTION erp_private.frozen_job_plan(p_snapshot jsonb,p_quantity integer,p_depth integer DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE part jsonb; plate jsonb; recipe jsonb; plan jsonb; plans jsonb:='[]'; units integer; runs integer; run integer;
  grams numeric; material_cost numeric; total_cost numeric; minutes integer; extra numeric; quantity integer; extra_total numeric; extra_allocated numeric:=0; plan_index integer:=0;
BEGIN
  IF p_depth>20 OR p_quantity NOT BETWEEN 1 AND 10000 OR NOT coalesce((p_snapshot->>'complete')::boolean,false) THEN
    RAISE EXCEPTION 'Complete a composição, materiais, cores e custos antes de gerar a produção.';
  END IF;
  IF jsonb_array_length(coalesce(p_snapshot->'components','[]'))>0 THEN
    FOR part IN SELECT value FROM jsonb_array_elements(p_snapshot->'components') LOOP
      quantity:=p_quantity*(part->>'quantity')::integer;
      FOR plan IN SELECT * FROM erp_private.frozen_job_plan(part->'snapshot',quantity,p_depth+1) LOOP
        plans:=plans||jsonb_build_array(plan);
        IF jsonb_array_length(plans)>500 THEN RAISE EXCEPTION 'Máximo de 500 ordens por item. Divida o pedido em lotes.'; END IF;
      END LOOP;
    END LOOP;
    extra_total:=round(coalesce((p_snapshot->>'kit_extras_cost_per_unit')::numeric,0)*p_quantity,2);
    FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
      plan_index:=plan_index+1;extra:=round(extra_total*plan_index/greatest(jsonb_array_length(plans),1),2)-extra_allocated;extra_allocated:=extra_allocated+extra;
      RETURN NEXT plan||jsonb_build_object('cost',(plan->>'cost')::numeric+extra,'extras',coalesce((plan->>'extras')::numeric,0)+extra);
    END LOOP;
    RETURN;
  END IF;
  FOR plate IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(p_snapshot->'plates','[]'))>0 THEN p_snapshot->'plates' ELSE '[{}]'::jsonb END) LOOP
    recipe:=CASE WHEN plate ? 'id' THEN plate->'recipe' ELSE p_snapshot->'recipe' END;
    units:=(recipe->>'units_per_print')::integer;
    IF units IS NULL OR units NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Capacidade da receita inválida.'; END IF;
    runs:=ceil(p_quantity::numeric/units);
    IF runs+jsonb_array_length(plans)>500 THEN RAISE EXCEPTION 'Máximo de 500 ordens por item. Divida o pedido em lotes.'; END IF;
    SELECT sum((value->>'grams_per_print')::numeric),sum((value->>'cost_per_print')::numeric) INTO grams,material_cost FROM jsonb_array_elements(recipe->'lines');
    total_cost:=round((recipe->>'cost_per_unit')::numeric*units,2);
    minutes:=CASE WHEN plate ? 'id' THEN ceil((plate->>'est_time_seconds')::numeric/60) ELSE (p_snapshot->'product'->>'est_time_minutes')::integer END;
    IF minutes IS NULL OR minutes<=0 OR grams IS NULL OR material_cost IS NULL OR total_cost IS NULL THEN RAISE EXCEPTION 'Complete o tempo por impressão e os custos da composição aprovada.'; END IF;
    FOR run IN 1..runs LOOP
      plan:=jsonb_build_object('product_id',p_snapshot->'product'->>'id','name',p_snapshot->'product'->>'name','snapshot',p_snapshot,
        'plate_id',plate->>'id','printer_id',plate->>'printer_id','quantity',units,'grams',grams,'minutes',minutes,'material_cost',material_cost,'cost',total_cost,'extras',0,
        'material_id',recipe->'lines'->0->>'item_id','secondary_material_id',recipe->'lines'->1->>'item_id',
        'secondary_grams',recipe->'lines'->1->'grams_per_print','num_colors',jsonb_array_length(recipe->'lines'),
        'label',coalesce(plate->>'label','Placa única')||' · impressão '||run||'/'||runs||' · lote de '||units||' peça(s)'||
          CASE WHEN run=runs AND runs*units>p_quantity THEN ' · '||(runs*units-p_quantity)||' peças extras previstas' ELSE '' END);
      plans:=plans||jsonb_build_array(plan); RETURN NEXT plan;
    END LOOP;
  END LOOP;
END $$;

ALTER FUNCTION public.transition_sales_order(uuid,text) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.transition_sales_order(uuid,text) RENAME TO transition_sales_order_before_recipe;
CREATE FUNCTION public.transition_sales_order(p_order_id uuid,p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); o orders; item order_items; snapshot jsonb; plan jsonb; plans jsonb;
  subtotal numeric; cumulative_lines numeric:=0; order_allocated numeric:=0; line_revenue numeric; line_cost numeric; weight numeric;
  allocated numeric; revenue numeric; idx integer; line_count integer; job uuid;
BEGIN
  IF p_status IS NULL THEN RAISE EXCEPTION 'Informe o status de destino do pedido.'; END IF;
  IF p_status NOT IN ('approved','in_production') THEN RETURN erp_private.transition_sales_order_before_recipe(p_order_id,p_status); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status=p_status THEN RETURN o.id; END IF;
  IF p_status='approved' THEN
    IF o.status<>'draft' THEN RAISE EXCEPTION 'Transição do pedido não permitida.'; END IF;
    IF o.source_quote_id IS NULL THEN
      FOR item IN SELECT * FROM order_items WHERE order_id=o.id AND tenant_id=t ORDER BY id FOR UPDATE LOOP
        IF item.product_id IS NULL THEN
          IF o.requires_material_recipe THEN RAISE EXCEPTION 'Vincule o produto e sua composição antes de aprovar a venda.'; END IF;
          CONTINUE;
        END IF;
        snapshot:=erp_private.product_bom_snapshot(item.product_id,t);
        -- Existing unconfigured catalogue remains usable while it is explicitly migrated.
        -- Once any recipe is configured, an incomplete composition may not be sold silently.
        IF NOT coalesce((snapshot->>'complete')::boolean,false) AND (o.requires_material_recipe OR jsonb_array_length(coalesce(snapshot->'requirements','[]'))>0) THEN
          RAISE EXCEPTION 'Revise a composição de %: %',item.description,snapshot->'missing';
        END IF;
        IF coalesce((snapshot->>'complete')::boolean,false) THEN
          PERFORM erp_private.assert_bom_production_time(snapshot);
          UPDATE order_items SET product_snapshot=snapshot WHERE id=item.id;
        END IF;
      END LOOP;
      IF EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id AND product_snapshot IS NOT NULL)
        AND EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id AND product_snapshot IS NULL) THEN
        RAISE EXCEPTION 'Complete a composição de todos os itens antes de aprovar este pedido. Não misture receitas aprovadas com itens sem composição.';
      END IF;
    END IF;
    RETURN erp_private.transition_sales_order_before_recipe(p_order_id,p_status);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id AND product_snapshot IS NOT NULL) THEN
    RETURN erp_private.transition_sales_order_before_recipe(p_order_id,p_status);
  END IF;
  IF o.status<>'approved' THEN RAISE EXCEPTION 'Transição do pedido não permitida.'; END IF;
  IF EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) THEN RAISE EXCEPTION 'Pedido já possui produção vinculada. Confira as ordens existentes.'; END IF;
  SELECT sum(total) INTO subtotal FROM order_items WHERE order_id=o.id;
  FOR item IN SELECT * FROM order_items WHERE order_id=o.id AND tenant_id=t ORDER BY id LOOP
    snapshot:=item.product_snapshot;
    IF snapshot IS NULL THEN RAISE EXCEPTION 'O item % não tem composição aprovada. Revise o pedido antes de produzir.',item.description; END IF;
    SELECT jsonb_agg(value),count(*)::integer,sum((value->>'cost')::numeric) INTO plans,line_count,line_cost FROM erp_private.frozen_job_plan(snapshot,item.quantity) value;
    IF line_count NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Máximo de 500 ordens por item. Divida o pedido em lotes.'; END IF;
    cumulative_lines:=cumulative_lines+item.total;
    line_revenue:=CASE WHEN subtotal>0 THEN round((subtotal-o.discount)*cumulative_lines/subtotal,2)-order_allocated ELSE 0 END;
    order_allocated:=order_allocated+line_revenue;idx:=0;weight:=0;allocated:=0;
    FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
      PERFORM erp_private.assert_ref('products',(plan->>'product_id')::uuid,t);
      IF NOT EXISTS(SELECT 1 FROM products WHERE id=(plan->>'product_id')::uuid AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Produto aprovado foi arquivado. Revise o pedido.'; END IF;
      idx:=idx+1;job:=gen_random_uuid();
      weight:=weight+CASE WHEN line_cost>0 THEN (plan->>'cost')::numeric/line_cost ELSE 1::numeric/line_count END;
      revenue:=CASE WHEN idx=line_count THEN line_revenue-allocated ELSE round(line_revenue*weight,2)-allocated END;allocated:=allocated+revenue;
      INSERT INTO jobs(id,tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,secondary_material_id,printer_id,
        order_id,order_item_id,order_unit_index,est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,due_date,num_colors,created_by,production_snapshot)
      VALUES(job,t,erp_private.next_code(t,'OI'),plan->>'name','Pedido '||o.code||' · '||(plan->>'label'),'queued',(plan->>'product_id')::uuid,(plan->>'plate_id')::uuid,
        (plan->>'quantity')::integer,(plan->>'material_id')::uuid,(plan->>'secondary_material_id')::uuid,
        CASE WHEN EXISTS(SELECT 1 FROM printers WHERE id=(plan->>'printer_id')::uuid AND tenant_id=t AND is_active AND status NOT IN ('maintenance','offline','error')) THEN (plan->>'printer_id')::uuid END,
        o.id,item.id,idx,(plan->>'grams')::numeric,(plan->>'minutes')::integer,round((plan->>'material_cost')::numeric,2),(plan->>'cost')::numeric,(plan->>'extras')::numeric,revenue,o.due_date,
        (plan->>'num_colors')::integer,auth.uid(),plan->'snapshot');
    END LOOP;
  END LOOP;
  UPDATE orders SET status='in_production' WHERE id=o.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'transition','orders',o.id,jsonb_build_object('from',o.status,'to','in_production','planning','approved_material_recipe'));
  RETURN o.id;
END $$;
REVOKE ALL ON FUNCTION erp_private.frozen_job_plan(jsonb,integer,integer),erp_private.transition_sales_order_before_recipe(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transition_sales_order(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_sales_order(uuid,text) TO authenticated;

-- The original Bambu accounting assumed one piece for all unplated sales jobs.
-- Recipe-based jobs retain the complete physical batch capacity instead.
DO $$
DECLARE target regprocedure; definition text; needle text:='CASE WHEN j.print_plate_id IS NULL THEN 1 ELSE coalesce(j.planned_quantity,1) END';
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid)'::regprocedure,
    'erp_private.post_bambu_production(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text)'::regprocedure] LOOP
    definition:=pg_get_functiondef(target);
    IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Bambu capacity contract changed; review migration before applying.'; END IF;
    EXECUTE replace(definition,needle,'CASE WHEN j.production_snapshot IS NOT NULL THEN coalesce(j.planned_quantity,1) WHEN j.print_plate_id IS NULL THEN 1 ELSE coalesce(j.planned_quantity,1) END');
  END LOOP;
END $$;

CREATE FUNCTION erp_private.assert_bambu_recipe(p_tenant uuid,p_product uuid,p_plate uuid,p_allocations jsonb,p_materials jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE snapshot jsonb; allocation jsonb; snapshots jsonb:='[]'; expected uuid[]; actual uuid[]; line jsonb; item inventory_items;
BEGIN
  IF jsonb_array_length(coalesce(p_allocations,'[]'))>0 THEN
    FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
      SELECT production_snapshot INTO snapshot FROM jobs WHERE id=(allocation->>'job_id')::uuid AND tenant_id=p_tenant;
      IF snapshot IS NOT NULL THEN snapshots:=snapshots||jsonb_build_array(snapshot); END IF;
    END LOOP;
  ELSE
    snapshot:=erp_private.product_bom_snapshot(p_product,p_tenant);snapshots:=jsonb_build_array(snapshot);
  END IF;
  SELECT array_agg(DISTINCT (value->>'item_id')::uuid ORDER BY (value->>'item_id')::uuid) INTO actual FROM jsonb_array_elements(coalesce(p_materials,'[]'));
  FOR snapshot IN SELECT value FROM jsonb_array_elements(snapshots) LOOP
    SELECT array_agg(DISTINCT (value->>'item_id')::uuid ORDER BY (value->>'item_id')::uuid) INTO expected
      FROM jsonb_array_elements(coalesce(snapshot->'requirements','[]'))
      WHERE nullif(value->>'plate_id','')::uuid IS NOT DISTINCT FROM p_plate;
    IF expected IS NULL THEN
      IF coalesce((snapshot->>'complete')::boolean,false) OR jsonb_array_length(coalesce(snapshot->'requirements','[]'))>0 THEN
        RAISE EXCEPTION 'A placa da tentativa não possui composição aprovada.';
      END IF;
      CONTINUE; -- Explicitly configured historical jobs remain reconcilable during catalogue migration.
    END IF;
    IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Os filamentos da tentativa diferem dos materiais e cores da composição aprovada. Revise o vínculo; nenhum estoque foi baixado.'; END IF;
    FOR line IN SELECT value FROM jsonb_array_elements(snapshot->'requirements') WHERE nullif(value->>'plate_id','')::uuid IS NOT DISTINCT FROM p_plate LOOP
      SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=p_tenant;
      IF item.id IS NULL OR NOT item.is_active OR item.material_code IS DISTINCT FROM line->>'material_code' OR item.color_code IS DISTINCT FROM line->>'color_code'
        OR lower(btrim(item.unit)) IS DISTINCT FROM lower(btrim(line->>'unit')) THEN RAISE EXCEPTION 'Material ou cor da receita indisponível. Revise o estoque antes de apurar.'; END IF;
    END LOOP;
  END LOOP;
END $$;

ALTER FUNCTION erp_private.post_bambu_production(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text) RENAME TO post_bambu_before_recipe;
CREATE FUNCTION erp_private.post_bambu_production(p_task_id uuid,p_materials jsonb,p_seconds numeric,p_units integer,
  p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rec bambu_production_records;
BEGIN
  PERFORM 1 FROM bambu_tasks WHERE id=p_task_id FOR UPDATE;
  SELECT * INTO rec FROM bambu_production_records WHERE task_id=p_task_id FOR UPDATE;
  IF rec.posted_at IS NULL AND rec.product_id IS NOT NULL THEN
    PERFORM erp_private.assert_bambu_recipe(rec.tenant_id,rec.product_id,rec.plate_id,rec.allocations,coalesce(p_materials,rec.materials));
  END IF;
  RETURN erp_private.post_bambu_before_recipe(p_task_id,p_materials,p_seconds,p_units,p_labor_cost,p_overhead,p_extras_cost,p_reason);
END $$;

ALTER FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) RENAME TO configure_bambu_before_recipe;
CREATE FUNCTION public.configure_bambu_production(p_task_id uuid,p_product_id uuid,p_units integer,p_materials jsonb,p_auto boolean,p_use_slicer boolean,
  p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_allocations jsonb,p_plate_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  PERFORM erp_private.assert_bambu_recipe(t,p_product_id,p_plate_id,p_allocations,p_materials);
  RETURN erp_private.configure_bambu_before_recipe(p_task_id,p_product_id,p_units,p_materials,p_auto,p_use_slicer,p_labor_cost,p_overhead,p_extras_cost,p_allocations,p_plate_id);
END $$;
REVOKE ALL ON FUNCTION erp_private.assert_bambu_recipe(uuid,uuid,uuid,jsonb,jsonb),erp_private.post_bambu_before_recipe(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text),
  erp_private.post_bambu_production(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text),erp_private.configure_bambu_before_recipe(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.product_material_recipe_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH snapshots AS MATERIALIZED (SELECT p.id,erp_private.product_bom_snapshot(p.id,p.tenant_id) AS bom FROM products p
    WHERE p.tenant_id=get_user_tenant_id() AND auth.uid() IS NOT NULL)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'configured',jsonb_array_length(bom->'requirements')>0,
    'complete',bom->'complete','cost_per_unit',bom->'cost_per_unit','plate_count',jsonb_array_length(bom->'plates'),'missing',bom->'missing')),'[]') FROM snapshots
$$;
REVOKE ALL ON FUNCTION public.product_material_recipe_catalog() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_material_recipe_catalog() TO authenticated;

ALTER FUNCTION public.plan_product_plates(uuid,integer,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.plan_product_plates(uuid,integer,uuid) RENAME TO plan_product_plates_before_recipe;
CREATE FUNCTION public.plan_product_plates(p_product_id uuid,p_quantity integer,p_request_id uuid) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; snapshot jsonb; plan jsonb; results uuid[]:='{}'; job uuid;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'plan_product_plates',jsonb_build_array(p_product_id,p_quantity));
  IF prior IS NOT NULL THEN SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO results FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id; RETURN results; END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe de 1 a 10000 unidades do produto.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um produto ativo.'; END IF;
  snapshot:=erp_private.product_bom_snapshot(p_product_id,t);
  IF jsonb_array_length(coalesce(snapshot->'requirements','[]'))=0 THEN RETURN erp_private.plan_product_plates_before_recipe(p_product_id,p_quantity,p_request_id); END IF;
  IF jsonb_array_length(coalesce(snapshot->'components','[]'))>0 THEN RAISE EXCEPTION 'Planeje os componentes do kit pelo pedido.'; END IF;
  FOR plan IN SELECT * FROM erp_private.frozen_job_plan(snapshot,p_quantity) LOOP
    job:=gen_random_uuid();
    INSERT INTO jobs(id,tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,secondary_material_id,printer_id,
      est_grams,est_time_minutes,est_material_cost,est_total_cost,sale_price,creation_request_id,created_by,production_snapshot,production_snapshot_origin,num_colors)
    VALUES(job,t,erp_private.next_code(t,'OI'),plan->>'name',plan->>'label','queued',(plan->>'product_id')::uuid,(plan->>'plate_id')::uuid,(plan->>'quantity')::integer,
      (plan->>'material_id')::uuid,(plan->>'secondary_material_id')::uuid,
      CASE WHEN EXISTS(SELECT 1 FROM printers WHERE id=(plan->>'printer_id')::uuid AND tenant_id=t AND is_active AND status NOT IN ('maintenance','offline','error')) THEN (plan->>'printer_id')::uuid END,
      (plan->>'grams')::numeric,(plan->>'minutes')::integer,round((plan->>'material_cost')::numeric,2),(plan->>'cost')::numeric,NULL,p_request_id,auth.uid(),plan->'snapshot','catalog',(plan->>'num_colors')::integer);
    results:=array_append(results,job);
  END LOOP;
  IF cardinality(results)=0 THEN RAISE EXCEPTION 'Nenhuma impressão foi planejada.'; END IF;
  SELECT array_agg(value ORDER BY value) INTO results FROM unnest(results) value;
  PERFORM erp_private.finish_request(t,p_request_id,results[1]);RETURN results;
END $$;
REVOKE ALL ON FUNCTION erp_private.plan_product_plates_before_recipe(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.plan_product_plates(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.plan_product_plates(uuid,integer,uuid) TO authenticated;
