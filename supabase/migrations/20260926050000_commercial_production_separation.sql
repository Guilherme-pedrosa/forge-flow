-- Commercial approval does not require manufacturing preparation.
CREATE OR REPLACE FUNCTION public.transition_sales_quote(p_quote_id uuid,p_status text,p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); q sales_quotes; c customers;
BEGIN
 SELECT * INTO q FROM sales_quotes WHERE id=p_quote_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
 IF q.status=p_status THEN RETURN q.id; END IF;
 IF q.order_id IS NOT NULL THEN RAISE EXCEPTION 'O orçamento já foi convertido em venda.'; END IF;
 IF NOT ((q.status='draft' AND p_status='issued') OR (q.status='issued' AND p_status='approved') OR (q.status IN('draft','issued') AND p_status='rejected')) OR p_status IS NULL THEN RAISE EXCEPTION 'Transição do orçamento não permitida.'; END IF;
 IF p_status='rejected' THEN
   IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da rejeição.'; END IF;
 ELSE
   SELECT * INTO c FROM customers WHERE id=q.customer_id AND tenant_id=t AND is_active;
   IF c.id IS NULL OR q.total IS NULL OR q.total<=0 THEN RAISE EXCEPTION 'Informe cliente ativo e preços com total positivo.'; END IF;
   IF q.valid_until IS NOT NULL AND q.valid_until<erp_private.today(t) THEN RAISE EXCEPTION 'Revise a proposta para usar uma validade vigente.'; END IF;
   IF NOT EXISTS(SELECT 1 FROM sales_quote_items WHERE quote_id=q.id AND tenant_id=t) OR EXISTS(SELECT 1 FROM sales_quote_items WHERE quote_id=q.id AND (unit_price IS NULL OR total IS NULL)) THEN RAISE EXCEPTION 'Informe os itens e preços do orçamento.'; END IF;
 END IF;
 UPDATE sales_quotes SET status=p_status,revision=revision+1,issued_at=CASE WHEN p_status='issued' THEN now() ELSE issued_at END,
 customer_snapshot=CASE WHEN p_status='issued' THEN jsonb_build_object('id',c.id,'name',c.name,'document',c.document,'email',c.email,'phone',c.phone,'address',c.address) ELSE customer_snapshot END,
 approved_at=CASE WHEN p_status='approved' THEN now() ELSE approved_at END,rejected_at=CASE WHEN p_status='rejected' THEN now() ELSE rejected_at END,
 rejection_reason=CASE WHEN p_status='rejected' THEN btrim(p_reason) ELSE rejection_reason END,updated_at=now() WHERE id=q.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'transition','sales_quotes',q.id,jsonb_build_object('from',q.status,'to',p_status));
 RETURN q.id;
END $$;

