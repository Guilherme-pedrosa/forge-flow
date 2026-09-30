-- Freeze both the BOM and the physical output of each plate in every print job.
CREATE FUNCTION erp_private.subitem_plate_plan(p_snapshot jsonb,p_plate uuid,p_runs integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE pl jsonb; c jsonb; outputs jsonb:='[]'; total integer:=0; plan jsonb; run integer; recipe jsonb; lines jsonb; frozen jsonb; requirements jsonb;
BEGIN
 IF p_runs IS NULL OR p_runs NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Informe de 1 a 500 impressões por lote.'; END IF;
 SELECT value INTO pl FROM jsonb_array_elements(p_snapshot->'plates') WHERE value->>'id'=p_plate::text;
 IF pl IS NULL THEN RAISE EXCEPTION 'Vincule os subitens a uma placa deste produto.'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_snapshot->'physical_components') WHERE value->>'plate_id'=p_plate::text LOOP
  IF c->>'quantity_per_plate' IS NULL OR NOT coalesce((c->>'active')::boolean,false) THEN RAISE EXCEPTION 'Informe quantas peças de % saem nesta placa e confira seu cadastro.',c->>'name'; END IF;
  total:=total+(c->>'quantity_per_plate')::integer;
  outputs:=outputs||jsonb_build_array(c||jsonb_build_object('quantity',(c->>'quantity_per_plate')::integer));
 END LOOP;
 IF total NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Vincule as peças da placa e limite a 10000 peças por impressão.'; END IF;
 recipe:=pl->'recipe';
 SELECT jsonb_agg(value||jsonb_build_object('grams_per_unit',(value->>'grams_per_print')::numeric/total,'cost_per_unit',(value->>'cost_per_print')::numeric/total)) INTO lines FROM jsonb_array_elements(recipe->'lines');
 recipe:=recipe||jsonb_build_object('units_per_print',total,'lines',lines,
  'cost_per_unit',(recipe->>'cost_per_unit')::numeric*(recipe->>'units_per_print')::integer/total,
  'material_cost_per_unit',(recipe->>'material_cost_per_unit')::numeric*(recipe->>'units_per_print')::integer/total,
  'non_material_cost_per_unit',(recipe->>'non_material_cost_per_unit')::numeric*(recipe->>'units_per_print')::integer/total);
 SELECT coalesce(jsonb_agg(value||jsonb_build_object('grams_per_unit',(value->>'grams_per_print')::numeric/total,'cost_per_unit',(value->>'cost_per_print')::numeric/total)),'[]') INTO requirements FROM jsonb_array_elements(p_snapshot->'requirements') WHERE value->>'plate_id'=p_plate::text;
 frozen:=p_snapshot||jsonb_build_object('physical_outputs',outputs,'plates',jsonb_build_array(pl||jsonb_build_object('recipe',recipe)),
  'requirements',requirements,'complete',coalesce((recipe->>'complete')::boolean,false),'missing',coalesce(recipe->'missing','[]'));
 FOR plan IN SELECT * FROM erp_private.frozen_job_plan(p_snapshot||jsonb_build_object('plates',jsonb_build_array(pl),'components','[]'::jsonb,'complete',coalesce((pl->'recipe'->>'complete')::boolean,false)),1) LOOP
  FOR run IN 1..p_runs LOOP
   RETURN NEXT plan||jsonb_build_object('quantity',total,'snapshot',frozen,
    'label',(pl->>'label')||' · impressão '||run||'/'||p_runs||' · '||total||' peças físicas');
  END LOOP;
 END LOOP;
END $$;

