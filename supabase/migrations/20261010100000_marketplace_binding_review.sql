-- Some sellable products still need a buyer's photo, name, artwork or another
-- manual choice. This is an explicit binding policy, never inferred from titles.
ALTER TABLE public.marketplace_sku_bindings
 ADD COLUMN requires_manual_review boolean NOT NULL DEFAULT false;

-- Keep one PostgREST-visible signature. Omitting the new argument must preserve
-- existing policies rather than silently clear them when an older client binds.
ALTER FUNCTION public.save_marketplace_sku_binding(uuid,text,text,text,uuid) SET SCHEMA erp_private;
REVOKE ALL ON FUNCTION erp_private.save_marketplace_sku_binding(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_marketplace_sku_binding(
 p_account_id uuid,p_external_item_id text,p_external_variant_id text,p_external_sku text,p_product_id uuid,
 p_requires_manual_review boolean DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; previous_review boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT requires_manual_review INTO previous_review FROM marketplace_sku_bindings
  WHERE account_id=p_account_id AND tenant_id=t
   AND external_item_id=coalesce(btrim(p_external_item_id),'')
   AND external_variant_id=coalesce(btrim(p_external_variant_id),'')
   AND external_sku=coalesce(btrim(p_external_sku),'') FOR UPDATE;
 -- The original validation, product lock and line updates remain in this same
 -- transaction. A failure cannot leave the destination and policy out of sync.
 result:=erp_private.save_marketplace_sku_binding(p_account_id,p_external_item_id,p_external_variant_id,p_external_sku,p_product_id);
 IF p_requires_manual_review IS NOT NULL THEN
  UPDATE marketplace_sku_bindings SET requires_manual_review=p_requires_manual_review
   WHERE id=result AND tenant_id=t;
  IF coalesce(previous_review,false) IS DISTINCT FROM p_requires_manual_review THEN
   INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
   VALUES(t,auth.uid(),'marketplace_binding_review_policy','marketplace_sku_bindings',result,
    jsonb_build_object('account_id',p_account_id,'previous_requires_manual_review',coalesce(previous_review,false),'requires_manual_review',p_requires_manual_review));
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_marketplace_sku_binding(uuid,text,text,text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_marketplace_sku_binding(uuid,text,text,text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.organize_eligible_marketplace_orders(p_account_id uuid,p_order_ids uuid[],p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid; policy marketplace_workflow_policies; mo marketplace_orders; order_id uuid; source_id uuid;
 outcome jsonb; results jsonb:='[]'; result jsonb; reason text; affected integer:=0;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'organize_marketplace_orders',jsonb_build_array(p_account_id,p_order_ids));
 IF prior IS NOT NULL THEN
  SELECT r.result INTO result FROM erp_private.marketplace_workflow_results r WHERE r.tenant_id=t AND r.request_id=p_request_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Organização incompleta. Atualize a lista antes de repetir.'; END IF;
  RETURN result;
 END IF;
 IF p_order_ids IS NULL OR cardinality(p_order_ids) NOT BETWEEN 1 AND 100 OR array_position(p_order_ids,NULL) IS NOT NULL
  OR (SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)<>cardinality(p_order_ids) THEN RAISE EXCEPTION 'Selecione de 1 a 100 pedidos distintos.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM erp_private.assert_ref('marketplace_accounts',p_account_id,t);
 SELECT * INTO policy FROM marketplace_workflow_policies WHERE account_id=p_account_id AND tenant_id=t;
 IF policy.account_id IS NULL OR policy.default_customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM customers WHERE id=policy.default_customer_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Configure um cliente ativo e a previsão de recebimento antes de organizar.'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_order_ids) x WHERE NOT EXISTS(SELECT 1 FROM marketplace_orders WHERE id=x AND account_id=p_account_id AND tenant_id=t)) THEN RAISE EXCEPTION 'Pedido não encontrado nesta conta e empresa.'; END IF;
 PERFORM 1 FROM orders WHERE id IN(SELECT internal_order_id FROM marketplace_orders WHERE id=ANY(p_order_ids)) ORDER BY id FOR UPDATE;
 FOR source_id IN SELECT unnest(p_order_ids) ORDER BY 1 LOOP
  SELECT * INTO mo FROM marketplace_orders WHERE id=source_id AND tenant_id=t FOR UPDATE;
  reason:=NULL; order_id:=mo.internal_order_id;
  IF mo.needs_review THEN reason:='Alteração do canal exige conferência manual.';
  ELSIF mo.normalized_state<>'paid' THEN reason:='O canal ainda não confirma um pedido pago e ativo.';
  ELSIF mo.shipping_deadline_at IS NULL THEN reason:='Falta o prazo oficial de despacho.';
  ELSIF mo.reported_total IS NOT NULL AND mo.reported_total<>mo.total THEN reason:='Os valores do canal precisam de reconciliação.';
  ELSIF EXISTS(SELECT 1 FROM marketplace_order_items li LEFT JOIN products p ON p.id=li.product_id AND p.tenant_id=t WHERE li.marketplace_order_id=mo.id AND (p.id IS NULL OR NOT p.is_active)) THEN reason:='Vincule todos os SKUs a produtos ativos.';
  ELSIF (mo.internal_order_id IS NULL OR EXISTS(SELECT 1 FROM orders WHERE id=mo.internal_order_id AND tenant_id=t AND status IN('draft','approved')))
   AND EXISTS(
    SELECT 1 FROM marketplace_order_items li JOIN marketplace_sku_bindings b
     ON b.account_id=mo.account_id AND b.tenant_id=t
     AND b.external_item_id=li.external_item_id AND b.external_variant_id=li.external_variant_id AND b.external_sku=li.external_sku
    WHERE li.marketplace_order_id=mo.id AND li.tenant_id=t AND b.requires_manual_review
   ) THEN reason:='Este anúncio exige conferência manual. Crie um rascunho e confira foto, nome, arte ou demais escolhas em Pedidos antes de confirmar a venda.';
  END IF;
  IF reason IS NULL THEN
   BEGIN
    order_id:=create_sales_order_from_marketplace(mo.id,policy.default_customer_id,erp_private.today(t)+policy.receivable_due_days,gen_random_uuid());
    -- Retain a manually established internal target. The cutoff remains the real API instant.
    UPDATE orders SET internal_due_at=mo.shipping_deadline_at-policy.safety_buffer_hours*interval '1 hour' WHERE id=order_id AND tenant_id=t AND internal_due_at IS NULL AND status='draft';
    outcome:=confirm_sales_workflow(order_id,NULL,NULL,gen_random_uuid());
    results:=results||jsonb_build_array(outcome||jsonb_build_object('marketplace_order_id',mo.id,'external_order_id',mo.external_order_id));
    IF outcome->>'outcome' IN('stock_ready','production_queued') THEN affected:=affected+1; END IF;
   EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
    -- The failed order rolls back as a unit; the other orders can still be organized.
    results:=results||jsonb_build_array(jsonb_build_object('marketplace_order_id',mo.id,'external_order_id',mo.external_order_id,'order_id',mo.internal_order_id,'outcome','needs_review','issues',jsonb_build_array(reason)));
   END;
  ELSE
   results:=results||jsonb_build_array(jsonb_build_object('marketplace_order_id',mo.id,'external_order_id',mo.external_order_id,'order_id',order_id,'outcome','needs_review','issues',jsonb_build_array(reason)));
  END IF;
 END LOOP;
 result:=jsonb_build_object('organized',affected,'results',results);
 INSERT INTO erp_private.marketplace_workflow_results VALUES(t,p_request_id,result);
 PERFORM erp_private.finish_request(t,p_request_id,p_account_id); RETURN result;
END $$;

NOTIFY pgrst,'reload schema';
