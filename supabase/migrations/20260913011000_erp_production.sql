CREATE FUNCTION erp_private.consume_material(t uuid, material uuid, grams numeric, job uuid, failed boolean, reason text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item inventory_items; qty numeric; cost numeric;
BEGIN
  IF grams=0 THEN RETURN 0; END IF;
  SELECT * INTO item FROM inventory_items WHERE id=material AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione o material consumido.'; END IF;
  IF lower(btrim(item.unit))='g' THEN qty:=grams;
  ELSIF lower(btrim(item.unit))='kg' THEN qty:=grams/1000;
  ELSE RAISE EXCEPTION 'Material % deve usar g ou kg para consumo de impressão.',item.name; END IF;
  INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
    VALUES(t,material,CASE WHEN failed THEN 'loss'::movement_type ELSE 'job_consumption'::movement_type END,qty,'job',job,
      CASE WHEN failed THEN 'Falha de impressão: '||reason ELSE 'Consumo real medido da impressão (inclui purga e suporte)' END,auth.uid())
    RETURNING total_cost INTO cost;
  RETURN cost;
END $$;

CREATE FUNCTION public.transition_job(p_job_id uuid,p_status text,p_actual_grams numeric DEFAULT NULL,p_actual_time_minutes numeric DEFAULT NULL,
  p_waste_grams numeric DEFAULT NULL,p_failure_reason text DEFAULT NULL,p_printer_id uuid DEFAULT NULL,
  p_secondary_actual_grams numeric DEFAULT NULL,p_actual_labor_cost numeric DEFAULT NULL,p_actual_overhead numeric DEFAULT NULL,p_actual_extras_cost numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); j jobs; machine printers; settings jsonb; allowed text[]; result uuid;
  material_cost numeric:=0; machine_cost numeric:=0; energy_cost numeric:=0; labor_cost numeric:=0; overhead_cost numeric:=0;
  total_cost numeric; secondary numeric:=coalesce(p_secondary_actual_grams,0); rate numeric; depreciation numeric; finished boolean;
BEGIN
  -- Lock order before job to share lock order with order transitions/cancellation.
  PERFORM 1 FROM orders WHERE id=(SELECT order_id FROM jobs WHERE id=p_job_id AND tenant_id=t) FOR UPDATE;
  SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de impressão não encontrada.'; END IF;
  IF j.order_id IS NOT NULL AND EXISTS(SELECT 1 FROM orders WHERE id=j.order_id AND status='cancelled') THEN RAISE EXCEPTION 'O pedido foi cancelado. A ordem permanece como histórico.'; END IF;
  IF p_status=j.status::text THEN
    IF p_printer_id IS NOT NULL AND p_printer_id IS DISTINCT FROM j.printer_id THEN
      IF j.status NOT IN ('draft','queued','reprint') THEN RAISE EXCEPTION 'A impressora só pode mudar antes da produção.'; END IF;
      PERFORM erp_private.assert_ref('printers',p_printer_id,t);
      PERFORM 1 FROM printers WHERE id=p_printer_id AND tenant_id=t AND is_active FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Selecione uma impressora ativa.'; END IF;
      UPDATE jobs SET printer_id=p_printer_id WHERE id=j.id;
    END IF;
    RETURN j.id;
  END IF;
  allowed:=CASE j.status
    WHEN 'draft' THEN ARRAY['queued'] WHEN 'queued' THEN ARRAY['printing','draft']
    WHEN 'printing' THEN ARRAY['paused','failed','post_processing','quality_check','completed']
    WHEN 'paused' THEN ARRAY['printing','failed'] WHEN 'failed' THEN ARRAY['reprint']
    WHEN 'reprint' THEN ARRAY['queued'] WHEN 'post_processing' THEN ARRAY['quality_check','completed']
    WHEN 'quality_check' THEN ARRAY['ready','failed'] WHEN 'ready' THEN ARRAY['shipped','completed']
    WHEN 'shipped' THEN ARRAY['completed'] ELSE ARRAY[]::text[] END;
  IF p_status IS NULL OR NOT(p_status=ANY(allowed)) THEN RAISE EXCEPTION 'Transição de % para % não permitida.',j.status,p_status; END IF;
  IF p_status='reprint' THEN
    SELECT id INTO result FROM jobs WHERE reprint_of=j.id;
    IF result IS NOT NULL THEN RETURN result; END IF;
    result:=gen_random_uuid();
    INSERT INTO jobs(id,tenant_id,code,name,description,status,printer_id,material_id,secondary_material_id,product_id,order_id,order_item_id,order_unit_index,est_extras_cost,
      est_grams,est_time_minutes,est_material_cost,est_energy_cost,est_machine_cost,est_labor_cost,est_overhead,est_total_cost,sale_price,reprint_of,priority,due_date,num_colors,purge_waste_grams,created_by)
    VALUES(result,t,erp_private.next_code(t,'OI'),j.name,j.description,'reprint',j.printer_id,j.material_id,j.secondary_material_id,j.product_id,j.order_id,j.order_item_id,j.order_unit_index,j.est_extras_cost,
      j.est_grams,j.est_time_minutes,j.est_material_cost,j.est_energy_cost,j.est_machine_cost,j.est_labor_cost,j.est_overhead,j.est_total_cost,j.sale_price,j.id,j.priority,j.due_date,j.num_colors,j.purge_waste_grams,auth.uid());
    INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'reprint','jobs',result,jsonb_build_object('original_job_id',j.id));
    RETURN result;
  END IF;
  IF p_printer_id IS NOT NULL AND p_printer_id IS DISTINCT FROM j.printer_id THEN
    IF j.status NOT IN ('draft','queued','reprint') THEN RAISE EXCEPTION 'Não altere a impressora de uma produção iniciada.'; END IF;
    j.printer_id:=p_printer_id;
  END IF;
  SELECT * INTO machine FROM printers WHERE id=j.printer_id AND tenant_id=t FOR UPDATE;
  IF p_status='printing' THEN
    IF machine.id IS NULL OR NOT machine.is_active OR machine.status IN ('maintenance','offline','error') THEN RAISE EXCEPTION 'Selecione uma impressora ativa e disponível.'; END IF;
    IF EXISTS(SELECT 1 FROM jobs WHERE printer_id=machine.id AND id<>j.id AND status IN ('printing','paused')) THEN RAISE EXCEPTION 'A impressora já possui uma ordem em andamento.'; END IF;
    UPDATE printers SET status='printing' WHERE id=machine.id;
  ELSIF p_status='paused' AND machine.id IS NOT NULL THEN UPDATE printers SET status='paused' WHERE id=machine.id;
  END IF;
  IF p_status='failed' AND nullif(btrim(p_failure_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da falha.'; END IF;
  finished:=p_status IN ('failed','post_processing','quality_check','ready','completed');
  IF finished AND j.inventory_posted_at IS NULL THEN
    IF EXISTS(SELECT 1 FROM inventory_movements WHERE reference_type='job' AND reference_id=j.id) THEN
      RAISE EXCEPTION 'Ordem antiga com consumo já lançado. Confira os custos e o histórico antes de regularizar, para não duplicar a baixa.';
    END IF;
    IF NOT erp_private.valid_number(p_actual_grams) OR NOT erp_private.valid_number(p_actual_time_minutes,1) OR p_actual_time_minutes<>trunc(p_actual_time_minutes)
      OR NOT erp_private.valid_number(coalesce(p_waste_grams,0)) OR coalesce(p_waste_grams,0)>p_actual_grams OR NOT erp_private.valid_number(secondary) OR secondary>p_actual_grams THEN
      RAISE EXCEPTION 'Informe consumo real, minutos inteiros positivos e perdas dentro do consumo total.';
    END IF;
    IF machine.id IS NULL THEN RAISE EXCEPTION 'Identifique a impressora utilizada antes de apurar o custo.'; END IF;
    IF j.secondary_material_id IS NOT NULL AND j.secondary_material_id IS DISTINCT FROM j.material_id AND p_secondary_actual_grams IS NULL THEN RAISE EXCEPTION 'Informe o consumo real do segundo material.'; END IF;
    IF secondary>0 AND (j.secondary_material_id IS NULL OR j.secondary_material_id=j.material_id) THEN RAISE EXCEPTION 'Consumo secundário exige um segundo material distinto.'; END IF;
    PERFORM 1 FROM inventory_items WHERE id IN (j.material_id,j.secondary_material_id) AND tenant_id=t ORDER BY id FOR UPDATE;
    material_cost:=erp_private.consume_material(t,j.material_id,p_actual_grams-secondary,j.id,p_status='failed',p_failure_reason);
    material_cost:=material_cost+erp_private.consume_material(t,j.secondary_material_id,secondary,j.id,p_status='failed',p_failure_reason);
    SELECT tenants.settings INTO settings FROM tenants WHERE id=t;
    rate:=nullif(settings->>'energy_cost_kwh','')::numeric;
    IF NOT erp_private.valid_number(rate) THEN RAISE EXCEPTION 'Configure a tarifa de energia da empresa antes de concluir a produção.'; END IF;
    depreciation:=coalesce(machine.depreciation_per_hour,CASE WHEN machine.useful_life_hours>0 THEN machine.acquisition_cost/machine.useful_life_hours ELSE 0 END,0);
    machine_cost:=round((p_actual_time_minutes/60)*(depreciation+coalesce(machine.maintenance_cost_per_hour,0)),2);
    energy_cost:=round((p_actual_time_minutes/60)*(coalesce(machine.power_watts,0)/1000)*rate,2);
    labor_cost:=coalesce(p_actual_labor_cost,j.actual_labor_cost,0); overhead_cost:=coalesce(p_actual_overhead,j.actual_overhead,0);
    IF NOT erp_private.valid_number(labor_cost) OR NOT erp_private.valid_number(overhead_cost) OR NOT erp_private.valid_number(machine_cost) OR NOT erp_private.valid_number(energy_cost) OR NOT erp_private.valid_number(p_actual_extras_cost) THEN RAISE EXCEPTION 'Informe custos reais válidos, inclusive acessórios e embalagem (zero se não houver).'; END IF;
    total_cost:=material_cost+machine_cost+energy_cost+round(labor_cost,2)+round(overhead_cost,2)+round(p_actual_extras_cost,2);
    UPDATE jobs SET actual_grams=p_actual_grams,secondary_actual_grams=secondary,actual_time_minutes=p_actual_time_minutes,waste_grams=coalesce(p_waste_grams,0),
      actual_material_cost=material_cost,actual_machine_cost=machine_cost,actual_energy_cost=energy_cost,actual_labor_cost=labor_cost,actual_overhead=overhead_cost,actual_extras_cost=p_actual_extras_cost,actual_total_cost=total_cost,
      margin_percent=CASE WHEN sale_price>0 THEN round((sale_price-total_cost)/sale_price*100,2) ELSE NULL END,inventory_posted_at=now(),completed_at=now() WHERE id=j.id;
    UPDATE printers SET total_print_hours=coalesce(total_print_hours,0)+p_actual_time_minutes/60,total_prints=coalesce(total_prints,0)+1,
      total_failures=coalesce(total_failures,0)+CASE WHEN p_status='failed' THEN 1 ELSE 0 END,
      status=CASE WHEN status IN ('printing','paused') THEN 'idle'::printer_status ELSE status END WHERE id=machine.id;
  ELSIF p_status='failed' THEN
    UPDATE printers SET total_failures=coalesce(total_failures,0)+1 WHERE id=machine.id;
  END IF;
  UPDATE jobs SET status=p_status::job_status,printer_id=j.printer_id,started_at=CASE WHEN p_status='printing' THEN coalesce(started_at,now()) ELSE started_at END,
    failure_reason=CASE WHEN p_status='failed' THEN btrim(p_failure_reason) ELSE failure_reason END WHERE id=j.id;
  IF p_status IN ('ready','shipped','completed') AND j.order_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM jobs sibling WHERE sibling.order_id=j.order_id AND sibling.status NOT IN ('ready','shipped','completed')
      AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=sibling.id)) THEN
    UPDATE orders SET status='ready' WHERE id=j.order_id AND status IN ('approved','in_production');
  END IF;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'transition','jobs',j.id,jsonb_build_object('from',j.status,'to',p_status));
  RETURN j.id;
