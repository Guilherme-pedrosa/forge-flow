-- Explicit material identity and versioned, exact-item recipes. Existing items
-- are never classified by names, suppliers or purchase descriptions. Exact
-- structured material/color fields can be migrated with their original audit.
CREATE TABLE public.material_code_catalog(code text PRIMARY KEY,label text NOT NULL);
INSERT INTO material_code_catalog(code,label) VALUES
  ('PLA','PLA'),('PLA+','PLA+'),('PLA-SILK','PLA Silk'),('PLA-CF','PLA com fibra de carbono'),
  ('PETG','PETG'),('PETG-CF','PETG com fibra de carbono'),('ABS','ABS'),('ASA','ASA'),
  ('TPU','TPU'),('PA','Nylon / PA'),('PA-CF','Nylon / PA com fibra de carbono'),
  ('PC','Policarbonato / PC'),('PVA','PVA'),('HIPS','HIPS'),('RESIN','Resina'),('OTHER','Outro material especificado');
REVOKE ALL ON material_code_catalog FROM PUBLIC,anon,authenticated;
GRANT SELECT ON material_code_catalog TO authenticated;
ALTER TABLE inventory_items ADD COLUMN material_code text REFERENCES material_code_catalog(code),
  ADD COLUMN material_description text,ADD COLUMN color_code text,ADD COLUMN color_hex text,
  ADD COLUMN material_identified_at timestamptz,ADD COLUMN material_identified_by uuid REFERENCES auth.users(id);

-- Preserve existing explicit structured identity only. OTHER, marketing names,
-- unnamed/invalid colors and parent/name guesses deliberately remain pending.
WITH candidates AS MATERIALIZED (
  SELECT i.id,i.tenant_id,i.material_type AS original_material_type,i.color AS original_color,
    c.code,upper(btrim(i.color)) AS stable_color
  FROM inventory_items i JOIN material_code_catalog c ON c.code=upper(btrim(i.material_type))
  WHERE c.code<>'OTHER' AND i.material_code IS NULL AND nullif(btrim(i.color),'') IS NOT NULL
    AND length(upper(btrim(i.color)))<=64 AND upper(btrim(i.color)) ~ '^[A-Z0-9#][A-Z0-9#_. /+\-]*$'
), migrated AS (
  UPDATE inventory_items i SET material_code=c.code,color=btrim(c.original_color),color_code=c.stable_color,
    material_identified_at=now(),material_identified_by=NULL
  FROM candidates c WHERE i.id=c.id AND i.tenant_id=c.tenant_id
  RETURNING i.id,i.tenant_id,i.material_code,i.color_code,c.original_material_type,c.original_color
)
INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
SELECT tenant_id,NULL,'material_identity_migration','inventory_items',id,
  jsonb_build_object('migration','20260913035000_product_material_recipe','source','existing_structured_fields',
    'original_material_type',original_material_type,'original_color',original_color,
    'material_code',material_code,'color_code',color_code,'color_hex',NULL)
FROM migrated;

CREATE TABLE public.product_material_recipe_versions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id),plate_id uuid REFERENCES product_print_plates(id),
  version integer NOT NULL CHECK(version>0),basis text NOT NULL CHECK(basis IN('per_unit','per_print')),
  units_per_print integer NOT NULL CHECK(units_per_print BETWEEN 1 AND 10000),
  notes text,non_material_cost_per_unit numeric,is_current boolean NOT NULL DEFAULT true,created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_recipe_current_product ON product_material_recipe_versions(tenant_id,product_id) WHERE is_current AND plate_id IS NULL;
CREATE UNIQUE INDEX product_recipe_current_plate ON product_material_recipe_versions(tenant_id,plate_id) WHERE is_current AND plate_id IS NOT NULL;
CREATE UNIQUE INDEX product_recipe_version_identity ON product_material_recipe_versions(tenant_id,product_id,coalesce(plate_id,'00000000-0000-0000-0000-000000000000'::uuid),version);
CREATE TABLE public.product_material_recipe_lines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
  recipe_version_id uuid NOT NULL REFERENCES product_material_recipe_versions(id),
  item_id uuid NOT NULL REFERENCES inventory_items(id),grams numeric NOT NULL CHECK(grams>0),
  item_snapshot jsonb NOT NULL,UNIQUE(recipe_version_id,item_id)
);
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['product_material_recipe_versions','product_material_recipe_lines'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
    EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=public.get_user_tenant_id())',tbl);
    EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_check_tenant_references()',tbl);
  END LOOP;
