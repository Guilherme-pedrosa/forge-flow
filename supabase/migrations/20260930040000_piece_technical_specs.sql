-- A technical sheet belongs to the physical catalogue item, across all its BOMs.
-- Unknown quantities stay NULL. Technical estimates never change stock valuation.
CREATE TABLE public.product_piece_specs (
 product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 spec jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE product_piece_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY piece_specs_read ON product_piece_specs FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
REVOKE INSERT,UPDATE,DELETE ON product_piece_specs FROM authenticated,anon;

CREATE FUNCTION erp_private.write_piece_spec(p_product uuid,p_tenant uuid,p_data jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE k text; n numeric; line jsonb; item inventory_items; current_revision text;
BEGIN
 PERFORM 1 FROM products WHERE id=p_product AND tenant_id=p_tenant AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Peça não encontrada ou arquivada.'; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Ficha técnica inválida.'; END IF;
 SELECT updated_at::text INTO current_revision FROM product_piece_specs WHERE product_id=p_product;
 IF p_data ? 'revision' AND p_data->>'revision' IS DISTINCT FROM current_revision THEN
  RAISE EXCEPTION 'A ficha foi alterada em outra tela. Reabra para conferir os dados atuais.';
 END IF;
 FOR k IN SELECT jsonb_object_keys(p_data) LOOP
  IF k<>ALL(ARRAY['materials','print_seconds','finishing_seconds','machine_hour_cost','labor_hour_cost','extra_cost','pieces_per_plate','notes','revision']) THEN RAISE EXCEPTION 'Campo técnico inválido: %',k; END IF;
 END LOOP;
 FOR k IN SELECT unnest(ARRAY['print_seconds','finishing_seconds','machine_hour_cost','labor_hour_cost','extra_cost','pieces_per_plate']) LOOP
  n:=(p_data->>k)::numeric;
  IF n IS NOT NULL AND (NOT erp_private.valid_number(n) OR n>100000000) THEN RAISE EXCEPTION 'Informe valores técnicos não negativos e finitos.'; END IF;
  IF k='pieces_per_plate' AND n IS NOT NULL AND (n<>trunc(n) OR n NOT BETWEEN 1 AND 10000) THEN RAISE EXCEPTION 'Informe de 1 a 10000 peças por placa.'; END IF;
 END LOOP;
 IF jsonb_typeof(p_data->'materials') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'materials')>16 THEN RAISE EXCEPTION 'Informe até 16 filamentos.'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_data->'materials') LOOP
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Filamento inválido.'; END IF;
  FOR k IN SELECT jsonb_object_keys(line) LOOP
   IF k<>ALL(ARRAY['item_id','material','color','grams','cost_per_kg']) THEN RAISE EXCEPTION 'Campo de filamento inválido: %',k; END IF;
  END LOOP;
  FOR k IN SELECT unnest(ARRAY['grams','cost_per_kg']) LOOP
   n:=(line->>k)::numeric;
   IF n IS NOT NULL AND (NOT erp_private.valid_number(n) OR n>1000000) THEN RAISE EXCEPTION 'Peso e custo do filamento devem ser não negativos e finitos.'; END IF;
  END LOOP;
  IF length(coalesce(line->>'material',''))>120 OR length(coalesce(line->>'color',''))>120 THEN RAISE EXCEPTION 'Material ou cor muito longo.'; END IF;
  IF line->>'item_id' IS NOT NULL THEN
   SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=p_tenant AND is_active AND unit IN('g','kg');
   IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um filamento ativo desta empresa, em g ou kg.'; END IF;
  END IF;
 END LOOP;
 IF length(coalesce(p_data->>'notes',''))>3000 THEN RAISE EXCEPTION 'Limite as observações a 3000 caracteres.'; END IF;
 INSERT INTO product_piece_specs(product_id,tenant_id,spec) VALUES(p_product,p_tenant,p_data-'revision')
 ON CONFLICT(product_id) DO UPDATE SET spec=excluded.spec,updated_at=clock_timestamp();
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
 VALUES(p_tenant,auth.uid(),'save_piece_spec','product_piece_specs',p_product,p_data-'revision');
