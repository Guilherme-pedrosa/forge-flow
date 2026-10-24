-- One physical SKU remains the same item while its parent workspace edits the
-- membership, catalogue metadata, technical sheet and optional print preparation.
-- Historical jobs, inventory balances and stock valuation are never rewritten.
CREATE FUNCTION erp_private.save_product_subitem_details(
 p_product_id uuid,p_subitem_id uuid,p_data jsonb,p_request_id uuid,p_operation text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; parent products; child products; existing product_subitems;
 child_id uuid; stock uuid; qty integer; yield_count integer; plate uuid; prior_plate product_print_plates;
 initial_qty numeric; initial_cost numeric; n numeric; k text; newly_created boolean:=false;
 prepare boolean; spec jsonb; line jsonb; recipe_lines jsonb:='[]'; total_grams numeric:=0;
 seconds numeric; nonmaterial numeric; printer uuid; idx integer; technical_yield numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,p_operation,jsonb_build_array(p_product_id,p_subitem_id,p_data));
 IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Informe os dados da peça.'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_data) LOOP
  IF k<>ALL(ARRAY['component_product_id','name','sku','photo_url','quantity_per_product','plate_id','quantity_per_plate',
   'initial_stock','unit_cost','technical','prepare_print','printer_id','non_material_cost_per_piece','sort_order']) THEN
   RAISE EXCEPTION 'Campo da peça não permitido: %',k;
  END IF;
 END LOOP;
 SELECT * INTO parent FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 IF parent.is_component THEN RAISE EXCEPTION 'Uma peça de estoque não pode receber subitens. Abra o produto final para organizar sua composição.'; END IF;
 IF p_subitem_id IS NOT NULL THEN
  SELECT * INTO existing FROM product_subitems WHERE id=p_subitem_id AND product_id=parent.id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subitem não encontrado neste produto.'; END IF;
  IF p_data->>'component_product_id' IS NOT NULL AND (p_data->>'component_product_id')::uuid<>existing.component_product_id THEN
   RAISE EXCEPTION 'A identidade da peça não pode ser trocada. Adicione outra peça ao produto.';
  END IF;
 END IF;
 child_id:=coalesce(existing.component_product_id,(p_data->>'component_product_id')::uuid);
 IF child_id IS NOT NULL THEN
  SELECT * INTO child FROM products WHERE id=child_id AND tenant_id=t AND is_active FOR UPDATE;
  IF child.id IS NULL OR NOT child.is_component OR child.id=parent.id OR child.assembly_enabled OR child.category='service' THEN
   RAISE EXCEPTION 'Selecione uma peça ativa com estoque próprio. Produtos de venda não são convertidos em peças automaticamente.';
  END IF;
  -- A repeated add of an already linked piece edits that membership instead of
  -- duplicating physical catalogue items or failing a uniqueness constraint.
  IF existing.id IS NULL THEN
   SELECT * INTO existing FROM product_subitems WHERE product_id=parent.id AND component_product_id=child.id AND tenant_id=t FOR UPDATE;
  END IF;
  IF coalesce((p_data->>'initial_stock')::numeric,0)<>0 THEN
   RAISE EXCEPTION 'O estoque inicial só pode ser informado ao criar uma peça nova. Use a movimentação de estoque da peça existente.';
  END IF;
 END IF;
 FOR k IN SELECT unnest(ARRAY['quantity_per_product','quantity_per_plate']) LOOP
  n:=(p_data->>k)::numeric;
  IF n IS NOT NULL AND (NOT erp_private.valid_number(n) OR n<>trunc(n) OR n NOT BETWEEN 1 AND 10000) THEN
   RAISE EXCEPTION 'Informe quantidades inteiras de 1 a 10000.';
  END IF;
 END LOOP;
 qty:=CASE WHEN p_data ? 'quantity_per_product' THEN (p_data->>'quantity_per_product')::integer ELSE existing.quantity_per_product END;
 yield_count:=CASE WHEN p_data ? 'quantity_per_plate' THEN (p_data->>'quantity_per_plate')::integer ELSE existing.quantity_per_plate END;
 plate:=CASE WHEN p_data ? 'plate_id' THEN (p_data->>'plate_id')::uuid ELSE existing.plate_id END;
 IF plate IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_print_plates WHERE id=plate AND product_id=parent.id AND tenant_id=t AND is_active) THEN
  RAISE EXCEPTION 'Placa inválida para este produto.';
 END IF;
 IF p_data ? 'name' AND (nullif(btrim(p_data->>'name'),'') IS NULL OR length(p_data->>'name')>200) THEN
  RAISE EXCEPTION 'Informe o nome da peça, com até 200 caracteres.';
 END IF;
 IF length(coalesce(p_data->>'sku',''))>100 THEN RAISE EXCEPTION 'Limite o SKU a 100 caracteres.'; END IF;
 IF p_data->>'photo_url' IS NOT NULL AND p_data->>'photo_url'<>'' AND
  (length(p_data->>'photo_url')>4000 OR p_data->>'photo_url' ~ '[[:space:]<>"''\\]' OR
   NOT (p_data->>'photo_url' ~ '^https://[^/@]+(/[^[:space:]]*)?$' OR p_data->>'photo_url' ~ '^/[^/]')) THEN
  RAISE EXCEPTION 'Informe uma foto com endereço HTTPS ou caminho local válido.';
 END IF;
 n:=(p_data->>'unit_cost')::numeric;
 IF n IS NOT NULL AND (NOT erp_private.valid_number(n) OR n>1000000000) THEN RAISE EXCEPTION 'Informe custo não negativo e finito.'; END IF;
 prepare:=coalesce((p_data->>'prepare_print')::boolean,false);
 PERFORM erp_private.assert_subitem_mode(parent.id,t);
 IF child_id IS NULL THEN
  IF nullif(btrim(p_data->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Informe o nome da peça.'; END IF;
  initial_qty:=coalesce((p_data->>'initial_stock')::numeric,0); initial_cost:=coalesce(n,0);
  IF NOT erp_private.valid_number(initial_qty) OR initial_qty<>trunc(initial_qty) THEN RAISE EXCEPTION 'Informe estoque inicial inteiro e não negativo.'; END IF;
  INSERT INTO inventory_items(tenant_id,name,unit,category,avg_cost,loss_coefficient)
   VALUES(t,btrim(p_data->>'name'),'un','consumable',initial_cost,0) RETURNING id INTO stock;
  INSERT INTO products(tenant_id,name,sku,category,is_component,stock_item_id,manual_cost_override,cost_estimate,sale_price,photo_url,notes)
   VALUES(t,btrim(p_data->>'name'),coalesce(nullif(btrim(p_data->>'sku'),''),'SUB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
    'printed_part',true,stock,n,n,NULL,nullif(p_data->>'photo_url',''),'Peça com estoque individual de '||parent.name) RETURNING id INTO child_id;
  UPDATE inventory_items SET sku=(SELECT sku FROM products WHERE id=child_id) WHERE id=stock;
  IF initial_qty>0 THEN
   INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
    VALUES(t,stock,'purchase_in',initial_qty,initial_cost,'subitem_initial',child_id,'Estoque inicial informado no cadastro',auth.uid());
  END IF;
  newly_created:=true;
 ELSE
  stock:=child.stock_item_id;
  IF stock IS NULL THEN
   INSERT INTO inventory_items(tenant_id,name,sku,unit,category,avg_cost,loss_coefficient)
    VALUES(t,child.name,child.sku,'un','consumable',coalesce(child.manual_cost_override,child.cost_estimate,0),0) RETURNING id INTO stock;
   UPDATE products SET stock_item_id=stock WHERE id=child.id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=stock AND tenant_id=t AND is_active AND unit='un') THEN
   RAISE EXCEPTION 'O estoque da peça deve estar ativo em unidades (un).';
  END IF;
  UPDATE products SET
   name=CASE WHEN p_data ? 'name' THEN btrim(p_data->>'name') ELSE name END,
   sku=CASE WHEN p_data ? 'sku' THEN nullif(btrim(p_data->>'sku'),'') ELSE sku END,
   photo_url=CASE WHEN p_data ? 'photo_url' THEN nullif(p_data->>'photo_url','') ELSE photo_url END,
   manual_cost_override=CASE WHEN p_data ? 'unit_cost' THEN n ELSE manual_cost_override END,
   cost_estimate=CASE WHEN p_data ? 'unit_cost' THEN n ELSE cost_estimate END
   WHERE id=child_id;
  -- Mirror identity for stock screens without touching current_stock/avg_cost.
  UPDATE inventory_items i SET name=p.name,sku=p.sku FROM products p WHERE p.id=child_id AND i.id=stock;
 END IF;
 IF existing.id IS NULL THEN
  INSERT INTO product_subitems(tenant_id,product_id,component_product_id,quantity_per_product,plate_id,quantity_per_plate)
   VALUES(t,parent.id,child_id,qty,plate,yield_count) RETURNING id INTO result;
 ELSE
  UPDATE product_subitems SET quantity_per_product=qty,plate_id=plate,quantity_per_plate=yield_count WHERE id=existing.id RETURNING id INTO result;
 END IF;
 IF p_data ? 'technical' THEN
  technical_yield:=(p_data->'technical'->>'pieces_per_plate')::numeric;
  IF prepare AND p_data ? 'quantity_per_plate' AND yield_count IS NOT NULL AND technical_yield IS NOT NULL AND technical_yield<>yield_count THEN
   RAISE EXCEPTION 'A quantidade por placa deve ser igual na ficha e na produção da peça.';
  END IF;
  PERFORM public.save_product_piece_spec(child_id,p_data->'technical',md5(p_request_id::text||'/piece-spec')::uuid);
 END IF;
 IF prepare THEN
  SELECT s.spec INTO spec FROM product_piece_specs s WHERE s.product_id=child_id AND s.tenant_id=t;
  yield_count:=coalesce(yield_count,(spec->>'pieces_per_plate')::integer);
  IF yield_count IS NULL OR yield_count NOT BETWEEN 1 AND 10000 OR
   (spec->>'pieces_per_plate' IS NOT NULL AND (spec->>'pieces_per_plate')::numeric<>yield_count) THEN
   RAISE EXCEPTION 'Confirme a quantidade de peças por placa na ficha e na produção.';
  END IF;
  seconds:=(spec->>'print_seconds')::numeric;
  nonmaterial:=(p_data->>'non_material_cost_per_piece')::numeric;
  IF seconds IS NULL OR NOT erp_private.valid_number(seconds,0.001) OR seconds*yield_count>2147483647 THEN
   RAISE EXCEPTION 'Informe o tempo de impressão por peça antes de preparar a placa.';
  END IF;
  IF nonmaterial IS NULL OR NOT erp_private.valid_number(nonmaterial) OR nonmaterial*yield_count>1000000000 THEN
   RAISE EXCEPTION 'Confirme os demais custos por peça, inclusive zero quando confirmado.';
  END IF;
  IF jsonb_typeof(spec->'materials') IS DISTINCT FROM 'array' OR jsonb_array_length(spec->'materials')=0 THEN
   RAISE EXCEPTION 'Informe os filamentos de estoque e os gramas por peça antes de preparar a placa.';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(spec->'materials') LOOP
   n:=(line->>'grams')::numeric;
   IF line->>'item_id' IS NULL OR n IS NULL OR NOT erp_private.valid_number(n,0.001) THEN
    RAISE EXCEPTION 'Vincule cada filamento ao estoque e informe seus gramas por peça.';
   END IF;
   total_grams:=total_grams+n*yield_count;
   recipe_lines:=recipe_lines||jsonb_build_array(jsonb_build_object('item_id',line->>'item_id','grams',n*yield_count));
  END LOOP;
  printer:=(p_data->>'printer_id')::uuid;
  -- Reuse only an explicitly dedicated manual plate with no other membership
  -- and no pending jobs. Otherwise create a fresh layout; frozen jobs keep theirs.
  SELECT pl.* INTO prior_plate FROM product_print_plates pl WHERE pl.id=plate AND pl.product_id=parent.id AND pl.tenant_id=t
   AND pl.is_active AND pl.source_id IS NULL AND pl.imported_plate_metadata->>'dedicated_subitem_id'=result::text
   AND NOT EXISTS(SELECT 1 FROM product_subitems b WHERE b.plate_id=pl.id AND b.id<>result)
   AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.print_plate_id=pl.id AND j.inventory_posted_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id
    WHERE o.status='released' AND i.assembled_quantity<i.quantity AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(i.production_snapshot->'physical_components','[]')) c WHERE c->>'plate_id'=pl.id::text));
  IF prior_plate.id IS NULL THEN
   SELECT coalesce(max(plate_index),0)+1 INTO idx FROM product_print_plates WHERE product_id=parent.id AND tenant_id=t;
  ELSE idx:=prior_plate.plate_index;
  END IF;
  plate:=public.save_product_print_plate(prior_plate.id,parent.id,NULL,jsonb_build_object('plate_index',idx,
   'label',(SELECT name FROM products WHERE id=child_id),'units_per_plate',1,
   'material_id',recipe_lines->0->>'item_id','printer_id',printer,'est_grams',total_grams,
   'est_time_seconds',ceil(seconds*yield_count),'est_cost_per_unit',NULL));
  UPDATE product_print_plates SET imported_plate_metadata=coalesce(imported_plate_metadata,'{}')||jsonb_build_object('dedicated_subitem_id',result,'piece_workspace',true) WHERE id=plate;
  PERFORM public.save_product_material_recipe(parent.id,plate,'per_print',recipe_lines,'Ficha por peça confirmada no produto',
   md5(p_request_id::text||'/piece-recipe')::uuid,nonmaterial*yield_count);
  UPDATE product_subitems SET plate_id=plate,quantity_per_plate=yield_count WHERE id=result;
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
  VALUES(t,auth.uid(),'save_subitem_details','product_subitems',result,p_data||jsonb_build_object('created_piece',newly_created));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.save_product_subitem_details(p_product_id uuid,p_subitem_id uuid,p_data jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT erp_private.save_product_subitem_details(p_product_id,p_subitem_id,p_data,p_request_id,'subitem_details')
$$;

-- Preserve the original request operation/payload so completed legacy retries
-- cannot repeat initial stock or replace a technical sheet edited later.
CREATE OR REPLACE FUNCTION public.save_product_subitem(p_product_id uuid,p_subitem_id uuid,p_data jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT erp_private.save_product_subitem_details(p_product_id,p_subitem_id,p_data,p_request_id,'save_subitem')
$$;

CREATE OR REPLACE FUNCTION public.remove_product_subitem(p_subitem_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); b product_subitems;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO b FROM product_subitems WHERE id=p_subitem_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subitem não encontrado.'; END IF;
 IF EXISTS(SELECT 1 FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id
   WHERE i.tenant_id=t AND i.product_id=b.product_id AND o.status='released' AND i.assembled_quantity<i.quantity
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(i.production_snapshot->'physical_components','[]')) c WHERE c->>'id'=b.id::text))
  OR EXISTS(SELECT 1 FROM jobs j WHERE j.tenant_id=t AND j.status NOT IN('ready','shipped','completed','failed')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(j.production_snapshot->'physical_outputs')='array'
    THEN j.production_snapshot->'physical_outputs' ELSE coalesce(j.production_snapshot->'physical_components','[]') END) c WHERE c->>'id'=b.id::text)) THEN
  RAISE EXCEPTION 'Esta peça está em uma produção em andamento. Conclua ou cancele essa produção antes de removê-la do produto; seu estoque será preservado.';
 END IF;
 DELETE FROM product_subitems WHERE id=b.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'unlink_subitem','product_subitems',b.id,to_jsonb(b));
 RETURN b.id;
END $$;
REVOKE ALL ON FUNCTION erp_private.save_product_subitem_details(uuid,uuid,jsonb,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_product_subitem_details(uuid,uuid,jsonb,uuid),public.save_product_subitem(uuid,uuid,jsonb,uuid),public.remove_product_subitem(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_subitem_details(uuid,uuid,jsonb,uuid),public.save_product_subitem(uuid,uuid,jsonb,uuid),public.remove_product_subitem(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