END $$;

CREATE FUNCTION public.erp_material_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE material_label text;
BEGIN
  NEW.material_code:=nullif(upper(btrim(NEW.material_code)),'');
  NEW.material_description:=nullif(btrim(NEW.material_description),'');
  NEW.color_code:=nullif(upper(btrim(NEW.color_code)),'');
  NEW.color_hex:=nullif(upper(btrim(NEW.color_hex)),'');
  NEW.color:=nullif(btrim(NEW.color),'');
  IF NEW.material_code IS NOT NULL THEN
    SELECT label INTO material_label FROM material_code_catalog WHERE code=NEW.material_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um material do catálogo.'; END IF;
    IF NEW.material_code='OTHER' AND NEW.material_description IS NULL THEN RAISE EXCEPTION 'Descreva a composição/variante do material Outro.'; END IF;
    NEW.material_type:=CASE WHEN NEW.material_code='OTHER' THEN NEW.material_description ELSE material_label END;
  END IF;
  IF NEW.color_code IS NOT NULL AND (length(NEW.color_code)>64 OR NEW.color_code !~ '^[A-Z0-9#][A-Z0-9#_. /+\-]*$') THEN RAISE EXCEPTION 'Código de cor inválido. Use um código estável com letras e números.'; END IF;
  IF NEW.color_hex IS NOT NULL AND NEW.color_hex !~ '^#[0-9A-F]{6}$' THEN RAISE EXCEPTION 'Informe a cor visual no formato #RRGGBB.'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.material_code,NEW.material_description,NEW.color_code,lower(NEW.color),NEW.color_hex,NEW.unit)
      IS DISTINCT FROM (OLD.material_code,OLD.material_description,OLD.color_code,lower(OLD.color),OLD.color_hex,OLD.unit)
      AND EXISTS(SELECT 1 FROM product_material_recipe_lines l JOIN product_material_recipe_versions v ON v.id=l.recipe_version_id
        WHERE l.item_id=OLD.id AND v.tenant_id=OLD.tenant_id) THEN
      RAISE EXCEPTION 'Este material/cor está no histórico de uma composição. Cadastre outro item para trocar a matéria-prima e publique uma nova composição.';
    END IF;
    NEW.material_identified_at:=OLD.material_identified_at;NEW.material_identified_by:=OLD.material_identified_by;
  ELSE NEW.material_identified_at:=NULL;NEW.material_identified_by:=NULL; END IF;
  IF NEW.material_code IS NOT NULL AND NEW.color_code IS NOT NULL AND NEW.color IS NOT NULL THEN
    IF NEW.material_identified_at IS NULL THEN NEW.material_identified_at:=now();NEW.material_identified_by:=auth.uid(); END IF;
  ELSE NEW.material_identified_at:=NULL;NEW.material_identified_by:=NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_material_identity BEFORE INSERT OR UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION public.erp_material_identity();
