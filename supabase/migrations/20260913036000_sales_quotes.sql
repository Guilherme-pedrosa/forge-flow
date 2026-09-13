-- Commercial quotations are independent from sales/receivables. Only normal
-- order approval creates a receivable atomically when converting an approved offer.
CREATE TABLE public.sales_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','approved','rejected')),
  revision integer NOT NULL DEFAULT 1,customer_id uuid REFERENCES customers(id),customer_snapshot jsonb,
  valid_until date,due_date date,payment_due_date date,subtotal numeric,discount numeric NOT NULL DEFAULT 0,
  shipping numeric NOT NULL DEFAULT 0,total numeric,notes text,rejection_reason text,order_id uuid UNIQUE REFERENCES orders(id),
  issued_at timestamptz,approved_at timestamptz,rejected_at timestamptz,converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES auth.users(id),
  UNIQUE(tenant_id,code),CHECK(discount>=0 AND discount<'Infinity'::numeric AND shipping>=0 AND shipping<'Infinity'::numeric),
  CHECK(subtotal IS NULL OR (subtotal>=0 AND subtotal<'Infinity'::numeric)),CHECK(total IS NULL OR (total>=0 AND total<'Infinity'::numeric))
);
CREATE TABLE public.sales_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),quote_id uuid NOT NULL REFERENCES sales_quotes(id),
  line_index integer NOT NULL CHECK(line_index>=1),product_id uuid NOT NULL REFERENCES products(id),description text NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 500),unit_price numeric,total numeric,notes text,
  estimated_unit_cost numeric,estimated_total_cost numeric,product_snapshot jsonb NOT NULL,
  UNIQUE(quote_id,line_index),CHECK(unit_price IS NULL OR (unit_price>=0 AND unit_price<'Infinity'::numeric)),
  CHECK(total IS NULL OR (total>=0 AND total<'Infinity'::numeric)),
  CHECK(estimated_unit_cost IS NULL OR (estimated_unit_cost>=0 AND estimated_unit_cost<'Infinity'::numeric)),
  CHECK(estimated_total_cost IS NULL OR (estimated_total_cost>=0 AND estimated_total_cost<'Infinity'::numeric))
);
CREATE INDEX sales_quotes_tenant_date ON sales_quotes(tenant_id,created_at DESC);
CREATE INDEX sales_quote_items_quote ON sales_quote_items(tenant_id,quote_id,line_index);
ALTER TABLE sales_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_quote_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_quotes,sales_quote_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON sales_quotes,sales_quote_items TO authenticated;
CREATE POLICY sales_quotes_read ON sales_quotes FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE POLICY sales_quote_items_read ON sales_quote_items FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
ALTER TABLE orders ADD COLUMN source_quote_id uuid UNIQUE REFERENCES sales_quotes(id);
ALTER TABLE order_items ADD COLUMN source_quote_item_id uuid UNIQUE REFERENCES sales_quote_items(id),ADD COLUMN product_snapshot jsonb,ADD COLUMN quoted_estimated_cost numeric;


-- Quote physical batches, including disclosed excess capacity. Cost allocation
-- matches production's full runs and per-job rounding, including nested kits.
-- Time/file preparation can remain pending without fabricating a cost of zero.
CREATE FUNCTION erp_private.quote_print_costs(p_snapshot jsonb,p_quantity integer,p_depth integer DEFAULT 0)
RETURNS SETOF numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE part jsonb; plate jsonb; recipe jsonb; child_cost numeric; costs numeric[]:='{}';
  units integer; runs integer; run integer; extra numeric; quantity integer; idx integer:=0; allocated numeric:=0; share numeric;
