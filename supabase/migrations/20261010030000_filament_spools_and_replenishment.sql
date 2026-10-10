-- Physical spools describe the existing inventory; weighing/moving never posts stock twice.
CREATE TABLE public.filament_spools (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 item_id uuid NOT NULL REFERENCES inventory_items(id), label text NOT NULL,
 tare_grams numeric(14,3) NOT NULL CHECK(tare_grams>=0 AND tare_grams::text NOT IN('NaN','Infinity','-Infinity')),
 initial_net_grams numeric(14,3) NOT NULL CHECK(initial_net_grams>0 AND initial_net_grams::text NOT IN('NaN','Infinity','-Infinity')),
 estimated_remaining_grams numeric(14,3) NOT NULL CHECK(estimated_remaining_grams>=0 AND estimated_remaining_grams::text NOT IN('NaN','Infinity','-Infinity')),
 measured_gross_grams numeric(14,3), measured_at timestamptz,
 weight_source text NOT NULL CHECK(weight_source IN('manual_estimate','manual_weighing')),
 location_kind text NOT NULL DEFAULT 'storage' CHECK(location_kind IN('storage','printer','ams')),
 location_label text NOT NULL DEFAULT 'Depósito', printer_id uuid REFERENCES printers(id), ams_unit integer, ams_slot integer,
 needs_weighing boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES auth.users(id),
 CHECK(estimated_remaining_grams<=initial_net_grams),
 CHECK(measured_gross_grams IS NULL OR (measured_gross_grams>=tare_grams AND measured_gross_grams-tare_grams<=initial_net_grams AND measured_gross_grams::text NOT IN('NaN','Infinity','-Infinity'))),
 CHECK((location_kind='storage' AND printer_id IS NULL AND ams_unit IS NULL AND ams_slot IS NULL)
 OR (location_kind='printer' AND printer_id IS NOT NULL AND ams_unit IS NULL AND ams_slot IS NULL)
 OR (location_kind='ams' AND printer_id IS NOT NULL AND ams_unit IS NOT NULL AND ams_slot IS NOT NULL AND ams_unit BETWEEN 1 AND 16 AND ams_slot BETWEEN 1 AND 4))
);
CREATE UNIQUE INDEX filament_spool_label ON filament_spools(tenant_id,lower(label)) WHERE is_active;
CREATE UNIQUE INDEX filament_spool_ams_position ON filament_spools(tenant_id,printer_id,ams_unit,ams_slot) WHERE is_active AND location_kind='ams';
CREATE TABLE public.filament_spool_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),spool_id uuid NOT NULL REFERENCES filament_spools(id),
 event_type text NOT NULL CHECK(event_type IN('registered','weighed','estimated','relocated','archived','consumption_pending')),
 before_data jsonb,after_data jsonb NOT NULL,reason text NOT NULL,request_id uuid,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES auth.users(id)
);
CREATE TABLE public.filament_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),job_id uuid NOT NULL REFERENCES jobs(id),
 item_id uuid NOT NULL REFERENCES inventory_items(id),spool_id uuid REFERENCES filament_spools(id),grams numeric(14,3) NOT NULL CHECK(grams>0 AND grams::text NOT IN('NaN','Infinity','-Infinity')),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','released','consumed')),reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),released_at timestamptz,created_by uuid REFERENCES auth.users(id),
 UNIQUE(tenant_id,job_id,item_id)
);
CREATE TABLE public.filament_replenishment_policies (
 item_id uuid PRIMARY KEY REFERENCES inventory_items(id),tenant_id uuid NOT NULL REFERENCES tenants(id),vendor_id uuid REFERENCES vendors(id),
 multiple_kg numeric(12,3) NOT NULL DEFAULT 1 CHECK(multiple_kg>0 AND multiple_kg::text NOT IN('NaN','Infinity','-Infinity')),
 lead_days integer NOT NULL DEFAULT 7 CHECK(lead_days BETWEEN 0 AND 365),buffer_grams numeric(14,3) NOT NULL DEFAULT 0 CHECK(buffer_grams>=0 AND buffer_grams::text NOT IN('NaN','Infinity','-Infinity')),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES auth.users(id)
);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['filament_spools','filament_spool_events','filament_reservations','filament_replenishment_policies'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',n);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',n);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id())',n);
  EXECUTE format('CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_immutable_tenant()',n);
  EXECUTE format('CREATE TRIGGER erp_tenant_references BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_check_tenant_references()',n);
 END LOOP;
