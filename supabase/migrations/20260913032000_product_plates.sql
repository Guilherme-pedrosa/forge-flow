-- A SKU may require every active plate (for example base + lid). A plate's
-- estimates describe one complete physical run; units_per_plate is its yield.
CREATE TABLE public.product_print_plates(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id),source_id uuid REFERENCES product_print_sources(id),
  plate_index integer NOT NULL CHECK(plate_index>=1),label text NOT NULL,
  units_per_plate integer NOT NULL DEFAULT 1 CHECK(units_per_plate BETWEEN 1 AND 10000),
  material_id uuid REFERENCES inventory_items(id),printer_id uuid REFERENCES printers(id),
  est_grams numeric,est_time_seconds numeric,est_cost_per_unit numeric,is_active boolean NOT NULL DEFAULT true,
  actual_grams_per_unit numeric,actual_seconds_per_unit numeric,actual_cost_per_unit numeric,
  actual_sample_units integer,actual_source text,actual_updated_at timestamptz,
  model_id text,profile_id text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_print_plates_product ON product_print_plates(tenant_id,product_id) WHERE is_active;
CREATE UNIQUE INDEX product_print_plates_source_active ON product_print_plates(tenant_id,source_id,plate_index) WHERE is_active AND source_id IS NOT NULL;
ALTER TABLE product_print_plates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_print_plates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON product_print_plates TO authenticated;
CREATE POLICY product_print_plates_read ON product_print_plates FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE TRIGGER product_print_plate_tenant BEFORE INSERT OR UPDATE ON product_print_plates FOR EACH ROW EXECUTE FUNCTION erp_check_tenant_references();
ALTER TABLE jobs ADD COLUMN print_plate_id uuid REFERENCES product_print_plates(id),
  ADD COLUMN planned_quantity integer NOT NULL DEFAULT 1 CHECK(planned_quantity BETWEEN 1 AND 10000);
ALTER TABLE bambu_production_records ADD COLUMN plate_id uuid REFERENCES product_print_plates(id);
ALTER TABLE bambu_production_profiles ADD COLUMN plate_id uuid REFERENCES product_print_plates(id);

