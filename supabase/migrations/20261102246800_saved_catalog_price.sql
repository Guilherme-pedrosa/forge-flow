-- The commercial cost already accepted in Products is also the cost used by
-- marketplace pricing. Expose that same source independently of an incomplete
-- technical recipe, without claiming that production is ready.
CREATE FUNCTION public.product_catalog_cost(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); cost jsonb;
BEGIN
 cost:=erp_private.channel_catalog_cost(p_product_id,t);
 RETURN jsonb_build_object('product_id',p_product_id,'source',cost->'source','complete',cost->'complete',
  'unit_cost',cost->'cost_per_unit','revision',cost->'revision','missing',cost->'missing');
END $$;

CREATE FUNCTION public.apply_saved_catalog_price(p_product_id uuid,p_quantity integer,p_expected_cost_revision text,p_unit_price numeric,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; cost jsonb; snapshot jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'saved_catalog_price',jsonb_build_array(p_product_id,p_quantity,p_expected_cost_revision,p_unit_price));
 IF result IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM product_pricing_acceptances WHERE id=result AND tenant_id=t AND product_id=p_product_id AND created_by=auth.uid()) THEN
   RAISE EXCEPTION 'A confirmação desta solicitação pertence a outro operador.' USING ERRCODE='42501';
  END IF;
  RETURN result;
 END IF;
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 OR NOT erp_private.valid_number(p_unit_price,0.01)
  OR p_unit_price>1000000000 OR p_unit_price<>round(p_unit_price,2) THEN RAISE EXCEPTION 'Confira a quantidade e o preço de venda em centavos.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.' USING ERRCODE='42501'; END IF;
 cost:=erp_private.channel_catalog_cost(p_product_id,t);
 IF cost->>'source' IS DISTINCT FROM 'manual' OR cost->>'complete' IS DISTINCT FROM 'true'
  OR p_expected_cost_revision IS DISTINCT FROM cost->>'revision' THEN
  RAISE EXCEPTION 'O custo ou sua origem mudou. Atualize a prévia antes de salvar o preço.' USING ERRCODE='40001';
 END IF;
 snapshot:=jsonb_build_object('basis','saved_catalog_cost','quantity',p_quantity,'unit_cost',cost->'cost_per_unit',
  'unit_price',p_unit_price,'cost_snapshot',cost,'production_readiness_confirmed',false);
 INSERT INTO product_pricing_acceptances(tenant_id,product_id,quantity,cost_basis,unit_cost,unit_price,preview_revision,snapshot,created_by)
 VALUES(t,p_product_id,p_quantity,'unit',(cost->>'cost_per_unit')::numeric,p_unit_price,p_expected_cost_revision,snapshot,auth.uid()) RETURNING id INTO result;
 -- Only the base sale price changes. Costs, recipe, photos and stock remain the
 -- original accepted records, even when the technical import is still pending.
 UPDATE products SET sale_price=p_unit_price,
  catalog_details=coalesce(catalog_details,'{}'::jsonb)||jsonb_build_object('price_source','manual','markup_percent',NULL)
 WHERE id=p_product_id AND tenant_id=t;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
 VALUES(t,auth.uid(),'apply_saved_catalog_price','products',p_product_id,jsonb_build_object('acceptance_id',result,'unit_cost',cost->'cost_per_unit','unit_price',p_unit_price));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.product_catalog_cost(uuid),public.apply_saved_catalog_price(uuid,integer,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_catalog_cost(uuid),public.apply_saved_catalog_price(uuid,integer,text,numeric,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
