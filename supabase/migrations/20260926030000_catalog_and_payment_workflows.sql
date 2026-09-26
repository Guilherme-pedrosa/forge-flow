ALTER TABLE public.products ADD COLUMN catalog_details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.inventory_items ADD COLUMN max_stock numeric NOT NULL DEFAULT 0 CHECK (max_stock >= 0 AND max_stock::text NOT IN ('NaN','Infinity','-Infinity'));

ALTER FUNCTION public.save_inventory_catalog(uuid,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_inventory_catalog(uuid,jsonb,uuid) RENAME TO save_inventory_catalog_before_limits;
REVOKE ALL ON FUNCTION erp_private.save_inventory_catalog_before_limits(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_inventory_catalog(p_item_id uuid,p_item jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; maximum numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'inventory_catalog',jsonb_build_array(p_item_id,p_item));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_item ? 'max_stock' THEN
   maximum:=(p_item->>'max_stock')::numeric;
   IF NOT erp_private.valid_number(maximum) OR (maximum>0 AND maximum<coalesce((p_item->>'min_stock')::numeric,0)) THEN RAISE EXCEPTION 'O estoque máximo deve ser zero (sem limite) ou maior que o mínimo.'; END IF;
 END IF;
 result:=erp_private.save_inventory_catalog_before_limits(p_item_id,p_item,p_request_id);
 IF p_item ? 'max_stock' THEN UPDATE inventory_items SET max_stock=maximum WHERE id=result AND tenant_id=t; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_inventory_catalog(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_catalog(uuid,jsonb,uuid) TO authenticated;

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_catalog_details;
REVOKE ALL ON FUNCTION erp_private.save_product_before_catalog_details(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; details jsonb; base numeric; accessory numeric; other numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_product ? 'catalog_details' THEN
   details:=p_product->'catalog_details';
   IF jsonb_typeof(details)<>'object' THEN RAISE EXCEPTION 'Detalhes do produto inválidos.'; END IF;
   base:=(details->>'base_cost')::numeric; accessory:=(details->>'accessory_cost')::numeric; other:=(details->>'other_cost')::numeric;
   IF NOT erp_private.valid_number(accessory) OR NOT erp_private.valid_number(other)
     OR (base IS NULL AND (accessory<>0 OR other<>0 OR p_product->>'manual_cost' IS NOT NULL))
     OR (base IS NOT NULL AND (NOT erp_private.valid_number(base) OR round(base+accessory+other,4) IS DISTINCT FROM (p_product->>'manual_cost')::numeric)) THEN RAISE EXCEPTION 'O custo final deve corresponder ao custo de compra mais despesas.'; END IF;
   details:=jsonb_build_object('base_cost',base,'accessory_cost',accessory,'other_cost',other,'barcode',left(coalesce(details->>'barcode',''),80));
 END IF;
 result:=erp_private.save_product_before_catalog_details(p_product_id,p_product,p_photos,p_request_id);
 IF details IS NOT NULL THEN UPDATE products SET catalog_details=details WHERE id=result AND tenant_id=t; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.post_inventory_batch(p_movements jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; movement jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'inventory_batch',p_movements);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF jsonb_typeof(p_movements)<>'array' OR jsonb_array_length(p_movements) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Informe de 1 a 100 itens.'; END IF;
 -- The entire batch, including every cost and movement, rolls back on a failing line.
 FOR movement IN SELECT value FROM jsonb_array_elements(p_movements) ORDER BY value->>'item_id' LOOP
   result:=public.post_inventory_movement(movement,gen_random_uuid());
 END LOOP;
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.post_inventory_batch(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_inventory_batch(jsonb,uuid) TO authenticated;

CREATE FUNCTION public.create_financial_installments(p_kind text,p_title jsonb,p_parts jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; first_id uuid; part jsonb; amount numeric; total numeric:=0; n integer:=0; cnt integer;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'financial_installments',jsonb_build_array(p_kind,p_title,p_parts));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_kind NOT IN ('payable','receivable') OR jsonb_typeof(p_parts)<>'array' THEN RAISE EXCEPTION 'Lançamento inválido.'; END IF;
 cnt:=jsonb_array_length(p_parts);
 IF cnt NOT BETWEEN 1 AND 120 OR nullif(btrim(p_title->>'description'),'') IS NULL OR NOT erp_private.valid_number((p_title->>'amount')::numeric) THEN RAISE EXCEPTION 'Revise descrição, valor e parcelas.'; END IF;
 PERFORM erp_private.assert_ref('chart_of_accounts',(p_title->>'account_id')::uuid,t);
 PERFORM erp_private.assert_ref('cost_centers',(p_title->>'cost_center_id')::uuid,t);
 PERFORM erp_private.assert_ref('payment_methods',(p_title->>'payment_method_id')::uuid,t);
 PERFORM erp_private.assert_ref(CASE WHEN p_kind='payable' THEN 'vendors' ELSE 'customers' END,(p_title->>'contact_id')::uuid,t);
 FOR part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
   amount:=(part->>'amount')::numeric;
   IF NOT erp_private.valid_number(amount) OR amount<=0 OR (part->>'due_date')::date IS NULL OR (p_title->>'competence_date')::date IS NULL THEN RAISE EXCEPTION 'Informe valores positivos e vencimentos válidos.'; END IF;
   total:=total+round(amount,2);n:=n+1;
   IF p_kind='payable' THEN
     INSERT INTO accounts_payable(tenant_id,created_by,description,amount,due_date,competence_date,account_id,cost_center_id,payment_method_id,vendor_id,notes,installment_number,installment_total)
     VALUES(t,auth.uid(),(p_title->>'description')||CASE WHEN cnt>1 THEN ' ('||n||'/'||cnt||')' ELSE '' END,round(amount,2),(part->>'due_date')::date,(p_title->>'competence_date')::date,(p_title->>'account_id')::uuid,(p_title->>'cost_center_id')::uuid,(p_title->>'payment_method_id')::uuid,(p_title->>'contact_id')::uuid,p_title->>'notes',n,cnt) RETURNING id INTO result;
   ELSE
     INSERT INTO accounts_receivable(tenant_id,created_by,description,amount,due_date,competence_date,account_id,cost_center_id,payment_method_id,customer_id,notes)
     VALUES(t,auth.uid(),(p_title->>'description')||CASE WHEN cnt>1 THEN ' ('||n||'/'||cnt||')' ELSE '' END,round(amount,2),(part->>'due_date')::date,(p_title->>'competence_date')::date,(p_title->>'account_id')::uuid,(p_title->>'cost_center_id')::uuid,(p_title->>'payment_method_id')::uuid,(p_title->>'contact_id')::uuid,p_title->>'notes') RETURNING id INTO result;
   END IF;
   first_id:=coalesce(first_id,result);
 END LOOP;
 IF total IS DISTINCT FROM round((p_title->>'amount')::numeric,2) THEN RAISE EXCEPTION 'A soma das parcelas difere do total.'; END IF;
 PERFORM erp_private.finish_request(t,p_request_id,first_id); RETURN first_id;
END $$;
REVOKE ALL ON FUNCTION public.create_financial_installments(text,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_financial_installments(text,jsonb,jsonb,uuid) TO authenticated;
