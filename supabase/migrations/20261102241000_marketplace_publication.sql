-- Publication reads the same stock evidence as synchronization, including paid
-- orders and holds. A new product has no marketplace binding yet.
DO $migration$
DECLARE definition text; previous text;
BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.marketplace_stock_preview_snapshot(uuid,uuid[])')) IS DISTINCT FROM '88ec26cfafa2cf7a5c509dd61463cbca' THEN
  RAISE EXCEPTION 'Review the canonical marketplace stock snapshot before publication.';
 END IF;
 SELECT pg_get_functiondef('public.marketplace_stock_preview_snapshot(uuid,uuid[])'::regprocedure) INTO definition;
 previous:=definition;
 definition:=replace(definition,'public.marketplace_stock_preview_snapshot(','erp_private.publication_stock_snapshot(');
 definition:=replace(definition,'OR NOT EXISTS(SELECT 1 FROM marketplace_sku_bindings sb WHERE sb.account_id=a.id AND sb.tenant_id=t AND sb.product_id=requested.id)','');
 IF definition=previous OR position('erp_private.publication_stock_snapshot(' in definition)=0
  OR position('OR NOT EXISTS(SELECT 1 FROM marketplace_sku_bindings sb WHERE sb.account_id=a.id AND sb.tenant_id=t AND sb.product_id=requested.id)' in definition)>0 THEN
  RAISE EXCEPTION 'Canonical publication snapshot adapter did not match.';
 END IF;
 EXECUTE definition;
END $migration$;
REVOKE ALL ON FUNCTION erp_private.publication_stock_snapshot(uuid,uuid[]) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.integrador_publication_snapshot(p_account_id uuid,p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); evidence jsonb; product products; material inventory_items; price product_channel_prices;
 accepted product_channel_pricing_acceptances; fresh jsonb; photos jsonb; bindings jsonb; availability integer; uncovered integer; complete boolean;
 product_value jsonb; price_value jsonb; stock_value jsonb; revision text; material_name text;
BEGIN
 evidence:=erp_private.publication_stock_snapshot(p_account_id,ARRAY[p_product_id]);
 SELECT * INTO product FROM products WHERE id=p_product_id AND tenant_id=t;
 IF product.id IS NULL THEN RAISE EXCEPTION 'Produto não encontrado nesta empresa.' USING ERRCODE='42501'; END IF;
 SELECT * INTO material FROM inventory_items WHERE id=product.material_id AND tenant_id=t;
 SELECT string_agg(DISTINCT coalesce(c.label,req.material_code),', ' ORDER BY coalesce(c.label,req.material_code)) INTO material_name
 FROM product_material_requirements req JOIN product_material_recipe_versions rv ON rv.id=req.recipe_version_id AND rv.tenant_id=t AND rv.is_current
 LEFT JOIN product_print_plates pp ON pp.id=rv.plate_id AND pp.tenant_id=t AND pp.product_id=product.id
 LEFT JOIN material_code_catalog c ON c.code=req.material_code
 WHERE req.product_id=product.id AND req.tenant_id=t AND req.material_ready AND (rv.plate_id IS NULL OR pp.is_active);
 IF material_name IS NULL THEN
  SELECT coalesce(c.label,material.material_code) INTO material_name FROM material_code_catalog c WHERE c.code=material.material_code;
 END IF;
 SELECT * INTO price FROM product_channel_prices WHERE tenant_id=t AND product_id=product.id AND channel='mercado_livre';
 SELECT * INTO accepted FROM product_channel_pricing_acceptances WHERE id=price.acceptance_id AND tenant_id=t AND product_id=product.id AND channel='mercado_livre';
 IF accepted.id IS NOT NULL AND accepted.quantity=1 THEN
  BEGIN
   fresh:=erp_private.channel_preview(product.id,t,'mercado_livre',1,coalesce(accepted.snapshot->'assumptions','{}'::jsonb),price.unit_price,
    CASE WHEN accepted.snapshot->>'cost_source'='simulation' THEN accepted.snapshot->'cost_snapshot'->'cost_context' END);
  EXCEPTION WHEN OTHERS THEN fresh:=NULL;
  END;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('url',ph.url) ORDER BY ph.sort_order,ph.id),'[]') INTO photos FROM product_photos ph
  WHERE ph.product_id=product.id AND ph.tenant_id=t AND ph.url ~ '^https://[^/@]+(/|$)';
 IF jsonb_array_length(photos)=0 AND product.photo_url ~ '^https://[^/@]+(/|$)' THEN photos:=jsonb_build_array(jsonb_build_object('url',product.photo_url)); END IF;
 bindings:=coalesce((SELECT jsonb_agg(jsonb_build_object('item_id',sb.external_item_id,'variation_id',sb.external_variant_id,'account_id',sb.account_id,'seller_id',a.external_seller_id,'channel',a.channel) ORDER BY sb.account_id,sb.id)
  FROM marketplace_sku_bindings sb JOIN marketplace_accounts a ON a.id=sb.account_id AND a.tenant_id=t WHERE sb.product_id=product.id AND sb.tenant_id=t),'[]');
 availability:=(evidence->'products'->0->>'available')::integer;
 SELECT coalesce(sum(greatest(0,(entry->>'quantity')::integer-(entry->>'quantityAlreadyAccounted')::integer)),0)::integer INTO uncovered
  FROM jsonb_array_elements(evidence->'externalPaidOrders') entry WHERE entry->>'productId'=product.id::text;
 complete:=coalesce((evidence->>'localInboxComplete')::boolean,false) AND availability IS NOT NULL
  AND coalesce((evidence->'products'->0->>'stockComplete')::boolean,false);
 product_value:=jsonb_build_object('id',product.id,'name',product.name,'sku',product.sku,'description',product.description,'photos',photos,
  'commercial_presentation',product.commercial_presentation,'shipping_package',product.shipping_package,'material_name',material_name,
  'is_active',product.is_active,'is_component',product.is_component,'revision',md5(to_jsonb(product)::text));
 price_value:=jsonb_build_object('unit_price',price.unit_price,'currency','BRL','quantity',1,'acceptance_id',accepted.id,'cost_revision',accepted.cost_revision,
  'policy_revision',accepted.policy_revision,'complete',accepted.id IS NOT NULL AND accepted.quantity=1 AND fresh->>'complete'='true'
   AND fresh->>'cost_revision'=accepted.cost_revision AND fresh->>'policy_revision'=accepted.policy_revision
   AND price.unit_price=accepted.unit_price AND price.unit_price>0);
 stock_value:=jsonb_build_object('available',CASE WHEN complete THEN greatest(0,availability-uncovered) END,'complete',complete,'revision',evidence->>'revision',
  'unaccounted_paid_quantity',uncovered,'missing',evidence->'missing');
 revision:=encode(sha256(convert_to(jsonb_build_array(product_value,price_value,stock_value,bindings,evidence->'bridgeId',evidence->'sellerId')::text,'UTF8')),'hex');
 RETURN jsonb_build_object('tenant_id',t,'bridge_id',evidence->'bridgeId','account_id',p_account_id,'seller_id',evidence->'sellerId',
  'product',product_value,'price',price_value,'stock',stock_value,'bindings',bindings,'revision',revision);