CREATE FUNCTION erp_private.update_product_print_actuals(p_product_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p products; plate product_print_plates; metrics record; combined record; count_plates integer;
BEGIN
  SELECT * INTO p FROM products WHERE id=p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  FOR plate IN SELECT * FROM product_print_plates WHERE product_id=p.id AND tenant_id=p.tenant_id ORDER BY id FOR UPDATE LOOP
    SELECT sum(r.total_grams)/sum(r.units) AS grams,sum(r.elapsed_seconds)/sum(r.units) AS seconds,
      sum(r.total_cost)/sum(r.units) AS cost,sum(r.units)::integer AS units,
      CASE WHEN count(DISTINCT r.consumption_source)>1 THEN 'mixed' ELSE min(r.consumption_source) END AS source
      INTO metrics FROM bambu_production_records r
      WHERE r.product_id=p.id AND r.tenant_id=p.tenant_id AND r.plate_id=plate.id
        AND r.state='posted' AND r.posted_at IS NOT NULL AND r.outcome='completed' AND r.units>0
        AND r.total_grams IS NOT NULL AND r.elapsed_seconds IS NOT NULL AND r.total_cost IS NOT NULL;
    UPDATE product_print_plates SET actual_grams_per_unit=metrics.grams,actual_seconds_per_unit=metrics.seconds,
      actual_cost_per_unit=metrics.cost,actual_sample_units=metrics.units,actual_source=metrics.source,
      actual_updated_at=CASE WHEN metrics.units>0 THEN now() END WHERE id=plate.id;
  END LOOP;
  SELECT count(*) INTO count_plates FROM product_print_plates WHERE product_id=p.id AND tenant_id=p.tenant_id AND is_active;
  IF count_plates>0 THEN
    SELECT CASE WHEN count(actual_grams_per_unit)=count(*) THEN sum(actual_grams_per_unit) END AS actual_grams,
      CASE WHEN count(actual_seconds_per_unit)=count(*) THEN sum(actual_seconds_per_unit) END AS actual_seconds,
      CASE WHEN count(actual_cost_per_unit)=count(*) THEN sum(actual_cost_per_unit) END AS actual_cost,
      CASE WHEN count(actual_sample_units)=count(*) THEN min(actual_sample_units) END AS units,
      CASE WHEN count(actual_source)<count(*) THEN 'partial' WHEN count(DISTINCT actual_source)>1 THEN 'mixed' ELSE min(actual_source) END AS source,
      CASE WHEN count(coalesce(actual_cost_per_unit,est_cost_per_unit))=count(*) THEN sum(coalesce(actual_cost_per_unit,est_cost_per_unit)) END AS estimate_cost,
      CASE WHEN count(coalesce(actual_grams_per_unit,est_grams/units_per_plate))=count(*) THEN sum(coalesce(actual_grams_per_unit,est_grams/units_per_plate)) END AS estimate_grams,
      CASE WHEN count(coalesce(actual_seconds_per_unit,est_time_seconds/units_per_plate))=count(*) THEN sum(coalesce(actual_seconds_per_unit,est_time_seconds/units_per_plate)) END AS estimate_seconds
      INTO combined FROM product_print_plates WHERE product_id=p.id AND tenant_id=p.tenant_id AND is_active;
    UPDATE products SET actual_print_grams_per_unit=combined.actual_grams,actual_print_seconds_per_unit=combined.actual_seconds,
      actual_print_cost_per_unit=combined.actual_cost,actual_print_sample_units=combined.units,actual_print_source=combined.source,
      actual_print_updated_at=CASE WHEN combined.units>0 THEN now() END,cost_estimate=combined.estimate_cost,
      est_grams=combined.estimate_grams*greatest(coalesce(p.prints_per_plate,1),1),
      est_time_minutes=ceil(combined.estimate_seconds*greatest(coalesce(p.prints_per_plate,1),1)/60),
      margin_percent=CASE WHEN sale_price>0 AND combined.estimate_cost IS NOT NULL THEN round((sale_price-combined.estimate_cost)/sale_price*100,2) END WHERE id=p.id;
  ELSE
    -- Legacy products with no active plates retain their unplated sample model.
    SELECT sum(r.total_grams)/sum(r.units) AS grams,sum(r.elapsed_seconds)/sum(r.units) AS seconds,
      sum(r.total_cost)/sum(r.units) AS cost,sum(r.units)::integer AS units,
      CASE WHEN count(DISTINCT r.consumption_source)>1 THEN 'mixed' ELSE min(r.consumption_source) END AS source
      INTO metrics FROM bambu_production_records r WHERE r.product_id=p.id AND r.tenant_id=p.tenant_id AND r.plate_id IS NULL
        AND r.state='posted' AND r.posted_at IS NOT NULL AND r.outcome='completed' AND r.units>0
        AND r.total_grams IS NOT NULL AND r.elapsed_seconds IS NOT NULL AND r.total_cost IS NOT NULL;
    UPDATE products SET actual_print_grams_per_unit=metrics.grams,actual_print_seconds_per_unit=metrics.seconds,
      actual_print_cost_per_unit=metrics.cost,actual_print_sample_units=metrics.units,actual_print_source=metrics.source,
      actual_print_updated_at=CASE WHEN metrics.units>0 THEN now() END,
      cost_estimate=coalesce(metrics.cost,cost_estimate),
      est_grams=CASE WHEN metrics.grams IS NOT NULL THEN metrics.grams*greatest(coalesce(p.prints_per_plate,1),1) ELSE est_grams END,
      est_time_minutes=CASE WHEN metrics.seconds IS NOT NULL THEN ceil(metrics.seconds*greatest(coalesce(p.prints_per_plate,1),1)/60) ELSE est_time_minutes END,
      margin_percent=CASE WHEN sale_price>0 AND coalesce(metrics.cost,cost_estimate) IS NOT NULL THEN round((sale_price-coalesce(metrics.cost,cost_estimate))/sale_price*100,2) END WHERE id=p.id;
  END IF;
END $$;

CREATE FUNCTION public.save_product_print_plate(p_plate_id uuid,p_product_id uuid,p_source_id uuid,p_plate jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid:=coalesce(p_plate_id,gen_random_uuid()); previous product_print_plates;
  plate product_print_plates; k text; n numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um produto ativo da sua empresa.'; END IF;
  IF p_source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_print_sources WHERE id=p_source_id AND product_id=p_product_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'A fonte deve pertencer ao mesmo produto e empresa.'; END IF;
  IF p_plate IS NULL OR jsonb_typeof(p_plate)<>'object' THEN RAISE EXCEPTION 'Informe os dados da placa.'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_plate) LOOP
    IF NOT k=ANY(ARRAY['plate_index','label','units_per_plate','material_id','printer_id','est_grams','est_time_seconds','est_cost_per_unit']) THEN RAISE EXCEPTION 'Campo da placa não permitido: %',k; END IF;
    IF k=ANY(ARRAY['plate_index','units_per_plate','est_grams','est_time_seconds','est_cost_per_unit']) AND p_plate->k<>'null'::jsonb THEN
      IF jsonb_typeof(p_plate->k)<>'number' THEN RAISE EXCEPTION 'Informe números válidos para a placa.'; END IF;
      n:=(p_plate->>k)::numeric;
      IF NOT erp_private.valid_number(n) OR (k IN ('plate_index','units_per_plate') AND (n<>trunc(n) OR n<1 OR n>10000)) THEN RAISE EXCEPTION 'Quantidade, índice ou estimativa de placa inválida.'; END IF;
    END IF;
  END LOOP;
  plate:=jsonb_populate_record(NULL::product_print_plates,p_plate);
  plate.units_per_plate:=coalesce(plate.units_per_plate,1);
  IF plate.plate_index IS NULL OR nullif(btrim(plate.label),'') IS NULL THEN RAISE EXCEPTION 'Informe número e nome da placa.'; END IF;
  PERFORM erp_private.assert_ref('inventory_items',plate.material_id,t); PERFORM erp_private.assert_ref('printers',plate.printer_id,t);
  IF plate.material_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=plate.material_id AND is_active AND lower(btrim(unit)) IN ('g','kg')) THEN RAISE EXCEPTION 'Material da placa deve estar ativo em g ou kg.'; END IF;
  IF plate.printer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers WHERE id=plate.printer_id AND is_active) THEN RAISE EXCEPTION 'Selecione uma impressora ativa.'; END IF;
  IF p_source_id IS NOT NULL THEN
    SELECT * INTO previous FROM product_print_plates WHERE tenant_id=t AND source_id=p_source_id AND plate_index=plate.plate_index AND is_active FOR UPDATE;
    IF FOUND AND previous.id IS DISTINCT FROM p_plate_id THEN
      IF p_plate_id IS NULL AND (previous.product_id,previous.label,previous.units_per_plate,previous.material_id,previous.printer_id,previous.est_grams,previous.est_time_seconds,previous.est_cost_per_unit)
        IS NOT DISTINCT FROM (p_product_id,btrim(plate.label),plate.units_per_plate,plate.material_id,plate.printer_id,plate.est_grams,plate.est_time_seconds,plate.est_cost_per_unit) THEN RETURN previous.id; END IF;
      RAISE EXCEPTION 'Esta fonte já possui essa placa ativa. Edite a placa existente em vez de duplicá-la.';
    END IF;
  END IF;
  IF p_plate_id IS NOT NULL THEN
    SELECT * INTO previous FROM product_print_plates WHERE id=p_plate_id AND product_id=p_product_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Placa não encontrada para este produto.'; END IF;
    IF EXISTS(SELECT 1 FROM jobs WHERE print_plate_id=p_plate_id AND inventory_posted_at IS NULL) THEN RAISE EXCEPTION 'Resolva as ordens pendentes da placa antes de alterar seu planejamento.'; END IF;
  END IF;
  INSERT INTO product_print_plates(id,tenant_id,product_id,source_id,plate_index,label,units_per_plate,material_id,printer_id,est_grams,est_time_seconds,est_cost_per_unit)
    VALUES(result,t,p_product_id,p_source_id,plate.plate_index,btrim(plate.label),plate.units_per_plate,plate.material_id,plate.printer_id,plate.est_grams,plate.est_time_seconds,plate.est_cost_per_unit)
    ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,plate_index=excluded.plate_index,label=excluded.label,units_per_plate=excluded.units_per_plate,
      material_id=excluded.material_id,printer_id=excluded.printer_id,est_grams=excluded.est_grams,est_time_seconds=excluded.est_time_seconds,est_cost_per_unit=excluded.est_cost_per_unit,updated_at=now();
  PERFORM erp_private.update_product_print_actuals(p_product_id);
  RETURN result;