BEGIN
  IF p_depth>20 OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Quantidade ou profundidade da composição inválida.'; END IF;
  IF (p_snapshot->>'complete')::boolean IS DISTINCT FROM true THEN RETURN; END IF;
  IF jsonb_array_length(coalesce(p_snapshot->'components','[]'))>0 THEN
    FOR part IN SELECT value FROM jsonb_array_elements(p_snapshot->'components') LOOP
      quantity:=p_quantity*(part->>'quantity')::integer;
      FOR child_cost IN SELECT * FROM erp_private.quote_print_costs(part->'snapshot',quantity,p_depth+1) LOOP
        costs:=array_append(costs,child_cost);
        IF cardinality(costs)>500 THEN RAISE EXCEPTION 'Máximo de 500 impressões por item. Divida o orçamento em lotes.'; END IF;
      END LOOP;
    END LOOP;
    IF cardinality(costs)=0 THEN RETURN; END IF;
    extra:=coalesce((p_snapshot->>'kit_extras_cost_per_unit')::numeric,0)*p_quantity;
    FOREACH child_cost IN ARRAY costs LOOP
      idx:=idx+1;share:=round(extra*idx/cardinality(costs),2)-allocated;allocated:=allocated+share;RETURN NEXT child_cost+share;
    END LOOP;
    RETURN;
  END IF;
  FOR plate IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_array_length(coalesce(p_snapshot->'plates','[]'))>0 THEN p_snapshot->'plates' ELSE '[{}]'::jsonb END) LOOP
    recipe:=CASE WHEN plate ? 'id' THEN plate->'recipe' ELSE p_snapshot->'recipe' END;
    units:=(recipe->>'units_per_print')::integer;
    IF units IS NULL OR units NOT BETWEEN 1 AND 10000 OR recipe->>'cost_per_unit' IS NULL THEN RETURN; END IF;
    runs:=ceil(p_quantity::numeric/units);
    IF runs+cardinality(costs)>500 THEN RAISE EXCEPTION 'Máximo de 500 impressões por item. Divida o orçamento em lotes.'; END IF;
    child_cost:=(recipe->>'cost_per_unit')::numeric*units;
    FOR run IN 1..runs LOOP costs:=array_append(costs,child_cost); RETURN NEXT child_cost; END LOOP;
  END LOOP;
