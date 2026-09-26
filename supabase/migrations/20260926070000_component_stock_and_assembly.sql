-- A plate yields component sets: one set contains the parts needed by one finished
-- product (e.g. both apple halves). Stock is separated by plate and material/color.
ALTER TABLE products ADD COLUMN assembly_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE production_order_items ADD COLUMN assembly_required boolean NOT NULL DEFAULT false,
 ADD COLUMN assembled_quantity integer NOT NULL DEFAULT 0 CHECK(assembled_quantity>=0 AND assembled_quantity<=quantity);
ALTER TABLE jobs ADD COLUMN component_stock_key text;

CREATE TABLE public.component_stock_lots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 product_id uuid NOT NULL REFERENCES products(id),plate_id uuid NOT NULL REFERENCES product_print_plates(id),
 material_key text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),remaining integer NOT NULL CHECK(remaining>=0 AND remaining<=quantity),
 unit_cost numeric NOT NULL CHECK(unit_cost>=0 AND unit_cost::text NOT IN('NaN','Infinity','-Infinity')),
 source_job_id uuid UNIQUE REFERENCES jobs(id),material_snapshot jsonb NOT NULL DEFAULT '{}',notes text,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX component_lots_balance ON component_stock_lots(tenant_id,plate_id,material_key) WHERE remaining>0;
CREATE TABLE public.production_component_demands(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 item_id uuid NOT NULL REFERENCES production_order_items(id),plate_id uuid NOT NULL REFERENCES product_print_plates(id),
 material_key text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),assembled integer NOT NULL DEFAULT 0 CHECK(assembled>=0 AND assembled<=quantity),
 created_at timestamptz NOT NULL DEFAULT now(),reservation_sequence bigint GENERATED ALWAYS AS IDENTITY,UNIQUE(item_id,plate_id)
);
CREATE TABLE public.product_assemblies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),product_id uuid NOT NULL REFERENCES products(id),
 item_id uuid REFERENCES production_order_items(id),quantity integer NOT NULL CHECK(quantity>0),
 component_cost numeric NOT NULL DEFAULT 0,finishing_cost numeric NOT NULL DEFAULT 0,notes text,
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES auth.users(id)
);
CREATE TABLE public.assembly_component_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 assembly_id uuid NOT NULL REFERENCES product_assemblies(id),lot_id uuid NOT NULL REFERENCES component_stock_lots(id),
 quantity integer NOT NULL CHECK(quantity>0),unit_cost numeric NOT NULL
);
CREATE TABLE public.component_stock_losses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),plate_id uuid NOT NULL REFERENCES product_print_plates(id),
 quantity integer NOT NULL CHECK(quantity>0),total_cost numeric NOT NULL,reason text NOT NULL,allocations jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES auth.users(id)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['component_stock_lots','production_component_demands','product_assemblies','assembly_component_allocations','component_stock_losses'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tbl);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id())',tbl);
 END LOOP;
END $$;

