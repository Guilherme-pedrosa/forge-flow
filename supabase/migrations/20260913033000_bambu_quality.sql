-- Quality disposition is separate from a physically completed printer run.
-- It reclassifies already consumed material; never debit inventory a second time.
CREATE TABLE public.bambu_quality_rejections (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  task_id uuid NOT NULL REFERENCES bambu_production_records(task_id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  quantity integer NOT NULL CHECK(quantity>0),
  grams numeric NOT NULL CHECK(grams>=0 AND grams<'Infinity'::numeric),
  elapsed_seconds numeric NOT NULL CHECK(elapsed_seconds>=0 AND elapsed_seconds<'Infinity'::numeric),
  material_cost numeric NOT NULL CHECK(material_cost>=0 AND material_cost<'Infinity'::numeric),
  total_cost numeric NOT NULL CHECK(total_cost>=0 AND total_cost<'Infinity'::numeric),
  reason text NOT NULL CHECK(nullif(btrim(reason),'') IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX bambu_quality_rejections_task ON bambu_quality_rejections(tenant_id,task_id);
ALTER TABLE bambu_quality_rejections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bambu_quality_rejections FROM PUBLIC,anon,authenticated;
GRANT SELECT ON bambu_quality_rejections TO authenticated;
CREATE POLICY bambu_quality_rejections_read ON bambu_quality_rejections FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());

ALTER TABLE bambu_production_records
  ADD COLUMN quality_rejected_units integer NOT NULL DEFAULT 0 CHECK(quality_rejected_units>=0),
  ADD COLUMN quality_loss_grams numeric NOT NULL DEFAULT 0,
  ADD COLUMN quality_loss_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN quality_state text NOT NULL DEFAULT 'not_rejected' CHECK(quality_state IN ('not_rejected','partially_rejected','rejected'));

-- Retain historical samples without allocations. Only an explicit, audited
-- quality rejection removes a contribution. Cost uses allocated cents; grams
-- and elapsed seconds use the exact fraction of the physical run.
CREATE VIEW erp_private.accepted_bambu_production AS
SELECT r.task_id,r.product_id,r.tenant_id,r.plate_id,r.state,r.posted_at,r.outcome,r.consumption_source,
  r.units-coalesce(q.units,0) AS units,
  CASE WHEN r.total_grams IS NOT NULL THEN greatest(0,r.total_grams-coalesce(q.grams,0)) END AS total_grams,
  CASE WHEN r.elapsed_seconds IS NOT NULL THEN greatest(0,r.elapsed_seconds-coalesce(q.seconds,0)) END AS elapsed_seconds,
  CASE WHEN r.total_cost IS NOT NULL THEN greatest(0,r.total_cost-coalesce(q.cost,0)) END AS total_cost
FROM bambu_production_records r
LEFT JOIN LATERAL (
  SELECT sum(quantity)::integer units,sum(grams) grams,sum(elapsed_seconds) seconds,sum(total_cost) cost
  FROM bambu_quality_rejections q WHERE q.task_id=r.task_id AND q.tenant_id=r.tenant_id
) q ON true;
REVOKE ALL ON erp_private.accepted_bambu_production FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION erp_private.update_product_print_actuals(p_product_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p products; plate product_print_plates; metrics record; combined record; count_plates integer;
BEGIN
  SELECT * INTO p FROM products WHERE id=p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  FOR plate IN SELECT * FROM product_print_plates WHERE product_id=p.id AND tenant_id=p.tenant_id ORDER BY id FOR UPDATE LOOP
    SELECT sum(r.total_grams)/sum(r.units) AS grams,sum(r.elapsed_seconds)/sum(r.units) AS seconds,
      sum(r.total_cost)/sum(r.units) AS cost,sum(r.units)::integer AS units,
      CASE WHEN count(DISTINCT r.consumption_source)>1 THEN 'mixed' ELSE min(r.consumption_source) END AS source
      INTO metrics FROM erp_private.accepted_bambu_production r
      WHERE r.product_id=p.id AND r.tenant_id=p.tenant_id AND r.plate_id=plate.id
        AND r.state='posted' AND r.posted_at IS NOT NULL AND r.outcome='completed' AND r.units>0
        AND r.total_grams IS NOT NULL AND r.elapsed_seconds IS NOT NULL AND r.total_cost IS NOT NULL;
    UPDATE product_print_plates SET actual_grams_per_unit=metrics.grams,actual_seconds_per_unit=metrics.seconds,
      actual_cost_per_unit=metrics.cost,actual_sample_units=metrics.units,actual_source=metrics.source,
      actual_updated_at=CASE WHEN metrics.units>0 THEN now() END WHERE id=plate.id;
  END LOOP;
  SELECT count(*) INTO count_plates FROM product_print_plates WHERE product_id=p.id AND tenant_id=p.tenant_id AND is_active;
  IF count_plates>0 THEN
    SELECT CASE WHEN count(actual_grams_per_unit)=count(*) THEN sum(actual_grams_per_unit) END AS actual_grams,
      CASE WHEN count(actual_seconds_per_unit)=count(*) THEN sum(actual_seconds_per_unit) END AS actual_seconds,
      CASE WHEN count(actual_cost_per_unit)=count(*) THEN sum(actual_cost_per_unit) END AS actual_cost,
      CASE WHEN count(actual_sample_units)=count(*) THEN min(actual_sample_units) END AS units,
      CASE WHEN count(actual_source)<count(*) THEN 'partial' WHEN count(DISTINCT actual_source)>1 THEN 'mixed' ELSE min(actual_source) END AS source,
      CASE WHEN count(coalesce(actual_cost_per_unit,est_cost_per_unit))=count(*) THEN sum(coalesce(actual_cost_per_unit,est_cost_per_unit)) END AS estimate_cost,
      CASE WHEN count(coalesce(actual_grams_per_unit,est_grams/units_per_plate))=count(*) THEN sum(coalesce(actual_grams_per_unit,est_grams/units_per_plate)) END AS estimate_grams,
      CASE WHEN count(coalesce(actual_seconds_per_unit,est_time_seconds/units_per_plate))=count(*) THEN sum(coalesce(actual_seconds_per_unit,est_time_seconds/units_per_plate)) END AS estimate_seconds
      INTO combined FROM product_print_plates WHERE product_id=p.id AND tenant_id=p.tenant_id AND is_active;
    UPDATE products SET actual_print_grams_per_unit=combined.actual_grams,actual_print_seconds_per_unit=combined.actual_seconds,
      actual_print_cost_per_unit=combined.actual_cost,actual_print_sample_units=combined.units,actual_print_source=combined.source,
      actual_print_updated_at=CASE WHEN combined.units>0 THEN now() END,cost_estimate=combined.estimate_cost,
      est_grams=combined.estimate_grams*greatest(coalesce(p.prints_per_plate,1),1),
      est_time_minutes=ceil(combined.estimate_seconds*greatest(coalesce(p.prints_per_plate,1),1)/60),
      margin_percent=CASE WHEN sale_price>0 AND combined.estimate_cost IS NOT NULL THEN round((sale_price-combined.estimate_cost)/sale_price*100,2) END WHERE id=p.id;
  ELSE
    -- Legacy products with no active plates retain their unplated sample model.
    SELECT sum(r.total_grams)/sum(r.units) AS grams,sum(r.elapsed_seconds)/sum(r.units) AS seconds,
      sum(r.total_cost)/sum(r.units) AS cost,sum(r.units)::integer AS units,
      CASE WHEN count(DISTINCT r.consumption_source)>1 THEN 'mixed' ELSE min(r.consumption_source) END AS source
      INTO metrics FROM erp_private.accepted_bambu_production r WHERE r.product_id=p.id AND r.tenant_id=p.tenant_id AND r.plate_id IS NULL
        AND r.state='posted' AND r.posted_at IS NOT NULL AND r.outcome='completed' AND r.units>0
        AND r.total_grams IS NOT NULL AND r.elapsed_seconds IS NOT NULL AND r.total_cost IS NOT NULL;
    UPDATE products SET actual_print_grams_per_unit=metrics.grams,actual_print_seconds_per_unit=metrics.seconds,
      actual_print_cost_per_unit=metrics.cost,actual_print_sample_units=metrics.units,actual_print_source=metrics.source,
      actual_print_updated_at=CASE WHEN metrics.units>0 THEN now() END,
      cost_estimate=coalesce(metrics.cost,cost_estimate),
      est_grams=CASE WHEN metrics.grams IS NOT NULL THEN metrics.grams*greatest(coalesce(p.prints_per_plate,1),1) ELSE est_grams END,
      est_time_minutes=CASE WHEN metrics.seconds IS NOT NULL THEN ceil(metrics.seconds*greatest(coalesce(p.prints_per_plate,1),1)/60) ELSE est_time_minutes END,
      margin_percent=CASE WHEN sale_price>0 AND coalesce(metrics.cost,cost_estimate) IS NOT NULL THEN round((sale_price-coalesce(metrics.cost,cost_estimate))/sale_price*100,2) END WHERE id=p.id;
  END IF;
END $$;

-- Preserve the existing transition API and validation. Its private copy cannot
-- be invoked by clients to bypass the disposition transaction.
ALTER FUNCTION public.transition_job(uuid,text,numeric,numeric,numeric,text,uuid,numeric,numeric,numeric,numeric) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.transition_job(uuid,text,numeric,numeric,numeric,text,uuid,numeric,numeric,numeric,numeric) RENAME TO transition_job_before_bambu_quality;
REVOKE ALL ON FUNCTION erp_private.transition_job_before_bambu_quality(uuid,text,numeric,numeric,numeric,text,uuid,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.transition_job(p_job_id uuid,p_status text,p_actual_grams numeric DEFAULT NULL,p_actual_time_minutes numeric DEFAULT NULL,
  p_waste_grams numeric DEFAULT NULL,p_failure_reason text DEFAULT NULL,p_printer_id uuid DEFAULT NULL,
  p_secondary_actual_grams numeric DEFAULT NULL,p_actual_labor_cost numeric DEFAULT NULL,p_actual_overhead numeric DEFAULT NULL,p_actual_extras_cost numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); j jobs; r bambu_production_records; a bambu_production_allocations;
  result uuid; previous_rejections integer; rejected record;
BEGIN
  IF p_status IS DISTINCT FROM 'failed' OR NOT EXISTS(
    SELECT 1 FROM bambu_production_allocations alloc JOIN bambu_production_records rec ON rec.task_id=alloc.task_id AND rec.tenant_id=alloc.tenant_id
    WHERE alloc.job_id=p_job_id AND alloc.tenant_id=t AND rec.state='posted' AND rec.posted_at IS NOT NULL AND rec.outcome='completed'
  ) THEN
    RETURN erp_private.transition_job_before_bambu_quality(p_job_id,p_status,p_actual_grams,p_actual_time_minutes,p_waste_grams,p_failure_reason,p_printer_id,p_secondary_actual_grams,p_actual_labor_cost,p_actual_overhead,p_actual_extras_cost);
  END IF;

  -- Match order/job lock ordering used by the accounting and order RPCs.
  PERFORM 1 FROM orders WHERE id=(SELECT order_id FROM jobs WHERE id=p_job_id AND tenant_id=t) FOR UPDATE;
  SELECT * INTO j FROM jobs WHERE id=p_job_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de impressão não encontrada.'; END IF;
  SELECT * INTO a FROM bambu_production_allocations WHERE job_id=j.id AND tenant_id=t;
  SELECT * INTO r FROM bambu_production_records WHERE task_id=a.task_id AND tenant_id=t FOR UPDATE;
  -- Lock product before printer: reference updates use this same order.
  PERFORM 1 FROM products WHERE id=r.product_id AND tenant_id=t FOR UPDATE;
  PERFORM 1 FROM printers WHERE id=j.printer_id AND tenant_id=t FOR UPDATE;

  -- Repeated requests for the same final state are harmless. The legacy RPC
  -- still checks cancellation and rejects any attempted printer reassignment.
  IF EXISTS(SELECT 1 FROM bambu_quality_rejections WHERE job_id=j.id AND tenant_id=t) THEN
    RETURN erp_private.transition_job_before_bambu_quality(p_job_id,p_status,p_actual_grams,p_actual_time_minutes,p_waste_grams,p_failure_reason,p_printer_id,p_secondary_actual_grams,p_actual_labor_cost,p_actual_overhead,p_actual_extras_cost);
  END IF;
  IF j.status<>'quality_check' OR j.inventory_posted_at IS NULL OR r.units IS NULL OR r.units<=0 OR a.quantity>r.units THEN
    RAISE EXCEPTION 'A rejeição de qualidade exige uma ordem em conferência com execução e consumo já apurados.';
  END IF;
  SELECT count(*)::integer INTO previous_rejections FROM bambu_quality_rejections WHERE task_id=r.task_id AND tenant_id=t;
  result:=erp_private.transition_job_before_bambu_quality(p_job_id,p_status,p_actual_grams,p_actual_time_minutes,p_waste_grams,p_failure_reason,p_printer_id,p_secondary_actual_grams,p_actual_labor_cost,p_actual_overhead,p_actual_extras_cost);

  INSERT INTO bambu_quality_rejections(job_id,task_id,tenant_id,quantity,grams,elapsed_seconds,material_cost,total_cost,reason,created_by)
  VALUES(j.id,r.task_id,t,a.quantity,r.total_grams*a.quantity/r.units,r.elapsed_seconds*a.quantity/r.units,
    j.actual_material_cost,j.actual_total_cost,btrim(p_failure_reason),auth.uid());
  UPDATE jobs SET produced_quantity=0,waste_grams=actual_grams WHERE id=j.id;
  -- The legacy transition increments failures once per job. Allocated jobs can
  -- share a physical run: retain only the first quality rejection increment.
  IF previous_rejections>0 THEN
    UPDATE printers SET total_failures=greatest(0,coalesce(total_failures,0)-1) WHERE id=j.printer_id AND tenant_id=t;
  END IF;
  SELECT sum(quantity)::integer units,sum(grams) grams,sum(total_cost) cost INTO rejected
    FROM bambu_quality_rejections WHERE task_id=r.task_id AND tenant_id=t;
  IF rejected.units>r.units THEN RAISE EXCEPTION 'As rejeições excedem as unidades da execução.'; END IF;
  UPDATE bambu_production_records SET quality_rejected_units=rejected.units,quality_loss_grams=rejected.grams,
    quality_loss_cost=rejected.cost,quality_state=CASE WHEN rejected.units=r.units THEN 'rejected' ELSE 'partially_rejected' END,
    updated_at=now() WHERE task_id=r.task_id;
  PERFORM erp_private.update_product_print_actuals(r.product_id);
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
    VALUES(t,auth.uid(),'quality_rejection','jobs',j.id,jsonb_build_object('task_id',r.task_id,'quantity',a.quantity,'already_consumed',true,'physical_outcome',r.outcome));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.transition_job(uuid,text,numeric,numeric,numeric,text,uuid,numeric,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_job(uuid,text,numeric,numeric,numeric,text,uuid,numeric,numeric,numeric,numeric) TO authenticated;

CREATE OR REPLACE VIEW public.bambu_production_review WITH(security_invoker=true) AS
  SELECT b.id AS task_id,b.tenant_id,b.bambu_task_id,b.design_title,d.name AS device_name,b.start_time AS started_at,b.end_time AS ended_at,b.status AS raw_status,
    CASE b.status WHEN '2' THEN 'completed' WHEN '3' THEN 'failed' WHEN '1' THEN 'printing' WHEN '4' THEN 'printing' ELSE 'unknown' END AS outcome,
    coalesce(r.state,'unlinked') AS state,r.problem,b.weight_grams AS planned_grams,
    CASE WHEN r.posted_at IS NOT NULL THEN r.elapsed_seconds ELSE CASE WHEN b.status IN ('2','3') AND b.end_time>b.start_time AND b.end_time-b.start_time<=interval '60 days' THEN extract(epoch FROM b.end_time-b.start_time) END END AS elapsed_seconds,
    r.posted_at,r.total_cost,r.product_id,p.name AS product_name,r.units,r.consumption_source,coalesce(r.auto_enabled,false) AS auto_enabled,
    CASE WHEN r.posted_at IS NOT NULL AND r.outcome='completed' THEN greatest(0,r.units-r.quality_rejected_units) ELSE 0 END AS completed_units,
  r.plate_id,pl.label AS plate_label,pl.plate_index,
  coalesce(r.quality_state,'not_rejected') AS quality_state,coalesce(r.quality_rejected_units,0) AS quality_rejected_units,
  coalesce(r.quality_loss_grams,0) AS quality_loss_grams,coalesce(r.quality_loss_cost,0) AS quality_loss_cost
  FROM bambu_tasks b LEFT JOIN bambu_devices d ON d.id=b.bambu_device_id AND d.tenant_id=b.tenant_id
    LEFT JOIN bambu_production_records r ON r.task_id=b.id AND r.tenant_id=b.tenant_id LEFT JOIN products p ON p.id=r.product_id AND p.tenant_id=b.tenant_id
    LEFT JOIN product_print_plates pl ON pl.id=r.plate_id AND pl.tenant_id=b.tenant_id;