-- Keep a missing cost unknown. Manual commercial costs are valid quote estimates.
CREATE FUNCTION erp_private.commercial_cost_snapshot(p_snapshot jsonb,p_product uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE manual numeric;
BEGIN
 SELECT manual_cost_override INTO manual FROM products WHERE id=p_product AND tenant_id=p_tenant;
 RETURN p_snapshot||jsonb_build_object('commercial_cost',manual);
END $$;
DO $$ DECLARE definition text; needle text; BEGIN
 definition:=pg_get_functiondef('public.save_sales_quote(uuid,jsonb,jsonb,uuid)'::regprocedure);
 needle:='estimate:=(snapshot->>''cost_per_unit'')::numeric;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review commercial cost capture.'; END IF;
 definition:=replace(definition,needle,'snapshot:=erp_private.commercial_cost_snapshot(snapshot,product.id,t); estimate:=coalesce((snapshot->>''commercial_cost'')::numeric,(snapshot->>''cost_per_unit'')::numeric);');
 definition:=replace(definition,'erp_private.quote_estimated_cost(snapshot,qty::integer),snapshot','CASE WHEN snapshot->>''commercial_cost'' IS NOT NULL THEN round(estimate*qty,2) ELSE erp_private.quote_estimated_cost(snapshot,qty::integer) END,snapshot');
 EXECUTE definition;
END $$;

CREATE TABLE public.production_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),code text NOT NULL,
 source_quote_id uuid UNIQUE REFERENCES sales_quotes(id),source_order_id uuid UNIQUE REFERENCES orders(id),
 customer_id uuid REFERENCES customers(id),customer_name text,due_date date,notes text,
 status text NOT NULL DEFAULT 'preparing' CHECK(status IN('preparing','released','completed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),released_at timestamptz,completed_at timestamptz,created_by uuid REFERENCES auth.users(id),
 UNIQUE(tenant_id,code),CHECK(source_quote_id IS NOT NULL OR source_order_id IS NOT NULL)
);
CREATE TABLE public.production_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),production_order_id uuid NOT NULL REFERENCES production_orders(id),
 source_quote_item_id uuid REFERENCES sales_quote_items(id),source_order_item_id uuid REFERENCES order_items(id),
 product_id uuid NOT NULL REFERENCES products(id),description text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),
 commercial_snapshot jsonb,production_snapshot jsonb,material_overrides jsonb NOT NULL DEFAULT '[]',line_index integer NOT NULL,
 UNIQUE(production_order_id,line_index)
);
ALTER TABLE jobs ADD COLUMN production_order_id uuid REFERENCES production_orders(id),ADD COLUMN production_order_item_id uuid REFERENCES production_order_items(id);
CREATE INDEX production_orders_tenant ON production_orders(tenant_id,created_at DESC);
CREATE INDEX production_order_items_parent ON production_order_items(production_order_id);
CREATE INDEX jobs_production_order ON jobs(production_order_id);
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON production_orders,production_order_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON production_orders,production_order_items TO authenticated;
CREATE POLICY production_orders_read ON production_orders FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE POLICY production_order_items_read ON production_order_items FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());

CREATE FUNCTION public.request_production_order(p_quote_id uuid,p_order_id uuid,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); q sales_quotes; o orders; result uuid; prior uuid;
BEGIN
 IF (p_quote_id IS NULL)=(p_order_id IS NULL) THEN RAISE EXCEPTION 'Selecione um orçamento ou uma venda.'; END IF;
 prior:=erp_private.begin_request(t,p_request_id,'request_production_order',jsonb_build_array(p_quote_id,p_order_id));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 IF p_order_id IS NOT NULL THEN
   SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
   IF o.id IS NULL OR o.status NOT IN('approved','in_production') THEN RAISE EXCEPTION 'Selecione uma venda aprovada.'; END IF;
   p_quote_id:=o.source_quote_id;
 END IF;
 IF p_quote_id IS NOT NULL THEN
   SELECT * INTO q FROM sales_quotes WHERE id=p_quote_id AND tenant_id=t FOR UPDATE;
   IF q.id IS NULL OR q.status<>'approved' THEN RAISE EXCEPTION 'Aprove o orçamento antes de gerar a ordem de produção.'; END IF;
   IF o.id IS NULL AND q.order_id IS NOT NULL THEN SELECT * INTO o FROM orders WHERE id=q.order_id AND tenant_id=t FOR UPDATE; END IF;
 END IF;
 SELECT id INTO result FROM production_orders WHERE tenant_id=t AND (source_quote_id=q.id OR source_order_id=o.id) FOR UPDATE;
 IF result IS NOT NULL THEN PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result; END IF;
 IF o.id IS NOT NULL AND o.status<>'approved' THEN RAISE EXCEPTION 'Venda indisponível para uma nova produção.'; END IF;
 IF o.id IS NOT NULL AND EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) THEN RAISE EXCEPTION 'Esta venda já possui impressões. Acompanhe a produção existente.'; END IF;
 result:=gen_random_uuid();
 INSERT INTO production_orders(id,tenant_id,code,source_quote_id,source_order_id,customer_id,customer_name,due_date,notes,created_by)
 VALUES(result,t,erp_private.next_code(t,'OP'),q.id,o.id,coalesce(q.customer_id,o.customer_id),
 coalesce(q.customer_snapshot->>'name',(SELECT name FROM customers WHERE id=o.customer_id)),coalesce(q.due_date,o.due_date),coalesce(q.notes,o.notes),auth.uid());
 IF q.id IS NOT NULL THEN
   INSERT INTO production_order_items(tenant_id,production_order_id,source_quote_item_id,source_order_item_id,product_id,description,quantity,commercial_snapshot,material_overrides,line_index)
   SELECT t,result,qi.id,oi.id,qi.product_id,qi.description,qi.quantity,qi.product_snapshot,qi.material_overrides,qi.line_index
   FROM sales_quote_items qi LEFT JOIN order_items oi ON oi.source_quote_item_id=qi.id AND oi.order_id=o.id WHERE qi.quote_id=q.id AND qi.tenant_id=t;
 ELSE
   IF EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id AND product_id IS NULL) THEN RAISE EXCEPTION 'Vincule os itens a produtos antes de solicitar produção.'; END IF;
   INSERT INTO production_order_items(tenant_id,production_order_id,source_order_item_id,product_id,description,quantity,commercial_snapshot,material_overrides,line_index)
   SELECT t,result,oi.id,oi.product_id,oi.description,oi.quantity,oi.product_snapshot,oi.material_overrides,row_number() OVER(ORDER BY oi.id) FROM order_items oi WHERE oi.order_id=o.id AND oi.tenant_id=t;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM production_order_items WHERE production_order_id=result) THEN RAISE EXCEPTION 'Inclua os produtos a produzir.'; END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'create','production_orders',result,jsonb_build_object('quote_id',q.id,'order_id',o.id,'financial_created',false));
 PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;

