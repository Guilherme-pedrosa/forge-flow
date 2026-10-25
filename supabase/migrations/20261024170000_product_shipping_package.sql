-- The package is one complete product prepared for dispatch. Printing grams
-- and model dimensions are intentionally never used as shipping defaults.
CREATE FUNCTION erp_private.product_shipping_package_valid(p_package jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE field text; measured numeric;
BEGIN
  IF p_package IS NULL OR p_package='null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(p_package) IS DISTINCT FROM 'object'
    OR p_package-'length_cm'-'width_cm'-'height_cm'-'weight_grams' <> '{}'::jsonb THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['length_cm','width_cm','height_cm','weight_grams'] LOOP
    IF p_package ? field AND p_package->field <> 'null'::jsonb THEN
      IF jsonb_typeof(p_package->field) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      measured:=(p_package->>field)::numeric;
      IF NOT erp_private.valid_number(measured) OR measured<=0
        OR measured>(CASE WHEN field='weight_grams' THEN 1000000 ELSE 1000 END) THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE public.products ADD COLUMN shipping_package jsonb,
  ADD CONSTRAINT products_shipping_package_valid CHECK(erp_private.product_shipping_package_valid(shipping_package));
COMMENT ON COLUMN public.products.shipping_package IS 'External package dimensions in cm and gross weight in grams for one complete product. Partial values are a draft; shipping quote requires all four.';

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_shipping_package;
REVOKE ALL ON FUNCTION erp_private.save_product_before_shipping_package(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; package jsonb;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF p_product ? 'shipping_package' THEN
    package:=nullif(p_product->'shipping_package','null'::jsonb);
    IF NOT erp_private.product_shipping_package_valid(package) THEN
      RAISE EXCEPTION 'Confira as medidas da embalagem e o peso total para envio. Use números positivos em centímetros e gramas.' USING ERRCODE='22023';
    END IF;
  END IF;
  result:=erp_private.save_product_before_shipping_package(p_product_id,p_product,p_photos,p_request_id);
  IF p_product ? 'shipping_package' THEN
    UPDATE products SET shipping_package=package WHERE id=result AND tenant_id=t;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