END $$;
CREATE VIEW public.filament_active_reservations WITH(security_invoker=true) AS
 SELECT r.* FROM filament_reservations r JOIN jobs j ON j.id=r.job_id AND j.tenant_id=r.tenant_id
 LEFT JOIN orders o ON o.id=j.order_id LEFT JOIN production_orders p ON p.id=j.production_order_id
 WHERE r.status='reserved' AND r.released_at IS NULL AND j.inventory_posted_at IS NULL
 AND j.status IN('draft','queued','printing','paused','reprint') AND coalesce(o.status::text,'')<>'cancelled' AND coalesce(p.status,'')<>'cancelled';
REVOKE ALL ON filament_active_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON filament_active_reservations TO authenticated;

CREATE FUNCTION public.save_filament_spool(p_spool_id uuid,p_data jsonb,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; s filament_spools; observed filament_spools; old_data jsonb; item inventory_items; kind text; source text; initial numeric; tare numeric; remaining numeric; gross numeric; machine uuid; result uuid; event text;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'filament_spool',jsonb_build_array(p_spool_id,p_data,p_reason));IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe os dados e o motivo da bobina.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN('item_id','label','tare_grams','initial_net_grams','estimated_remaining_grams','measured_gross_grams','weight_source','location_kind','location_label','printer_id','ams_unit','ams_slot','is_active')) THEN RAISE EXCEPTION 'Campo da bobina não permitido.'; END IF;
 machine:=nullif(p_data->>'printer_id','')::uuid;PERFORM erp_private.assert_ref('printers',machine,t);
 -- Production locks printer -> inventory -> reservation -> spool. Read the
 -- previous position without a lock, then lock both printers in UUID order
 -- before acquiring any material/spool row; recheck after waiting below.
 IF p_spool_id IS NOT NULL THEN
  SELECT * INTO observed FROM filament_spools WHERE id=p_spool_id AND tenant_id=t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bobina não encontrada.'; END IF;
 END IF;
 PERFORM 1 FROM printers WHERE tenant_id=t AND id IN(machine,observed.printer_id) ORDER BY id FOR UPDATE;
 IF machine IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers WHERE id=machine AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Selecione uma impressora ativa.'; END IF;
 SELECT * INTO item FROM inventory_items WHERE id=(p_data->>'item_id')::uuid AND tenant_id=t FOR UPDATE;
 IF item.id IS NULL OR NOT item.is_active OR item.category<>'filament' OR lower(btrim(item.unit)) NOT IN('g','kg') THEN RAISE EXCEPTION 'Selecione um filamento ativo com estoque em g ou kg.'; END IF;
 IF p_spool_id IS NOT NULL THEN
  SELECT * INTO s FROM filament_spools WHERE id=p_spool_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bobina não encontrada.'; END IF;
  IF s.printer_id IS DISTINCT FROM observed.printer_id OR s.item_id IS DISTINCT FROM observed.item_id OR s.updated_at IS DISTINCT FROM observed.updated_at THEN RAISE EXCEPTION 'A bobina foi alterada por outra operação. Atualize os dados e tente novamente.'; END IF;
  old_data:=to_jsonb(s);
  IF s.item_id<>item.id THEN RAISE EXCEPTION 'O material da bobina não pode mudar; arquive a bobina e cadastre outra.'; END IF;
 END IF;
 source:=p_data->>'weight_source';kind:=p_data->>'location_kind';initial:=(p_data->>'initial_net_grams')::numeric;tare:=(p_data->>'tare_grams')::numeric;
 IF source NOT IN('manual_estimate','manual_weighing') OR kind NOT IN('storage','printer','ams') OR source IS NULL OR kind IS NULL OR nullif(btrim(p_data->>'label'),'') IS NULL THEN RAISE EXCEPTION 'Informe identificação, origem do peso e posição.'; END IF;
 IF NOT erp_private.valid_number(initial,0.001) OR NOT erp_private.valid_number(tare) THEN RAISE EXCEPTION 'Peso inicial e tara inválidos.'; END IF;
 IF source='manual_weighing' THEN gross:=(p_data->>'measured_gross_grams')::numeric;remaining:=gross-tare;
 ELSE remaining:=(p_data->>'estimated_remaining_grams')::numeric; END IF;
 IF NOT erp_private.valid_number(remaining) OR remaining>initial OR (source='manual_weighing' AND NOT erp_private.valid_number(gross,tare)) THEN RAISE EXCEPTION 'Peso restante inválido: descontamos a tara do peso da balança.'; END IF;
 IF s.id IS NOT NULL AND coalesce((p_data->>'is_active')::boolean,true)=false AND EXISTS(SELECT 1 FROM filament_active_reservations WHERE spool_id=s.id) THEN RAISE EXCEPTION 'Libere as reservas antes de arquivar a bobina.'; END IF;
 IF s.id IS NOT NULL AND remaining<(SELECT coalesce(sum(grams),0) FROM filament_active_reservations WHERE spool_id=s.id) THEN RAISE EXCEPTION 'Peso informado menor que o reservado. Revise as reservas antes de registrar.'; END IF;
 result:=coalesce(s.id,gen_random_uuid());
 INSERT INTO filament_spools(id,tenant_id,item_id,label,tare_grams,initial_net_grams,estimated_remaining_grams,measured_gross_grams,measured_at,weight_source,location_kind,location_label,printer_id,ams_unit,ams_slot,is_active,created_by)
 VALUES(result,t,item.id,btrim(p_data->>'label'),tare,initial,remaining,CASE WHEN source='manual_weighing' THEN gross ELSE s.measured_gross_grams END,CASE WHEN source='manual_weighing' THEN now() ELSE s.measured_at END,source,kind,coalesce(nullif(btrim(p_data->>'location_label'),''),'Depósito'),machine,nullif(p_data->>'ams_unit','')::integer,nullif(p_data->>'ams_slot','')::integer,coalesce((p_data->>'is_active')::boolean,true),auth.uid())
 ON CONFLICT(id) DO UPDATE SET label=excluded.label,tare_grams=excluded.tare_grams,initial_net_grams=excluded.initial_net_grams,estimated_remaining_grams=excluded.estimated_remaining_grams,measured_gross_grams=excluded.measured_gross_grams,measured_at=excluded.measured_at,weight_source=excluded.weight_source,
 location_kind=excluded.location_kind,location_label=excluded.location_label,printer_id=excluded.printer_id,ams_unit=excluded.ams_unit,ams_slot=excluded.ams_slot,is_active=excluded.is_active,
 needs_weighing=CASE WHEN source='manual_weighing' THEN false ELSE filament_spools.needs_weighing END,updated_at=now();
 SELECT * INTO s FROM filament_spools WHERE id=result;
 event:=CASE WHEN old_data IS NULL THEN 'registered' WHEN NOT s.is_active THEN 'archived' WHEN source='manual_weighing' THEN 'weighed' ELSE 'estimated' END;
 INSERT INTO filament_spool_events(tenant_id,spool_id,event_type,before_data,after_data,reason,request_id,created_by) VALUES(t,result,event,old_data,to_jsonb(s),btrim(p_reason),p_request_id,auth.uid());
 PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;