ALTER FUNCTION erp_private.component_job_plan(jsonb,integer,uuid) RENAME TO component_job_plan_before_subitems;
CREATE FUNCTION erp_private.component_job_plan(p_snapshot jsonb,p_quantity integer,p_tenant uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE c jsonb; pl jsonb; missing integer; runs integer; count_jobs integer:=0; plate_runs jsonb:='{}'; key text;
BEGIN
 IF p_snapshot->>'individual_stock' IS DISTINCT FROM 'true' THEN RETURN QUERY SELECT * FROM erp_private.component_job_plan_before_subitems(p_snapshot,p_quantity,p_tenant); RETURN; END IF;
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 OR jsonb_array_length(p_snapshot->'physical_components')=0 THEN RAISE EXCEPTION 'Cadastre os subitens e a quantidade necessária para cada produto.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_snapshot->'material_overrides','[]')) v WHERE v->>'item_id' IS DISTINCT FROM v->>'base_item_id') THEN
  RAISE EXCEPTION 'Para outra cor, vincule um subitem com SKU e estoque dessa cor. O saldo de um SKU não mistura variantes.'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_snapshot->'physical_components') LOOP
  IF c->>'quantity_per_product' IS NULL OR NOT coalesce((c->>'active')::boolean,false) THEN RAISE EXCEPTION 'Confira a quantidade por produto e o cadastro de %.',c->>'name'; END IF;
  missing:=greatest(0,p_quantity*(c->>'quantity_per_product')::integer-erp_private.subitem_available(p_tenant,(c->>'component_product_id')::uuid,NULL,true));
  IF missing=0 THEN CONTINUE; END IF;
  IF c->>'plate_id' IS NULL OR c->>'quantity_per_plate' IS NULL THEN RAISE EXCEPTION 'Faltam % unidades de %. Registre a entrada ou prepare sua placa de impressão.',missing,c->>'name'; END IF;
  key:=c->>'plate_id'; runs:=ceil(missing::numeric/(c->>'quantity_per_plate')::integer);
  plate_runs:=plate_runs||jsonb_build_object(key,greatest(coalesce((plate_runs->>key)::integer,0),runs));
 END LOOP;
 FOR key IN SELECT jsonb_object_keys(plate_runs) LOOP
  runs:=(plate_runs->>key)::integer; count_jobs:=count_jobs+runs;
  IF count_jobs>500 THEN RAISE EXCEPTION 'Divida a produção em lotes de até 500 impressões.'; END IF;
  RETURN QUERY SELECT * FROM erp_private.subitem_plate_plan(p_snapshot,key::uuid,runs);
 END LOOP;
END $$;

