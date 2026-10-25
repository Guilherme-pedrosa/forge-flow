-- Explicitly reviewed file revisions can update an existing SKU without
-- replacing its catalogue identity, stock, BOM quantities or measured usage.
CREATE FUNCTION erp_private.file_revision_context(p_product uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE p products; plates jsonb; components jsonb; sources jsonb; blocked text; state jsonb;
BEGIN
 SELECT * INTO p FROM products WHERE id=p_product AND tenant_id=p_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado nesta empresa.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'source_id',source_id,'label',label,'plate_index',plate_index,
  'updated_revision',extract(epoch FROM updated_at),'units_per_plate',units_per_plate,'est_grams',est_grams,'est_time_seconds',est_time_seconds) ORDER BY id),'[]')
  INTO plates FROM product_print_plates WHERE product_id=p.id AND tenant_id=p_tenant AND is_active;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'component_product_id',c.id,'name',c.name,'sku',c.sku,'active',c.is_active,
  'plate_id',b.plate_id,'quantity_per_plate',b.quantity_per_plate,'quantity_per_product',b.quantity_per_product,'source_part_id',b.source_part_id,
  'updated_revision',extract(epoch FROM c.updated_at)) ORDER BY b.id),'[]') INTO components
  FROM product_subitems b JOIN products c ON c.id=b.component_product_id AND c.tenant_id=p_tenant WHERE b.product_id=p.id AND b.tenant_id=p_tenant;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'updated_revision',extract(epoch FROM updated_at),'file_sha256',file_sha256,
  'model_id',model_id,'profile_id',profile_id,'source_url',source_url) ORDER BY id),'[]') INTO sources
  FROM product_print_sources WHERE product_id=p.id AND tenant_id=p_tenant AND is_active;
 IF NOT p.is_active OR p.category IN('kit','service') THEN blocked:='Selecione um produto físico ativo para aplicar o arquivo.';
 ELSIF EXISTS(SELECT 1 FROM jobs j WHERE j.tenant_id=p_tenant AND j.product_id=p.id AND j.inventory_posted_at IS NULL AND j.status NOT IN('ready','completed','shipped','failed')
  AND (erp_private.job_has_active_source(j.tenant_id,j.order_id,j.production_order_id) OR j.started_at IS NOT NULL OR j.status NOT IN('draft','queued','reprint') OR j.bambu_task_id IS NOT NULL OR coalesce(j.actual_grams,0)>0))
  OR EXISTS(SELECT 1 FROM bambu_production_records r WHERE r.tenant_id=p_tenant AND r.product_id=p.id AND r.posted_at IS NULL AND r.state<>'posted') THEN
  blocked:='Conclua ou concilie a produção pendente antes de aplicar outra revisão do arquivo.';
 ELSIF EXISTS(SELECT 1 FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id AND o.tenant_id=i.tenant_id
  WHERE i.tenant_id=p_tenant AND i.product_id=p.id AND o.status='released' AND greatest(i.assembled_quantity,i.received_quantity)<i.quantity) THEN
  blocked:='Esta revisão aguarda a conclusão da ordem de produção já liberada.';
 END IF;
 state:=jsonb_build_object('product',to_jsonb(p),'product_revision',extract(epoch FROM p.updated_at),'assembly_enabled',p.assembly_enabled,
  'plates',plates,'components',components,'sources',sources,'blocked_reason',blocked);
 RETURN jsonb_build_object('revision',md5(state::text),'active_plates',plates,'components',components,'blocked_reason',blocked,
  'can_target_product',NOT p.assembly_enabled AND jsonb_array_length(components)=0 AND p.category NOT IN('kit','service'),
  'manual_technical_sheet',EXISTS(SELECT 1 FROM product_piece_specs WHERE product_id=p.id AND tenant_id=p_tenant));
