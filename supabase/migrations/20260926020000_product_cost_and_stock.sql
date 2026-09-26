-- Product price/cost and physical stock can be entered together, without a print recipe.
ALTER TABLE public.products ADD COLUMN manual_cost_override numeric,
 ADD COLUMN stock_item_id uuid UNIQUE REFERENCES public.inventory_items(id),
 ADD CONSTRAINT products_manual_cost_valid CHECK(manual_cost_override IS NULL OR (manual_cost_override>=0 AND manual_cost_override::text NOT IN ('NaN','Infinity','-Infinity')));

CREATE FUNCTION public.save_inventory_catalog(p_item_id uuid,p_item jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; old_item inventory_items; item inventory_items; metadata jsonb; target numeric; delta numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'inventory_catalog',jsonb_build_array(p_item_id,p_item));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_item_id IS NOT NULL THEN
   SELECT * INTO old_item FROM inventory_items WHERE id=p_item_id AND tenant_id=t FOR UPDATE;
   IF NOT FOUND OR NOT old_item.is_active THEN RAISE EXCEPTION 'Item não encontrado ou arquivado.'; END IF;
 ELSE
   old_item.id:=gen_random_uuid();old_item.tenant_id:=t;old_item.current_stock:=0;old_item.avg_cost:=0;old_item.min_stock:=0;
   old_item.loss_coefficient:=0;old_item.unit:='un';old_item.category:='consumable';old_item.is_active:=true;
 END IF;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO metadata FROM jsonb_each(p_item) WHERE key=ANY(ARRAY['name','category','material_type','material_code','material_description','color','color_code','color_hex','diameter','brand','sku','unit','min_stock','loss_coefficient','notes','freight_cost','parent_id','vendor_id','avg_cost']);
 item:=jsonb_populate_record(old_item,metadata);
 IF nullif(btrim(item.name),'') IS NULL OR nullif(btrim(item.unit),'') IS NULL OR NOT erp_private.valid_number(item.avg_cost) THEN RAISE EXCEPTION 'Informe nome, unidade e custo válido.'; END IF;
 PERFORM erp_private.assert_ref('inventory_items',item.parent_id,t);PERFORM erp_private.assert_ref('vendors',item.vendor_id,t);
 IF item.parent_id=item.id THEN RAISE EXCEPTION 'O item não pode ser seu próprio grupo.'; END IF;
 target:=CASE WHEN p_item ? 'current_stock' THEN (p_item->>'current_stock')::numeric ELSE old_item.current_stock END;
 IF NOT erp_private.valid_number(target) THEN RAISE EXCEPTION 'Informe um estoque maior ou igual a zero.'; END IF;
 IF p_item_id IS NOT NULL AND p_item ? 'current_stock' AND (NOT p_item ? 'expected_stock' OR (p_item->>'expected_stock')::numeric IS DISTINCT FROM old_item.current_stock) THEN RAISE EXCEPTION 'O saldo mudou desde a abertura. Reabra o item para conferir a quantidade atual.'; END IF;
 INSERT INTO inventory_items(id,tenant_id,name,category,material_type,material_code,material_description,color,color_code,color_hex,diameter,brand,sku,unit,min_stock,avg_cost,loss_coefficient,notes,freight_cost,parent_id,vendor_id)
 VALUES(item.id,t,btrim(item.name),item.category,item.material_type,item.material_code,item.material_description,item.color,item.color_code,item.color_hex,item.diameter,item.brand,item.sku,item.unit,item.min_stock,item.avg_cost,item.loss_coefficient,item.notes,item.freight_cost,item.parent_id,item.vendor_id)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,material_type=excluded.material_type,material_code=excluded.material_code,material_description=excluded.material_description,color=excluded.color,color_code=excluded.color_code,color_hex=excluded.color_hex,diameter=excluded.diameter,brand=excluded.brand,sku=excluded.sku,unit=excluded.unit,min_stock=excluded.min_stock,avg_cost=excluded.avg_cost,loss_coefficient=excluded.loss_coefficient,notes=excluded.notes,freight_cost=excluded.freight_cost,parent_id=excluded.parent_id,vendor_id=excluded.vendor_id;
 delta:=target-old_item.current_stock;
 IF delta<>0 THEN
   INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
   VALUES(t,item.id,CASE WHEN p_item_id IS NULL THEN 'purchase_in'::movement_type ELSE 'adjustment'::movement_type END,delta,item.avg_cost,'catalog_stock',item.id,CASE WHEN p_item_id IS NULL THEN 'Saldo inicial informado no cadastro' ELSE 'Saldo conferido no cadastro' END,auth.uid());
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'save_stock_catalog','inventory_items',item.id,jsonb_build_object('stock_before',old_item.current_stock,'stock_after',target,'cost_before',old_item.avg_cost,'cost_after',item.avg_cost));
 PERFORM erp_private.finish_request(t,p_request_id,item.id);RETURN item.id;