ALTER FUNCTION erp_private.reserve_assembly_components(uuid,jsonb) RENAME TO reserve_assembly_before_subitems;
CREATE FUNCTION erp_private.reserve_assembly_components(p_item uuid,p_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE i production_order_items; c jsonb;
BEGIN
 IF p_snapshot->>'individual_stock' IS DISTINCT FROM 'true' THEN PERFORM erp_private.reserve_assembly_before_subitems(p_item,p_snapshot); RETURN; END IF;
 SELECT * INTO i FROM production_order_items WHERE id=p_item;
 UPDATE production_order_items SET assembly_required=true WHERE id=i.id;
 FOR c IN SELECT value FROM jsonb_array_elements(p_snapshot->'physical_components') LOOP
  INSERT INTO production_subitem_demands(tenant_id,item_id,component_product_id,quantity)
   VALUES(i.tenant_id,i.id,(c->>'component_product_id')::uuid,i.quantity*(c->>'quantity_per_product')::integer);
 END LOOP;
END $$;

-- On-hand parts can be assembled without a printer, file or filament recipe.
-- Only plates that actually need printing require technical preparation.
ALTER FUNCTION public.production_order_preflight(uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.production_order_preflight(uuid) RENAME TO production_preflight_before_subitems;
REVOKE ALL ON FUNCTION erp_private.production_preflight_before_subitems(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.production_order_preflight(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result jsonb; line jsonb; item production_order_items; snapshot jsonb; lines jsonb:='[]'; issues jsonb; n integer; cost numeric;
BEGIN
 result:=erp_private.production_preflight_before_subitems(p_id);
 FOR line IN SELECT value FROM jsonb_array_elements(result->'items') LOOP
  SELECT * INTO item FROM production_order_items WHERE id=(line->>'id')::uuid AND tenant_id=t;
  IF EXISTS(SELECT 1 FROM products WHERE id=item.product_id AND tenant_id=t AND component_inventory_mode) THEN
   snapshot:=coalesce(item.production_snapshot,item.commercial_snapshot);
   IF snapshot->>'individual_stock' IS DISTINCT FROM 'true' OR NOT coalesce((snapshot->>'complete')::boolean,false) THEN snapshot:=erp_private.product_material_variant_snapshot(item.product_id,t,item.material_overrides); END IF;
   issues:='[]'; n:=0; cost:=0;
   BEGIN
    SELECT count(*)::integer,coalesce(sum((plan->>'cost')::numeric),0) INTO n,cost FROM erp_private.component_job_plan(snapshot,item.quantity,t) plan;
   EXCEPTION WHEN OTHERS THEN issues:=jsonb_build_array(SQLERRM); END;
   line:=line||jsonb_build_object('snapshot',snapshot,'issues',issues,'jobs',n,'estimated_cost',cost);
  END IF;
  lines:=lines||jsonb_build_array(line);
 END LOOP;
 RETURN result||jsonb_build_object('items',lines,'ready',jsonb_array_length(lines)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lines) x WHERE jsonb_array_length(x->'issues')>0));
END $$;

CREATE FUNCTION public.plan_subitem_batch(p_subitem_id uuid,p_quantity integer,p_request_id uuid,p_item_id uuid DEFAULT NULL) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; b product_subitems; snapshot jsonb; c jsonb; plan jsonb; results uuid[]:='{}'; job uuid;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'plan_subitem_batch',jsonb_build_array(p_subitem_id,p_quantity,p_item_id));
 IF prior IS NOT NULL THEN RETURN ARRAY(SELECT id FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id ORDER BY created_at,id); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO b FROM product_subitems WHERE id=p_subitem_id AND tenant_id=t;
 IF b.id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe subitem e quantidade de peças.'; END IF;
 snapshot:=erp_private.product_bom_snapshot(b.product_id,t);
 IF p_item_id IS NOT NULL THEN
  SELECT i.production_snapshot INTO snapshot FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id WHERE i.id=p_item_id AND i.tenant_id=t AND i.product_id=b.product_id AND o.status='released';
  IF snapshot IS NULL THEN RAISE EXCEPTION 'Ordem de montagem não disponível.'; END IF;
 END IF;
 SELECT value INTO c FROM jsonb_array_elements(snapshot->'physical_components') WHERE value->>'id'=b.id::text;
 IF c->>'plate_id' IS NULL OR c->>'quantity_per_plate' IS NULL THEN RAISE EXCEPTION 'Vincule a placa e informe a quantidade deste subitem por impressão.'; END IF;
 FOR plan IN SELECT * FROM erp_private.subitem_plate_plan(snapshot,(c->>'plate_id')::uuid,ceil(p_quantity::numeric/(c->>'quantity_per_plate')::integer)::integer) LOOP
  INSERT INTO jobs(tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,secondary_material_id,printer_id,
   est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,num_colors,created_by,production_snapshot,creation_request_id)
   VALUES(t,erp_private.next_code(t,'OI'),c->>'name',plan->>'label','queued',b.product_id,(plan->>'plate_id')::uuid,(plan->>'quantity')::integer,
    (plan->>'material_id')::uuid,(plan->>'secondary_material_id')::uuid,(plan->>'printer_id')::uuid,(plan->>'grams')::numeric,(plan->>'minutes')::integer,
    (plan->>'material_cost')::numeric,(plan->>'cost')::numeric,0,0,(plan->>'num_colors')::integer,auth.uid(),plan->'snapshot',p_request_id) RETURNING id INTO job;
  results:=array_append(results,job);
 END LOOP;
 IF cardinality(results)=0 THEN RAISE EXCEPTION 'Prepare a placa antes de imprimir.'; END IF;
 PERFORM erp_private.finish_request(t,p_request_id,results[1]); RETURN results;
END $$;

-- Prevent old plate-set endpoints from crediting a phantom set for new products.
ALTER FUNCTION public.erp_receive_component_output() RENAME TO erp_receive_component_output_legacy;
CREATE FUNCTION public.erp_receive_component_output() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE qty integer;
BEGIN
 IF NEW.component_stock_key IS NULL OR NEW.status NOT IN('ready','shipped','completed') OR NEW.inventory_posted_at IS NULL THEN RETURN NEW; END IF;
 IF NEW.production_snapshot->>'individual_stock'='true' THEN
  IF NOT EXISTS(SELECT 1 FROM job_subitem_outputs WHERE job_id=NEW.id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Confira a quantidade boa de cada subitem antes de aprovar a placa.'; END IF;
  RETURN NEW;
 END IF;
 qty:=coalesce(NEW.produced_quantity,NEW.planned_quantity);
 IF qty<=0 OR qty>NEW.planned_quantity OR NEW.actual_total_cost IS NULL THEN RAISE EXCEPTION 'Confira a quantidade boa e o custo real deste lote antes de aprovar.'; END IF;
 INSERT INTO component_stock_lots(tenant_id,product_id,plate_id,material_key,quantity,remaining,unit_cost,source_job_id,material_snapshot,notes,created_by)
 VALUES(NEW.tenant_id,NEW.product_id,NEW.print_plate_id,NEW.component_stock_key,qty,qty,NEW.actual_total_cost/qty,NEW.id,NEW.production_snapshot,'Lote aprovado após conferência',auth.uid()) ON CONFLICT(source_job_id) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER component_output_received ON jobs;
CREATE TRIGGER component_output_received AFTER INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_receive_component_output();

ALTER FUNCTION public.confirm_component_output(uuid,integer,text,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.confirm_component_output(uuid,integer,text,uuid) RENAME TO confirm_output_before_subitems;
REVOKE ALL ON FUNCTION erp_private.confirm_output_before_subitems(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.confirm_component_output(p_job_id uuid,p_good_quantity integer,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM jobs WHERE id=p_job_id AND tenant_id=erp_private.actor() AND production_snapshot->>'individual_stock'='true') THEN RAISE EXCEPTION 'Confira separadamente as peças desta placa em Componentes e montagem.'; END IF;
 RETURN erp_private.confirm_output_before_subitems(p_job_id,p_good_quantity,p_reason,p_request_id);
END $$;

CREATE FUNCTION public.confirm_subitem_output(p_job_id uuid,p_outputs jsonb,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; j jobs; c jsonb; entry jsonb; qty integer; good integer:=0; planned integer:=0;
 unit_cost numeric; movement uuid; count_outputs integer;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'confirm_subitem_output',jsonb_build_array(p_job_id,p_outputs,p_reason)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t FOR UPDATE;
 IF j.id IS NULL OR j.status<>'quality_check' OR j.inventory_posted_at IS NULL OR j.production_snapshot->>'individual_stock' IS DISTINCT FROM 'true' OR j.actual_total_cost IS NULL THEN RAISE EXCEPTION 'Apure o custo e leve esta impressão para conferência.'; END IF;
 count_outputs:=jsonb_array_length(j.production_snapshot->'physical_outputs');
 IF jsonb_typeof(p_outputs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_outputs)<>count_outputs OR count_outputs=0 THEN RAISE EXCEPTION 'Confira todas as peças desta placa.'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(j.production_snapshot->'physical_outputs') LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(p_outputs) e WHERE e->>'component_product_id'=c->>'component_product_id')<>1 THEN RAISE EXCEPTION 'Peça ausente ou repetida na conferência.'; END IF;
  SELECT value INTO entry FROM jsonb_array_elements(p_outputs) WHERE value->>'component_product_id'=c->>'component_product_id';
  IF coalesce(entry->>'good_quantity','') !~ '^(0|[1-9][0-9]{0,4})$' THEN RAISE EXCEPTION 'Informe uma quantidade inteira de peças boas.'; END IF;
  qty:=(entry->>'good_quantity')::integer;
  IF qty>(c->>'quantity')::integer THEN RAISE EXCEPTION 'Quantidade boa de % maior que a prevista.',c->>'name'; END IF;
  good:=good+qty; planned:=planned+(c->>'quantity')::integer;
 END LOOP;
 IF good>least(j.planned_quantity,coalesce(j.produced_quantity,j.planned_quantity)) THEN RAISE EXCEPTION 'A quantidade boa excede a quantidade apurada.'; END IF;
 IF good<planned AND nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo das rejeições.'; END IF;
 -- Full plate cost is allocated equally across approved physical units. It is
 -- capitalized once; assembling parts never consumes raw material a second time.
 unit_cost:=CASE WHEN good>0 THEN j.actual_total_cost/good ELSE 0 END;
 FOR c IN SELECT value FROM jsonb_array_elements(j.production_snapshot->'physical_outputs') LOOP
  SELECT (value->>'good_quantity')::integer INTO qty FROM jsonb_array_elements(p_outputs) WHERE value->>'component_product_id'=c->>'component_product_id';
  movement:=NULL;
  IF qty>0 THEN
   INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
    VALUES(t,(c->>'stock_item_id')::uuid,'purchase_in',qty,unit_cost,'print_subitem',j.id,'Peças aprovadas de '||j.code,auth.uid()) RETURNING id INTO movement;
  END IF;
  INSERT INTO job_subitem_outputs(tenant_id,job_id,component_product_id,planned_quantity,good_quantity,unit_cost,movement_id)
   VALUES(t,j.id,(c->>'component_product_id')::uuid,(c->>'quantity')::integer,qty,unit_cost,movement);
 END LOOP;
 result:=erp_private.confirm_output_before_subitems(j.id,good,p_reason,gen_random_uuid());
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

-- Old endpoints remain available for historical jobs only, never for a new BOM.
DO $$ DECLARE target regprocedure; def text; BEGIN
 FOREACH target IN ARRAY ARRAY['public.plan_component_batch(uuid,integer,uuid,uuid)'::regprocedure,'public.receive_existing_components(uuid,integer,numeric,text,uuid)'::regprocedure,'public.write_off_components(uuid,integer,text,uuid,uuid)'::regprocedure] LOOP
  def:=pg_get_functiondef(target);
  def:=replace(def,E'BEGIN\n',E'BEGIN\n IF EXISTS(SELECT 1 FROM product_print_plates legacy_plate JOIN products legacy_product ON legacy_product.id=legacy_plate.product_id WHERE legacy_plate.id=p_plate_id AND legacy_product.tenant_id=t AND legacy_product.component_inventory_mode) THEN RAISE EXCEPTION ''Movimente o subitem individual em Componentes e montagem.''; END IF;\n');
  EXECUTE def;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION erp_private.subitem_plate_plan(jsonb,uuid,integer),erp_private.component_job_plan(jsonb,integer,uuid),erp_private.reserve_assembly_components(uuid,jsonb),public.erp_receive_component_output(),public.erp_receive_component_output_legacy() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.production_order_preflight(uuid),public.plan_subitem_batch(uuid,integer,uuid,uuid),public.confirm_component_output(uuid,integer,text,uuid),public.confirm_subitem_output(uuid,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_order_preflight(uuid),public.plan_subitem_batch(uuid,integer,uuid,uuid),public.confirm_component_output(uuid,integer,text,uuid),public.confirm_subitem_output(uuid,jsonb,text,uuid) TO authenticated;

ALTER FUNCTION public.production_financial_result(date,date) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.production_financial_result(date,date) RENAME TO production_financial_before_subitems;
REVOKE ALL ON FUNCTION erp_private.production_financial_before_subitems(date,date) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.production_financial_result(p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); result jsonb; losses numeric;
BEGIN
 result:=erp_private.production_financial_before_subitems(p_start,p_end);
 SELECT coalesce(sum(total_cost),0) INTO losses FROM inventory_movements WHERE tenant_id=t AND movement_type='loss' AND reference_type='subitem' AND created_at::date BETWEEN p_start AND p_end;
 RETURN result||jsonb_build_object('component_loss_cost',(result->>'component_loss_cost')::numeric+losses);
END $$;
REVOKE ALL ON FUNCTION public.production_financial_result(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_financial_result(date,date) TO authenticated;

ALTER FUNCTION public.plan_product_plates(uuid,integer,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.plan_product_plates(uuid,integer,uuid) RENAME TO plan_product_plates_before_subitems;
REVOKE ALL ON FUNCTION erp_private.plan_product_plates_before_subitems(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.plan_product_plates(p_product_id uuid,p_quantity integer,p_request_id uuid) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; snapshot jsonb; plan jsonb; results uuid[]:='{}'; job uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t AND component_inventory_mode) THEN RETURN erp_private.plan_product_plates_before_subitems(p_product_id,p_quantity,p_request_id); END IF;
 prior:=erp_private.begin_request(t,p_request_id,'plan_subitem_product',jsonb_build_array(p_product_id,p_quantity));
 IF prior IS NOT NULL THEN RETURN ARRAY(SELECT id FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id ORDER BY code); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Produto arquivado.'; END IF;
 snapshot:=erp_private.product_bom_snapshot(p_product_id,t);
 FOR plan IN SELECT * FROM erp_private.component_job_plan(snapshot,p_quantity,t) LOOP
  INSERT INTO jobs(tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,secondary_material_id,printer_id,
   est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,num_colors,created_by,production_snapshot,creation_request_id)
   VALUES(t,erp_private.next_code(t,'OI'),plan->>'name',plan->>'label','queued',p_product_id,(plan->>'plate_id')::uuid,(plan->>'quantity')::integer,
    (plan->>'material_id')::uuid,(plan->>'secondary_material_id')::uuid,(plan->>'printer_id')::uuid,(plan->>'grams')::numeric,(plan->>'minutes')::integer,
    (plan->>'material_cost')::numeric,(plan->>'cost')::numeric,0,0,(plan->>'num_colors')::integer,auth.uid(),plan->'snapshot',p_request_id) RETURNING id INTO job;
  results:=array_append(results,job);
 END LOOP;
 IF cardinality(results)=0 THEN RAISE EXCEPTION 'O estoque e a fila já cobrem essa quantidade. Use Componentes e montagem para montar o produto ou repor uma peça específica.'; END IF;
 PERFORM erp_private.finish_request(t,p_request_id,results[1]); RETURN results;
END $$;
REVOKE ALL ON FUNCTION public.plan_product_plates(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.plan_product_plates(uuid,integer,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';