-- Preparation checks the technical version without altering the commercial quote.
CREATE FUNCTION public.production_order_preflight(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); op production_orders; item production_order_items; snapshot jsonb; lines jsonb:='[]'; issues jsonb; count_jobs integer; estimated numeric;
BEGIN
 SELECT * INTO op FROM production_orders WHERE id=p_id AND tenant_id=t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada.'; END IF;
 FOR item IN SELECT * FROM production_order_items WHERE production_order_id=p_id AND tenant_id=t ORDER BY line_index LOOP
   snapshot:=coalesce(item.production_snapshot,item.commercial_snapshot); issues:='[]'; count_jobs:=0; estimated:=NULL;
   BEGIN
     IF NOT EXISTS(SELECT 1 FROM products WHERE id=item.product_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Reative o produto antes de produzir.'; END IF;
     -- A complete proposal keeps its agreed material variant. Incomplete technical
     -- preparation can be completed later from the catalog, retaining chosen variants.
     IF NOT coalesce((snapshot->>'complete')::boolean,false) THEN snapshot:=erp_private.product_material_variant_snapshot(item.product_id,t,item.material_overrides); END IF;
     IF NOT coalesce((snapshot->>'complete')::boolean,false) THEN issues:=coalesce(snapshot->'missing','["Complete a composição do produto."]');
     ELSE
       PERFORM erp_private.assert_bom_production_time(snapshot);
       SELECT count(*),sum((plan->>'cost')::numeric) INTO count_jobs,estimated FROM erp_private.frozen_job_plan(snapshot,item.quantity) plan;
     END IF;
   EXCEPTION WHEN OTHERS THEN issues:=jsonb_build_array(SQLERRM);
   END;
   lines:=lines||jsonb_build_array(jsonb_build_object('id',item.id,'product_id',item.product_id,'description',item.description,'quantity',item.quantity,'snapshot',snapshot,'issues',issues,'jobs',count_jobs,'estimated_cost',estimated));
 END LOOP;
 RETURN jsonb_build_object('order_id',p_id,'items',lines,'ready',jsonb_array_length(lines)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lines) x WHERE jsonb_array_length(x->'issues')>0));
END $$;

