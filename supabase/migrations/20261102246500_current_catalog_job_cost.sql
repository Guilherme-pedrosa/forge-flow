-- New catalog work freezes today's canonical manufacturing estimate. Reprints
-- and approved/historical recipes keep their existing valuation and identity.
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.erp_job_production_snapshot()'))
  NOT IN ('390cce3b0dd7edb6065c7f26227fa8a1','8fbd9666865700eb7951ac6dddd3150b') THEN
  RAISE EXCEPTION 'Review the production snapshot trigger before applying current job pricing.';
 END IF;
 IF to_regprocedure('erp_private.current_catalog_job_pricing(jsonb,uuid,uuid,integer,uuid,uuid)') IS NOT NULL
  AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('erp_private.current_catalog_job_pricing(jsonb,uuid,uuid,integer,uuid,uuid)'))
    IS DISTINCT FROM 'b90be2e2aec473dc4db240a12ee17cc3' THEN
  RAISE EXCEPTION 'Review the current catalog job pricing helper before replacing it.';
 END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('erp_private.pricing_product(uuid,uuid,integer,jsonb,jsonb,uuid[])'))
  IS DISTINCT FROM '79878960a508c4a304c793c50948003c' THEN
  RAISE EXCEPTION 'Review the canonical manufacturing formula before applying current job pricing.';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION erp_private.current_catalog_job_pricing(p_snapshot jsonb,p_product uuid,p_plate uuid,p_quantity integer,p_tenant uuid,p_printer uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE current_bom jsonb; current_plate jsonb; frozen_plate jsonb; current_recipe jsonb; frozen_recipe jsonb;
 preview jsonb; policy jsonb; cfg jsonb; plate_result jsonb; first_plate jsonb; selected_plate jsonb; line jsonb;
 frozen_lines jsonb; current_lines jsonb; quote_lines jsonb; part jsonb; breakdown jsonb:='{}'; rounded_breakdown jsonb:='{}'; remainder jsonb:='{}'; plate_totals jsonb:='{}';
 missing jsonb:='[]'; identity_keys text[]:=ARRAY['id','source_id','plate_index','units_per_plate','printer_id','est_grams','est_time_seconds','imported_filaments','imported_plate_metadata','model_id','profile_id'];
 k text; value numeric; cumulative numeric:=0; allocated numeric:=0; total numeric; runs numeric; factor numeric; overhead_rate numeric;
BEGIN
 current_bom:=erp_private.product_bom_snapshot(p_product,p_tenant);
 IF p_plate IS NULL THEN
  current_recipe:=current_bom->'recipe'; frozen_recipe:=p_snapshot->'recipe';
 ELSE
  SELECT x INTO current_plate FROM jsonb_array_elements(coalesce(current_bom->'plates','[]')) x WHERE x->>'id'=p_plate::text;
  SELECT x INTO frozen_plate FROM jsonb_array_elements(coalesce(p_snapshot->'plates','[]')) x WHERE x->>'id'=p_plate::text;
  current_recipe:=current_plate->'recipe'; frozen_recipe:=frozen_plate->'recipe';
 END IF;
 -- A caller selecting an older recipe never receives the current recipe's cost.
 -- Physical subitem plans change units_per_print but retain grams_per_print and
 -- the exact version ID, so compare the actual print rather than its allocation.
 SELECT jsonb_agg(jsonb_build_array(x->>'item_id',x->'grams_per_print') ORDER BY x->>'item_id') INTO frozen_lines FROM jsonb_array_elements(coalesce(frozen_recipe->'lines','[]')) x;
 SELECT jsonb_agg(jsonb_build_array(x->>'item_id',x->'grams_per_print') ORDER BY x->>'item_id') INTO current_lines FROM jsonb_array_elements(coalesce(current_recipe->'lines','[]')) x;
 IF current_recipe->>'version_id' IS NULL OR current_recipe->>'version_id' IS DISTINCT FROM frozen_recipe->>'version_id'
  OR current_lines IS DISTINCT FROM frozen_lines
  OR p_plate IS NOT NULL AND (SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(current_plate) e WHERE e.key=ANY(identity_keys))
    IS DISTINCT FROM (SELECT jsonb_object_agg(e.key,e.value) FROM jsonb_each(frozen_plate) e WHERE e.key=ANY(identity_keys))
  OR ((current_bom->'product')-ARRAY['name','sku','category','cost_estimate','sale_price'])
    IS DISTINCT FROM ((p_snapshot->'product')-ARRAY['name','sku','category','cost_estimate','sale_price']) THEN
  RETURN jsonb_build_object('schema_version',1,'basis','frozen_recipe','complete',frozen_recipe->'complete',
   'recipe_version_id',frozen_recipe->>'version_id','reason','A receita ou a fonte física selecionada difere do catálogo atual; seu custo histórico foi preservado.');
 END IF;
 policy:=erp_private.read_pricing_settings(p_tenant);
 preview:=erp_private.pricing_product(p_product,p_tenant,CASE WHEN p_plate IS NULL THEN p_quantity ELSE 1 END,policy,'{}','{}');
 cfg:=policy||coalesce(preview->'plan','{}'); missing:=coalesce(preview->'missing','[]');
 IF p_plate IS NULL THEN
  breakdown:=preview->'technical_breakdown';
 ELSE
  SELECT x INTO first_plate FROM jsonb_array_elements(preview->'plates') x
   ORDER BY (x->>'plate_index')::integer,x->>'plate_id' LIMIT 1;
  SELECT x INTO selected_plate FROM jsonb_array_elements(preview->'plates') x WHERE x->>'plate_id'=p_plate::text;
  IF selected_plate IS NULL OR NOT erp_private.valid_number((selected_plate->>'runs')::numeric,0.000000001) THEN
   missing:=missing||jsonb_build_array('A placa não corresponde ao plano canônico atual.');
  ELSE
   IF (selected_plate->>'printer_id')::uuid IS DISTINCT FROM p_printer THEN
    missing:=missing||jsonb_build_array('A impressora da ordem difere da impressora confirmada no plano de custo. Confirme o mesmo modelo e tarifa antes de estimar.');
   END IF;
   -- A learned estimate is usable only when it describes this exact frozen
   -- physical print. Never change grams, materials or time to make costs fit.
   SELECT jsonb_agg(jsonb_build_array(x->>'item_id',x->'grams') ORDER BY x->>'item_id') INTO quote_lines FROM jsonb_array_elements(selected_plate->'materials') x;
   IF quote_lines IS DISTINCT FROM current_lines OR (selected_plate->>'print_seconds_per_run')::numeric IS DISTINCT FROM (current_plate->>'est_time_seconds')::numeric THEN
    missing:=missing||jsonb_build_array('A referência de custo usa consumo ou tempo diferente desta receita física. Confirme uma nova versão antes de estimar a impressão.');
   END IF;
   overhead_rate:=(cfg->>'overhead_percent')::numeric;
   FOREACH k IN ARRAY ARRAY['material','energy','machine','handling','finishing','assembly','extras','overhead'] LOOP
    SELECT coalesce(sum((x->>k)::numeric),0) INTO value FROM jsonb_array_elements(preview->'plates') x;
    IF k='overhead' THEN
     SELECT coalesce(sum((coalesce((x->>'material')::numeric,0)+coalesce((x->>'energy')::numeric,0)+coalesce((x->>'machine')::numeric,0)+coalesce((x->>'handling')::numeric,0))*overhead_rate/100),0)
      INTO value FROM jsonb_array_elements(preview->'plates') x;
    END IF;
    plate_totals:=plate_totals||jsonb_build_object(k,value);
    remainder:=remainder||jsonb_build_object(k,(preview->'technical_breakdown'->>k)::numeric-value);
   END LOOP;
   factor:=p_quantity::numeric/nullif((frozen_recipe->>'units_per_print')::numeric,0);
   runs:=(selected_plate->>'runs')::numeric;
   FOREACH k IN ARRAY ARRAY['material','energy','machine','handling','finishing','assembly','extras','overhead'] LOOP
    value:=coalesce((selected_plate->>k)::numeric,0);
    IF k='overhead' THEN value:=((selected_plate->>'material')::numeric+(selected_plate->>'energy')::numeric+(selected_plate->>'machine')::numeric+(selected_plate->>'handling')::numeric)*overhead_rate/100; END IF;
    IF selected_plate->>'plate_id'=first_plate->>'plate_id' THEN value:=value+(remainder->>k)::numeric; END IF;
    breakdown:=breakdown||jsonb_build_object(k,value/runs*factor);
   END LOOP;
  END IF;
 END IF;
 -- Jobs store cents. Cumulative rounding keeps the displayed components equal
 -- to their displayed total without adding a second loss/purge allowance.
 IF jsonb_array_length(missing)=0 AND preview->>'complete'='true' THEN
  FOR k IN SELECT unnest(ARRAY['material','energy','machine','labor','overhead','extras']) LOOP
   value:=CASE WHEN k='labor' THEN (breakdown->>'handling')::numeric+(breakdown->>'finishing')::numeric+(breakdown->>'assembly')::numeric ELSE (breakdown->>k)::numeric END;
   IF NOT erp_private.valid_number(value) THEN missing:=missing||jsonb_build_array('Um componente do custo canônico não foi confirmado.'); EXIT; END IF;
   cumulative:=cumulative+value;
   rounded_breakdown:=rounded_breakdown||jsonb_build_object(k,round(cumulative,2)-allocated); allocated:=round(cumulative,2);
  END LOOP;
  IF jsonb_array_length(missing)=0 THEN total:=allocated; END IF;
 END IF;
 RETURN jsonb_build_object('schema_version',1,'basis','canonical_current','complete',total IS NOT NULL,'missing',missing,
  'captured_at',statement_timestamp(),'revision',preview->>'revision','settings_revision',policy->>'revision','plan_revision',preview->>'plan_revision',
  'recipe_version_id',frozen_recipe->>'version_id','allocation_policy','print_costs_per_plate_final_costs_once_on_first_active_plate',
  'final_costs_plate_id',first_plate->>'plate_id','final_costs_in_this_print',p_plate IS NULL OR p_plate::text=first_plate->>'plate_id',
  'final_costs_per_product',remainder,'rounding_policy','cumulative_cents','raw_breakdown',breakdown,'breakdown',rounded_breakdown,'total',total,
  'canonical_quantity',preview->'quantity','canonical_technical_breakdown',preview->'technical_breakdown','canonical_plates',preview->'plates');
END $$;
REVOKE ALL ON FUNCTION erp_private.current_catalog_job_pricing(jsonb,uuid,uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;

DO $$ DECLARE definition text; needle text; replacement text;
BEGIN
 definition:=pg_get_functiondef('public.erp_job_production_snapshot()'::regprocedure);
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.erp_job_production_snapshot()'::regprocedure)='8fbd9666865700eb7951ac6dddd3150b' THEN RETURN; END IF;
 definition:=replace(definition,'line jsonb; item inventory_items;','line jsonb; current_pricing jsonb; item inventory_items;');
 needle:='NEW.est_overhead:=NULL; NEW.est_extras_cost:=NULL;';
 replacement:=$patch$NEW.est_overhead:=NULL; NEW.est_extras_cost:=NULL;
        current_pricing:=erp_private.current_catalog_job_pricing(NEW.production_snapshot,NEW.product_id,NEW.print_plate_id,NEW.planned_quantity,NEW.tenant_id,NEW.printer_id);
        NEW.production_snapshot:=NEW.production_snapshot||jsonb_build_object('job_pricing',current_pricing);
        IF current_pricing->>'basis'='canonical_current' THEN
          NEW.est_total_cost:=(current_pricing->>'total')::numeric;
          NEW.est_material_cost:=(current_pricing->'breakdown'->>'material')::numeric;
          NEW.est_energy_cost:=(current_pricing->'breakdown'->>'energy')::numeric;
          NEW.est_machine_cost:=(current_pricing->'breakdown'->>'machine')::numeric;
          NEW.est_labor_cost:=(current_pricing->'breakdown'->>'labor')::numeric;
          NEW.est_overhead:=(current_pricing->'breakdown'->>'overhead')::numeric;
          NEW.est_extras_cost:=(current_pricing->'breakdown'->>'extras')::numeric;
        END IF;$patch$;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Review the catalog estimate assignment.'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
NOTIFY pgrst,'reload schema';
