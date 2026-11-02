-- Company work standards remain pending until explicitly confirmed, including
-- zero. Keep the import writer aligned with the full product pricing preview.
DO $$
DECLARE definition text; source_hash text;
 needle text:=$before$ handling:=coalesce((policy->>'handling_minutes_per_plate')::numeric,0); finishing:=coalesce((policy->>'finishing_minutes_per_piece')::numeric,0);
 assembly_minutes:=coalesce((policy->>'assembly_minutes_per_product')::numeric,0); extras:=coalesce((policy->>'extras_cost_per_product')::numeric,0);$before$;
 replacement text:=$after$ handling:=(policy->>'handling_minutes_per_plate')::numeric; finishing:=(policy->>'finishing_minutes_per_piece')::numeric;
 assembly_minutes:=(policy->>'assembly_minutes_per_product')::numeric; extras:=(policy->>'extras_cost_per_product')::numeric;
 IF NOT erp_private.valid_number(handling) OR NOT erp_private.valid_number(finishing)
  OR NOT erp_private.valid_number(assembly_minutes) OR NOT erp_private.valid_number(extras) OR NOT erp_private.valid_number(labor_rate) THEN
  RAISE EXCEPTION 'Confirme preparação, acabamento, montagem, demais insumos e mão de obra da empresa, inclusive zero quando não se aplicarem.';
 END IF;$after$;
BEGIN
 SELECT replace(pg_get_functiondef(p.oid),chr(13),''),md5(replace(p.prosrc,chr(13),'')) INTO definition,source_hash
 FROM pg_proc p WHERE p.oid=to_regprocedure('erp_private.apply_product_import_pricing(uuid,jsonb,uuid)');
 IF source_hash='1f05e88df62bbdc5f1c78a16545df2c6' THEN RETURN; END IF;
 IF source_hash IS DISTINCT FROM 'f7651c90b6d605d599418544c058f14f' OR strpos(definition,needle)=0 THEN
  RAISE EXCEPTION 'Review the confirmed import pricing function before requiring company cost confirmation.';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
