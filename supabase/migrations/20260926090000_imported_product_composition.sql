-- Parts live inside the manufactured product. Plate inventory remains in sets
-- needed by one finished product; individual meshes are not saleable SKUs.
CREATE TABLE public.product_print_plate_parts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 plate_id uuid NOT NULL REFERENCES product_print_plates(id) ON DELETE CASCADE,
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 200),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 photo_url text,
 quantity_per_product integer CHECK(quantity_per_product BETWEEN 1 AND 10000),
 quantity_per_plate integer CHECK(quantity_per_plate BETWEEN 1 AND 10000),
 name_source text NOT NULL CHECK(name_source IN('source','file','manual','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plate_id,source_key)
);
ALTER TABLE public.product_print_plate_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_print_plate_parts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.product_print_plate_parts TO authenticated;
CREATE POLICY tenant_read ON public.product_print_plate_parts FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE INDEX product_parts_parent ON public.product_print_plate_parts(tenant_id,product_id);

DO $$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.persist_source_plate_import(uuid,jsonb,uuid)'::regprocedure);
 IF strpos(def,'imported_plate_metadata=metadata,')=0 THEN RAISE EXCEPTION 'Review the plate import metadata contract.'; END IF;
 EXECUTE replace(def,'imported_plate_metadata=metadata,','imported_plate_metadata=coalesce(imported_plate_metadata,''{}''::jsonb)||metadata,');
END $$;

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_composition_import;
REVOKE ALL ON FUNCTION erp_private.save_product_before_composition_import(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; reference jsonb; composition jsonb; profile jsonb; variant jsonb;
 pl jsonb; part jsonb; stored product_print_plates; indices integer[]:='{}'; keys text[]; idx integer; units integer; component_label text; pic text;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF result IS NOT NULL THEN RETURN result; END IF;
 result:=erp_private.save_product_before_composition_import(p_product_id,p_product,p_photos,p_request_id);
 composition:=nullif(p_product->'import_composition','null'::jsonb);
 IF composition IS NULL THEN RETURN result; END IF;
 reference:=p_product->'external_import';
 IF jsonb_typeof(composition) IS DISTINCT FROM 'object' OR jsonb_typeof(composition->'enabled') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(composition->'plates') IS DISTINCT FROM 'array' OR jsonb_array_length(composition->'plates') NOT BETWEEN 1 AND 100
 OR reference IS NULL OR composition->>'profile_id' IS DISTINCT FROM reference->>'selected_variant_profile_id' THEN
  RAISE EXCEPTION 'A composição deve corresponder ao perfil de impressão selecionado.';
 END IF;
 SELECT value INTO profile FROM jsonb_array_elements(reference->'profiles') WHERE value->>'instance_id'=reference->>'selected_profile_id';
 SELECT v INTO variant FROM(SELECT profile v UNION ALL SELECT value FROM jsonb_array_elements(coalesce(profile->'variants','[]'))) variants
 WHERE v->>'profile_id'=composition->>'profile_id' LIMIT 1;
 IF variant IS NULL OR jsonb_array_length(variant->'plate_details')<>jsonb_array_length(composition->'plates') THEN RAISE EXCEPTION 'Revise as placas desta composição.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 FOR pl IN SELECT value FROM jsonb_array_elements(composition->'plates') LOOP
  IF coalesce(pl->>'index','') !~ '^[1-9][0-9]{0,4}$' THEN RAISE EXCEPTION 'Índice de placa inválido.'; END IF;
  idx:=(pl->>'index')::integer;
  IF idx=ANY(indices) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(variant->'plate_details') p WHERE (p->>'index')::integer=idx) THEN RAISE EXCEPTION 'Placa repetida ou de outro perfil.'; END IF;
  indices:=array_append(indices,idx);
  SELECT p.* INTO stored FROM product_print_plates p JOIN product_print_sources s ON s.id=p.source_id
   WHERE p.tenant_id=t AND p.product_id=result AND p.is_active AND s.design_id=reference->>'design_id'
   AND p.plate_index=idx AND p.imported_plate_metadata->>'profile_id'=composition->>'profile_id';
  IF stored.id IS NULL THEN RAISE EXCEPTION 'A placa % não foi vinculada a este produto.',idx; END IF;
  component_label:=nullif(btrim(pl->>'label'),'');
  IF component_label IS NULL OR length(component_label)>200 THEN RAISE EXCEPTION 'Informe o nome do conjunto com até 200 caracteres.'; END IF;
  IF pl->>'units_per_plate' IS NOT NULL AND pl->>'units_per_plate' !~ '^[1-9][0-9]{0,4}$' THEN RAISE EXCEPTION 'Rendimento inválido.'; END IF;
  units:=coalesce(stored.units_per_plate,(pl->>'units_per_plate')::integer);
  IF units NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Rendimento inválido.'; END IF;
  -- Refresh never overwrites a label or yield edited after the previous import.
  IF stored.imported_plate_metadata->>'composition_label' IS NOT NULL AND stored.label IS DISTINCT FROM stored.imported_plate_metadata->>'composition_label' THEN component_label:=stored.label;
  ELSIF stored.imported_plate_metadata->>'composition_label' IS NULL AND stored.label NOT IN('Placa '||idx,coalesce(stored.imported_plate_metadata->'plate'->>'name','Placa '||idx)) THEN component_label:=stored.label; END IF;
  IF stored.label IS DISTINCT FROM component_label OR stored.units_per_plate IS DISTINCT FROM units THEN
   PERFORM public.save_product_print_plate(stored.id,result,stored.source_id,jsonb_build_object('plate_index',idx,'label',component_label,'units_per_plate',units,
    'material_id',stored.material_id,'printer_id',stored.printer_id,'est_grams',stored.est_grams,'est_time_seconds',stored.est_time_seconds,'est_cost_per_unit',stored.est_cost_per_unit));
  END IF;
  UPDATE product_print_plates SET imported_plate_metadata=imported_plate_metadata||jsonb_build_object('composition_label',pl->>'label') WHERE id=stored.id;
  IF jsonb_typeof(pl->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(pl->'parts') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Peças da placa inválidas.'; END IF;
  keys:='{}';
  FOR part IN SELECT value FROM jsonb_array_elements(pl->'parts') LOOP
   IF nullif(btrim(part->>'source_key'),'') IS NULL OR part->>'source_key'=ANY(keys) THEN RAISE EXCEPTION 'Identificação de peça vazia ou repetida.'; END IF;
   keys:=array_append(keys,part->>'source_key');
   IF nullif(btrim(part->>'name'),'') IS NULL OR length(part->>'name')>200 OR length(part->>'source_key')>200
   OR coalesce(part->>'name_source','') NOT IN('source','file','manual','unknown') THEN RAISE EXCEPTION 'Identificação da peça inválida.'; END IF;
   IF (part->>'quantity_per_product' IS NOT NULL AND part->>'quantity_per_product' !~ '^[1-9][0-9]{0,4}$')
   OR (part->>'quantity_per_plate' IS NOT NULL AND part->>'quantity_per_plate' !~ '^[1-9][0-9]{0,4}$') THEN RAISE EXCEPTION 'Quantidade da peça inválida.'; END IF;
   pic:=nullif(part->>'photo_url','');
   IF pic IS NOT NULL AND (length(pic)>4000 OR pic !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$') THEN RAISE EXCEPTION 'Foto da peça inválida.'; END IF;
   IF (part->>'name_source'='unknown' AND EXISTS(SELECT 1 FROM product_print_plate_parts WHERE plate_id=stored.id AND name_source<>'unknown'))
   OR (part->>'name_source'='source' AND EXISTS(SELECT 1 FROM product_print_plate_parts WHERE plate_id=stored.id AND name_source='file')) THEN CONTINUE; END IF;
   INSERT INTO product_print_plate_parts(tenant_id,product_id,plate_id,source_key,name,photo_url,quantity_per_product,quantity_per_plate,name_source)
    VALUES(t,result,stored.id,part->>'source_key',btrim(part->>'name'),pic,(part->>'quantity_per_product')::integer,(part->>'quantity_per_plate')::integer,part->>'name_source')
   ON CONFLICT(plate_id,source_key) DO UPDATE SET
    name=CASE WHEN excluded.name_source='manual' THEN excluded.name WHEN product_print_plate_parts.name_source='manual' THEN product_print_plate_parts.name ELSE excluded.name END,
    name_source=CASE WHEN product_print_plate_parts.name_source='manual' THEN 'manual' ELSE excluded.name_source END,
    photo_url=coalesce(excluded.photo_url,product_print_plate_parts.photo_url),
    quantity_per_product=coalesce(excluded.quantity_per_product,product_print_plate_parts.quantity_per_product),
    quantity_per_plate=coalesce(excluded.quantity_per_plate,product_print_plate_parts.quantity_per_plate);
  END LOOP;
  -- A file can replace an anonymous plate placeholder, without leaving it as an extra part.
  DELETE FROM product_print_plate_parts WHERE plate_id=stored.id AND name_source='unknown' AND NOT(source_key=ANY(keys));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(pl->'parts') p WHERE p->>'name_source'='file') THEN
   DELETE FROM product_print_plate_parts WHERE plate_id=stored.id AND name_source='source' AND NOT(source_key=ANY(keys));
  END IF;
 END LOOP;
 -- The preview carries the current mode when refreshing an existing product.
 -- Save the chosen mode atomically; in-flight production guards still apply.
 PERFORM public.configure_product_assembly(result,(composition->>'enabled')::boolean);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

ALTER FUNCTION public.assembly_product_status(uuid,integer,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.assembly_product_status(uuid,integer,uuid) RENAME TO assembly_status_before_parts;
REVOKE ALL ON FUNCTION erp_private.assembly_status_before_parts(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.assembly_product_status(p_product_id uuid,p_quantity integer DEFAULT 1,p_item_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; t uuid:=get_user_tenant_id();
BEGIN
 result:=erp_private.assembly_status_before_parts(p_product_id,p_quantity,p_item_id);
 RETURN result||jsonb_build_object('components',coalesce((SELECT jsonb_agg(c||jsonb_build_object(
  'photo_url',(SELECT coalesce(p.imported_plate_metadata->'plate'->>'thumbnail',p.imported_plate_metadata->'plate'->'images'->>0) FROM product_print_plates p WHERE p.id=(c->>'plate_id')::uuid AND p.tenant_id=t),
  'parts',coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.name,'quantity_per_product',p.quantity_per_product,'quantity_per_plate',p.quantity_per_plate,'name_source',p.name_source) ORDER BY p.created_at,p.id)
   FROM product_print_plate_parts p WHERE p.plate_id=(c->>'plate_id')::uuid AND p.tenant_id=t),'[]'::jsonb))) FROM jsonb_array_elements(result->'components') c),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.assembly_product_status(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assembly_product_status(uuid,integer,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