REVOKE ALL ON FUNCTION public.erp_material_identity() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_product_material_recipe(p_product_id uuid,p_plate_id uuid,p_basis text,p_lines jsonb,p_notes text,p_request_id uuid,p_non_material_cost_per_unit numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; result uuid:=gen_random_uuid(); product products; plate product_print_plates;
  item inventory_items; line jsonb; seen uuid[]:='{}'; next_version integer; units integer; grams numeric; key text;
BEGIN
  prior:=erp_private.begin_request(t,p_request_id,'product_material_recipe',jsonb_build_array(p_product_id,p_plate_id,p_basis,p_lines,p_notes,p_non_material_cost_per_unit));
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
  SELECT * INTO product FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um produto ativo da sua empresa.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(product.extras,'[]')) x WHERE x ? '_kit_product_id') THEN RAISE EXCEPTION 'Cadastre a matéria-prima nos componentes físicos do kit.'; END IF;
  IF p_plate_id IS NOT NULL THEN
    SELECT * INTO plate FROM product_print_plates WHERE id=p_plate_id AND product_id=product.id AND tenant_id=t AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selecione uma placa ativa deste produto.'; END IF;
    units:=plate.units_per_plate;
  ELSE
    IF EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=product.id AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Este produto possui placas. Cadastre uma composição para cada placa.'; END IF;
    units:=greatest(coalesce(product.prints_per_plate,1),1);
  END IF;
  IF p_basis IS NULL OR p_basis NOT IN('per_unit','per_print') THEN RAISE EXCEPTION 'Informe se os gramas são por unidade do produto ou por impressão completa.'; END IF;
  IF p_non_material_cost_per_unit IS NOT NULL AND (NOT erp_private.valid_number(p_non_material_cost_per_unit) OR p_non_material_cost_per_unit>1000000000) THEN RAISE EXCEPTION 'Informe demais custos por unidade válidos, inclusive zero quando confirmado.'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'Informe de 1 a 64 materiais na composição.'; END IF;
  PERFORM 1 FROM inventory_items WHERE tenant_id=t AND id IN(SELECT (x->>'item_id')::uuid FROM jsonb_array_elements(p_lines) x) ORDER BY id FOR UPDATE;
  SELECT coalesce(max(version),0)+1 INTO next_version FROM product_material_recipe_versions WHERE tenant_id=t AND product_id=product.id AND plate_id IS NOT DISTINCT FROM p_plate_id;
  UPDATE product_material_recipe_versions SET is_current=false WHERE tenant_id=t AND product_id=product.id AND plate_id IS NOT DISTINCT FROM p_plate_id AND is_current;
  INSERT INTO product_material_recipe_versions(id,tenant_id,product_id,plate_id,version,basis,units_per_print,notes,non_material_cost_per_unit,created_by)
    VALUES(result,t,product.id,p_plate_id,next_version,p_basis,units,nullif(btrim(p_notes),''),p_non_material_cost_per_unit,auth.uid());
  FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Material da composição inválido.'; END IF;
    FOR key IN SELECT jsonb_object_keys(line) LOOP IF key NOT IN('item_id','grams') THEN RAISE EXCEPTION 'Campo não permitido na composição: %',key; END IF; END LOOP;
    SELECT * INTO item FROM inventory_items WHERE id=(line->>'item_id')::uuid AND tenant_id=t AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selecione um item ativo de estoque da sua empresa.'; END IF;
    IF item.id=ANY(seen) THEN RAISE EXCEPTION 'O mesmo item aparece mais de uma vez. Some seus gramas em uma única linha.'; END IF;
    IF lower(btrim(item.unit)) NOT IN('g','kg') THEN RAISE EXCEPTION 'Composição em gramas exige estoque em g ou kg. Não converta volume/unidade sem informação técnica.'; END IF;
    IF item.material_code IS NULL OR item.color IS NULL OR item.color_code IS NULL OR item.material_identified_at IS NULL THEN RAISE EXCEPTION 'Identifique material e código da cor no estoque antes de usar a composição: %.',item.name; END IF;
    IF jsonb_typeof(line->'grams') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Informe os gramas como um número positivo.'; END IF;
    grams:=(line->>'grams')::numeric;
    IF NOT erp_private.valid_number(grams,0.001) OR grams>10000000 THEN RAISE EXCEPTION 'Gramas inválidos na composição.'; END IF;
    INSERT INTO product_material_recipe_lines(tenant_id,recipe_version_id,item_id,grams,item_snapshot)
      VALUES(t,result,item.id,grams,jsonb_build_object('item_id',item.id,'name',item.name,'unit',item.unit,'material_code',item.material_code,
        'material_type',item.material_type,'material_description',item.material_description,'color',item.color,'color_code',item.color_code,'color_hex',item.color_hex,'unit_cost',item.avg_cost));
    seen:=array_append(seen,item.id);
  END LOOP;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
    VALUES(t,auth.uid(),'material_recipe_version','products',product.id,jsonb_build_object('version_id',result,'version',next_version,'plate_id',p_plate_id,'basis',p_basis,'units_per_print',units,'lines',p_lines,'non_material_cost_per_unit',p_non_material_cost_per_unit));
  PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_material_recipe(uuid,uuid,text,jsonb,text,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_material_recipe(uuid,uuid,text,jsonb,text,uuid,numeric) TO authenticated;

CREATE VIEW public.product_material_requirements WITH(security_invoker=true) AS
SELECT v.tenant_id,v.product_id,v.plate_id,v.id AS recipe_version_id,v.version AS recipe_version,v.basis,v.units_per_print,v.non_material_cost_per_unit,
  l.id AS line_id,l.item_id,l.grams,i.name,i.material_type,i.material_code,i.material_description,i.color,i.color_code,i.color_hex,i.unit,
  CASE v.basis WHEN 'per_unit' THEN l.grams ELSE l.grams/v.units_per_print END AS grams_per_unit,
  CASE v.basis WHEN 'per_print' THEN l.grams ELSE l.grams*v.units_per_print END AS grams_per_print,
  i.avg_cost AS unit_cost,i.current_stock,
  i.is_active AND i.material_code IS NOT NULL AND i.color IS NOT NULL AND i.color_code IS NOT NULL AND i.material_identified_at IS NOT NULL
    AND lower(btrim(i.unit)) IN('g','kg') AS material_ready,
  i.avg_cost>0 OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.item_id=i.id AND m.tenant_id=i.tenant_id) AS cost_known,
  (CASE v.basis WHEN 'per_unit' THEN l.grams ELSE l.grams/v.units_per_print END)/CASE lower(btrim(i.unit)) WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 END*i.avg_cost AS cost_per_unit,
  (CASE v.basis WHEN 'per_print' THEN l.grams ELSE l.grams*v.units_per_print END)/CASE lower(btrim(i.unit)) WHEN 'g' THEN 1 WHEN 'kg' THEN 1000 END*i.avg_cost AS cost_per_print
