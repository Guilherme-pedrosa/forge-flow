-- A sliced 3MF supplies a plan for each physical plate, never measured usage
-- or an inventory transaction. Keep its file/version separate from Bambu jobs.
CREATE FUNCTION erp_private.file_slicer_filaments(p_slicer jsonb,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE f jsonb; k text; n numeric; ids integer[]:='{}'; result jsonb:='[]'; ident integer;
BEGIN
 IF jsonb_typeof(p_slicer) IS DISTINCT FROM 'object' OR p_slicer->>'source' IS DISTINCT FROM '3mf_slice_info'
 OR p_slicer-'source'-'slicer_version'-'printer_model_id'-'nozzle_diameters'-'filaments'<>'{}'::jsonb
 OR jsonb_typeof(p_slicer->'filaments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_slicer->'filaments')>1024 THEN
  RAISE EXCEPTION 'Dados de fatiamento do arquivo inválidos.' USING ERRCODE='22023';
 END IF;
 FOREACH k IN ARRAY ARRAY['slicer_version','printer_model_id','nozzle_diameters'] LOOP
  IF p_slicer ? k AND p_slicer->k<>'null'::jsonb AND (jsonb_typeof(p_slicer->k)<>'string' OR length(p_slicer->>k)>200 OR p_slicer->>k~'[[:cntrl:]]') THEN
   RAISE EXCEPTION 'Identificação do fatiador inválida.' USING ERRCODE='22023';
  END IF;
 END LOOP;
 FOR f IN SELECT value FROM jsonb_array_elements(p_slicer->'filaments') LOOP
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR f-'id'-'material_code'-'color_hex'-'weight_grams'-'length_meters'<>'{}'::jsonb
  OR jsonb_typeof(f->'id') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Filamento do arquivo inválido.' USING ERRCODE='22023'; END IF;
  n:=(f->>'id')::numeric;
  IF n<>trunc(n) OR n NOT BETWEEN 1 AND 1024 THEN RAISE EXCEPTION 'Identificação de filamento inválida.' USING ERRCODE='22023'; END IF;
  ident:=n::integer;
  IF ident=ANY(ids) THEN RAISE EXCEPTION 'Filamento repetido no arquivo.' USING ERRCODE='22023'; END IF;
  ids:=array_append(ids,ident);
  IF f->>'material_code' IS NOT NULL AND (jsonb_typeof(f->'material_code')<>'string' OR length(f->>'material_code')>100 OR f->>'material_code'~'[[:cntrl:]]') THEN RAISE EXCEPTION 'Material do arquivo inválido.' USING ERRCODE='22023'; END IF;
  IF f->>'color_hex' IS NOT NULL AND (jsonb_typeof(f->'color_hex')<>'string' OR f->>'color_hex'!~'^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$') THEN RAISE EXCEPTION 'Cor do arquivo inválida.' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['weight_grams','length_meters'] LOOP
   IF f ? k AND f->k<>'null'::jsonb THEN
    IF jsonb_typeof(f->k)<>'number' THEN RAISE EXCEPTION 'Consumo previsto do filamento inválido.' USING ERRCODE='22023'; END IF;
    n:=(f->>k)::numeric;
    IF NOT erp_private.valid_number(n) OR n>1000000 THEN RAISE EXCEPTION 'Consumo previsto do filamento fora do limite.' USING ERRCODE='22023'; END IF;
   END IF;
  END LOOP;
  result:=result||jsonb_build_array(jsonb_build_object('id',ident::text,'type',nullif(btrim(f->>'material_code'),''),
   'color',upper(f->>'color_hex'),'grams',f->'weight_grams','meters',f->'length_meters','weight_source','file_slicer'));
 END LOOP;
 RETURN erp_private.import_filament_matches(p_tenant,result);
END $$;
REVOKE ALL ON FUNCTION erp_private.file_slicer_filaments(jsonb,uuid) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_sliced_file;
REVOKE ALL ON FUNCTION erp_private.save_product_before_sliced_file(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; composition jsonb; pl jsonb; k text; n numeric; hash text;
 local_file boolean; stored product_print_plates; matches uuid[]; ids integer[]:='{}'; idx integer;
 grams numeric; seconds numeric; old_grams numeric; old_seconds numeric; filaments jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
 IF result IS NOT NULL THEN RETURN result; END IF;
 composition:=coalesce(nullif(p_product->'file_composition','null'::jsonb),nullif(p_product->'import_composition','null'::jsonb));
 local_file:=nullif(p_product->'file_composition','null'::jsonb) IS NOT NULL;
 -- Validate the new optional contract before delegating to the existing atomic
 -- catalogue, stock, assembly and shipping wrappers. Older payloads still work.
 IF composition IS NOT NULL AND jsonb_typeof(composition->'plates')='array' THEN
  FOR pl IN SELECT value FROM jsonb_array_elements(composition->'plates') LOOP
   IF NOT pl ? 'slicer_estimates' THEN CONTINUE; END IF;
   hash:=composition->>'file_sha256';
   IF jsonb_typeof(composition->'file_sha256') IS DISTINCT FROM 'string' OR hash!~'^[0-9a-f]{64}$'
   OR (local_file AND composition->>'profile_id' IS DISTINCT FROM 'local:'||hash) THEN RAISE EXCEPTION 'O fatiamento deve identificar o mesmo arquivo 3MF por SHA-256.' USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(pl->'index') IS DISTINCT FROM 'number' OR coalesce(pl->>'index','')!~'^[1-9][0-9]{0,3}$' THEN RAISE EXCEPTION 'Índice do fatiamento inválido.' USING ERRCODE='22023'; END IF;
   idx:=(pl->>'index')::integer;
   IF idx=ANY(ids) THEN RAISE EXCEPTION 'Placa fatiada repetida.' USING ERRCODE='22023'; END IF;
   ids:=array_append(ids,idx);
   FOREACH k IN ARRAY ARRAY['weight_grams','time_seconds'] LOOP
    IF pl ? k AND pl->k<>'null'::jsonb THEN
     IF jsonb_typeof(pl->k)<>'number' THEN RAISE EXCEPTION 'Peso e tempo previstos devem ser números.' USING ERRCODE='22023'; END IF;
     n:=(pl->>k)::numeric;
     IF NOT erp_private.valid_number(n) OR n>(CASE WHEN k='weight_grams' THEN 1000000 ELSE 31536000 END) THEN RAISE EXCEPTION 'Peso ou tempo previsto fora do limite.' USING ERRCODE='22023'; END IF;
    END IF;
   END LOOP;
   PERFORM erp_private.file_slicer_filaments(pl->'slicer_estimates',t);
  END LOOP;
 END IF;
 result:=erp_private.save_product_before_sliced_file(p_product_id,p_product,p_photos,p_request_id);
 IF composition IS NULL THEN RETURN result; END IF;
 FOR pl IN SELECT value FROM jsonb_array_elements(composition->'plates') LOOP
  IF NOT pl ? 'slicer_estimates' THEN CONTINUE; END IF;
  idx:=(pl->>'index')::integer;
  SELECT array_agg(p.id) INTO matches FROM product_print_plates p WHERE p.product_id=result AND p.tenant_id=t AND p.is_active AND p.plate_index=idx
   AND CASE WHEN local_file THEN p.source_id IS NULL AND p.imported_plate_metadata->>'local_file_hash'=composition->>'profile_id'
     ELSE p.imported_plate_metadata->>'profile_id'=composition->>'profile_id' END;
  IF coalesce(cardinality(matches),0)<>1 THEN RAISE EXCEPTION 'A placa fatiada não corresponde ao arquivo e perfil deste produto.'; END IF;
  SELECT * INTO stored FROM product_print_plates WHERE id=matches[1] FOR UPDATE;
  grams:=nullif((pl->>'weight_grams')::numeric,0); seconds:=nullif((pl->>'time_seconds')::numeric,0);
  old_grams:=coalesce((stored.imported_plate_metadata->>'slicer_weight_grams')::numeric,(stored.imported_plate_metadata->'plate'->>'weight_grams')::numeric);
  old_seconds:=coalesce((stored.imported_plate_metadata->>'slicer_time_seconds')::numeric,(stored.imported_plate_metadata->'plate'->>'time_seconds')::numeric);
  -- Re-reading the same source cannot erase a later manual planning edit.
  IF stored.est_grams IS NOT NULL AND stored.est_grams IS DISTINCT FROM old_grams THEN grams:=stored.est_grams; END IF;
  IF stored.est_time_seconds IS NOT NULL AND stored.est_time_seconds IS DISTINCT FROM old_seconds THEN seconds:=stored.est_time_seconds; END IF;
  IF stored.est_grams IS DISTINCT FROM grams OR stored.est_time_seconds IS DISTINCT FROM seconds THEN
   PERFORM public.save_product_print_plate(stored.id,result,stored.source_id,jsonb_build_object('plate_index',idx,'label',stored.label,'units_per_plate',stored.units_per_plate,
    'material_id',stored.material_id,'printer_id',stored.printer_id,'est_grams',grams,'est_time_seconds',seconds,'est_cost_per_unit',stored.est_cost_per_unit));
  END IF;
  filaments:=erp_private.file_slicer_filaments(pl->'slicer_estimates',t);
  UPDATE product_print_plates SET imported_filaments=filaments,
   imported_plate_metadata=coalesce(imported_plate_metadata,'{}'::jsonb)||jsonb_build_object('file_sha256',hash,'file_profile_id',composition->>'profile_id',
    'slicer_estimates',pl->'slicer_estimates','slicer_weight_grams',nullif((pl->>'weight_grams')::numeric,0),'slicer_time_seconds',nullif((pl->>'time_seconds')::numeric,0)),updated_at=now()
   WHERE id=stored.id;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

-- A normal product edit may refresh MakerWorld. Retain the explicitly uploaded
-- file's filament plan when the exact source profile/plate still matches.
ALTER FUNCTION public.persist_source_plate_import(uuid,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.persist_source_plate_import(uuid,jsonb,uuid) RENAME TO persist_source_before_sliced_file;
REVOKE ALL ON FUNCTION erp_private.persist_source_before_sliced_file(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.persist_source_plate_import(p_source_id uuid,p_reference jsonb,p_task_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result jsonb; p product_print_plates;
BEGIN
 result:=erp_private.persist_source_before_sliced_file(p_source_id,p_reference,p_task_id);
 FOR p IN SELECT * FROM product_print_plates WHERE source_id=p_source_id AND tenant_id=t AND is_active
  AND imported_plate_metadata->>'file_sha256'~'^[0-9a-f]{64}$'
  AND imported_plate_metadata->>'file_profile_id'=imported_plate_metadata->>'profile_id'
  AND imported_plate_metadata->'slicer_estimates'->>'source'='3mf_slice_info' LOOP
  UPDATE product_print_plates SET imported_filaments=erp_private.file_slicer_filaments(p.imported_plate_metadata->'slicer_estimates',t) WHERE id=p.id;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.persist_source_plate_import(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.persist_source_plate_import(uuid,jsonb,uuid) TO authenticated;

-- Preserve the existing homogeneous-plate and manual-sheet guards. Only the
-- fallback without a published material recipe gains file filament identities.
DO $$ DECLARE def text; old text; replacement text; BEGIN
 old:=$marker$IF jsonb_array_length(lines)=0 THEN lines:=jsonb_build_array(jsonb_build_object('item_id',plate.material_id,'grams',plate.est_grams/b.quantity_per_plate,'material',NULL,'color',NULL,'cost_per_kg',NULL)); END IF;$marker$;
 replacement:=$patch$IF jsonb_array_length(lines)=0 AND plate.imported_plate_metadata->'slicer_estimates'->>'source'='3mf_slice_info'
  AND plate.est_grams IS NOT DISTINCT FROM (plate.imported_plate_metadata->>'slicer_weight_grams')::numeric
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plate.imported_filaments) f WHERE f->>'grams' IS NULL) THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',f->>'item_id','grams',(f->>'grams')::numeric/b.quantity_per_plate,
    'material',f->>'type','color',f->>'color','cost_per_kg',NULL)),'[]') INTO lines
    FROM jsonb_array_elements(erp_private.import_filament_matches(p_tenant,plate.imported_filaments)) f;
  END IF;
  IF jsonb_array_length(lines)=0 THEN lines:=jsonb_build_array(jsonb_build_object('item_id',plate.material_id,'grams',plate.est_grams/b.quantity_per_plate,'material',NULL,'color',NULL,'cost_per_kg',NULL)); END IF;$patch$;
 def:=pg_get_functiondef('erp_private.read_piece_spec(uuid,uuid,uuid)'::regprocedure);
 IF strpos(def,old)=0 THEN RAISE EXCEPTION 'Review the homogeneous piece technical fallback before applying sliced-file data.'; END IF;
 EXECUTE replace(def,old,replacement);
END $$;
NOTIFY pgrst,'reload schema';
