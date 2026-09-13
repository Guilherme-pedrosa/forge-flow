-- Manual planning uses one durable request for the entire batch. Retrying a
-- response lost on a mobile connection must never create another print run.
ALTER TABLE public.jobs ADD COLUMN creation_request_id uuid;
CREATE INDEX jobs_creation_request_idx ON public.jobs(tenant_id,creation_request_id)
  WHERE creation_request_id IS NOT NULL;

CREATE FUNCTION public.create_jobs(p_jobs jsonb,p_request_id uuid) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  t uuid:=erp_private.actor(); previous uuid; result uuid[]; line jsonb; field text;
  n numeric; j jobs; product products; machine printers; material inventory_items;
  allowed_fields constant text[]:=ARRAY[
    'name','description','status','product_id','material_id','secondary_material_id',
    'printer_id','due_date','priority','num_colors','purge_waste_grams','est_grams',
    'est_time_minutes','est_material_cost','est_energy_cost','est_machine_cost',
    'est_labor_cost','est_overhead','est_extras_cost','est_total_cost','sale_price'
  ];
BEGIN
  IF p_jobs IS NULL OR jsonb_typeof(p_jobs)<>'array' THEN
    RAISE EXCEPTION 'Envie uma lista de ordens de impressão.';
  END IF;
  IF jsonb_array_length(p_jobs) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Crie entre 1 e 100 ordens por operação.';
  END IF;
  previous:=erp_private.begin_request(t,p_request_id,'create_jobs',p_jobs);
  IF previous IS NOT NULL THEN
    SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO result
      FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id;
    RETURN result;
  END IF;

  -- Reject the entire request before writing any row. A caller cannot inject
  -- ownership, codes, order links, consumption or actual costs into a draft.
  FOR line IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
    IF jsonb_typeof(line)<>'object' THEN RAISE EXCEPTION 'Cada ordem deve ser um objeto.'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(line) k WHERE NOT k=ANY(allowed_fields)) THEN
      RAISE EXCEPTION 'A ordem contém campos não permitidos.';
    END IF;
    IF jsonb_typeof(line->'name') IS DISTINCT FROM 'string' OR nullif(btrim(line->>'name'),'') IS NULL THEN
      RAISE EXCEPTION 'Informe o nome da ordem de impressão.';
    END IF;
    IF line ? 'description' AND line->'description'<>'null'::jsonb AND jsonb_typeof(line->'description')<>'string' THEN
      RAISE EXCEPTION 'A descrição da ordem deve ser um texto.';
    END IF;
    IF coalesce(line->>'status','draft') NOT IN ('draft','queued') THEN
      RAISE EXCEPTION 'Uma nova ordem deve começar como rascunho ou na fila.';
    END IF;
    FOREACH field IN ARRAY ARRAY['priority','num_colors','purge_waste_grams','est_grams',
      'est_time_minutes','est_material_cost','est_energy_cost','est_machine_cost',
      'est_labor_cost','est_overhead','est_extras_cost','est_total_cost','sale_price'] LOOP
      IF line ? field AND line->field<>'null'::jsonb THEN
        IF jsonb_typeof(line->field)<>'number' THEN RAISE EXCEPTION 'O campo % deve ser um número válido.',field; END IF;
        n:=(line->>field)::numeric;
        IF NOT erp_private.valid_number(n) THEN RAISE EXCEPTION 'O campo % deve ser finito e não negativo.',field; END IF;
        IF field IN ('priority','num_colors','est_time_minutes') AND n<>trunc(n) THEN
          RAISE EXCEPTION 'Prioridade, cores e minutos devem ser inteiros.';
        END IF;
      END IF;
    END LOOP;
    IF coalesce((line->>'priority')::numeric,5) NOT BETWEEN 1 AND 10
      OR coalesce((line->>'num_colors')::numeric,1) NOT BETWEEN 1 AND 64 THEN
      RAISE EXCEPTION 'Prioridade deve estar entre 1 e 10; quantidade de cores, entre 1 e 64.';
    END IF;
  END LOOP;

  -- Consistent row-lock order also serializes planning against archiving a
  -- product, printer or material while another device is creating the batch.
  PERFORM 1 FROM products WHERE tenant_id=t AND id IN (
    SELECT (value->>'product_id')::uuid FROM jsonb_array_elements(p_jobs)
  ) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM printers WHERE tenant_id=t AND id IN (
    SELECT (value->>'printer_id')::uuid FROM jsonb_array_elements(p_jobs)
  ) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM inventory_items WHERE tenant_id=t AND id IN (
    SELECT (value->>'material_id')::uuid FROM jsonb_array_elements(p_jobs)
    UNION SELECT (value->>'secondary_material_id')::uuid FROM jsonb_array_elements(p_jobs)
  ) ORDER BY id FOR UPDATE;

  FOR line IN SELECT value FROM jsonb_array_elements(p_jobs) LOOP
    j:=NULL;
    j.id:=gen_random_uuid(); j.name:=btrim(line->>'name'); j.description:=nullif(btrim(line->>'description'),'');
    j.status:=coalesce(line->>'status','draft')::job_status;
    j.product_id:=(line->>'product_id')::uuid; j.printer_id:=(line->>'printer_id')::uuid;
    j.material_id:=(line->>'material_id')::uuid; j.secondary_material_id:=(line->>'secondary_material_id')::uuid;
    IF j.product_id IS NOT NULL THEN
      SELECT * INTO product FROM products WHERE id=j.product_id AND tenant_id=t;
      IF NOT FOUND OR NOT product.is_active THEN RAISE EXCEPTION 'Selecione um produto ativo da sua empresa.'; END IF;
      IF product.category='kit' THEN RAISE EXCEPTION 'Crie um pedido para o kit; os componentes serão planejados separadamente.'; END IF;
    END IF;
    IF j.printer_id IS NOT NULL THEN
      SELECT * INTO machine FROM printers WHERE id=j.printer_id AND tenant_id=t;
      IF NOT FOUND OR NOT machine.is_active OR machine.status IN ('maintenance','offline','error') THEN
        RAISE EXCEPTION 'Selecione uma impressora ativa e disponível da sua empresa.';
      END IF;
    END IF;
    FOR material IN SELECT * FROM inventory_items WHERE id IN (j.material_id,j.secondary_material_id) AND tenant_id=t LOOP
      IF NOT material.is_active OR lower(btrim(material.unit)) NOT IN ('g','kg') THEN
        RAISE EXCEPTION 'O filamento deve estar ativo e cadastrado em gramas ou quilogramas.';
      END IF;
    END LOOP;
    PERFORM erp_private.assert_ref('inventory_items',j.material_id,t);
    PERFORM erp_private.assert_ref('inventory_items',j.secondary_material_id,t);

    INSERT INTO jobs(id,tenant_id,code,name,description,status,product_id,printer_id,
      material_id,secondary_material_id,due_date,priority,num_colors,purge_waste_grams,
      est_grams,est_time_minutes,est_material_cost,est_energy_cost,est_machine_cost,
      est_labor_cost,est_overhead,est_extras_cost,est_total_cost,sale_price,created_by,creation_request_id)
    VALUES(j.id,t,erp_private.next_code(t,'OI'),j.name,j.description,j.status,j.product_id,j.printer_id,
      j.material_id,j.secondary_material_id,nullif(line->>'due_date','')::date,
      coalesce((line->>'priority')::numeric::integer,5),coalesce((line->>'num_colors')::numeric::integer,1),
      coalesce((line->>'purge_waste_grams')::numeric,0),(line->>'est_grams')::numeric,(line->>'est_time_minutes')::numeric::integer,
      (line->>'est_material_cost')::numeric,(line->>'est_energy_cost')::numeric,(line->>'est_machine_cost')::numeric,
      (line->>'est_labor_cost')::numeric,(line->>'est_overhead')::numeric,(line->>'est_extras_cost')::numeric,
      (line->>'est_total_cost')::numeric,(line->>'sale_price')::numeric,auth.uid(),p_request_id);
  END LOOP;
  SELECT array_agg(id ORDER BY id) INTO result FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id;
  PERFORM erp_private.finish_request(t,p_request_id,result[1]);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_jobs(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_jobs(jsonb,uuid) TO authenticated;
DROP POLICY IF EXISTS j_i ON public.jobs;

CREATE FUNCTION public.erp_guard_archive_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    IF TG_TABLE_NAME='printers' AND EXISTS(
      SELECT 1 FROM jobs WHERE printer_id=OLD.id AND status IN
        ('queued','printing','paused','reprint','post_processing','quality_check')
    ) THEN RAISE EXCEPTION 'Realoque ou finalize as ordens ativas antes de arquivar a impressora.'; END IF;
    IF TG_TABLE_NAME='products' AND EXISTS(
      SELECT 1 FROM consignment_items WHERE product_id=OLD.id AND current_qty>0
    ) THEN RAISE EXCEPTION 'Recolha ou venda o saldo consignado antes de arquivar o produto.'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_printer_archive_guard BEFORE UPDATE OF is_active ON public.printers
  FOR EACH ROW EXECUTE FUNCTION public.erp_guard_archive_allocation();
CREATE TRIGGER erp_product_archive_guard BEFORE UPDATE OF is_active ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.erp_guard_archive_allocation();
