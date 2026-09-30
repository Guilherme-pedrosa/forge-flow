-- A physical part is a catalogue product with its own inventory. Plates are only
-- production arrangements: two objects on one plate must never share a balance.
ALTER TABLE public.products ADD COLUMN is_component boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN component_inventory_mode boolean NOT NULL DEFAULT false;
CREATE TABLE public.product_subitems (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 component_product_id uuid NOT NULL REFERENCES products(id),
 quantity_per_product integer CHECK(quantity_per_product BETWEEN 1 AND 10000),
 plate_id uuid REFERENCES product_print_plates(id) ON DELETE SET NULL,
 quantity_per_plate integer CHECK(quantity_per_plate BETWEEN 1 AND 10000),
 source_part_id uuid UNIQUE REFERENCES product_print_plate_parts(id) ON DELETE SET NULL,
 sort_order bigint GENERATED ALWAYS AS IDENTITY,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(product_id<>component_product_id), UNIQUE(product_id,component_product_id)
);
CREATE TABLE public.production_subitem_demands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 item_id uuid NOT NULL REFERENCES production_order_items(id),
 component_product_id uuid NOT NULL REFERENCES products(id),
 quantity integer NOT NULL CHECK(quantity>0), consumed integer NOT NULL DEFAULT 0 CHECK(consumed>=0 AND consumed<=quantity),
 reservation_sequence bigint GENERATED ALWAYS AS IDENTITY, UNIQUE(item_id,component_product_id)
);
CREATE TABLE public.assembly_subitem_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 assembly_id uuid NOT NULL REFERENCES product_assemblies(id),
 component_product_id uuid NOT NULL REFERENCES products(id), quantity integer NOT NULL CHECK(quantity>0),
 unit_cost numeric NOT NULL CHECK(unit_cost>=0), movement_id uuid NOT NULL REFERENCES inventory_movements(id)
);
CREATE TABLE public.job_subitem_outputs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 job_id uuid NOT NULL REFERENCES jobs(id), component_product_id uuid NOT NULL REFERENCES products(id),
 planned_quantity integer NOT NULL CHECK(planned_quantity>0), good_quantity integer NOT NULL CHECK(good_quantity>=0 AND good_quantity<=planned_quantity),
 unit_cost numeric NOT NULL CHECK(unit_cost>=0), movement_id uuid REFERENCES inventory_movements(id),
 UNIQUE(job_id,component_product_id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['product_subitems','production_subitem_demands','assembly_subitem_allocations','job_subitem_outputs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id())',tab);
 END LOOP;
END $$;
CREATE INDEX subitem_demand_product ON production_subitem_demands(tenant_id,component_product_id);
CREATE INDEX subitem_parent ON product_subitems(tenant_id,product_id);

CREATE FUNCTION erp_private.assert_subitem_mode(p_product uuid,p_tenant uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=p_product AND tenant_id=p_tenant AND is_active) THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 IF EXISTS(SELECT 1 FROM component_stock_lots WHERE product_id=p_product AND remaining>0)
 OR EXISTS(SELECT 1 FROM jobs WHERE product_id=p_product AND component_stock_key IS NOT NULL AND production_snapshot->>'individual_stock' IS DISTINCT FROM 'true' AND status NOT IN('ready','shipped','completed','failed'))
 OR EXISTS(SELECT 1 FROM production_order_items i JOIN production_orders o ON o.id=i.production_order_id WHERE i.product_id=p_product AND o.status='released' AND i.production_snapshot->>'individual_stock' IS DISTINCT FROM 'true') THEN
  RAISE EXCEPTION 'Há lotes antigos em conjuntos. Conclua ou concilie esses lotes antes de separar o estoque por peça; nenhum saldo será convertido automaticamente.';
 END IF;
 IF EXISTS(SELECT 1 FROM product_subitems WHERE component_product_id=p_product)
 OR EXISTS(SELECT 1 FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.extras,'[]')) e WHERE p.id=p_product AND e ? '_kit_product_id') THEN
  RAISE EXCEPTION 'Monte este produto separadamente: componentes de uma montagem devem ser peças com estoque próprio.';
 END IF;
 UPDATE products SET component_inventory_mode=true,assembly_enabled=true WHERE id=p_product;
END $$;

