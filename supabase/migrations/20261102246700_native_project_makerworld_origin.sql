-- Keep MakerWorld as the complete catalog origin when the operator supplies
-- a newly sliced local project. Its published estimates must not create a
-- second set of production plates alongside the authoritative native file.
DO $$ DECLARE signature regprocedure; definition text; original text; patched text;
BEGIN
 signature:='erp_private.save_product_before_stock(uuid,jsonb,jsonb,uuid)'::regprocedure;
 definition:=pg_get_functiondef(signature);
 original:='IF reference IS NOT NULL THEN';
 patched:=$new$IF reference IS NOT NULL AND nullif(p_product->'file_composition','null'::jsonb) IS NULL THEN$new$;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=signature)='c6a5fa29243c73000db668e1feea58d9' THEN RETURN; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=signature) IS DISTINCT FROM 'ce86bd19f6d46a0bade761cfb7a7728d'
  OR length(definition)-length(replace(definition,original,''))<>length(original) THEN
  RAISE EXCEPTION 'Review the MakerWorld plate import before preserving native project origin.';
 END IF;
 EXECUTE replace(definition,original,patched);
END $$;
NOTIFY pgrst,'reload schema';
