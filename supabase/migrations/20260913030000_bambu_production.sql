-- A Bambu task is one physical print attempt, not necessarily one ERP order item.
-- Remote weight/costTime are slicer predictions. Partial failures require measured grams.
ALTER TABLE products ADD COLUMN actual_print_grams_per_unit numeric,
  ADD COLUMN actual_print_seconds_per_unit numeric, ADD COLUMN actual_print_cost_per_unit numeric,
  ADD COLUMN actual_print_sample_units integer, ADD COLUMN actual_print_updated_at timestamptz,
  ADD COLUMN actual_print_source text;
ALTER TABLE jobs ADD COLUMN actual_time_seconds numeric, ADD COLUMN actual_material_usage jsonb,
  ADD COLUMN produced_quantity integer;

CREATE TABLE public.product_print_sources(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id), label text NOT NULL DEFAULT '',
  source_url text,file_path text,file_name text,file_sha256 text,
  design_id text,instance_id text,model_id text,profile_id text,plate_index integer,
  is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bambu_production_profiles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
  bambu_device_id uuid NOT NULL REFERENCES bambu_devices(id),project_key text NOT NULL,
  product_id uuid NOT NULL REFERENCES products(id),units integer NOT NULL CHECK(units BETWEEN 1 AND 10000),
  materials jsonb NOT NULL,auto_enabled boolean NOT NULL DEFAULT false,use_slicer boolean NOT NULL DEFAULT false,
  auto_from timestamptz NOT NULL DEFAULT now(),labor_cost numeric NOT NULL DEFAULT 0,
  overhead numeric NOT NULL DEFAULT 0,extras_cost numeric NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,bambu_device_id,project_key)
);
CREATE TABLE public.bambu_production_records(
  task_id uuid PRIMARY KEY REFERENCES bambu_tasks(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
  profile_id uuid REFERENCES bambu_production_profiles(id),product_id uuid REFERENCES products(id),
  use_slicer boolean NOT NULL DEFAULT false,auto_enabled boolean NOT NULL DEFAULT false,
  units integer,materials jsonb,allocations jsonb NOT NULL DEFAULT '[]',
  outcome text NOT NULL DEFAULT 'unknown',state text NOT NULL DEFAULT 'unlinked',problem text,
  elapsed_seconds numeric,consumption_source text,material_cost numeric,energy_cost numeric,machine_cost numeric,
  labor_cost numeric,overhead numeric,extras_cost numeric,total_cost numeric,total_grams numeric,
  job_ids uuid[],posted_at timestamptz,source_snapshot jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bambu_production_allocations(
  task_id uuid NOT NULL REFERENCES bambu_production_records(task_id),tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_id uuid PRIMARY KEY REFERENCES jobs(id),quantity integer NOT NULL CHECK(quantity>0)
);
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['product_print_sources','bambu_production_profiles','bambu_production_records','bambu_production_allocations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
    EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=public.get_user_tenant_id())',tbl);
  END LOOP;
END $$;
DROP POLICY IF EXISTS bts_i ON bambu_tasks;
REVOKE INSERT,UPDATE,DELETE ON bambu_tasks FROM anon,authenticated;

CREATE FUNCTION erp_private.bambu_outcome(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s WHEN '2' THEN 'completed' WHEN '3' THEN 'failed' WHEN '1' THEN 'printing' WHEN '4' THEN 'printing' ELSE 'unknown' END
$$;
CREATE FUNCTION erp_private.bambu_project_key(r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN nullif(r->>'modelId','') IS NOT NULL AND coalesce(r->>'profileId','') NOT IN ('','0','-1')
    AND coalesce(r->>'plateIndex','') ~ '^[0-9]+$'
    THEN md5(jsonb_build_array(r->>'modelId',r->>'profileId',r->>'plateIndex')::text) END
$$;
CREATE FUNCTION erp_private.bambu_elapsed(task public.bambu_tasks) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN task.status IN ('2','3') AND task.end_time>task.start_time AND task.end_time-task.start_time<=interval '60 days'
    THEN extract(epoch FROM task.end_time-task.start_time) END
$$;
CREATE FUNCTION erp_private.bambu_filaments(r jsonb,grams numeric) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb:='[]'; part jsonb; idx bigint; key text; n numeric;
BEGIN
  IF jsonb_typeof(r->'amsDetailMapping')='array' AND jsonb_array_length(r->'amsDetailMapping')>0 THEN
    FOR part,idx IN SELECT value,ordinality FROM jsonb_array_elements(r->'amsDetailMapping') WITH ORDINALITY LOOP
      key:=md5(jsonb_build_array(idx,part->>'nozzleId',part->>'amsId',part->>'slotId',part->>'sourceColor',part->>'targetColor',part->>'filamentId',part->>'filamentType',part->>'targetFilamentType')::text);
      BEGIN n:=(part->>'weight')::numeric; EXCEPTION WHEN OTHERS THEN n:=NULL; END;
      IF NOT erp_private.valid_number(n) THEN n:=NULL; END IF;
      result:=result||jsonb_build_array(jsonb_build_object('source_key',key,'label',
        concat('Filamento ',idx,' · ',coalesce(nullif(part->>'targetFilamentType',''),part->>'filamentType','não informado'),
          ' · ',coalesce(part->>'targetColor',part->>'sourceColor','cor não informada'),' · AMS ',coalesce(part->>'amsId','—'),'/',coalesce(part->>'slotId','—')),
        'planned_grams',n));
    END LOOP;
  ELSE
    result:=jsonb_build_array(jsonb_build_object('source_key','single','label','Material da impressão (identifique o filamento utilizado)','planned_grams',grams));
  END IF;
  RETURN result;
END $$;
CREATE FUNCTION erp_private.bambu_candidate(task public.bambu_tasks) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[]; candidate uuid; plate_ids uuid[];
BEGIN
  -- Exact observed plate identity wins over a broad MakerWorld design link.
  SELECT array_agg(pp.id) INTO plate_ids FROM product_print_plates pp
    JOIN products p ON p.id=pp.product_id AND p.tenant_id=pp.tenant_id AND p.is_active
    JOIN product_print_sources ps ON ps.id=pp.source_id AND ps.tenant_id=pp.tenant_id AND ps.is_active
    WHERE pp.tenant_id=task.tenant_id AND pp.is_active AND pp.model_id=task.raw_data->>'modelId'
      AND pp.profile_id=task.raw_data->>'profileId' AND pp.plate_index::text=task.raw_data->>'plateIndex';
  IF cardinality(plate_ids)=1 THEN
    RETURN jsonb_build_object('candidate_product_id',(SELECT product_id FROM product_print_plates WHERE id=plate_ids[1]),'candidate_source','verified_identifiers','candidate_plate_id',plate_ids[1]);
  ELSIF cardinality(plate_ids)>1 THEN RETURN jsonb_build_object('candidate_product_id',NULL,'candidate_source','ambiguous'); END IF;
  SELECT array_agg(DISTINCT s.product_id) INTO ids FROM product_print_sources s JOIN products p ON p.id=s.product_id AND p.tenant_id=s.tenant_id
  WHERE s.tenant_id=task.tenant_id AND s.is_active AND p.is_active
    AND (s.model_id IS NOT NULL OR s.profile_id IS NOT NULL OR s.design_id IS NOT NULL)
    AND (s.model_id IS NULL OR s.model_id=task.raw_data->>'modelId')
    AND (s.profile_id IS NULL OR s.profile_id=task.raw_data->>'profileId')
    AND (s.design_id IS NULL OR s.design_id=task.raw_data->>'designId')
    AND (s.instance_id IS NULL OR s.instance_id=task.raw_data->>'instanceId')
    AND (s.plate_index IS NULL OR s.plate_index::text=task.raw_data->>'plateIndex');
  IF coalesce(array_length(ids,1),0)=1 THEN RETURN jsonb_build_object('candidate_product_id',ids[1],'candidate_source','verified_identifiers'); END IF;
  IF coalesce(array_length(ids,1),0)>1 THEN RETURN jsonb_build_object('candidate_product_id',NULL,'candidate_source','ambiguous'); END IF;
  SELECT array_agg(id) INTO ids FROM products WHERE tenant_id=task.tenant_id AND is_active
    AND substring(notes FROM 'Task ID: ([^\s]+)')=task.bambu_task_id;
  IF coalesce(array_length(ids,1),0)=1 THEN candidate:=ids[1]; END IF;
  RETURN jsonb_build_object('candidate_product_id',candidate,'candidate_source',CASE WHEN candidate IS NOT NULL THEN 'legacy_note' END);
END $$;

CREATE FUNCTION public.save_product_print_source(p_source_id uuid,p_product_id uuid,p_source jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid:=coalesce(p_source_id,gen_random_uuid()); source product_print_sources; k text; u text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  PERFORM erp_private.assert_ref('products',p_product_id,t);
  PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um produto ativo.'; END IF;
  IF jsonb_typeof(p_source)<>'object' OR p_source IS NULL THEN RAISE EXCEPTION 'Fonte de impressão inválida.'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_source) LOOP
    IF NOT k=ANY(ARRAY['label','source_url','file_path','file_name','file_sha256','design_id','instance_id','model_id','profile_id','plate_index']) THEN RAISE EXCEPTION 'Campo da fonte não permitido: %',k; END IF;
  END LOOP;
  source:=jsonb_populate_record(NULL::product_print_sources,p_source);
  u:=nullif(btrim(source.source_url),''); source.source_url:=u;
  IF u IS NOT NULL AND (u !~ '^https://[^/[:space:]]+(/[^[:space:]]*)?$' OR length(u)>2048) THEN RAISE EXCEPTION 'Informe um link HTTPS válido.'; END IF;
  IF source.file_path IS NOT NULL AND (split_part(source.file_path,'/',1)<>t::text OR source.file_path LIKE '%..%'
    OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='attachments' AND name=source.file_path)) THEN RAISE EXCEPTION 'Arquivo não encontrado na pasta da empresa.'; END IF;
  IF source.file_sha256 IS NOT NULL AND source.file_sha256 !~ '^[a-fA-F0-9]{64}$' THEN RAISE EXCEPTION 'Hash do arquivo inválido.'; END IF;
  IF source.plate_index IS NOT NULL AND source.plate_index NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Placa inválida.'; END IF;
  source.design_id:=nullif(nullif(btrim(source.design_id),'0'),''); source.instance_id:=nullif(nullif(btrim(source.instance_id),'0'),'');
  source.model_id:=nullif(btrim(source.model_id),''); source.profile_id:=nullif(nullif(btrim(source.profile_id),'0'),'');
  IF coalesce(u,source.file_path,source.design_id,source.model_id,source.profile_id) IS NULL THEN RAISE EXCEPTION 'Informe um arquivo, link ou identificador de impressão.'; END IF;
  IF p_source_id IS NULL AND source.file_path IS NOT NULL THEN
    SELECT id INTO result FROM product_print_sources WHERE tenant_id=t AND product_id=p_product_id AND file_path=source.file_path AND is_active LIMIT 1;
    IF result IS NOT NULL THEN RETURN result; END IF;
    result:=gen_random_uuid();
  END IF;
  IF p_source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_print_sources WHERE id=p_source_id AND tenant_id=t AND product_id=p_product_id) THEN RAISE EXCEPTION 'Fonte não encontrada para este produto.'; END IF;
  INSERT INTO product_print_sources(id,tenant_id,product_id,label,source_url,file_path,file_name,file_sha256,design_id,instance_id,model_id,profile_id,plate_index)
    VALUES(result,t,p_product_id,coalesce(source.label,''),u,source.file_path,source.file_name,lower(source.file_sha256),source.design_id,source.instance_id,source.model_id,source.profile_id,source.plate_index)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label,source_url=excluded.source_url,file_path=excluded.file_path,file_name=excluded.file_name,file_sha256=excluded.file_sha256,
      design_id=excluded.design_id,instance_id=excluded.instance_id,model_id=excluded.model_id,profile_id=excluded.profile_id,plate_index=excluded.plate_index,updated_at=now();
  RETURN result;
END $$;
CREATE FUNCTION public.archive_product_print_source(p_source_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  IF EXISTS(SELECT 1 FROM product_print_plates WHERE source_id=p_source_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Arquive as placas desta fonte antes de arquivar o arquivo/link.'; END IF;
  UPDATE product_print_sources SET is_active=false,updated_at=now() WHERE id=p_source_id AND tenant_id=t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fonte não encontrada.'; END IF;
END $$;
CREATE FUNCTION public.bind_product_print_source(p_source_id uuid,p_task_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); task bambu_tasks; source product_print_sources;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO source FROM product_print_sources WHERE id=p_source_id AND tenant_id=t AND is_active FOR UPDATE;
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t;
  IF source.id IS NULL OR task.id IS NULL OR erp_private.bambu_project_key(task.raw_data) IS NULL THEN RAISE EXCEPTION 'Selecione uma fonte e uma impressão com perfil/placa identificados.'; END IF;
  IF EXISTS(SELECT 1 FROM product_print_sources WHERE tenant_id=t AND is_active AND product_id<>source.product_id
    AND model_id=task.raw_data->>'modelId' AND profile_id=task.raw_data->>'profileId' AND plate_index::text=task.raw_data->>'plateIndex') THEN
    RAISE EXCEPTION 'Este perfil/placa já está associado a outro produto. Resolva o vínculo antes de prosseguir.';
  END IF;
  UPDATE product_print_sources SET model_id=task.raw_data->>'modelId',profile_id=task.raw_data->>'profileId',plate_index=(task.raw_data->>'plateIndex')::integer,
    design_id=nullif(task.raw_data->>'designId','0'),instance_id=nullif(task.raw_data->>'instanceId','0'),updated_at=now() WHERE id=source.id;
  RETURN source.id;
END $$;

CREATE FUNCTION public.bambu_production_preview(p_task_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE task bambu_tasks; config bambu_production_profiles; rec bambu_production_records; result jsonb; filaments jsonb; candidate jsonb; candidate_plates uuid[]; plates jsonb;
BEGIN
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=get_user_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Impressão não encontrada.'; END IF;
  SELECT * INTO rec FROM bambu_production_records WHERE task_id=task.id;
  SELECT * INTO config FROM bambu_production_profiles WHERE tenant_id=task.tenant_id AND bambu_device_id=task.bambu_device_id AND project_key=erp_private.bambu_project_key(task.raw_data);
  SELECT jsonb_agg(f.value||jsonb_build_object('item_id',(SELECT m->>'item_id' FROM jsonb_array_elements(coalesce(rec.materials,config.materials,'[]')) m WHERE m->>'source_key'=f.value->>'source_key' LIMIT 1))) INTO filaments
    FROM jsonb_array_elements(erp_private.bambu_filaments(task.raw_data,task.weight_grams)) f;
  candidate:=erp_private.bambu_candidate(task);
  SELECT coalesce(jsonb_agg(to_jsonb(pp) ORDER BY pp.plate_index,pp.id),'[]'::jsonb) INTO plates FROM product_print_plates pp WHERE pp.tenant_id=task.tenant_id AND pp.is_active;
  RETURN jsonb_build_object('task_id',task.id,'project_key',erp_private.bambu_project_key(task.raw_data),'can_auto',erp_private.bambu_project_key(task.raw_data) IS NOT NULL,
    'outcome',erp_private.bambu_outcome(task.status),'elapsed_seconds',erp_private.bambu_elapsed(task),'planned_grams',task.weight_grams,
    'filaments',filaments,'record',CASE WHEN rec.task_id IS NOT NULL THEN to_jsonb(rec) END,'profile',CASE WHEN config.id IS NOT NULL THEN to_jsonb(config) END,
    'skipped_objects',coalesce(task.raw_data->'skipObjects','[]'::jsonb),'raw_status',task.status,'plates',plates)||candidate;
END $$;

CREATE FUNCTION public.configure_bambu_production(p_task_id uuid,p_product_id uuid,p_units integer,p_materials jsonb,p_auto boolean,p_use_slicer boolean,
  p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_allocations jsonb,p_plate_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); task bambu_tasks; rec bambu_production_records; profile_uuid uuid; f jsonb; m jsonb; allocation jsonb; j jobs;
  keys text[]:='{}'; mapped text[]:='{}'; v_project_key text; source_uuid uuid; allocation_qty integer:=0; seen_jobs uuid[]:='{}';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Impressão não encontrada.'; END IF;
  SELECT * INTO rec FROM bambu_production_records WHERE task_id=task.id;
  IF rec.posted_at IS NOT NULL THEN RAISE EXCEPTION 'Impressão já contabilizada. O histórico é imutável.'; END IF;
  IF p_units IS NULL OR p_units NOT BETWEEN 1 AND 10000 OR NOT erp_private.valid_number(p_labor_cost) OR NOT erp_private.valid_number(p_overhead) OR NOT erp_private.valid_number(p_extras_cost) THEN RAISE EXCEPTION 'Informe quantidade e custos válidos (zero quando não houver).'; END IF;
  PERFORM erp_private.assert_ref('products',p_product_id,t);
  PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND category='kit') THEN RAISE EXCEPTION 'Selecione o produto físico impresso, não um kit.'; END IF;
  IF p_plate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_print_plates WHERE id=p_plate_id AND product_id=p_product_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Placa inválida para este produto.'; END IF;
  IF p_plate_id IS NULL AND EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=p_product_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Selecione qual placa deste produto foi impressa.'; END IF;
  IF jsonb_typeof(p_materials) IS DISTINCT FROM 'array' OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Materiais/alocações inválidos.'; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(erp_private.bambu_filaments(task.raw_data,task.weight_grams)) LOOP keys:=array_append(keys,f->>'source_key'); END LOOP;
  FOR m IN SELECT value FROM jsonb_array_elements(p_materials) LOOP
    IF m->>'source_key' IS NULL OR NOT(m->>'source_key'=ANY(keys)) OR m->>'source_key'=ANY(mapped) THEN RAISE EXCEPTION 'Identifique cada filamento da impressão uma única vez.'; END IF;
    PERFORM erp_private.assert_ref('inventory_items',(m->>'item_id')::uuid,t);
    IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=(m->>'item_id')::uuid AND tenant_id=t AND is_active AND lower(btrim(unit)) IN ('g','kg')) THEN RAISE EXCEPTION 'Selecione filamentos ativos em gramas ou quilogramas.'; END IF;
    mapped:=array_append(mapped,m->>'source_key');
  END LOOP;
  IF cardinality(keys)<>cardinality(mapped) THEN RAISE EXCEPTION 'Vincule todos os filamentos antes de configurar.'; END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP
    SELECT * INTO j FROM jobs WHERE id=(allocation->>'job_id')::uuid AND tenant_id=t;
    IF j.id IS NULL OR j.product_id IS DISTINCT FROM p_product_id OR j.print_plate_id IS DISTINCT FROM p_plate_id OR j.id=ANY(seen_jobs) OR j.inventory_posted_at IS NOT NULL OR j.status IN ('completed','shipped','ready','failed','quality_check','post_processing')
      OR EXISTS(SELECT 1 FROM inventory_movements WHERE reference_type='job' AND reference_id=j.id)
      OR EXISTS(SELECT 1 FROM bambu_production_allocations WHERE job_id=j.id) THEN RAISE EXCEPTION 'Selecione ordens abertas deste produto, sem consumo lançado e sem outro vínculo Bambu.'; END IF;
    IF (allocation->>'quantity')::numeric<>trunc((allocation->>'quantity')::numeric) OR NOT erp_private.valid_number((allocation->>'quantity')::numeric,1)
      OR (j.order_item_id IS NOT NULL AND (allocation->>'quantity')::integer<>CASE WHEN j.print_plate_id IS NULL THEN 1 ELSE coalesce(j.planned_quantity,1) END) THEN RAISE EXCEPTION 'A quantidade deve corresponder à capacidade planejada desta ordem/placa.'; END IF;
    allocation_qty:=allocation_qty+(allocation->>'quantity')::integer; seen_jobs:=array_append(seen_jobs,j.id);
  END LOOP;
  IF cardinality(seen_jobs)>0 AND allocation_qty<>p_units THEN RAISE EXCEPTION 'A soma das peças das ordens precisa fechar a quantidade da impressão.'; END IF;
  v_project_key:=erp_private.bambu_project_key(task.raw_data);
  IF p_auto AND v_project_key IS NULL THEN RAISE EXCEPTION 'Esta impressão não possui perfil/placa verificáveis para associação automática.'; END IF;
  IF v_project_key IS NOT NULL THEN
    IF p_plate_id IS NOT NULL THEN PERFORM public.bind_product_print_plate(p_plate_id,task.id); END IF;
    IF erp_private.bambu_candidate(task)->>'candidate_source'='ambiguous' THEN RAISE EXCEPTION 'Há fontes de impressão associadas a mais de um produto. Corrija o vínculo ambíguo no cadastro.'; END IF;
    IF EXISTS(SELECT 1 FROM bambu_production_profiles p WHERE p.tenant_id=t AND p.bambu_device_id=task.bambu_device_id AND p.project_key=v_project_key AND p.product_id<>p_product_id AND p.auto_enabled) THEN RAISE EXCEPTION 'Desative a associação anterior deste perfil antes de alterar o produto.'; END IF;
    INSERT INTO bambu_production_profiles(tenant_id,bambu_device_id,project_key,product_id,units,materials,auto_enabled,use_slicer,labor_cost,overhead,extras_cost,created_by)
      VALUES(t,task.bambu_device_id,v_project_key,p_product_id,p_units,p_materials,coalesce(p_auto,false),coalesce(p_use_slicer,false),p_labor_cost,p_overhead,p_extras_cost,auth.uid())
      ON CONFLICT(tenant_id,bambu_device_id,project_key) DO UPDATE SET product_id=excluded.product_id,units=excluded.units,materials=excluded.materials,auto_enabled=excluded.auto_enabled,
        use_slicer=excluded.use_slicer,auto_from=CASE WHEN NOT bambu_production_profiles.auto_enabled AND excluded.auto_enabled THEN now() ELSE bambu_production_profiles.auto_from END,
        labor_cost=excluded.labor_cost,overhead=excluded.overhead,extras_cost=excluded.extras_cost,updated_at=now() RETURNING id INTO profile_uuid;
    IF p_plate_id IS NULL THEN
      SELECT id INTO source_uuid FROM product_print_sources WHERE tenant_id=t AND product_id=p_product_id AND is_active AND model_id=task.raw_data->>'modelId'
        AND profile_id=task.raw_data->>'profileId' AND plate_index::text=task.raw_data->>'plateIndex' LIMIT 1;
      IF source_uuid IS NULL THEN
        source_uuid:=public.save_product_print_source(NULL,p_product_id,jsonb_build_object('label',coalesce(task.design_title,'Impressão Bambu'),'model_id',task.raw_data->>'modelId','profile_id',task.raw_data->>'profileId','plate_index',(task.raw_data->>'plateIndex')::integer));
      END IF;
    END IF;
  END IF;
  IF profile_uuid IS NOT NULL THEN UPDATE bambu_production_profiles SET plate_id=p_plate_id WHERE id=profile_uuid; END IF;
  INSERT INTO bambu_production_records(task_id,tenant_id,profile_id,product_id,units,materials,allocations,outcome,state,labor_cost,overhead,extras_cost,elapsed_seconds,use_slicer,auto_enabled)
    VALUES(task.id,t,profile_uuid,p_product_id,p_units,p_materials,p_allocations,erp_private.bambu_outcome(task.status),
      CASE WHEN task.status IN ('1','4') THEN 'watching' WHEN task.status='2' AND p_use_slicer THEN 'ready' WHEN task.status IN ('2','3') THEN 'needs_measurement' ELSE 'unknown' END,
      p_labor_cost,p_overhead,p_extras_cost,erp_private.bambu_elapsed(task),coalesce(p_use_slicer,false),coalesce(p_auto,false))
    ON CONFLICT(task_id) DO UPDATE SET profile_id=excluded.profile_id,product_id=excluded.product_id,units=excluded.units,materials=excluded.materials,allocations=excluded.allocations,
      outcome=excluded.outcome,state=excluded.state,problem=NULL,labor_cost=excluded.labor_cost,overhead=excluded.overhead,extras_cost=excluded.extras_cost,elapsed_seconds=excluded.elapsed_seconds,use_slicer=excluded.use_slicer,auto_enabled=excluded.auto_enabled,updated_at=now();
  UPDATE bambu_production_records SET plate_id=p_plate_id WHERE task_id=task.id;
  RETURN coalesce(profile_uuid,task.id);
END $$;

CREATE FUNCTION erp_private.post_bambu_production(p_task_id uuid,p_materials jsonb,p_seconds numeric,p_units integer,
  p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_variable
DECLARE task bambu_tasks; rec bambu_production_records; machine printers; product products; item inventory_items; j jobs;
  materials jsonb:='[]'; usage jsonb:='[]'; filaments jsonb; allocations jsonb; part jsonb; f jsonb; allocation jsonb;
  total_grams numeric:=0; material_cost numeric:=0; energy_cost numeric; machine_cost numeric; total_cost numeric;
  seconds numeric; units integer; grams numeric; qty numeric; cost numeric; rate numeric; depreciation numeric; settings jsonb;
  sum_planned numeric:=0; used_keys text[]:='{}'; ids uuid[]:='{}'; created_job uuid; count_units integer:=0; before_units integer:=0;
  job_material numeric; job_energy numeric; job_machine numeric; job_labor numeric; job_overhead numeric; job_extras numeric;
  source text; target_status job_status; average record; candidate jsonb;
BEGIN
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id FOR UPDATE;
  SELECT * INTO rec FROM bambu_production_records WHERE task_id=task.id FOR UPDATE;
  IF rec.task_id IS NULL OR rec.product_id IS NULL THEN RAISE EXCEPTION 'Associe produto, quantidade e filamentos antes de apurar.'; END IF;
  IF rec.posted_at IS NOT NULL THEN RETURN jsonb_build_object('state','posted','task_id',task.id,'job_ids',rec.job_ids,'total_cost',rec.total_cost); END IF;
  IF task.status IS NULL OR task.status NOT IN ('2','3') THEN RAISE EXCEPTION 'A Bambu ainda não confirmou o encerramento desta tentativa.'; END IF;
  seconds:=coalesce(p_seconds,erp_private.bambu_elapsed(task)); units:=coalesce(p_units,rec.units);
  IF NOT erp_private.valid_number(seconds,0.001) OR seconds>5184000 OR units IS NULL OR units NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe o tempo decorrido válido e a quantidade de peças da tentativa.'; END IF;
  IF task.status='3' AND nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da interrupção/falha e os gramas realmente consumidos.'; END IF;
  -- Follow the order → job → product/printer lock order used by manual ERP transitions.
  allocations:=rec.allocations;
  PERFORM 1 FROM orders WHERE id IN (SELECT order_id FROM jobs WHERE id IN(SELECT (a->>'job_id')::uuid FROM jsonb_array_elements(allocations) a)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM jobs WHERE id IN(SELECT (a->>'job_id')::uuid FROM jsonb_array_elements(allocations) a) ORDER BY id FOR UPDATE;
  SELECT * INTO product FROM products WHERE id=rec.product_id AND tenant_id=task.tenant_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto arquivado ou inválido. Revise o vínculo antes de apurar.'; END IF;
  IF rec.plate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_print_plates pp JOIN product_print_sources ps ON ps.id=pp.source_id AND ps.tenant_id=pp.tenant_id
    WHERE pp.id=rec.plate_id AND pp.product_id=product.id AND pp.tenant_id=task.tenant_id AND pp.is_active AND ps.is_active
      AND pp.plate_index::text=task.raw_data->>'plateIndex' AND (pp.model_id IS NULL OR pp.model_id=task.raw_data->>'modelId')
      AND (pp.profile_id IS NULL OR pp.profile_id=task.raw_data->>'profileId')) THEN RAISE EXCEPTION 'A placa/arquivo foi alterada, arquivada ou não corresponde à impressão Bambu.'; END IF;
  candidate:=erp_private.bambu_candidate(task);
  IF candidate->>'candidate_source'='ambiguous' OR (candidate->>'candidate_source'='verified_identifiers' AND (candidate->>'candidate_product_id')::uuid<>product.id) THEN RAISE EXCEPTION 'O arquivo/perfil está associado a outro produto ou a vários produtos. Resolva o vínculo.'; END IF;
  SELECT p.* INTO machine FROM printers p JOIN bambu_devices d ON d.printer_id=p.id AND d.tenant_id=p.tenant_id
    WHERE d.id=task.bambu_device_id AND d.tenant_id=task.tenant_id FOR UPDATE OF p;
  IF machine.id IS NULL THEN RAISE EXCEPTION 'Associe o dispositivo Bambu à impressora do ERP antes de apurar.'; END IF;
  filaments:=erp_private.bambu_filaments(task.raw_data,task.weight_grams);
  IF p_materials IS NULL THEN
    IF task.status IS DISTINCT FROM '2' OR NOT rec.use_slicer OR coalesce(task.raw_data->'skipObjects','null'::jsonb) NOT IN ('null'::jsonb,'[]'::jsonb,'{}'::jsonb) THEN
      RAISE EXCEPTION 'Esta tentativa exige os gramas efetivamente consumidos; o peso total do fatiador não comprova o consumo parcial.';
    END IF;
    FOR f IN SELECT value FROM jsonb_array_elements(filaments) LOOP
      SELECT value INTO part FROM jsonb_array_elements(rec.materials) WHERE value->>'source_key'=f->>'source_key';
      IF part IS NULL OR NOT erp_private.valid_number((f->>'planned_grams')::numeric) THEN RAISE EXCEPTION 'Filamento ou consumo previsto mudou. Revise o mapeamento e informe a medição.'; END IF;
      materials:=materials||jsonb_build_array(part||jsonb_build_object('grams',(f->>'planned_grams')::numeric));
      sum_planned:=sum_planned+(f->>'planned_grams')::numeric;
    END LOOP;
    IF NOT erp_private.valid_number(task.weight_grams,0.001) OR abs(sum_planned-task.weight_grams)>0.05 THEN RAISE EXCEPTION 'Os pesos dos filamentos não fecham o total do fatiador. Informe o consumo por material.'; END IF;
    source:='slicer_completed';
  ELSE
    IF jsonb_typeof(p_materials) IS DISTINCT FROM 'array' OR jsonb_array_length(p_materials)<>jsonb_array_length(filaments) THEN RAISE EXCEPTION 'Informe o consumo de cada filamento utilizado.'; END IF;
    materials:=p_materials; source:='measured';
  END IF;
  FOR part IN SELECT value FROM jsonb_array_elements(materials) LOOP
    IF part->>'source_key' IS NULL OR part->>'source_key'=ANY(used_keys) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(filaments) entry(value) WHERE entry.value->>'source_key'=part->>'source_key') THEN RAISE EXCEPTION 'Filamento ausente ou repetido na apuração.'; END IF;
    grams:=(part->>'grams')::numeric;
    IF NOT erp_private.valid_number(grams) OR grams>10000000 THEN RAISE EXCEPTION 'Informe gramas válidos (inclusive zero se confirmado).'; END IF;
    PERFORM erp_private.assert_ref('inventory_items',(part->>'item_id')::uuid,task.tenant_id);
    used_keys:=array_append(used_keys,part->>'source_key'); total_grams:=total_grams+grams;
  END LOOP;
  -- New physical attempts have no existing order/job locks; material rows use UUID order.
  IF jsonb_array_length(allocations)=0 THEN
    created_job:=gen_random_uuid();
    INSERT INTO jobs(id,tenant_id,code,name,product_id,printer_id,material_id,status,created_by,description,print_plate_id,planned_quantity)
      VALUES(created_job,task.tenant_id,erp_private.next_code(task.tenant_id,'OI'),coalesce(task.design_title,product.name),product.id,machine.id,
        (materials->0->>'item_id')::uuid,'printing',auth.uid(),'Tentativa física Bambu '||task.bambu_task_id||' · '||units||' peça(s); sem receita gerada automaticamente.',rec.plate_id,units);
    allocations:=jsonb_build_array(jsonb_build_object('job_id',created_job,'quantity',units));
  END IF;
  FOR allocation IN SELECT value FROM jsonb_array_elements(allocations) LOOP
    SELECT * INTO j FROM jobs WHERE id=(allocation->>'job_id')::uuid AND tenant_id=task.tenant_id;
    IF j.id IS NULL OR j.product_id IS DISTINCT FROM product.id OR j.print_plate_id IS DISTINCT FROM rec.plate_id OR j.id=ANY(ids) OR j.inventory_posted_at IS NOT NULL
      OR j.status NOT IN ('draft','queued','printing','paused','reprint') OR (j.printer_id IS NOT NULL AND j.printer_id<>machine.id)
      OR EXISTS(SELECT 1 FROM orders WHERE id=j.order_id AND status='cancelled')
      OR EXISTS(SELECT 1 FROM inventory_movements WHERE reference_type='job' AND reference_id=j.id)
      OR EXISTS(SELECT 1 FROM bambu_production_allocations WHERE job_id=j.id) THEN RAISE EXCEPTION 'Ordem já apurada, impressora divergente ou vínculo inválido. Nenhum material foi baixado.'; END IF;
    IF NOT erp_private.valid_number((allocation->>'quantity')::numeric,1) OR (allocation->>'quantity')::numeric<>trunc((allocation->>'quantity')::numeric)
      OR (j.order_item_id IS NOT NULL AND (allocation->>'quantity')::integer<>CASE WHEN j.print_plate_id IS NULL THEN 1 ELSE coalesce(j.planned_quantity,1) END) THEN RAISE EXCEPTION 'Quantidade de peças inválida no rateio das ordens.'; END IF;
    count_units:=count_units+(allocation->>'quantity')::integer; ids:=array_append(ids,j.id);
  END LOOP;
  IF count_units<>units THEN RAISE EXCEPTION 'O total de peças das ordens não fecha a execução. Revise a alocação.'; END IF;
  PERFORM 1 FROM inventory_items WHERE id IN(SELECT (m->>'item_id')::uuid FROM jsonb_array_elements(materials) m) ORDER BY id FOR UPDATE;
  FOR part IN SELECT jsonb_build_object('item_id',m->>'item_id','grams',sum((m->>'grams')::numeric)) FROM jsonb_array_elements(materials) m GROUP BY m->>'item_id' ORDER BY m->>'item_id' LOOP
    SELECT * INTO item FROM inventory_items WHERE id=(part->>'item_id')::uuid AND tenant_id=task.tenant_id AND is_active;
    IF item.id IS NULL OR lower(btrim(item.unit)) NOT IN ('g','kg') THEN RAISE EXCEPTION 'Selecione materiais ativos em gramas ou quilogramas.'; END IF;
    grams:=(part->>'grams')::numeric; qty:=CASE WHEN lower(btrim(item.unit))='kg' THEN grams/1000 ELSE grams END;
    cost:=0;
    IF grams>0 THEN
      INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
        VALUES(task.tenant_id,item.id,CASE WHEN task.status='3' THEN 'loss'::movement_type ELSE 'job_consumption'::movement_type END,qty,'bambu_task',task.id,
          'Bambu '||task.bambu_task_id||' · '||CASE WHEN source='measured' THEN 'consumo informado por medição' ELSE 'consumo do fatiador após impressão concluída' END||
          CASE WHEN task.status='3' THEN ' · perda: '||btrim(p_reason) ELSE '' END,auth.uid()) RETURNING inventory_movements.total_cost INTO cost;
    END IF;
    material_cost:=material_cost+cost;
    usage:=usage||jsonb_build_array(jsonb_build_object('item_id',item.id,'name',item.name,'grams',grams,'quantity',qty,'unit',item.unit,'unit_cost',item.avg_cost,'cost',cost));
  END LOOP;
  SELECT tenants.settings INTO settings FROM tenants WHERE id=task.tenant_id;
  rate:=nullif(settings->>'energy_cost_kwh','')::numeric;
  IF NOT erp_private.valid_number(rate) THEN RAISE EXCEPTION 'Configure a tarifa de energia antes de apurar.'; END IF;
  depreciation:=coalesce(machine.depreciation_per_hour,CASE WHEN machine.useful_life_hours>0 THEN machine.acquisition_cost/machine.useful_life_hours ELSE 0 END,0);
  machine_cost:=round(seconds/3600*(depreciation+coalesce(machine.maintenance_cost_per_hour,0)),2);
  energy_cost:=round(seconds/3600*(coalesce(machine.power_watts,0)/1000)*rate,2);
  rec.labor_cost:=coalesce(p_labor_cost,rec.labor_cost); rec.overhead:=coalesce(p_overhead,rec.overhead); rec.extras_cost:=coalesce(p_extras_cost,rec.extras_cost);
  IF NOT erp_private.valid_number(rec.labor_cost) OR NOT erp_private.valid_number(rec.overhead) OR NOT erp_private.valid_number(rec.extras_cost)
    OR NOT erp_private.valid_number(machine_cost) OR NOT erp_private.valid_number(energy_cost) THEN RAISE EXCEPTION 'Informe custos válidos para mão de obra, indiretos e acessórios.'; END IF;
  rec.labor_cost:=round(rec.labor_cost,2); rec.overhead:=round(rec.overhead,2); rec.extras_cost:=round(rec.extras_cost,2);
  total_cost:=material_cost+machine_cost+energy_cost+rec.labor_cost+rec.overhead+rec.extras_cost;
  target_status:=CASE WHEN task.status='3' THEN 'failed'::job_status ELSE 'quality_check'::job_status END;
  FOR allocation IN SELECT value FROM jsonb_array_elements(allocations) LOOP
    qty:=(allocation->>'quantity')::integer;
    -- Cumulative rounding conserves every cent between order items.
    job_material:=round(material_cost*(before_units+qty)/units,2)-round(material_cost*before_units/units,2);
    job_machine:=round(machine_cost*(before_units+qty)/units,2)-round(machine_cost*before_units/units,2);
    job_energy:=round(energy_cost*(before_units+qty)/units,2)-round(energy_cost*before_units/units,2);
    job_labor:=round(rec.labor_cost*(before_units+qty)/units,2)-round(rec.labor_cost*before_units/units,2);
    job_overhead:=round(rec.overhead*(before_units+qty)/units,2)-round(rec.overhead*before_units/units,2);
    job_extras:=round(rec.extras_cost*(before_units+qty)/units,2)-round(rec.extras_cost*before_units/units,2);
    cost:=job_material+job_machine+job_energy+job_labor+job_overhead+job_extras;
    UPDATE jobs SET status=target_status,printer_id=machine.id,bambu_task_id=task.bambu_task_id,
      actual_grams=total_grams*qty/units,actual_time_seconds=seconds*qty/units,actual_time_minutes=ceil(seconds*qty/units/60),
      actual_material_usage=(SELECT jsonb_agg(u||jsonb_build_object('grams',(u->>'grams')::numeric*qty/units,'quantity',(u->>'quantity')::numeric*qty/units,'cost',(u->>'cost')::numeric*qty/units)) FROM jsonb_array_elements(usage) u),produced_quantity=CASE WHEN task.status='3' THEN 0 ELSE qty END,
      actual_material_cost=job_material,actual_machine_cost=job_machine,actual_energy_cost=job_energy,
      actual_labor_cost=job_labor,actual_overhead=job_overhead,actual_extras_cost=job_extras,actual_total_cost=cost,
      waste_grams=CASE WHEN task.status='3' THEN total_grams*qty/units ELSE 0 END,
      margin_percent=CASE WHEN task.status='3' OR sale_price IS NULL OR sale_price<=0 THEN NULL ELSE round((sale_price-cost)/sale_price*100,2) END,
      failure_reason=CASE WHEN task.status='3' THEN btrim(p_reason) ELSE failure_reason END,
      started_at=coalesce(task.start_time,started_at),completed_at=coalesce(task.end_time,now()),inventory_posted_at=now()
      WHERE id=(allocation->>'job_id')::uuid;
    INSERT INTO bambu_production_allocations(task_id,tenant_id,job_id,quantity) VALUES(task.id,task.tenant_id,(allocation->>'job_id')::uuid,qty);
    before_units:=before_units+qty;
  END LOOP;
  UPDATE bambu_production_records SET state='posted',problem=NULL,outcome=erp_private.bambu_outcome(task.status),units=units,materials=materials,allocations=allocations,
    total_grams=total_grams,elapsed_seconds=seconds,consumption_source=source,material_cost=material_cost,machine_cost=machine_cost,energy_cost=energy_cost,
    labor_cost=rec.labor_cost,overhead=rec.overhead,extras_cost=rec.extras_cost,total_cost=total_cost,job_ids=ids,posted_at=now(),
    source_snapshot=jsonb_build_object('task',task.raw_data,'material_usage',usage,
      'print_plate',(SELECT to_jsonb(pp) FROM product_print_plates pp WHERE pp.id=rec.plate_id),
      'print_sources',(SELECT jsonb_agg(to_jsonb(ps)) FROM product_print_sources ps WHERE ps.tenant_id=task.tenant_id AND ps.product_id=product.id AND ps.is_active
        AND (ps.id=(SELECT pp.source_id FROM product_print_plates pp WHERE pp.id=rec.plate_id)
          OR (rec.plate_id IS NULL AND ps.model_id=task.raw_data->>'modelId' AND ps.profile_id=task.raw_data->>'profileId' AND ps.plate_index::text=task.raw_data->>'plateIndex'))),
      'time_source',CASE WHEN p_seconds IS NULL THEN 'elapsed_start_end' ELSE 'confirmed_elapsed' END,
      'energy_rate',rate,'power_watts',machine.power_watts,'depreciation_per_hour',depreciation,'maintenance_per_hour',machine.maintenance_cost_per_hour,'valuation','average_cost_at_posting'),updated_at=now()
    WHERE task_id=task.id;
  UPDATE bambu_tasks SET job_id=ids[1] WHERE id=task.id;
  UPDATE printers SET total_prints=coalesce(total_prints,0)+1,total_print_hours=coalesce(total_print_hours,0)+seconds/3600,
    total_failures=coalesce(total_failures,0)+CASE WHEN task.status='3' THEN 1 ELSE 0 END WHERE id=machine.id;
  IF task.status='2' THEN
    PERFORM erp_private.update_product_print_actuals(product.id);
  END IF;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(task.tenant_id,auth.uid(),'bambu_production_accounted','bambu_tasks',task.id,
    jsonb_build_object('job_ids',ids,'outcome',erp_private.bambu_outcome(task.status),'grams',total_grams,'seconds',seconds,'cost',total_cost,'source',source));
  RETURN jsonb_build_object('state','posted','task_id',task.id,'job_ids',ids,'total_cost',total_cost);
END $$;

CREATE FUNCTION public.account_bambu_production(p_task_id uuid,p_materials jsonb,p_seconds numeric,p_units integer,
  p_labor_cost numeric,p_overhead numeric,p_extras_cost numeric,p_reason text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); payload jsonb; previous uuid; result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t) THEN RAISE EXCEPTION 'Impressão não encontrada.'; END IF;
  payload:=jsonb_build_object('task',p_task_id,'materials',p_materials,'seconds',p_seconds,'units',p_units,'labor',p_labor_cost,'overhead',p_overhead,'extras',p_extras_cost,'reason',p_reason);
  previous:=erp_private.begin_request(t,p_request_id,'bambu_account',payload);
  IF previous IS NOT NULL THEN RETURN (SELECT jsonb_build_object('state','posted','task_id',task_id,'job_ids',job_ids,'total_cost',total_cost) FROM bambu_production_records WHERE task_id=previous AND tenant_id=t); END IF;
  result:=erp_private.post_bambu_production(p_task_id,p_materials,p_seconds,p_units,p_labor_cost,p_overhead,p_extras_cost,p_reason);
  PERFORM erp_private.finish_request(t,p_request_id,p_task_id); RETURN result;
END $$;

CREATE FUNCTION erp_private.reconcile_bambu_task(p_task_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE task bambu_tasks; rec bambu_production_records; config bambu_production_profiles; candidate jsonb;
  eligible boolean; related_jobs uuid[]; allocations jsonb; machine_id uuid; message text;
BEGIN
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id FOR UPDATE;
  SELECT * INTO rec FROM bambu_production_records WHERE task_id=task.id FOR UPDATE;
  IF rec.posted_at IS NOT NULL THEN
    IF rec.outcome<>erp_private.bambu_outcome(task.status) OR rec.source_snapshot->'task'->'weight' IS DISTINCT FROM task.raw_data->'weight'
      OR rec.source_snapshot->'task'->'endTime' IS DISTINCT FROM task.raw_data->'endTime' THEN
      UPDATE bambu_production_records SET problem='A Bambu alterou dados de uma tentativa já contabilizada. Confira o histórico; nenhuma baixa foi repetida.',updated_at=now() WHERE task_id=task.id;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO config FROM bambu_production_profiles WHERE tenant_id=task.tenant_id AND bambu_device_id=task.bambu_device_id AND project_key=erp_private.bambu_project_key(task.raw_data);
  eligible:=config.id IS NOT NULL AND config.auto_enabled AND task.start_time>=config.auto_from;
  IF rec.task_id IS NULL THEN
    INSERT INTO bambu_production_records(task_id,tenant_id,profile_id,product_id,units,materials,use_slicer,auto_enabled,
      labor_cost,overhead,extras_cost,plate_id)
      VALUES(task.id,task.tenant_id,config.id,config.product_id,config.units,config.materials,coalesce(config.use_slicer,false),coalesce(eligible,false),
        config.labor_cost,config.overhead,config.extras_cost,config.plate_id) RETURNING * INTO rec;
  END IF;
  UPDATE bambu_production_records SET outcome=erp_private.bambu_outcome(task.status),elapsed_seconds=erp_private.bambu_elapsed(task),
    state=CASE WHEN rec.product_id IS NULL THEN 'unlinked' WHEN task.status IN ('1','4') THEN 'watching' WHEN task.status IN ('2','3') THEN 'needs_measurement' ELSE 'unknown' END,
    problem=CASE WHEN rec.product_id IS NULL THEN 'Associe esta impressão a um produto, placa e filamentos.'
      WHEN task.status='3' THEN 'Falha/interrupção confirmada. Informe o material realmente consumido para registrar a perda.'
      WHEN task.status NOT IN ('1','2','3','4') THEN 'Estado Bambu desconhecido; aguardando resultado confiável.' ELSE NULL END,updated_at=now() WHERE task_id=task.id;
  -- A stopped/failed attempt never consumes the full-file prediction automatically.
  IF NOT coalesce(eligible,false) OR NOT rec.auto_enabled OR rec.product_id IS NULL OR task.status IS DISTINCT FROM '2' OR NOT rec.use_slicer THEN RETURN; END IF;
  IF rec.product_id IS DISTINCT FROM config.product_id OR rec.plate_id IS DISTINCT FROM config.plate_id OR rec.materials IS DISTINCT FROM config.materials THEN
    UPDATE bambu_production_records SET state='blocked',problem='A configuração mudou durante esta tentativa. Confira os filamentos, produto e placa antes de apurar.' WHERE task_id=task.id; RETURN;
  END IF;
  candidate:=erp_private.bambu_candidate(task);
  IF candidate->>'candidate_source'='ambiguous' THEN UPDATE bambu_production_records SET state='blocked',problem='Arquivo/perfil vinculado a mais de um produto.' WHERE task_id=task.id; RETURN; END IF;
  -- Only one exact queued match can be selected automatically. Never guess an order by title.
  IF jsonb_array_length(rec.allocations)=0 THEN
    SELECT printer_id INTO machine_id FROM bambu_devices WHERE id=task.bambu_device_id AND tenant_id=task.tenant_id;
    SELECT array_agg(j.id ORDER BY j.created_at,j.id) INTO related_jobs FROM jobs j WHERE j.tenant_id=task.tenant_id AND j.product_id=rec.product_id
      AND j.print_plate_id IS NOT DISTINCT FROM rec.plate_id AND j.status IN ('draft','queued','printing','paused','reprint') AND j.inventory_posted_at IS NULL
      AND (j.printer_id IS NULL OR j.printer_id=machine_id) AND NOT EXISTS(SELECT 1 FROM bambu_production_allocations a WHERE a.job_id=j.id);
    IF cardinality(related_jobs)>1 THEN
      UPDATE bambu_production_records SET state='blocked',problem='Mais de uma ordem pode corresponder a esta impressão. Selecione a ordem/placa no vínculo para não atender o pedido errado.' WHERE task_id=task.id; RETURN;
    ELSIF cardinality(related_jobs)=1 THEN
      IF EXISTS(SELECT 1 FROM jobs WHERE id=related_jobs[1] AND order_item_id IS NOT NULL AND coalesce(planned_quantity,1)<>rec.units) THEN
        UPDATE bambu_production_records SET state='blocked',problem='Quantidade da impressão difere da ordem planejada. Confira a alocação.' WHERE task_id=task.id; RETURN;
      END IF;
      UPDATE bambu_production_records SET allocations=jsonb_build_array(jsonb_build_object('job_id',related_jobs[1],'quantity',rec.units)) WHERE task_id=task.id;
    END IF;
  END IF;
  BEGIN
    PERFORM erp_private.post_bambu_production(task.id,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
    UPDATE bambu_production_records SET state='blocked',problem=left(message,600),updated_at=now() WHERE task_id=task.id;
  END;
END $$;

CREATE FUNCTION public.erp_bambu_remote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN RAISE EXCEPTION 'O histórico Bambu só pode ser atualizado pelo sincronizador.'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.tenant_id<>OLD.tenant_id OR NEW.bambu_task_id<>OLD.bambu_task_id THEN RAISE EXCEPTION 'A identidade da tentativa Bambu é imutável.'; END IF;
    IF OLD.status IN ('2','3') AND (NEW.status IS NULL OR NEW.status NOT IN ('2','3')) THEN
      NEW.status:=OLD.status; NEW.raw_data:=OLD.raw_data; NEW.start_time:=OLD.start_time; NEW.end_time:=OLD.end_time;
      NEW.weight_grams:=OLD.weight_grams; NEW.cost_time_seconds:=OLD.cost_time_seconds;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_bambu_remote_guard BEFORE INSERT OR UPDATE ON bambu_tasks FOR EACH ROW EXECUTE FUNCTION public.erp_bambu_remote_guard();
CREATE FUNCTION public.erp_bambu_reconcile_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM erp_private.reconcile_bambu_task(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER erp_bambu_reconcile AFTER INSERT OR UPDATE OF raw_data,status,weight_grams,cost_time_seconds,start_time,end_time ON bambu_tasks
  FOR EACH ROW EXECUTE FUNCTION public.erp_bambu_reconcile_trigger();
REVOKE ALL ON FUNCTION public.erp_bambu_reconcile_trigger() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.erp_preserve_printer_accounting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon','service_role') THEN
    NEW.total_print_hours:=OLD.total_print_hours; NEW.total_prints:=OLD.total_prints; NEW.total_failures:=OLD.total_failures;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_preserve_printer_accounting BEFORE UPDATE ON printers FOR EACH ROW EXECUTE FUNCTION public.erp_preserve_printer_accounting();
CREATE FUNCTION public.erp_preserve_product_actuals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon','service_role') AND
    (NEW.actual_print_grams_per_unit,NEW.actual_print_seconds_per_unit,NEW.actual_print_cost_per_unit,NEW.actual_print_sample_units,NEW.actual_print_source,NEW.actual_print_updated_at)
    IS DISTINCT FROM (OLD.actual_print_grams_per_unit,OLD.actual_print_seconds_per_unit,OLD.actual_print_cost_per_unit,OLD.actual_print_sample_units,OLD.actual_print_source,OLD.actual_print_updated_at) THEN
    RAISE EXCEPTION 'A referência realizada é calculada pelo histórico de produção e não pode ser editada.';
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER erp_preserve_product_actuals BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION public.erp_preserve_product_actuals();

CREATE VIEW public.bambu_production_review WITH(security_invoker=true) AS
  SELECT b.id AS task_id,b.tenant_id,b.bambu_task_id,b.design_title,d.name AS device_name,b.start_time AS started_at,b.end_time AS ended_at,b.status AS raw_status,
    CASE b.status WHEN '2' THEN 'completed' WHEN '3' THEN 'failed' WHEN '1' THEN 'printing' WHEN '4' THEN 'printing' ELSE 'unknown' END AS outcome,
    coalesce(r.state,'unlinked') AS state,r.problem,b.weight_grams AS planned_grams,
    CASE WHEN b.status IN ('2','3') AND b.end_time>b.start_time AND b.end_time-b.start_time<=interval '60 days' THEN extract(epoch FROM b.end_time-b.start_time) END AS elapsed_seconds,
    r.posted_at,r.total_cost,r.product_id,p.name AS product_name,r.units,r.consumption_source,coalesce(r.auto_enabled,false) AS auto_enabled,
    CASE WHEN r.posted_at IS NOT NULL AND r.outcome='completed' THEN r.units ELSE 0 END AS completed_units
  FROM bambu_tasks b LEFT JOIN bambu_devices d ON d.id=b.bambu_device_id AND d.tenant_id=b.tenant_id
    LEFT JOIN bambu_production_records r ON r.task_id=b.id AND r.tenant_id=b.tenant_id LEFT JOIN products p ON p.id=r.product_id AND p.tenant_id=b.tenant_id;
REVOKE ALL ON public.bambu_production_review FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bambu_production_review TO authenticated;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='erp_private' AND (p.proname LIKE '%bambu%' OR p.proname='post_bambu_production') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.name);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.save_product_print_source(uuid,uuid,jsonb),public.archive_product_print_source(uuid),public.bind_product_print_source(uuid,uuid),
  public.bambu_production_preview(uuid),public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid),
  public.account_bambu_production(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_print_source(uuid,uuid,jsonb),public.archive_product_print_source(uuid),public.bind_product_print_source(uuid,uuid),
  public.bambu_production_preview(uuid),public.configure_bambu_production(uuid,uuid,integer,jsonb,boolean,boolean,numeric,numeric,numeric,jsonb,uuid),
  public.account_bambu_production(uuid,jsonb,numeric,integer,numeric,numeric,numeric,text,uuid) TO authenticated;