CREATE FUNCTION public.save_product_subitem(p_product_id uuid,p_subitem_id uuid,p_data jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; parent products; child products; existing product_subitems;
 child_id uuid; stock uuid; qty integer; yield_count integer; plate uuid; initial_qty numeric; initial_cost numeric;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'save_subitem',jsonb_build_array(p_product_id,p_subitem_id,p_data)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM erp_private.assert_subitem_mode(p_product_id,t);
 SELECT * INTO parent FROM products WHERE id=p_product_id AND tenant_id=t FOR UPDATE;
 IF p_subitem_id IS NOT NULL THEN
  SELECT * INTO existing FROM product_subitems WHERE id=p_subitem_id AND product_id=parent.id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subitem não encontrado neste produto.'; END IF;
 END IF;
 qty:=(p_data->>'quantity_per_product')::integer; yield_count:=(p_data->>'quantity_per_plate')::integer; plate:=(p_data->>'plate_id')::uuid;
 IF (qty IS NOT NULL AND qty NOT BETWEEN 1 AND 10000) OR (yield_count IS NOT NULL AND yield_count NOT BETWEEN 1 AND 10000) THEN RAISE EXCEPTION 'Informe quantidades inteiras de 1 a 10000.'; END IF;
 IF plate IS NOT NULL AND NOT EXISTS(SELECT 1 FROM product_print_plates WHERE id=plate AND product_id=parent.id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Placa inválida para este produto.'; END IF;
 child_id:=coalesce(existing.component_product_id,(p_data->>'component_product_id')::uuid);
 IF child_id IS NULL THEN
  IF nullif(btrim(p_data->>'name'),'') IS NULL OR length(p_data->>'name')>200 THEN RAISE EXCEPTION 'Informe o nome do subitem.'; END IF;
  initial_qty:=coalesce((p_data->>'initial_stock')::numeric,0); initial_cost:=coalesce((p_data->>'unit_cost')::numeric,0);
  IF NOT erp_private.valid_number(initial_qty) OR initial_qty<>trunc(initial_qty) OR NOT erp_private.valid_number(initial_cost) THEN RAISE EXCEPTION 'Informe estoque inteiro e custo não negativo.'; END IF;
  INSERT INTO inventory_items(tenant_id,name,unit,category,avg_cost,loss_coefficient) VALUES(t,btrim(p_data->>'name'),'un','consumable',initial_cost,0) RETURNING id INTO stock;
  INSERT INTO products(tenant_id,name,sku,category,is_component,stock_item_id,manual_cost_override,cost_estimate,sale_price,photo_url,notes)
   VALUES(t,btrim(p_data->>'name'),coalesce(nullif(btrim(p_data->>'sku'),''),'SUB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),'printed_part',true,stock,
    (p_data->>'unit_cost')::numeric,(p_data->>'unit_cost')::numeric,NULL,p_data->>'photo_url','Subitem com estoque individual de '||parent.name) RETURNING id INTO child_id;
  UPDATE inventory_items SET sku=(SELECT sku FROM products WHERE id=child_id) WHERE id=stock;
  IF initial_qty>0 THEN INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
   VALUES(t,stock,'purchase_in',initial_qty,initial_cost,'subitem_initial',child_id,'Estoque inicial informado no cadastro',auth.uid()); END IF;
 ELSE
  SELECT * INTO child FROM products WHERE id=child_id AND tenant_id=t AND is_active FOR UPDATE;
  IF child.id IS NULL OR child.id=parent.id OR child.assembly_enabled OR child.category='service' THEN RAISE EXCEPTION 'Selecione uma peça ativa com estoque próprio.'; END IF;
  stock:=child.stock_item_id;
  IF stock IS NULL THEN
   INSERT INTO inventory_items(tenant_id,name,unit,category,avg_cost,loss_coefficient) VALUES(t,child.name,'un','consumable',coalesce(child.manual_cost_override,child.cost_estimate,0),0) RETURNING id INTO stock;
   UPDATE products SET stock_item_id=stock WHERE id=child.id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=stock AND tenant_id=t AND is_active AND unit='un') THEN RAISE EXCEPTION 'O estoque do subitem deve estar ativo em unidades (un).'; END IF;
 END IF;
 IF existing.id IS NULL THEN
  INSERT INTO product_subitems(tenant_id,product_id,component_product_id,quantity_per_product,plate_id,quantity_per_plate)
   VALUES(t,parent.id,child_id,qty,plate,yield_count) RETURNING id INTO result;
 ELSE
  UPDATE product_subitems SET quantity_per_product=qty,plate_id=plate,quantity_per_plate=yield_count WHERE id=existing.id RETURNING id INTO result;
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'save_subitem','product_subitems',result,p_data);
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.remove_product_subitem(p_subitem_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); b product_subitems;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO b FROM product_subitems WHERE id=p_subitem_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subitem não encontrado.'; END IF;
 DELETE FROM product_subitems WHERE id=b.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'unlink_subitem','product_subitems',b.id,to_jsonb(b));
 RETURN b.id; -- The child product and its inventory/history are retained.
