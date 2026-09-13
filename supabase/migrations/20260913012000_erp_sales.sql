CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; p products; photo jsonb; extra jsonb; idx integer:=0;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
  IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  result:=coalesce(p_product_id,gen_random_uuid());
  IF p_product_id IS NOT NULL THEN
    SELECT * INTO p FROM products WHERE id=p_product_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  END IF;
  IF jsonb_typeof(p_photos)<>'array' OR jsonb_array_length(p_photos)>30 THEN RAISE EXCEPTION 'Lista de fotos inválida.'; END IF;
  IF nullif(btrim(p_product->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Informe o nome do produto.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each_text(p_product) e WHERE e.key IN ('prints_per_plate','num_colors','est_time_minutes','post_process_minutes') AND e.value IS NOT NULL AND (e.value::numeric<>trunc(e.value::numeric))) THEN RAISE EXCEPTION 'Quantidades e minutos devem ser números inteiros.'; END IF;
  PERFORM erp_private.assert_ref('inventory_items',nullif(p_product->>'material_id','')::uuid,t);
  IF NOT erp_private.valid_number(coalesce((p_product->>'est_grams')::numeric,0)) OR NOT erp_private.valid_number(coalesce((p_product->>'est_time_minutes')::numeric,0))
    OR NOT erp_private.valid_number(coalesce((p_product->>'post_process_minutes')::numeric,0)) OR NOT erp_private.valid_number(coalesce((p_product->>'cost_estimate')::numeric,0))
    OR NOT erp_private.valid_number(coalesce((p_product->>'sale_price')::numeric,0)) OR coalesce((p_product->>'prints_per_plate')::integer,1) NOT BETWEEN 1 AND 10000
    OR coalesce((p_product->>'num_colors')::integer,1) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'Custos, tempo e quantidade por placa inválidos.'; END IF;
  FOR extra IN SELECT value FROM jsonb_array_elements(coalesce(p_product->'extras','[]')) LOOP
    IF extra ? '_kit_product_id' THEN
      PERFORM erp_private.assert_ref('products',(extra->>'_kit_product_id')::uuid,t);
      IF (extra->>'_kit_product_id')::uuid=result OR coalesce((extra->>'_kit_qty')::numeric,0)<=0 OR (extra->>'_kit_qty')::numeric<>trunc((extra->>'_kit_qty')::numeric) THEN RAISE EXCEPTION 'Componente de kit inválido.'; END IF;
      -- Reject direct and indirect cycles while allowing ordinary nested kits.
      IF EXISTS(WITH RECURSIVE bom(id,path) AS (
        SELECT (extra->>'_kit_product_id')::uuid,ARRAY[result]
        UNION ALL SELECT (e.value->>'_kit_product_id')::uuid,bom.path||bom.id FROM bom JOIN products c ON c.id=bom.id
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.extras,'[]')) e WHERE e.value ? '_kit_product_id' AND NOT bom.id=ANY(bom.path) AND cardinality(bom.path)<20
      ) SELECT 1 FROM bom WHERE id=ANY(path) OR cardinality(path)>=20) THEN RAISE EXCEPTION 'A composição do kit contém um ciclo ou profundidade excessiva.'; END IF;
    END IF;
    IF NOT erp_private.valid_number(coalesce((extra->>'cost')::numeric,0)) THEN RAISE EXCEPTION 'Custo de acessório inválido.'; END IF;
  END LOOP;
  INSERT INTO products(id,tenant_id,name,description,sku,category,photo_url,material_id,est_grams,est_time_minutes,post_process_minutes,cost_estimate,sale_price,margin_percent,is_active,notes,num_colors,prints_per_plate,extras)
  VALUES(result,t,btrim(p_product->>'name'),p_product->>'description',nullif(p_product->>'sku',''),coalesce(p_product->>'category','printed_part'),nullif(p_product->>'photo_url',''),nullif(p_product->>'material_id','')::uuid,
    coalesce((p_product->>'est_grams')::numeric,0),coalesce((p_product->>'est_time_minutes')::integer,0),coalesce((p_product->>'post_process_minutes')::integer,0),(p_product->>'cost_estimate')::numeric,(p_product->>'sale_price')::numeric,
    CASE WHEN (p_product->>'sale_price')::numeric>0 AND (p_product->>'cost_estimate')::numeric IS NOT NULL THEN round(((p_product->>'sale_price')::numeric-(p_product->>'cost_estimate')::numeric)/(p_product->>'sale_price')::numeric*100,2) ELSE NULL END,
    coalesce((p_product->>'is_active')::boolean,p.is_active,true),p_product->>'notes',coalesce((p_product->>'num_colors')::integer,1),coalesce((p_product->>'prints_per_plate')::integer,1),coalesce(p_product->'extras','[]'))
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,sku=excluded.sku,category=excluded.category,photo_url=excluded.photo_url,material_id=excluded.material_id,
    est_grams=excluded.est_grams,est_time_minutes=excluded.est_time_minutes,post_process_minutes=excluded.post_process_minutes,cost_estimate=excluded.cost_estimate,sale_price=excluded.sale_price,margin_percent=excluded.margin_percent,
    is_active=excluded.is_active,notes=excluded.notes,num_colors=excluded.num_colors,prints_per_plate=excluded.prints_per_plate,extras=excluded.extras;
  DELETE FROM product_photos WHERE product_id=result;
  FOR photo IN SELECT value FROM jsonb_array_elements(p_photos) LOOP
    IF jsonb_typeof(photo)<>'string' OR (photo#>>'{}') !~ '^https?://' THEN RAISE EXCEPTION 'URL de foto inválida.'; END IF;
    INSERT INTO product_photos(tenant_id,product_id,url,sort_order) VALUES(t,result,photo#>>'{}',idx); idx:=idx+1;
  END LOOP;
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.save_sales_order(p_order_id uuid,p_order jsonb,p_items jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; existing orders; item jsonb; subtotal numeric:=0; discount numeric; shipping numeric; total numeric; qty numeric; price numeric;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'sales_order',jsonb_build_array(p_order_id,p_order,p_items));
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO existing FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND OR existing.status<>'draft' OR EXISTS(SELECT 1 FROM jobs WHERE order_id=p_order_id) OR EXISTS(SELECT 1 FROM accounts_receivable WHERE origin_type='order' AND origin_id=p_order_id) THEN RAISE EXCEPTION 'Somente rascunhos sem produção ou financeiro podem ser editados.'; END IF;
  END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Inclua entre 1 e 500 itens.'; END IF;
  discount:=coalesce((p_order->>'discount')::numeric,0); shipping:=coalesce((p_order->>'shipping')::numeric,0); total:=(p_order->>'total')::numeric;
  IF NOT erp_private.valid_number(discount) OR NOT erp_private.valid_number(shipping) OR NOT erp_private.valid_number(total) THEN RAISE EXCEPTION 'Valores do pedido inválidos.'; END IF;
  PERFORM erp_private.assert_ref('customers',nullif(p_order->>'customer_id','')::uuid,t);
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    qty:=(item->>'quantity')::numeric; price:=(item->>'unit_price')::numeric;
    IF NOT erp_private.valid_number(qty,1) OR qty<>trunc(qty) OR qty>500 OR NOT erp_private.valid_number(price) OR price<>round(price,2)
      OR nullif(btrim(item->>'description'),'') IS NULL OR (item->>'total')::numeric IS DISTINCT FROM round(qty*price,2) THEN RAISE EXCEPTION 'Descrição, quantidade ou preço de item inválido.'; END IF;
    PERFORM erp_private.assert_ref('products',nullif(item->>'product_id','')::uuid,t);
    subtotal:=subtotal+round(qty*price,2);
  END LOOP;
  IF discount>subtotal OR total<>round(subtotal-discount+shipping,2) THEN RAISE EXCEPTION 'Total do pedido não confere.'; END IF;
  result:=coalesce(p_order_id,gen_random_uuid());
  INSERT INTO orders(id,tenant_id,code,customer_id,status,total,discount,shipping,notes,due_date,payment_due_date,created_by)
    VALUES(result,t,erp_private.next_code(t,'PED'),nullif(p_order->>'customer_id','')::uuid,'draft',total,discount,shipping,p_order->>'notes',nullif(p_order->>'due_date','')::date,nullif(p_order->>'payment_due_date','')::date,auth.uid())
  ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,total=excluded.total,discount=excluded.discount,shipping=excluded.shipping,notes=excluded.notes,due_date=excluded.due_date,payment_due_date=excluded.payment_due_date;
  DELETE FROM order_items WHERE order_id=result;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO order_items(tenant_id,order_id,product_id,description,quantity,unit_price,total,notes)
      VALUES(t,result,nullif(item->>'product_id','')::uuid,btrim(item->>'description'),(item->>'quantity')::integer,(item->>'unit_price')::numeric,(item->>'total')::numeric,item->>'notes');
  END LOOP;
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION erp_private.components(product uuid,t uuid,multiplier integer DEFAULT 1,path uuid[] DEFAULT ARRAY[]::uuid[])
RETURNS TABLE(product_id uuid,quantity integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p products; component jsonb;
BEGIN
  IF product=ANY(path) OR cardinality(path)>20 OR multiplier NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Composição de kit inválida ou acima de 500 peças.'; END IF;
  SELECT * INTO p FROM products WHERE id=product AND tenant_id=t;
  IF NOT FOUND OR NOT p.is_active THEN RAISE EXCEPTION 'Produto ou componente inativo.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.extras,'[]')) e WHERE e ? '_kit_product_id') THEN
    FOR component IN SELECT value FROM jsonb_array_elements(p.extras) WHERE value ? '_kit_product_id' LOOP
      RETURN QUERY SELECT * FROM erp_private.components((component->>'_kit_product_id')::uuid,t,multiplier*(component->>'_kit_qty')::integer,path||product);
    END LOOP;
  ELSE RETURN QUERY SELECT p.id,multiplier; END IF;
END $$;

CREATE FUNCTION erp_private.product_extras(product uuid,t uuid,path uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p products; e jsonb; total numeric:=0;
BEGIN
  IF product=ANY(path) OR cardinality(path)>20 THEN RAISE EXCEPTION 'Composição de kit inválida.'; END IF;
  SELECT * INTO p FROM products WHERE id=product AND tenant_id=t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Componente não encontrado.'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(coalesce(p.extras,'[]')) LOOP
    IF e ? '_kit_product_id' THEN total:=total+erp_private.product_extras((e->>'_kit_product_id')::uuid,t,path||product)*(e->>'_kit_qty')::integer;
    ELSE total:=total+coalesce((e->>'cost')::numeric,0); END IF;
  END LOOP;
  RETURN total;
END $$;

CREATE FUNCTION public.transition_sales_order(p_order_id uuid,p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); o orders; item order_items; component record; p products; material inventory_items;
  job_id uuid; ar accounts_receivable; subtotal numeric; line_cost numeric; line_count integer; idx integer; unit integer; allocated numeric; cumulative_weight numeric; line_revenue numeric; revenue numeric; cost numeric; material_cost numeric; grams numeric; minutes integer;
  order_allocated numeric:=0; cumulative_line_total numeric:=0; kit_extra numeric; leaf_extra numeric; extra_per_job numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status=p_status THEN RETURN o.id; END IF;
  IF p_status='cancelled' THEN
    IF o.status IN ('shipped','delivered','cancelled') THEN RAISE EXCEPTION 'Pedido já finalizado. Registre a devolução em vez de cancelar.'; END IF;
    PERFORM 1 FROM accounts_receivable WHERE origin_type='order' AND origin_id=o.id ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM accounts_receivable WHERE origin_type='order' AND origin_id=o.id AND amount_received>0) THEN RAISE EXCEPTION 'Pedido com recebimento não pode ser cancelado.'; END IF;
    IF EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id AND (started_at IS NOT NULL OR status NOT IN ('draft','queued','reprint'))) THEN RAISE EXCEPTION 'Resolva a produção iniciada antes de cancelar o pedido.'; END IF;
    UPDATE accounts_receivable SET status='reversed' WHERE origin_type='order' AND origin_id=o.id;
  ELSE
    IF NOT ((o.status='draft' AND p_status='approved') OR (o.status='approved' AND p_status='in_production') OR (o.status='in_production' AND p_status='ready')
      OR (o.status='ready' AND p_status IN ('shipped','delivered')) OR (o.status='shipped' AND p_status='delivered')) THEN RAISE EXCEPTION 'Transição do pedido não permitida.'; END IF;
    IF p_status='approved' THEN
      IF o.total<=0 OR o.customer_id IS NULL OR o.payment_due_date IS NULL OR NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id) THEN RAISE EXCEPTION 'Aprovação exige cliente, itens, valor positivo e vencimento do recebimento.'; END IF;
      IF EXISTS(SELECT 1 FROM accounts_receivable WHERE origin_type='order' AND origin_id=o.id) THEN RAISE EXCEPTION 'Rascunho já possui financeiro. Revise o vínculo antes de aprovar.'; END IF;
      INSERT INTO accounts_receivable(tenant_id,customer_id,description,amount,due_date,competence_date,origin_type,origin_id,created_by)
        VALUES(t,o.customer_id,'Pedido '||o.code,o.total,o.payment_due_date,erp_private.today(t),'order',o.id,auth.uid());
    ELSIF p_status='in_production' THEN
      IF EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) THEN RAISE EXCEPTION 'Pedido já possui produção vinculada. Confira as ordens existentes.'; END IF;
      SELECT sum(total) INTO subtotal FROM order_items WHERE order_id=o.id;
      FOR item IN SELECT * FROM order_items WHERE order_id=o.id ORDER BY id LOOP
        IF item.product_id IS NULL THEN RAISE EXCEPTION 'Vincule o produto de % antes de aprovar e produzir.',item.description; END IF;
        SELECT sum(coalesce(pr.cost_estimate,0)*c.quantity),sum(c.quantity) INTO line_cost,line_count FROM erp_private.components(item.product_id,t,item.quantity) c JOIN products pr ON pr.id=c.product_id;
        SELECT coalesce(sum(erp_private.product_extras(c.product_id,t)*c.quantity),0) INTO leaf_extra FROM erp_private.components(item.product_id,t,item.quantity) c;
        kit_extra:=greatest(0,erp_private.product_extras(item.product_id,t)*item.quantity-leaf_extra);
        IF line_count>500 THEN RAISE EXCEPTION 'Máximo de 500 ordens por item. Divida o pedido em lotes.'; END IF;
        idx:=0; allocated:=0; cumulative_weight:=0;
        cumulative_line_total:=cumulative_line_total+item.total;
        line_revenue:=CASE WHEN subtotal>0 THEN round((subtotal-o.discount)*cumulative_line_total/subtotal,2)-order_allocated ELSE 0 END;
        order_allocated:=order_allocated+line_revenue;
        FOR component IN SELECT c.*,pr.cost_estimate FROM erp_private.components(item.product_id,t,item.quantity) c JOIN products pr ON pr.id=c.product_id ORDER BY c.product_id LOOP
          SELECT * INTO p FROM products WHERE id=component.product_id;
          extra_per_job:=erp_private.product_extras(p.id,t)+kit_extra/line_count;
          SELECT * INTO material FROM inventory_items WHERE id=p.material_id;
          grams:=coalesce(p.est_grams,0)/greatest(coalesce(p.prints_per_plate,1),1);
          minutes:=greatest(1,ceil(coalesce(p.est_time_minutes,0)::numeric/greatest(coalesce(p.prints_per_plate,1),1)));
          material_cost:=CASE WHEN lower(btrim(material.unit))='kg' THEN grams/1000 WHEN lower(btrim(material.unit))='g' THEN grams ELSE 0 END*coalesce(material.avg_cost,0)*(1+coalesce(material.loss_coefficient,0));
          FOR unit IN 1..component.quantity LOOP
            idx:=idx+1; job_id:=gen_random_uuid();
            cumulative_weight:=cumulative_weight+CASE WHEN line_cost>0 THEN coalesce(p.cost_estimate,0)/line_cost ELSE 1::numeric/line_count END;
            revenue:=CASE WHEN idx=line_count THEN line_revenue-allocated ELSE round(line_revenue*cumulative_weight,2)-allocated END;
            allocated:=allocated+revenue;
            INSERT INTO jobs(id,tenant_id,code,name,description,status,product_id,material_id,order_id,order_item_id,order_unit_index,est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,due_date,num_colors,created_by)
              VALUES(job_id,t,erp_private.next_code(t,'OI'),p.name,'Pedido '||o.code||' · '||item.description||' · peça '||idx||'/'||line_count,'queued',p.id,p.material_id,o.id,item.id,idx,grams,minutes,round(material_cost,2),p.cost_estimate+kit_extra/line_count,round(extra_per_job,2),revenue,o.due_date,p.num_colors,auth.uid());
          END LOOP;
        END LOOP;
      END LOOP;
    ELSIF p_status='ready' THEN
      IF NOT EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM jobs j WHERE order_id=o.id AND status NOT IN ('ready','shipped','completed') AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=j.id)) THEN RAISE EXCEPTION 'Conclua as ordens de produção antes de marcar o pedido como pronto.'; END IF;
    END IF;
  END IF;
  UPDATE orders SET status=p_status,approved_at=CASE WHEN p_status='approved' THEN coalesce(approved_at,now()) ELSE approved_at END WHERE id=o.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'transition','orders',o.id,jsonb_build_object('from',o.status,'to',p_status));
  RETURN o.id;
END $$;
DROP POLICY ord_i ON orders; DROP POLICY ord_u ON orders; DROP POLICY ord_d ON orders;
DROP POLICY oi_i ON order_items; DROP POLICY oi_u ON order_items; DROP POLICY oi_d ON order_items;
REVOKE ALL ON FUNCTION erp_private.components(uuid,uuid,integer,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.product_extras(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid),public.save_sales_order(uuid,jsonb,jsonb,uuid),public.transition_sales_order(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid),public.save_sales_order(uuid,jsonb,jsonb,uuid),public.transition_sales_order(uuid,text) TO authenticated;