END $$;

CREATE FUNCTION public.erp_guard_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('authenticated','anon') THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.status NOT IN ('draft','queued') OR OLD.order_id IS NOT NULL OR OLD.started_at IS NOT NULL THEN RAISE EXCEPTION 'Produção iniciada ou vinculada a pedido não pode ser excluída.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' AND (NEW.status NOT IN ('draft','queued') OR NEW.order_id IS NOT NULL OR NEW.order_item_id IS NOT NULL OR NEW.reprint_of IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) e WHERE (e.key LIKE 'actual_%' OR e.key IN ('secondary_actual_grams','inventory_posted_at')) AND e.value<>'null'::jsonb)) THEN
    RAISE EXCEPTION 'Cadastre uma ordem em rascunho ou fila e utilize as operações de produção.';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.order_id,NEW.order_item_id,NEW.order_unit_index,NEW.reprint_of) IS DISTINCT FROM (OLD.order_id,OLD.order_item_id,OLD.order_unit_index,OLD.reprint_of)
      OR (to_jsonb(NEW)-ARRAY['name','description','priority','due_date','updated_at','est_grams','est_time_minutes','est_material_cost','est_energy_cost','est_machine_cost','est_labor_cost','est_overhead','est_total_cost','est_extras_cost','material_id','secondary_material_id','product_id','num_colors','purge_waste_grams','sale_price'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','description','priority','due_date','updated_at','est_grams','est_time_minutes','est_material_cost','est_energy_cost','est_machine_cost','est_labor_cost','est_overhead','est_total_cost','est_extras_cost','material_id','secondary_material_id','product_id','num_colors','purge_waste_grams','sale_price'])
      OR ((OLD.started_at IS NOT NULL OR OLD.order_id IS NOT NULL) AND (to_jsonb(NEW)-ARRAY['name','description','priority','due_date','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','description','priority','due_date','updated_at'])) THEN
      RAISE EXCEPTION 'Use a operação de produção. Custos reais e vínculos do histórico não podem ser sobrescritos.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_job_guard BEFORE INSERT OR UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_guard_job();

CREATE FUNCTION public.cancel_purchase_order(p_order_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); po purchase_orders;
BEGIN
  SELECT * INTO po FROM purchase_orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra não encontrada.'; END IF;
  IF po.status='cancelled' THEN RETURN po.id; END IF;
  IF po.status NOT IN ('pending','draft') OR EXISTS(SELECT 1 FROM inventory_movements WHERE reference_type='purchase_order' AND reference_id=po.id) THEN RAISE EXCEPTION 'Compra recebida exige devolução documentada, não cancelamento.'; END IF;
  PERFORM 1 FROM accounts_payable WHERE origin_type='purchase_order' AND origin_id=po.id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM accounts_payable WHERE origin_type='purchase_order' AND origin_id=po.id AND amount_paid>0) THEN RAISE EXCEPTION 'Compra com pagamento não pode ser cancelada.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.requests WHERE operation='purchase' AND result_id=po.id) THEN RAISE EXCEPTION 'Compra antiga sem vínculo financeiro rastreável. Confira o financeiro antes de regularizar.'; END IF;
  UPDATE accounts_payable SET status='cancelled' WHERE origin_type='purchase_order' AND origin_id=po.id;
  UPDATE purchase_orders SET status='cancelled' WHERE id=po.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'cancel','purchase_orders',po.id);
  RETURN po.id;
END $$;
REVOKE ALL ON FUNCTION erp_private.consume_material(uuid,uuid,numeric,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transition_job(uuid,text,numeric,numeric,numeric,text,uuid,numeric,numeric,numeric,numeric),public.cancel_purchase_order(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_job(uuid,text,numeric,numeric,numeric,text,uuid,numeric,numeric,numeric,numeric),public.cancel_purchase_order(uuid) TO authenticated;
