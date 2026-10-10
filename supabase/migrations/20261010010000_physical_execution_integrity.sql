-- Preserve physical SKU identity and the approved layout of mixed print plates.
-- No historical jobs are rewritten and no new mixed-output cost allocation is introduced.
CREATE FUNCTION erp_private.assert_physical_execution_materials(p_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF p_snapshot->>'individual_stock' IS DISTINCT FROM 'true' THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_snapshot->'material_overrides','[]')) x
    WHERE x->>'item_id' IS DISTINCT FROM x->>'base_item_id')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_snapshot->'requirements','[]')) x
    WHERE x->>'base_item_id' IS NOT NULL AND x->>'item_id' IS DISTINCT FROM x->>'base_item_id') THEN
  RAISE EXCEPTION 'Para outra cor ou material, vincule um subitem com SKU e estoque próprios. O saldo de um SKU físico não mistura variantes.';
 END IF;
END $$;

CREATE FUNCTION erp_private.physical_output_quantity(p_snapshot jsonb) RETURNS integer
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE c jsonb; total integer:=0;
BEGIN
 IF jsonb_typeof(p_snapshot->'physical_outputs') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_snapshot->'physical_outputs')=0 THEN
  RAISE EXCEPTION 'Confirme as peças físicas e seu rendimento por placa antes de apurar esta impressão.';
 END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_snapshot->'physical_outputs') LOOP
  IF coalesce(c->>'quantity','') !~ '^[1-9][0-9]{0,4}$'
     OR c->>'component_product_id' IS NULL OR c->>'stock_item_id' IS NULL THEN
   RAISE EXCEPTION 'A saída física da placa deve identificar SKU, estoque e quantidade de cada subitem.';
  END IF;
  total:=total+(c->>'quantity')::integer;
 END LOOP;
 IF total NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Limite a placa a 10000 peças físicas por impressão.'; END IF;
 IF (SELECT count(DISTINCT value->>'component_product_id') FROM jsonb_array_elements(p_snapshot->'physical_outputs'))
    <>jsonb_array_length(p_snapshot->'physical_outputs') THEN
  RAISE EXCEPTION 'A saída física da placa possui um SKU de subitem repetido.';
 END IF;
 RETURN total;
END $$;

