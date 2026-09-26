-- Financial catalogues are managed by the same financial roles as their use.
CREATE FUNCTION public.save_financial_catalog(p_kind text,p_id uuid,p_values jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid:=coalesce(p_id,gen_random_uuid()); prior uuid; tbl text; old jsonb;
 n text:=btrim(p_values->>'name'); c text:=nullif(btrim(p_values->>'code'),''); typ text:=p_values->>'type'; active boolean:=coalesce((p_values->>'is_active')::boolean,true);
BEGIN
 tbl:=CASE p_kind WHEN 'payment_method' THEN 'payment_methods' WHEN 'account' THEN 'chart_of_accounts' WHEN 'cost_center' THEN 'cost_centers' END;
 IF tbl IS NULL THEN RAISE EXCEPTION 'Cadastro financeiro inválido.'; END IF;
 IF n IS NULL OR length(n)<2 OR length(n)>160 THEN RAISE EXCEPTION 'Informe um nome de 2 a 160 caracteres.'; END IF;
 prior:=erp_private.begin_request(t,p_request_id,'save_financial_catalog',jsonb_build_array(p_kind,p_id,p_values));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-financial-catalog-'||t::text,0));
 IF p_id IS NOT NULL THEN
   EXECUTE format('SELECT to_jsonb(x) FROM %I x WHERE id=$1 AND tenant_id=$2 FOR UPDATE',tbl) INTO old USING p_id,t;
   IF old IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
   IF coalesce((old->>'is_system')::boolean,false) THEN RAISE EXCEPTION 'Este cadastro é mantido pelo sistema.'; END IF;
   IF p_values ? 'expected' AND (
     (p_values->'expected'->>'updated_at')::timestamptz IS DISTINCT FROM (old->>'updated_at')::timestamptz OR
     EXISTS(SELECT 1 FROM jsonb_each(p_values->'expected') e WHERE e.key IN('name','code','type','account_type','is_active','description') AND old->e.key IS DISTINCT FROM e.value)
   ) THEN RAISE EXCEPTION 'O cadastro foi alterado. Atualize a lista e reabra antes de salvar.'; END IF;
 END IF;
 IF p_kind='payment_method' THEN
   IF typ IS NULL OR typ NOT IN('cash','pix','credit_card','debit_card','bank_transfer','boleto','other') THEN RAISE EXCEPTION 'Selecione o tipo de pagamento.'; END IF;
   IF EXISTS(SELECT 1 FROM payment_methods WHERE tenant_id=t AND lower(btrim(name))=lower(n) AND id<>result) THEN RAISE EXCEPTION 'Já existe uma forma de pagamento com este nome.'; END IF;
   INSERT INTO payment_methods(id,tenant_id,name,type,is_active) VALUES(result,t,n,typ,active)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,is_active=excluded.is_active;
 ELSE
   IF c IS NULL THEN c:=CASE p_kind WHEN 'account' THEN 'PC-' ELSE 'CC-' END||substr(result::text,1,8); END IF;
   IF length(c)>40 THEN RAISE EXCEPTION 'O código pode ter até 40 caracteres.'; END IF;
   IF p_kind='account' THEN
     IF typ IS NULL OR typ NOT IN('revenue','expense','asset','liability','equity') THEN RAISE EXCEPTION 'Selecione a natureza da classificação.'; END IF;
     IF old IS NOT NULL AND old->>'account_type'<>typ AND
       (EXISTS(SELECT 1 FROM accounts_payable WHERE account_id=p_id) OR EXISTS(SELECT 1 FROM accounts_receivable WHERE account_id=p_id))
     THEN RAISE EXCEPTION 'Classificação já usada. Crie outra para mudar a natureza sem alterar os resultados anteriores.'; END IF;
     INSERT INTO chart_of_accounts(id,tenant_id,code,name,account_type,is_active,description) VALUES(result,t,c,n,typ::account_type,active,nullif(btrim(p_values->>'description'),''))
     ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,account_type=excluded.account_type,is_active=excluded.is_active,description=excluded.description;
   ELSE
     INSERT INTO cost_centers(id,tenant_id,code,name,is_active) VALUES(result,t,c,n,active)
     ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,is_active=excluded.is_active;
   END IF;
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END,tbl,result);
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Já existe um cadastro com este código. Informe outro código.';
END $$;