END $$;

CREATE FUNCTION public.archive_product_print_plate(p_plate_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); plate product_print_plates;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO plate FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Placa não encontrada.'; END IF;
  PERFORM 1 FROM products WHERE id=plate.product_id FOR UPDATE;
  SELECT * INTO plate FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t FOR UPDATE;
  IF EXISTS(SELECT 1 FROM jobs WHERE print_plate_id=plate.id AND inventory_posted_at IS NULL)
    OR EXISTS(SELECT 1 FROM bambu_production_records WHERE plate_id=plate.id AND posted_at IS NULL) THEN RAISE EXCEPTION 'Resolva a produção pendente antes de arquivar a placa.'; END IF;
  UPDATE product_print_plates SET is_active=false,updated_at=now() WHERE id=plate.id;
  UPDATE bambu_production_profiles SET auto_enabled=false,updated_at=now() WHERE plate_id=plate.id;
  PERFORM erp_private.update_product_print_actuals(plate.product_id);
END $$;

CREATE FUNCTION public.bind_product_print_plate(p_plate_id uuid,p_task_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); plate product_print_plates; task bambu_tasks; source uuid; remote_index numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO plate FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t AND is_active FOR UPDATE;
  SELECT * INTO task FROM bambu_tasks WHERE id=p_task_id AND tenant_id=t;
  IF plate.id IS NULL OR task.id IS NULL OR erp_private.bambu_project_key(task.raw_data) IS NULL THEN RAISE EXCEPTION 'Selecione uma placa e tarefa da mesma empresa com modelo, perfil e placa identificados.'; END IF;
  remote_index:=(task.raw_data->>'plateIndex')::numeric;
  IF remote_index NOT BETWEEN 1 AND 10000 OR remote_index<>trunc(remote_index) THEN RAISE EXCEPTION 'Índice remoto da placa inválido. Não é possível inferir outra numeração.'; END IF;
  IF EXISTS(SELECT 1 FROM bambu_production_records WHERE task_id=task.id AND product_id IS NOT NULL AND product_id<>plate.product_id)
    OR EXISTS(SELECT 1 FROM jobs WHERE id=task.job_id AND product_id IS NOT NULL AND product_id<>plate.product_id) THEN RAISE EXCEPTION 'A tarefa já pertence a outro produto.'; END IF;
  -- An explicit plate choice resolves generic design/link matches. It cannot
  -- steal an exact model/profile/index already assigned to another SKU.
  IF EXISTS(SELECT 1 FROM product_print_sources s JOIN products p ON p.id=s.product_id AND p.tenant_id=s.tenant_id
    WHERE s.tenant_id=t AND s.is_active AND p.is_active AND s.product_id<>plate.product_id
      AND s.model_id=task.raw_data->>'modelId' AND s.profile_id=task.raw_data->>'profileId' AND s.plate_index=remote_index) THEN
    RAISE EXCEPTION 'Este arquivo/perfil/placa já pertence a outro produto. Resolva a associação exata.';
  END IF;
  IF EXISTS(SELECT 1 FROM product_print_plates WHERE tenant_id=t AND is_active AND id<>plate.id
    AND plate_index=remote_index AND ((model_id=task.raw_data->>'modelId' AND profile_id=task.raw_data->>'profileId') OR source_id=plate.source_id)) THEN RAISE EXCEPTION 'Este modelo, perfil e placa já estão vinculados. Resolva a associação ambígua.'; END IF;
  source:=plate.source_id;
  IF source IS NULL THEN
    source:=public.save_product_print_source(NULL,plate.product_id,jsonb_build_object('label',plate.label,'model_id',task.raw_data->>'modelId','profile_id',task.raw_data->>'profileId'));
  ELSIF NOT EXISTS(SELECT 1 FROM product_print_sources WHERE id=source AND product_id=plate.product_id AND tenant_id=t AND is_active) THEN
    RAISE EXCEPTION 'O arquivo/link da placa está arquivado ou não pertence a este produto.';
  END IF;
  -- The source describes a file/version that can contain several plates.
  -- Observed plate identity belongs here; binding the next plate must never
  -- replace the parent's identifiers with the last observed plate index.
  UPDATE product_print_plates SET source_id=source,model_id=task.raw_data->>'modelId',profile_id=task.raw_data->>'profileId',plate_index=remote_index::integer,updated_at=now() WHERE id=plate.id;
  RETURN plate.id;