END $$;
CREATE FUNCTION erp_private.quote_estimated_cost(p_snapshot jsonb,p_quantity integer) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$ SELECT sum(round(cost,2)) FROM erp_private.quote_print_costs(p_snapshot,p_quantity) cost $$;
REVOKE ALL ON FUNCTION erp_private.quote_print_costs(jsonb,integer,integer),erp_private.quote_estimated_cost(jsonb,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_sales_quote(p_quote_id uuid,p_quote jsonb,p_items jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
<<quote_save>>
DECLARE t uuid:=erp_private.actor(); result uuid; existing sales_quotes; c customers; item jsonb; product products;
  discount numeric; shipping numeric; total numeric; subtotal numeric:=0; qty numeric; price numeric; line_total numeric;
  all_priced boolean:=true; snapshot jsonb; estimate numeric; idx integer:=0; key text;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'sales_quote',jsonb_build_array(p_quote_id,p_quote,p_items));
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF p_quote IS NULL OR jsonb_typeof(p_quote)<>'object' OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Informe os dados e entre 1 e 500 itens do orçamento.'; END IF;
  FOR key IN SELECT jsonb_object_keys(p_quote) LOOP
    IF NOT key=ANY(ARRAY['customer_id','valid_until','due_date','payment_due_date','discount','shipping','total','notes','expected_revision']) THEN RAISE EXCEPTION 'Campo do orçamento não permitido: %',key; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  IF p_quote_id IS NOT NULL THEN
    SELECT * INTO existing FROM sales_quotes WHERE id=p_quote_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND OR existing.status<>'draft' OR existing.order_id IS NOT NULL THEN RAISE EXCEPTION 'Somente rascunhos podem ser editados. Duplique o orçamento para revisar uma proposta emitida.'; END IF;
    IF (p_quote->>'expected_revision')::integer IS DISTINCT FROM existing.revision THEN RAISE EXCEPTION 'Este orçamento foi alterado. Atualize a página antes de salvar.'; END IF;
  END IF;
  PERFORM erp_private.assert_ref('customers',nullif(p_quote->>'customer_id','')::uuid,t);
  SELECT * INTO c FROM customers WHERE id=nullif(p_quote->>'customer_id','')::uuid AND tenant_id=t;
  IF c.id IS NOT NULL AND NOT c.is_active THEN RAISE EXCEPTION 'Selecione um cliente ativo.'; END IF;
  discount:=coalesce((p_quote->>'discount')::numeric,0);shipping:=coalesce((p_quote->>'shipping')::numeric,0);total:=(p_quote->>'total')::numeric;
  IF NOT erp_private.valid_number(discount) OR NOT erp_private.valid_number(shipping) OR discount<>round(discount,2) OR shipping<>round(shipping,2)
    OR (total IS NOT NULL AND NOT erp_private.valid_number(total)) THEN RAISE EXCEPTION 'Frete, desconto e total devem ser valores válidos em centavos.'; END IF;
  result:=coalesce(p_quote_id,gen_random_uuid());
  INSERT INTO sales_quotes(id,tenant_id,code,customer_id,customer_snapshot,valid_until,due_date,payment_due_date,discount,shipping,notes,created_by)
    VALUES(result,t,erp_private.next_code(t,'ORC'),c.id,CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'name',c.name,'document',c.document,'email',c.email,'phone',c.phone,'address',c.address) END,
      nullif(p_quote->>'valid_until','')::date,nullif(p_quote->>'due_date','')::date,nullif(p_quote->>'payment_due_date','')::date,discount,shipping,p_quote->>'notes',auth.uid())
    ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,customer_snapshot=excluded.customer_snapshot,valid_until=excluded.valid_until,
      due_date=excluded.due_date,payment_due_date=excluded.payment_due_date,discount=excluded.discount,shipping=excluded.shipping,notes=excluded.notes,revision=sales_quotes.revision+1,updated_at=now();
  DELETE FROM sales_quote_items WHERE quote_id=result AND tenant_id=t;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'Item de orçamento inválido.'; END IF;
    FOR key IN SELECT jsonb_object_keys(item) LOOP
      IF NOT key=ANY(ARRAY['product_id','description','quantity','unit_price','total','notes']) THEN RAISE EXCEPTION 'Campo do item não permitido: %',key; END IF;
    END LOOP;
    qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
    IF NOT erp_private.valid_number(qty,1) OR qty<>trunc(qty) OR qty>500 OR (price IS NOT NULL AND (NOT erp_private.valid_number(price) OR price<>round(price,2))) THEN RAISE EXCEPTION 'Quantidade ou preço do item inválido.'; END IF;
    SELECT * INTO product FROM products WHERE id=nullif(item->>'product_id','')::uuid AND tenant_id=t AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cada item precisa de um produto ativo da sua empresa.'; END IF;
    line_total:=round(qty*price,2);
    IF (item->>'total')::numeric IS DISTINCT FROM line_total THEN RAISE EXCEPTION 'Total do item não confere.'; END IF;
    IF price IS NULL THEN all_priced:=false; ELSE subtotal:=subtotal+line_total; END IF;
    snapshot:=erp_private.product_bom_snapshot(product.id,t);
    estimate:=(snapshot->>'cost_per_unit')::numeric;
    IF estimate IS NOT NULL AND NOT erp_private.valid_number(estimate) THEN RAISE EXCEPTION 'A previsão de custo do produto é inválida.'; END IF;
    idx:=idx+1;
    INSERT INTO sales_quote_items(tenant_id,quote_id,line_index,product_id,description,quantity,unit_price,total,notes,estimated_unit_cost,estimated_total_cost,product_snapshot)
      VALUES(t,result,idx,product.id,coalesce(nullif(btrim(item->>'description'),''),product.name),qty::integer,price,line_total,item->>'notes',estimate,erp_private.quote_estimated_cost(snapshot,qty::integer),snapshot);
  END LOOP;
  IF NOT all_priced THEN subtotal:=NULL; END IF;
  IF (subtotal IS NOT NULL AND discount>subtotal) OR total IS DISTINCT FROM round(subtotal-discount+shipping,2) THEN RAISE EXCEPTION 'Total do orçamento não confere. Preços ausentes devem permanecer pendentes.'; END IF;
  UPDATE sales_quotes SET subtotal=quote_save.subtotal,total=quote_save.total WHERE id=result;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'save','sales_quotes',result,jsonb_build_object('revision',coalesce(existing.revision,0)+1));
  PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;


