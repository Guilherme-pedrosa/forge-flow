-- Category is commercial classification; it does not change the approved
-- material recipe. Keep the full revision check before the write and every
-- production input in the post-write comparison.
DO $$
DECLARE definition text; source_hash text;
 needle text:='-ARRAY[''name'',''sku'',''cost_estimate'',''sale_price'']';
 replacement text:='-ARRAY[''name'',''sku'',''category'',''cost_estimate'',''sale_price'']';
BEGIN
 SELECT pg_get_functiondef(p.oid),md5(replace(p.prosrc,chr(13),'')) INTO definition,source_hash
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)');
 IF source_hash='e210a4b4af233c3a6a853c4fbf131d81' THEN RETURN; END IF;
 IF source_hash IS DISTINCT FROM 'cae87d1c8264c51a968139ed7076e383' THEN
   RAISE EXCEPTION 'Review the live catalog pricing save function before applying the category correction.';
 END IF;
 IF length(definition)-length(replace(definition,needle,''))<>2*length(needle) THEN
   RAISE EXCEPTION 'Review the catalog pricing comparison before applying the category correction.';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;

NOTIFY pgrst,'reload schema';