CREATE FUNCTION public.move_filament_spool(p_spool_id uuid,p_location jsonb,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; s filament_spools; observed filament_spools; previous jsonb; machine uuid;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'filament_move',jsonb_build_array(p_spool_id,p_location,p_reason));IF result IS NOT NULL THEN RETURN result; END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR p_location IS NULL OR jsonb_typeof(p_location) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Informe posição e motivo.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_location) k WHERE k NOT IN('location_kind','location_label','printer_id','ams_unit','ams_slot')) THEN RAISE EXCEPTION 'Campo da posição não permitido.'; END IF;
 SELECT * INTO observed FROM filament_spools WHERE id=p_spool_id AND tenant_id=t;
 IF NOT FOUND OR NOT observed.is_active THEN RAISE EXCEPTION 'Bobina ativa não encontrada.'; END IF;
 machine:=nullif(p_location->>'printer_id','')::uuid;PERFORM erp_private.assert_ref('printers',machine,t);
 -- Match weighing and production: printer(s) -> inventory -> spool. The old
 -- printer also serializes relocation against its physical completion.
 PERFORM 1 FROM printers WHERE tenant_id=t AND id IN(machine,observed.printer_id) ORDER BY id FOR UPDATE;
 IF machine IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers WHERE id=machine AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Selecione uma impressora ativa.'; END IF;
 PERFORM 1 FROM inventory_items WHERE id=observed.item_id AND tenant_id=t FOR UPDATE;
 SELECT * INTO s FROM filament_spools WHERE id=p_spool_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR NOT s.is_active THEN RAISE EXCEPTION 'Bobina ativa não encontrada.'; END IF;
 IF s.printer_id IS DISTINCT FROM observed.printer_id OR s.item_id IS DISTINCT FROM observed.item_id OR s.updated_at IS DISTINCT FROM observed.updated_at THEN RAISE EXCEPTION 'A bobina foi alterada por outra operação. Atualize os dados e tente novamente.'; END IF;
 previous:=to_jsonb(s);
 UPDATE filament_spools SET location_kind=p_location->>'location_kind',location_label=coalesce(nullif(btrim(p_location->>'location_label'),''),'Depósito'),printer_id=machine,
 ams_unit=nullif(p_location->>'ams_unit','')::integer,ams_slot=nullif(p_location->>'ams_slot','')::integer,updated_at=now() WHERE id=s.id;
 INSERT INTO filament_spool_events(tenant_id,spool_id,event_type,before_data,after_data,reason,request_id,created_by) SELECT t,s.id,'relocated',previous,to_jsonb(f),btrim(p_reason),p_request_id,auth.uid() FROM filament_spools f WHERE f.id=s.id;
 PERFORM erp_private.finish_request(t,p_request_id,s.id);RETURN s.id;