END $$;
CREATE FUNCTION public.product_file_revision_context(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para analisar este produto.'; END IF;
 RETURN erp_private.file_revision_context(p_product_id,get_user_tenant_id());
END $$;

CREATE FUNCTION public.apply_product_file_revision(p_product_id uuid,p_composition jsonb,p_mapping jsonb,p_expected_revision text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; product products; context jsonb; source uuid; plate uuid; source_part uuid;
 pl jsonb; part jsonb; mapping jsonb; stored product_subitems; hash text; mode text; k text; n numeric;
 indices integer[]:='{}'; keys text[]; old_plates uuid[]; old_sources uuid[]; mapped uuid[]:='{}'; idx integer; count_parts integer:=0;
 qty integer; units integer; ratio numeric; ratios numeric[]; filaments jsonb; grams numeric; seconds numeric; original jsonb;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'apply_file_revision',jsonb_build_array(p_product_id,p_composition,p_mapping,p_expected_revision));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO product FROM products WHERE id=p_product_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado nesta empresa.'; END IF;
 context:=erp_private.file_revision_context(product.id,t);
 IF context->>'blocked_reason' IS NOT NULL THEN RAISE EXCEPTION '%',context->>'blocked_reason'; END IF;
 IF p_expected_revision IS DISTINCT FROM context->>'revision' THEN RAISE EXCEPTION 'O produto ou suas placas mudaram. Atualize a prévia antes de aplicar o arquivo.'; END IF;
 hash:=p_composition->>'file_sha256'; mode:=p_mapping->>'target';
 IF jsonb_typeof(p_composition) IS DISTINCT FROM 'object' OR hash!~'^[0-9a-f]{64}$' OR hash IS NULL
  OR p_composition->>'profile_id' IS DISTINCT FROM 'local:'||hash OR jsonb_typeof(p_composition->'plates') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_composition->'plates') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Selecione e confira um arquivo 3MF completo antes de aplicar.'; END IF;
 IF jsonb_typeof(p_mapping) IS DISTINCT FROM 'object' OR p_mapping-'target'-'parts'-'file_path'-'file_name'<>'{}'::jsonb OR mode IS NULL OR mode NOT IN('product','components')
  OR jsonb_typeof(p_mapping->'parts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Confira o destino de cada peça do arquivo.'; END IF;
 IF p_mapping->>'file_name' IS NOT NULL AND (jsonb_typeof(p_mapping->'file_name')<>'string' OR length(p_mapping->>'file_name')>240 OR p_mapping->>'file_name'~'[/\\[:cntrl:]]') THEN RAISE EXCEPTION 'Nome de arquivo inválido.'; END IF;
 IF p_mapping->>'file_path' IS NOT NULL AND jsonb_typeof(p_mapping->'file_path')<>'string' THEN RAISE EXCEPTION 'Caminho do arquivo inválido.'; END IF;
 IF mode='product' AND context->>'can_target_product' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Este produto possui componentes. Escolha explicitamente a peça existente para cada objeto.'; END IF;
 IF mode='components' AND (NOT product.component_inventory_mode OR jsonb_array_length(context->'components')=0) THEN RAISE EXCEPTION 'Selecione um produto com peças individuais já cadastradas.'; END IF;
 -- Validate the whole proposed revision before archiving any prior plan.
 FOR pl IN SELECT value FROM jsonb_array_elements(p_composition->'plates') LOOP
  IF jsonb_typeof(pl->'index') IS DISTINCT FROM 'number' OR coalesce(pl->>'index','')!~'^[1-9][0-9]{0,3}$' OR nullif(btrim(pl->>'label'),'') IS NULL OR length(pl->>'label')>200 THEN RAISE EXCEPTION 'Identificação de placa inválida.'; END IF;
  idx:=(pl->>'index')::integer; IF idx=ANY(indices) THEN RAISE EXCEPTION 'Placa repetida no arquivo.'; END IF; indices:=array_append(indices,idx);
  PERFORM erp_private.file_slicer_filaments(pl->'slicer_estimates',t);
  FOREACH k IN ARRAY ARRAY['weight_grams','time_seconds'] LOOP
   IF pl ? k AND pl->k<>'null'::jsonb THEN
    IF jsonb_typeof(pl->k)<>'number' THEN RAISE EXCEPTION 'Peso ou tempo do arquivo inválido.'; END IF;
    n:=(pl->>k)::numeric; IF NOT erp_private.valid_number(n) OR n>(CASE WHEN k='weight_grams' THEN 1000000 ELSE 31536000 END) THEN RAISE EXCEPTION 'Peso ou tempo do arquivo fora do limite.'; END IF;
   END IF;
  END LOOP;
  IF jsonb_typeof(pl->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(pl->'parts') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Confira as peças físicas da placa.'; END IF;
  keys:='{}';
  FOR part IN SELECT value FROM jsonb_array_elements(pl->'parts') LOOP
   IF nullif(btrim(part->>'source_key'),'') IS NULL OR length(part->>'source_key')>200 OR part->>'source_key'=ANY(keys)
    OR nullif(btrim(part->>'name'),'') IS NULL OR length(part->>'name')>200 OR coalesce(part->>'name_source','') NOT IN('file','manual')
    OR jsonb_typeof(part->'quantity_per_plate') IS DISTINCT FROM 'number' OR coalesce(part->>'quantity_per_plate','')!~'^[1-9][0-9]{0,4}$'
    OR (part->>'quantity_per_plate')::integer>10000 THEN RAISE EXCEPTION 'O arquivo deve identificar cada peça e sua contagem física por placa.'; END IF;
   keys:=array_append(keys,part->>'source_key'); count_parts:=count_parts+1;
   IF mode='components' THEN
    SELECT value INTO mapping FROM jsonb_array_elements(p_mapping->'parts') x WHERE x->>'plate_index'=idx::text AND x->>'source_key'=part->>'source_key';
    IF mapping IS NULL OR (SELECT count(*) FROM jsonb_array_elements(p_mapping->'parts') x WHERE x->>'plate_index'=idx::text AND x->>'source_key'=part->>'source_key')<>1 THEN RAISE EXCEPTION 'Escolha uma peça existente para cada objeto do arquivo.'; END IF;
    SELECT b.* INTO stored FROM product_subitems b JOIN products c ON c.id=b.component_product_id AND c.tenant_id=t AND c.is_active
     WHERE b.id=(mapping->>'subitem_id')::uuid AND b.product_id=product.id AND b.tenant_id=t FOR UPDATE OF b,c;
    IF NOT FOUND OR stored.id=ANY(mapped) THEN RAISE EXCEPTION 'A peça escolhida não pertence a este produto ou já foi usada em outro objeto.'; END IF;
    mapped:=array_append(mapped,stored.id);
   END IF;
  END LOOP;
 END LOOP;
 IF mode='product' AND (count_parts<>1 OR jsonb_array_length(p_composition->'plates')<>1 OR jsonb_array_length(p_mapping->'parts')<>0) THEN RAISE EXCEPTION 'Para o próprio SKU, use uma placa homogênea de uma única peça física.'; END IF;
 IF mode='components' AND jsonb_array_length(p_mapping->'parts')<>count_parts THEN RAISE EXCEPTION 'Há destinos extras ou ausentes na prévia do arquivo.'; END IF;
 IF mode='components' AND EXISTS(SELECT 1 FROM product_subitems b JOIN product_print_plates p ON p.id=b.plate_id AND p.is_active
  WHERE b.product_id=product.id AND b.tenant_id=t AND NOT b.id=ANY(mapped)) THEN RAISE EXCEPTION 'Uma peça do plano anterior ficaria sem impressão. Inclua o destino dessa peça antes de substituir as placas.'; END IF;
 IF EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.tenant_id=oi.tenant_id WHERE oi.product_id=product.id AND oi.tenant_id=t AND o.status='approved' AND oi.product_snapshot IS NULL) THEN RAISE EXCEPTION 'Conclua a preparação dos pedidos antigos antes de trocar o arquivo de produção.'; END IF;
 SELECT s.id INTO source FROM product_print_sources s JOIN product_print_source_imports i ON i.source_id=s.id AND i.tenant_id=t
  WHERE s.tenant_id=t AND s.product_id=product.id AND s.is_active AND s.file_sha256=hash AND i.reference->'composition'=p_composition AND i.reference->'mapping'=p_mapping LIMIT 1;
 IF source IS NOT NULL THEN PERFORM erp_private.finish_request(t,p_request_id,source); RETURN source; END IF;
 PERFORM 1 FROM product_print_plates WHERE product_id=product.id AND tenant_id=t AND is_active ORDER BY id FOR UPDATE;
 SELECT array_agg(id),array_agg(DISTINCT source_id) FILTER(WHERE source_id IS NOT NULL) INTO old_plates,old_sources FROM product_print_plates WHERE product_id=product.id AND tenant_id=t AND is_active;
 source:=public.save_product_print_source(NULL,product.id,jsonb_build_object('label','Revisão 3MF · '||left(hash,12),'profile_id','local:'||hash,'file_sha256',hash,
  'file_path',p_mapping->'file_path','file_name',coalesce(p_mapping->>'file_name','arquivo-'||left(hash,12)||'.3mf')));
 FOR pl IN SELECT value FROM jsonb_array_elements(p_composition->'plates') LOOP
  idx:=(pl->>'index')::integer; ratios:='{}';
  IF mode='product' THEN units:=(pl->'parts'->0->>'quantity_per_plate')::integer;
  ELSE
   FOR part IN SELECT value FROM jsonb_array_elements(pl->'parts') LOOP
    SELECT b.* INTO stored FROM product_subitems b JOIN LATERAL jsonb_array_elements(p_mapping->'parts') x ON b.id=(x->>'subitem_id')::uuid
     WHERE b.tenant_id=t AND b.product_id=product.id AND x->>'plate_index'=idx::text AND x->>'source_key'=part->>'source_key';
    ratio:=CASE WHEN stored.quantity_per_product>0 THEN (part->>'quantity_per_plate')::numeric/stored.quantity_per_product END;
    ratios:=array_append(ratios,ratio);
   END LOOP;
   units:=CASE WHEN array_position(ratios,NULL) IS NULL AND (SELECT count(DISTINCT value) FROM unnest(ratios) value)=1 AND ratios[1]=trunc(ratios[1]) AND ratios[1] BETWEEN 1 AND 10000 THEN ratios[1]::integer END;
  END IF;
  grams:=nullif((pl->>'weight_grams')::numeric,0); seconds:=nullif((pl->>'time_seconds')::numeric,0);
  plate:=public.save_product_print_plate(NULL,product.id,source,jsonb_build_object('plate_index',idx,'label',pl->>'label','units_per_plate',units,'est_grams',grams,'est_time_seconds',seconds));
  filaments:=erp_private.file_slicer_filaments(pl->'slicer_estimates',t);
  UPDATE product_print_plates SET imported_filaments=filaments,imported_plate_metadata=jsonb_build_object('file_sha256',hash,'file_profile_id','local:'||hash,
   'slicer_estimates',pl->'slicer_estimates','slicer_weight_grams',grams,'slicer_time_seconds',seconds,'explicit_file_revision',true) WHERE id=plate;
  FOR part IN SELECT value FROM jsonb_array_elements(pl->'parts') LOOP
   IF mode='components' THEN SELECT b.* INTO stored FROM product_subitems b JOIN LATERAL jsonb_array_elements(p_mapping->'parts') x ON b.id=(x->>'subitem_id')::uuid
    WHERE b.tenant_id=t AND b.product_id=product.id AND x->>'plate_index'=idx::text AND x->>'source_key'=part->>'source_key'; END IF;
   qty:=(part->>'quantity_per_plate')::integer;
   INSERT INTO product_print_plate_parts(tenant_id,product_id,plate_id,source_key,name,quantity_per_product,quantity_per_plate,name_source)
    VALUES(t,product.id,plate,part->>'source_key',part->>'name',CASE WHEN mode='product' THEN 1 ELSE stored.quantity_per_product END,qty,part->>'name_source') RETURNING id INTO source_part;
   IF mode='components' THEN UPDATE product_subitems SET plate_id=plate,source_part_id=source_part,quantity_per_plate=qty WHERE id=stored.id AND tenant_id=t;
   ELSE INSERT INTO product_file_piece_links(product_id,tenant_id,plate_id,source_part_id,quantity_per_plate) VALUES(product.id,t,plate,source_part,qty)
    ON CONFLICT(product_id) DO UPDATE SET plate_id=excluded.plate_id,source_part_id=excluded.source_part_id,quantity_per_plate=excluded.quantity_per_plate,updated_at=now(); END IF;
  END LOOP;
 END LOOP;
 UPDATE product_print_plates SET is_active=false,updated_at=now() WHERE tenant_id=t AND id=ANY(coalesce(old_plates,'{}'));
 UPDATE bambu_production_profiles SET auto_enabled=false,updated_at=now() WHERE tenant_id=t AND plate_id=ANY(coalesce(old_plates,'{}'));
 -- Source documents remain available as historical links/files. Only active
 -- plate layouts define the production plan; ordinary metadata refresh must
 -- not silently resurrect their superseded plates (guarded by migration1900).
 INSERT INTO product_print_source_imports(source_id,tenant_id,reference) VALUES(source,t,jsonb_build_object('provider','local_3mf','file_sha256',hash,'composition',p_composition,'mapping',p_mapping));
 PERFORM erp_private.update_product_print_actuals(product.id);
 IF product.manual_cost_override IS NOT NULL THEN UPDATE products SET cost_estimate=product.cost_estimate WHERE id=product.id AND tenant_id=t; END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'apply_file_revision','product_print_sources',source,jsonb_build_object('product_id',product.id,'file_sha256',hash,'mapping',p_mapping,'old_plates',old_plates));
 PERFORM erp_private.finish_request(t,p_request_id,source); RETURN source;
