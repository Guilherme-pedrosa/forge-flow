-- Keep the daily pricing workflow in the product editor. Legacy callers keep manual semantics.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
   ('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)','14d9d52750e86545fb4b5785928e33f9'),
   ('public.product_material_recipe_catalog()','8831e973639f150c4775a04a0543d15b'),
   ('public.apply_product_pricing(uuid,integer,jsonb,text,uuid,numeric)','1b7bb9b60e83050e89109301b6341df3'),
   ('erp_private.commercial_cost_snapshot(jsonb,uuid,uuid)','c2ddc022a61230dcd5dd1ca35b822621')
 ) expected(signature,hash) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
 WHERE md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM expected.hash) THEN
   RAISE EXCEPTION 'Review the live catalog pricing functions before applying this migration.';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.product_material_recipe_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH snapshots AS MATERIALIZED (SELECT p.id,erp_private.product_bom_snapshot(p.id,p.tenant_id) AS bom
   FROM products p WHERE p.tenant_id=get_user_tenant_id() AND auth.uid() IS NOT NULL)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'configured',jsonb_array_length(bom->'requirements')>0,
   'complete',bom->'complete','cost_per_unit',bom->'cost_per_unit','plate_count',jsonb_array_length(bom->'plates'),
   'missing',bom->'missing','revision',md5(bom::text))),'[]') FROM snapshots
$$;

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_live_pricing;
REVOKE ALL ON FUNCTION erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; config jsonb; bom jsonb; after_bom jsonb; details jsonb;
 source text; price_source text; percent numeric; base numeric; total numeric; price numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF result IS NOT NULL THEN RETURN result; END IF;
 config:=p_product->'catalog_pricing';
 IF config IS NOT NULL THEN
   IF jsonb_typeof(config)<>'object' THEN RAISE EXCEPTION 'Configuração de preço inválida.'; END IF;
   source:=config->>'cost_source'; price_source:=config->>'price_source';
   IF source IS NULL OR source NOT IN ('manual','composition') OR price_source IS NULL OR price_source NOT IN ('manual','markup') THEN
     RAISE EXCEPTION 'Confira a origem do custo e do preço.';
   END IF;
   IF p_product_id IS NOT NULL THEN
     PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
     PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
   END IF;
   details:=p_product->'catalog_details';
   base:=(details->>'base_cost')::numeric; total:=(p_product->>'manual_cost')::numeric; price:=(p_product->>'sale_price')::numeric;
   IF source='composition' THEN
     IF p_product_id IS NULL OR p_product ? 'file_composition' OR p_product ? 'import_composition' THEN
       RAISE EXCEPTION 'Salve e confira a composição antes de usar seu custo.';
     END IF;
     bom:=erp_private.product_bom_snapshot(p_product_id,t);
     IF config->>'expected_composition_revision' IS DISTINCT FROM md5(bom::text) THEN
       RAISE EXCEPTION 'A composição ou seus custos mudaram. Atualize os valores antes de salvar.';
     END IF;
     IF bom->>'complete' IS DISTINCT FROM 'true' OR bom->>'cost_per_unit' IS NULL
       OR base IS NULL OR round(base,6) IS DISTINCT FROM round((bom->>'cost_per_unit')::numeric,6) THEN
       RAISE EXCEPTION 'Complete a composição e confira seu custo antes de salvar.';
     END IF;
   END IF;
   IF price_source='markup' THEN
     percent:=(config->>'markup_percent')::numeric;
     IF NOT erp_private.valid_number(percent) OR percent>100000 OR NOT erp_private.valid_number(total)
       OR price IS NULL OR price IS DISTINCT FROM round(total*(1+percent/100),2) THEN
       RAISE EXCEPTION 'O preço deve corresponder ao custo final acrescido do percentual informado.';
     END IF;
   END IF;
 END IF;
 result:=erp_private.save_product_before_live_pricing(p_product_id,p_product,p_photos,p_request_id);
 IF source='composition' THEN
   after_bom:=erp_private.product_bom_snapshot(result,t);
   -- Editing a name or commercial values is allowed; changing the recipe in this save is not.
   IF jsonb_set(after_bom,'{product}',(after_bom->'product')-ARRAY['name','sku','cost_estimate','sale_price'])
      IS DISTINCT FROM jsonb_set(bom,'{product}',(bom->'product')-ARRAY['name','sku','cost_estimate','sale_price']) THEN
     RAISE EXCEPTION 'A composição mudou neste cadastro. Salve a produção com custo manual ou confira a composição antes de calcular o preço.';
   END IF;
 END IF;
 -- Store the chosen workflow. The snapshot remains available to existing commercial readers.
 UPDATE products SET catalog_details=catalog_details||jsonb_build_object('cost_source',coalesce(source,'manual'),
   'price_source',coalesce(price_source,'manual'),'markup_percent',CASE WHEN price_source='markup' THEN percent END),
   manual_cost_override=CASE WHEN source='composition' THEN NULL ELSE manual_cost_override END
 WHERE id=result AND tenant_id=t;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