END $$;

CREATE FUNCTION public.reserve_job_filament(p_job_id uuid,p_item_id uuid,p_spool_id uuid,p_grams numeric,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; j jobs; i inventory_items; s filament_spools; reserved numeric; total numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'filament_reserve',jsonb_build_array(p_job_id,p_item_id,p_spool_id,p_grams,p_reason));IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t FOR UPDATE;
 IF j.id IS NULL OR j.inventory_posted_at IS NOT NULL OR j.status NOT IN('draft','queued','printing','paused','reprint') THEN RAISE EXCEPTION 'Selecione uma impressão ainda sem consumo lançado.'; END IF;
 IF EXISTS(SELECT 1 FROM orders WHERE id=j.order_id AND status='cancelled') OR EXISTS(SELECT 1 FROM production_orders WHERE id=j.production_order_id AND status='cancelled') THEN RAISE EXCEPTION 'A demanda foi cancelada.'; END IF;
 IF p_item_id IS DISTINCT FROM j.material_id AND p_item_id IS DISTINCT FROM j.secondary_material_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(j.production_snapshot->'requirements','[]')) r WHERE r->>'item_id'=p_item_id::text AND coalesce(r->>'plate_id','')=coalesce(j.print_plate_id::text,'')) THEN RAISE EXCEPTION 'Este material não faz parte da impressão.'; END IF;
 SELECT * INTO i FROM inventory_items WHERE id=p_item_id AND tenant_id=t FOR UPDATE;
 IF i.id IS NULL OR NOT i.is_active OR i.category<>'filament' OR lower(btrim(i.unit)) NOT IN('g','kg') OR NOT erp_private.valid_number(p_grams,0.001) OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Filamento, gramas ou motivo inválidos.'; END IF;
 p_grams:=round(p_grams,3);
 SELECT coalesce(sum(grams),0) INTO reserved FROM filament_active_reservations WHERE item_id=i.id AND job_id<>j.id;
 total:=i.current_stock*CASE WHEN lower(btrim(i.unit))='kg' THEN 1000 ELSE 1 END;
 IF p_grams>total-reserved THEN RAISE EXCEPTION 'Filamento livre insuficiente após as reservas existentes.'; END IF;
 IF p_spool_id IS NOT NULL THEN
  SELECT * INTO s FROM filament_spools WHERE id=p_spool_id AND tenant_id=t AND item_id=i.id AND is_active FOR UPDATE;
  IF NOT FOUND OR s.needs_weighing THEN RAISE EXCEPTION 'Selecione uma bobina do material com saldo conferido após o último consumo.'; END IF;
  SELECT coalesce(sum(grams),0) INTO reserved FROM filament_active_reservations WHERE spool_id=s.id AND job_id<>j.id;
  IF p_grams>s.estimated_remaining_grams-reserved THEN RAISE EXCEPTION 'A bobina não possui gramas livres suficientes.'; END IF;
 END IF;
 INSERT INTO filament_reservations(tenant_id,job_id,item_id,spool_id,grams,reason,created_by) VALUES(t,j.id,i.id,p_spool_id,p_grams,btrim(p_reason),auth.uid())
 ON CONFLICT(tenant_id,job_id,item_id) DO UPDATE SET spool_id=excluded.spool_id,grams=excluded.grams,reason=excluded.reason,status='reserved',released_at=NULL,updated_at=now()
 RETURNING id INTO result;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'reserve','filament_reservations',result,jsonb_build_object('grams',p_grams,'request_id',p_request_id));
 PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;
