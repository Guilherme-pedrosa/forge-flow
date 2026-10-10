-- A printed piece, a commercial kit and a material variant are different stock
-- units. Never receive a sum of child pieces as that many complete kits.
CREATE FUNCTION erp_private.finished_stock_identity_issues(p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE issues jsonb:='[]';
BEGIN
 IF jsonb_array_length(coalesce(p_snapshot->'components','[]'))>0 THEN
  issues:=issues||jsonb_build_array('Kit comercial: produza e confira os produtos físicos separadamente. O recebimento de kits exige composição e conferência próprias; peças impressas não entram como kits completos.');
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_snapshot->'material_overrides','[]')) x WHERE x->>'item_id' IS DISTINCT FROM x->>'base_item_id')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_snapshot->'requirements','[]')) x WHERE x->>'base_item_id' IS NOT NULL AND x->>'item_id' IS DISTINCT FROM x->>'base_item_id') THEN
  issues:=issues||jsonb_build_array('Outra cor ou material exige um produto com SKU e estoque próprios antes de produzir para estoque. A variante não pode entrar no saldo do SKU base.');
 END IF;
 RETURN issues;
END $$;

ALTER FUNCTION public.production_order_preflight(uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.production_order_preflight(uuid) RENAME TO production_preflight_before_stock_identity;
REVOKE ALL ON FUNCTION erp_private.production_preflight_before_stock_identity(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.production_order_preflight(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result jsonb; lines jsonb:='[]'; line jsonb;
BEGIN
 result:=erp_private.production_preflight_before_stock_identity(p_id);
 IF NOT EXISTS(SELECT 1 FROM production_orders WHERE id=p_id AND tenant_id=t AND source_order_id IS NULL AND source_quote_id IS NULL) THEN RETURN result; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(result->'items') LOOP
  line:=jsonb_set(line,'{issues}',coalesce(line->'issues','[]')||erp_private.finished_stock_identity_issues(line->'snapshot'));
  lines:=lines||jsonb_build_array(line);
 END LOOP;
 RETURN result||jsonb_build_object('items',lines,'ready',coalesce((result->>'ready')::boolean,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lines) x WHERE jsonb_array_length(x->'issues')>0));
END $$;

-- Also protect already released OPs and variants selected for the execution
-- after release. The whole completion/receipt transaction rolls back on failure.
CREATE FUNCTION public.erp_guard_finished_stock_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item production_order_items; job jobs; issues jsonb;
BEGIN
 IF NEW.status<>'completed' OR OLD.status='completed' OR NEW.source_order_id IS NOT NULL OR NEW.source_quote_id IS NOT NULL THEN RETURN NEW; END IF;
 FOR item IN SELECT * FROM production_order_items WHERE production_order_id=NEW.id AND tenant_id=NEW.tenant_id LOOP
  issues:=erp_private.finished_stock_identity_issues(item.production_snapshot);
  IF jsonb_array_length(issues)>0 THEN RAISE EXCEPTION '%',issues->>0; END IF;
  FOR job IN SELECT * FROM jobs WHERE production_order_item_id=item.id AND tenant_id=NEW.tenant_id LOOP
   issues:=erp_private.finished_stock_identity_issues(coalesce(job.material_selection_snapshot,job.production_snapshot));
   IF jsonb_array_length(issues)>0 THEN RAISE EXCEPTION '%',issues->>0; END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_guard_finished_stock_identity BEFORE UPDATE ON public.production_orders
 FOR EACH ROW EXECUTE FUNCTION public.erp_guard_finished_stock_identity();

-- Cancelled queued jobs remain audit history, but cannot promise future supply.
CREATE FUNCTION erp_private.job_has_active_source(p_tenant uuid,p_order uuid,p_op uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM orders WHERE id=p_order AND tenant_id=p_tenant AND status='cancelled')
 AND NOT EXISTS(SELECT 1 FROM production_orders WHERE id=p_op AND tenant_id=p_tenant AND status='cancelled')
$$;
DO $$ DECLARE target regprocedure; definition text; needle text; replacement text; matches integer;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'erp_private.subitem_available(uuid,uuid,uuid,boolean)'::regprocedure,
  'erp_private.component_planned_available(uuid,uuid,text,uuid)'::regprocedure,
  'public.assembly_product_status(uuid,integer,uuid)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(target);
  needle:=CASE WHEN target='erp_private.component_planned_available(uuid,uuid,text,uuid)'::regprocedure THEN 'AND status NOT IN(' ELSE 'AND j.status NOT IN(' END;
  matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
  IF matches<>1 THEN RAISE EXCEPTION 'Review cancelled production supply contract: %.',target; END IF;
  EXECUTE replace(definition,needle,'AND erp_private.job_has_active_source(j.tenant_id,j.order_id,j.production_order_id) '||needle);
 END LOOP;
 target:='erp_private.assembly_status_before_parts(uuid,integer,uuid)'::regprocedure;
 definition:=pg_get_functiondef(target); needle:='AND status NOT IN('; matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
 IF matches<>1 THEN RAISE EXCEPTION 'Review historical plate supply status contract.'; END IF;
 EXECUTE replace(definition,needle,'AND erp_private.job_has_active_source(jobs.tenant_id,jobs.order_id,jobs.production_order_id) AND status NOT IN(');
END $$;

-- Actual execution can end below planned capacity. A count which approves all
-- actually produced pieces must still cover the OP's physical demand. Extra
-- plate capacity is never itself a demand: approved + other pending quantities
-- continue to cap replacement at the uncovered requirement.
DO $$ DECLARE definition text; needle text; matches integer;
BEGIN
 definition:=pg_get_functiondef('public.confirm_finished_output(uuid,integer,text,uuid)'::regprocedure);
 needle:='SELECT * INTO pi FROM production_order_items WHERE id=j.production_order_item_id AND tenant_id=t;';
 matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
 IF matches<>1 THEN RAISE EXCEPTION 'Review actual execution shortage contract.'; END IF;
 definition:=replace(definition,needle,'shortage:=j.planned_quantity-p_good_quantity; '||needle);
 needle:='AND product_id=j.product_id AND print_plate_id IS NOT DISTINCT FROM j.print_plate_id AND status NOT IN(';
 matches:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
 IF matches<>1 THEN RAISE EXCEPTION 'Review replacement pending coverage contract.'; END IF;
 EXECUTE replace(definition,needle,'AND erp_private.job_has_active_source(sibling.tenant_id,sibling.order_id,sibling.production_order_id) '||needle);
END $$;

REVOKE ALL ON FUNCTION erp_private.finished_stock_identity_issues(jsonb),erp_private.job_has_active_source(uuid,uuid,uuid),public.erp_guard_finished_stock_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.production_order_preflight(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_order_preflight(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
