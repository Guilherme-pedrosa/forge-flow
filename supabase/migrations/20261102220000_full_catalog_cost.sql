-- The daily catalog, detailed simulation and commercial readers use the same
-- full manufacturing formula. Commercial completeness does not rewrite the
-- physical recipe or its readiness/history.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('public.product_material_recipe_catalog()','b37a548b84b6715dce1aafc789021c79','b764af0a2728e62a2f1558218da716e0'),
  ('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)','e210a4b4af233c3a6a853c4fbf131d81','4995095582579f697392881612a595ee'),
  ('erp_private.commercial_cost_snapshot(jsonb,uuid,uuid)','a97b81e9efbacfcfcf9fc166c5e14ed1','686954cc11832b48bcb6bcdf5f6c722d'),
  ('erp_private.pricing_plate(uuid,uuid,numeric,jsonb,jsonb)','7eb2b904318769d6d18775c6b245f01c','1520b55645f627fd374a569613ed3bf4')
 ) expected(signature,original_hash,patched_hash) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
 WHERE md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM expected.original_hash
  AND md5(replace(p.prosrc,chr(13),'')) IS DISTINCT FROM expected.patched_hash) THEN
  RAISE EXCEPTION 'Review the full catalog pricing functions before applying this migration.';
 END IF;
 IF to_regprocedure('erp_private.catalog_pricing_snapshot(uuid,uuid)') IS NOT NULL
  AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('erp_private.catalog_pricing_snapshot(uuid,uuid)'))
   IS DISTINCT FROM '458c0b2072ab3b1ceca960cc41e04ad9' THEN RAISE EXCEPTION 'Review the canonical catalog pricing helper before replacing it.'; END IF;
END $$;

-- Explicit per-plate null remains unknown. Without that override, a confirmed
-- physical printer rate is the same final fallback used by the import UI.
DO $$ DECLARE definition text; source_hash text;
 needle text:=' kwh:=(p_policy->>''energy_cost_kwh'')::numeric;';
 replacement text:=$rate$ IF rate IS NULL AND NOT(po ? 'machine_hour_cost') THEN
  IF erp_private.valid_number(machine.maintenance_cost_per_hour) THEN
   IF erp_private.valid_number(machine.depreciation_per_hour) THEN
    rate:=machine.depreciation_per_hour+machine.maintenance_cost_per_hour;
   ELSIF machine.depreciation_per_hour IS NULL AND erp_private.valid_number(machine.acquisition_cost)
    AND erp_private.valid_number(machine.useful_life_hours,1) THEN
    rate:=machine.acquisition_cost/machine.useful_life_hours+machine.maintenance_cost_per_hour;
   END IF;
  END IF;
 END IF;
 kwh:=(p_policy->>'energy_cost_kwh')::numeric;$rate$;
BEGIN
 SELECT pg_get_functiondef(p.oid),md5(replace(p.prosrc,chr(13),'')) INTO definition,source_hash
 FROM pg_proc p WHERE p.oid=to_regprocedure('erp_private.pricing_plate(uuid,uuid,numeric,jsonb,jsonb)');
 IF source_hash='1520b55645f627fd374a569613ed3bf4' THEN RETURN; END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Review the printer rate fallback.'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;