CREATE FUNCTION public.release_job_filament(p_reservation_id uuid,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; r filament_reservations;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'filament_release',jsonb_build_array(p_reservation_id,p_reason));IF result IS NOT NULL THEN RETURN result; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da liberação.'; END IF;
 SELECT * INTO r FROM filament_reservations WHERE id=p_reservation_id AND tenant_id=t FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada.'; END IF;
 IF r.status='reserved' THEN UPDATE filament_reservations SET status='released',released_at=now(),reason=btrim(p_reason),updated_at=now() WHERE id=r.id; END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'release','filament_reservations',r.id,jsonb_build_object('reason',p_reason,'request_id',p_request_id));
 PERFORM erp_private.finish_request(t,p_request_id,r.id);RETURN r.id;
END $$;

CREATE FUNCTION public.save_filament_replenishment_policy(p_item_id uuid,p_vendor_id uuid,p_multiple_kg numeric,p_lead_days integer,p_buffer_grams numeric,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'filament_policy',jsonb_build_array(p_item_id,p_vendor_id,p_multiple_kg,p_lead_days,p_buffer_grams));IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=p_item_id AND tenant_id=t AND is_active AND category='filament' AND lower(btrim(unit)) IN('g','kg')) THEN RAISE EXCEPTION 'Selecione um filamento ativo em g ou kg.'; END IF;
 PERFORM erp_private.assert_ref('vendors',p_vendor_id,t);
 IF p_vendor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vendors WHERE id=p_vendor_id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Selecione um fornecedor ativo.'; END IF;
 IF NOT erp_private.valid_number(p_multiple_kg,0.001) OR NOT erp_private.valid_number(p_buffer_grams) OR p_lead_days IS NULL OR p_lead_days NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'Informe múltiplo, prazo e reserva de segurança válidos.'; END IF;
 INSERT INTO filament_replenishment_policies(item_id,tenant_id,vendor_id,multiple_kg,lead_days,buffer_grams,updated_by) VALUES(p_item_id,t,p_vendor_id,p_multiple_kg,p_lead_days,p_buffer_grams,auth.uid())
 ON CONFLICT(item_id) DO UPDATE SET vendor_id=excluded.vendor_id,multiple_kg=excluded.multiple_kg,lead_days=excluded.lead_days,buffer_grams=excluded.buffer_grams,updated_at=now(),updated_by=auth.uid();
 PERFORM erp_private.finish_request(t,p_request_id,p_item_id);RETURN p_item_id;
END $$;

-- Actual consumption is posted by the existing production transaction only.
-- Without a measured per-spool split we ask for weighing rather than invent it.
CREATE FUNCTION erp_private.finish_filament_reservations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r filament_reservations; s filament_spools;
BEGIN
 IF NEW.inventory_posted_at IS NOT NULL AND OLD.inventory_posted_at IS NULL THEN
  FOR r IN SELECT * FROM filament_reservations WHERE job_id=NEW.id AND tenant_id=NEW.tenant_id AND status='reserved' FOR UPDATE LOOP
   IF r.spool_id IS NOT NULL THEN
    SELECT * INTO s FROM filament_spools WHERE id=r.spool_id FOR UPDATE;
    UPDATE filament_spools SET needs_weighing=true,updated_at=now() WHERE id=s.id;
    INSERT INTO filament_spool_events(tenant_id,spool_id,event_type,before_data,after_data,reason,created_by) VALUES(NEW.tenant_id,s.id,'consumption_pending',to_jsonb(s),jsonb_build_object('job_id',NEW.id,'reserved_grams',r.grams),'Consumo lançado no estoque. Pese a bobina para conferir o saldo físico.',auth.uid());
   END IF;
   UPDATE filament_reservations SET status='consumed',released_at=now(),updated_at=now() WHERE id=r.id;
  END LOOP;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER finish_filament_reservations AFTER UPDATE OF inventory_posted_at ON jobs FOR EACH ROW EXECUTE FUNCTION erp_private.finish_filament_reservations();