CREATE FUNCTION public.write_off_components(p_plate_id uuid,p_quantity integer,p_notes text,p_request_id uuid,p_item_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; pl product_print_plates; snapshot jsonb; key text; lot component_stock_lots;
 need integer; take integer; total numeric:=0; allocations jsonb:='[]';
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'component_loss',jsonb_build_array(p_plate_id,p_quantity,p_notes,p_item_id)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO pl FROM product_print_plates WHERE id=p_plate_id AND tenant_id=t;
 IF pl.id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 OR nullif(btrim(p_notes),'') IS NULL THEN RAISE EXCEPTION 'Informe componente, quantidade positiva e motivo da perda.'; END IF;
 IF p_item_id IS NULL THEN snapshot:=erp_private.product_bom_snapshot(pl.product_id,t);
 ELSE
  SELECT i.production_snapshot INTO snapshot FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id
   WHERE i.id=p_item_id AND i.tenant_id=t AND i.product_id=pl.product_id AND i.assembly_required AND o.status='released';
  IF snapshot IS NULL OR NOT EXISTS(SELECT 1 FROM production_component_demands WHERE item_id=p_item_id AND plate_id=pl.id AND tenant_id=t) THEN RAISE EXCEPTION 'Componente não pertence à montagem pendente.'; END IF;
 END IF;
 key:=erp_private.component_key(snapshot,pl.id);
 IF erp_private.component_available(t,pl.id,key,p_item_id)<p_quantity THEN RAISE EXCEPTION 'Quantidade de perda superior ao saldo disponível para esta operação.'; END IF;
 need:=p_quantity;
 FOR lot IN SELECT * FROM component_stock_lots WHERE tenant_id=t AND plate_id=pl.id AND material_key=key AND remaining>0 ORDER BY created_at,id FOR UPDATE LOOP
  take:=least(need,lot.remaining);UPDATE component_stock_lots SET remaining=remaining-take WHERE id=lot.id;
  total:=total+take*lot.unit_cost;allocations:=allocations||jsonb_build_array(jsonb_build_object('lot_id',lot.id,'quantity',take,'unit_cost',lot.unit_cost));
  need:=need-take;EXIT WHEN need=0;
 END LOOP;
 IF need<>0 THEN RAISE EXCEPTION 'Saldo alterado; confira os componentes.'; END IF;
 INSERT INTO component_stock_losses(tenant_id,plate_id,quantity,total_cost,reason,allocations,created_by) VALUES(t,pl.id,p_quantity,total,btrim(p_notes),allocations,auth.uid()) RETURNING id INTO result;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'component_loss','component_stock_losses',result,jsonb_build_object('quantity',p_quantity,'cost',total,'reason',p_notes,'item_id',p_item_id));
 PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.write_off_components(uuid,integer,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.write_off_components(uuid,integer,text,uuid,uuid) TO authenticated;

CREATE FUNCTION erp_private.component_key(p_snapshot jsonb,p_plate uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT p_plate::text||':'||md5(coalesce((SELECT jsonb_agg(jsonb_build_array(v->>'item_id',v->>'material_code',v->>'color_code') ORDER BY v->>'item_id')::text
 FROM jsonb_array_elements(coalesce(p_snapshot->'requirements','[]')) v WHERE v->>'plate_id'=p_plate::text),'[]'))
$$;

-- Demand is fulfilled in release order. Unreleased orders do not reserve stock.
CREATE FUNCTION erp_private.component_available(p_tenant uuid,p_plate uuid,p_key text,p_item uuid DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT greatest(0,coalesce((SELECT sum(remaining) FROM component_stock_lots WHERE tenant_id=p_tenant AND plate_id=p_plate AND material_key=p_key),0)-
 coalesce((SELECT sum(d.quantity-d.assembled) FROM production_component_demands d JOIN production_order_items i ON i.id=d.item_id JOIN production_orders o ON o.id=i.production_order_id
 WHERE d.tenant_id=p_tenant AND d.plate_id=p_plate AND d.material_key=p_key AND o.status='released'
 AND (p_item IS NULL OR d.reservation_sequence<(SELECT reservation_sequence FROM production_component_demands WHERE item_id=p_item AND plate_id=p_plate))),0))::integer
$$;

CREATE FUNCTION public.configure_product_assembly(p_product_id uuid,p_enabled boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); p products;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO p FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
 IF NOT FOUND OR p_enabled IS NULL THEN RAISE EXCEPTION 'Selecione um produto ativo.'; END IF;
 IF p.assembly_enabled=p_enabled THEN RETURN p.id; END IF;
 IF EXISTS(SELECT 1 FROM jobs WHERE product_id=p.id AND status NOT IN('ready','shipped','completed','failed'))
 OR EXISTS(SELECT 1 FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id WHERE i.product_id=p.id AND o.status='released') THEN
  RAISE EXCEPTION 'Conclua a produção em andamento antes de mudar o controle de montagem.';
 END IF;
 IF NOT p_enabled AND EXISTS(SELECT 1 FROM component_stock_lots WHERE product_id=p.id AND remaining>0) THEN RAISE EXCEPTION 'Utilize o saldo de componentes antes de desativar a montagem.'; END IF;
 IF p_enabled AND (NOT EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=p.id AND is_active) OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.extras,'[]')) e WHERE e ? '_kit_product_id')) THEN
  RAISE EXCEPTION 'Cadastre as placas dos componentes neste produto. Kits de outros produtos devem ser preparados separadamente.';
 END IF;
 UPDATE products SET assembly_enabled=p_enabled WHERE id=p.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'configure_assembly','products',p.id,jsonb_build_object('enabled',p_enabled));
 RETURN p.id;
END $$;

CREATE FUNCTION erp_private.component_planned_available(p_tenant uuid,p_plate uuid,p_key text,p_item uuid DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT greatest(0,coalesce((SELECT sum(remaining) FROM component_stock_lots WHERE tenant_id=p_tenant AND plate_id=p_plate AND material_key=p_key),0)+
 coalesce((SELECT sum(coalesce(produced_quantity,planned_quantity)) FROM jobs j WHERE tenant_id=p_tenant AND component_stock_key=p_key AND status NOT IN('ready','shipped','completed','failed') AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=j.id)),0)-
 coalesce((SELECT sum(d.quantity-d.assembled) FROM production_component_demands d JOIN production_order_items i ON i.id=d.item_id JOIN production_orders o ON o.id=i.production_order_id
 WHERE d.tenant_id=p_tenant AND d.plate_id=p_plate AND d.material_key=p_key AND o.status='released'
 AND (p_item IS NULL OR d.reservation_sequence<(SELECT reservation_sequence FROM production_component_demands WHERE item_id=p_item AND plate_id=p_plate))),0))::integer