CREATE OR REPLACE FUNCTION erp_private.catalog_pricing_snapshot(p_product uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE bom jsonb; preview jsonb; stock_state jsonb; cost numeric; complete boolean;
BEGIN
 bom:=erp_private.product_bom_snapshot(p_product,p_tenant);
 preview:=erp_private.pricing_product(p_product,p_tenant,1,erp_private.read_pricing_settings(p_tenant),'{}','{}');
 cost:=(preview->'breakdown'->>'unit_cost')::numeric;
 complete:=preview->>'complete'='true' AND erp_private.valid_number(cost);
 -- A same-price receipt/count still changes the stock snapshot used by this
 -- quote. Legacy unplated previews omit their computed material lines; their
 -- BOM and actual technical sheet/material still identify those dependencies.
 WITH preview_products AS (
  SELECT p.*,erp_private.read_piece_spec(p.id,p_tenant) AS technical FROM products p
  WHERE p.tenant_id=p_tenant AND p.id::text IN
   (SELECT DISTINCT value#>>'{}' FROM jsonb_path_query(preview,'$.**.product_id') AS ids(value))
   AND NOT EXISTS(SELECT 1 FROM product_print_plates pp WHERE pp.product_id=p.id AND pp.tenant_id=p_tenant AND pp.is_active)
   AND NOT EXISTS(SELECT 1 FROM product_subitems s WHERE s.product_id=p.id AND s.tenant_id=p_tenant)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.extras,'[]')) e WHERE e ? '_kit_product_id')
 ), used_items AS (
  SELECT value#>>'{}' AS id FROM jsonb_path_query(preview,'$.**.item_id') AS ids(value)
  UNION SELECT value#>>'{}' FROM jsonb_path_query(bom,'$.**.item_id') AS ids(value)
  UNION SELECT value#>>'{}' FROM preview_products p CROSS JOIN LATERAL jsonb_path_query(p.technical,'$.materials[*].item_id') AS ids(value)
  UNION SELECT material_id::text FROM preview_products WHERE technical->>'source'='unknown'
 )
 SELECT coalesce(jsonb_agg(jsonb_build_array(i.id,i.unit,i.current_stock,i.avg_cost,i.is_active,i.updated_at) ORDER BY i.id),'[]') INTO stock_state
 FROM inventory_items i WHERE i.tenant_id=p_tenant AND i.id::text IN(SELECT id FROM used_items);
 RETURN jsonb_build_object('bom',bom,'preview',preview,'revision',md5(jsonb_build_array(bom,preview->>'revision',stock_state)::text),
  'stock_revision',md5(stock_state::text),'complete',coalesce(complete,false),'missing',coalesce(preview->'missing','[]'),
  'cost_per_unit',CASE WHEN complete THEN cost END);
END $$;
REVOKE ALL ON FUNCTION erp_private.catalog_pricing_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.product_material_recipe_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH snapshots AS MATERIALIZED (SELECT p.id,erp_private.catalog_pricing_snapshot(p.id,p.tenant_id) AS pricing
  FROM products p WHERE p.tenant_id=get_user_tenant_id() AND auth.uid() IS NOT NULL)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,
  'configured',jsonb_array_length(coalesce(pricing->'bom'->'requirements','[]'))>0,
  'complete',pricing->'complete','cost_per_unit',pricing->'cost_per_unit',
  'plate_count',jsonb_array_length(coalesce(pricing->'bom'->'plates','[]')),
  'missing',pricing->'missing','revision',pricing->>'revision','cost_scope','full_manufacturing')),'[]') FROM snapshots
$$;
REVOKE ALL ON FUNCTION public.product_material_recipe_catalog() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_material_recipe_catalog() TO authenticated;

