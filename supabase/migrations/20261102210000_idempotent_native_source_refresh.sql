-- An unchanged MakerWorld reference must not stamp a native 3MF plate as
-- changed before restoring the exact same native filaments. Preserve the
-- complete catalog pricing revision and all production-field comparisons.
DO $$
DECLARE definition text; source_hash text;
 needle text:='      -- Source refreshes enrich metadata, never overwrite manual planning or a published BOM.';
 replacement text:=$native$      -- Native file source replay is idempotent. Compare the final values,
      -- including the saved slicer filaments and preserved metadata fields.
      IF old.imported_plate_metadata->>'file_sha256'~'^[0-9a-f]{64}$'
        AND old.imported_plate_metadata->>'file_profile_id'=technical
        AND old.imported_plate_metadata->'slicer_estimates'->>'source'='3mf_slice_info' THEN
        filaments:=erp_private.file_slicer_filaments(old.imported_plate_metadata->'slicer_estimates',t);
      END IF;
      metadata:=coalesce(old.imported_plate_metadata,'{}'::jsonb)||metadata;
      -- Source refreshes enrich metadata, never overwrite manual planning or a published BOM.$native$;
BEGIN
 SELECT pg_get_functiondef(p.oid),md5(replace(p.prosrc,chr(13),'')) INTO definition,source_hash
 FROM pg_proc p WHERE p.oid=to_regprocedure('erp_private.persist_source_before_sliced_file(uuid,jsonb,uuid)');
 IF source_hash='f26c5c9b3f1f84dd3f6ed57201b3ecd3' THEN RETURN; END IF;
 IF source_hash IS DISTINCT FROM '7847c2dff85bd6b939773fa9d3ec841a'
  OR length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'Review the source plate importer before applying idempotent native refresh.';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
NOTIFY pgrst,'reload schema';
