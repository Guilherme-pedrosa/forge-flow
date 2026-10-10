-- A commercial line keeps its agreed quantity. Finished stock and the residual
-- production quantity are separate, transactional sources of its fulfillment.
ALTER TABLE public.order_stock_allocations
  ADD COLUMN order_item_id uuid REFERENCES public.order_items(id),
  ADD COLUMN sales_amount numeric CHECK(sales_amount IS NULL OR sales_amount>=0);
ALTER TABLE public.order_stock_allocations DROP CONSTRAINT order_stock_allocations_order_id_product_id_key;
CREATE UNIQUE INDEX stock_allocation_legacy_product ON public.order_stock_allocations(order_id,product_id) WHERE order_item_id IS NULL;
CREATE UNIQUE INDEX stock_allocation_order_line ON public.order_stock_allocations(order_item_id) WHERE order_item_id IS NOT NULL;

-- Parts promised to released assemblies are not finished stock available to a
-- new sale. The aggregate inventory ledger remains the only stock authority.
CREATE FUNCTION erp_private.finished_stock_free(p_item uuid,p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT greatest(0,floor(coalesce((SELECT current_stock FROM inventory_items WHERE id=p_item AND tenant_id=p_tenant AND is_active AND lower(btrim(unit))='un'),0))
  -coalesce((SELECT sum(d.quantity-d.consumed) FROM production_subitem_demands d
    JOIN products p ON p.id=d.component_product_id AND p.tenant_id=p_tenant
    JOIN production_order_items pi ON pi.id=d.item_id AND pi.tenant_id=p_tenant
    JOIN production_orders po ON po.id=pi.production_order_id AND po.tenant_id=p_tenant
    WHERE d.tenant_id=p_tenant AND p.stock_item_id=p_item AND po.status='released'),0))::integer
$$;

-- Deterministic cent allocation across all commercial lines, including lines
-- supplied entirely from stock. Shipping belongs to the sale, not print revenue.
CREATE FUNCTION erp_private.order_item_net_amount(p_item uuid,p_tenant uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path=public AS $$
 WITH amounts AS (
  SELECT oi.id,oi.total,o.discount,sum(oi.total) OVER() subtotal,
    sum(oi.total) OVER(ORDER BY oi.id ROWS UNBOUNDED PRECEDING) cumulative
  FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.tenant_id=p_tenant
  WHERE oi.tenant_id=p_tenant AND oi.order_id=(SELECT order_id FROM order_items WHERE id=p_item AND tenant_id=p_tenant)
 ) SELECT CASE WHEN subtotal>0 THEN
  round(cumulative*(subtotal-discount)/subtotal,2)-round((cumulative-total)*(subtotal-discount)/subtotal,2)
  ELSE 0 END FROM amounts WHERE id=p_item
$$;

CREATE FUNCTION erp_private.allocate_sales_order_stock(p_order uuid,p_tenant uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE o orders; line order_items; p products; stock inventory_items; qty integer;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order AND tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR o.status<>'approved' THEN RAISE EXCEPTION 'Aprove a venda antes de separar estoque pronto.'; END IF;
 IF EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id AND tenant_id=p_tenant) THEN RAISE EXCEPTION 'Esta venda já possui produção vinculada.'; END IF;
 IF EXISTS(SELECT 1 FROM order_stock_allocations WHERE order_id=o.id AND reversed_at IS NULL) THEN RETURN; END IF;
 FOR line IN SELECT * FROM order_items WHERE order_id=o.id AND tenant_id=p_tenant ORDER BY id FOR UPDATE LOOP
  -- A made-to-order material/color choice cannot silently consume the base SKU.
  IF line.product_id IS NULL OR jsonb_array_length(coalesce(line.material_overrides,'[]'))>0 THEN CONTINUE; END IF;
  SELECT * INTO p FROM products WHERE id=line.product_id AND tenant_id=p_tenant AND is_active;
  IF p.stock_item_id IS NULL THEN CONTINUE; END IF;
  SELECT * INTO stock FROM inventory_items WHERE id=p.stock_item_id AND tenant_id=p_tenant AND is_active AND lower(btrim(unit))='un' FOR UPDATE;
  IF NOT FOUND THEN CONTINUE; END IF;
  qty:=least(line.quantity,erp_private.finished_stock_free(stock.id,p_tenant));
  IF qty<=0 THEN CONTINUE; END IF;
  INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
   VALUES(p_tenant,stock.id,'adjustment',-qty,'sales_order_stock',o.id,'Separação de estoque pronto · '||o.code||' · item '||line.id,auth.uid());
  INSERT INTO order_stock_allocations(tenant_id,order_id,order_item_id,product_id,item_id,quantity,unit_cost,total_cost,sales_amount)
   VALUES(p_tenant,o.id,line.id,p.id,stock.id,qty,stock.avg_cost,round(qty*stock.avg_cost,2),
    round(erp_private.order_item_net_amount(line.id,p_tenant)*qty/line.quantity,2));
 END LOOP;
END $$;

-- The existing request contract retains its identity, commercial snapshots and
-- quote handling. Only a new sale OP is reduced; historical/released OPs stay put.
ALTER FUNCTION public.request_production_order(uuid,uuid,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.request_production_order(uuid,uuid,uuid) RENAME TO request_production_before_partial_stock;
REVOKE ALL ON FUNCTION erp_private.request_production_before_partial_stock(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.request_production_order(p_quote_id uuid,p_order_id uuid,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; existing uuid; o orders; line production_order_items; remaining integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 IF p_order_id IS NOT NULL THEN
  SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  SELECT id INTO existing FROM production_orders WHERE tenant_id=t AND (source_order_id=p_order_id OR source_quote_id=o.source_quote_id) FOR UPDATE;
  IF o.id IS NOT NULL AND o.status='approved' AND existing IS NULL THEN PERFORM erp_private.allocate_sales_order_stock(o.id,t); END IF;
 END IF;
 result:=erp_private.request_production_before_partial_stock(p_quote_id,p_order_id,p_request_id);
 IF p_order_id IS NULL OR existing IS NOT NULL OR NOT EXISTS(SELECT 1 FROM order_stock_allocations WHERE order_id=p_order_id AND tenant_id=t AND order_item_id IS NOT NULL AND reversed_at IS NULL) THEN RETURN result; END IF;
 FOR line IN SELECT * FROM production_order_items WHERE production_order_id=result AND tenant_id=t ORDER BY line_index FOR UPDATE LOOP
  SELECT oi.quantity-coalesce((SELECT sum(a.quantity)::integer FROM order_stock_allocations a WHERE a.order_item_id=oi.id AND a.tenant_id=t AND a.reversed_at IS NULL),0)
   INTO remaining FROM order_items oi WHERE oi.id=line.source_order_item_id AND oi.order_id=p_order_id AND oi.tenant_id=t;
  IF remaining IS NULL OR remaining<0 THEN RAISE EXCEPTION 'Confira a origem e a quantidade de estoque do item comercial.'; END IF;
  IF remaining=0 THEN DELETE FROM production_order_items WHERE id=line.id;
  ELSE UPDATE production_order_items SET quantity=remaining WHERE id=line.id; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM production_order_items WHERE production_order_id=result) THEN RAISE EXCEPTION 'Todo o pedido cabe no estoque pronto. Use Atender com estoque.'; END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
  VALUES(t,auth.uid(),'partial_stock','production_orders',result,jsonb_build_object('order_id',p_order_id,'commercial_quantity_preserved',true));
 RETURN result;
END $$;

-- Full-stock fulfillment uses the same line allocations and the existing
-- approval/payment-schedule contract. It never marks a partial separation ready.
CREATE OR REPLACE FUNCTION public.fulfill_order_from_stock(p_order_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); o orders;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO o FROM orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
 IF o.status IN('ready','shipped','delivered') AND EXISTS(SELECT 1 FROM order_stock_allocations WHERE order_id=o.id AND reversed_at IS NULL) THEN RETURN o.id; END IF;
 IF o.status NOT IN('draft','approved') OR EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM production_orders WHERE source_order_id=o.id) THEN RAISE EXCEPTION 'Atenda com estoque um pedido em rascunho ou aprovado, sem produção iniciada.'; END IF;
 IF o.status='draft' THEN PERFORM public.transition_sales_order(o.id,'approved'); END IF;
 PERFORM erp_private.allocate_sales_order_stock(o.id,t);
 IF NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=o.id AND tenant_id=t) OR EXISTS(
  SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.tenant_id=t AND oi.quantity<>
   coalesce((SELECT sum(a.quantity) FROM order_stock_allocations a WHERE a.order_item_id=oi.id AND a.tenant_id=t AND a.reversed_at IS NULL),0)
 ) THEN RAISE EXCEPTION 'Estoque insuficiente para atender todo o pedido com o saldo livre. Confirme e organize para produzir somente o saldo faltante.'; END IF;
 UPDATE orders SET status='ready',approved_at=coalesce(approved_at,now()) WHERE id=o.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'fulfill_stock','orders',o.id,'{}');
 RETURN o.id;
END $$;

-- Both new full-stock and mixed orders retain per-line revenue allocation. The
-- stock portion must not be attributed again to residual print jobs.
DO $$ DECLARE definition text; needle text; BEGIN
 definition:=pg_get_functiondef('public.release_production_order(uuid)'::regprocedure);
 needle:='line_revenue:=round(cumulative_lines*discount_ratio,2)-allocated_lines;allocated_lines:=allocated_lines+line_revenue;';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review partial-stock print revenue contract.'; END IF;
 EXECUTE replace(definition,needle,$patch$
 IF op.source_order_id IS NOT NULL AND EXISTS(SELECT 1 FROM order_stock_allocations WHERE order_id=op.source_order_id AND order_item_id IS NOT NULL AND reversed_at IS NULL) THEN
  line_revenue:=erp_private.order_item_net_amount(item.source_order_item_id,t)-coalesce((SELECT sum(sales_amount) FROM order_stock_allocations WHERE order_item_id=item.source_order_item_id AND tenant_id=t AND reversed_at IS NULL),0);
 ELSE line_revenue:=round(cumulative_lines*discount_ratio,2)-allocated_lines; END IF;
 allocated_lines:=allocated_lines+line_revenue;
 $patch$);
 definition:=pg_get_functiondef('public.confirm_sales_workflow(uuid,jsonb,jsonb,uuid)'::regprocedure);
 needle:='i.current_stock<demand.quantity';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review finished-stock eligibility contract.'; END IF;
 EXECUTE replace(definition,needle,'erp_private.finished_stock_free(i.id,t)<demand.quantity');
END $$;

-- Quantity coverage uses the approved physical plan, not just a green job status.
-- Kits require every leaf and multi-plate leaves require every plate's quantity.
CREATE FUNCTION erp_private.finished_output_demands(p_snapshot jsonb,p_quantity integer,p_depth integer DEFAULT 0)
RETURNS TABLE(product_id uuid,plate_id uuid,quantity integer) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE part jsonb; plate jsonb;
BEGIN
 IF p_depth>20 OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Composição ou quantidade física inválida.'; END IF;
 IF jsonb_array_length(coalesce(p_snapshot->'components','[]'))>0 THEN
  FOR part IN SELECT value FROM jsonb_array_elements(p_snapshot->'components') LOOP
   RETURN QUERY SELECT * FROM erp_private.finished_output_demands(part->'snapshot',p_quantity*(part->>'quantity')::integer,p_depth+1);
  END LOOP;
 ELSIF jsonb_array_length(coalesce(p_snapshot->'plates','[]'))>0 THEN
  FOR plate IN SELECT value FROM jsonb_array_elements(p_snapshot->'plates') LOOP
   RETURN QUERY SELECT (p_snapshot->'product'->>'id')::uuid,(plate->>'id')::uuid,p_quantity;
  END LOOP;
 ELSE RETURN QUERY SELECT (p_snapshot->'product'->>'id')::uuid,NULL::uuid,p_quantity;
 END IF;
END $$;

CREATE FUNCTION public.erp_guard_partial_stock_ready() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE line order_items; pi production_order_items; stock_qty integer; production_qty integer; need record; good integer;
BEGIN
 IF NEW.status::text NOT IN('ready','shipped','delivered') OR NOT EXISTS(SELECT 1 FROM order_stock_allocations WHERE order_id=NEW.id AND tenant_id=NEW.tenant_id AND order_item_id IS NOT NULL AND reversed_at IS NULL) THEN RETURN NEW; END IF;
 FOR line IN SELECT * FROM order_items WHERE order_id=NEW.id AND tenant_id=NEW.tenant_id LOOP
  SELECT coalesce(sum(quantity),0)::integer INTO stock_qty FROM order_stock_allocations WHERE order_item_id=line.id AND tenant_id=NEW.tenant_id AND reversed_at IS NULL;
  SELECT coalesce(sum(i.quantity),0)::integer INTO production_qty FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id AND o.tenant_id=NEW.tenant_id
   WHERE i.source_order_item_id=line.id AND i.tenant_id=NEW.tenant_id AND o.status IN('released','completed');
  IF stock_qty+production_qty<>line.quantity THEN RAISE EXCEPTION 'Pedido ainda não atendido: confira estoque separado e produção faltante de %.',line.description; END IF;
  FOR pi IN SELECT i.* FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id AND o.tenant_id=NEW.tenant_id
   WHERE i.source_order_item_id=line.id AND i.tenant_id=NEW.tenant_id AND o.status IN('released','completed') LOOP
   IF pi.assembly_required THEN
    IF pi.assembled_quantity<pi.quantity THEN RAISE EXCEPTION 'Conclua a montagem da quantidade faltante de %.',line.description; END IF;
   ELSE
    FOR need IN SELECT d.product_id,d.plate_id,sum(d.quantity)::integer quantity FROM erp_private.finished_output_demands(pi.production_snapshot,pi.quantity) d GROUP BY d.product_id,d.plate_id LOOP
     SELECT coalesce(sum(j.produced_quantity),0)::integer INTO good FROM jobs j WHERE j.production_order_item_id=pi.id AND j.tenant_id=NEW.tenant_id
      AND j.product_id=need.product_id AND j.print_plate_id IS NOT DISTINCT FROM need.plate_id AND j.status IN('ready','shipped','completed');
     IF good<need.quantity THEN RAISE EXCEPTION 'Confira a quantidade aprovada na qualidade de %; o estoque parcial não conclui o saldo faltante.',line.description; END IF;
    END LOOP;
   END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_guard_partial_stock_ready BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.erp_guard_partial_stock_ready();

-- Existing cancellation reverses each allocation at its frozen cost and blocks
-- already-started work. Queued historical jobs must not start after cancellation.
CREATE FUNCTION public.erp_guard_cancelled_production_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status::text='printing' AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND (
  EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND tenant_id=NEW.tenant_id AND status='cancelled') OR
  EXISTS(SELECT 1 FROM production_orders WHERE id=NEW.production_order_id AND tenant_id=NEW.tenant_id AND status='cancelled')
 ) THEN RAISE EXCEPTION 'A impressão pertence a pedido ou OP cancelado e não pode iniciar.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_guard_cancelled_production_start BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.erp_guard_cancelled_production_start();

