-- A new 3MF may contain several copies which together form one saleable kit.
-- An explicit confirmed import plan owns the yield; the legacy homogeneous
-- fallback must not first turn every physical copy into a complete product.
DO $$ DECLARE definition text; original text; patched text; signature regprocedure;
BEGIN
 signature:='erp_private.save_product_before_import_pricing(uuid,jsonb,jsonb,uuid)'::regprocedure;
 definition:=pg_get_functiondef(signature);
 original:=$old$IF composition->>'enabled'='false' AND jsonb_array_length(composition->'plates')=1$old$;
 patched:=$new$IF NOT (p_product_id IS NULL AND nullif(p_product->'import_pricing','null'::jsonb) IS NOT NULL)
  AND composition->>'enabled'='false' AND jsonb_array_length(composition->'plates')=1$new$;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=signature)='bf99984c9845db0a9c432f74e28298c2' THEN RETURN; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=signature)
  IS DISTINCT FROM '14d9d52750e86545fb4b5785928e33f9'
  OR length(definition)-length(replace(definition,original,''))<>length(original) THEN
  RAISE EXCEPTION 'Review the sliced source initialization before applying confirmed new import yield.';
 END IF;
 EXECUTE replace(definition,original,patched);
END $$;

-- Only initialize a newly created product. A later import cannot silently
-- replace a composition or an already confirmed quantity_per_product.
DO $$ DECLARE definition text; original text; patched text; signature regprocedure;
BEGIN
 signature:='erp_private.save_product_before_live_pricing(uuid,jsonb,jsonb,uuid)'::regprocedure;
 definition:=pg_get_functiondef(signature);
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=signature)='209771c3bd1dba359ec44acfe2a7838e' THEN RETURN; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=signature)
  IS DISTINCT FROM 'f00cda41459e8d687bc514b2d01353f9' THEN
  RAISE EXCEPTION 'Review the confirmed import wrapper before applying new import yield.';
 END IF;
 original:='PERFORM erp_private.apply_product_import_pricing(result,p_product->''import_pricing'',p_request_id);';
 patched:=$new$-- new_import_yield_checked: no fractional physical pieces in a confirmed new product.
  IF p_product_id IS NULL AND jsonb_typeof(p_product->'import_pricing'->'quantity')='number'
   AND (p_product->'import_pricing'->>'quantity')::numeric BETWEEN 1 AND 10000 THEN
   IF EXISTS(SELECT 1 FROM product_print_plate_parts part JOIN product_print_plates plate ON plate.id=part.plate_id AND plate.tenant_id=t
    WHERE plate.product_id=result AND plate.is_active AND part.tenant_id=t AND part.quantity_per_plate IS NOT NULL
     AND part.quantity_per_plate % (p_product->'import_pricing'->>'quantity')::numeric <> 0) THEN
    RAISE EXCEPTION 'A quantidade de peças do arquivo não forma esse número de produtos completos. Confira quantas unidades completas saem deste conjunto de placas.';
   END IF;
  END IF;
  PERFORM erp_private.apply_product_import_pricing(result,p_product->'import_pricing',p_request_id);$new$;
 IF length(definition)-length(replace(definition,original,''))<>length(original) THEN
  RAISE EXCEPTION 'Review the confirmed import call before applying new import yield.';
 END IF;
 EXECUTE replace(definition,original,patched);
END $$;
NOTIFY pgrst,'reload schema';