END $$;
REVOKE ALL ON FUNCTION public.save_inventory_catalog(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_inventory_catalog(uuid,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.erp_product_manual_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.manual_cost_override IS NOT NULL THEN NEW.cost_estimate:=NEW.manual_cost_override; END IF;
 IF NEW.stock_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE id=NEW.stock_item_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Estoque de outra empresa.'; END IF;
 NEW.margin_percent:=CASE WHEN NEW.sale_price>0 AND NEW.cost_estimate IS NOT NULL THEN round((NEW.sale_price-NEW.cost_estimate)/NEW.sale_price*100,2) ELSE NULL END;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_product_manual_cost BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.erp_product_manual_cost();

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_stock;
REVOKE ALL ON FUNCTION erp_private.save_product_before_stock(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; result uuid; item_id uuid; item_payload jsonb; product products;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 result:=erp_private.save_product_before_stock(p_product_id,p_product,p_photos,p_request_id);
 SELECT * INTO product FROM products WHERE id=result AND tenant_id=t FOR UPDATE;
 IF p_product ? 'manual_cost' THEN
   UPDATE products SET manual_cost_override=(p_product->>'manual_cost')::numeric,cost_estimate=(p_product->>'manual_cost')::numeric WHERE id=result;
 END IF;
 IF p_product ? 'stock' THEN
   item_payload:=p_product->'stock';
   IF jsonb_typeof(item_payload)<>'object' THEN RAISE EXCEPTION 'Dados de estoque inválidos.'; END IF;
   item_id:=product.stock_item_id;
   item_payload:=item_payload||jsonb_build_object('name',product.name,'sku',product.sku);
   IF item_id IS NULL THEN item_payload:=jsonb_build_object('category','part','unit','un')||item_payload; END IF;
   item_id:=public.save_inventory_catalog(item_id,item_payload,gen_random_uuid());
   UPDATE products SET stock_item_id=item_id WHERE id=result;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

-- Deleting a catalogue product must never abandon a stocked or historically used item.
ALTER FUNCTION public.delete_unused_record(text,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.delete_unused_record(text,uuid) RENAME TO delete_unused_before_product_stock;
REVOKE ALL ON FUNCTION erp_private.delete_unused_before_product_stock(text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.delete_unused_record(p_kind text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(p_kind IN ('purchase','payable','receivable')); linked_item_id uuid;
BEGIN
 IF p_kind='product' THEN
   SELECT stock_item_id INTO linked_item_id FROM products WHERE id=p_id AND tenant_id=t FOR UPDATE;
   IF linked_item_id IS NOT NULL THEN
     PERFORM 1 FROM inventory_items WHERE id=linked_item_id FOR UPDATE;
     IF EXISTS(SELECT 1 FROM inventory_items WHERE id=linked_item_id AND current_stock<>0) OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.item_id=linked_item_id) THEN RAISE EXCEPTION 'Produto com saldo ou histórico de estoque. Use Arquivar para preservar as movimentações.'; END IF;
   END IF;
 END IF;
 PERFORM erp_private.delete_unused_before_product_stock(p_kind,p_id);
 IF linked_item_id IS NOT NULL THEN PERFORM erp_private.delete_unused_before_product_stock('inventory',linked_item_id); END IF;
END $$;
REVOKE ALL ON FUNCTION public.delete_unused_record(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_unused_record(text,uuid) TO authenticated;

CREATE TABLE public.order_stock_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 order_id uuid NOT NULL REFERENCES orders(id),product_id uuid NOT NULL REFERENCES products(id),
 item_id uuid NOT NULL REFERENCES inventory_items(id),quantity numeric NOT NULL CHECK(quantity>0),
 unit_cost numeric NOT NULL CHECK(unit_cost>=0),total_cost numeric NOT NULL CHECK(total_cost>=0),
 posted_at timestamptz NOT NULL DEFAULT now(),reversed_at timestamptz,
 UNIQUE(order_id,product_id)
);
ALTER TABLE public.order_stock_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_stock_allocations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_stock_allocations TO authenticated;
CREATE POLICY own_stock_allocations ON public.order_stock_allocations FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE FUNCTION public.fulfill_order_from_stock(p_order_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); o orders; line record; stock inventory_items;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
 IF EXISTS(SELECT 1 FROM order_stock_allocations WHERE order_id=o.id AND reversed_at IS NULL) THEN RETURN o.id; END IF;
 IF o.status NOT IN ('draft','approved') OR EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) THEN RAISE EXCEPTION 'Atenda com estoque um pedido em rascunho ou aprovado, sem produção iniciada.'; END IF;
 IF o.customer_id IS NULL OR o.payment_due_date IS NULL OR o.total<=0 OR NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id) THEN RAISE EXCEPTION 'Informe cliente, vencimento e itens antes de atender o pedido.'; END IF;
 IF EXISTS(SELECT 1 FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id AND (p.stock_item_id IS NULL OR NOT p.is_active OR p.tenant_id<>t OR jsonb_array_length(coalesce(oi.material_overrides,'[]'))>0)) THEN RAISE EXCEPTION 'Todos os itens precisam ter estoque vinculado. Cores sob encomenda devem seguir pela produção.'; END IF;
 FOR line IN SELECT p.id AS product_id,p.stock_item_id,sum(oi.quantity) AS quantity FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=o.id GROUP BY p.id,p.stock_item_id ORDER BY p.stock_item_id LOOP
   SELECT * INTO stock FROM inventory_items WHERE id=line.stock_item_id AND tenant_id=t FOR UPDATE;
   IF NOT FOUND OR NOT stock.is_active OR stock.current_stock<line.quantity THEN RAISE EXCEPTION 'Estoque insuficiente para atender o pedido. Confira o saldo do produto.'; END IF;
   INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
   VALUES(t,stock.id,'adjustment',-line.quantity,'sales_order_stock',o.id,'Saída para o pedido '||o.code,auth.uid());
   INSERT INTO order_stock_allocations(tenant_id,order_id,product_id,item_id,quantity,unit_cost,total_cost) VALUES(t,o.id,line.product_id,stock.id,line.quantity,stock.avg_cost,round(line.quantity*stock.avg_cost,2));
 END LOOP;
 IF o.status='draft' THEN
   IF EXISTS(SELECT 1 FROM accounts_receivable WHERE origin_type='order' AND origin_id=o.id) THEN RAISE EXCEPTION 'Pedido já possui financeiro. Confira o lançamento existente.'; END IF;
   INSERT INTO accounts_receivable(tenant_id,customer_id,description,amount,due_date,competence_date,origin_type,origin_id,created_by) VALUES(t,o.customer_id,'Pedido '||o.code,o.total,o.payment_due_date,erp_private.today(t),'order',o.id,auth.uid());
 END IF;
 UPDATE orders SET status='ready',approved_at=coalesce(approved_at,now()) WHERE id=o.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'fulfill_stock','orders',o.id,'{}');
 RETURN o.id;
END $$;
REVOKE ALL ON FUNCTION public.fulfill_order_from_stock(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fulfill_order_from_stock(uuid) TO authenticated;

ALTER FUNCTION public.transition_sales_order(uuid,text) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.transition_sales_order(uuid,text) RENAME TO transition_sales_order_before_stock;
REVOKE ALL ON FUNCTION erp_private.transition_sales_order_before_stock(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.transition_sales_order(p_order_id uuid,p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; allocation order_stock_allocations;
BEGIN
 result:=erp_private.transition_sales_order_before_stock(p_order_id,p_status);
 IF p_status='cancelled' THEN
   FOR allocation IN SELECT * FROM order_stock_allocations WHERE order_id=result AND reversed_at IS NULL ORDER BY item_id FOR UPDATE LOOP
     INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
     VALUES(allocation.tenant_id,allocation.item_id,'purchase_in',allocation.quantity,allocation.unit_cost,'sales_order_stock_reversal',result,'Devolução ao estoque por cancelamento de pedido',auth.uid());
     UPDATE order_stock_allocations SET reversed_at=now() WHERE id=allocation.id;
   END LOOP;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.transition_sales_order(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_sales_order(uuid,text) TO authenticated;