END $$;

-- An explicitly selected one-piece file is a production reference for the SKU,
-- including a shared component. A manual sheet still has priority everywhere.
ALTER FUNCTION erp_private.read_piece_spec(uuid,uuid,uuid) RENAME TO read_piece_before_file_revision;
CREATE FUNCTION erp_private.read_piece_spec(p_product uuid,p_tenant uuid,p_subitem uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE previous jsonb; ref product_file_piece_links; plate product_print_plates; recipe jsonb; f jsonb; line jsonb; item inventory_items;
 lines jsonb:='[]'; total numeric:=0; cost numeric:=0; grams numeric; rate numeric; known boolean:=true; cost_known boolean:=true;
BEGIN
 previous:=erp_private.read_piece_before_file_revision(p_product,p_tenant,p_subitem);
 IF previous->>'source'='manual' THEN RETURN previous; END IF;
 SELECT * INTO ref FROM product_file_piece_links WHERE product_id=p_product AND tenant_id=p_tenant;
 SELECT * INTO plate FROM product_print_plates WHERE id=ref.plate_id AND product_id=p_product AND tenant_id=p_tenant AND is_active;
 IF plate.id IS NULL THEN RETURN previous; END IF;
 recipe:=erp_private.product_material_recipe_snapshot(p_product,p_tenant,plate.id);
 IF jsonb_array_length(coalesce(recipe->'lines','[]'))>0 THEN
  SELECT jsonb_agg(jsonb_build_object('item_id',x->>'item_id','material',x->>'name','color',x->>'color','grams',(x->>'grams_per_print')::numeric/ref.quantity_per_plate)) INTO lines FROM jsonb_array_elements(recipe->'lines') x;
 ELSIF plate.est_grams IS NOT DISTINCT FROM (plate.imported_plate_metadata->>'slicer_weight_grams')::numeric
  AND jsonb_array_length(plate.imported_filaments)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plate.imported_filaments) x WHERE x->>'grams' IS NULL) THEN
  SELECT jsonb_agg(jsonb_build_object('item_id',x->>'item_id','material',x->>'type','color',x->>'color','grams',(x->>'grams')::numeric/ref.quantity_per_plate)) INTO lines
   FROM jsonb_array_elements(erp_private.import_filament_matches(p_tenant,plate.imported_filaments)) x;
 ELSE lines:=jsonb_build_array(jsonb_build_object('item_id',plate.material_id,'material',NULL,'color',NULL,'grams',plate.est_grams/ref.quantity_per_plate)); END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=p_tenant;
  grams:=(line->>'grams')::numeric;
  IF grams IS NULL THEN known:=false; END IF;
  rate:=CASE WHEN item.avg_cost>0 THEN item.avg_cost*CASE WHEN item.unit='g' THEN 1000 ELSE 1 END END;
  IF rate IS NULL OR grams IS NULL THEN cost_known:=false; END IF;
  total:=total+coalesce(grams,0); cost:=cost+coalesce(grams*rate/1000,0);
 END LOOP;
 RETURN jsonb_build_object('source','plate','revision',NULL,'materials',lines,'grams',CASE WHEN known THEN total END,'print_seconds',plate.est_time_seconds/ref.quantity_per_plate,
  'pieces_per_plate',ref.quantity_per_plate,'material_cost',CASE WHEN cost_known THEN cost END,'estimated_cost',NULL,
  'notes','Estimativa da revisão 3MF escolhida para esta peça. Totais da placa divididos pela contagem física explícita de objetos iguais; inclui suportes e purga.',
  'plate',jsonb_build_object('id',plate.id,'label',plate.label,'grams',plate.est_grams,'seconds',plate.est_time_seconds,'pieces',ref.quantity_per_plate));
END $$;
REVOKE ALL ON FUNCTION erp_private.file_revision_context(uuid,uuid),erp_private.read_piece_before_file_revision(uuid,uuid,uuid),erp_private.read_piece_spec(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.product_file_revision_context(uuid),public.apply_product_file_revision(uuid,jsonb,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_file_revision_context(uuid),public.apply_product_file_revision(uuid,jsonb,jsonb,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
