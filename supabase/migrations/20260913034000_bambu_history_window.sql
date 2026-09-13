-- A successful page is not proof of a complete history. The cloud can return
-- fewer rows than the requested limit; use its total only when it is coherent.
CREATE FUNCTION erp_private.bambu_history_may_be_truncated(p_data jsonb,p_count integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE reported_total numeric;
BEGIN
  IF p_count IS NULL OR p_count<0 OR jsonb_typeof(p_data->'total') IS DISTINCT FROM 'number' THEN RETURN true; END IF;
  reported_total:=(p_data->>'total')::numeric;
  IF reported_total<>trunc(reported_total) OR reported_total<p_count THEN RETURN true; END IF;
  RETURN reported_total>p_count;
END $$;
REVOKE ALL ON FUNCTION erp_private.bambu_history_may_be_truncated(jsonb,integer) FROM PUBLIC,anon,authenticated;

-- Preserve the already deployed worker and its request/cooldown contract.
-- Refuse to patch a different function definition instead of silently drifting.
DO $$
DECLARE definition text; old_expression text:='history_may_be_truncated=task_count=500'; matches integer;
BEGIN
  SELECT pg_get_functiondef('erp_private.bambu_sync_process(uuid)'::regprocedure) INTO definition;
  matches:=(length(definition)-length(replace(definition,old_expression,'')))/length(old_expression);
  IF matches<>1 THEN RAISE EXCEPTION 'Definição do sincronizador Bambu divergente: esperada uma expressão de janela histórica.'; END IF;
  EXECUTE replace(definition,old_expression,'history_may_be_truncated=erp_private.bambu_history_may_be_truncated(data,task_count)');
END $$;

-- Previously observed 20-row pages may have been silently capped by the cloud.
-- The next successful response will replace this conservative indication.
UPDATE public.bambu_sync_state SET history_may_be_truncated=true,updated_at=now()
WHERE last_success_at IS NOT NULL AND tasks_received>=20;