$$;

CREATE FUNCTION public.add_product_component(p_product_id uuid,p_label text,p_units integer,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; idx integer;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'add_product_component',jsonb_build_array(p_product_id,p_label,p_units)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT coalesce(max(plate_index),0)+1 INTO idx FROM product_print_plates WHERE product_id=p_product_id AND tenant_id=t AND is_active;
 result:=public.save_product_print_plate(NULL,p_product_id,NULL,jsonb_build_object('label',p_label,'plate_index',idx,'units_per_plate',p_units));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.add_product_component(uuid,text,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_product_component(uuid,text,integer,uuid) TO authenticated;

CREATE FUNCTION erp_private.component_job_plan(p_snapshot jsonb,p_quantity integer,p_tenant uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE plate jsonb; plan jsonb; missing integer; key text;
BEGIN
 IF EXISTS(WITH RECURSIVE nodes(snapshot,depth) AS (
  SELECT p_snapshot,0 UNION ALL SELECT part->'snapshot',n.depth+1 FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(coalesce(n.snapshot->'components','[]')) part WHERE n.depth<20
 ) SELECT 1 FROM nodes n JOIN products p ON p.id=(n.snapshot->'product'->>'id')::uuid AND p.tenant_id=p_tenant WHERE n.depth>0 AND p.assembly_enabled) THEN
  RAISE EXCEPTION 'Este kit contém produtos com montagem própria. Produza e monte esses produtos em ordens separadas antes de compor o kit.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=(p_snapshot->'product'->>'id')::uuid AND tenant_id=p_tenant AND assembly_enabled) THEN
  RETURN QUERY SELECT * FROM erp_private.frozen_job_plan(p_snapshot,p_quantity); RETURN;
 END IF;
 IF jsonb_array_length(coalesce(p_snapshot->'plates','[]'))=0 THEN RAISE EXCEPTION 'Prepare as placas dos componentes antes de liberar a montagem.'; END IF;
 FOR plate IN SELECT value FROM jsonb_array_elements(p_snapshot->'plates') LOOP
  key:=erp_private.component_key(p_snapshot,(plate->>'id')::uuid);
  missing:=greatest(0,p_quantity-erp_private.component_planned_available(p_tenant,(plate->>'id')::uuid,key));
  IF missing>0 THEN
   FOR plan IN SELECT * FROM erp_private.frozen_job_plan(p_snapshot||jsonb_build_object('plates',jsonb_build_array(plate)),missing) LOOP
    RETURN NEXT plan||jsonb_build_object('snapshot',p_snapshot);
   END LOOP;
  END IF;
 END LOOP;
END $$;

-- Capture reservations before another OP can plan the same on-hand components.
CREATE FUNCTION erp_private.reserve_assembly_components(p_item uuid,p_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE i production_order_items; pl jsonb;
BEGIN
 SELECT * INTO i FROM production_order_items WHERE id=p_item;
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=i.product_id AND assembly_enabled) THEN RETURN; END IF;
 UPDATE production_order_items SET assembly_required=true WHERE id=i.id;
 DELETE FROM production_component_demands WHERE item_id=i.id AND assembled=0;
 FOR pl IN SELECT value FROM jsonb_array_elements(p_snapshot->'plates') LOOP
  INSERT INTO production_component_demands(tenant_id,item_id,plate_id,material_key,quantity)
  VALUES(i.tenant_id,i.id,(pl->>'id')::uuid,erp_private.component_key(p_snapshot,(pl->>'id')::uuid),i.quantity);
 END LOOP;
END $$;

DO $$ DECLARE def text; target regprocedure; needle text; BEGIN
 FOREACH target IN ARRAY ARRAY['public.production_order_preflight(uuid)'::regprocedure,'public.release_production_order(uuid)'::regprocedure] LOOP
  def:=pg_get_functiondef(target);
  IF target='public.production_order_preflight(uuid)'::regprocedure THEN
   needle:='erp_private.frozen_job_plan(snapshot,item.quantity)';
   IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'Review preflight planning contract'; END IF;
   def:=replace(def,needle,'erp_private.component_job_plan(snapshot,item.quantity,t)');
  ELSE
   needle:='erp_private.frozen_job_plan(line->''snapshot'',item.quantity)';
   IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'Review release planning contract'; END IF;
   def:=replace(def,needle,'erp_private.component_job_plan(line->''snapshot'',item.quantity,t)');
   def:=replace(def,'cumulative_lines:=cumulative_lines+', 'PERFORM erp_private.reserve_assembly_components(item.id,line->''snapshot''); cumulative_lines:=cumulative_lines+');
   -- Reservations made in this transaction must also count for the next line.
   def:=replace(def,'FOR line IN SELECT value FROM jsonb_array_elements(review->''items'') LOOP','UPDATE production_orders SET status=''released'' WHERE id=op.id; FOR line IN SELECT value FROM jsonb_array_elements(review->''items'') LOOP');
  END IF;
  EXECUTE def;
 END LOOP;
END $$;

CREATE FUNCTION public.plan_component_batch(p_plate_id uuid,p_quantity integer,p_request_id uuid,p_item_id uuid DEFAULT NULL) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; plate product_print_plates; snapshot jsonb; pl jsonb; plan jsonb; job uuid; results uuid[]:='{}';
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'component_batch',jsonb_build_array(p_plate_id,p_quantity,p_item_id));
 IF prior IS NOT NULL THEN RETURN ARRAY(SELECT id FROM jobs WHERE tenant_id=t AND creation_request_id=p_request_id ORDER BY code); END IF;
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe de 1 a 10000 conjuntos deste componente.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT pl0.* INTO plate FROM product_print_plates pl0 JOIN products p ON p.id=pl0.product_id WHERE pl0.id=p_plate_id AND pl0.tenant_id=t AND pl0.is_active AND p.is_active AND p.assembly_enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um componente ativo com controle de montagem.'; END IF;
 IF p_item_id IS NULL THEN snapshot:=erp_private.product_bom_snapshot(plate.product_id,t);
 ELSE
  SELECT i.production_snapshot INTO snapshot FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id
   WHERE i.id=p_item_id AND i.product_id=plate.product_id AND i.tenant_id=t AND i.assembly_required AND o.status='released';
  IF snapshot IS NULL OR NOT EXISTS(SELECT 1 FROM production_component_demands WHERE item_id=p_item_id AND plate_id=plate.id AND tenant_id=t) THEN RAISE EXCEPTION 'Componente não pertence à montagem pendente desta ordem.'; END IF;
 END IF;
 SELECT value INTO pl FROM jsonb_array_elements(snapshot->'plates') WHERE value->>'id'=plate.id::text;
 snapshot:=snapshot||jsonb_build_object('plates',jsonb_build_array(pl),'components','[]'::jsonb,'complete',coalesce((pl->'recipe'->>'complete')::boolean,false));
 FOR plan IN SELECT * FROM erp_private.frozen_job_plan(snapshot,p_quantity) LOOP
  INSERT INTO jobs(tenant_id,code,name,description,status,product_id,print_plate_id,planned_quantity,material_id,secondary_material_id,printer_id,
   est_grams,est_time_minutes,est_material_cost,est_total_cost,est_extras_cost,sale_price,num_colors,created_by,production_snapshot,creation_request_id)
  VALUES(t,erp_private.next_code(t,'OI'),plate.label,'Reposição de componentes · '||(plan->>'label'),'queued',plate.product_id,plate.id,(plan->>'quantity')::integer,
   (plan->>'material_id')::uuid,(plan->>'secondary_material_id')::uuid,plate.printer_id,(plan->>'grams')::numeric,(plan->>'minutes')::integer,
   (plan->>'material_cost')::numeric,(plan->>'cost')::numeric,0,0,(plan->>'num_colors')::integer,auth.uid(),snapshot,p_request_id) RETURNING id INTO job;
  results:=array_append(results,job);
 END LOOP;
 IF cardinality(results)=0 THEN RAISE EXCEPTION 'Prepare a receita e o rendimento deste componente.'; END IF;
 PERFORM erp_private.finish_request(t,p_request_id,results[1]); RETURN results;
END $$;

CREATE FUNCTION public.erp_component_job_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.component_stock_key:=NULL;
  IF NEW.reprint_of IS NOT NULL THEN SELECT component_stock_key INTO NEW.component_stock_key FROM jobs WHERE id=NEW.reprint_of AND tenant_id=NEW.tenant_id;
  ELSIF NEW.print_plate_id IS NOT NULL AND NEW.production_snapshot IS NOT NULL AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND tenant_id=NEW.tenant_id AND assembly_enabled) THEN
   NEW.component_stock_key:=erp_private.component_key(NEW.production_snapshot,NEW.print_plate_id);
  END IF;
 ELSIF NEW.component_stock_key IS DISTINCT FROM OLD.component_stock_key THEN RAISE EXCEPTION 'A identidade do componente é congelada na criação da impressão.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_component_job_identity BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_component_job_identity();

CREATE FUNCTION public.erp_receive_component_output() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE qty integer;
BEGIN
 IF NEW.component_stock_key IS NULL OR NEW.status NOT IN('ready','shipped','completed') OR NEW.inventory_posted_at IS NULL THEN RETURN NEW; END IF;
 qty:=coalesce(NEW.produced_quantity,NEW.planned_quantity);
 IF qty<=0 OR qty>NEW.planned_quantity OR NEW.actual_total_cost IS NULL THEN RAISE EXCEPTION 'Confira a quantidade boa e o custo real deste lote antes de aprovar.'; END IF;
 INSERT INTO component_stock_lots(tenant_id,product_id,plate_id,material_key,quantity,remaining,unit_cost,source_job_id,material_snapshot,notes,created_by)
 VALUES(NEW.tenant_id,NEW.product_id,NEW.print_plate_id,NEW.component_stock_key,qty,qty,NEW.actual_total_cost/qty,NEW.id,NEW.production_snapshot,'Lote aprovado após conferência',auth.uid()) ON CONFLICT(source_job_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER component_output_received AFTER INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_receive_component_output();

CREATE FUNCTION public.confirm_component_output(p_job_id uuid,p_good_quantity integer,p_reason text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; j jobs; result uuid; a bambu_production_allocations; r bambu_production_records; rejected record; bad integer;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'confirm_component_output',jsonb_build_array(p_job_id,p_good_quantity,p_reason)); IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t FOR UPDATE;
 IF j.id IS NULL OR j.component_stock_key IS NULL OR j.status<>'quality_check' OR j.inventory_posted_at IS NULL THEN RAISE EXCEPTION 'Apure a impressão e coloque o lote em conferência de qualidade.'; END IF;
 IF p_good_quantity IS NULL OR p_good_quantity NOT BETWEEN 0 AND least(j.planned_quantity,coalesce(j.produced_quantity,j.planned_quantity)) THEN RAISE EXCEPTION 'A quantidade boa deve ficar entre zero e a quantidade apurada do lote.'; END IF;
 IF p_good_quantity<j.planned_quantity AND nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo das peças rejeitadas.'; END IF;
 UPDATE jobs SET produced_quantity=p_good_quantity WHERE id=j.id;
 result:=public.transition_job(j.id,CASE WHEN p_good_quantity=0 THEN 'failed' ELSE 'ready' END,p_failure_reason=>p_reason);
 IF p_good_quantity>0 AND p_good_quantity<j.planned_quantity THEN
  SELECT * INTO a FROM bambu_production_allocations WHERE job_id=j.id AND tenant_id=t;
  IF a.job_id IS NOT NULL THEN
   SELECT * INTO r FROM bambu_production_records WHERE task_id=a.task_id AND tenant_id=t FOR UPDATE;
   bad:=a.quantity-p_good_quantity;
   IF bad<0 THEN RAISE EXCEPTION 'A quantidade boa excede as peças apuradas pela impressora.'; END IF;
   IF bad>0 THEN
    INSERT INTO bambu_quality_rejections(job_id,task_id,tenant_id,quantity,grams,elapsed_seconds,material_cost,total_cost,reason,created_by)
    VALUES(j.id,r.task_id,t,bad,r.total_grams*bad/r.units,r.elapsed_seconds*bad/r.units,
     j.actual_material_cost*bad/a.quantity,j.actual_total_cost*bad/a.quantity,btrim(p_reason),auth.uid());
    SELECT sum(quantity)::integer units,sum(grams) grams,sum(total_cost) cost INTO rejected FROM bambu_quality_rejections WHERE task_id=r.task_id AND tenant_id=t;
    UPDATE bambu_production_records SET quality_rejected_units=rejected.units,quality_loss_grams=rejected.grams,quality_loss_cost=rejected.cost,
     quality_state=CASE WHEN rejected.units=r.units THEN 'rejected' ELSE 'partially_rejected' END,updated_at=now() WHERE task_id=r.task_id;
    PERFORM erp_private.update_product_print_actuals(r.product_id);
   END IF;
  END IF;
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'component_quality','jobs',j.id,jsonb_build_object('good',p_good_quantity,'rejected',j.planned_quantity-p_good_quantity,'reason',p_reason));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.receive_existing_components(p_plate_id uuid,p_quantity integer,p_unit_cost numeric,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; pl product_print_plates; snapshot jsonb; recipe jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'existing_components',jsonb_build_array(p_plate_id,p_quantity,p_unit_cost,p_notes)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT x.* INTO pl FROM product_print_plates x JOIN products p ON p.id=x.product_id WHERE x.id=p_plate_id AND x.tenant_id=t AND x.is_active AND p.is_active AND p.assembly_enabled;
 IF pl.id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 OR NOT erp_private.valid_number(p_unit_cost) OR nullif(btrim(p_notes),'') IS NULL THEN RAISE EXCEPTION 'Informe componente, quantidade positiva, custo e motivo da entrada.'; END IF;
 snapshot:=erp_private.product_bom_snapshot(pl.product_id,t);
 SELECT value->'recipe' INTO recipe FROM jsonb_array_elements(snapshot->'plates') WHERE value->>'id'=pl.id::text;
 IF NOT coalesce((recipe->>'complete')::boolean,false) THEN RAISE EXCEPTION 'Identifique os materiais e cores do componente antes de registrar o saldo.'; END IF;
 INSERT INTO component_stock_lots(tenant_id,product_id,plate_id,material_key,quantity,remaining,unit_cost,material_snapshot,notes,created_by)
 VALUES(t,pl.product_id,pl.id,erp_private.component_key(snapshot,pl.id),p_quantity,p_quantity,p_unit_cost,snapshot,btrim(p_notes),auth.uid()) RETURNING id INTO result;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'existing_component_stock','component_stock_lots',result,jsonb_build_object('quantity',p_quantity,'unit_cost',p_unit_cost,'reason',p_notes));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.assembly_product_status(p_product_id uuid,p_quantity integer DEFAULT 1,p_item_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); p products; i production_order_items; snapshot jsonb; pl jsonb; key text; available integer; balance integer; pending integer;
 lines jsonb:='[]'; ready integer:=2147483647; units integer; target integer;
BEGIN
 SELECT * INTO p FROM products WHERE id=p_product_id AND tenant_id=t;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
 target:=p_quantity;
 IF p_item_id IS NOT NULL THEN
  SELECT * INTO i FROM production_order_items WHERE id=p_item_id AND product_id=p.id AND tenant_id=t;
  IF NOT FOUND OR NOT i.assembly_required THEN RAISE EXCEPTION 'Item de montagem não encontrado.'; END IF;
  snapshot:=i.production_snapshot; target:=i.quantity-i.assembled_quantity;
 ELSE snapshot:=erp_private.product_bom_snapshot(p.id,t); END IF;
 IF target IS NULL OR target NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
 FOR pl IN SELECT value FROM jsonb_array_elements(coalesce(snapshot->'plates','[]')) LOOP
  key:=erp_private.component_key(snapshot,(pl->>'id')::uuid);
  available:=erp_private.component_available(t,(pl->>'id')::uuid,key,p_item_id);
  SELECT coalesce(sum(remaining),0) INTO balance FROM component_stock_lots WHERE tenant_id=t AND plate_id=(pl->>'id')::uuid AND material_key=key;
  SELECT coalesce(sum(planned_quantity),0) INTO pending FROM jobs WHERE tenant_id=t AND component_stock_key=key AND status NOT IN('ready','shipped','completed','failed') AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=jobs.id);
  units:=nullif(pl->'recipe'->>'units_per_print','')::integer;
  ready:=least(ready,available);
  lines:=lines||jsonb_build_array(jsonb_build_object('plate_id',pl->>'id','label',pl->>'label','plate_index',pl->'plate_index','units_per_print',units,
   'balance',balance,'available',available,'reserved',greatest(0,balance-available),'pending',pending,'required',target,'missing',greatest(0,target-available),
   'to_print',greatest(0,target-erp_private.component_planned_available(t,(pl->>'id')::uuid,key,p_item_id)),
   'runs',CASE WHEN units>0 THEN ceil(greatest(0,target-erp_private.component_planned_available(t,(pl->>'id')::uuid,key,p_item_id))::numeric/units) END,'prepared',coalesce((pl->'recipe'->>'complete')::boolean,false),'material_key',key));
 END LOOP;
 RETURN jsonb_build_object('product_id',p.id,'name',p.name,'enabled',p.assembly_enabled,'item_id',p_item_id,'required',target,'assembled',coalesce(i.assembled_quantity,0),
  'ready_to_assemble',CASE WHEN jsonb_array_length(lines)=0 THEN 0 ELSE ready END,'components',lines,
  'finished_stock',coalesce((SELECT current_stock FROM inventory_items WHERE id=p.stock_item_id AND tenant_id=t),0));