END $$;

CREATE FUNCTION erp_private.sync_imported_subitems(p_product uuid,p_tenant uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE piece product_print_plate_parts; b uuid;
BEGIN
 PERFORM erp_private.assert_subitem_mode(p_product,p_tenant);
 FOR piece IN SELECT imported_part.* FROM product_print_plate_parts imported_part JOIN product_print_plates imported_plate ON imported_plate.id=imported_part.plate_id WHERE imported_part.product_id=p_product AND imported_part.tenant_id=p_tenant AND imported_part.name_source<>'unknown' ORDER BY imported_plate.plate_index,imported_part.source_key,imported_part.id LOOP
  IF EXISTS(SELECT 1 FROM product_subitems WHERE source_part_id=piece.id) THEN CONTINUE; END IF;
  b:=public.save_product_subitem(p_product,NULL,jsonb_build_object('name',piece.name,'photo_url',piece.photo_url,
   'quantity_per_product',piece.quantity_per_product,'plate_id',piece.plate_id,'quantity_per_plate',piece.quantity_per_plate),gen_random_uuid());
  UPDATE product_subitems SET source_part_id=piece.id WHERE id=b;
 END LOOP;
END $$;

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_subitems;
REVOKE ALL ON FUNCTION erp_private.save_product_before_subitems(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid;
BEGIN
 result:=erp_private.save_product_before_subitems(p_product_id,p_product,p_photos,p_request_id);
 IF coalesce((p_product->'import_composition'->>'enabled')::boolean,(p_product->'file_composition'->>'enabled')::boolean,false) THEN
  PERFORM erp_private.sync_imported_subitems(result,t);
 END IF;
 RETURN result;
END $$;

ALTER FUNCTION erp_private.product_bom_snapshot(uuid,uuid) RENAME TO product_bom_before_subitems;
CREATE FUNCTION erp_private.product_bom_snapshot(p_product_id uuid,p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; parts jsonb;
BEGIN
 result:=erp_private.product_bom_before_subitems(p_product_id,p_tenant_id);
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=p_tenant_id AND component_inventory_mode) THEN RETURN result; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'component_product_id',c.id,'stock_item_id',c.stock_item_id,'name',c.name,'sku',c.sku,
  'photo_url',c.photo_url,'quantity_per_product',b.quantity_per_product,'plate_id',b.plate_id,'quantity_per_plate',b.quantity_per_plate,'active',c.is_active) ORDER BY b.sort_order,b.id),'[]') INTO parts
 FROM product_subitems b JOIN products c ON c.id=b.component_product_id AND c.tenant_id=p_tenant_id WHERE b.product_id=p_product_id AND b.tenant_id=p_tenant_id;
 RETURN result||jsonb_build_object('individual_stock',true,'physical_components',parts);
END $$;

CREATE FUNCTION erp_private.subitem_available(p_tenant uuid,p_component uuid,p_item uuid DEFAULT NULL,p_include_pending boolean DEFAULT false) RETURNS integer
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT greatest(0,coalesce((SELECT i.current_stock FROM products p JOIN inventory_items i ON i.id=p.stock_item_id WHERE p.id=p_component AND p.tenant_id=p_tenant AND p.is_active AND i.is_active),0)
 + CASE WHEN p_include_pending THEN coalesce((SELECT sum((c->>'quantity')::integer) FROM jobs j CROSS JOIN LATERAL jsonb_array_elements(coalesce(j.production_snapshot->'physical_outputs','[]')) c
  WHERE j.tenant_id=p_tenant AND c->>'component_product_id'=p_component::text AND j.status NOT IN('ready','completed','shipped','failed') AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=j.id)),0) ELSE 0 END
 -coalesce((SELECT sum(d.quantity-d.consumed) FROM production_subitem_demands d JOIN production_order_items i ON i.id=d.item_id JOIN production_orders o ON o.id=i.production_order_id
  WHERE d.tenant_id=p_tenant AND d.component_product_id=p_component AND o.status='released'
  AND (p_item IS NULL OR d.reservation_sequence<(SELECT reservation_sequence FROM production_subitem_demands WHERE item_id=p_item AND component_product_id=p_component))),0))::integer