-- A frozen offer must be producible without replacing its approved recipe.
-- File/printer preparation remains separate; time per full print is required.
CREATE FUNCTION erp_private.assert_bom_production_time(p_snapshot jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE component jsonb; plate jsonb; duration numeric;
BEGIN
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A composição de produção está incompleta.'; END IF;
  IF jsonb_array_length(coalesce(p_snapshot->'components','[]'))>0 THEN
    FOR component IN SELECT value FROM jsonb_array_elements(p_snapshot->'components') LOOP
      PERFORM erp_private.assert_bom_production_time(component->'snapshot');
    END LOOP;
  ELSIF jsonb_array_length(coalesce(p_snapshot->'plates','[]'))>0 THEN
    FOR plate IN SELECT value FROM jsonb_array_elements(p_snapshot->'plates') LOOP
      duration:=(plate->>'est_time_seconds')::numeric;
      IF NOT erp_private.valid_number(duration,0.001) THEN
        RAISE EXCEPTION 'Complete o tempo por impressão da placa % antes de emitir ou aprovar a venda.',coalesce(plate->>'label','sem nome');
      END IF;
    END LOOP;
  ELSE
    duration:=(p_snapshot->'product'->>'est_time_minutes')::numeric;
    IF NOT erp_private.valid_number(duration,1) OR duration<>trunc(duration) THEN
      RAISE EXCEPTION 'Complete o tempo por impressão de % antes de emitir ou aprovar a venda.',coalesce(p_snapshot->'product'->>'name','cada produto');
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION erp_private.assert_bom_production_time(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.transition_sales_quote(p_quote_id uuid,p_status text,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); q sales_quotes; item sales_quote_items; snapshot jsonb; estimate numeric; c customers;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO q FROM sales_quotes WHERE id=p_quote_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF q.status=p_status THEN RETURN q.id; END IF;
  IF q.order_id IS NOT NULL THEN RAISE EXCEPTION 'O orçamento já foi convertido em pedido.'; END IF;
  IF NOT ((q.status='draft' AND p_status='issued') OR (q.status='issued' AND p_status='approved') OR (q.status IN ('draft','issued') AND p_status='rejected')) OR p_status IS NULL THEN RAISE EXCEPTION 'Transição do orçamento não permitida.'; END IF;
  IF p_status='rejected' THEN
    IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da rejeição.'; END IF;
  ELSE
    IF q.customer_id IS NULL OR q.total IS NULL OR q.total<=0 OR q.valid_until IS NULL OR q.valid_until<erp_private.today(t) OR q.payment_due_date IS NULL THEN RAISE EXCEPTION 'Informe cliente, preços, total positivo, validade vigente e vencimento do recebimento antes de emitir ou aprovar.'; END IF;
    IF NOT EXISTS(SELECT 1 FROM sales_quote_items WHERE quote_id=q.id AND tenant_id=t) THEN RAISE EXCEPTION 'Adicione os produtos do orçamento.'; END IF;
    SELECT * INTO c FROM customers WHERE id=q.customer_id AND tenant_id=t;
    IF NOT FOUND OR NOT c.is_active THEN RAISE EXCEPTION 'O cliente está inativo ou indisponível.'; END IF;
    FOR item IN SELECT * FROM sales_quote_items WHERE quote_id=q.id AND tenant_id=t ORDER BY line_index FOR UPDATE LOOP
      -- Emission freezes the authoritative composition. Approval never refreshes
      -- it from a catalogue that may have changed after the offer was issued.
      snapshot:=CASE WHEN p_status='issued' THEN erp_private.product_bom_snapshot(item.product_id,t) ELSE item.product_snapshot END;
      estimate:=(snapshot->>'cost_per_unit')::numeric;
      IF (snapshot->>'complete')::boolean IS DISTINCT FROM true OR NOT erp_private.valid_number(estimate) OR item.unit_price IS NULL THEN
        RAISE EXCEPTION 'Complete material, cor, receita e previsão de custo de % antes de emitir. O rascunho foi preservado.',item.description;
      END IF;
      IF p_status='issued' THEN
        PERFORM erp_private.assert_bom_production_time(snapshot);
        UPDATE sales_quote_items SET product_snapshot=snapshot,estimated_unit_cost=estimate,estimated_total_cost=erp_private.quote_estimated_cost(snapshot,item.quantity) WHERE id=item.id; END IF;
    END LOOP;
  END IF;
  UPDATE sales_quotes SET status=p_status,revision=revision+1,issued_at=CASE WHEN p_status='issued' THEN now() ELSE issued_at END,
    customer_snapshot=CASE WHEN p_status='issued' THEN jsonb_build_object('id',c.id,'name',c.name,'document',c.document,'email',c.email,'phone',c.phone,'address',c.address) ELSE customer_snapshot END,
    approved_at=CASE WHEN p_status='approved' THEN now() ELSE approved_at END,rejected_at=CASE WHEN p_status='rejected' THEN now() ELSE rejected_at END,
    rejection_reason=CASE WHEN p_status='rejected' THEN btrim(p_reason) ELSE rejection_reason END,updated_at=now() WHERE id=q.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'transition','sales_quotes',q.id,jsonb_build_object('from',q.status,'to',p_status,'reason',nullif(btrim(p_reason),'')));
  RETURN q.id;
END $$;

CREATE FUNCTION public.convert_sales_quote(p_quote_id uuid,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); q sales_quotes; item sales_quote_items; result uuid; items jsonb;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'convert_sales_quote',jsonb_build_array(p_quote_id));
  IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO q FROM sales_quotes WHERE id=p_quote_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF q.order_id IS NOT NULL THEN PERFORM erp_private.finish_request(t,p_request_id,q.order_id);RETURN q.order_id; END IF;
  IF q.status<>'approved' THEN RAISE EXCEPTION 'Aprove o orçamento antes de convertê-lo em venda.'; END IF;
  IF q.customer_id IS NULL OR q.payment_due_date IS NULL OR q.total IS NULL OR q.total<=0 OR NOT EXISTS(SELECT 1 FROM customers WHERE id=q.customer_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'A conversão exige cliente ativo, vencimento e valor positivo.'; END IF;
  -- Do not consult current product prices/BOM. The approved offer is the source.
  result:=gen_random_uuid();
  INSERT INTO orders(id,tenant_id,code,customer_id,status,total,discount,shipping,notes,due_date,payment_due_date,created_by)
    VALUES(result,t,erp_private.next_code(t,'PED'),q.customer_id,'draft',q.total,q.discount,q.shipping,q.notes,q.due_date,q.payment_due_date,auth.uid());
  FOR item IN SELECT * FROM sales_quote_items WHERE quote_id=q.id AND tenant_id=t ORDER BY line_index LOOP
    INSERT INTO order_items(tenant_id,order_id,product_id,description,quantity,unit_price,total,notes,source_quote_item_id,product_snapshot,quoted_estimated_cost)
      VALUES(t,result,item.product_id,item.description,item.quantity,item.unit_price,item.total,item.notes,item.id,item.product_snapshot,item.estimated_total_cost);
  END LOOP;
  UPDATE orders SET source_quote_id=q.id WHERE id=result;
  PERFORM public.transition_sales_order(result,'approved');
  UPDATE sales_quotes SET order_id=result,converted_at=now(),updated_at=now() WHERE id=q.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'convert','sales_quotes',q.id,jsonb_build_object('order_id',result,'receivable_created',true));
  PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;

