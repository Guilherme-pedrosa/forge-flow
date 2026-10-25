-- Execution identity is an explicit association, never a rewrite of the file.
CREATE TABLE public.product_print_execution_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 plate_id uuid NOT NULL REFERENCES product_print_plates(id), source_id uuid REFERENCES product_print_sources(id),
 source_fingerprint text NOT NULL, file_sha256 text,
 bambu_device_id uuid NOT NULL REFERENCES bambu_devices(id), project_key text NOT NULL,
 model_id text NOT NULL, profile_id text NOT NULL, remote_plate_index integer NOT NULL CHECK(remote_plate_index BETWEEN 1 AND 10000),
 confirmation text NOT NULL CHECK(confirmation IN ('exact_identity','explicit_plate','file_confirmation')),
 confirmed_by uuid NOT NULL REFERENCES auth.users(id), confirmed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,bambu_device_id,project_key)
);
ALTER TABLE product_print_execution_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_print_execution_bindings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON product_print_execution_bindings TO authenticated;
CREATE POLICY execution_bindings_read ON product_print_execution_bindings FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
ALTER TABLE bambu_production_records ADD COLUMN execution_binding_id uuid REFERENCES product_print_execution_bindings(id),
 ADD COLUMN execution_binding_fingerprint text;

CREATE FUNCTION erp_private.print_plate_source_fingerprint(p_plate uuid,p_tenant uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT md5(jsonb_build_array(pp.id,pp.source_id,pp.model_id,pp.profile_id,pp.plate_index,
   ps.file_sha256,ps.file_path,ps.model_id,ps.profile_id,ps.plate_index)::text)
 FROM product_print_plates pp JOIN products p ON p.id=pp.product_id AND p.tenant_id=pp.tenant_id AND p.is_active
 LEFT JOIN product_print_sources ps ON ps.id=pp.source_id AND ps.tenant_id=pp.tenant_id AND ps.is_active
 WHERE pp.id=p_plate AND pp.tenant_id=p_tenant AND pp.is_active AND (pp.source_id IS NULL OR ps.id IS NOT NULL)
$$;

CREATE FUNCTION erp_private.bambu_plate_binding_matches(p_task uuid,p_plate uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM bambu_tasks task JOIN product_print_execution_bindings b
 ON b.tenant_id=task.tenant_id AND b.bambu_device_id=task.bambu_device_id
 AND b.project_key=erp_private.bambu_project_key(task.raw_data)
 WHERE task.id=p_task AND b.plate_id=p_plate
 AND b.source_fingerprint=erp_private.print_plate_source_fingerprint(p_plate,task.tenant_id))
$$;

CREATE FUNCTION erp_private.bind_print_execution(p_plate_id uuid,p_task_id uuid,p_file_sha256 text,p_confirm_file boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); plate product_print_plates; task bambu_tasks; source product_print_sources;
 binding product_print_execution_bindings; fingerprint text; project text; remote_index numeric; method text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO plate FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t AND is_active FOR UPDATE;
 SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t;
 project:=erp_private.bambu_project_key(task.raw_data);
 fingerprint:=erp_private.print_plate_source_fingerprint(plate.id,t);
 IF plate.id IS NULL OR task.id IS NULL OR project IS NULL OR fingerprint IS NULL THEN
  RAISE EXCEPTION 'Selecione uma placa ativa e uma execução com modelo, perfil e placa identificados na mesma empresa.';
 END IF;
 remote_index:=(task.raw_data->>'plateIndex')::numeric;
 IF remote_index NOT BETWEEN 1 AND 10000 OR remote_index<>trunc(remote_index) THEN RAISE EXCEPTION 'Índice remoto da placa inválido.'; END IF;
 SELECT * INTO source FROM product_print_sources WHERE id=plate.source_id AND tenant_id=t AND is_active;
 SELECT * INTO binding FROM product_print_execution_bindings WHERE tenant_id=t AND bambu_device_id=task.bambu_device_id AND project_key=project FOR UPDATE;
 IF binding.id IS NOT NULL AND binding.plate_id<>plate.id THEN RAISE EXCEPTION 'Esta execução/perfil já pertence a outro produto ou placa; os identificadores já estão vinculados.'; END IF;
 IF EXISTS(SELECT 1 FROM bambu_production_records WHERE task_id=task.id AND product_id IS NOT NULL AND product_id<>plate.product_id)
 OR EXISTS(SELECT 1 FROM jobs WHERE id=task.job_id AND product_id IS NOT NULL AND product_id<>plate.product_id) THEN RAISE EXCEPTION 'A tarefa já pertence a outro produto.'; END IF;
 IF NOT p_confirm_file AND binding.source_fingerprint=fingerprint THEN RETURN plate.id; END IF;
 IF p_confirm_file THEN
  IF coalesce(p_file_sha256,'') !~ '^[a-fA-F0-9]{64}$' OR source.file_sha256 IS NULL
   OR lower(source.file_sha256) IS DISTINCT FROM lower(p_file_sha256) THEN
   RAISE EXCEPTION 'O arquivo mudou ou não possui SHA256 verificável. Reabra a revisão ativa antes de confirmar a impressão.';
  END IF;
  method:='file_confirmation';
  IF binding.source_fingerprint=fingerprint AND lower(binding.file_sha256)=lower(p_file_sha256) THEN RETURN plate.id; END IF;
 ELSIF coalesce(plate.model_id,source.model_id)=task.raw_data->>'modelId'
 AND coalesce(plate.profile_id,source.profile_id)=task.raw_data->>'profileId' AND plate.plate_index=remote_index THEN method:='exact_identity';
 ELSIF source.file_sha256 IS NULL AND coalesce(plate.model_id,source.model_id,plate.profile_id,source.profile_id) IS NULL THEN method:='explicit_plate';
 ELSE RAISE EXCEPTION 'O perfil ou a placa Bambu difere do arquivo importado. Confirme explicitamente o arquivo e a placa da revisão ativa.';
 END IF;
 IF EXISTS(SELECT 1 FROM product_print_plates pp JOIN products p ON p.id=pp.product_id AND p.tenant_id=pp.tenant_id AND p.is_active
 LEFT JOIN product_print_sources ps ON ps.id=pp.source_id AND ps.tenant_id=pp.tenant_id AND ps.is_active
 WHERE pp.tenant_id=t AND pp.is_active AND pp.id<>plate.id
 AND coalesce(pp.model_id,ps.model_id)=task.raw_data->>'modelId'
 AND coalesce(pp.profile_id,ps.profile_id)=task.raw_data->>'profileId' AND pp.plate_index=remote_index) THEN
 RAISE EXCEPTION 'Este modelo/perfil/placa já pertence a outra placa ou produto.'; END IF;
 INSERT INTO product_print_execution_bindings(tenant_id,plate_id,source_id,source_fingerprint,file_sha256,bambu_device_id,project_key,
 model_id,profile_id,remote_plate_index,confirmation,confirmed_by)
 VALUES(t,plate.id,plate.source_id,fingerprint,source.file_sha256,task.bambu_device_id,project,task.raw_data->>'modelId',task.raw_data->>'profileId',remote_index,method,auth.uid())
 ON CONFLICT(tenant_id,bambu_device_id,project_key) DO UPDATE SET source_id=excluded.source_id,source_fingerprint=excluded.source_fingerprint,
 file_sha256=excluded.file_sha256,confirmation=excluded.confirmation,confirmed_by=excluded.confirmed_by,confirmed_at=now()
 RETURNING * INTO binding;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
 VALUES(t,auth.uid(),'confirm_print_execution','product_print_execution_bindings',binding.id,
 jsonb_build_object('plate_id',plate.id,'task_id',task.id,'file_sha256',binding.file_sha256,'source_fingerprint',fingerprint,'confirmation',method));
 RETURN plate.id;
END $$;

CREATE OR REPLACE FUNCTION public.bind_product_print_plate(p_plate_id uuid,p_task_id uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT erp_private.bind_print_execution(p_plate_id,p_task_id,NULL,false)
$$;
CREATE FUNCTION public.bind_file_plate_execution(p_plate_id uuid,p_task_id uuid,p_file_sha256 text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT erp_private.bind_print_execution(p_plate_id,p_task_id,p_file_sha256,true)
$$;

-- The confirmation is frozen when an execution is configured, never backfilled.
CREATE FUNCTION public.erp_bambu_execution_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE binding product_print_execution_bindings; task bambu_tasks;
BEGIN
 IF TG_OP='UPDATE' AND OLD.posted_at IS NOT NULL THEN
  IF (NEW.execution_binding_id,NEW.execution_binding_fingerprint) IS DISTINCT FROM (OLD.execution_binding_id,OLD.execution_binding_fingerprint) THEN
   RAISE EXCEPTION 'A identidade da impressão contabilizada é imutável.';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO task FROM bambu_tasks WHERE id=NEW.task_id AND tenant_id=NEW.tenant_id;
 SELECT b.* INTO binding FROM product_print_execution_bindings b JOIN product_print_plates pp ON pp.id=b.plate_id AND pp.tenant_id=b.tenant_id
 WHERE b.tenant_id=NEW.tenant_id AND b.plate_id=NEW.plate_id AND pp.product_id=NEW.product_id
 AND b.bambu_device_id=task.bambu_device_id AND b.project_key=erp_private.bambu_project_key(task.raw_data)
 AND b.source_fingerprint=erp_private.print_plate_source_fingerprint(NEW.plate_id,NEW.tenant_id);
 NEW.execution_binding_id:=binding.id; NEW.execution_binding_fingerprint:=binding.source_fingerprint;
 RETURN NEW;
END $$;
CREATE TRIGGER bambu_execution_binding BEFORE INSERT OR UPDATE OF product_id,plate_id,execution_binding_id,execution_binding_fingerprint
 ON bambu_production_records FOR EACH ROW EXECUTE FUNCTION erp_bambu_execution_binding();

-- Existing accounting keeps all physical-output, material and idempotency guards.
DO $$ DECLARE definition text; updated text; BEGIN
 definition:=pg_get_functiondef('erp_private.post_bambu_before_recipe(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text)'::regprocedure);
 updated:=regexp_replace(definition,'IF rec[.]plate_id IS NOT NULL AND NOT EXISTS[(]SELECT 1 FROM product_print_plates pp JOIN product_print_sources ps[\s\S]*?END IF;',
 'IF rec.plate_id IS NOT NULL AND (NOT erp_private.bambu_plate_binding_matches(task.id,rec.plate_id)
 OR NOT EXISTS(SELECT 1 FROM product_print_execution_bindings b JOIN product_print_plates pp ON pp.id=b.plate_id AND pp.tenant_id=b.tenant_id
 WHERE b.id=rec.execution_binding_id AND b.tenant_id=task.tenant_id AND pp.product_id=product.id
 AND b.plate_id=rec.plate_id AND b.bambu_device_id=task.bambu_device_id AND b.project_key=erp_private.bambu_project_key(task.raw_data))
 OR rec.execution_binding_fingerprint IS DISTINCT FROM erp_private.print_plate_source_fingerprint(rec.plate_id,task.tenant_id))
 THEN RAISE EXCEPTION ''A revisão do arquivo/placa mudou. Confirme a associação desta execução antes de apurar.''; END IF;');
 IF updated=definition THEN RAISE EXCEPTION 'Review the existing Bambu accounting identity guard before applying this migration.'; END IF;
 EXECUTE updated;
END $$;

DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('erp_private.bambu_candidate(public.bambu_tasks)'::regprocedure);
 definition:=replace(definition,'-- Exact observed plate identity wins over a broad MakerWorld design link.',
 'SELECT array_agg(b.plate_id) INTO plate_ids FROM product_print_execution_bindings b
  WHERE b.tenant_id=task.tenant_id AND b.bambu_device_id=task.bambu_device_id
  AND b.project_key=erp_private.bambu_project_key(task.raw_data)
  AND b.source_fingerprint=erp_private.print_plate_source_fingerprint(b.plate_id,task.tenant_id);
  IF cardinality(plate_ids)=1 THEN RETURN jsonb_build_object(''candidate_product_id'',(SELECT product_id FROM product_print_plates WHERE id=plate_ids[1]),''candidate_source'',''verified_identifiers'',''candidate_plate_id'',plate_ids[1]); END IF;
  -- Exact observed plate identity wins over a broad MakerWorld design link.');
 EXECUTE definition;
END $$;

REVOKE ALL ON FUNCTION erp_private.print_plate_source_fingerprint(uuid,uuid),erp_private.bambu_plate_binding_matches(uuid,uuid),
 erp_private.bind_print_execution(uuid,uuid,text,boolean),public.erp_bambu_execution_binding() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bind_file_plate_execution(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bind_file_plate_execution(uuid,uuid,text) TO authenticated;

-- Fresh references are computed from confirmed, posted, quality-disposed runs.
-- No historical record, inventory movement or manual specification is rewritten.
CREATE FUNCTION erp_private.read_plate_learning(p_plate uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF (SELECT count(*) FROM product_subitems WHERE plate_id=p_plate AND tenant_id=p_tenant)>1
 OR EXISTS(SELECT 1 FROM product_print_plate_parts part WHERE part.plate_id=p_plate
  AND NOT EXISTS(SELECT 1 FROM product_subitems sub WHERE sub.source_part_id=part.id AND sub.tenant_id=p_tenant)) THEN RETURN NULL; END IF;
 WITH eligible AS (
 SELECT r.*,a.units AS accepted_units,a.total_grams AS accepted_grams,a.elapsed_seconds AS accepted_seconds,
 a.total_cost AS accepted_cost,greatest(0,r.material_cost-coalesce((SELECT sum(q.material_cost) FROM bambu_quality_rejections q WHERE q.task_id=r.task_id AND q.tenant_id=r.tenant_id),0)) AS accepted_material_cost,
 b.project_key AS execution_key,b.file_sha256 AS confirmed_sha
 FROM bambu_production_records r JOIN erp_private.accepted_bambu_production a ON a.task_id=r.task_id AND a.tenant_id=r.tenant_id
 JOIN product_print_execution_bindings b ON b.id=r.execution_binding_id AND b.tenant_id=r.tenant_id AND b.plate_id=r.plate_id
 JOIN bambu_tasks task ON task.id=r.task_id AND task.tenant_id=r.tenant_id
 WHERE r.plate_id=p_plate AND r.tenant_id=p_tenant AND r.state='posted' AND r.posted_at IS NOT NULL AND r.outcome='completed'
 AND r.posted_at>=b.confirmed_at AND a.units>0 AND a.total_grams>0 AND a.elapsed_seconds>0
 AND r.source_snapshot->>'time_source' IN ('elapsed_start_end','confirmed_elapsed')
 AND r.execution_binding_fingerprint=b.source_fingerprint
 AND b.source_fingerprint=erp_private.print_plate_source_fingerprint(p_plate,p_tenant)
 AND b.bambu_device_id=task.bambu_device_id AND b.project_key=erp_private.bambu_project_key(task.raw_data)
 AND ((NOT EXISTS(SELECT 1 FROM product_subitems sub WHERE sub.plate_id=p_plate AND sub.tenant_id=p_tenant)
 AND r.material_snapshot->>'individual_stock' IS DISTINCT FROM 'true')
 OR (jsonb_array_length(coalesce(r.material_snapshot->'physical_outputs','[]'))=1
 AND EXISTS(SELECT 1 FROM product_subitems sub WHERE sub.plate_id=p_plate AND sub.tenant_id=p_tenant
  AND sub.component_product_id::text=r.material_snapshot->'physical_outputs'->0->>'component_product_id')))
 AND EXISTS(SELECT 1 FROM bambu_production_allocations alloc WHERE alloc.task_id=r.task_id AND alloc.tenant_id=r.tenant_id)
 AND NOT EXISTS(SELECT 1 FROM bambu_production_allocations alloc JOIN jobs j ON j.id=alloc.job_id AND j.tenant_id=alloc.tenant_id
  WHERE alloc.task_id=r.task_id AND (j.status NOT IN ('ready','completed','shipped','failed')
   OR (j.status='failed' AND NOT EXISTS(SELECT 1 FROM bambu_quality_rejections q WHERE q.job_id=j.id AND q.task_id=r.task_id))))
 ), totals AS (
 SELECT sum(accepted_units) units,sum(accepted_grams)/sum(accepted_units) grams,
 sum(accepted_seconds)/sum(accepted_units) seconds,sum(accepted_cost)/sum(accepted_units) cost,sum(accepted_material_cost)/sum(accepted_units) material_cost,
 CASE WHEN count(DISTINCT consumption_source)=1 THEN min(consumption_source) ELSE 'mixed' END consumption_source,
 CASE WHEN count(DISTINCT source_snapshot->>'time_source')=1 THEN min(source_snapshot->>'time_source') ELSE 'mixed' END time_source,
 count(*) runs,count(DISTINCT execution_key) profiles,min(execution_key) execution_key,
 min(confirmed_sha) file_sha256,max(posted_at) updated_at FROM eligible
 ), material_totals AS (
 SELECT (m->>'item_id')::uuid item_id,sum((m->>'grams')::numeric*e.accepted_units/e.units)/(SELECT units FROM totals) grams
 FROM eligible e CROSS JOIN LATERAL jsonb_array_elements(e.materials) m GROUP BY m->>'item_id'
 ) SELECT jsonb_build_object('source','bambu','grams',t.grams,'print_seconds',t.seconds,'estimated_cost',t.cost,
 'material_cost',t.material_cost,'consumption_source',t.consumption_source,'time_source',t.time_source,
 'sample_units',t.units,'sample_runs',t.runs,'project_key',t.execution_key,'file_sha256',t.file_sha256,'updated_at',t.updated_at,
 'materials',coalesce((SELECT jsonb_agg(jsonb_build_object('item_id',m.item_id,'grams',m.grams,'material',coalesce(i.material_code,i.name),
 'color',i.color,'cost_per_kg',NULL,'resolved_cost_per_kg',CASE WHEN i.avg_cost>0 THEN i.avg_cost*CASE WHEN i.unit='g' THEN 1000 ELSE 1 END END) ORDER BY m.item_id)
 FROM material_totals m JOIN inventory_items i ON i.id=m.item_id AND i.tenant_id=p_tenant),'[]'::jsonb)) INTO result
 FROM totals t WHERE t.units>0 AND t.profiles=1;
 RETURN result;
END $$;

ALTER FUNCTION erp_private.read_piece_spec(uuid,uuid,uuid) RENAME TO read_piece_spec_before_execution_learning;
CREATE FUNCTION erp_private.read_piece_spec(p_product uuid,p_tenant uuid,p_subitem uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE previous jsonb; b product_subitems; learned jsonb; subitems integer;
BEGIN
 previous:=erp_private.read_piece_spec_before_execution_learning(p_product,p_tenant,p_subitem);
 -- A manual sheet always remains the operative reference, even if incomplete.
 IF EXISTS(SELECT 1 FROM product_piece_specs WHERE product_id=p_product AND tenant_id=p_tenant) THEN RETURN previous; END IF;
 IF p_subitem IS NOT NULL THEN SELECT * INTO b FROM product_subitems WHERE id=p_subitem AND component_product_id=p_product AND tenant_id=p_tenant;
 ELSE
  SELECT count(*) INTO subitems FROM product_subitems WHERE component_product_id=p_product AND tenant_id=p_tenant;
  IF subitems=1 THEN SELECT * INTO b FROM product_subitems WHERE component_product_id=p_product AND tenant_id=p_tenant; END IF;
 END IF;
 IF b.id IS NULL OR b.plate_id IS NULL OR b.quantity_per_plate IS NULL
 OR (SELECT count(*) FROM product_subitems WHERE plate_id=b.plate_id AND tenant_id=p_tenant)<>1
 OR EXISTS(SELECT 1 FROM product_print_plate_parts part WHERE part.plate_id=b.plate_id
  AND NOT EXISTS(SELECT 1 FROM product_subitems sub WHERE sub.source_part_id=part.id AND sub.tenant_id=p_tenant)) THEN RETURN previous; END IF;
 learned:=erp_private.read_plate_learning(b.plate_id,p_tenant);
 IF learned IS NULL THEN RETURN previous; END IF;
 RETURN previous||learned||jsonb_build_object('revision',NULL,'pieces_per_plate',b.quantity_per_plate,
 'notes','Referência por peça de execuções confirmadas, apuradas e aprovadas na qualidade. Ajustes manuais têm prioridade.',
 'learned_reference',learned-'materials','plate',coalesce(previous->'plate','{}'::jsonb)||jsonb_build_object(
  'grams',(learned->>'grams')::numeric*b.quantity_per_plate,'seconds',(learned->>'print_seconds')::numeric*b.quantity_per_plate));
END $$;

CREATE FUNCTION public.product_plate_learning(p_plate_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id();
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t) THEN RAISE EXCEPTION 'Placa não encontrada.'; END IF;
 RETURN erp_private.read_plate_learning(p_plate_id,t);
END $$;
REVOKE ALL ON FUNCTION erp_private.read_plate_learning(uuid,uuid),erp_private.read_piece_spec_before_execution_learning(uuid,uuid,uuid),
 erp_private.read_piece_spec(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.product_plate_learning(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_plate_learning(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