END $$;

CREATE FUNCTION public.plan_product_plates(p_product_id uuid,p_quantity integer,p_request_id uuid) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; p products; plate product_print_plates; item inventory_items;
  results uuid[]; job uuid; run integer; runs integer; count_jobs integer:=0; material_cost numeric;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'plan_product_plates',jsonb_build_array(p_product_id,p_quantity));
  IF prior IS NOT NULL THEN SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO results FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id; RETURN results; END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe de 1 a 10000 unidades do produto.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO p FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um produto ativo.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.extras,'[]')) e WHERE e ? '_kit_product_id') THEN RAISE EXCEPTION 'Planeje os componentes do kit pelo pedido.'; END IF;
  PERFORM 1 FROM printers WHERE id IN(SELECT printer_id FROM product_print_plates WHERE product_id=p.id AND is_active) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM inventory_items WHERE id IN(SELECT material_id FROM product_print_plates WHERE product_id=p.id AND is_active) ORDER BY id FOR UPDATE;
  FOR plate IN SELECT * FROM product_print_plates WHERE product_id=p.id AND tenant_id=t AND is_active ORDER BY plate_index,id FOR UPDATE LOOP
    runs:=ceil(p_quantity::numeric/plate.units_per_plate); count_jobs:=count_jobs+runs;
    IF count_jobs>500 THEN RAISE EXCEPTION 'Máximo de 500 impressões por planejamento. Divida em lotes.'; END IF;
    IF plate.est_grams IS NULL OR plate.est_time_seconds IS NULL OR plate.est_time_seconds<=0 THEN RAISE EXCEPTION 'Complete peso e tempo de todas as placas antes de planejar.'; END IF;
    SELECT * INTO item FROM inventory_items WHERE id=plate.material_id AND tenant_id=t;
    IF plate.est_grams>0 AND (item.id IS NULL OR NOT item.is_active OR lower(btrim(item.unit)) NOT IN ('g','kg')) THEN RAISE EXCEPTION 'Identifique o material ativo de cada placa.'; END IF;
    IF plate.printer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers WHERE id=plate.printer_id AND tenant_id=t AND is_active AND status NOT IN ('maintenance','offline','error')) THEN RAISE EXCEPTION 'A impressora da placa está indisponível.'; END IF;
    material_cost:=CASE WHEN plate.est_grams=0 THEN 0 WHEN lower(btrim(item.unit))='kg' THEN plate.est_grams/1000*item.avg_cost*(1+coalesce(item.loss_coefficient,0)) ELSE plate.est_grams*item.avg_cost*(1+coalesce(item.loss_coefficient,0)) END;
    FOR run IN 1..runs LOOP
      job:=gen_random_uuid();
      INSERT INTO jobs(id,tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,printer_id,
        est_grams,est_time_minutes,est_material_cost,est_total_cost,sale_price,creation_request_id,created_by)
      VALUES(job,t,erp_private.next_code(t,'OI'),p.name||' · '||plate.label,
        'Placa '||plate.plate_index||' · impressão '||run||'/'||runs||' · lote completo de '||plate.units_per_plate||' peças'||
        CASE WHEN run=runs AND runs*plate.units_per_plate>p_quantity THEN ' · '||(runs*plate.units_per_plate-p_quantity)||' peças extras previstas' ELSE '' END,
        'queued',p.id,plate.id,plate.units_per_plate,plate.material_id,plate.printer_id,plate.est_grams,ceil(plate.est_time_seconds/60),round(material_cost,2),plate.est_cost_per_unit*plate.units_per_plate,NULL,p_request_id,auth.uid());
    END LOOP;
  END LOOP;
  IF count_jobs=0 THEN RAISE EXCEPTION 'Cadastre ao menos uma placa ativa para o produto.'; END IF;
  SELECT array_agg(id ORDER BY id) INTO results FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id;
  PERFORM erp_private.finish_request(t,p_request_id,results[1]); RETURN results;