-- Quotes must include the editor's per-unit expenses even without a manual cost override.
CREATE OR REPLACE FUNCTION erp_private.commercial_cost_snapshot(p_snapshot jsonb,p_product uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE product products; cost numeric;
BEGIN
 SELECT * INTO product FROM products WHERE id=p_product AND tenant_id=p_tenant;
 cost:=product.manual_cost_override;
 IF product.catalog_details->>'cost_source'='composition' THEN
   cost:=CASE WHEN p_snapshot->>'complete'='true' AND p_snapshot->>'cost_per_unit' IS NOT NULL
     THEN round((p_snapshot->>'cost_per_unit')::numeric+coalesce((product.catalog_details->>'accessory_cost')::numeric,0)
       +coalesce((product.catalog_details->>'other_cost')::numeric,0),4) END;
 END IF;
 RETURN p_snapshot||jsonb_build_object('commercial_cost',cost);
END $$;

-- An explicit advanced acceptance supersedes the daily editor's previous percentage/mode.
CREATE OR REPLACE FUNCTION public.apply_product_pricing(p_product_id uuid,p_quantity integer,p_overrides jsonb,p_expected_revision text,p_request_id uuid,p_unit_price numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; preview jsonb; cost numeric; price numeric; BEGIN
 result:=erp_private.begin_request(t,p_request_id,'apply_product_pricing',jsonb_build_array(p_product_id,p_quantity,p_overrides,p_expected_revision,p_unit_price)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 preview:=public.product_pricing_preview(p_product_id,p_quantity,p_overrides);
 IF p_expected_revision IS DISTINCT FROM preview->>'revision' THEN RAISE EXCEPTION 'Custos ou parâmetros mudaram. Atualize a simulação antes de aplicar.'; END IF;
 IF preview->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Complete os parâmetros antes de aplicar a precificação.'; END IF;
 cost:=(preview->'breakdown'->>'unit_cost')::numeric; price:=coalesce(p_unit_price,(preview->>'suggested_unit_price')::numeric);
 IF NOT erp_private.valid_number(cost) OR cost>1000000000 OR NOT erp_private.valid_number(price,0.01) OR price>1000000000 OR price<>round(price,2) THEN RAISE EXCEPTION 'Custo ou preço aceito fora do limite.'; END IF;
 INSERT INTO product_pricing_acceptances(tenant_id,product_id,quantity,cost_basis,unit_cost,unit_price,preview_revision,snapshot,created_by)
 VALUES(t,p_product_id,p_quantity,preview->>'cost_basis',cost,price,p_expected_revision,preview,auth.uid()) RETURNING id INTO result;
 UPDATE products SET manual_cost_override=round(cost,6),cost_estimate=round(cost,6),sale_price=price,
 catalog_details=coalesce(catalog_details,'{}')||jsonb_build_object('base_cost',round(cost,6),'accessory_cost',0,'other_cost',0,
   'cost_source','manual','price_source','manual','markup_percent',NULL)
 WHERE id=p_product_id AND tenant_id=t;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'apply_product_pricing','products',p_product_id,jsonb_build_object('acceptance_id',result,'unit_cost',cost,'unit_price',price,'preview_revision',p_expected_revision));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