CREATE FUNCTION public.refresh_production_preparation(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); op production_orders;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO op FROM production_orders WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR op.status<>'preparing' THEN RAISE EXCEPTION 'Somente ordens em preparação podem atualizar a composição.'; END IF;
 UPDATE production_order_items SET production_snapshot=erp_private.product_material_variant_snapshot(product_id,t,material_overrides) WHERE production_order_id=p_id AND tenant_id=t;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'refresh_preparation','production_orders',p_id);
 RETURN p_id;
END $$;

CREATE FUNCTION public.release_production_order(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); op production_orders; item production_order_items; review jsonb; line jsonb; plan jsonb; idx integer; line_revenue numeric; discount_ratio numeric:=1; cumulative_lines numeric:=0; allocated_lines numeric:=0; plans jsonb; allocated numeric; revenue numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO op FROM production_orders WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada.'; END IF;
 IF op.status IN('released','completed') THEN RETURN op.id; END IF;
 IF op.status<>'preparing' THEN RAISE EXCEPTION 'A ordem de produção está cancelada.'; END IF;
 IF op.source_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orders WHERE id=op.source_order_id AND tenant_id=t AND status='approved') THEN RAISE EXCEPTION 'A venda não está aprovada para produção.'; END IF;
 review:=public.production_order_preflight(op.id);
 IF NOT (review->>'ready')::boolean THEN
   SELECT value INTO line FROM jsonb_array_elements(review->'items') WHERE jsonb_array_length(value->'issues')>0 LIMIT 1;
   RAISE EXCEPTION 'Prepare %: %',line->>'description',line->'issues';
 END IF;
 IF EXISTS(SELECT 1 FROM jobs WHERE production_order_id=op.id) THEN RAISE EXCEPTION 'A ordem já possui impressões vinculadas.'; END IF;
 IF op.source_quote_id IS NOT NULL THEN SELECT CASE WHEN subtotal>0 THEN (subtotal-discount)/subtotal ELSE 0 END INTO discount_ratio FROM sales_quotes WHERE id=op.source_quote_id;
 ELSIF op.source_order_id IS NOT NULL THEN SELECT CASE WHEN sum(oi.total)>0 THEN (sum(oi.total)-o.discount)/sum(oi.total) ELSE 0 END INTO discount_ratio FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.id=op.source_order_id GROUP BY o.discount; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(review->'items') LOOP
   SELECT * INTO item FROM production_order_items WHERE id=(line->>'id')::uuid AND tenant_id=t FOR UPDATE;
   UPDATE production_order_items SET production_snapshot=line->'snapshot' WHERE id=item.id;
   SELECT jsonb_agg(value) INTO plans FROM erp_private.frozen_job_plan(line->'snapshot',item.quantity) value;
   cumulative_lines:=cumulative_lines+coalesce((SELECT total FROM sales_quote_items WHERE id=item.source_quote_item_id),(SELECT total FROM order_items WHERE id=item.source_order_item_id),0);
   line_revenue:=round(cumulative_lines*discount_ratio,2)-allocated_lines;allocated_lines:=allocated_lines+line_revenue;
   idx:=0;allocated:=0;
   FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
     idx:=idx+1;revenue:=round(line_revenue*idx/jsonb_array_length(plans),2)-allocated;allocated:=allocated+revenue;
     PERFORM erp_private.assert_ref('products',(plan->>'product_id')::uuid,t);
     INSERT INTO jobs(tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,secondary_material_id,printer_id,
       production_order_id,production_order_item_id,order_id,order_item_id,order_unit_index,est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,due_date,num_colors,created_by,production_snapshot,production_snapshot_origin)
     VALUES(t,erp_private.next_code(t,'OI'),plan->>'name',op.code||' · '||(plan->>'label'),'queued',(plan->>'product_id')::uuid,(plan->>'plate_id')::uuid,
       (plan->>'quantity')::integer,(plan->>'material_id')::uuid,(plan->>'secondary_material_id')::uuid,
       CASE WHEN EXISTS(SELECT 1 FROM printers WHERE id=(plan->>'printer_id')::uuid AND tenant_id=t AND is_active AND status NOT IN('maintenance','offline','error')) THEN (plan->>'printer_id')::uuid END,
       op.id,item.id,op.source_order_id,item.source_order_item_id,idx,(plan->>'grams')::numeric,(plan->>'minutes')::integer,round((plan->>'material_cost')::numeric,2),(plan->>'cost')::numeric,(plan->>'extras')::numeric,revenue,op.due_date,
       (plan->>'num_colors')::integer,auth.uid(),plan->'snapshot','production_order');
   END LOOP;
 END LOOP;
 UPDATE production_orders SET status='released',released_at=now() WHERE id=op.id;
 IF op.source_order_id IS NOT NULL THEN UPDATE orders SET status='in_production' WHERE id=op.source_order_id; END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'release','production_orders',op.id);
 RETURN op.id;
