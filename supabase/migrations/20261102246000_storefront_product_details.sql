-- One atomic commercial save. Immutable receipts make a lost response safe to
-- retry even after a later operator has changed the product or listing.
CREATE TABLE erp_private.storefront_product_detail_receipts (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), request_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id), result jsonb NOT NULL,
 PRIMARY KEY(tenant_id,request_id)
);
REVOKE ALL ON erp_private.storefront_product_detail_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_storefront_product_details(p_channel_id uuid,p_product_id uuid,p_product_changes jsonb,p_settings jsonb,
 p_expected_product_updated_at timestamptz,p_expected_listing_updated_at timestamptz,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid; result uuid; receipt jsonb; product products; listing storefront_listings;
 new_description text; presentation jsonb; packaging jsonb; dimensions jsonb; changed boolean; shipping_changed boolean;
 lock_channel text; price product_channel_prices; accepted product_channel_pricing_acceptances; before_preview jsonb; after_preview jsonb;
 candidates jsonb:='[]'::jsonb; candidate jsonb; cost_context jsonb; reaccepted uuid; renewed jsonb:='[]'::jsonb;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'storefront_product_details',jsonb_build_array(p_channel_id,p_product_id,p_product_changes,p_settings,p_expected_product_updated_at,p_expected_listing_updated_at));
 IF prior IS NOT NULL THEN
  SELECT r.result INTO receipt FROM erp_private.storefront_product_detail_receipts r WHERE r.tenant_id=t AND r.request_id=p_request_id AND r.actor_id=auth.uid();
  IF receipt IS NULL THEN RAISE EXCEPTION 'A confirmação desta solicitação pertence a outro operador ou precisa ser conferida.'; END IF;
  RETURN receipt||jsonb_build_object('replayed',true);
 END IF;
 IF jsonb_typeof(p_product_changes) IS DISTINCT FROM 'object' OR p_product_changes-ARRAY['description','commercial_presentation','shipping_package']<>'{}'::jsonb
  OR octet_length(p_product_changes::text)>200000 OR p_expected_product_updated_at IS NULL
  OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object' OR p_settings-ARRAY['published','category','price_override','made_to_order','lead_days']<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Confira os dados comerciais e a versão carregada da publicação.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 FOREACH lock_channel IN ARRAY ARRAY['direct','mercado_livre','other','shopee','tiktok'] LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('channel-pricing-'||t::text||':'||lock_channel,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM 1 FROM storefront_channels WHERE id=p_channel_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Loja não encontrada nesta empresa.' USING ERRCODE='42501'; END IF;
 SELECT * INTO product FROM products WHERE id=p_product_id AND tenant_id=t AND NOT is_component FOR UPDATE;
 IF product.id IS NULL THEN RAISE EXCEPTION 'Selecione um produto final desta empresa.' USING ERRCODE='42501'; END IF;
 SELECT * INTO listing FROM storefront_listings WHERE channel_id=p_channel_id AND product_id=product.id AND tenant_id=t FOR UPDATE;
 IF product.updated_at IS DISTINCT FROM p_expected_product_updated_at OR listing.updated_at IS DISTINCT FROM p_expected_listing_updated_at THEN
  RAISE EXCEPTION 'O produto ou a publicação mudou em outra operação. Recarregue os dados antes de salvar; seu rascunho continua preservado.' USING ERRCODE='40001';
 END IF;
 new_description:=product.description; presentation:=product.commercial_presentation; packaging:=product.shipping_package;
 IF p_product_changes ? 'description' THEN
  IF p_product_changes->'description'<>'null'::jsonb AND (jsonb_typeof(p_product_changes->'description') IS DISTINCT FROM 'string' OR length(p_product_changes->>'description')>20000) THEN RAISE EXCEPTION 'Confira a descrição comercial de até 20000 caracteres.'; END IF;
  new_description:=p_product_changes->>'description';
 END IF;
 IF p_product_changes ? 'commercial_presentation' THEN
  IF p_product_changes->'commercial_presentation'='null'::jsonb THEN presentation:=NULL;
  ELSE
   IF jsonb_typeof(p_product_changes->'commercial_presentation') IS DISTINCT FROM 'object'
    OR (p_product_changes->'commercial_presentation')-ARRAY['dimensions','description_generation']<>'{}'::jsonb THEN RAISE EXCEPTION 'Confira as medidas e a descrição da peça.'; END IF;
   presentation:=coalesce(presentation,'{}'::jsonb)||(p_product_changes->'commercial_presentation');
   IF p_product_changes->'commercial_presentation' ? 'dimensions' AND p_product_changes->'commercial_presentation'->'dimensions'<>'null'::jsonb THEN
    dimensions:=coalesce(product.commercial_presentation->'dimensions','{}'::jsonb)||(p_product_changes->'commercial_presentation'->'dimensions');
    presentation:=jsonb_set(presentation,'{dimensions}',dimensions);
   END IF;
   IF NOT erp_private.valid_product_commercial_presentation(presentation) THEN RAISE EXCEPTION 'Confira as medidas da peça e a descrição comercial.'; END IF;
  END IF;
 END IF;
 IF p_product_changes ? 'shipping_package' THEN
  packaging:=nullif(p_product_changes->'shipping_package','null'::jsonb);
  IF NOT erp_private.product_shipping_package_valid(packaging) THEN RAISE EXCEPTION 'Confira as medidas e o peso da embalagem.'; END IF;
 END IF;
 IF p_settings->'published'='true'::jsonb AND EXISTS(SELECT 1 FROM unnest(ARRAY['length_cm','width_cm','height_cm','weight_grams']) key WHERE jsonb_typeof(packaging->key) IS DISTINCT FROM 'number') THEN
  RAISE EXCEPTION 'Complete comprimento, largura, altura e peso total embalado antes de publicar.';
 END IF;
 shipping_changed:=packaging IS DISTINCT FROM product.shipping_package;
 changed:=new_description IS DISTINCT FROM product.description OR presentation IS DISTINCT FROM product.commercial_presentation OR shipping_changed;
 IF changed AND NOT shipping_changed THEN
  FOR price IN SELECT cp.* FROM product_channel_prices cp WHERE cp.tenant_id=t AND cp.product_id=product.id ORDER BY cp.channel FOR UPDATE LOOP
   SELECT * INTO accepted FROM product_channel_pricing_acceptances WHERE id=price.acceptance_id AND tenant_id=t AND product_id=product.id AND channel=price.channel;
   IF accepted.id IS NULL OR accepted.unit_price IS DISTINCT FROM price.unit_price THEN CONTINUE; END IF;
   cost_context:=CASE WHEN accepted.snapshot->>'cost_source'='simulation' THEN accepted.snapshot->'cost_snapshot'->'cost_context' END;
   BEGIN
    before_preview:=erp_private.channel_preview(product.id,t,price.channel,accepted.quantity,coalesce(accepted.snapshot->'assumptions','{}'::jsonb),price.unit_price,cost_context);
    IF before_preview->>'complete'='true' AND before_preview->>'cost_revision'=accepted.cost_revision AND before_preview->>'policy_revision'=accepted.policy_revision
     AND (before_preview->>'unit_cost')::numeric=accepted.unit_cost AND (before_preview->'result'->>'target')::numeric=accepted.unit_price THEN
     candidates:=candidates||jsonb_build_array(jsonb_build_object('channel',price.channel,'acceptance_id',accepted.id,'unit_cost',accepted.unit_cost,'unit_price',accepted.unit_price,
      'policy_revision',accepted.policy_revision,'quantity',accepted.quantity,'assumptions',accepted.snapshot->'assumptions','cost_context',cost_context,
      'metadata',CASE WHEN accepted.snapshot ? 'official_quote' THEN jsonb_build_object('official_quote',accepted.snapshot->'official_quote','listing_type_id',accepted.snapshot->>'listing_type_id') ELSE '{}'::jsonb END));
    END IF;
   EXCEPTION WHEN OTHERS THEN NULL; -- Incomplete economics remain pending.
   END;
  END LOOP;
 END IF;
 IF changed THEN
  UPDATE products SET description=new_description,commercial_presentation=presentation,shipping_package=packaging,updated_at=clock_timestamp() WHERE id=product.id AND tenant_id=t;
 END IF;
 -- Any validation error here rolls back the product update, audit and request.
 result:=public.save_storefront_listing(p_channel_id,product.id,p_settings);
 FOR candidate IN SELECT value FROM jsonb_array_elements(candidates) LOOP
  SELECT cp.* INTO price FROM product_channel_prices cp WHERE cp.tenant_id=t AND cp.product_id=product.id AND cp.channel=candidate->>'channel' FOR UPDATE;
  IF price.acceptance_id::text IS DISTINCT FROM candidate->>'acceptance_id' OR price.unit_price IS DISTINCT FROM (candidate->>'unit_price')::numeric THEN CONTINUE; END IF;
  BEGIN
   after_preview:=erp_private.channel_preview(product.id,t,price.channel,(candidate->>'quantity')::integer,coalesce(candidate->'assumptions','{}'::jsonb),price.unit_price,nullif(candidate->'cost_context','null'::jsonb));
   IF after_preview->>'complete'='true' AND (after_preview->>'unit_cost')::numeric=(candidate->>'unit_cost')::numeric
    AND after_preview->>'policy_revision'=candidate->>'policy_revision' AND (after_preview->'result'->>'target')::numeric=price.unit_price THEN
    reaccepted:=erp_private.accept_channel_preview(product.id,t,after_preview||(candidate->'metadata'));
    renewed:=renewed||jsonb_build_array(reaccepted);
   END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
 END LOOP;
 SELECT p.* INTO product FROM products p WHERE p.id=p_product_id AND p.tenant_id=t;
 SELECT * INTO listing FROM storefront_listings WHERE id=result AND tenant_id=t;
 receipt:=jsonb_build_object('saved',true,'listing_id',result,'product_updated_at',product.updated_at,'listing_updated_at',listing.updated_at,'replayed',false);
 INSERT INTO erp_private.storefront_product_detail_receipts(tenant_id,request_id,actor_id,result) VALUES(t,p_request_id,auth.uid(),receipt);
 IF changed THEN INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'storefront_product_details','products',product.id,
  jsonb_build_object('channel_id',p_channel_id,'changed_fields',(SELECT jsonb_agg(key) FROM jsonb_object_keys(p_product_changes) key),'shipping_changed',shipping_changed,'renewed_acceptances',renewed)); END IF;
 PERFORM erp_private.finish_request(t,p_request_id,result);
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.save_storefront_product_details(uuid,uuid,jsonb,jsonb,timestamptz,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_storefront_product_details(uuid,uuid,jsonb,jsonb,timestamptz,timestamptz,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