CREATE OR REPLACE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; config jsonb; before_pricing jsonb; after_pricing jsonb;
 bom jsonb; after_bom jsonb; details jsonb; source text; price_source text; percent numeric; base numeric; total numeric; price numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF result IS NOT NULL THEN RETURN result; END IF;
 config:=p_product->'catalog_pricing';
 IF config IS NOT NULL THEN
  IF jsonb_typeof(config)<>'object' THEN RAISE EXCEPTION 'Configuração de preço inválida.'; END IF;
  source:=config->>'cost_source';price_source:=config->>'price_source';
  IF source IS NULL OR source NOT IN('manual','composition') OR price_source IS NULL OR price_source NOT IN('manual','markup') THEN
   RAISE EXCEPTION 'Confira a origem do custo e do preço.';
  END IF;
  -- Pricing settings and detailed acceptance already use this lock order.
  -- Keep one company policy while checking and saving the original payload.
  IF source='composition' THEN PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0)); END IF;
  IF p_product_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
   PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
  END IF;
  details:=p_product->'catalog_details';base:=(details->>'base_cost')::numeric;total:=(p_product->>'manual_cost')::numeric;price:=(p_product->>'sale_price')::numeric;
  IF source='composition' THEN
   IF p_product_id IS NULL OR p_product ? 'file_composition' OR p_product ? 'import_composition' THEN
    RAISE EXCEPTION 'Salve e confira a composição antes de usar seu custo.';
   END IF;
   before_pricing:=erp_private.catalog_pricing_snapshot(p_product_id,t);bom:=before_pricing->'bom';
   IF config->>'expected_composition_revision' IS DISTINCT FROM before_pricing->>'revision' THEN
    RAISE EXCEPTION 'A composição ou seus custos mudaram. Atualize os valores antes de salvar.';
   END IF;
   IF before_pricing->>'complete' IS DISTINCT FROM 'true' OR before_pricing->>'cost_per_unit' IS NULL
    OR base IS NULL OR round(base,6) IS DISTINCT FROM round((before_pricing->>'cost_per_unit')::numeric,6) THEN
    RAISE EXCEPTION 'Complete a composição e os custos de produção antes de salvar.';
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
 -- Keep the exact nested request identity; never synthesize a different save.
 result:=erp_private.save_product_before_live_pricing(p_product_id,p_product,p_photos,p_request_id);
 IF source='composition' THEN
  after_pricing:=erp_private.catalog_pricing_snapshot(result,t);after_bom:=after_pricing->'bom';
  IF jsonb_set(after_bom,'{product}',(after_bom->'product')-ARRAY['name','sku','category','cost_estimate','sale_price'])
   IS DISTINCT FROM jsonb_set(bom,'{product}',(bom->'product')-ARRAY['name','sku','category','cost_estimate','sale_price']) THEN
   RAISE EXCEPTION 'A composição mudou neste cadastro. Salve a produção com custo manual ou confira a composição antes de calcular o preço.';
  END IF;
  IF after_pricing->>'complete' IS DISTINCT FROM 'true'
   OR after_pricing->'cost_per_unit' IS DISTINCT FROM before_pricing->'cost_per_unit'
   OR after_pricing->'stock_revision' IS DISTINCT FROM before_pricing->'stock_revision'
   OR after_pricing->'preview'->'breakdown' IS DISTINCT FROM before_pricing->'preview'->'breakdown'
   OR after_pricing->'preview'->'technical_breakdown' IS DISTINCT FROM before_pricing->'preview'->'technical_breakdown'
   OR after_pricing->'preview'->'production_breakdown' IS DISTINCT FROM before_pricing->'preview'->'production_breakdown'
   OR after_pricing->'preview'->'plan' IS DISTINCT FROM before_pricing->'preview'->'plan'
   OR after_pricing->'preview'->'settings_revision' IS DISTINCT FROM before_pricing->'preview'->'settings_revision' THEN
   RAISE EXCEPTION 'Os custos completos mudaram neste cadastro. Atualize o cálculo antes de salvar.';
  END IF;
 END IF;
 UPDATE products SET catalog_details=catalog_details||jsonb_build_object('cost_source',coalesce(source,'manual'),
  'price_source',coalesce(price_source,'manual'),'markup_percent',CASE WHEN price_source='markup' THEN percent END),
  manual_cost_override=CASE WHEN source='composition' THEN NULL ELSE manual_cost_override END WHERE id=result AND tenant_id=t;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION erp_private.commercial_cost_snapshot(p_snapshot jsonb,p_product uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE product products; pricing jsonb; cost numeric;
BEGIN
 SELECT * INTO product FROM products WHERE id=p_product AND tenant_id=p_tenant;
 cost:=product.manual_cost_override;
 IF product.catalog_details->>'cost_source'='composition' THEN
  pricing:=erp_private.catalog_pricing_snapshot(p_product,p_tenant);
  cost:=CASE WHEN pricing->>'complete'='true' THEN round((pricing->>'cost_per_unit')::numeric
   +coalesce((product.catalog_details->>'accessory_cost')::numeric,0)+coalesce((product.catalog_details->>'other_cost')::numeric,0),4) END;
 END IF;
 RETURN p_snapshot||jsonb_build_object('commercial_cost',cost);
END $$;
REVOKE ALL ON FUNCTION erp_private.commercial_cost_snapshot(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
