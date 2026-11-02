-- Read-only, coherent Forge stock/price evidence. This never publishes stock or prices.
CREATE FUNCTION public.marketplace_stock_preview_snapshot(p_account_id uuid,p_product_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); a marketplace_accounts; b integrador_bridge_bindings; link integrador_marketplace_account_links;
 ids uuid[]; pid uuid; p products; stock inventory_items; available integer; observed timestamptz:=statement_timestamp();
 products_json jsonb:='[]'; availability_json jsonb:='[]'; bindings_json jsonb; competing_json jsonb; orders_json jsonb; product_json jsonb; accepted jsonb;
 assembly_holds jsonb; checkout_holds jsonb; missing jsonb:='[]'; product_missing jsonb; product_revision text; revision text; local_complete boolean;
BEGIN
 SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t AND channel='mercado_livre';
 SELECT * INTO link FROM integrador_marketplace_account_links WHERE account_id=a.id AND tenant_id=t;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=link.bridge_id AND tenant_id=t AND enabled;
 IF a.id IS NULL OR link.account_id IS NULL OR b.id IS NULL OR link.source_seller_id IS DISTINCT FROM a.external_seller_id
  OR NOT(link.source_seller_id=ANY(b.approved_seller_ids)) THEN RAISE EXCEPTION 'Vincule explicitamente esta conta ao vendedor aprovado antes de simular o estoque.' USING ERRCODE='42501'; END IF;
 IF p_product_ids IS NULL OR cardinality(p_product_ids) NOT BETWEEN 1 AND 500 OR array_position(p_product_ids,NULL) IS NOT NULL
  OR cardinality(p_product_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_product_ids) ids(id)) THEN RAISE EXCEPTION 'Selecione de 1 a 500 produtos vinculados, sem repetições.'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM unnest(p_product_ids) requested(id);
 IF EXISTS(SELECT 1 FROM unnest(ids) requested(id) WHERE NOT EXISTS(SELECT 1 FROM products candidate WHERE candidate.id=requested.id AND candidate.tenant_id=t)
   OR NOT EXISTS(SELECT 1 FROM marketplace_sku_bindings sb WHERE sb.account_id=a.id AND sb.tenant_id=t AND sb.product_id=requested.id)) THEN
  RAISE EXCEPTION 'Produto fora dos vínculos desta conta ou de outra empresa.' USING ERRCODE='42501';
 END IF;
 FOREACH pid IN ARRAY ids LOOP
  SELECT * INTO p FROM products WHERE id=pid AND tenant_id=t;
  SELECT * INTO stock FROM inventory_items WHERE id=p.stock_item_id AND tenant_id=t;
  product_missing:='[]';
  IF NOT p.is_active THEN product_missing:=product_missing||jsonb_build_array('product_inactive'); END IF;
  IF p.is_component THEN product_missing:=product_missing||jsonb_build_array('product_is_component'); END IF;
  IF stock.id IS NULL THEN product_missing:=product_missing||jsonb_build_array('finished_stock_missing');
  ELSIF NOT stock.is_active OR lower(btrim(stock.unit))<>'un' OR NOT erp_private.valid_number(stock.current_stock) THEN
   product_missing:=product_missing||jsonb_build_array('finished_stock_unit_or_state_invalid');
  END IF;
  available:=CASE WHEN jsonb_array_length(product_missing)=0 THEN erp_private.finished_stock_free(stock.id,t) END;
  SELECT coalesce(jsonb_agg(jsonb_build_array(d.id,to_jsonb(d),po.id,po.status) ORDER BY d.id),'[]') INTO assembly_holds
   FROM production_subitem_demands d JOIN products component ON component.id=d.component_product_id AND component.tenant_id=t
   JOIN production_order_items pi ON pi.id=d.item_id AND pi.tenant_id=t JOIN production_orders po ON po.id=pi.production_order_id AND po.tenant_id=t
   WHERE d.tenant_id=t AND component.stock_item_id=stock.id AND po.status='released';
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.request_id,h.item_id),'[]') INTO checkout_holds
   FROM erp_private.storefront_stock_holds h WHERE h.tenant_id=t AND h.item_id=stock.id AND h.expires_at>now();
  SELECT jsonb_build_object('unitPrice',price.unit_price,'quantity',accepted_price.quantity,'acceptanceId',accepted_price.id,
    'costRevision',accepted_price.cost_revision,'policyRevision',accepted_price.policy_revision,'updatedAt',price.updated_at,
    'revision',md5(jsonb_build_array(to_jsonb(price),to_jsonb(accepted_price))::text)) INTO accepted
   FROM product_channel_prices price JOIN product_channel_pricing_acceptances accepted_price ON accepted_price.id=price.acceptance_id
    AND accepted_price.tenant_id=t AND accepted_price.product_id=pid AND accepted_price.channel='mercado_livre'
   WHERE price.tenant_id=t AND price.product_id=pid AND price.channel='mercado_livre';
  product_revision:=md5(jsonb_build_array(to_jsonb(p),to_jsonb(stock),available,assembly_holds,checkout_holds,accepted)::text);
  product_json:=jsonb_build_object('productId',pid,'name',p.name,'stockItemId',stock.id,'stockUnit',stock.unit,'available',available,
   'stockComplete',available IS NOT NULL,'basePrice',p.sale_price,'acceptedMlPrice',accepted,'priceComplete',accepted IS NOT NULL,
   'unitConversion',CASE WHEN available IS NOT NULL THEN jsonb_build_object('kind','one_finished_unit','factor',1) END,
   'missing',product_missing,'revision',product_revision);
  products_json:=products_json||jsonb_build_array(product_json);
  availability_json:=availability_json||jsonb_build_array(jsonb_build_object('tenantId',t,'productId',pid,'available',available,'snapshotAt',observed,'revision',product_revision));
  missing:=missing||product_missing;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('bindingId',sb.id,'accountId',sb.account_id,'productId',sb.product_id,'itemId',sb.external_item_id,
   'variationId',sb.external_variant_id,'sku',sb.external_sku,'channel',a.channel,'sellerId',a.external_seller_id,'sourceBound',true,'bridgeId',b.id) ORDER BY sb.product_id,sb.id),'[]') INTO bindings_json
  FROM marketplace_sku_bindings sb WHERE sb.tenant_id=t AND sb.account_id=a.id AND sb.product_id=ANY(ids);
 SELECT coalesce(jsonb_agg(jsonb_build_object('bindingId',sb.id,'accountId',sb.account_id,'productId',sb.product_id,'itemId',sb.external_item_id,
   'variationId',sb.external_variant_id,'sku',sb.external_sku,'channel',other_account.channel,'sellerId',other_account.external_seller_id,
   'sourceBound',other_bridge.id IS NOT NULL AND other_link.source_seller_id=other_account.external_seller_id AND other_link.source_seller_id=ANY(other_bridge.approved_seller_ids),
   'bridgeId',other_bridge.id,'connectionState',other_account.connection_state) ORDER BY sb.product_id,sb.account_id,sb.id),'[]') INTO competing_json
  FROM marketplace_sku_bindings sb JOIN marketplace_accounts other_account ON other_account.id=sb.account_id AND other_account.tenant_id=t
   LEFT JOIN integrador_marketplace_account_links other_link ON other_link.account_id=other_account.id AND other_link.tenant_id=t
   LEFT JOIN integrador_bridge_bindings other_bridge ON other_bridge.id=other_link.bridge_id AND other_bridge.tenant_id=t AND other_bridge.enabled
  WHERE sb.tenant_id=t AND sb.account_id<>a.id AND sb.product_id=ANY(ids);
 -- All company channels share finished stock. An order imported as a draft is
 -- uncovered until a real, unreversed allocation AND its outgoing ledger entry exist.
 WITH lines AS (
  SELECT li.*,mo.account_id,ma.channel,ma.external_seller_id,mo.external_order_id,mo.normalized_state,mo.internal_order_id,mo.needs_review,mo.imported_at,mo.external_updated_at,
   sum(li.quantity) OVER(PARTITION BY mo.id,li.product_id) external_quantity,
   sum(li.quantity) OVER(PARTITION BY mo.id,li.product_id ORDER BY li.external_line_id ROWS UNBOUNDED PRECEDING) cumulative,
   o.marketplace_order_id internal_marketplace_order_id,o.status internal_status,bound_product.stock_item_id,
   coalesce((SELECT sum(oi.quantity) FROM order_items oi WHERE oi.order_id=o.id AND oi.tenant_id=t AND oi.product_id=li.product_id),0) internal_quantity,
   coalesce((SELECT sum(al.quantity) FROM order_stock_allocations al WHERE al.order_id=o.id AND al.tenant_id=t AND al.product_id=li.product_id AND al.item_id=bound_product.stock_item_id AND al.reversed_at IS NULL),0) allocated,
   coalesce((SELECT -sum(m.quantity) FROM inventory_movements m WHERE m.tenant_id=t AND m.item_id=bound_product.stock_item_id AND m.reference_type='sales_order_stock' AND m.reference_id=o.id),0) ledger_debit,
   coalesce((SELECT sum(pi.quantity) FROM production_order_items pi JOIN production_orders po ON po.id=pi.production_order_id AND po.tenant_id=t AND po.source_order_id=o.id AND po.status='completed'
    JOIN order_items source_line ON source_line.id=pi.source_order_item_id AND source_line.tenant_id=t AND source_line.order_id=o.id AND source_line.product_id=li.product_id
    WHERE pi.tenant_id=t AND pi.product_id=li.product_id),0) completed_production,
   coalesce((SELECT jsonb_agg(jsonb_build_object('productionOrderId',po.id,'productionItemId',pi.id,'sourceOrderItemId',pi.source_order_item_id,'quantity',pi.quantity,'completedAt',po.completed_at) ORDER BY pi.id)
    FROM production_order_items pi JOIN production_orders po ON po.id=pi.production_order_id AND po.tenant_id=t AND po.source_order_id=o.id AND po.status='completed'
    JOIN order_items source_line ON source_line.id=pi.source_order_item_id AND source_line.tenant_id=t AND source_line.order_id=o.id AND source_line.product_id=li.product_id
    WHERE pi.tenant_id=t AND pi.product_id=li.product_id),'[]') completed_production_evidence,
   coalesce((SELECT jsonb_agg(jsonb_build_object('allocationId',al.id,'orderItemId',al.order_item_id,'stockItemId',al.item_id,'quantity',al.quantity,'postedAt',al.posted_at) ORDER BY al.id)
    FROM order_stock_allocations al WHERE al.order_id=o.id AND al.tenant_id=t AND al.product_id=li.product_id AND al.item_id=bound_product.stock_item_id AND al.reversed_at IS NULL),'[]') allocation_evidence
  FROM marketplace_order_items li JOIN marketplace_orders mo ON mo.id=li.marketplace_order_id AND mo.tenant_id=t
   JOIN marketplace_accounts ma ON ma.id=mo.account_id AND ma.tenant_id=t LEFT JOIN orders o ON o.id=mo.internal_order_id AND o.tenant_id=t
   LEFT JOIN products bound_product ON bound_product.id=li.product_id AND bound_product.tenant_id=t
  WHERE li.tenant_id=t AND mo.normalized_state IN('paid','shipped','delivered','unknown') AND(li.product_id=ANY(ids) OR li.product_id IS NULL)
 ), covered AS (
  SELECT lines.*,CASE WHEN product_id IS NULL THEN NULL WHEN allocated=0 AND completed_production=0 THEN 0
   WHEN internal_marketplace_order_id=marketplace_order_id AND internal_quantity=external_quantity AND allocated+completed_production<=external_quantity AND ledger_debit>=allocated
    AND internal_status::text<>'cancelled' AND(completed_production=0 OR internal_status::text IN('ready','shipped','delivered'))
    THEN greatest(0,least(quantity,allocated+completed_production-(cumulative-quantity))) ELSE NULL END accounted
  FROM lines
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('tenantId',t,'sellerId',coalesce(external_seller_id,'account:'||account_id::text),
   'accountId',account_id,'channel',channel,'externalOrderId',external_order_id,'externalLineId',external_line_id,'productId',product_id,'state',normalized_state,
   'quantity',quantity,'quantityAlreadyAccounted',accounted,'snapshotAt',observed,'sourceObservedAt',imported_at,'externalUpdatedAt',external_updated_at,
   'needsReview',needs_review,'coverageEvidence',allocation_evidence,'ledgerDebit',ledger_debit,'completedProductionEvidence',completed_production_evidence) ORDER BY account_id,external_order_id,external_line_id),'[]') INTO orders_json FROM covered;
 local_complete:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(orders_json) row WHERE row->>'productId' IS NULL OR row->>'state'='unknown'
  OR row->>'quantityAlreadyAccounted' IS NULL OR row->>'needsReview'='true');
 IF NOT local_complete THEN missing:=missing||jsonb_build_array('local_paid_orders_need_review'); END IF;
 revision:=md5(jsonb_build_array(to_jsonb(a),to_jsonb(b),to_jsonb(link),products_json,bindings_json,competing_json,
  (SELECT coalesce(jsonb_agg(row-'snapshotAt' ORDER BY row->>'accountId',row->>'externalOrderId',row->>'externalLineId'),'[]') FROM jsonb_array_elements(orders_json) row))::text);
 RETURN jsonb_build_object('tenantId',t,'accountId',a.id,'sellerId',link.source_seller_id,'bridgeId',b.id,'snapshotAt',observed,
  'products',products_json,'finishedAvailability',availability_json,'bindings',bindings_json,'competingBindings',competing_json,'externalPaidOrders',orders_json,
  'localInboxComplete',local_complete,'requiresRemoteOrderRead',true,'revision',revision,'missing',missing,'previewOnly',true,'writesEnabled',false);
END $$;
REVOKE ALL ON FUNCTION public.marketplace_stock_preview_snapshot(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.marketplace_stock_preview_snapshot(uuid,uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