END $$;

CREATE FUNCTION public.assemble_product(p_product_id uuid,p_quantity integer,p_item_id uuid,p_finishing_cost numeric,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; p products; i production_order_items; status jsonb; part jsonb; lot component_stock_lots;
 need integer; take integer; total numeric:=0; stock uuid;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'assemble_product',jsonb_build_array(p_product_id,p_quantity,p_item_id,p_finishing_cost,p_notes)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO p FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
 IF p.id IS NULL OR NOT p.assembly_enabled OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 OR NOT erp_private.valid_number(p_finishing_cost) THEN RAISE EXCEPTION 'Informe produto, quantidade positiva e custo de acabamento válido.'; END IF;
 IF p_item_id IS NOT NULL THEN
  SELECT * INTO i FROM production_order_items WHERE id=p_item_id AND tenant_id=t AND product_id=p.id FOR UPDATE;
  IF i.id IS NULL OR NOT i.assembly_required OR p_quantity>i.quantity-i.assembled_quantity OR NOT EXISTS(SELECT 1 FROM production_orders po WHERE po.id=i.production_order_id AND po.status='released') THEN RAISE EXCEPTION 'Quantidade ou ordem de montagem indisponível.'; END IF;
 END IF;
 status:=public.assembly_product_status(p.id,p_quantity,p_item_id);
 IF (status->>'ready_to_assemble')::integer<p_quantity THEN RAISE EXCEPTION 'Faltam componentes livres. Confira as peças e as reservas de ordens anteriores.'; END IF;
 result:=gen_random_uuid();
 INSERT INTO product_assemblies(id,tenant_id,product_id,item_id,quantity,finishing_cost,notes,created_by) VALUES(result,t,p.id,p_item_id,p_quantity,p_finishing_cost,p_notes,auth.uid());
 FOR part IN SELECT value FROM jsonb_array_elements(status->'components') LOOP
  need:=p_quantity;
  FOR lot IN SELECT * FROM component_stock_lots WHERE tenant_id=t AND plate_id=(part->>'plate_id')::uuid AND material_key=part->>'material_key' AND remaining>0 ORDER BY created_at,id FOR UPDATE LOOP
   take:=least(need,lot.remaining);
   UPDATE component_stock_lots SET remaining=remaining-take WHERE id=lot.id;
   INSERT INTO assembly_component_allocations(tenant_id,assembly_id,lot_id,quantity,unit_cost) VALUES(t,result,lot.id,take,lot.unit_cost);
   total:=total+take*lot.unit_cost; need:=need-take; EXIT WHEN need=0;
  END LOOP;
  IF need<>0 THEN RAISE EXCEPTION 'O saldo mudou. Atualize a montagem.'; END IF;
 END LOOP;
 UPDATE product_assemblies SET component_cost=total WHERE id=result;
 IF p_item_id IS NOT NULL THEN
  UPDATE production_order_items SET assembled_quantity=assembled_quantity+p_quantity WHERE id=p_item_id;
  UPDATE production_component_demands SET assembled=assembled+p_quantity WHERE item_id=p_item_id;
 ELSE
  stock:=p.stock_item_id;
  IF stock IS NULL THEN
   INSERT INTO inventory_items(tenant_id,name,unit,category,avg_cost,loss_coefficient) VALUES(t,p.name,'un','consumable',0,0) RETURNING id INTO stock;
   UPDATE products SET stock_item_id=stock WHERE id=p.id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=stock AND tenant_id=t AND is_active AND lower(btrim(unit))='un') THEN RAISE EXCEPTION 'O estoque do produto pronto precisa estar ativo em unidades (un).'; END IF;
  INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
  VALUES(t,stock,'purchase_in',p_quantity,(total+p_finishing_cost)/p_quantity,'assembly',result,'Entrada de produto montado; componentes já consumidos na impressão',auth.uid());
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'assembly','product_assemblies',result,jsonb_build_object('quantity',p_quantity,'component_cost',total,'finishing_cost',p_finishing_cost,'destination',CASE WHEN p_item_id IS NULL THEN 'stock' ELSE 'production_order' END));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