REVOKE ALL ON FUNCTION erp_private.finish_filament_reservations() FROM PUBLIC,anon,authenticated;
-- The shared ledger also respects reservations held by other jobs. It remains
-- the only source of material debits; no extra spool-consumption movement exists.
CREATE FUNCTION erp_private.guard_reserved_filament() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i inventory_items; reserved numeric; outgoing numeric; balance numeric; own_jobs uuid[]:='{}';
BEGIN
 outgoing:=CASE WHEN NEW.movement_type IN('job_consumption','loss','maintenance') THEN NEW.quantity WHEN NEW.movement_type='adjustment' AND NEW.quantity<0 THEN -NEW.quantity ELSE 0 END;
 IF outgoing<=0 OR outgoing IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO i FROM inventory_items WHERE id=NEW.item_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 IF i.id IS NULL OR i.category<>'filament' OR lower(btrim(i.unit)) NOT IN('g','kg') THEN RETURN NEW; END IF;
 IF NEW.reference_type='job' AND NEW.reference_id IS NOT NULL THEN own_jobs:=ARRAY[NEW.reference_id];
 ELSIF NEW.reference_type='bambu_task' THEN
  -- The Bambu transaction validates and locks these allocations before its
  -- debit, but inserts bambu_production_allocations only after posting jobs.
  -- Its configured record is therefore the ownership source at this point.
  SELECT coalesce(array_agg(j.id),'{}'::uuid[]) INTO own_jobs
   FROM bambu_production_records rec JOIN bambu_tasks task ON task.id=rec.task_id AND task.tenant_id=rec.tenant_id
   CROSS JOIN LATERAL jsonb_array_elements(rec.allocations) allocation
   JOIN jobs j ON j.id::text=allocation->>'job_id' AND j.tenant_id=rec.tenant_id
   WHERE rec.task_id=NEW.reference_id AND rec.tenant_id=NEW.tenant_id AND rec.posted_at IS NULL AND task.status IN('2','3')
    AND j.product_id=rec.product_id AND j.print_plate_id IS NOT DISTINCT FROM rec.plate_id AND j.inventory_posted_at IS NULL;
 END IF;
 SELECT coalesce(sum(grams),0) INTO reserved FROM filament_active_reservations WHERE item_id=i.id AND tenant_id=i.tenant_id AND NOT(job_id=ANY(own_jobs));
 balance:=i.current_stock*CASE WHEN lower(btrim(i.unit))='kg' THEN 1000 ELSE 1 END;
 IF reserved>0 AND outgoing*(CASE WHEN lower(btrim(i.unit))='kg' THEN 1000 ELSE 1 END)>balance-reserved THEN RAISE EXCEPTION 'Movimentação consumiria filamento reservado para outra impressão. Revise as reservas antes de registrar.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_filament_reservation_guard BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION erp_private.guard_reserved_filament();
REVOKE ALL ON FUNCTION erp_private.guard_reserved_filament() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_filament_spool(uuid,jsonb,text,uuid),public.move_filament_spool(uuid,jsonb,text,uuid),public.reserve_job_filament(uuid,uuid,uuid,numeric,text,uuid),public.release_job_filament(uuid,text,uuid),public.save_filament_replenishment_policy(uuid,uuid,numeric,integer,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_filament_spool(uuid,jsonb,text,uuid),public.move_filament_spool(uuid,jsonb,text,uuid),public.reserve_job_filament(uuid,uuid,uuid,numeric,text,uuid),public.release_job_filament(uuid,text,uuid),public.save_filament_replenishment_policy(uuid,uuid,numeric,integer,numeric,uuid) TO authenticated;
