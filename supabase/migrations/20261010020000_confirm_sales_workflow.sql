-- One explicit sales action; no external calls.
ALTER TABLE public.orders
  ADD COLUMN ship_by_at timestamptz,
  ADD COLUMN internal_due_at timestamptz,
  ADD COLUMN workflow_issues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(workflow_issues) = 'array'),
  ADD COLUMN workflow_checked_at timestamptz;
ALTER TABLE public.orders ADD CONSTRAINT order_internal_before_shipping
  CHECK (internal_due_at IS NULL OR ship_by_at IS NULL OR internal_due_at <= ship_by_at);

-- Keep retries' exact outcome, including a saved draft with preparation pending.
CREATE TABLE erp_private.sales_workflow_results (
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (tenant_id, request_id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES erp_private.requests(tenant_id, request_id)
);
REVOKE ALL ON erp_private.sales_workflow_results FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.save_sales_order(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_sales_order(uuid,jsonb,jsonb,uuid) RENAME TO save_sales_order_before_deadlines;
REVOKE ALL ON FUNCTION erp_private.save_sales_order_before_deadlines(uuid,jsonb,jsonb,uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.save_sales_order(p_order_id uuid,p_order jsonb,p_items jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; ship timestamptz; target timestamptz;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'sales_order',jsonb_build_array(p_order_id,p_order,p_items));
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados do pedido inválidos.'; END IF;
  IF nullif(p_order->>'ship_by_at','') IS NOT NULL AND p_order->>'ship_by_at' !~ 'T.+(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION 'Informe o prazo de postagem com horário e fuso.';
  END IF;
  IF nullif(p_order->>'internal_due_at','') IS NOT NULL AND p_order->>'internal_due_at' !~ 'T.+(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION 'Informe a meta interna com horário e fuso.';
  END IF;
  ship:=nullif(p_order->>'ship_by_at','')::timestamptz;
  target:=nullif(p_order->>'internal_due_at','')::timestamptz;
  IF (ship IS NOT NULL AND NOT isfinite(ship)) OR (target IS NOT NULL AND NOT isfinite(target)) THEN RAISE EXCEPTION 'Informe prazos com horário e fuso válidos.'; END IF;
  IF target IS NOT NULL AND ship IS NOT NULL AND target>ship THEN RAISE EXCEPTION 'A meta interna deve ser anterior ao prazo de postagem.'; END IF;
  IF p_order ? 'payment_schedule' THEN
    PERFORM erp_private.validate_payment_schedule(p_order->'payment_schedule',(p_order->>'total')::numeric,t);
  END IF;
  result:=erp_private.save_sales_order_before_deadlines(p_order_id,p_order,p_items,p_request_id);
  UPDATE orders SET
    ship_by_at=CASE WHEN p_order ? 'ship_by_at' THEN ship ELSE ship_by_at END,
    internal_due_at=CASE WHEN p_order ? 'internal_due_at' THEN target ELSE internal_due_at END,
    payment_schedule=CASE WHEN p_order ? 'payment_schedule' THEN p_order->'payment_schedule' ELSE payment_schedule END,
    workflow_issues='[]',workflow_checked_at=NULL
  WHERE id=result AND tenant_id=t;
  RETURN result;
END $$;

-- Operational dates can be revised after approval without rewriting the sale.
CREATE FUNCTION public.update_sales_order_deadlines(p_order_id uuid,p_dates jsonb,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; o orders; ship timestamptz; target timestamptz; channel_order uuid; channel_deadline timestamptz;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'sales_order_deadlines',jsonb_build_array(p_order_id,p_dates,p_reason));
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF jsonb_typeof(p_dates) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Informe os prazos operacionais e o motivo da revisão.'; END IF;
  IF NOT(p_dates ? 'ship_by_at') OR NOT(p_dates ? 'internal_due_at')
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_dates) k WHERE k NOT IN('ship_by_at','internal_due_at'))
    OR length(coalesce(btrim(p_reason),'')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Informe os prazos operacionais e o motivo da revisão.'; END IF;
  IF nullif(p_dates->>'ship_by_at','') IS NOT NULL AND p_dates->>'ship_by_at' !~ 'T.+(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR nullif(p_dates->>'internal_due_at','') IS NOT NULL AND p_dates->>'internal_due_at' !~ 'T.+(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Informe os prazos com horário e fuso.'; END IF;
  ship:=nullif(p_dates->>'ship_by_at','')::timestamptz; target:=nullif(p_dates->>'internal_due_at','')::timestamptz;
  IF (ship IS NOT NULL AND NOT isfinite(ship)) OR (target IS NOT NULL AND NOT isfinite(target))
    OR (ship IS NOT NULL AND target IS NOT NULL AND target>ship) THEN RAISE EXCEPTION 'A meta interna deve ser anterior ao prazo de postagem válido.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN('draft','approved','in_production','ready') THEN RAISE EXCEPTION 'Revise os prazos de um pedido ativo ainda sem postagem.'; END IF;
  -- The later marketplace migration adds this optional relation. A manual
  -- adjustment must retain the official cutoff of a linked marketplace order.
  channel_order:=nullif(to_jsonb(o)->>'marketplace_order_id','')::uuid;
  IF channel_order IS NOT NULL THEN
    EXECUTE 'SELECT shipping_deadline_at FROM public.marketplace_orders WHERE id=$1 AND tenant_id=$2' INTO channel_deadline USING channel_order,t;
    IF channel_deadline IS NULL OR ship IS DISTINCT FROM channel_deadline THEN RAISE EXCEPTION 'Use o prazo oficial mostrado em Marketplaces para revisar este pedido; ajuste a meta interna antes dele.'; END IF;
  END IF;
  IF ship IS NULL AND o.due_date IS NULL THEN RAISE EXCEPTION 'Informe o prazo de postagem; este pedido não tem data de entrega combinada.'; END IF;
  UPDATE orders SET ship_by_at=ship,internal_due_at=target WHERE id=o.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
    VALUES(t,auth.uid(),'review_deadlines','orders',o.id,jsonb_build_object('reason',btrim(p_reason),'before',jsonb_build_object('ship_by_at',o.ship_by_at,'internal_due_at',o.internal_due_at),'after',p_dates,'request_id',p_request_id));
  PERFORM erp_private.finish_request(t,p_request_id,o.id); RETURN o.id;
END $$;

CREATE FUNCTION public.confirm_sales_workflow(p_order_id uuid,p_order jsonb,p_items jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid; saved_order_id uuid; o orders; op_id uuid;
  issues jsonb:='[]'; result jsonb; review jsonb; outcome text; stock_ready boolean; message text;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'confirm_sales_workflow',jsonb_build_array(p_order_id,p_order,p_items));
  IF prior IS NOT NULL THEN
    SELECT r.result INTO result FROM erp_private.sales_workflow_results r WHERE r.tenant_id=t AND r.request_id=p_request_id;
    IF result IS NULL THEN RAISE EXCEPTION 'Confirmação incompleta. Atualize o pedido antes de repetir.'; END IF;
    RETURN result;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  IF (p_order IS NULL) IS DISTINCT FROM (p_items IS NULL) THEN RAISE EXCEPTION 'Informe os dados e os itens juntos.'; END IF;
  IF p_order IS NOT NULL THEN
    saved_order_id:=public.save_sales_order(p_order_id,p_order,p_items,gen_random_uuid());
  ELSE
    IF p_order_id IS NULL THEN RAISE EXCEPTION 'Selecione o pedido a confirmar.'; END IF;
    saved_order_id:=p_order_id;
  END IF;
  SELECT * INTO o FROM orders WHERE id=saved_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status='cancelled' THEN RAISE EXCEPTION 'O pedido está cancelado.'; END IF;
  IF o.status IN ('in_production','ready','shipped','delivered') THEN
    outcome:='already_organized';
    SELECT id INTO op_id FROM production_orders WHERE source_order_id=o.id AND tenant_id=t;
  ELSIF o.status NOT IN ('draft','approved') THEN
    RAISE EXCEPTION 'Este pedido não pode ser confirmado nesta etapa.';
  ELSE
    IF NOT EXISTS(SELECT 1 FROM customers WHERE id=o.customer_id AND tenant_id=t AND is_active) THEN issues:=issues||jsonb_build_array('Selecione um cliente ativo.'); END IF;
    IF o.payment_due_date IS NULL THEN issues:=issues||jsonb_build_array('Informe o vencimento do recebimento.'); END IF;
    IF o.ship_by_at IS NULL AND o.due_date IS NULL THEN issues:=issues||jsonb_build_array('Informe o prazo de postagem ou a data de entrega combinada.'); END IF;
    IF o.total IS NULL OR o.total<=0 THEN issues:=issues||jsonb_build_array('Informe preços com total positivo.'); END IF;
    IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id AND tenant_id=t) THEN issues:=issues||jsonb_build_array('Adicione os itens do pedido.'); END IF;
    IF EXISTS(SELECT 1 FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id AND p.tenant_id=t WHERE oi.order_id=o.id AND (p.id IS NULL OR NOT p.is_active)) THEN
      issues:=issues||jsonb_build_array('Vincule cada item a um produto ativo.');
    END IF;
    IF jsonb_array_length(issues)>0 THEN
      outcome:='needs_preparation';
    ELSE
      -- All lines must fit finished stock. Mixed stock/production allocation remains
      -- an explicit operation; this shortcut never partially decrements stock.
      stock_ready:=NOT EXISTS(
        SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
        WHERE oi.order_id=o.id AND (p.stock_item_id IS NULL OR jsonb_array_length(oi.material_overrides)>0)
      ) AND NOT EXISTS(
        SELECT 1 FROM (SELECT p.stock_item_id,sum(oi.quantity) quantity FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id GROUP BY p.stock_item_id) demand
        LEFT JOIN inventory_items i ON i.id=demand.stock_item_id AND i.tenant_id=t
        WHERE i.id IS NULL OR NOT i.is_active OR i.current_stock<demand.quantity
      ) AND NOT EXISTS(SELECT 1 FROM production_orders WHERE source_order_id=o.id AND tenant_id=t)
        AND NOT EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id AND tenant_id=t);
      BEGIN
        IF o.status='draft' THEN PERFORM public.transition_sales_order(o.id,'approved'); END IF;
        IF stock_ready THEN
          PERFORM public.fulfill_order_from_stock(o.id);
          outcome:='stock_ready';
        ELSE
          op_id:=public.request_production_order(NULL,o.id,gen_random_uuid());
          review:=public.production_order_preflight(op_id);
          IF NOT coalesce((review->>'ready')::boolean,false) THEN
            RAISE SQLSTATE 'P0101' USING MESSAGE=review::text;
          END IF;
          PERFORM public.release_production_order(op_id);
          outcome:='production_queued';
        END IF;
      EXCEPTION WHEN SQLSTATE 'P0101' THEN
        -- The subtransaction removes approval, titles, OP and jobs; the validated
        -- draft saved above remains available to finish preparation and try again.
        GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
        review:=message::jsonb;
        SELECT coalesce(jsonb_agg((line->>'description')||': '||(issue#>>'{}')),'[]') INTO issues
          FROM jsonb_array_elements(review->'items') line CROSS JOIN LATERAL jsonb_array_elements(line->'issues') issue;
        op_id:=NULL; outcome:='needs_preparation';
      END;
    END IF;
  END IF;
  UPDATE orders SET workflow_issues=issues,workflow_checked_at=now() WHERE id=o.id AND tenant_id=t;
  result:=jsonb_build_object('order_id',o.id,'outcome',outcome,'production_order_id',op_id,'issues',issues);
  INSERT INTO erp_private.sales_workflow_results VALUES(t,p_request_id,result);
  PERFORM erp_private.finish_request(t,p_request_id,o.id);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_sales_order(uuid,jsonb,jsonb,uuid),public.confirm_sales_workflow(uuid,jsonb,jsonb,uuid),public.update_sales_order_deadlines(uuid,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_sales_order(uuid,jsonb,jsonb,uuid),public.confirm_sales_workflow(uuid,jsonb,jsonb,uuid),public.update_sales_order_deadlines(uuid,jsonb,text,uuid) TO authenticated;
