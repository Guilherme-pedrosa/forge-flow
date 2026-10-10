-- A posted material debit invalidates an old physical weight even when the
-- operator did not reserve a specific spool. No spool mass is guessed and no
-- additional inventory movement is posted here.
CREATE OR REPLACE FUNCTION erp_private.finish_filament_reservations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r filament_reservations; s filament_spools; identified_items uuid[];
BEGIN
 IF NEW.inventory_posted_at IS NOT NULL AND OLD.inventory_posted_at IS NULL THEN
  SELECT coalesce(array_agg(DISTINCT item_id),'{}'::uuid[]) INTO identified_items
   FROM filament_reservations WHERE job_id=NEW.id AND tenant_id=NEW.tenant_id
    AND status='reserved' AND spool_id IS NOT NULL;
  FOR r IN SELECT * FROM filament_reservations
   WHERE job_id=NEW.id AND tenant_id=NEW.tenant_id AND status='reserved' FOR UPDATE LOOP
   IF r.spool_id IS NOT NULL THEN
    SELECT * INTO s FROM filament_spools WHERE id=r.spool_id AND tenant_id=NEW.tenant_id FOR UPDATE;
    UPDATE filament_spools SET needs_weighing=true,updated_at=now() WHERE id=s.id;
    INSERT INTO filament_spool_events(tenant_id,spool_id,event_type,before_data,after_data,reason,created_by)
     VALUES(NEW.tenant_id,s.id,'consumption_pending',to_jsonb(s),
      jsonb_build_object('job_id',NEW.id,'reserved_grams',r.grams,'spool_identified',true),
      'Consumo lançado no estoque. Pese a bobina reservada para conferir o saldo físico.',auth.uid());
   END IF;
   UPDATE filament_reservations SET status='consumed',released_at=now(),updated_at=now() WHERE id=r.id;
  END LOOP;
  -- Manual consumption is already in the job ledger. Bambu allocations carry
  -- the actual per-material usage on the job before this trigger runs.
  FOR s IN SELECT f.* FROM filament_spools f WHERE f.tenant_id=NEW.tenant_id AND f.is_active
   AND NOT(f.item_id=ANY(identified_items)) AND f.item_id IN (
    SELECT movement.item_id FROM inventory_movements movement
     WHERE movement.tenant_id=NEW.tenant_id AND movement.reference_type='job'
      AND movement.reference_id=NEW.id AND movement.quantity>0
      AND movement.movement_type IN('job_consumption','loss')
    UNION
    SELECT (usage->>'item_id')::uuid FROM jsonb_array_elements(coalesce(NEW.actual_material_usage,'[]'::jsonb)) usage
     WHERE (usage->>'grams')::numeric>0
   ) ORDER BY f.item_id,f.id FOR UPDATE LOOP
   UPDATE filament_spools SET needs_weighing=true,updated_at=now() WHERE id=s.id;
   INSERT INTO filament_spool_events(tenant_id,spool_id,event_type,before_data,after_data,reason,created_by)
    VALUES(NEW.tenant_id,s.id,'consumption_pending',to_jsonb(s),
     jsonb_build_object('job_id',NEW.id,'spool_identified',false),
     'Consumo do material lançado sem bobina identificada. Confira as bobinas deste material; não foi atribuído consumo nem peso restante a uma bobina específica.',auth.uid());
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.finish_filament_reservations() FROM PUBLIC,anon,authenticated;