END $$;

CREATE FUNCTION public.save_product_piece_spec(p_product_id uuid,p_data jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'piece_spec',jsonb_build_array(p_product_id,p_data));
 IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM erp_private.write_piece_spec(p_product_id,t,p_data);
 PERFORM erp_private.finish_request(t,p_request_id,p_product_id); RETURN p_product_id;
END $$;

-- A single known part on a mapped plate can inherit plate totals / physical yield.
-- Mixed plates, unknown objects and shared parts with ambiguous profiles cannot.
CREATE FUNCTION erp_private.read_piece_spec(p_product uuid,p_tenant uuid,p_subitem uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE data jsonb; revision text; source text:='manual'; b product_subitems; plate product_print_plates;
 recipe jsonb; line jsonb; material inventory_items; lines jsonb:='[]'; cost numeric; g numeric:=0; material_cost numeric:=0;
 grams_known boolean:=true; cost_known boolean:=true; total numeric; plate_info jsonb; count_b integer;
BEGIN
 SELECT spec,updated_at::text INTO data,revision FROM product_piece_specs WHERE product_id=p_product AND tenant_id=p_tenant;
 IF p_subitem IS NOT NULL THEN
  SELECT * INTO b FROM product_subitems WHERE id=p_subitem AND component_product_id=p_product AND tenant_id=p_tenant;
 ELSE
  SELECT count(*) INTO count_b FROM product_subitems WHERE component_product_id=p_product AND tenant_id=p_tenant;
  IF count_b=1 THEN SELECT * INTO b FROM product_subitems WHERE component_product_id=p_product AND tenant_id=p_tenant; END IF;
 END IF;
 SELECT * INTO plate FROM product_print_plates WHERE id=b.plate_id AND tenant_id=p_tenant AND is_active;
 IF plate.id IS NOT NULL THEN
  plate_info:=jsonb_build_object('id',plate.id,'label',plate.label,'grams',plate.est_grams,'seconds',plate.est_time_seconds,'pieces',b.quantity_per_plate);
 END IF;
 IF data IS NULL AND plate.id IS NOT NULL AND b.quantity_per_plate IS NOT NULL
 AND (SELECT count(*) FROM product_subitems WHERE plate_id=plate.id)=1
 AND NOT EXISTS(SELECT 1 FROM product_print_plate_parts part WHERE part.plate_id=plate.id AND NOT EXISTS(SELECT 1 FROM product_subitems sub WHERE sub.source_part_id=part.id)) THEN
  source:='plate'; recipe:=erp_private.product_material_recipe_snapshot(b.product_id,p_tenant,plate.id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',x->>'item_id','grams',(x->>'grams_per_print')::numeric/b.quantity_per_plate,'material',x->>'name','color',x->>'color','cost_per_kg',NULL)),'[]')
   INTO lines FROM jsonb_array_elements(coalesce(recipe->'lines','[]')) x;
  IF jsonb_array_length(lines)=0 THEN lines:=jsonb_build_array(jsonb_build_object('item_id',plate.material_id,'grams',plate.est_grams/b.quantity_per_plate,'material',NULL,'color',NULL,'cost_per_kg',NULL)); END IF;
  data:=jsonb_build_object('materials',lines,'print_seconds',plate.est_time_seconds/b.quantity_per_plate,'pieces_per_plate',b.quantity_per_plate,
   'finishing_seconds',NULL,'machine_hour_cost',NULL,'labor_hour_cost',NULL,'extra_cost',NULL,'notes','Estimativa por peça: total da placa dividido pelo rendimento confirmado. Inclui o rateio de suportes e purga presentes no total.');
 END IF;
 IF data IS NULL THEN RETURN jsonb_build_object('source','unknown','revision',NULL,'materials','[]'::jsonb,'grams',NULL,'print_seconds',NULL,'estimated_cost',NULL,'plate',plate_info); END IF;
 lines:='[]';
 IF jsonb_array_length(data->'materials')=0 THEN grams_known:=false; cost_known:=false; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(data->'materials') LOOP
  SELECT * INTO material FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=p_tenant;
  cost:=coalesce((line->>'cost_per_kg')::numeric,CASE WHEN material.avg_cost>0 THEN material.avg_cost*CASE WHEN material.unit='g' THEN 1000 ELSE 1 END END);
  IF line->>'grams' IS NULL THEN grams_known:=false; END IF;
  IF line->>'grams' IS NULL OR cost IS NULL THEN cost_known:=false; END IF;
  g:=g+coalesce((line->>'grams')::numeric,0);
  material_cost:=material_cost+coalesce((line->>'grams')::numeric*cost/1000,0);
  lines:=lines||jsonb_build_array(line||jsonb_build_object('material',coalesce(nullif(line->>'material',''),material.material_code,material.name),
   'color',coalesce(nullif(line->>'color',''),material.color),'resolved_cost_per_kg',cost));
 END LOOP;
 total:=CASE WHEN cost_known THEN material_cost+(data->>'print_seconds')::numeric*(data->>'machine_hour_cost')::numeric/3600
  +(data->>'finishing_seconds')::numeric*(data->>'labor_hour_cost')::numeric/3600+(data->>'extra_cost')::numeric END;
 RETURN data||jsonb_build_object('source',source,'revision',revision,'materials',lines,'grams',CASE WHEN grams_known THEN g END,
  'material_cost',CASE WHEN cost_known THEN material_cost END,'estimated_cost',total,'plate',plate_info);
END $$;

CREATE FUNCTION public.product_piece_spec(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id();
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t) THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF;
 RETURN erp_private.read_piece_spec(p_product_id,t);
END $$;

ALTER FUNCTION public.save_product_subitem(uuid,uuid,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_subitem(uuid,uuid,jsonb,uuid) RENAME TO save_subitem_before_technical;
REVOKE ALL ON FUNCTION erp_private.save_subitem_before_technical(uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_subitem(p_product_id uuid,p_subitem_id uuid,p_data jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; child uuid;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'save_subitem',jsonb_build_array(p_product_id,p_subitem_id,p_data));
 IF result IS NOT NULL THEN RETURN result; END IF;
 result:=erp_private.save_subitem_before_technical(p_product_id,p_subitem_id,p_data,p_request_id);
 SELECT component_product_id INTO child FROM product_subitems WHERE id=result AND tenant_id=t;
 UPDATE products SET is_component=true WHERE id=child AND NOT is_component;
 IF p_data ? 'technical' THEN
  PERFORM erp_private.write_piece_spec(child,t,p_data->'technical');
 END IF;
 RETURN result;
END $$;

ALTER FUNCTION erp_private.product_bom_snapshot(uuid,uuid) RENAME TO product_bom_before_technical;
CREATE FUNCTION erp_private.product_bom_snapshot(p_product_id uuid,p_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; parts jsonb;
BEGIN
 result:=erp_private.product_bom_before_technical(p_product_id,p_tenant_id);
 IF result->>'individual_stock' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 SELECT coalesce(jsonb_agg(c||jsonb_build_object('technical',erp_private.read_piece_spec((c->>'component_product_id')::uuid,p_tenant_id,(c->>'id')::uuid)) ORDER BY ord),'[]')
 INTO parts FROM jsonb_array_elements(result->'physical_components') WITH ORDINALITY x(c,ord);
 RETURN result||jsonb_build_object('physical_components',parts);
END $$;

REVOKE ALL ON FUNCTION erp_private.write_piece_spec(uuid,uuid,jsonb),erp_private.read_piece_spec(uuid,uuid,uuid),erp_private.product_bom_before_technical(uuid,uuid),erp_private.product_bom_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_product_piece_spec(uuid,jsonb,uuid),public.product_piece_spec(uuid),public.save_product_subitem(uuid,uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_piece_spec(uuid,jsonb,uuid),public.product_piece_spec(uuid),public.save_product_subitem(uuid,uuid,jsonb,uuid) TO authenticated;
UPDATE products p SET is_component=true WHERE NOT p.is_component AND EXISTS(SELECT 1 FROM product_subitems b WHERE b.component_product_id=p.id AND b.tenant_id=p.tenant_id);
NOTIFY pgrst,'reload schema';