-- Finishing every plate is not finishing the sellable product.
CREATE FUNCTION public.erp_order_requires_assembly() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IN('ready','shipped','completed') AND EXISTS(SELECT 1 FROM production_orders o JOIN production_order_items i ON i.production_order_id=o.id WHERE o.source_order_id=NEW.id AND i.assembly_required AND i.assembled_quantity<i.quantity) THEN
  IF NEW.status='ready' AND OLD.status IN('approved','in_production') THEN NEW.status:=OLD.status;
  ELSE RAISE EXCEPTION 'Conclua a montagem dos componentes antes de entregar a venda.'; END IF;
 END IF;
 IF NEW.status='cancelled' AND EXISTS(SELECT 1 FROM production_orders o JOIN production_order_items i ON i.production_order_id=o.id WHERE o.source_order_id=NEW.id AND i.assembled_quantity>0) THEN RAISE EXCEPTION 'A venda possui produtos montados e destinados à ordem. Regularize a produção antes de cancelar.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_requires_assembly BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION erp_order_requires_assembly();

DO $$ DECLARE def text; needle text; BEGIN
 def:=pg_get_functiondef('public.transition_production_order(uuid,text)'::regprocedure);
 needle:='IF p_status=''completed'' AND op.status=''released'' THEN';
 IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'Review OP completion contract'; END IF;
 def:=replace(def,needle,needle||' IF EXISTS(SELECT 1 FROM production_order_items WHERE production_order_id=op.id AND assembly_required AND assembled_quantity<quantity) THEN RAISE EXCEPTION ''Conclua a montagem dos produtos; as impressões sozinhas não encerram a produção.''; END IF;');
 def:=replace(def,'IF NOT EXISTS(SELECT 1 FROM jobs WHERE production_order_id=op.id) OR EXISTS(', 'IF (NOT EXISTS(SELECT 1 FROM jobs WHERE production_order_id=op.id) AND NOT EXISTS(SELECT 1 FROM production_order_items WHERE production_order_id=op.id AND assembly_required)) OR EXISTS(');
 EXECUTE def;
