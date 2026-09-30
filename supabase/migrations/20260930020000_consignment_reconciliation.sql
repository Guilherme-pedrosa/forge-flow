-- Track transfers prospectively; historical quantities were never debited from the warehouse.
ALTER TABLE public.consignment_items ADD COLUMN warehouse_tracked_qty integer NOT NULL DEFAULT 0 CHECK(warehouse_tracked_qty>=0 AND warehouse_tracked_qty<=current_qty);
ALTER FUNCTION public.post_consignment_movement(uuid,text,jsonb,text,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.post_consignment_movement(uuid,text,jsonb,text,uuid) RENAME TO post_consignment_before_warehouse;
REVOKE ALL ON FUNCTION erp_private.post_consignment_before_warehouse(uuid,text,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
-- Clamp tracking for legacy manual corrections and the inner point movement.
CREATE FUNCTION public.clamp_consignment_tracking() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.warehouse_tracked_qty:=least(NEW.warehouse_tracked_qty,NEW.current_qty); RETURN NEW; END $$;
CREATE TRIGGER consignment_tracking_clamp BEFORE INSERT OR UPDATE ON public.consignment_items FOR EACH ROW EXECUTE FUNCTION public.clamp_consignment_tracking();
CREATE FUNCTION public.post_consignment_movement(p_location_id uuid,p_type text,p_items jsonb,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; line jsonb; prod products; stock inventory_items; point consignment_items; before_rows jsonb:='[]'; qty integer; tracked integer; returned integer;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'consignment_movement',jsonb_build_array(p_location_id,p_type,p_items,p_notes)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM 1 FROM consignment_locations WHERE id=p_location_id AND tenant_id=t FOR UPDATE;
 FOR line IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'product_id' LOOP
  SELECT * INTO prod FROM products WHERE id=(line->>'product_id')::uuid AND tenant_id=t FOR UPDATE;
  SELECT * INTO point FROM consignment_items WHERE location_id=p_location_id AND product_id=prod.id AND tenant_id=t FOR UPDATE;
  before_rows:=before_rows||jsonb_build_array(jsonb_build_object('product_id',prod.id,'stock_id',prod.stock_item_id,'qty',coalesce(point.current_qty,0),'tracked',coalesce(point.warehouse_tracked_qty,0)));
 END LOOP;
 result:=erp_private.post_consignment_before_warehouse(p_location_id,p_type,p_items,p_notes,p_request_id);
 FOR line IN SELECT a.value||b.value AS v FROM jsonb_array_elements(before_rows) a JOIN jsonb_array_elements(p_items) b ON a.value->>'product_id'=b.value->>'product_id' ORDER BY a.value->>'stock_id' LOOP
  qty:=(line->>'quantity')::integer; tracked:=(line->>'tracked')::integer;
  IF p_type IN('placement','replenishment') AND line->>'stock_id' IS NOT NULL THEN
   SELECT * INTO stock FROM inventory_items WHERE id=(line->>'stock_id')::uuid AND tenant_id=t FOR UPDATE;
   IF NOT FOUND OR NOT stock.is_active OR stock.current_stock<qty THEN RAISE EXCEPTION 'Estoque central insuficiente. Confira o saldo antes de enviar as peças ao ponto.'; END IF;
   INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
   VALUES(t,stock.id,'adjustment',-qty,stock.avg_cost,'consignment_transfer',result,'Envio ao ponto consignado',auth.uid());
   tracked:=tracked+qty;
  ELSIF p_type IN('sale','return') THEN
   returned:=greatest(0,qty-((line->>'qty')::integer-tracked)); tracked:=tracked-returned;
   IF p_type='return' AND returned>0 AND line->>'stock_id' IS NOT NULL THEN
    SELECT * INTO stock FROM inventory_items WHERE id=(line->>'stock_id')::uuid AND tenant_id=t FOR UPDATE;
    INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
    VALUES(t,stock.id,'adjustment',returned,stock.avg_cost,'consignment_return',result,'Recolhimento do ponto consignado',auth.uid());
   END IF;
  END IF;
  UPDATE consignment_items SET warehouse_tracked_qty=tracked WHERE location_id=p_location_id AND product_id=(line->>'product_id')::uuid AND tenant_id=t;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.post_consignment_movement(uuid,text,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_consignment_movement(uuid,text,jsonb,text,uuid) TO authenticated;

CREATE FUNCTION public.reconcile_consignment(p_location_id uuid,p_items jsonb,p_expected_commission numeric,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; loc consignment_locations; line jsonb; stock consignment_items; sale jsonb:='[]'; returns jsonb:='[]'; sold integer; returned integer; price numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'consignment_reconciliation',jsonb_build_array(p_location_id,p_items,p_expected_commission,p_notes)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO loc FROM consignment_locations WHERE id=p_location_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR NOT loc.is_active THEN RAISE EXCEPTION 'Ponto inválido ou arquivado.'; END IF;
 IF loc.commission_percent IS DISTINCT FROM p_expected_commission THEN RAISE EXCEPTION 'A comissão mudou. Atualize a conferência.'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 OR (SELECT count(DISTINCT value->>'product_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Itens de conferência inválidos.'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'product_id' LOOP
  IF coalesce(line->>'sold','') !~ '^[0-9]{1,5}$' OR coalesce(line->>'returned','') !~ '^[0-9]{1,5}$' THEN RAISE EXCEPTION 'Informe quantidades inteiras de vendas e devoluções.'; END IF;
  sold:=(line->>'sold')::integer; returned:=(line->>'returned')::integer;
  SELECT * INTO stock FROM consignment_items WHERE location_id=loc.id AND product_id=(line->>'product_id')::uuid AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR stock.current_qty IS DISTINCT FROM (line->>'expected_qty')::integer THEN RAISE EXCEPTION 'O saldo mudou. Atualize a conferência antes de confirmar.'; END IF;
  SELECT coalesce(stock.sale_price,sale_price,0) INTO price FROM products WHERE id=stock.product_id AND tenant_id=t;
  IF price IS DISTINCT FROM (line->>'unit_price')::numeric THEN RAISE EXCEPTION 'O preço mudou. Atualize a conferência.'; END IF;
  IF sold+returned>stock.current_qty THEN RAISE EXCEPTION 'Vendas e devoluções excedem o saldo do ponto.'; END IF;
  IF sold>0 THEN sale:=sale||jsonb_build_array(jsonb_build_object('product_id',stock.product_id,'quantity',sold,'unit_price',price)); END IF;
  IF returned>0 THEN returns:=returns||jsonb_build_array(jsonb_build_object('product_id',stock.product_id,'quantity',returned,'unit_price',price)); END IF;
 END LOOP;
 IF jsonb_array_length(sale)+jsonb_array_length(returns)=0 THEN RAISE EXCEPTION 'Informe pelo menos uma venda ou devolução.'; END IF;
 IF jsonb_array_length(sale)>0 THEN result:=public.post_consignment_movement(loc.id,'sale',sale,p_notes,gen_random_uuid()); END IF;
 IF jsonb_array_length(returns)>0 THEN PERFORM public.post_consignment_movement(loc.id,'return',returns,p_notes,gen_random_uuid()); END IF;
 result:=coalesce(result,p_request_id);
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'reconcile_consignment','consignment_locations',loc.id,jsonb_build_object('items',p_items,'commission',loc.commission_percent,'result_id',result));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_consignment(uuid,jsonb,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_consignment(uuid,jsonb,numeric,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