END $$;

REVOKE ALL ON FUNCTION erp_private.update_product_print_actuals(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_product_print_plate(uuid,uuid,uuid,jsonb),public.archive_product_print_plate(uuid),
  public.bind_product_print_plate(uuid,uuid),public.plan_product_plates(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_print_plate(uuid,uuid,uuid,jsonb),public.archive_product_print_plate(uuid),
  public.bind_product_print_plate(uuid,uuid),public.plan_product_plates(uuid,integer,uuid) TO authenticated;

-- Keep plate identity and expected yield when the existing transition RPC
-- creates a reprint, without duplicating or modifying its accounting logic.
CREATE FUNCTION public.erp_job_plate_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent jobs; plate product_print_plates;
BEGIN
  IF TG_OP='INSERT' AND NEW.reprint_of IS NOT NULL THEN
    SELECT * INTO parent FROM jobs WHERE id=NEW.reprint_of AND tenant_id=NEW.tenant_id;
    NEW.print_plate_id:=parent.print_plate_id; NEW.planned_quantity:=parent.planned_quantity;
  END IF;
  IF NEW.print_plate_id IS NOT NULL THEN
    SELECT * INTO plate FROM product_print_plates WHERE id=NEW.print_plate_id AND tenant_id=NEW.tenant_id;
    IF NOT FOUND OR plate.product_id IS DISTINCT FROM NEW.product_id THEN RAISE EXCEPTION 'A placa da ordem deve pertencer ao mesmo produto e empresa.'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_job_plate_identity BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_job_plate_identity();
REVOKE ALL ON FUNCTION public.erp_job_plate_identity() FROM PUBLIC,anon,authenticated;

-- Return physical jobs for a leaf product; legacy products keep one row/unit.
CREATE FUNCTION erp_private.plate_job_plan(p_product uuid,p_tenant uuid,p_quantity integer)
RETURNS TABLE(plate_id uuid,label text,material_id uuid,printer_id uuid,grams numeric,minutes integer,quantity integer,cost numeric,extras numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE p products; pl product_print_plates; run integer; runs integer; emitted integer:=0;
BEGIN
  SELECT * INTO p FROM products WHERE id=p_product AND tenant_id=p_tenant AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto ou componente inativo.'; END IF;
  IF EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=p.id AND tenant_id=p_tenant AND is_active) THEN
    FOR pl IN SELECT * FROM product_print_plates WHERE product_id=p.id AND tenant_id=p_tenant AND is_active ORDER BY plate_index,id LOOP
      runs:=ceil(p_quantity::numeric/pl.units_per_plate); emitted:=emitted+runs;
      IF emitted>500 THEN RAISE EXCEPTION 'Máximo de 500 ordens por item. Divida o pedido em lotes.'; END IF;
      IF pl.est_grams IS NULL OR pl.est_time_seconds IS NULL OR pl.est_time_seconds<=0 THEN RAISE EXCEPTION 'Complete peso e tempo de todas as placas antes de produzir.'; END IF;
      IF pl.est_grams>0 AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=pl.material_id AND i.tenant_id=p_tenant AND i.is_active AND lower(btrim(i.unit)) IN ('g','kg')) THEN RAISE EXCEPTION 'Identifique o material ativo de cada placa.'; END IF;
      IF pl.printer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers pr WHERE pr.id=pl.printer_id AND pr.tenant_id=p_tenant AND pr.is_active AND pr.status NOT IN ('maintenance','offline','error')) THEN RAISE EXCEPTION 'A impressora da placa está indisponível.'; END IF;
      FOR run IN 1..runs LOOP
        plate_id:=pl.id; label:=pl.label||' · impressão '||run||'/'||runs||' · lote completo de '||pl.units_per_plate||' peças'||
          CASE WHEN run=runs AND runs*pl.units_per_plate>p_quantity THEN ' · '||(runs*pl.units_per_plate-p_quantity)||' peças extras previstas' ELSE '' END;
        material_id:=pl.material_id;printer_id:=pl.printer_id;grams:=pl.est_grams;minutes:=ceil(pl.est_time_seconds/60);
        quantity:=pl.units_per_plate;cost:=pl.est_cost_per_unit*pl.units_per_plate;extras:=NULL;RETURN NEXT;
      END LOOP;
    END LOOP;
  ELSE
    IF p_quantity>500 THEN RAISE EXCEPTION 'Máximo de 500 ordens por item. Divida o pedido em lotes.'; END IF;
    FOR run IN 1..p_quantity LOOP
      plate_id:=NULL;label:='peça '||run||'/'||p_quantity;material_id:=p.material_id;printer_id:=NULL;
      grams:=coalesce(p.est_grams,0)/greatest(coalesce(p.prints_per_plate,1),1);
      minutes:=greatest(1,ceil(coalesce(p.est_time_minutes,0)::numeric/greatest(coalesce(p.prints_per_plate,1),1)));
      quantity:=1;cost:=p.cost_estimate;extras:=erp_private.product_extras(p.id,p_tenant);RETURN NEXT;
    END LOOP;
  END IF;
