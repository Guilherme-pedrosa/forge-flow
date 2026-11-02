-- Re-reading accepted production does not make it a new measurement. Keep
-- timestamps stable only when every aggregate value, count and source agrees;
-- changed samples still change the BOM and invalidate stale pricing revisions.
DO $$
DECLARE definition text; source_hash text;
 plate_needle text:='actual_updated_at=CASE WHEN metrics.units>0 THEN now() END';
 combined_needle text:='actual_print_updated_at=CASE WHEN combined.units>0 THEN now() END';
 legacy_needle text:='actual_print_updated_at=CASE WHEN metrics.units>0 THEN now() END';
 plate_replacement text:=$plate$actual_updated_at=CASE WHEN metrics.units>0 THEN
        CASE WHEN (plate.actual_grams_per_unit,plate.actual_seconds_per_unit,plate.actual_cost_per_unit,plate.actual_sample_units,plate.actual_source)
          IS DISTINCT FROM (metrics.grams,metrics.seconds,metrics.cost,metrics.units,metrics.source)
          OR plate.actual_updated_at IS NULL THEN now() ELSE plate.actual_updated_at END END$plate$;
 combined_replacement text:=$combined$actual_print_updated_at=CASE WHEN combined.units>0 THEN
        CASE WHEN (p.actual_print_grams_per_unit,p.actual_print_seconds_per_unit,p.actual_print_cost_per_unit,p.actual_print_sample_units,p.actual_print_source)
          IS DISTINCT FROM (combined.actual_grams,combined.actual_seconds,combined.actual_cost,combined.units,combined.source)
          OR p.actual_print_updated_at IS NULL THEN now() ELSE p.actual_print_updated_at END END$combined$;
 legacy_replacement text:=$legacy$actual_print_updated_at=CASE WHEN metrics.units>0 THEN
        CASE WHEN (p.actual_print_grams_per_unit,p.actual_print_seconds_per_unit,p.actual_print_cost_per_unit,p.actual_print_sample_units,p.actual_print_source)
          IS DISTINCT FROM (metrics.grams,metrics.seconds,metrics.cost,metrics.units,metrics.source)
          OR p.actual_print_updated_at IS NULL THEN now() ELSE p.actual_print_updated_at END END$legacy$;
BEGIN
 SELECT pg_get_functiondef(p.oid),md5(replace(p.prosrc,chr(13),'')) INTO definition,source_hash
 FROM pg_proc p WHERE p.oid=to_regprocedure('erp_private.update_product_print_actuals(uuid)');
 IF source_hash='de93bed3c9209f67a30c84d04c5a6615' THEN RETURN; END IF;
 IF source_hash IS DISTINCT FROM '1eb0012eeba36726f2938e5d630684b4'
  OR length(definition)-length(replace(definition,plate_needle,''))<>length(plate_needle)
  OR length(definition)-length(replace(definition,combined_needle,''))<>length(combined_needle)
  OR length(definition)-length(replace(definition,legacy_needle,''))<>length(legacy_needle) THEN
  RAISE EXCEPTION 'Review the print actuals aggregation before preserving unchanged measurement timestamps.';
 END IF;
 EXECUTE replace(replace(replace(definition,plate_needle,plate_replacement),combined_needle,combined_replacement),legacy_needle,legacy_replacement);
END $$;
NOTIFY pgrst,'reload schema';
