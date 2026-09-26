-- Explicit deletion of unused records only. Existing business history is preserved.
CREATE FUNCTION public.delete_unused_record(p_kind text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(p_kind IN ('purchase','payable','receivable')); state text; rec record; title_ids uuid[]; dependency record; linked boolean;
BEGIN
  IF p_kind='product' THEN
    PERFORM 1 FROM products WHERE id=p_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
    IF EXISTS(SELECT 1 FROM jobs WHERE product_id=p_id)
      OR EXISTS(SELECT 1 FROM order_items WHERE product_id=p_id)
      OR EXISTS(SELECT 1 FROM sales_quote_items WHERE product_id=p_id)
      OR EXISTS(SELECT 1 FROM consignment_items WHERE product_id=p_id)
      OR EXISTS(SELECT 1 FROM consignment_movements WHERE product_id=p_id)
      OR EXISTS(SELECT 1 FROM bambu_production_records WHERE product_id=p_id)
      OR EXISTS(SELECT 1 FROM bambu_production_profiles WHERE product_id=p_id)
      OR EXISTS(SELECT 1 FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.extras,'[]')) e WHERE e->>'_kit_product_id'=p_id::text)
    THEN RAISE EXCEPTION 'Produto utilizado em pedidos, orçamentos, produção, consignação ou kits. Use Arquivar para retirá-lo do catálogo.'; END IF;
    DELETE FROM product_material_recipe_lines WHERE recipe_version_id IN (SELECT id FROM product_material_recipe_versions WHERE product_id=p_id);
    DELETE FROM product_material_recipe_versions WHERE product_id=p_id;
    DELETE FROM product_print_plates WHERE product_id=p_id;
    DELETE FROM product_print_sources WHERE product_id=p_id;
    DELETE FROM products WHERE id=p_id AND tenant_id=t;
  ELSIF p_kind='inventory' THEN
    SELECT current_stock INTO rec FROM inventory_items WHERE id=p_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;
    IF rec.current_stock<>0 OR EXISTS(SELECT 1 FROM inventory_movements WHERE item_id=p_id) THEN RAISE EXCEPTION 'Item com saldo ou movimentações. Use Arquivar para preservar o histórico.'; END IF;
    FOR dependency IN
      SELECT c.conrelid::regclass AS relation,a.attname AS column_name FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.contype='f' AND c.confrelid='public.inventory_items'::regclass
    LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',dependency.relation,dependency.column_name) INTO linked USING p_id;
      IF linked THEN RAISE EXCEPTION 'Item utilizado em cadastros ou operações. Use Arquivar para preservar os vínculos.'; END IF;
    END LOOP;
    DELETE FROM inventory_items WHERE id=p_id AND tenant_id=t;
  ELSIF p_kind='order' THEN
    SELECT status::text INTO state FROM orders WHERE id=p_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
    IF state NOT IN ('draft','cancelled') OR EXISTS(SELECT 1 FROM jobs WHERE order_id=p_id)
      OR EXISTS(SELECT 1 FROM accounts_receivable WHERE origin_type='order' AND origin_id=p_id)
      OR EXISTS(SELECT 1 FROM sales_quotes WHERE order_id=p_id)
    THEN RAISE EXCEPTION 'Exclua apenas rascunhos ou pedidos cancelados sem produção, orçamento vinculado ou financeiro. Use Cancelar pedido para operações iniciadas.'; END IF;
    DELETE FROM orders WHERE id=p_id AND tenant_id=t;
  ELSIF p_kind='purchase' THEN
    SELECT status::text INTO state FROM purchase_orders WHERE id=p_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Compra não encontrada.'; END IF;
    PERFORM 1 FROM accounts_payable WHERE origin_type='purchase_order' AND origin_id=p_id FOR UPDATE;
    IF state NOT IN ('draft','pending','cancelled')
      OR EXISTS(SELECT 1 FROM inventory_movements WHERE reference_type='purchase_order' AND reference_id=p_id)
      OR EXISTS(SELECT 1 FROM accounts_payable WHERE origin_type='purchase_order' AND origin_id=p_id AND amount_paid>0)
      OR EXISTS(SELECT 1 FROM bank_transactions b JOIN accounts_payable a ON b.reference_id=a.id WHERE a.origin_type='purchase_order' AND a.origin_id=p_id)
    THEN RAISE EXCEPTION 'Compra com recebimento ou pagamento não pode ser excluída. Preserve o histórico e faça o estorno correspondente.'; END IF;
    SELECT array_agg(id) INTO title_ids FROM accounts_payable WHERE origin_type='purchase_order' AND origin_id=p_id AND tenant_id=t;
    -- Only the validated definer operation may detach these unpaid titles.
    UPDATE accounts_payable SET origin_id=NULL,origin_type=NULL WHERE id=ANY(title_ids) AND tenant_id=t;
    DELETE FROM accounts_payable WHERE id=ANY(title_ids) AND tenant_id=t;
    DELETE FROM purchase_orders WHERE id=p_id AND tenant_id=t;
  ELSIF p_kind IN ('payable','receivable') THEN
    IF p_kind='payable' THEN
      SELECT origin_id,amount_paid AS paid INTO rec FROM accounts_payable WHERE id=p_id AND tenant_id=t FOR UPDATE;
    ELSE
      SELECT origin_id,amount_received AS paid INTO rec FROM accounts_receivable WHERE id=p_id AND tenant_id=t FOR UPDATE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
    IF rec.origin_id IS NOT NULL OR rec.paid>0 OR EXISTS(SELECT 1 FROM bank_transactions WHERE reference_id=p_id)
    THEN RAISE EXCEPTION 'Somente lançamentos manuais sem baixas podem ser excluídos. Abra a operação de origem ou o histórico.'; END IF;
    IF p_kind='payable' THEN DELETE FROM accounts_payable WHERE id=p_id AND tenant_id=t;
    ELSE DELETE FROM accounts_receivable WHERE id=p_id AND tenant_id=t; END IF;
  ELSE RAISE EXCEPTION 'Tipo de registro inválido.';
  END IF;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'delete_unused',CASE p_kind WHEN 'product' THEN 'products' WHEN 'inventory' THEN 'inventory_items' WHEN 'order' THEN 'orders' WHEN 'purchase' THEN 'purchase_orders' WHEN 'payable' THEN 'accounts_payable' ELSE 'accounts_receivable' END,p_id,jsonb_build_object('unpaid_titles',title_ids));
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Este registro possui vínculos. Use arquivamento ou cancelamento para preservar o histórico.';
END $$;
REVOKE ALL ON FUNCTION public.delete_unused_record(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_unused_record(text,uuid) TO authenticated;

-- Creation and optional receipt share one transaction and the existing retry key.
CREATE FUNCTION public.save_quick_purchase(p_order jsonb,p_items jsonb,p_installments jsonb,p_request_id uuid,p_receive boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
  PERFORM erp_private.actor(true);
  result:=public.create_purchase_order(p_order,p_items,p_installments,p_request_id);
  IF p_receive THEN PERFORM public.receive_purchase_order(result,erp_private.today(erp_private.actor(true))); END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_quick_purchase(jsonb,jsonb,jsonb,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_quick_purchase(jsonb,jsonb,jsonb,uuid,boolean) TO authenticated;