FROM product_material_recipe_versions v JOIN product_material_recipe_lines l ON l.recipe_version_id=v.id AND l.tenant_id=v.tenant_id
  JOIN inventory_items i ON i.id=l.item_id AND i.tenant_id=v.tenant_id WHERE v.is_current;
REVOKE ALL ON product_material_requirements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON product_material_requirements TO authenticated;

CREATE FUNCTION erp_private.product_material_recipe_snapshot(p_product_id uuid,p_tenant_id uuid,p_plate_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE recipe product_material_recipe_versions; req record; lines jsonb:='[]'; missing jsonb:='[]';
  expected_units integer; material_cost numeric:=0; known_lines integer:=0; total_cost numeric;
BEGIN
  SELECT * INTO recipe FROM product_material_recipe_versions WHERE product_id=p_product_id AND tenant_id=p_tenant_id
    AND plate_id IS NOT DISTINCT FROM p_plate_id AND is_current;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_plate_id IS NULL THEN SELECT greatest(coalesce(prints_per_plate,1),1) INTO expected_units FROM products WHERE id=p_product_id AND tenant_id=p_tenant_id;
  ELSE SELECT units_per_plate INTO expected_units FROM product_print_plates WHERE id=p_plate_id AND product_id=p_product_id AND tenant_id=p_tenant_id AND is_active; END IF;
  IF recipe.units_per_print IS DISTINCT FROM expected_units THEN missing:=missing||jsonb_build_array('Capacidade por impressão mudou; publique uma nova versão da composição.'); END IF;
  FOR req IN SELECT * FROM product_material_requirements WHERE recipe_version_id=recipe.id AND tenant_id=p_tenant_id ORDER BY item_id LOOP
    IF NOT coalesce(req.material_ready,false) THEN missing:=missing||jsonb_build_array('Material/cor inativo, não identificado ou unidade incompatível: '||req.name); END IF;
    IF NOT coalesce(req.cost_known,false) THEN missing:=missing||jsonb_build_array('Custo médio ainda não confirmado por entrada de estoque: '||req.name);
    ELSE material_cost:=material_cost+req.cost_per_unit;known_lines:=known_lines+1; END IF;
    lines:=lines||jsonb_build_array(jsonb_build_object('item_id',req.item_id,'name',req.name,'unit',req.unit,
      'material_type',req.material_type,'material_code',req.material_code,'material_description',req.material_description,
      'color',req.color,'color_code',req.color_code,'color_hex',req.color_hex,'grams',req.grams,
      'grams_per_unit',req.grams_per_unit,'grams_per_print',req.grams_per_print,'unit_cost',CASE WHEN req.cost_known THEN req.unit_cost END,
      'cost_per_unit',CASE WHEN req.cost_known THEN req.cost_per_unit END,'cost_per_print',CASE WHEN req.cost_known THEN req.cost_per_print END,
      'material_ready',req.material_ready,'cost_known',req.cost_known));
  END LOOP;
  IF jsonb_array_length(lines)=0 THEN missing:=missing||jsonb_build_array('A composição não possui materiais.'); END IF;
  IF recipe.non_material_cost_per_unit IS NULL THEN missing:=missing||jsonb_build_array('Confirme demais custos por unidade, inclusive zero quando não houver.'); END IF;
  IF jsonb_array_length(missing)=0 THEN total_cost:=material_cost+recipe.non_material_cost_per_unit; END IF;
  RETURN jsonb_build_object('version_id',recipe.id,'version',recipe.version,'basis',recipe.basis,'units_per_print',recipe.units_per_print,
    'created_at',recipe.created_at,'created_by',recipe.created_by,'notes',recipe.notes,'lines',lines,
    'non_material_cost_per_unit',recipe.non_material_cost_per_unit,'material_cost_per_unit',CASE WHEN known_lines>0 THEN material_cost END,
    'cost_per_unit',total_cost,'complete',jsonb_array_length(missing)=0,'missing',missing);
END $$;

CREATE FUNCTION erp_private.product_bom_snapshot_recursive(p_product_id uuid,p_tenant_id uuid,p_path uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE product products; plate product_print_plates; recipe jsonb; part jsonb; component jsonb; child jsonb; line jsonb;
  sources jsonb; plates jsonb:='[]'; components jsonb:='[]'; requirements jsonb:='[]'; missing jsonb:='[]';
  total_cost numeric:=0; material_cost numeric:=0; known_materials integer:=0; quantity numeric; kit_extras numeric:=0;
BEGIN
  IF p_product_id=ANY(p_path) OR cardinality(p_path)>=20 THEN RETURN jsonb_build_object('schema_version',1,'complete',false,'missing',jsonb_build_array('Composição de kit cíclica ou muito profunda.'),'cost_per_unit',NULL); END IF;
  SELECT * INTO product FROM products WHERE id=p_product_id AND tenant_id=p_tenant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('schema_version',1,'complete',false,'missing',jsonb_build_array('Produto não encontrado na empresa.'),'cost_per_unit',NULL); END IF;
  IF NOT product.is_active THEN missing:=missing||jsonb_build_array('Produto arquivado: '||product.name); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('storage_path',s.file_path) ORDER BY s.created_at,s.id),'[]') INTO sources
    FROM product_print_sources s WHERE s.product_id=product.id AND s.tenant_id=p_tenant_id AND s.is_active;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(product.extras,'[]')) x WHERE x ? '_kit_product_id') THEN
    FOR part IN SELECT value FROM jsonb_array_elements(product.extras) LOOP
      IF part ? '_kit_product_id' THEN
        quantity:=(part->>'_kit_qty')::numeric;
        IF NOT erp_private.valid_number(quantity,1) OR quantity<>trunc(quantity) THEN missing:=missing||jsonb_build_array('Quantidade de componente do kit inválida.');CONTINUE; END IF;
        child:=erp_private.product_bom_snapshot_recursive((part->>'_kit_product_id')::uuid,p_tenant_id,p_path||product.id);
        components:=components||jsonb_build_array(jsonb_build_object('product_id',(part->>'_kit_product_id')::uuid,'quantity',quantity,'snapshot',child));
        IF NOT coalesce((child->>'complete')::boolean,false) THEN missing:=missing||coalesce(child->'missing','[]'); END IF;
        total_cost:=total_cost+coalesce((child->>'cost_per_unit')::numeric,0)*quantity;
        IF child->>'material_cost_per_unit' IS NOT NULL THEN material_cost:=material_cost+(child->>'material_cost_per_unit')::numeric*quantity;known_materials:=known_materials+1; END IF;
        FOR line IN SELECT value FROM jsonb_array_elements(coalesce(child->'requirements','[]')) LOOP
          requirements:=requirements||jsonb_build_array(line||jsonb_build_object('component_quantity',coalesce((line->>'component_quantity')::numeric,1)*quantity,
            'grams_per_unit',(line->>'grams_per_unit')::numeric*quantity,'cost_per_unit',(line->>'cost_per_unit')::numeric*quantity));
        END LOOP;
      ELSE
        IF NOT erp_private.valid_number((part->>'cost')::numeric) THEN missing:=missing||jsonb_build_array('Custo adicional do kit não informado.');
        ELSE kit_extras:=kit_extras+(part->>'cost')::numeric; END IF;
      END IF;
    END LOOP;
    total_cost:=total_cost+kit_extras;
  ELSIF EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=product.id AND tenant_id=p_tenant_id AND is_active) THEN
    FOR plate IN SELECT * FROM product_print_plates WHERE product_id=product.id AND tenant_id=p_tenant_id AND is_active ORDER BY plate_index,id LOOP
      recipe:=erp_private.product_material_recipe_snapshot(product.id,p_tenant_id,plate.id);
      plates:=plates||jsonb_build_array(to_jsonb(plate)||jsonb_build_object('recipe',recipe));
      IF recipe IS NULL THEN missing:=missing||jsonb_build_array('Composição não cadastrada para a placa '||coalesce(nullif(plate.label,''),plate.plate_index::text)||'.');
      ELSE
        IF NOT (recipe->>'complete')::boolean THEN missing:=missing||(recipe->'missing'); END IF;
        total_cost:=total_cost+coalesce((recipe->>'cost_per_unit')::numeric,0);
        IF recipe->>'material_cost_per_unit' IS NOT NULL THEN material_cost:=material_cost+(recipe->>'material_cost_per_unit')::numeric;known_materials:=known_materials+1; END IF;
        FOR line IN SELECT value FROM jsonb_array_elements(recipe->'lines') LOOP requirements:=requirements||jsonb_build_array(line||jsonb_build_object('product_id',product.id,'plate_id',plate.id,'recipe_version_id',recipe->>'version_id')); END LOOP;
      END IF;
    END LOOP;
    recipe:=NULL;
  ELSE
    recipe:=erp_private.product_material_recipe_snapshot(product.id,p_tenant_id,NULL);
    IF recipe IS NULL THEN missing:=missing||jsonb_build_array('Composição de matéria-prima não cadastrada.');
    ELSE
      IF NOT (recipe->>'complete')::boolean THEN missing:=missing||(recipe->'missing'); END IF;
      total_cost:=coalesce((recipe->>'cost_per_unit')::numeric,0);
      IF recipe->>'material_cost_per_unit' IS NOT NULL THEN material_cost:=(recipe->>'material_cost_per_unit')::numeric;known_materials:=1; END IF;
      FOR line IN SELECT value FROM jsonb_array_elements(recipe->'lines') LOOP requirements:=requirements||jsonb_build_array(line||jsonb_build_object('product_id',product.id,'plate_id',NULL,'recipe_version_id',recipe->>'version_id')); END LOOP;
    END IF;
  END IF;
  RETURN jsonb_build_object('schema_version',1,'product',jsonb_build_object('id',product.id,'name',product.name,'sku',product.sku,'category',product.category,
    'prints_per_plate',product.prints_per_plate,'est_grams',product.est_grams,'est_time_minutes',product.est_time_minutes,'post_process_minutes',product.post_process_minutes,
    'cost_estimate',product.cost_estimate,'sale_price',product.sale_price,'extras',product.extras,'is_active',product.is_active,'material_id',product.material_id,'num_colors',product.num_colors),
    'sources',sources,'plates',plates,'recipe',recipe,'components',components,'requirements',requirements,
    'material_cost_per_unit',CASE WHEN known_materials>0 THEN material_cost END,'kit_extras_cost_per_unit',kit_extras,
    'cost_per_unit',CASE WHEN jsonb_array_length(missing)=0 THEN total_cost END,'complete',jsonb_array_length(missing)=0,'missing',missing);
END $$;
CREATE FUNCTION erp_private.product_bom_snapshot(p_product_id uuid,p_tenant_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT erp_private.product_bom_snapshot_recursive(p_product_id,p_tenant_id,'{}'::uuid[])
$$;
REVOKE ALL ON FUNCTION erp_private.product_material_recipe_snapshot(uuid,uuid,uuid),erp_private.product_bom_snapshot_recursive(uuid,uuid,uuid[]),erp_private.product_bom_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.product_material_recipe_preview(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR t IS NULL OR NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t) THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  RETURN erp_private.product_bom_snapshot(p_product_id,t);
END $$;
REVOKE ALL ON FUNCTION public.product_material_recipe_preview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_material_recipe_preview(uuid) TO authenticated;
