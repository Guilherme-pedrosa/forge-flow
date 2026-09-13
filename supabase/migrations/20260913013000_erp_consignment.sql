ALTER TABLE public.consignment_locations ADD COLUMN commission_percent numeric NOT NULL DEFAULT 20;
CREATE FUNCTION public.create_consignment_location(p_location jsonb,p_customer jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; customer uuid; commission numeric;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'consignment_location',jsonb_build_array(p_location,p_customer));
  IF result IS NOT NULL THEN RETURN result; END IF;
  commission:=coalesce((p_location->>'commission_percent')::numeric,20);
  IF nullif(btrim(p_location->>'name'),'') IS NULL OR NOT erp_private.valid_number(commission) OR commission>100 THEN RAISE EXCEPTION 'Nome e comissão entre 0 e 100%% são obrigatórios.'; END IF;
  customer:=nullif(p_location->>'customer_id','')::uuid;
  IF customer IS NULL THEN
    IF nullif(btrim(p_customer->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Selecione ou cadastre o cliente do ponto.'; END IF;
    INSERT INTO customers(tenant_id,name,phone,email,document,birthday,is_active)
      VALUES(t,btrim(p_customer->>'name'),nullif(p_customer->>'phone',''),nullif(p_customer->>'email',''),nullif(p_customer->>'document',''),nullif(p_customer->>'birthday','')::date,true) RETURNING id INTO customer;
  ELSE PERFORM erp_private.assert_ref('customers',customer,t); END IF;
  INSERT INTO consignment_locations(tenant_id,name,customer_id,contact_name,phone,address,notes,commission_percent)
    VALUES(t,btrim(p_location->>'name'),customer,p_location->>'contact_name',p_location->>'phone',p_location->>'address',p_location->>'notes',commission) RETURNING id INTO result;
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.post_consignment_movement(p_location_id uuid,p_type text,p_items jsonb,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; loc consignment_locations; line jsonb; prod products; stock consignment_items;
  qty numeric; price numeric; gross numeric:=0; commission numeric:=0; net numeric; sale_order uuid; mov_id uuid;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'consignment_movement',jsonb_build_array(p_location_id,p_type,p_items,p_notes));
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT * INTO loc FROM consignment_locations WHERE id=p_location_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR NOT loc.is_active THEN RAISE EXCEPTION 'Ponto inválido ou arquivado.'; END IF;
  IF p_type NOT IN ('placement','replenishment','return','sale') OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Movimentação inválida.'; END IF;
  IF (SELECT count(DISTINCT value->>'product_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Agrupe as quantidades do mesmo produto em uma linha.'; END IF;
  IF NOT erp_private.valid_number(loc.commission_percent) OR loc.commission_percent>100 THEN RAISE EXCEPTION 'Regularize a comissão do ponto.'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'product_id' LOOP
    qty:=(line->>'quantity')::numeric; price:=coalesce((line->>'unit_price')::numeric,0);
    IF NOT erp_private.valid_number(qty,1) OR qty<>trunc(qty) OR qty>100000 OR NOT erp_private.valid_number(price) OR price<>round(price,2) THEN RAISE EXCEPTION 'Quantidade e preço inválidos.'; END IF;
    SELECT * INTO prod FROM products WHERE id=(line->>'product_id')::uuid AND tenant_id=t FOR UPDATE;
    IF NOT FOUND OR (NOT prod.is_active AND p_type<>'return') THEN RAISE EXCEPTION 'Produto inválido ou arquivado.'; END IF;
    IF p_type='sale' AND price<=0 THEN RAISE EXCEPTION 'Informe o preço de venda do produto.'; END IF;
    INSERT INTO consignment_items(tenant_id,location_id,product_id) VALUES(t,loc.id,prod.id) ON CONFLICT(location_id,product_id) DO NOTHING;
    SELECT * INTO stock FROM consignment_items WHERE location_id=loc.id AND product_id=prod.id FOR UPDATE;
    IF p_type IN ('sale','return') AND stock.current_qty<qty THEN RAISE EXCEPTION 'Saldo insuficiente de %: disponível %.',prod.name,stock.current_qty; END IF;
    gross:=gross+round(qty*price,2); commission:=commission+round(price*loc.commission_percent/100,2)*qty;
  END LOOP;
  net:=gross-commission;
  IF p_type='sale' THEN
    IF loc.customer_id IS NULL THEN RAISE EXCEPTION 'Vincule um cliente ao ponto antes de vender.'; END IF;
    sale_order:=gen_random_uuid();
    INSERT INTO orders(id,tenant_id,code,customer_id,status,total,discount,notes,approved_at,payment_due_date,created_by)
      VALUES(sale_order,t,erp_private.next_code(t,'CSG'),loc.customer_id,'delivered',net,commission,
        'Venda consignada — '||loc.name||'. Bruto: '||gross||'; comissão retida: '||commission||'; repasse líquido: '||net||coalesce(E'\n'||p_notes,''),now(),erp_private.today(t),auth.uid());
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'product_id' LOOP
    qty:=(line->>'quantity')::numeric; price:=coalesce((line->>'unit_price')::numeric,0);
    SELECT * INTO prod FROM products WHERE id=(line->>'product_id')::uuid;
    INSERT INTO consignment_movements(tenant_id,location_id,product_id,movement_type,quantity,unit_price,total,notes,created_by)
      VALUES(t,loc.id,prod.id,p_type::consignment_movement_type,qty,price,round(qty*price,2),p_notes,auth.uid()) RETURNING id INTO mov_id;
    result:=coalesce(result,mov_id);
    UPDATE consignment_items SET current_qty=current_qty+CASE WHEN p_type IN ('sale','return') THEN -qty ELSE qty END,
      total_placed=total_placed+CASE WHEN p_type IN ('placement','replenishment') THEN qty ELSE 0 END,
      total_sold=total_sold+CASE WHEN p_type='sale' THEN qty ELSE 0 END,total_returned=total_returned+CASE WHEN p_type='return' THEN qty ELSE 0 END
      WHERE location_id=loc.id AND product_id=prod.id;
    IF p_type='sale' THEN
      INSERT INTO order_items(tenant_id,order_id,product_id,description,quantity,unit_price,total) VALUES(t,sale_order,prod.id,prod.name,qty,price,round(qty*price,2));
    END IF;
  END LOOP;
  IF p_type='sale' AND net>0 THEN
    INSERT INTO accounts_receivable(tenant_id,customer_id,description,amount,due_date,competence_date,origin_type,origin_id,created_by)
      VALUES(t,loc.customer_id,'Repasse consignado — '||loc.name,net,erp_private.today(t),erp_private.today(t),'order',sale_order,auth.uid());
  END IF;
  result:=coalesce(sale_order,result);
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),p_type,'consignment_locations',loc.id,jsonb_build_object('result_id',result,'gross',gross,'commission',CASE WHEN p_type='sale' THEN commission ELSE 0 END));
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.adjust_consignment_stock(p_item_id uuid,p_new_quantity integer,p_expected_quantity integer,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; stock consignment_items; difference integer;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'consignment_adjustment',jsonb_build_array(p_item_id,p_new_quantity,p_expected_quantity,p_reason));
  IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM consignment_locations WHERE id=(SELECT location_id FROM consignment_items WHERE id=p_item_id AND tenant_id=t) FOR UPDATE;
  PERFORM 1 FROM products WHERE id=(SELECT product_id FROM consignment_items WHERE id=p_item_id AND tenant_id=t) FOR UPDATE;
  SELECT * INTO stock FROM consignment_items WHERE id=p_item_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saldo não encontrado.'; END IF;
  IF p_new_quantity IS NULL OR p_new_quantity<0 OR p_new_quantity>100000 OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe quantidade válida e motivo da conferência.'; END IF;
  IF stock.current_qty IS DISTINCT FROM p_expected_quantity THEN RAISE EXCEPTION 'O saldo mudou. Atualize a tela antes de conferir novamente.'; END IF;
  difference:=p_new_quantity-stock.current_qty;
  IF difference>0 AND NOT EXISTS(SELECT 1 FROM products WHERE id=stock.product_id AND is_active) THEN RAISE EXCEPTION 'Produto arquivado não pode receber novas peças.'; END IF;
  IF difference=0 THEN RAISE EXCEPTION 'O saldo informado não altera a quantidade atual.'; END IF;
  INSERT INTO consignment_movements(tenant_id,location_id,product_id,movement_type,quantity,notes,created_by)
    VALUES(t,stock.location_id,stock.product_id,CASE WHEN difference>0 THEN 'placement'::consignment_movement_type ELSE 'return'::consignment_movement_type END,abs(difference),'Conferência de saldo: '||btrim(p_reason),auth.uid()) RETURNING id INTO result;
  UPDATE consignment_items SET current_qty=p_new_quantity,total_placed=total_placed+greatest(difference,0),total_returned=total_returned+greatest(-difference,0) WHERE id=stock.id;
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.erp_guard_consignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='consignment_locations' THEN
    IF TG_OP='DELETE' THEN
      IF EXISTS(SELECT 1 FROM public.consignment_movements WHERE location_id=OLD.id) THEN RAISE EXCEPTION 'Ponto com histórico deve ser arquivado.'; END IF; RETURN OLD;
    END IF;
    IF NEW.commission_percent IS NULL OR NEW.commission_percent::text IN ('NaN','Infinity','-Infinity') OR NEW.commission_percent NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Comissão deve estar entre 0 e 100%%.'; END IF;
    IF NOT NEW.is_active AND EXISTS(SELECT 1 FROM public.consignment_items WHERE location_id=NEW.id AND current_qty>0) THEN RAISE EXCEPTION 'Recolha as peças antes de arquivar o ponto.'; END IF;
  ELSIF current_user IN ('authenticated','anon') AND (to_jsonb(NEW)-ARRAY['sale_price','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['sale_price','updated_at']) THEN
    RAISE EXCEPTION 'Use uma movimentação ou conferência de saldo para alterar o consignado.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_consignment_location_guard BEFORE INSERT OR UPDATE OR DELETE ON consignment_locations FOR EACH ROW EXECUTE FUNCTION erp_guard_consignment();
CREATE TRIGGER erp_consignment_stock_guard BEFORE UPDATE ON consignment_items FOR EACH ROW EXECUTE FUNCTION erp_guard_consignment();
DROP POLICY ci_i ON consignment_items; DROP POLICY ci_d ON consignment_items; DROP POLICY cm_i ON consignment_movements;
REVOKE ALL ON FUNCTION public.create_consignment_location(jsonb,jsonb,uuid),public.post_consignment_movement(uuid,text,jsonb,text,uuid),public.adjust_consignment_stock(uuid,integer,integer,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_consignment_location(jsonb,jsonb,uuid),public.post_consignment_movement(uuid,text,jsonb,text,uuid),public.adjust_consignment_stock(uuid,integer,integer,text,uuid) TO authenticated;