END $$;

-- Prevent structural edits from discarding usable stock or a reserved component.
CREATE FUNCTION public.erp_guard_component_plate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (TG_OP='DELETE' OR (NEW.is_active,NEW.product_id,NEW.units_per_plate,NEW.source_id) IS DISTINCT FROM (OLD.is_active,OLD.product_id,OLD.units_per_plate,OLD.source_id)) AND
 (EXISTS(SELECT 1 FROM component_stock_lots WHERE plate_id=OLD.id AND remaining>0) OR EXISTS(SELECT 1 FROM production_component_demands d JOIN production_order_items i ON i.id=d.item_id JOIN production_orders o ON o.id=i.production_order_id WHERE d.plate_id=OLD.id AND o.status='released' AND d.assembled<d.quantity)) THEN
  RAISE EXCEPTION 'Esta placa possui saldo ou montagem pendente. Utilize os componentes antes de mudar sua estrutura.';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER guard_component_plate BEFORE UPDATE OR DELETE ON product_print_plates FOR EACH ROW EXECUTE FUNCTION erp_guard_component_plate();

REVOKE ALL ON FUNCTION erp_private.component_key(jsonb,uuid),erp_private.component_available(uuid,uuid,text,uuid),erp_private.component_job_plan(jsonb,integer,uuid),erp_private.reserve_assembly_components(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.component_planned_available(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.erp_component_job_identity(),public.erp_receive_component_output(),public.erp_order_requires_assembly(),public.erp_guard_component_plate() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.configure_product_assembly(uuid,boolean),public.plan_component_batch(uuid,integer,uuid,uuid),public.confirm_component_output(uuid,integer,text,uuid),public.receive_existing_components(uuid,integer,numeric,text,uuid),public.assembly_product_status(uuid,integer,uuid),public.assemble_product(uuid,integer,uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_product_assembly(uuid,boolean),public.plan_component_batch(uuid,integer,uuid,uuid),public.confirm_component_output(uuid,integer,text,uuid),public.receive_existing_components(uuid,integer,numeric,text,uuid),public.assembly_product_status(uuid,integer,uuid),public.assemble_product(uuid,integer,uuid,numeric,text,uuid) TO authenticated;

CREATE FUNCTION public.erp_guard_assembly_settings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user IN('authenticated','anon','service_role') AND ((TG_OP='INSERT' AND NEW.assembly_enabled) OR (TG_OP='UPDATE' AND NEW.assembly_enabled IS DISTINCT FROM OLD.assembly_enabled)) THEN RAISE EXCEPTION 'Configure a montagem pela operação de componentes.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_assembly_settings BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION erp_guard_assembly_settings();
REVOKE ALL ON FUNCTION public.erp_guard_assembly_settings() FROM PUBLIC,anon,authenticated;

-- Fully assembled items can use existing component stock or replacement lots.
-- Failed attempts are history; they cannot force redundant reprints of good stock.
DO $$ DECLARE def text; needle text; target regprocedure; BEGIN
 FOREACH target IN ARRAY ARRAY['public.transition_production_order(uuid,text)'::regprocedure,'erp_private.transition_sales_order_legacy(uuid,text)'::regprocedure] LOOP
  def:=pg_get_functiondef(target);
  needle:='AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=j.id)';
  IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'Review completion job check'; END IF;
  def:=replace(def,needle,needle||' AND NOT (j.status=''failed'' AND EXISTS(SELECT 1 FROM production_order_items pi WHERE pi.id=j.production_order_item_id AND pi.assembly_required AND pi.assembled_quantity=pi.quantity))');
  IF target='erp_private.transition_sales_order_legacy(uuid,text)'::regprocedure THEN
   needle:='IF NOT EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) OR EXISTS(';
   IF strpos(def,needle)=0 THEN RAISE EXCEPTION 'Review stock assembly sales check'; END IF;
   def:=replace(def,needle,'IF (NOT EXISTS(SELECT 1 FROM jobs WHERE order_id=o.id) AND NOT EXISTS(SELECT 1 FROM production_orders po JOIN production_order_items pi ON pi.production_order_id=po.id WHERE po.source_order_id=o.id AND pi.assembly_required AND pi.assembled_quantity=pi.quantity)) OR EXISTS(');
  END IF;
  EXECUTE def;
 END LOOP;
END $$;
