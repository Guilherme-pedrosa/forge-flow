-- A production order retains the approved recipe and exact file version.
-- This is preparation and traceability; no function sends printer commands.
ALTER TABLE public.jobs
  ADD COLUMN production_snapshot jsonb,
  ADD COLUMN production_snapshot_origin text,
  ADD COLUMN production_snapshot_at timestamptz,
  ADD COLUMN print_file_snapshot jsonb;

CREATE FUNCTION erp_private.bom_leaf_snapshot(p_snapshot jsonb,p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE child jsonb; result jsonb;
BEGIN
  IF p_snapshot->'product'->>'id'=p_product_id::text THEN RETURN p_snapshot; END IF;
  FOR child IN SELECT value FROM jsonb_array_elements(coalesce(p_snapshot->'components','[]')) LOOP
    result:=erp_private.bom_leaf_snapshot(child->'snapshot',p_product_id);
    IF result IS NOT NULL THEN RETURN result; END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION erp_private.job_default_print_file(p_snapshot jsonb,p_plate_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE plate jsonb; candidate jsonb; matches integer;
BEGIN
  IF p_plate_id IS NOT NULL THEN
    SELECT value INTO plate FROM jsonb_array_elements(coalesce(p_snapshot->'plates','[]')) WHERE value->>'id'=p_plate_id::text;
  END IF;
  SELECT count(*),jsonb_agg(value)->0 INTO matches,candidate
    FROM jsonb_array_elements(coalesce(p_snapshot->'sources','[]'))
    WHERE nullif(value->>'file_path','') IS NOT NULL
      AND (p_plate_id IS NULL OR value->>'id'=plate->>'source_id');
  IF matches<>1 THEN RETURN NULL; END IF;
  RETURN candidate||jsonb_build_object('origin','recipe_snapshot','captured_at',now(),
    'plate_id',p_plate_id,'plate_index',plate->'plate_index','printer_profile_verified',false);
END $$;

CREATE FUNCTION public.erp_job_production_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent jobs; frozen jsonb; plate jsonb; recipe jsonb; expected uuid[]; supplied uuid[];
  line jsonb; item inventory_items; next_machine printers; material_total numeric; grams_total numeric;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.reprint_of IS NOT NULL THEN
      SELECT * INTO parent FROM jobs WHERE id=NEW.reprint_of AND tenant_id=NEW.tenant_id;
      NEW.production_snapshot:=parent.production_snapshot;
      NEW.production_snapshot_origin:='reprint'; NEW.production_snapshot_at:=parent.production_snapshot_at;
      NEW.print_file_snapshot:=parent.print_file_snapshot;
      RETURN NEW;
    END IF;
    IF NEW.production_snapshot IS NULL AND NEW.order_item_id IS NOT NULL THEN
      SELECT product_snapshot INTO frozen FROM order_items WHERE id=NEW.order_item_id AND tenant_id=NEW.tenant_id;
      NEW.production_snapshot:=erp_private.bom_leaf_snapshot(frozen,NEW.product_id);
      IF frozen IS NOT NULL AND NEW.production_snapshot IS NULL THEN RAISE EXCEPTION 'O produto da ordem não pertence à receita aprovada.'; END IF;
      IF NEW.production_snapshot IS NOT NULL THEN NEW.production_snapshot_origin:='approved_order'; END IF;
    END IF;
    IF NEW.production_snapshot IS NULL AND NEW.product_id IS NOT NULL THEN
      NEW.production_snapshot:=erp_private.product_bom_snapshot(NEW.product_id,NEW.tenant_id);
      NEW.production_snapshot_origin:='catalog';
      IF NEW.order_item_id IS NULL AND NEW.print_plate_id IS NULL AND NEW.status IN ('draft','queued') THEN
        NEW.planned_quantity:=greatest(1,coalesce((NEW.production_snapshot->'product'->>'prints_per_plate')::integer,1));
      END IF;
    END IF;
    IF NEW.production_snapshot IS NOT NULL THEN
      IF NEW.production_snapshot->'product'->>'id' IS DISTINCT FROM NEW.product_id::text THEN RAISE EXCEPTION 'Receita e produto da ordem não correspondem.'; END IF;
      NEW.production_snapshot_at:=now();
      NEW.production_snapshot_origin:=coalesce(NEW.production_snapshot_origin,CASE WHEN NEW.order_item_id IS NOT NULL THEN 'approved_order' ELSE 'catalog' END);
      NEW.print_file_snapshot:=erp_private.job_default_print_file(NEW.production_snapshot,NEW.print_plate_id);
      IF NEW.print_plate_id IS NOT NULL THEN
        SELECT value INTO plate FROM jsonb_array_elements(coalesce(NEW.production_snapshot->'plates','[]')) WHERE value->>'id'=NEW.print_plate_id::text;
        IF plate IS NULL THEN RAISE EXCEPTION 'A placa não pertence à receita preservada da ordem.'; END IF;
      END IF;
      recipe:=CASE WHEN NEW.print_plate_id IS NULL THEN NEW.production_snapshot->'recipe' ELSE plate->'recipe' END;
      -- Historical Bambu observations and approved-order estimates are handled by
      -- their own accounting/planning RPCs. New manual work uses the exact BOM.
      IF NEW.production_snapshot_origin='catalog' AND NEW.status IN ('draft','queued') AND recipe IS NOT NULL AND recipe<>'null'::jsonb THEN
        IF NOT coalesce((recipe->>'complete')::boolean,false) THEN RAISE EXCEPTION 'Complete a composição de materiais, cores e custos antes de criar a ordem.'; END IF;
        SELECT sum((x->>'grams_per_unit')::numeric)*NEW.planned_quantity,
          sum((x->>'cost_per_unit')::numeric)*NEW.planned_quantity,
          array_agg((x->>'item_id')::uuid ORDER BY x->>'item_id')
          INTO grams_total,material_total,expected FROM jsonb_array_elements(recipe->'lines') x;
        NEW.est_grams:=grams_total; NEW.est_material_cost:=round(material_total,2);
        NEW.est_total_cost:=round((recipe->>'cost_per_unit')::numeric*NEW.planned_quantity,2);
        NEW.material_id:=expected[1]; NEW.secondary_material_id:=expected[2]; NEW.num_colors:=cardinality(expected);
        -- Recipe non-material cost is an explicitly confirmed aggregate. Do not
        -- present stale catalogue components as if they reconciled to that total.
        NEW.est_energy_cost:=NULL; NEW.est_machine_cost:=NULL; NEW.est_labor_cost:=NULL;
        NEW.est_overhead:=NULL; NEW.est_extras_cost:=NULL;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.production_snapshot,NEW.production_snapshot_origin,NEW.production_snapshot_at) IS DISTINCT FROM
      (OLD.production_snapshot,OLD.production_snapshot_origin,OLD.production_snapshot_at) THEN
    RAISE EXCEPTION 'A receita da ordem é imutável. Crie uma nova revisão de produção.';
  END IF;
  IF OLD.production_snapshot IS NOT NULL AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'O produto faz parte da receita preservada. Crie outra ordem para trocar o produto.';
  END IF;
  IF OLD.production_snapshot IS NOT NULL AND (NEW.status='printing' AND OLD.status IS DISTINCT FROM NEW.status
      OR NEW.inventory_posted_at IS NOT NULL AND OLD.inventory_posted_at IS NULL
      OR (NEW.material_id,NEW.secondary_material_id) IS DISTINCT FROM (OLD.material_id,OLD.secondary_material_id)) THEN
    SELECT array_agg(DISTINCT (x->>'item_id')::uuid ORDER BY (x->>'item_id')::uuid) INTO expected
      FROM jsonb_array_elements(coalesce(OLD.production_snapshot->'requirements','[]')) x
      WHERE (NEW.print_plate_id IS NULL AND nullif(x->>'plate_id','') IS NULL) OR x->>'plate_id'=NEW.print_plate_id::text;
    IF cardinality(expected)>0 THEN
      IF NEW.inventory_posted_at IS NOT NULL AND OLD.inventory_posted_at IS NULL AND jsonb_typeof(NEW.actual_material_usage)='array' THEN
        SELECT array_agg(DISTINCT (x->>'item_id')::uuid ORDER BY (x->>'item_id')::uuid) INTO supplied FROM jsonb_array_elements(NEW.actual_material_usage) x;
        IF supplied IS DISTINCT FROM expected THEN RAISE EXCEPTION 'O consumo apurado deve identificar todos e somente os materiais e cores da receita preservada.'; END IF;
      ELSIF cardinality(expected)>2 AND NEW.inventory_posted_at IS NOT NULL AND OLD.inventory_posted_at IS NULL THEN
        RAISE EXCEPTION 'Esta receita possui três ou mais materiais. Apure o consumo completo pela integração Bambu; a conclusão manual aceita no máximo dois materiais.';
      ELSIF cardinality(expected)<=2 THEN
        SELECT array_agg(DISTINCT x ORDER BY x) INTO supplied FROM unnest(ARRAY[NEW.material_id,NEW.secondary_material_id]) x WHERE x IS NOT NULL;
        IF supplied IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Os materiais principal e secundário devem corresponder à receita preservada, sem trocar material ou cor.'; END IF;
      END IF;
      FOR line IN SELECT x FROM jsonb_array_elements(OLD.production_snapshot->'requirements') x
        WHERE (NEW.print_plate_id IS NULL AND nullif(x->>'plate_id','') IS NULL) OR x->>'plate_id'=NEW.print_plate_id::text LOOP
        SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=NEW.tenant_id;
        IF item.id IS NULL OR NOT item.is_active OR lower(btrim(item.unit)) NOT IN ('g','kg')
          OR (item.material_code,item.color_code,item.color_hex,lower(item.color)) IS DISTINCT FROM
             (line->>'material_code',line->>'color_code',line->>'color_hex',lower(line->>'color')) THEN
          RAISE EXCEPTION 'A identidade ou disponibilidade de um material da receita mudou. Revise a produção sem substituir a cor aprovada.';
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF NEW.print_file_snapshot IS DISTINCT FROM OLD.print_file_snapshot AND
    (current_user IN ('authenticated','anon') OR OLD.started_at IS NOT NULL OR OLD.inventory_posted_at IS NOT NULL OR OLD.status NOT IN ('draft','queued','reprint')) THEN
    RAISE EXCEPTION 'Use a preparação da ordem antes de iniciar a impressão para definir o arquivo.';
  END IF;
  IF NEW.printer_id IS DISTINCT FROM OLD.printer_id AND NEW.printer_id IS NOT NULL AND OLD.print_file_snapshot IS NOT NULL THEN
    SELECT * INTO next_machine FROM printers WHERE id=NEW.printer_id AND tenant_id=NEW.tenant_id;
    IF NOT FOUND OR NOT next_machine.is_active OR next_machine.status IN ('maintenance','offline','error') THEN RAISE EXCEPTION 'Selecione uma impressora ativa e disponível.'; END IF;
    IF nullif(OLD.print_file_snapshot->>'printer_model','') IS NOT NULL
      AND next_machine.model IS DISTINCT FROM OLD.print_file_snapshot->>'printer_model' THEN
      RAISE EXCEPTION 'O arquivo está associado ao modelo %. Prepare uma versão compatível antes de trocar de modelo.',OLD.print_file_snapshot->>'printer_model';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_job_production_snapshot BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_job_production_snapshot();

CREATE FUNCTION public.job_production_review(p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); j jobs; plate jsonb; sources jsonb; requirements jsonb:='[]'; line jsonb;
  item inventory_items; machine printers; issues jsonb:='[]'; need numeric; stock_grams numeric; selected_file jsonb;
BEGIN
  SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem não encontrada.'; END IF;
  SELECT value INTO plate FROM jsonb_array_elements(coalesce(j.production_snapshot->'plates','[]')) WHERE value->>'id'=j.print_plate_id::text;
  selected_file:=j.print_file_snapshot;
  IF j.production_snapshot IS NULL THEN issues:=issues||jsonb_build_array('Esta ordem antiga não possui receita congelada. Confira o cadastro antes de preparar uma nova ordem.'); END IF;
  SELECT coalesce(jsonb_agg(value||jsonb_build_object('origin','recipe_snapshot')),'[]') INTO sources
    FROM jsonb_array_elements(coalesce(j.production_snapshot->'sources','[]'))
    WHERE nullif(value->>'file_path','') IS NOT NULL AND (j.print_plate_id IS NULL OR value->>'id'=plate->>'source_id');
  IF jsonb_array_length(sources)=0 AND j.product_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('origin','file_added_after_recipe')),'[]') INTO sources
      FROM product_print_sources s WHERE s.tenant_id=t AND s.product_id=j.product_id AND s.is_active AND s.file_path IS NOT NULL
        AND (j.print_plate_id IS NULL OR plate->>'source_id' IS NULL OR s.id::text=plate->>'source_id');
  END IF;
  IF selected_file IS NULL THEN issues:=issues||jsonb_build_array('Selecione o arquivo desta placa.');
  ELSIF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='attachments' AND name=selected_file->>'file_path') THEN
    issues:=issues||jsonb_build_array('O arquivo preservado não está disponível no armazenamento.');
  END IF;
  SELECT * INTO machine FROM printers WHERE id=j.printer_id AND tenant_id=t;
  IF NOT FOUND OR NOT machine.is_active OR machine.status IN ('maintenance','offline','error') THEN issues:=issues||jsonb_build_array('Atribua uma impressora ativa e disponível.'); END IF;
  IF nullif(selected_file->>'printer_model','') IS NOT NULL AND machine.model IS DISTINCT FROM selected_file->>'printer_model' THEN
    issues:=issues||jsonb_build_array('O modelo da impressora difere da preparação do arquivo.');
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(coalesce(j.production_snapshot->'requirements','[]'))
    WHERE (j.print_plate_id IS NULL AND nullif(value->>'plate_id','') IS NULL) OR value->>'plate_id'=j.print_plate_id::text LOOP
    need:=(line->>'grams_per_unit')::numeric*j.planned_quantity;
    SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=t;
    stock_grams:=CASE WHEN lower(btrim(item.unit))='kg' THEN item.current_stock*1000 ELSE item.current_stock END;
    requirements:=requirements||jsonb_build_array(line||jsonb_build_object('required_grams',need,'current_stock_grams',stock_grams,
      'is_active',coalesce(item.is_active,false),'current_name',item.name,'current_color',item.color));
    IF item.id IS NULL OR NOT item.is_active OR lower(btrim(item.unit)) NOT IN ('g','kg') THEN
      issues:=issues||jsonb_build_array('Material da receita inativo ou indisponível: '||coalesce(line->>'name','item sem nome'));
    ELSIF (item.material_code,item.color_code,item.color_hex,lower(item.color)) IS DISTINCT FROM
        (line->>'material_code',line->>'color_code',line->>'color_hex',lower(line->>'color')) THEN
      issues:=issues||jsonb_build_array('A identidade atual difere do material/cor aprovado: '||coalesce(line->>'name',item.name));
    ELSIF need IS NULL OR stock_grams<need THEN
      issues:=issues||jsonb_build_array('Saldo insuficiente para o material exato: '||coalesce(line->>'name',item.name));
    END IF;
  END LOOP;
  IF jsonb_array_length(requirements)=0 THEN issues:=issues||jsonb_build_array('Complete a receita de materiais e cores antes de preparar uma nova ordem.'); END IF;
  RETURN jsonb_build_object('job_id',j.id,'code',j.code,'status',j.status,'product_id',j.product_id,'planned_quantity',j.planned_quantity,
    'origin',j.production_snapshot_origin,'captured_at',j.production_snapshot_at,'file',selected_file,'file_options',sources,'plate',plate,
    'requirements',requirements,'issues',issues,'preparation_ready',jsonb_array_length(issues)=0,
    'manual_accounting_supported',jsonb_array_length(requirements)<=2,
    'dispatch_available',false,'printer',CASE WHEN machine.id IS NULL THEN NULL ELSE jsonb_build_object('id',machine.id,'name',machine.name,'model',machine.model,'status',machine.status) END,
    'can_prepare',j.status IN ('draft','queued','reprint') AND j.started_at IS NULL AND j.inventory_posted_at IS NULL,
    'est_total_cost',j.est_total_cost,'est_grams',j.est_grams,'est_time_minutes',j.est_time_minutes);
