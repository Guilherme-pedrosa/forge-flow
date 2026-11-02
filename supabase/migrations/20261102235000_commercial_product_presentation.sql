-- Finished-product dimensions and commercial copy provenance are optional.
-- They do not become production consumption, recipe values or shipping-package dimensions.
DO $$
DECLARE source_hash text; predecessor_hash text;
BEGIN
 SELECT md5(replace(prosrc,chr(13),'')) INTO source_hash FROM pg_proc WHERE oid=to_regprocedure('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)');
 SELECT md5(replace(prosrc,chr(13),'')) INTO predecessor_hash FROM pg_proc WHERE oid=to_regprocedure('erp_private.save_product_before_presentation(uuid,jsonb,jsonb,uuid)');
 IF NOT coalesce((source_hash='e8fe2acb45219eb57769d24c3591d496' AND predecessor_hash IS NULL)
  OR(source_hash='ef736b7c71ba4f6edcfb851cb1b1b8ff' AND predecessor_hash='e8fe2acb45219eb57769d24c3591d496'),false) THEN
  RAISE EXCEPTION 'Review the commercial product save function before applying presentation fields.';
 END IF;
 IF to_regprocedure('erp_private.valid_product_commercial_presentation(jsonb)') IS NOT NULL AND
  (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('erp_private.valid_product_commercial_presentation(jsonb)')) IS DISTINCT FROM 'd75f31e325284f84b4a5fc6f00f96194' THEN
  RAISE EXCEPTION 'Review the commercial product presentation validator.';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.products'::regclass AND attname='commercial_presentation' AND NOT attisdropped AND(atttypid<>'jsonb'::regtype OR attnotnull)) THEN
  RAISE EXCEPTION 'Review the commercial product presentation column.';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION erp_private.valid_product_commercial_presentation(p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE dims jsonb; generation jsonb; key text; value jsonb; amount numeric;
BEGIN
 IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR octet_length(p_value::text)>200000
  OR p_value-ARRAY['dimensions','description_generation']<>'{}'::jsonb THEN RETURN false; END IF;
 dims:=p_value->'dimensions';
 IF dims IS NOT NULL AND dims<>'null'::jsonb THEN
  IF jsonb_typeof(dims) IS DISTINCT FROM 'object' OR dims-ARRAY['length_mm','width_mm','height_mm']<>'{}'::jsonb THEN RETURN false; END IF;
  FOREACH key IN ARRAY ARRAY['length_mm','width_mm','height_mm'] LOOP
   value:=dims->key;
   IF value IS NULL OR value='null'::jsonb THEN CONTINUE; END IF;
   IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
   amount:=(value#>>'{}')::numeric;
   IF NOT erp_private.valid_number(amount) OR amount<=0 OR amount>100000 THEN RETURN false; END IF;
  END LOOP;
 END IF;
 generation:=p_value->'description_generation';
 IF generation IS NOT NULL AND generation<>'null'::jsonb THEN
  IF jsonb_typeof(generation) IS DISTINCT FROM 'object'
   OR NOT generation ?& ARRAY['schema_version','generator','generated_text','input_signature','title_mode']
   OR generation-ARRAY['schema_version','generator','generated_text','input_signature','title_mode']<>'{}'::jsonb
   OR jsonb_typeof(generation->'schema_version') IS DISTINCT FROM 'number' OR generation->'schema_version'<>'1'::jsonb
   OR generation->>'generator' IS DISTINCT FROM 'facts-pt-BR-v1'
   OR jsonb_typeof(generation->'generated_text') IS DISTINCT FROM 'string' OR length(generation->>'generated_text')>20000
   OR jsonb_typeof(generation->'input_signature') IS DISTINCT FROM 'string' OR length(generation->>'input_signature')>20000
   OR coalesce(generation->>'title_mode','') NOT IN('portuguese','known_translation','source_name','generic') THEN RETURN false; END IF;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION erp_private.valid_product_commercial_presentation(jsonb) FROM PUBLIC,anon;
-- The pure validator also protects direct authenticated updates through CHECK.
GRANT EXECUTE ON FUNCTION erp_private.valid_product_commercial_presentation(jsonb) TO authenticated;
ALTER TABLE products ADD COLUMN IF NOT EXISTS commercial_presentation jsonb;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.products'::regclass AND conname='products_commercial_presentation_valid') THEN
  IF (SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint WHERE conrelid='public.products'::regclass AND conname='products_commercial_presentation_valid') IS DISTINCT FROM 'erp_private.valid_product_commercial_presentation(commercial_presentation)' THEN
   RAISE EXCEPTION 'Review the commercial product presentation constraint.';
  END IF;
 ELSE ALTER TABLE products ADD CONSTRAINT products_commercial_presentation_valid CHECK(erp_private.valid_product_commercial_presentation(commercial_presentation)); END IF;
END $$;
DO $$ BEGIN
 IF to_regprocedure('erp_private.save_product_before_presentation(uuid,jsonb,jsonb,uuid)') IS NULL THEN
  ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
  ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_presentation;
 END IF;
END $$;
REVOKE ALL ON FUNCTION erp_private.save_product_before_presentation(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid;
BEGIN
 -- Preserve the channel wrapper's financial-role check even on an accepted replay.
 IF jsonb_typeof(p_product->'channel_pricing')='array' THEN
  IF jsonb_array_length(p_product->'channel_pricing')>0 THEN PERFORM erp_private.actor(true); END IF;
 END IF;
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_product ? 'commercial_presentation' AND NOT erp_private.valid_product_commercial_presentation(p_product->'commercial_presentation') THEN
  RAISE EXCEPTION 'Confira as medidas e os dados da descrição comercial do produto.';
 END IF;
 -- Every predecessor receives the original full JSON and the same request ID.
 result:=erp_private.save_product_before_presentation(p_product_id,p_product,p_photos,p_request_id);
 IF p_product ? 'commercial_presentation' THEN
  UPDATE products SET commercial_presentation=nullif(p_product->'commercial_presentation','null'::jsonb) WHERE id=result AND tenant_id=t;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
