-- Atomic product creation from a local project. No stock, material or yield is invented.
ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_local_file;
REVOKE ALL ON FUNCTION erp_private.save_product_before_local_file(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; composition jsonb:=nullif(p_product->'file_composition','null'); pl jsonb; part jsonb; plate uuid; indices integer[]:='{}'; keys text[]; idx integer;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF composition IS NOT NULL AND (p_product_id IS NOT NULL OR p_product->'import_composition' IS NOT NULL) THEN RAISE EXCEPTION 'A composição local deve ser usada no cadastro de um novo produto. Edite as placas existentes para revisar um produto salvo.'; END IF;
 result:=erp_private.save_product_before_local_file(p_product_id,p_product,p_photos,p_request_id);
 IF composition IS NULL THEN RETURN result; END IF;
 IF EXISTS(SELECT 1 FROM product_print_plates WHERE product_id=result AND is_active) THEN RAISE EXCEPTION 'O link já possui placas. Vincule o arquivo à configuração importada para evitar componentes duplicados.'; END IF;
 IF jsonb_typeof(composition->'enabled') IS DISTINCT FROM 'boolean' OR coalesce(composition->>'profile_id','') !~ '^local:[0-9a-f]{64}$'
 OR jsonb_typeof(composition->'plates') IS DISTINCT FROM 'array' OR jsonb_array_length(composition->'plates') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Composição local inválida.'; END IF;
 FOR pl IN SELECT value FROM jsonb_array_elements(composition->'plates') LOOP
  IF coalesce(pl->>'index','') !~ '^[1-9][0-9]{0,3}$' OR nullif(btrim(pl->>'label'),'') IS NULL OR length(pl->>'label')>200 THEN RAISE EXCEPTION 'Identificação da placa inválida.'; END IF;
  idx:=(pl->>'index')::integer; IF idx=ANY(indices) THEN RAISE EXCEPTION 'Placa repetida.'; END IF; indices:=array_append(indices,idx);
  plate:=public.save_product_print_plate(NULL,result,NULL,jsonb_build_object('plate_index',idx,'label',pl->>'label','units_per_plate',pl->'units_per_plate'));
  UPDATE product_print_plates SET imported_plate_metadata=jsonb_build_object('local_file_hash',composition->>'profile_id') WHERE id=plate;
  IF jsonb_typeof(pl->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(pl->'parts') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Peças inválidas.'; END IF;
  keys:='{}';
  FOR part IN SELECT value FROM jsonb_array_elements(pl->'parts') LOOP
   IF nullif(btrim(part->>'source_key'),'') IS NULL OR part->>'source_key'=ANY(keys) OR length(part->>'source_key')>200 OR nullif(btrim(part->>'name'),'') IS NULL OR length(part->>'name')>200 THEN RAISE EXCEPTION 'Identificação da peça inválida.'; END IF;
   keys:=array_append(keys,part->>'source_key');
   IF coalesce(part->>'name_source','') NOT IN('file','manual') THEN RAISE EXCEPTION 'Origem da peça inválida.'; END IF;
   INSERT INTO product_print_plate_parts(tenant_id,product_id,plate_id,source_key,name,quantity_per_product,quantity_per_plate,name_source)
   VALUES(t,result,plate,part->>'source_key',btrim(part->>'name'),(part->>'quantity_per_product')::integer,(part->>'quantity_per_plate')::integer,part->>'name_source');
  END LOOP;
 END LOOP;
 PERFORM public.configure_product_assembly(result,(composition->>'enabled')::boolean);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
