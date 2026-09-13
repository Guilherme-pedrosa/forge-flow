-- Pending purchase items may be mapped to inventory; posted history is immutable.
DROP POLICY po_i ON purchase_orders; DROP POLICY po_u ON purchase_orders; DROP POLICY po_d ON purchase_orders;
DROP POLICY poi_i ON purchase_order_items; DROP POLICY poi_d ON purchase_order_items;
CREATE FUNCTION public.erp_guard_purchase_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE state text;
BEGIN
  SELECT status INTO state FROM purchase_orders WHERE id=OLD.purchase_order_id FOR UPDATE;
  IF state IS NULL OR state NOT IN ('draft','pending') OR (to_jsonb(NEW)-ARRAY['inventory_item_id','stock_quantity']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['inventory_item_id','stock_quantity']) THEN
    RAISE EXCEPTION 'Somente o vínculo e a conversão de estoque de compras pendentes podem ser alterados.';
  END IF;
  IF NEW.stock_quantity IS NOT NULL AND NOT erp_private.valid_number(NEW.stock_quantity,0.000001) THEN RAISE EXCEPTION 'Quantidade convertida inválida.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_purchase_item_guard BEFORE UPDATE ON purchase_order_items FOR EACH ROW EXECUTE FUNCTION erp_guard_purchase_item();

CREATE FUNCTION public.erp_guard_linked_title() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND OLD.origin_id IS NOT NULL THEN
    IF (NEW.amount,NEW.status::text,NEW.origin_id,NEW.origin_type) IS DISTINCT FROM (OLD.amount,OLD.status::text,OLD.origin_id,OLD.origin_type) THEN
      RAISE EXCEPTION 'Título vinculado: use as operações de compra, pedido ou baixa financeira.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_payable_link_guard BEFORE UPDATE ON accounts_payable FOR EACH ROW EXECUTE FUNCTION erp_guard_linked_title();
CREATE TRIGGER erp_receivable_link_guard BEFORE UPDATE ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION erp_guard_linked_title();
CREATE FUNCTION public.erp_guard_title_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.origin_id IS NOT NULL THEN
    IF TG_TABLE_NAME='accounts_payable' AND NEW.origin_type='purchase_order' THEN PERFORM erp_private.assert_ref('purchase_orders',NEW.origin_id,NEW.tenant_id);
    ELSIF TG_TABLE_NAME='accounts_receivable' AND NEW.origin_type='order' THEN PERFORM erp_private.assert_ref('orders',NEW.origin_id,NEW.tenant_id);
    ELSE RAISE EXCEPTION 'Origem financeira não reconhecida.'; END IF;
  ELSIF nullif(NEW.origin_type,'') IS NOT NULL THEN RAISE EXCEPTION 'Informe um vínculo válido para a origem financeira.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_payable_origin BEFORE INSERT OR UPDATE OF origin_id,origin_type ON accounts_payable FOR EACH ROW EXECUTE FUNCTION erp_guard_title_origin();
CREATE TRIGGER erp_receivable_origin BEFORE INSERT OR UPDATE OF origin_id,origin_type ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION erp_guard_title_origin();

-- Private attachments and writes to public product images stay inside tenant folders.
DROP POLICY "Auth users can view attachments" ON storage.objects;
DROP POLICY "Auth users can upload attachments" ON storage.objects;
DROP POLICY "Auth users can delete attachments" ON storage.objects;
DROP POLICY "Authenticated users can upload product photos" ON storage.objects;
DROP POLICY "Authenticated users can delete product photos" ON storage.objects;
CREATE POLICY erp_attachment_read ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='attachments' AND split_part(name,'/',1)=public.get_user_tenant_id()::text);
CREATE POLICY erp_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(bucket_id IN ('attachments','product-photos') AND split_part(name,'/',1)=public.get_user_tenant_id()::text AND public.erp_can_write());
CREATE POLICY erp_media_update ON storage.objects FOR UPDATE TO authenticated
  USING(bucket_id IN ('attachments','product-photos') AND split_part(name,'/',1)=public.get_user_tenant_id()::text AND public.erp_can_write())
  WITH CHECK(bucket_id IN ('attachments','product-photos') AND split_part(name,'/',1)=public.get_user_tenant_id()::text AND public.erp_can_write());
CREATE POLICY erp_media_delete ON storage.objects FOR DELETE TO authenticated
  USING(bucket_id IN ('attachments','product-photos') AND split_part(name,'/',1)=public.get_user_tenant_id()::text AND public.erp_can_write());

-- Connection tokens are for the edge worker only, never returned to a browser.
REVOKE SELECT ON bambu_connections FROM authenticated,anon;
GRANT SELECT(id,tenant_id,bambu_email,bambu_uid,is_active,last_sync_at,region,created_at,updated_at) ON bambu_connections TO authenticated;
CREATE FUNCTION public.disconnect_bambu_connection(p_connection_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true);
BEGIN UPDATE bambu_connections SET is_active=false,access_token_encrypted=NULL WHERE id=p_connection_id AND tenant_id=t; END $$;
REVOKE ALL ON FUNCTION public.disconnect_bambu_connection(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.disconnect_bambu_connection(uuid) TO authenticated;
DROP POLICY bc_i ON bambu_connections; DROP POLICY bc_u ON bambu_connections; DROP POLICY bc_d ON bambu_connections;

CREATE FUNCTION public.post_inventory_movement(p_movement jsonb,p_request_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'inventory_movement',p_movement);
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF p_movement->>'movement_type' NOT IN ('purchase_in','loss','maintenance','adjustment','return') THEN RAISE EXCEPTION 'Consumo de impressão deve ser registrado pela ordem de produção.'; END IF;
  INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,lot_number,notes,created_by)
    VALUES(t,(p_movement->>'item_id')::uuid,(p_movement->>'movement_type')::movement_type,(p_movement->>'quantity')::numeric,nullif(p_movement->>'unit_cost','')::numeric,p_movement->>'lot_number',p_movement->>'notes',auth.uid()) RETURNING id INTO result;
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
DROP POLICY im_i ON inventory_movements;
REVOKE ALL ON FUNCTION public.post_inventory_movement(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_inventory_movement(jsonb,uuid) TO authenticated;