-- Use the same confirmed plate planner as manual/OP planning, never a fabricated
-- ratio of finished products or a layout read afresh from the live catalogue.
CREATE FUNCTION erp_private.freeze_bambu_physical_outputs(p_snapshot jsonb,p_plate uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE plan jsonb; frozen jsonb;
BEGIN
 IF p_snapshot->>'individual_stock' IS DISTINCT FROM 'true' THEN RETURN p_snapshot; END IF;
 PERFORM erp_private.assert_physical_execution_materials(p_snapshot);
 IF p_snapshot->'physical_outputs' IS NOT NULL THEN
  PERFORM erp_private.physical_output_quantity(p_snapshot); RETURN p_snapshot;
 END IF;
 SELECT value INTO plan FROM erp_private.subitem_plate_plan(p_snapshot,p_plate,1) value LIMIT 1;
 frozen:=plan->'snapshot';
 PERFORM erp_private.physical_output_quantity(frozen);
 RETURN frozen;
END $$;

ALTER FUNCTION erp_private.bambu_material_context(uuid,uuid,uuid,jsonb,jsonb,uuid) RENAME TO bambu_material_context_before_physical_integrity;
CREATE FUNCTION erp_private.bambu_material_context(p_task_id uuid,p_product uuid,p_plate uuid,p_allocations jsonb,p_overrides jsonb,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE context jsonb; snapshot jsonb; allocation jsonb; selected jsonb; option jsonb; options jsonb:='[]';
BEGIN
 context:=erp_private.bambu_material_context_before_physical_integrity(p_task_id,p_product,p_plate,p_allocations,p_overrides,p_tenant);
 snapshot:=context->'snapshot';
 PERFORM erp_private.assert_physical_execution_materials(snapshot);
 IF snapshot->>'individual_stock'='true' THEN
  IF jsonb_array_length(p_allocations)>1 THEN RAISE EXCEPTION 'Vincule uma única ordem de impressão por execução desta placa física. O estoque dos subitens atende as reservas das demais OPs.'; END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
   SELECT coalesce(material_selection_snapshot,production_snapshot) INTO selected FROM jobs
    WHERE id=(allocation->>'job_id')::uuid AND tenant_id=p_tenant;
   PERFORM erp_private.assert_physical_execution_materials(selected);
   IF (allocation->>'quantity')::numeric IS DISTINCT FROM erp_private.physical_output_quantity(selected)::numeric THEN
    RAISE EXCEPTION 'O vínculo deve preservar a capacidade de peças físicas da placa. Informe peças parcialmente concluídas na apuração.';
   END IF;
  END LOOP;
  snapshot:=erp_private.freeze_bambu_physical_outputs(snapshot,p_plate);
  FOR option IN SELECT value FROM jsonb_array_elements(context->'material_options') LOOP
   SELECT coalesce(jsonb_agg(value),'[]') INTO selected FROM jsonb_array_elements(option->'options')
    WHERE value->>'id'=option->>'selected_item_id';
   options:=options||jsonb_build_array(option||jsonb_build_object('options',selected));
  END LOOP;
  context:=context||jsonb_build_object('snapshot',snapshot,'physical_quantity',erp_private.physical_output_quantity(snapshot),'material_options',options);
 END IF;
 RETURN context;
END $$;

ALTER FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid,jsonb) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid,jsonb) RENAME TO configure_bambu_before_physical_integrity;
CREATE FUNCTION public.configure_bambu_production(p_task_id uuid,p_product_id uuid,p_units integer,p_materials jsonb,p_auto boolean,p_use_slicer boolean,
 p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_allocations jsonb,p_plate_id uuid DEFAULT NULL,p_material_overrides jsonb DEFAULT '[]') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); context jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 context:=erp_private.bambu_material_context(p_task_id,p_product_id,p_plate_id,p_allocations,p_material_overrides,t);
 IF context->'snapshot'->>'individual_stock'='true' THEN
  IF p_units IS DISTINCT FROM erp_private.physical_output_quantity(context->'snapshot') THEN
   RAISE EXCEPTION 'A quantidade da placa deve ser % peças físicas. Informe peças concluídas parcialmente somente na apuração.',context->>'physical_quantity';
  END IF;
 END IF;
 RETURN erp_private.configure_bambu_before_physical_integrity(p_task_id,p_product_id,p_units,p_materials,p_auto,p_use_slicer,p_labor_cost,p_overhead,p_extras_cost,p_allocations,p_plate_id,p_material_overrides);
END $$;

