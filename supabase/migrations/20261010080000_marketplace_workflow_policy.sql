-- Automatic organization is explicit per account. Import still never starts printers
-- or marks a payout received. An estimated receivable is not a bank settlement.
CREATE TABLE public.marketplace_workflow_policies (
 account_id uuid PRIMARY KEY REFERENCES marketplace_accounts(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 default_customer_id uuid REFERENCES customers(id),
 receivable_due_days integer NOT NULL DEFAULT 30 CHECK(receivable_due_days BETWEEN 0 AND 180),
 safety_buffer_hours numeric(6,2) NOT NULL DEFAULT 24 CHECK(safety_buffer_hours BETWEEN 0 AND 168),
 auto_organize boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT auto_organize OR default_customer_id IS NOT NULL)
);
ALTER TABLE marketplace_workflow_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_workflow_policies FROM PUBLIC,anon,authenticated;
GRANT SELECT ON marketplace_workflow_policies TO authenticated;
GRANT ALL ON marketplace_workflow_policies TO service_role;
CREATE POLICY tenant_read ON marketplace_workflow_policies FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON marketplace_workflow_policies FOR EACH ROW EXECUTE FUNCTION erp_immutable_tenant();
CREATE TRIGGER erp_tenant_references BEFORE INSERT OR UPDATE ON marketplace_workflow_policies FOR EACH ROW EXECUTE FUNCTION erp_check_tenant_references();
CREATE TABLE erp_private.marketplace_workflow_results (
 tenant_id uuid NOT NULL, request_id uuid NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(tenant_id,request_id),
 FOREIGN KEY(tenant_id,request_id) REFERENCES erp_private.requests(tenant_id,request_id)
);
REVOKE ALL ON erp_private.marketplace_workflow_results FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_marketplace_workflow_policy(p_account_id uuid,p_values jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid; customer uuid; days integer; buffer numeric; enabled boolean;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'marketplace_workflow_policy',jsonb_build_array(p_account_id,p_values));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM erp_private.assert_ref('marketplace_accounts',p_account_id,t);
 IF p_account_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_values->'receivable_due_days') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_values->'safety_buffer_hours') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_values->'auto_organize') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Configuração da organização inválida.'; END IF;
 customer:=nullif(p_values->>'default_customer_id','')::uuid;
 IF (p_values->>'receivable_due_days')::numeric<>trunc((p_values->>'receivable_due_days')::numeric) THEN RAISE EXCEPTION 'Informe dias inteiros para a previsão de recebimento.'; END IF;
 days:=(p_values->>'receivable_due_days')::integer; buffer:=(p_values->>'safety_buffer_hours')::numeric; enabled:=(p_values->>'auto_organize')::boolean;
 IF days NOT BETWEEN 0 AND 180 OR NOT erp_private.valid_number(buffer) OR buffer>168 OR buffer<>round(buffer,2) THEN RAISE EXCEPTION 'Informe 0 a 180 dias e 0 a 168 horas de antecedência.'; END IF;
 PERFORM erp_private.assert_ref('customers',customer,t);
 IF (enabled AND customer IS NULL) OR (customer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customers WHERE id=customer AND tenant_id=t AND is_active)) THEN RAISE EXCEPTION 'Selecione um cliente ativo da empresa para organizar os pedidos.'; END IF;
 PERFORM 1 FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t FOR UPDATE;
 INSERT INTO marketplace_workflow_policies(account_id,tenant_id,default_customer_id,receivable_due_days,safety_buffer_hours,auto_organize)
 VALUES(p_account_id,t,customer,days,buffer,enabled)
 ON CONFLICT(account_id) DO UPDATE SET default_customer_id=excluded.default_customer_id,receivable_due_days=excluded.receivable_due_days,safety_buffer_hours=excluded.safety_buffer_hours,auto_organize=excluded.auto_organize,updated_at=now();
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'marketplace_workflow_policy','marketplace_workflow_policies',p_account_id,p_values);
 PERFORM erp_private.finish_request(t,p_request_id,p_account_id); RETURN p_account_id;
END $$;

CREATE FUNCTION public.organize_eligible_marketplace_orders(p_account_id uuid,p_order_ids uuid[],p_request_id uuid) RETURNS jsonb
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

-- Run only after all lines and bindings have been ingested. Operators can import;
-- organization with financial consequences requires the usual financial role.
ALTER FUNCTION public.import_marketplace_orders(uuid,jsonb) SET SCHEMA erp_private;
REVOKE ALL ON FUNCTION erp_private.import_marketplace_orders(uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.import_marketplace_orders(p_account_id uuid,p_orders jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); imported jsonb; organized jsonb; ids uuid[];
BEGIN
 imported:=erp_private.import_marketplace_orders(p_account_id,p_orders);
 IF EXISTS(SELECT 1 FROM marketplace_workflow_policies WHERE account_id=p_account_id AND tenant_id=t AND auto_organize) THEN
  SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(imported->'order_ids');
  IF cardinality(ids)>0 AND erp_can_write(true) THEN
   -- A stale policy must not lose successfully imported upstream facts.
   BEGIN
    organized:=organize_eligible_marketplace_orders(p_account_id,ids,gen_random_uuid());
    imported:=imported||jsonb_build_object('workflow',organized);
   EXCEPTION WHEN OTHERS THEN imported:=imported||jsonb_build_object('workflow_issue',SQLERRM); END;
  ELSIF cardinality(ids)>0 THEN imported:=imported||jsonb_build_object('workflow_issue','Pedidos importados. Um gestor precisa organizar as vendas.');
  END IF;
 END IF;
 RETURN imported;
END $$;
REVOKE ALL ON FUNCTION public.save_marketplace_workflow_policy(uuid,jsonb,uuid),public.organize_eligible_marketplace_orders(uuid,uuid[],uuid),public.import_marketplace_orders(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_marketplace_workflow_policy(uuid,jsonb,uuid),public.organize_eligible_marketplace_orders(uuid,uuid[],uuid),public.import_marketplace_orders(uuid,jsonb) TO authenticated;