-- Manual regular-product QC needs an explicit physical count too. Cost/filament
-- were posted earlier; this operation never guesses or posts consumption again.
CREATE FUNCTION public.confirm_finished_output(p_job_id uuid,p_good_quantity integer,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; j jobs; pi production_order_items;
  maximum integer; required integer; approved integer; pending integer; shortage integer;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'finished_output',jsonb_build_array(p_job_id,p_good_quantity,p_reason));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM 1 FROM orders WHERE id=(SELECT order_id FROM jobs WHERE id=p_job_id AND tenant_id=t) FOR UPDATE;
 SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR j.status<>'quality_check' OR j.inventory_posted_at IS NULL OR j.actual_total_cost IS NULL
  OR NOT erp_private.valid_number(j.actual_total_cost) THEN RAISE EXCEPTION 'Confira a execução e seus custos antes de aprovar a quantidade produzida.'; END IF;
 IF j.component_stock_key IS NOT NULL OR jsonb_array_length(coalesce(j.production_snapshot->'physical_outputs','[]'))>0 THEN RAISE EXCEPTION 'Confira as saídas de componentes por peça na montagem, sem usar a aprovação de produto simples.'; END IF;
 maximum:=least(j.planned_quantity,coalesce(j.produced_quantity,j.planned_quantity));
 IF p_good_quantity IS NULL OR p_good_quantity NOT BETWEEN 1 AND maximum THEN RAISE EXCEPTION 'Informe quantidade boa inteira entre 1 e %. Para rejeitar tudo, registre a falha de qualidade.',maximum; END IF;
 IF length(coalesce(btrim(p_reason),''))>1000 OR (p_good_quantity<maximum AND nullif(btrim(p_reason),'') IS NULL) THEN RAISE EXCEPTION 'Informe o motivo das peças rejeitadas.'; END IF;
 UPDATE jobs SET produced_quantity=p_good_quantity WHERE id=j.id;
 shortage:=maximum-p_good_quantity;
 IF j.production_order_item_id IS NOT NULL THEN
  SELECT * INTO pi FROM production_order_items WHERE id=j.production_order_item_id AND tenant_id=t;
  IF NOT FOUND OR pi.assembly_required OR NOT EXISTS(SELECT 1 FROM production_orders WHERE id=pi.production_order_id AND tenant_id=t AND status='released') THEN RAISE EXCEPTION 'A impressão não pertence a uma produção simples liberada.'; END IF;
  SELECT coalesce(sum(d.quantity),0)::integer INTO required FROM erp_private.finished_output_demands(pi.production_snapshot,pi.quantity) d
   WHERE d.product_id=j.product_id AND d.plate_id IS NOT DISTINCT FROM j.print_plate_id;
  IF required<1 THEN RAISE EXCEPTION 'A saída não pertence à composição congelada desta produção.'; END IF;
  SELECT coalesce(sum(produced_quantity),0)::integer INTO approved FROM jobs WHERE production_order_item_id=pi.id AND tenant_id=t
   AND product_id=j.product_id AND print_plate_id IS NOT DISTINCT FROM j.print_plate_id AND status IN('ready','shipped','completed');
  SELECT coalesce(sum(least(planned_quantity,coalesce(produced_quantity,planned_quantity))),0)::integer INTO pending FROM jobs sibling WHERE production_order_item_id=pi.id AND tenant_id=t AND id<>j.id
   AND product_id=j.product_id AND print_plate_id IS NOT DISTINCT FROM j.print_plate_id AND status NOT IN('ready','shipped','completed','failed')
   AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=sibling.id);
  shortage:=least(shortage,greatest(0,required-approved-p_good_quantity-pending));
 END IF;
 IF shortage>0 AND NOT EXISTS(SELECT 1 FROM jobs WHERE reprint_of=j.id AND tenant_id=t) THEN
  -- A replacement remains a whole approved plate, with extras visible. It is
  -- planned only; an operator still queues/starts it. Revenue stays in the sale.
  INSERT INTO jobs(tenant_id,code,name,description,status,printer_id,material_id,secondary_material_id,product_id,
   order_id,order_item_id,order_unit_index,print_plate_id,planned_quantity,production_order_id,production_order_item_id,
   est_grams,est_time_minutes,est_material_cost,est_energy_cost,est_machine_cost,est_labor_cost,est_overhead,est_total_cost,est_extras_cost,
   sale_price,reprint_of,priority,due_date,num_colors,purge_waste_grams,production_snapshot,production_snapshot_origin,created_by)
  VALUES(t,erp_private.next_code(t,'OI'),j.name,'Reposição após QC: faltam '||shortage||' peça(s) · '||coalesce(j.description,j.code),'reprint',j.printer_id,j.material_id,j.secondary_material_id,j.product_id,
   j.order_id,j.order_item_id,j.order_unit_index,j.print_plate_id,j.planned_quantity,j.production_order_id,j.production_order_item_id,
   j.est_grams,j.est_time_minutes,j.est_material_cost,j.est_energy_cost,j.est_machine_cost,j.est_labor_cost,j.est_overhead,j.est_total_cost,j.est_extras_cost,
   0,j.id,j.priority,j.due_date,j.num_colors,j.purge_waste_grams,j.production_snapshot,j.production_snapshot_origin,auth.uid());
 END IF;
 PERFORM public.transition_job(j.id,'ready');
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
  VALUES(t,auth.uid(),'finished_quality','jobs',j.id,jsonb_build_object('good_quantity',p_good_quantity,'assessed_quantity',maximum,'replacement_shortage',shortage,'reason',nullif(btrim(p_reason),''),'source','operator_quality_count','request_id',p_request_id));
 PERFORM erp_private.finish_request(t,p_request_id,j.id); RETURN j.id;
END $$;

REVOKE ALL ON FUNCTION erp_private.finished_stock_free(uuid,uuid),erp_private.order_item_net_amount(uuid,uuid),erp_private.allocate_sales_order_stock(uuid,uuid),erp_private.finished_output_demands(jsonb,integer,integer),public.erp_guard_partial_stock_ready(),public.erp_guard_cancelled_production_start() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_production_order(uuid,uuid,uuid),public.fulfill_order_from_stock(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_production_order(uuid,uuid,uuid),public.fulfill_order_from_stock(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_finished_output(uuid,integer,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_finished_output(uuid,integer,text,uuid) TO authenticated;