END $$;

CREATE FUNCTION public.prepare_job_print_file(p_job_id uuid,p_source_id uuid,p_printer_id uuid,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); previous uuid; j jobs; review jsonb; selected_file jsonb; machine printers; object_id uuid;
BEGIN
  previous:=erp_private.begin_request(t,p_request_id,'prepare_job_print_file',jsonb_build_array(p_job_id,p_source_id,p_printer_id,p_reason));
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR j.status NOT IN ('draft','queued','reprint') OR j.started_at IS NOT NULL OR j.inventory_posted_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM bambu_production_allocations WHERE job_id=j.id) THEN RAISE EXCEPTION 'Prepare o arquivo antes de iniciar a impressão.'; END IF;
  IF j.production_snapshot IS NULL THEN RAISE EXCEPTION 'Esta ordem antiga não possui receita congelada. Crie uma nova ordem com o produto revisado.'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe a justificativa da preparação.'; END IF;
  SELECT * INTO machine FROM printers WHERE id=p_printer_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR NOT machine.is_active OR machine.status IN ('maintenance','offline','error') THEN RAISE EXCEPTION 'Selecione uma impressora ativa e disponível.'; END IF;
  review:=job_production_review(j.id);
  SELECT value INTO selected_file FROM jsonb_array_elements(review->'file_options') WHERE value->>'id'=p_source_id::text;
  IF selected_file IS NULL THEN RAISE EXCEPTION 'Escolha uma versão de arquivo permitida para o produto e a placa da ordem.'; END IF;
  IF split_part(selected_file->>'file_path','/',1)<>t::text THEN RAISE EXCEPTION 'Arquivo de outra empresa não permitido.'; END IF;
  SELECT id INTO object_id FROM storage.objects WHERE bucket_id='attachments' AND name=selected_file->>'file_path' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'O arquivo não está mais disponível.'; END IF;
  IF j.print_file_snapshot IS NOT NULL AND nullif(j.print_file_snapshot->>'file_path','') IS NOT NULL
    AND j.print_file_snapshot->>'file_path' IS DISTINCT FROM selected_file->>'file_path' THEN RAISE EXCEPTION 'A ordem já possui um arquivo congelado. Crie uma nova revisão para substituí-lo.'; END IF;
  selected_file:=selected_file||jsonb_build_object('captured_at',now(),'prepared_by',auth.uid(),'reason',btrim(p_reason),
    'plate_id',j.print_plate_id,'plate_index',review->'plate'->'plate_index','printer_model',machine.model,'printer_profile_verified',false);
  UPDATE jobs SET print_file_snapshot=selected_file,printer_id=machine.id,updated_at=now() WHERE id=j.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'prepare_print_file','jobs',j.id,
    jsonb_build_object('before',j.print_file_snapshot,'after',selected_file,'printer_before',j.printer_id,'printer_after',machine.id,'reason',btrim(p_reason)));
  PERFORM erp_private.finish_request(t,p_request_id,j.id); RETURN j.id;