-- Converted sales preserve the commercial content and production snapshot
-- of the approved offer through all later operational transitions.
CREATE FUNCTION public.erp_guard_quote_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='orders' THEN
    IF OLD.source_quote_id IS NOT NULL AND (NEW.source_quote_id,NEW.customer_id,NEW.total,NEW.discount,NEW.shipping,NEW.notes,NEW.due_date,NEW.payment_due_date)
      IS DISTINCT FROM (OLD.source_quote_id,OLD.customer_id,OLD.total,OLD.discount,OLD.shipping,OLD.notes,OLD.due_date,OLD.payment_due_date) THEN RAISE EXCEPTION 'Os dados do pedido vieram do orçamento aprovado e estão congelados. Crie uma nova proposta para alterar a venda.'; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM orders WHERE source_quote_id IS NOT NULL AND
      (id=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END OR (TG_OP='UPDATE' AND id=OLD.order_id))) THEN
    RAISE EXCEPTION 'Os itens e a composição do orçamento aprovado não podem ser alterados no pedido.';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER erp_quote_order_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION erp_guard_quote_order();
CREATE TRIGGER erp_quote_order_item_guard BEFORE INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION erp_guard_quote_order();
REVOKE ALL ON FUNCTION public.erp_guard_quote_order() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_sales_quote(uuid,jsonb,jsonb,uuid),public.transition_sales_quote(uuid,text,text),public.convert_sales_quote(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_sales_quote(uuid,jsonb,jsonb,uuid),public.transition_sales_quote(uuid,text,text),public.convert_sales_quote(uuid,uuid) TO authenticated;