ALTER FUNCTION erp_private.post_bambu_production(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text) RENAME TO post_bambu_before_physical_integrity;
CREATE FUNCTION erp_private.post_bambu_production(p_task_id uuid,p_materials jsonb,p_seconds numeric,p_units integer,
 p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rec bambu_production_records; snapshot jsonb; allocation jsonb; physical integer;
BEGIN
 -- Match reconciliation/accounting lock order: task, then record.
 PERFORM 1 FROM bambu_tasks WHERE id=p_task_id FOR UPDATE;
 SELECT * INTO rec FROM bambu_production_records WHERE task_id=p_task_id FOR UPDATE;
 IF rec.posted_at IS NULL AND rec.product_id IS NOT NULL THEN
  snapshot:=rec.material_snapshot;
  IF snapshot IS NULL AND EXISTS(SELECT 1 FROM products WHERE id=rec.product_id AND tenant_id=rec.tenant_id AND component_inventory_mode) THEN
   RAISE EXCEPTION 'Revise a configuração desta impressão e confirme as peças físicas da placa antes de apurar.';
  END IF;
  PERFORM erp_private.assert_physical_execution_materials(snapshot);
  IF snapshot->>'individual_stock'='true' THEN
   snapshot:=erp_private.freeze_bambu_physical_outputs(snapshot,rec.plate_id);
   physical:=erp_private.physical_output_quantity(snapshot);
   IF jsonb_array_length(coalesce(rec.allocations,'[]'))>1 THEN RAISE EXCEPTION 'Revise o vínculo: uma execução da placa física deve ter uma única ordem de impressão.'; END IF;
   IF rec.units IS DISTINCT FROM physical THEN
    RAISE EXCEPTION 'Revise a configuração: a quantidade confirmada deve ser % peças físicas desta placa.',physical;
   END IF;
   IF p_units IS NOT NULL AND p_units>physical THEN
    RAISE EXCEPTION 'A quantidade concluída excede as peças físicas confirmadas desta placa.';
   END IF;
   IF snapshot IS DISTINCT FROM rec.material_snapshot THEN UPDATE bambu_production_records SET material_snapshot=snapshot WHERE task_id=p_task_id; END IF;
   FOR allocation IN SELECT value FROM jsonb_array_elements(coalesce(rec.allocations,'[]')) LOOP
    SELECT coalesce(material_selection_snapshot,production_snapshot) INTO snapshot FROM jobs
     WHERE id=(allocation->>'job_id')::uuid AND tenant_id=rec.tenant_id;
    PERFORM erp_private.assert_physical_execution_materials(snapshot);
    IF (allocation->>'quantity')::numeric IS DISTINCT FROM erp_private.physical_output_quantity(snapshot)::numeric THEN
     RAISE EXCEPTION 'Revise o vínculo e confirme a capacidade de peças físicas da placa antes de apurar.';
    END IF;
   END LOOP;
   -- Only one physical job owns this layout. Actual completion may be smaller
   -- than planned capacity without rewriting its immutable plate/SKU snapshot.
   IF p_units IS NOT NULL AND jsonb_array_length(coalesce(rec.allocations,'[]'))=1 THEN
    UPDATE bambu_production_records SET allocations=jsonb_set(rec.allocations,'{0,quantity}',to_jsonb(p_units)) WHERE task_id=p_task_id;
   END IF;
  END IF;
 END IF;
 RETURN erp_private.post_bambu_before_physical_integrity(p_task_id,p_materials,p_seconds,p_units,p_labor_cost,p_overhead,p_extras_cost,p_reason);
END $$;

-- Sales jobs normally require their entire batch allocation. For individual
-- physical output, the accounting wrapper preserves full capacity and passes
-- only actual completion; quality still approves each child SKU independently.
DO $$ DECLARE definition text; needle text:='OR (j.order_item_id IS NOT NULL AND (allocation->>''quantity'')::integer<>'; BEGIN
 definition:=pg_get_functiondef('erp_private.post_bambu_before_recipe(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text)'::regprocedure);
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review the Bambu physical allocation contract before applying this migration.'; END IF;
 EXECUTE replace(definition,needle,'OR (j.production_snapshot->>''individual_stock''=''true'' AND (allocation->>''quantity'')::integer>j.planned_quantity)
      OR (j.order_item_id IS NOT NULL AND (j.production_snapshot->>''individual_stock'') IS DISTINCT FROM ''true'' AND (allocation->>''quantity'')::integer<>');
END $$;

-- This runs after erp_job_production_snapshot and before zz_component_job_identity.
-- A partial external execution keeps the full planned layout separate from the
-- smaller produced_quantity recorded by Bambu accounting.
CREATE FUNCTION public.erp_job_physical_execution_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE snapshot jsonb; physical integer;
BEGIN
 snapshot:=coalesce(NEW.material_selection_snapshot,NEW.production_snapshot);
 IF snapshot->>'individual_stock' IS DISTINCT FROM 'true' THEN RETURN NEW; END IF;
 PERFORM erp_private.assert_physical_execution_materials(snapshot);
 IF TG_OP='INSERT' THEN
  physical:=erp_private.physical_output_quantity(snapshot);
  IF NEW.production_snapshot_origin='execution_variant' AND NEW.status='printing' THEN
   NEW.planned_quantity:=physical;
  ELSIF NEW.planned_quantity IS DISTINCT FROM physical THEN
   RAISE EXCEPTION 'A quantidade planejada deve corresponder às peças físicas preservadas na placa.';
  END IF;
 ELSIF NEW.material_selection_snapshot IS DISTINCT FROM OLD.material_selection_snapshot
    OR (NEW.inventory_posted_at IS NOT NULL AND OLD.inventory_posted_at IS NULL) THEN
  PERFORM erp_private.physical_output_quantity(snapshot);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zy_physical_execution_integrity BEFORE INSERT OR UPDATE ON public.jobs
 FOR EACH ROW EXECUTE FUNCTION public.erp_job_physical_execution_integrity();

-- Replenishing one physical component of a released OP remains part of that OP.
-- The original request signature/idempotency and frozen BOM are preserved.
CREATE OR REPLACE FUNCTION public.plan_subitem_batch(p_subitem_id uuid,p_quantity integer,p_request_id uuid,p_item_id uuid DEFAULT NULL) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; b product_subitems; snapshot jsonb; c jsonb; plan jsonb; results uuid[]:='{}'; job uuid;
 item production_order_items; op production_orders;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'plan_subitem_batch',jsonb_build_array(p_subitem_id,p_quantity,p_item_id));
 IF prior IS NOT NULL THEN RETURN ARRAY(SELECT id FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id ORDER BY code); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO b FROM product_subitems WHERE id=p_subitem_id AND tenant_id=t;
 IF b.id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe subitem e quantidade de peças.'; END IF;
 snapshot:=erp_private.product_bom_snapshot(b.product_id,t);
 IF p_item_id IS NOT NULL THEN
  SELECT * INTO item FROM production_order_items WHERE id=p_item_id AND tenant_id=t AND product_id=b.product_id;
  SELECT * INTO op FROM production_orders WHERE id=item.production_order_id AND tenant_id=t AND status='released' FOR UPDATE;
  snapshot:=item.production_snapshot;
  IF op.id IS NULL OR snapshot IS NULL OR snapshot->>'individual_stock' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Ordem de montagem não disponível para este produto.';
  END IF;
 END IF;
 PERFORM erp_private.assert_physical_execution_materials(snapshot);
 SELECT value INTO c FROM jsonb_array_elements(snapshot->'physical_components') WHERE value->>'id'=b.id::text;
 IF c->>'plate_id' IS NULL OR c->>'quantity_per_plate' IS NULL THEN RAISE EXCEPTION 'Vincule a placa e informe a quantidade deste subitem por impressão.'; END IF;
 FOR plan IN SELECT * FROM erp_private.subitem_plate_plan(snapshot,(c->>'plate_id')::uuid,ceil(p_quantity::numeric/(c->>'quantity_per_plate')::integer)::integer) LOOP
  INSERT INTO jobs(tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,secondary_material_id,printer_id,
   production_order_id,production_order_item_id,order_id,order_item_id,due_date,
   est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,num_colors,created_by,production_snapshot,production_snapshot_origin,creation_request_id)
   VALUES(t,erp_private.next_code(t,'OI'),c->>'name',plan->>'label','queued',b.product_id,(plan->>'plate_id')::uuid,(plan->>'quantity')::integer,
    (plan->>'material_id')::uuid,(plan->>'secondary_material_id')::uuid,(plan->>'printer_id')::uuid,
    op.id,item.id,op.source_order_id,item.source_order_item_id,op.due_date,
    (plan->>'grams')::numeric,(plan->>'minutes')::integer,(plan->>'material_cost')::numeric,(plan->>'cost')::numeric,0,0,
    (plan->>'num_colors')::integer,auth.uid(),plan->'snapshot',CASE WHEN p_item_id IS NOT NULL THEN 'production_order' ELSE 'catalog' END,p_request_id) RETURNING id INTO job;
  results:=array_append(results,job);
 END LOOP;
 IF cardinality(results)=0 THEN RAISE EXCEPTION 'Prepare a placa antes de imprimir.'; END IF;
 PERFORM erp_private.finish_request(t,p_request_id,results[1]); RETURN results;
END $$;

-- A cloud observation cannot release a printer put into maintenance by an operator.
-- Keep this guard at the database seam as well as the sync endpoint's atomic filter.
CREATE FUNCTION public.erp_preserve_printer_maintenance() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.status='maintenance' AND NEW.status IS DISTINCT FROM OLD.status AND current_user='service_role' THEN
  NEW.status:=OLD.status;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_preserve_printer_maintenance BEFORE UPDATE ON public.printers
 FOR EACH ROW EXECUTE FUNCTION public.erp_preserve_printer_maintenance();

REVOKE ALL ON FUNCTION erp_private.assert_physical_execution_materials(jsonb),erp_private.physical_output_quantity(jsonb),
 erp_private.freeze_bambu_physical_outputs(jsonb,uuid),erp_private.bambu_material_context(uuid,uuid,uuid,jsonb,jsonb,uuid),
 erp_private.bambu_material_context_before_physical_integrity(uuid,uuid,uuid,jsonb,jsonb,uuid),
 erp_private.configure_bambu_before_physical_integrity(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid,jsonb),
 erp_private.post_bambu_production(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text),
 erp_private.post_bambu_before_physical_integrity(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text),
 public.erp_job_physical_execution_integrity(),public.erp_preserve_printer_maintenance() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