END $$;

-- Objects referenced by a recipe, quotation or production record cannot be
-- replaced or deleted under the user's storage permissions. A new file is a new path.
CREATE FUNCTION public.erp_print_file_is_referenced(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT split_part(p_path,'/',1)=get_user_tenant_id()::text AND (
    EXISTS(SELECT 1 FROM product_print_sources WHERE tenant_id=get_user_tenant_id() AND file_path=p_path)
    OR EXISTS(SELECT 1 FROM jobs WHERE tenant_id=get_user_tenant_id() AND (print_file_snapshot->>'file_path'=p_path
      OR jsonb_path_exists(production_snapshot,'$.**.file_path ? (@ == $path)',jsonb_build_object('path',p_path))))
    OR EXISTS(SELECT 1 FROM order_items WHERE tenant_id=get_user_tenant_id() AND jsonb_path_exists(product_snapshot,'$.**.file_path ? (@ == $path)',jsonb_build_object('path',p_path)))
    OR EXISTS(SELECT 1 FROM sales_quote_items WHERE tenant_id=get_user_tenant_id() AND jsonb_path_exists(product_snapshot,'$.**.file_path ? (@ == $path)',jsonb_build_object('path',p_path)))
  )
$$;
DROP POLICY erp_media_update ON storage.objects;
CREATE POLICY erp_media_update ON storage.objects FOR UPDATE TO authenticated
  USING(bucket_id IN ('attachments','product-photos') AND split_part(name,'/',1)=get_user_tenant_id()::text AND erp_can_write()
    AND (bucket_id<>'attachments' OR NOT erp_print_file_is_referenced(name)))
  WITH CHECK(bucket_id IN ('attachments','product-photos') AND split_part(name,'/',1)=get_user_tenant_id()::text AND erp_can_write()
    AND (bucket_id<>'attachments' OR NOT erp_print_file_is_referenced(name)));
DROP POLICY erp_media_delete ON storage.objects;
CREATE POLICY erp_media_delete ON storage.objects FOR DELETE TO authenticated
  USING(bucket_id IN ('attachments','product-photos') AND split_part(name,'/',1)=get_user_tenant_id()::text AND erp_can_write()
    AND (bucket_id<>'attachments' OR NOT erp_print_file_is_referenced(name)));

REVOKE ALL ON FUNCTION erp_private.bom_leaf_snapshot(jsonb,uuid),erp_private.job_default_print_file(jsonb,uuid),public.erp_job_production_snapshot() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.job_production_review(uuid),public.prepare_job_print_file(uuid,uuid,uuid,text,uuid),public.erp_print_file_is_referenced(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.job_production_review(uuid),public.prepare_job_print_file(uuid,uuid,uuid,text,uuid),public.erp_print_file_is_referenced(text) TO authenticated;
