-- The original snapshot remains the sole physical stock oracle. Channel prices
-- additionally require the same current cost/policy proof used by publication.
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.marketplace_stock_preview_snapshot(uuid,uuid[])')) IS DISTINCT FROM '88ec26cfafa2cf7a5c509dd61463cbca' THEN RAISE EXCEPTION 'Review the canonical stock snapshot before adding current channel-price evidence.';END IF;
END $$;
ALTER FUNCTION public.marketplace_stock_preview_snapshot(uuid,uuid[]) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.marketplace_stock_preview_snapshot(uuid,uuid[]) RENAME TO marketplace_stock_before_price_freshness;
REVOKE ALL ON FUNCTION erp_private.marketplace_stock_before_price_freshness(uuid,uuid[]) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION erp_private.marketplace_current_channel_price(p_product uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE saved product_channel_prices;accepted product_channel_pricing_acceptances;fresh jsonb;complete boolean;
BEGIN
 SELECT * INTO saved FROM product_channel_prices WHERE product_id=p_product AND tenant_id=p_tenant AND channel='mercado_livre';
 SELECT * INTO accepted FROM product_channel_pricing_acceptances WHERE id=saved.acceptance_id AND product_id=p_product AND tenant_id=p_tenant AND channel='mercado_livre';
 IF accepted.id IS NULL THEN RETURN NULL;END IF;
 IF accepted.quantity=1 THEN
  BEGIN fresh:=erp_private.channel_preview(p_product,p_tenant,'mercado_livre',1,coalesce(accepted.snapshot->'assumptions','{}'::jsonb),saved.unit_price,
   CASE WHEN accepted.snapshot->>'cost_source'='simulation' THEN accepted.snapshot->'cost_snapshot'->'cost_context' END);
  EXCEPTION WHEN OTHERS THEN fresh:=NULL;END;
 END IF;
 complete:=coalesce(accepted.quantity=1 AND fresh->>'complete'='true' AND fresh->>'cost_revision'=accepted.cost_revision AND fresh->>'policy_revision'=accepted.policy_revision AND saved.unit_price=accepted.unit_price AND saved.unit_price>0,false);
 RETURN jsonb_build_object('unitPrice',saved.unit_price,'quantity',accepted.quantity,'acceptanceId',accepted.id,'costRevision',accepted.cost_revision,'policyRevision',accepted.policy_revision,'updatedAt',saved.updated_at,
  'complete',complete,'currentCostRevision',fresh->'cost_revision','currentPolicyRevision',fresh->'policy_revision','issue',CASE WHEN NOT complete THEN 'accepted_channel_price_stale' END,
  'revision',md5(jsonb_build_array(to_jsonb(saved),to_jsonb(accepted),fresh->'revision',complete)::text));
END $$;
REVOKE ALL ON FUNCTION erp_private.marketplace_current_channel_price(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.marketplace_stock_preview_snapshot(p_account_id uuid,p_product_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true);snapshot jsonb;product jsonb;price jsonb;products jsonb:='[]';
BEGIN
 snapshot:=erp_private.marketplace_stock_before_price_freshness(p_account_id,p_product_ids);
 FOR product IN SELECT value FROM jsonb_array_elements(snapshot->'products') LOOP
  price:=erp_private.marketplace_current_channel_price((product->>'productId')::uuid,t);
  product:=product||jsonb_build_object('acceptedMlPrice',price,'priceComplete',coalesce((price->>'complete')::boolean,false),
   'revision',md5(jsonb_build_array(product->>'revision',price)::text));products:=products||jsonb_build_array(product);
 END LOOP;
 snapshot:=snapshot||jsonb_build_object('products',products,'revision',md5(jsonb_build_array(snapshot->>'revision',products)::text));RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION public.marketplace_stock_preview_snapshot(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.marketplace_stock_preview_snapshot(uuid,uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