CREATE FUNCTION public.delete_financial_catalog(p_kind text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); tbl text; old jsonb;
BEGIN
 tbl:=CASE p_kind WHEN 'payment_method' THEN 'payment_methods' WHEN 'account' THEN 'chart_of_accounts' WHEN 'cost_center' THEN 'cost_centers' END;
 IF tbl IS NULL THEN RAISE EXCEPTION 'Cadastro financeiro inválido.'; END IF;
 EXECUTE format('SELECT to_jsonb(x) FROM %I x WHERE id=$1 AND tenant_id=$2 FOR UPDATE',tbl) INTO old USING p_id,t;
 IF old IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
 IF coalesce((old->>'is_system')::boolean,false) THEN RAISE EXCEPTION 'Este cadastro é mantido pelo sistema.'; END IF;
 EXECUTE format('DELETE FROM %I WHERE id=$1 AND tenant_id=$2',tbl) USING p_id,t;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'delete_unused',tbl,p_id);
EXCEPTION WHEN foreign_key_violation THEN RAISE EXCEPTION 'Cadastro já utilizado. Desative para deixar de usá-lo em novos lançamentos e preservar o histórico.';
END $$;

-- New quotes previously had no deletion action. Only unused drafts/rejections may go.
ALTER FUNCTION public.delete_unused_record(text,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.delete_unused_record(text,uuid) RENAME TO delete_unused_before_quote;
REVOKE ALL ON FUNCTION erp_private.delete_unused_before_quote(text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.delete_unused_record(p_kind text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(p_kind IN('purchase','payable','receivable')); q sales_quotes;
BEGIN
 IF p_kind<>'quote' THEN PERFORM erp_private.delete_unused_before_quote(p_kind,p_id); RETURN; END IF;
 SELECT * INTO q FROM sales_quotes WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
 IF q.status NOT IN('draft','rejected') OR q.order_id IS NOT NULL OR EXISTS(SELECT 1 FROM production_orders WHERE source_quote_id=p_id)
   OR EXISTS(SELECT 1 FROM orders WHERE source_quote_id=p_id)
 THEN RAISE EXCEPTION 'Exclua apenas rascunhos ou orçamentos rejeitados sem venda ou produção vinculada.'; END IF;
 DELETE FROM sales_quote_items WHERE quote_id=p_id AND tenant_id=t;
 DELETE FROM sales_quotes WHERE id=p_id AND tenant_id=t;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'delete_unused','sales_quotes',p_id);
EXCEPTION WHEN foreign_key_violation THEN RAISE EXCEPTION 'Este orçamento tem vínculos. Preserve o histórico da operação.';
END $$;

-- Replenishing inventory must not require an artificial customer or receivable.
ALTER TABLE production_orders DROP CONSTRAINT production_orders_check;
CREATE FUNCTION public.request_stock_production(p_items jsonb,p_due_date date,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; prior uuid; x jsonb; p products; qty numeric; line integer:=0;
BEGIN
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Inclua de 1 a 100 produtos.'; END IF;
 prior:=erp_private.begin_request(t,p_request_id,'request_stock_production',jsonb_build_array(p_items,p_due_date,p_notes));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 result:=gen_random_uuid();
 INSERT INTO production_orders(id,tenant_id,code,due_date,notes,created_by) VALUES(result,t,erp_private.next_code(t,'OP'),p_due_date,nullif(btrim(p_notes),''),auth.uid());
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   SELECT * INTO p FROM products WHERE id=(x->>'product_id')::uuid AND tenant_id=t AND is_active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um produto ativo da sua empresa.'; END IF;
   IF p.category='service' THEN RAISE EXCEPTION 'Serviços não podem ser produzidos para estoque.'; END IF;
   qty:=(x->>'quantity')::numeric;
   IF qty IS NULL OR qty<1 OR qty>100000 OR trunc(qty)<>qty THEN RAISE EXCEPTION 'Informe uma quantidade inteira de 1 a 100.000.'; END IF;
   line:=line+1;
   INSERT INTO production_order_items(tenant_id,production_order_id,product_id,description,quantity,commercial_snapshot,material_overrides,line_index)
   VALUES(t,result,p.id,p.name,qty,'{}',coalesce(x->'material_overrides','[]'),line);
 END LOOP;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'create','production_orders',result,'{"origin":"stock","financial_created":false}');
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_financial_catalog(text,uuid,jsonb,uuid),public.delete_financial_catalog(text,uuid),public.delete_unused_record(text,uuid),public.request_stock_production(jsonb,date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_financial_catalog(text,uuid,jsonb,uuid),public.delete_financial_catalog(text,uuid),public.delete_unused_record(text,uuid),public.request_stock_production(jsonb,date,text,uuid) TO authenticated;

-- Completing a stock OP also receives its finished goods atomically and exactly once.
ALTER TABLE production_order_items ADD COLUMN received_quantity integer NOT NULL DEFAULT 0 CHECK(received_quantity>=0);
ALTER FUNCTION public.transition_production_order(uuid,text) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.transition_production_order(uuid,text) RENAME TO transition_production_before_stock;
REVOKE ALL ON FUNCTION erp_private.transition_production_before_stock(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.transition_production_order(p_id uuid,p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); op production_orders; item production_order_items; p products; qty integer; cost numeric; stock uuid; result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO op FROM production_orders WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada.'; END IF;
 result:=erp_private.transition_production_before_stock(p_id,p_status);
 IF p_status<>'completed' OR op.status='completed' OR op.source_quote_id IS NOT NULL OR op.source_order_id IS NOT NULL THEN RETURN result; END IF;
 FOR item IN SELECT * FROM production_order_items WHERE production_order_id=op.id AND tenant_id=t ORDER BY product_id,id FOR UPDATE LOOP
   SELECT * INTO p FROM products WHERE id=item.product_id AND tenant_id=t FOR UPDATE;
   IF item.assembly_required THEN
     qty:=item.assembled_quantity;
     SELECT sum(component_cost+finishing_cost) INTO cost FROM product_assemblies WHERE item_id=item.id AND tenant_id=t;
   ELSE
     -- Multi-plate components must be assembled before entering finished stock.
     IF jsonb_array_length(coalesce(item.production_snapshot->'plates','[]'))>1 THEN RAISE EXCEPTION 'Produto com várias placas: configure o controle de componentes e montagem antes de produzir para estoque.'; END IF;
     IF EXISTS(SELECT 1 FROM jobs WHERE production_order_item_id=item.id AND status IN('ready','shipped','completed') AND (produced_quantity IS NULL OR produced_quantity<1)) THEN RAISE EXCEPTION 'Confira a quantidade aprovada na qualidade antes de receber o produto pronto.'; END IF;
     SELECT sum(produced_quantity) INTO qty FROM jobs WHERE production_order_item_id=item.id AND status IN('ready','shipped','completed');
     IF EXISTS(SELECT 1 FROM jobs WHERE production_order_item_id=item.id AND actual_total_cost IS NULL) THEN RAISE EXCEPTION 'Apure os custos das impressões antes de receber o produto pronto.'; END IF;
     SELECT sum(actual_total_cost) INTO cost FROM jobs WHERE production_order_item_id=item.id;
   END IF;
   IF qty IS NULL OR qty<item.quantity OR cost IS NULL OR NOT erp_private.valid_number(cost) THEN RAISE EXCEPTION 'A quantidade aprovada ou o custo de % está pendente.',item.description; END IF;
   stock:=p.stock_item_id;
   IF stock IS NULL THEN
     INSERT INTO inventory_items(tenant_id,name,sku,unit,category,avg_cost,loss_coefficient) VALUES(t,p.name,p.sku,'un','part',0,0) RETURNING id INTO stock;
     UPDATE products SET stock_item_id=stock WHERE id=p.id;
   END IF;
   PERFORM 1 FROM inventory_items WHERE id=stock AND tenant_id=t AND is_active AND lower(btrim(unit))='un' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'O estoque de % precisa estar ativo em unidades (un).',item.description; END IF;
   INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
   VALUES(t,stock,'purchase_in',qty,cost/qty,'production_order_item',item.id,'Produto pronto recebido da '||op.code,auth.uid());
   UPDATE production_order_items SET received_quantity=qty WHERE id=item.id;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.transition_production_order(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_production_order(uuid,text) TO authenticated;

ALTER FUNCTION public.production_order_preflight(uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.production_order_preflight(uuid) RENAME TO production_preflight_before_stock;
REVOKE ALL ON FUNCTION erp_private.production_preflight_before_stock(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.production_order_preflight(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result jsonb; lines jsonb:='[]'; line jsonb;
BEGIN
 result:=erp_private.production_preflight_before_stock(p_id);
 IF NOT EXISTS(SELECT 1 FROM production_orders WHERE id=p_id AND tenant_id=t AND source_order_id IS NULL AND source_quote_id IS NULL) THEN RETURN result; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(result->'items') LOOP
   IF jsonb_array_length(coalesce(line->'snapshot'->'plates','[]'))>1 AND NOT EXISTS(SELECT 1 FROM products WHERE id=(line->>'product_id')::uuid AND tenant_id=t AND assembly_enabled) THEN
     line:=jsonb_set(line,'{issues}',coalesce(line->'issues','[]')||jsonb_build_array('Ative Componentes e montagem no produto para conferir as peças das diferentes placas antes de entrar no estoque pronto.'));
   END IF;
   lines:=lines||jsonb_build_array(line);
 END LOOP;
 RETURN result||jsonb_build_object('items',lines,'ready',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lines) x WHERE jsonb_array_length(x->'issues')>0));
END $$;
REVOKE ALL ON FUNCTION public.production_order_preflight(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_order_preflight(uuid) TO authenticated;

-- Inventory production is capitalized. Count its cost when goods are sold, not
-- once at printing and again through order_stock_allocations. Assembly for a
-- customer carries only the components actually used, plus finishing costs.
CREATE FUNCTION public.production_financial_result(p_start date,p_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); result jsonb;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Entre novamente para consultar o resultado.'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start THEN RAISE EXCEPTION 'Informe um período válido.'; END IF;
 SELECT jsonb_build_object(
   'jobs',coalesce((SELECT jsonb_agg(to_jsonb(j)) FROM jobs j LEFT JOIN production_orders o ON o.id=j.production_order_id AND o.tenant_id=t
     LEFT JOIN production_order_items i ON i.id=j.production_order_item_id AND i.tenant_id=t
     WHERE j.tenant_id=t
       AND (j.status IN('completed','shipped','failed') OR (j.status='ready' AND o.status='completed'))
       AND CASE WHEN j.status='ready' THEN o.completed_at::date ELSE coalesce(j.completed_at::date,CASE WHEN j.status='failed' THEN j.updated_at::date END,j.created_at::date) END BETWEEN p_start AND p_end
       AND (j.component_stock_key IS NULL OR (j.status='failed' AND NOT EXISTS(SELECT 1 FROM component_stock_lots l WHERE l.source_job_id=j.id AND l.tenant_id=t)))
       AND NOT (o.id IS NOT NULL AND o.source_quote_id IS NULL AND o.source_order_id IS NULL AND NOT coalesce(i.assembly_required,false))
   ),'[]'),
   'assembly_cost',coalesce((SELECT sum(a.component_cost+a.finishing_cost) FROM product_assemblies a
     JOIN production_order_items i ON i.id=a.item_id AND i.tenant_id=t
     JOIN production_orders o ON o.id=i.production_order_id AND o.tenant_id=t
     WHERE a.tenant_id=t AND o.status='completed' AND (o.source_order_id IS NOT NULL OR o.source_quote_id IS NOT NULL) AND o.completed_at::date BETWEEN p_start AND p_end),0),
   'component_loss_cost',coalesce((SELECT sum(total_cost) FROM component_stock_losses WHERE tenant_id=t AND created_at::date BETWEEN p_start AND p_end),0)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.production_financial_result(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_financial_result(date,date) TO authenticated;