$$;

ALTER FUNCTION public.assembly_product_status(uuid,integer,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.assembly_product_status(uuid,integer,uuid) RENAME TO assembly_status_before_subitems;
REVOKE ALL ON FUNCTION erp_private.assembly_status_before_subitems(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.assembly_product_status(p_product_id uuid,p_quantity integer DEFAULT 1,p_item_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); p products; i production_order_items; snapshot jsonb; c jsonb; pl jsonb; lines jsonb:='[]';
 available integer; planned integer; balance numeric; need integer; ready integer:=2147483647; target integer; q integer; pending integer; missing jsonb:='[]';
BEGIN
 SELECT * INTO p FROM products WHERE id=p_product_id AND tenant_id=t;
 IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
 IF NOT p.component_inventory_mode OR EXISTS(SELECT 1 FROM production_order_items old_item WHERE old_item.id=p_item_id AND old_item.tenant_id=t AND old_item.product_id=p.id AND old_item.production_snapshot->>'individual_stock' IS DISTINCT FROM 'true') THEN RETURN erp_private.assembly_status_before_subitems(p_product_id,p_quantity,p_item_id); END IF;
 target:=p_quantity; snapshot:=erp_private.product_bom_snapshot(p.id,t);
 IF p_item_id IS NOT NULL THEN
  SELECT * INTO i FROM production_order_items WHERE id=p_item_id AND product_id=p.id AND tenant_id=t AND assembly_required;
  IF NOT FOUND OR i.production_snapshot->>'individual_stock' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Ordem sem composição individual de peças.'; END IF;
  snapshot:=i.production_snapshot; target:=i.quantity-i.assembled_quantity;
 END IF;
 IF target IS NULL OR target NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(snapshot->'physical_components') LOOP
  q:=(c->>'quantity_per_product')::integer;
  IF q IS NULL OR NOT coalesce((c->>'active')::boolean,false) THEN ready:=0; missing:=missing||jsonb_build_array('Confira a quantidade por produto e o cadastro de '||(c->>'name')); END IF;
  available:=erp_private.subitem_available(t,(c->>'component_product_id')::uuid,p_item_id);
  planned:=erp_private.subitem_available(t,(c->>'component_product_id')::uuid,p_item_id,true);
  SELECT value INTO pl FROM jsonb_array_elements(snapshot->'plates') WHERE value->>'id'=c->>'plate_id';
  SELECT current_stock INTO balance FROM inventory_items WHERE id=(c->>'stock_item_id')::uuid AND tenant_id=t;
  SELECT coalesce(sum((out->>'quantity')::integer),0)::integer INTO pending FROM jobs j CROSS JOIN LATERAL jsonb_array_elements(coalesce(j.production_snapshot->'physical_outputs','[]')) out
   WHERE j.tenant_id=t AND out->>'component_product_id'=c->>'component_product_id' AND j.status NOT IN('ready','shipped','completed','failed') AND NOT EXISTS(SELECT 1 FROM jobs child WHERE child.reprint_of=j.id);
  need:=target*q; ready:=least(ready,coalesce(available/q,0));
  lines:=lines||jsonb_build_array(c||jsonb_build_object('label',c->>'name','plate_index',pl->'plate_index','plate_label',pl->>'label',
   'units_per_print',c->'quantity_per_plate','balance',coalesce(balance,0),'available',available,'reserved',greatest(0,coalesce(balance,0)-available),
   'pending',pending,'required',need,'missing',greatest(0,need-available),'to_print',greatest(0,need-planned),
   'runs',ceil(greatest(0,need-planned)::numeric/nullif((c->>'quantity_per_plate')::integer,0)),
   'prepared',coalesce((pl->'recipe'->>'complete')::boolean,false) AND c->>'quantity_per_plate' IS NOT NULL));
 END LOOP;
 IF jsonb_array_length(lines)=0 THEN missing:=missing||jsonb_build_array('Cadastre as peças físicas do produto. Uma placa não é um subitem.'); END IF;
 RETURN jsonb_build_object('product_id',p.id,'name',p.name,'enabled',p.assembly_enabled,'individual_stock',true,'item_id',p_item_id,'required',target,
  'assembled',coalesce(i.assembled_quantity,0),'ready_to_assemble',CASE WHEN jsonb_array_length(lines)=0 THEN 0 ELSE ready END,'components',lines,'issues',missing,
  'finished_stock',coalesce((SELECT current_stock FROM inventory_items WHERE id=p.stock_item_id AND tenant_id=t),0));
END $$;

CREATE FUNCTION public.move_subitem_stock(p_component_product_id uuid,p_quantity integer,p_kind text,p_unit_cost numeric,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; c products;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'subitem_stock',jsonb_build_array(p_component_product_id,p_quantity,p_kind,p_unit_cost,p_notes)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO c FROM products WHERE id=p_component_product_id AND tenant_id=t AND is_active FOR UPDATE;
 IF c.id IS NULL OR c.stock_item_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100000 OR p_kind NOT IN('entry','loss') OR p_kind IS NULL
 OR NOT erp_private.valid_number(p_unit_cost) OR nullif(btrim(p_notes),'') IS NULL THEN RAISE EXCEPTION 'Informe peça, quantidade, custo e motivo da movimentação.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM product_subitems WHERE component_product_id=c.id AND tenant_id=t) THEN RAISE EXCEPTION 'Produto não vinculado como subitem.'; END IF;
 INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
 VALUES(t,c.stock_item_id,(CASE WHEN p_kind='entry' THEN 'purchase_in' ELSE 'loss' END)::movement_type,p_quantity,p_unit_cost,'subitem',c.id,btrim(p_notes),auth.uid()) RETURNING id INTO result;
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

ALTER FUNCTION public.assemble_product(uuid,integer,uuid,numeric,text,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.assemble_product(uuid,integer,uuid,numeric,text,uuid) RENAME TO assemble_before_subitems;
REVOKE ALL ON FUNCTION erp_private.assemble_before_subitems(uuid,integer,uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.assemble_product(p_product_id uuid,p_quantity integer,p_item_id uuid,p_finishing_cost numeric,p_notes text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; p products; i production_order_items; review jsonb; c jsonb; need integer; stock uuid;
 movement uuid; unit_cost numeric; total numeric:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t AND component_inventory_mode) THEN
  RETURN erp_private.assemble_before_subitems(p_product_id,p_quantity,p_item_id,p_finishing_cost,p_notes,p_request_id); END IF;
 result:=erp_private.begin_request(t,p_request_id,'assemble_product',jsonb_build_array(p_product_id,p_quantity,p_item_id,p_finishing_cost,p_notes)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO p FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
 IF p.id IS NULL OR NOT p.assembly_enabled OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 OR NOT erp_private.valid_number(p_finishing_cost) THEN RAISE EXCEPTION 'Informe produto, quantidade e custo de montagem válidos.'; END IF;
 IF p_item_id IS NOT NULL THEN
  SELECT * INTO i FROM production_order_items WHERE id=p_item_id AND product_id=p.id AND tenant_id=t AND assembly_required FOR UPDATE;
  IF i.id IS NULL OR p_quantity>i.quantity-i.assembled_quantity OR NOT EXISTS(SELECT 1 FROM production_orders WHERE id=i.production_order_id AND status='released') THEN RAISE EXCEPTION 'Ordem ou quantidade de montagem indisponível.'; END IF;
 END IF;
 -- Lock every physical balance in a stable order, including writes from the stock module.
 PERFORM ii.id FROM inventory_items ii WHERE ii.tenant_id=t AND ii.id IN(SELECT (locked_part->>'stock_item_id')::uuid FROM jsonb_array_elements(
  CASE WHEN i.id IS NULL THEN erp_private.product_bom_snapshot(p.id,t)->'physical_components' ELSE i.production_snapshot->'physical_components' END) locked_part) ORDER BY ii.id FOR UPDATE;
 review:=public.assembly_product_status(p.id,p_quantity,p_item_id);
 IF (review->>'ready_to_assemble')::integer<p_quantity THEN RAISE EXCEPTION 'Faltam subitens disponíveis. Confira a quantidade necessária de cada peça e as reservas.'; END IF;
 INSERT INTO product_assemblies(tenant_id,product_id,item_id,quantity,finishing_cost,notes,created_by) VALUES(t,p.id,p_item_id,p_quantity,p_finishing_cost,p_notes,auth.uid()) RETURNING id INTO result;
 FOR c IN SELECT value FROM jsonb_array_elements(review->'components') LOOP
  need:=p_quantity*(c->>'quantity_per_product')::integer;
  INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,reference_type,reference_id,notes,created_by)
   VALUES(t,(c->>'stock_item_id')::uuid,'job_consumption',need,'assembly_component',result,'Montagem de '||p.name,auth.uid()) RETURNING id,inventory_movements.unit_cost INTO movement,unit_cost;
  INSERT INTO assembly_subitem_allocations(tenant_id,assembly_id,component_product_id,quantity,unit_cost,movement_id) VALUES(t,result,(c->>'component_product_id')::uuid,need,unit_cost,movement);
  total:=total+need*unit_cost;
  IF i.id IS NOT NULL THEN UPDATE production_subitem_demands SET consumed=consumed+need WHERE item_id=i.id AND component_product_id=(c->>'component_product_id')::uuid; END IF;
 END LOOP;
 UPDATE product_assemblies SET component_cost=total WHERE id=result;
 IF i.id IS NOT NULL THEN UPDATE production_order_items SET assembled_quantity=assembled_quantity+p_quantity WHERE id=i.id;
 ELSE
  stock:=p.stock_item_id;
  IF stock IS NULL THEN INSERT INTO inventory_items(tenant_id,name,unit,category,avg_cost,loss_coefficient) VALUES(t,p.name,'un','consumable',0,0) RETURNING id INTO stock; UPDATE products SET stock_item_id=stock WHERE id=p.id; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=stock AND tenant_id=t AND is_active AND unit='un') THEN RAISE EXCEPTION 'O estoque do produto final deve estar ativo em unidades (un).'; END IF;
  INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
   VALUES(t,stock,'purchase_in',p_quantity,(total+p_finishing_cost)/p_quantity,'assembly',result,'Entrada de produto montado a partir de subitens',auth.uid());
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'assembly','product_assemblies',result,jsonb_build_object('quantity',p_quantity,'component_cost',total,'finishing_cost',p_finishing_cost,'individual_stock',true));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

-- Technical parts are still regular editable products; direct writes must not
-- turn off assembly accidentally or substitute another tenant's inventory.
CREATE FUNCTION public.erp_guard_subitem_flags() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.component_inventory_mode AND NOT NEW.assembly_enabled AND EXISTS(SELECT 1 FROM public.product_subitems WHERE product_id=NEW.id) THEN RAISE EXCEPTION 'Este produto tem subitens: mantenha a montagem ativa ou retire os vínculos da composição.'; END IF;
 IF current_user IN('authenticated','anon','service_role') AND ((TG_OP='INSERT' AND (NEW.component_inventory_mode OR NEW.is_component)) OR
  (TG_OP='UPDATE' AND (NEW.component_inventory_mode,NEW.is_component) IS DISTINCT FROM (OLD.component_inventory_mode,OLD.is_component))) THEN RAISE EXCEPTION 'Configure os subitens pela composição do produto.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_subitem_flags BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION erp_guard_subitem_flags();
REVOKE ALL ON FUNCTION erp_private.assert_subitem_mode(uuid,uuid),erp_private.sync_imported_subitems(uuid,uuid),erp_private.subitem_available(uuid,uuid,uuid,boolean),erp_private.product_bom_snapshot(uuid,uuid),public.erp_guard_subitem_flags() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_product_subitem(uuid,uuid,jsonb,uuid),public.remove_product_subitem(uuid),public.move_subitem_stock(uuid,integer,text,numeric,text,uuid),public.save_product_with_photos(uuid,jsonb,jsonb,uuid),public.assembly_product_status(uuid,integer,uuid),public.assemble_product(uuid,integer,uuid,numeric,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_subitem(uuid,uuid,jsonb,uuid),public.remove_product_subitem(uuid),public.move_subitem_stock(uuid,integer,text,numeric,text,uuid),public.save_product_with_photos(uuid,jsonb,jsonb,uuid),public.assembly_product_status(uuid,integer,uuid),public.assemble_product(uuid,integer,uuid,numeric,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