END $$;

-- Preserve approval, cancellation and readiness behavior. The previous entry
-- point becomes private so callers cannot bypass multi-plate planning.
ALTER FUNCTION public.transition_sales_order(uuid,text) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.transition_sales_order(uuid,text) RENAME TO transition_sales_order_legacy;
REVOKE ALL ON FUNCTION erp_private.transition_sales_order_legacy(uuid,text),erp_private.plate_job_plan(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.transition_sales_order(p_order_id uuid,p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); o orders; item order_items; plan record; material inventory_items;
  subtotal numeric; line_revenue numeric; cumulative_lines numeric:=0; order_allocated numeric:=0;
  line_cost numeric; line_count integer; all_costs boolean; weight numeric; allocated numeric; revenue numeric;
  idx integer; job uuid; material_cost numeric; leaf_extra numeric; kit_extra numeric;
BEGIN
  IF p_status IS DISTINCT FROM 'in_production' OR NOT EXISTS(
    SELECT 1 FROM order_items oi CROSS JOIN LATERAL erp_private.components(oi.product_id,t,oi.quantity) c
      JOIN product_print_plates pl ON pl.product_id=c.product_id AND pl.tenant_id=t AND pl.is_active WHERE oi.order_id=p_order_id AND oi.tenant_id=t
  ) THEN RETURN erp_private.transition_sales_order_legacy(p_order_id,p_status); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status='in_production' THEN RETURN o.id; END IF;
  IF o.status<>'approved' THEN RAISE EXCEPTION 'Transição do pedido não permitida.'; END IF;
  IF EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) THEN RAISE EXCEPTION 'Pedido já possui produção vinculada. Confira as ordens existentes.'; END IF;
  PERFORM 1 FROM products WHERE id IN(SELECT c.product_id FROM order_items oi CROSS JOIN LATERAL erp_private.components(oi.product_id,t,oi.quantity) c WHERE oi.order_id=o.id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM product_print_plates WHERE product_id IN(SELECT c.product_id FROM order_items oi CROSS JOIN LATERAL erp_private.components(oi.product_id,t,oi.quantity) c WHERE oi.order_id=o.id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM printers WHERE id IN(SELECT pl.printer_id FROM product_print_plates pl JOIN products p ON p.id=pl.product_id WHERE p.tenant_id=t AND pl.is_active) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM inventory_items WHERE id IN(SELECT pl.material_id FROM product_print_plates pl JOIN products p ON p.id=pl.product_id WHERE p.tenant_id=t AND pl.is_active) ORDER BY id FOR UPDATE;
  SELECT sum(total) INTO subtotal FROM order_items WHERE order_id=o.id;
  FOR item IN SELECT * FROM order_items WHERE order_id=o.id ORDER BY id LOOP
    IF item.product_id IS NULL THEN RAISE EXCEPTION 'Vincule o produto antes de produzir.'; END IF;
    SELECT count(*)::integer,sum(jp.cost),bool_and(jp.cost IS NOT NULL) INTO line_count,line_cost,all_costs
      FROM erp_private.components(item.product_id,t,item.quantity) c CROSS JOIN LATERAL erp_private.plate_job_plan(c.product_id,t,c.quantity) jp;
    IF line_count NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Máximo de 500 ordens por item. Divida o pedido em lotes.'; END IF;
    SELECT coalesce(sum(erp_private.product_extras(c.product_id,t)*c.quantity),0) INTO leaf_extra FROM erp_private.components(item.product_id,t,item.quantity) c;
    kit_extra:=greatest(0,erp_private.product_extras(item.product_id,t)*item.quantity-leaf_extra);
    cumulative_lines:=cumulative_lines+item.total;
    line_revenue:=CASE WHEN subtotal>0 THEN round((subtotal-o.discount)*cumulative_lines/subtotal,2)-order_allocated ELSE 0 END;
    order_allocated:=order_allocated+line_revenue;idx:=0;weight:=0;allocated:=0;
    FOR plan IN SELECT c.product_id,p.name,p.num_colors,jp.* FROM erp_private.components(item.product_id,t,item.quantity) c
      JOIN products p ON p.id=c.product_id CROSS JOIN LATERAL erp_private.plate_job_plan(c.product_id,t,c.quantity) jp
      ORDER BY c.product_id,jp.plate_id NULLS LAST,jp.label LOOP
      idx:=idx+1;job:=gen_random_uuid();
      weight:=weight+CASE WHEN all_costs AND line_cost>0 THEN plan.cost/line_cost ELSE 1::numeric/line_count END;
      revenue:=CASE WHEN idx=line_count THEN line_revenue-allocated ELSE round(line_revenue*weight,2)-allocated END;allocated:=allocated+revenue;
      SELECT * INTO material FROM inventory_items WHERE id=plan.material_id AND tenant_id=t;
      material_cost:=CASE WHEN plan.grams=0 THEN 0 WHEN lower(btrim(material.unit))='kg' THEN plan.grams/1000*material.avg_cost*(1+coalesce(material.loss_coefficient,0))
        WHEN lower(btrim(material.unit))='g' THEN plan.grams*material.avg_cost*(1+coalesce(material.loss_coefficient,0)) ELSE NULL END;
      INSERT INTO jobs(id,tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,printer_id,
        order_id,order_item_id,order_unit_index,est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,due_date,num_colors,created_by)
      VALUES(job,t,erp_private.next_code(t,'OI'),plan.name,'Pedido '||o.code||' · '||plan.label,'queued',plan.product_id,plan.plate_id,plan.quantity,plan.material_id,plan.printer_id,
        o.id,item.id,idx,plan.grams,plan.minutes,round(material_cost,2),plan.cost+kit_extra/line_count,plan.extras+kit_extra/line_count,revenue,o.due_date,plan.num_colors,auth.uid());
    END LOOP;
  END LOOP;
  UPDATE orders SET status='in_production' WHERE id=o.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'transition','orders',o.id,jsonb_build_object('from',o.status,'to','in_production','planning','physical_plates'));
  RETURN o.id;
END $$;
REVOKE ALL ON FUNCTION public.transition_sales_order(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_sales_order(uuid,text) TO authenticated;

-- Product forms may submit legacy single-plate estimates. Preserve the atomic
-- product/photo save and its request identity, then rebuild a plated SKU from
-- its physical plates inside the same transaction.
ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_with_photos_legacy;
REVOKE ALL ON FUNCTION erp_private.save_product_with_photos_legacy(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
  result:=erp_private.save_product_with_photos_legacy(p_product_id,p_product,p_photos,p_request_id);
  IF EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=result AND is_active) THEN
    PERFORM erp_private.update_product_print_actuals(result);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

-- Append plate context without changing the existing review view contract.
CREATE OR REPLACE VIEW public.bambu_production_review WITH(security_invoker=true) AS
  SELECT b.id AS task_id,b.tenant_id,b.bambu_task_id,b.design_title,d.name AS device_name,b.start_time AS started_at,b.end_time AS ended_at,b.status AS raw_status,
    CASE b.status WHEN '2' THEN 'completed' WHEN '3' THEN 'failed' WHEN '1' THEN 'printing' WHEN '4' THEN 'printing' ELSE 'unknown' END AS outcome,
    coalesce(r.state,'unlinked') AS state,r.problem,b.weight_grams AS planned_grams,
    CASE WHEN b.status IN ('2','3') AND b.end_time>b.start_time AND b.end_time-b.start_time<=interval '60 days' THEN extract(epoch FROM b.end_time-b.start_time) END AS elapsed_seconds,
    r.posted_at,r.total_cost,r.product_id,p.name AS product_name,r.units,r.consumption_source,coalesce(r.auto_enabled,false) AS auto_enabled,
    CASE WHEN r.posted_at IS NOT NULL AND r.outcome='completed' THEN r.units ELSE 0 END AS completed_units,
    r.plate_id,pl.label AS plate_label,pl.plate_index
  FROM bambu_tasks b LEFT JOIN bambu_devices d ON d.id=b.bambu_device_id AND d.tenant_id=b.tenant_id
    LEFT JOIN bambu_production_records r ON r.task_id=b.id AND r.tenant_id=b.tenant_id LEFT JOIN products p ON p.id=r.product_id AND p.tenant_id=b.tenant_id
    LEFT JOIN product_print_plates pl ON pl.id=r.plate_id AND pl.tenant_id=b.tenant_id;
REVOKE ALL ON public.bambu_production_review FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bambu_production_review TO authenticated;