END $$;

ALTER FUNCTION public.transition_sales_order(uuid,text) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.transition_sales_order(uuid,text) RENAME TO transition_sales_order_before_commercial;
CREATE FUNCTION public.transition_sales_order(p_order_id uuid,p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); o orders; item order_items; result uuid; op uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
 IF o.status=p_status THEN RETURN o.id; END IF;
 IF NOT o.requires_material_recipe AND o.source_quote_id IS NULL AND p_status IN('approved','in_production') THEN
   IF p_status='approved' THEN RETURN erp_private.transition_sales_order_legacy(p_order_id,p_status); END IF;
   RETURN erp_private.transition_sales_order_before_commercial(p_order_id,p_status);
 END IF;
 IF p_status='approved' THEN
   IF o.source_quote_id IS NULL THEN
     FOR item IN SELECT * FROM order_items WHERE order_id=o.id AND tenant_id=t FOR UPDATE LOOP
       IF item.product_id IS NOT NULL THEN UPDATE order_items SET product_snapshot=erp_private.product_material_variant_snapshot(item.product_id,t,item.material_overrides) WHERE id=item.id; END IF;
     END LOOP;
   END IF;
   -- The original sales transition validates commercial totals and posts the title.
   RETURN erp_private.transition_sales_order_legacy(p_order_id,p_status);
 ELSIF p_status='in_production' THEN
   IF o.status<>'approved' THEN RAISE EXCEPTION 'Aprove a venda antes de produzir.'; END IF;
   op:=public.request_production_order(NULL,o.id,gen_random_uuid());
   PERFORM public.release_production_order(op); RETURN o.id;
 ELSE
   result:=erp_private.transition_sales_order_before_commercial(p_order_id,p_status);
   IF p_status='cancelled' THEN UPDATE production_orders SET status='cancelled' WHERE source_order_id=o.id AND status<>'completed'; END IF;
   RETURN result;
 END IF;
END $$;

