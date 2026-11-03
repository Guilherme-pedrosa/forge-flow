-- Complete commercial publication data in the same Forge flow. This does not
-- write marketplace prices/stock, change recipes, or rewrite accepted history.
CREATE FUNCTION public.save_marketplace_publication_details(p_account_id uuid,p_product_id uuid,p_changes jsonb,p_expected_revision text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; original jsonb; after_state jsonb; product products; acceptance product_channel_pricing_acceptances;
 price product_channel_prices; fresh jsonb; original_assumptions jsonb; new_presentation jsonb; new_package jsonb; new_name text; new_description text;
 new_photos jsonb; current_photos jsonb; photo jsonb; shipping_changed boolean; details_changed boolean; index_value integer:=0;
 reaccepted uuid; cost_context jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'marketplace_publication_details',jsonb_build_array(p_account_id,p_product_id,p_changes,p_expected_revision));
 IF result IS NOT NULL THEN
  after_state:=public.integrador_publication_snapshot(p_account_id,result);
  RETURN jsonb_build_object('saved',true,'product_id',result,'revision',after_state->>'revision','replayed',true);
 END IF;
 IF p_changes IS NULL OR jsonb_typeof(p_changes)<>'object' OR p_changes-ARRAY['name','description','dimensions','shipping_package','photos']<>'{}'::jsonb
  OR octet_length(p_changes::text)>200000 OR coalesce(p_expected_revision,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Confira os dados comerciais da publicação.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('channel-pricing-'||t::text||':mercado_livre',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO product FROM products WHERE id=p_product_id AND tenant_id=t AND is_active AND NOT is_component FOR UPDATE;
 IF product.id IS NULL THEN RAISE EXCEPTION 'Selecione um produto ativo desta empresa.' USING ERRCODE='42501'; END IF;
 original:=public.integrador_publication_snapshot(p_account_id,product.id);
 IF original->>'revision' IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Os dados do produto, preço ou estoque mudaram. Atualize a publicação antes de salvar.'; END IF;
 SELECT * INTO price FROM product_channel_prices WHERE tenant_id=t AND product_id=product.id AND channel='mercado_livre' FOR UPDATE;
 SELECT * INTO acceptance FROM product_channel_pricing_acceptances WHERE id=price.acceptance_id AND tenant_id=t AND product_id=product.id AND channel='mercado_livre';
 new_name:=product.name; new_description:=product.description; new_presentation:=product.commercial_presentation; new_package:=product.shipping_package;
 SELECT coalesce(jsonb_agg(ph.url ORDER BY ph.sort_order,ph.id),'[]'::jsonb) INTO current_photos FROM product_photos ph WHERE ph.tenant_id=t AND ph.product_id=product.id;
 IF jsonb_array_length(current_photos)=0 AND product.photo_url IS NOT NULL THEN current_photos:=jsonb_build_array(product.photo_url); END IF;
 new_photos:=current_photos;
 IF p_changes ? 'name' THEN
  IF jsonb_typeof(p_changes->'name') IS DISTINCT FROM 'string' OR length(btrim(p_changes->>'name')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Informe um nome comercial de até 200 caracteres.'; END IF;
  new_name:=btrim(p_changes->>'name');
 END IF;
 IF p_changes ? 'description' THEN
  IF jsonb_typeof(p_changes->'description') IS DISTINCT FROM 'string' OR length(p_changes->>'description')>20000 THEN RAISE EXCEPTION 'Informe uma descrição comercial de até 20000 caracteres.'; END IF;
  new_description:=p_changes->>'description';
 END IF;
 IF p_changes ? 'dimensions' THEN
  new_presentation:=coalesce(product.commercial_presentation,'{}'::jsonb)||jsonb_build_object('dimensions',p_changes->'dimensions');
  IF NOT erp_private.valid_product_commercial_presentation(new_presentation) THEN RAISE EXCEPTION 'Confira as medidas da peça em milímetros.'; END IF;
 END IF;
 IF p_changes ? 'shipping_package' THEN
  new_package:=nullif(p_changes->'shipping_package','null'::jsonb);
  IF NOT erp_private.product_shipping_package_valid(new_package) THEN RAISE EXCEPTION 'Confira as medidas e o peso da embalagem.'; END IF;
 END IF;
 IF p_changes ? 'photos' THEN
  IF jsonb_typeof(p_changes->'photos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes->'photos')>12 THEN RAISE EXCEPTION 'Escolha até doze fotos da peça.'; END IF;
  FOR photo IN SELECT value FROM jsonb_array_elements(p_changes->'photos') LOOP
   IF jsonb_typeof(photo) IS DISTINCT FROM 'string' OR length(photo#>>'{}') NOT BETWEEN 10 AND 2000
    OR (photo#>>'{}') !~ '^https://[^/@[:space:]]+(/|$)' OR (photo#>>'{}') ~ '[[:cntrl:]]'
    THEN RAISE EXCEPTION 'Informe uma URL HTTPS válida para cada foto.'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements_text(p_changes->'photos'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_changes->'photos')) THEN RAISE EXCEPTION 'Retire as fotos repetidas.'; END IF;
  new_photos:=p_changes->'photos';
 END IF;
 shipping_changed:=new_package IS DISTINCT FROM product.shipping_package;
 details_changed:=new_name IS DISTINCT FROM product.name OR new_description IS DISTINCT FROM product.description OR new_presentation IS DISTINCT FROM product.commercial_presentation
  OR shipping_changed OR new_photos IS DISTINCT FROM current_photos;
 IF details_changed THEN
  UPDATE products SET name=new_name,description=new_description,commercial_presentation=new_presentation,shipping_package=new_package,
   photo_url=CASE WHEN p_changes ? 'photos' THEN new_photos->>0 ELSE product.photo_url END,updated_at=clock_timestamp() WHERE id=product.id AND tenant_id=t;
  IF new_photos IS DISTINCT FROM current_photos THEN
   DELETE FROM product_photos WHERE product_id=product.id AND tenant_id=t;
   FOR photo IN SELECT value FROM jsonb_array_elements(new_photos) LOOP
    INSERT INTO product_photos(tenant_id,product_id,url,sort_order) VALUES(t,product.id,photo#>>'{}',index_value); index_value:=index_value+1;
   END LOOP;
  END IF;
  -- Name/description/photos/physical presentation can change a revision without
  -- changing manufacturing cost. Preserve the old accepted amount by making a
  -- NEW immutable acceptance only when every economic condition is identical.
  IF NOT shipping_changed AND original->'price'->>'complete'='true' AND acceptance.id IS NOT NULL AND acceptance.quantity=1 THEN
   original_assumptions:=coalesce(acceptance.snapshot->'assumptions','{}'::jsonb);
   cost_context:=CASE WHEN acceptance.snapshot->>'cost_source'='simulation' THEN acceptance.snapshot->'cost_snapshot'->'cost_context' END;
   BEGIN
    fresh:=erp_private.channel_preview(product.id,t,'mercado_livre',1,original_assumptions,price.unit_price,cost_context);
    IF fresh->>'complete'='true' AND (fresh->>'unit_cost')::numeric=acceptance.unit_cost AND fresh->>'policy_revision'=acceptance.policy_revision
     AND (fresh->'result'->>'target')::numeric=acceptance.unit_price THEN
      reaccepted:=erp_private.accept_channel_preview(product.id,t,fresh);
    END IF;
   EXCEPTION WHEN OTHERS THEN
    -- Unknown/revised economics remain pending. Never manufacture a new price.
    reaccepted:=NULL;
   END;
  END IF;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'marketplace_publication_details','products',product.id,
   jsonb_build_object('account_id',p_account_id,'changed_fields',(SELECT jsonb_agg(key) FROM jsonb_object_keys(p_changes) key),'shipping_changed',shipping_changed,'reaccepted_price',reaccepted));
 END IF;
 PERFORM erp_private.finish_request(t,p_request_id,product.id);
 after_state:=public.integrador_publication_snapshot(p_account_id,product.id);
 RETURN jsonb_build_object('saved',true,'product_id',product.id,'revision',after_state->>'revision','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.save_marketplace_publication_details(uuid,uuid,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_marketplace_publication_details(uuid,uuid,jsonb,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