END $$;

-- Only the authenticated financial operator AND the private Source proof can
-- confirm a remotely created listing. The proof is never returned to the UI.
CREATE FUNCTION public.confirm_integrador_publication_link(p_bridge_id uuid,p_account_id uuid,p_product_id uuid,p_item_id text,p_seller_id text,p_source_proof text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); b integrador_bridge_bindings; a marketplace_accounts; product products; result uuid; prior uuid;
BEGIN
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=p_bridge_id AND tenant_id=t AND enabled FOR UPDATE;
 SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t AND channel='mercado_livre' FOR UPDATE;
 IF b.id IS NULL OR a.id IS NULL OR a.external_seller_id IS DISTINCT FROM p_seller_id OR NOT(p_seller_id=ANY(b.approved_seller_ids))
  OR NOT EXISTS(SELECT 1 FROM integrador_marketplace_account_links WHERE account_id=a.id AND tenant_id=t AND bridge_id=b.id AND source_seller_id=p_seller_id)
  OR coalesce(p_source_proof,'') !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM erp_private.integrador_enrollment_proofs WHERE bridge_id=b.id AND enabled
   AND proof_sha256=encode(sha256(convert_to(p_source_proof,'UTF8')),'hex')) THEN
  RAISE EXCEPTION 'A publicação precisa ser confirmada pelo servidor Mercado Livre desta empresa.' USING ERRCODE='42501';
 END IF;
 IF coalesce(p_item_id,'') !~ '^MLB[0-9]{1,24}$' OR p_request_id IS NULL THEN RAISE EXCEPTION 'Identificação da publicação inválida.'; END IF;
 prior:=erp_private.begin_request(t,p_request_id,'integrador_publication_link',jsonb_build_array(b.id,a.id,p_product_id,p_item_id,p_seller_id));
 IF prior IS NOT NULL THEN RETURN jsonb_build_object('linked',true,'binding_id',prior,'replayed',true); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO product FROM products WHERE id=p_product_id AND tenant_id=t AND is_active AND NOT is_component FOR UPDATE;
 IF product.id IS NULL THEN RAISE EXCEPTION 'Confira o produto da publicação antes de confirmar o vínculo.'; END IF;
 IF EXISTS(SELECT 1 FROM marketplace_sku_bindings WHERE tenant_id=t AND account_id=a.id AND external_item_id=p_item_id AND product_id<>product.id)
  OR EXISTS(SELECT 1 FROM marketplace_sku_bindings WHERE tenant_id=t AND product_id=product.id AND (account_id<>a.id OR external_item_id<>p_item_id)) THEN
  RAISE EXCEPTION 'O produto ou anúncio ganhou outro vínculo. Confira o estoque antes de continuar.';
 END IF;
 result:=public.save_marketplace_sku_binding(a.id,p_item_id,'',coalesce(nullif(btrim(product.sku),''),'FORGE-'||product.id::text),product.id,true);
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'marketplace_publication_link','products',product.id,
  jsonb_build_object('account_id',a.id,'seller_id',p_seller_id,'item_id',p_item_id,'binding_id',result,'requires_manual_review',true));
 PERFORM erp_private.finish_request(t,p_request_id,result);
 RETURN jsonb_build_object('linked',true,'binding_id',result,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.integrador_publication_snapshot(uuid,uuid),public.confirm_integrador_publication_link(uuid,uuid,uuid,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.integrador_publication_snapshot(uuid,uuid),public.confirm_integrador_publication_link(uuid,uuid,uuid,text,text,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