-- When production was requested first, conversion links the existing work to the
-- sale. It never creates another batch or posts the receivable twice.
ALTER FUNCTION public.convert_sales_quote(uuid,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.convert_sales_quote(uuid,uuid) RENAME TO convert_sales_quote_before_production;
CREATE FUNCTION public.convert_sales_quote(p_quote_id uuid,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; op production_orders;
BEGIN
 result:=erp_private.convert_sales_quote_before_production(p_quote_id,p_request_id);
 SELECT * INTO op FROM production_orders WHERE source_quote_id=p_quote_id AND tenant_id=t FOR UPDATE;
 IF FOUND AND op.source_order_id IS NULL THEN
   IF op.status='cancelled' THEN RAISE EXCEPTION 'A produção vinculada está cancelada. Revise o documento antes de gerar a venda.'; END IF;
   UPDATE production_orders SET source_order_id=result WHERE id=op.id;
   UPDATE production_order_items pi SET source_order_item_id=oi.id FROM order_items oi WHERE pi.production_order_id=op.id AND oi.order_id=result AND oi.source_quote_item_id=pi.source_quote_item_id;
   UPDATE jobs j SET order_id=result,order_item_id=pi.source_order_item_id FROM production_order_items pi WHERE j.production_order_item_id=pi.id AND pi.production_order_id=op.id;
   IF op.status IN('released','completed') THEN UPDATE orders SET status='in_production' WHERE id=result; END IF;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.transition_production_order(p_id uuid,p_status text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); op production_orders;
BEGIN
 SELECT * INTO op FROM production_orders WHERE id=p_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de produção não encontrada.'; END IF;
 IF op.status=p_status THEN RETURN op.id; END IF;
 IF p_status='completed' AND op.status='released' THEN
   IF NOT EXISTS(SELECT 1 FROM jobs WHERE production_order_id=op.id) OR EXISTS(SELECT 1 FROM jobs j WHERE production_order_id=op.id AND status NOT IN('ready','shipped','completed') AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=j.id)) THEN RAISE EXCEPTION 'Conclua as impressões, o acabamento e a qualidade antes de finalizar.'; END IF;
   UPDATE production_orders SET status='completed',completed_at=now() WHERE id=op.id;
   IF op.source_order_id IS NOT NULL THEN PERFORM public.transition_sales_order(op.source_order_id,'ready'); END IF;
 ELSIF p_status='cancelled' AND op.status='preparing' THEN
   UPDATE production_orders SET status='cancelled' WHERE id=op.id;
 ELSIF p_status='preparing' AND op.status='cancelled' AND NOT EXISTS(SELECT 1 FROM jobs WHERE production_order_id=op.id) THEN
   IF op.source_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orders WHERE id=op.source_order_id AND tenant_id=t AND status='approved') THEN RAISE EXCEPTION 'A venda vinculada não está aprovada.'; END IF;
   UPDATE production_orders SET status='preparing' WHERE id=op.id;
 ELSE RAISE EXCEPTION 'Transição não permitida. Resolva as impressões já liberadas antes de encerrar.';
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'transition','production_orders',op.id,jsonb_build_object('from',op.status,'to',p_status));
 RETURN op.id;
END $$;

-- Reprints keep their parent OP relationship, including automatically imported jobs.
CREATE FUNCTION public.erp_job_production_order_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent jobs;
BEGIN
 IF TG_OP='INSERT' AND NEW.reprint_of IS NOT NULL THEN
   SELECT * INTO parent FROM jobs WHERE id=NEW.reprint_of AND tenant_id=NEW.tenant_id;
   NEW.production_order_id:=parent.production_order_id;NEW.production_order_item_id:=parent.production_order_item_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_job_production_order_link BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION erp_job_production_order_link();

CREATE FUNCTION public.erp_guard_production_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user IN('authenticated','anon','service_role') THEN
   IF (TG_OP='INSERT' AND (NEW.production_order_id IS NOT NULL OR NEW.production_order_item_id IS NOT NULL)) OR
      (TG_OP='UPDATE' AND (NEW.production_order_id,NEW.production_order_item_id) IS DISTINCT FROM (OLD.production_order_id,OLD.production_order_item_id)) OR
      (TG_OP='DELETE' AND OLD.production_order_id IS NOT NULL) THEN RAISE EXCEPTION 'Vínculos de produção são controlados pela ordem de produção.'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER erp_guard_production_links BEFORE INSERT OR UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_guard_production_links();

REVOKE ALL ON FUNCTION erp_private.commercial_cost_snapshot(jsonb,uuid,uuid),erp_private.transition_sales_order_before_commercial(uuid,text),erp_private.convert_sales_quote_before_production(uuid,uuid),public.erp_job_production_order_link() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.erp_guard_production_links() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_production_order(uuid,uuid,uuid),public.production_order_preflight(uuid),public.refresh_production_preparation(uuid),public.release_production_order(uuid),public.transition_production_order(uuid,text),public.transition_sales_order(uuid,text),public.convert_sales_quote(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_production_order(uuid,uuid,uuid),public.production_order_preflight(uuid),public.refresh_production_preparation(uuid),public.release_production_order(uuid),public.transition_production_order(uuid,text),public.transition_sales_order(uuid,text),public.convert_sales_quote(uuid,uuid) TO authenticated;
