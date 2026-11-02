-- Preserve explicitly confirmed financial classification on purchase installments.
-- Purchase values, request identities, receipt allocation and posted history stay intact.
DO $$
DECLARE definition text; source_hash text;
 needles text[]:=ARRAY[$patch$    PERFORM erp_private.assert_ref('payment_methods',nullif(part->>'payment_method_id','')::uuid,t);$patch$,
$patch$competence_date,payment_method_id,installment_number,installment_total,notes,created_by,origin_type,origin_id)$patch$,
$patch$nullif(part->>'payment_method_id','')::uuid,coalesce((part->>'installment_number')::integer,1)$patch$];
 replacements text[]:=ARRAY[$patch$    PERFORM erp_private.assert_ref('payment_methods',nullif(part->>'payment_method_id','')::uuid,t);
    PERFORM erp_private.assert_ref('chart_of_accounts',nullif(part->>'account_id','')::uuid,t);
    PERFORM erp_private.assert_ref('cost_centers',nullif(part->>'cost_center_id','')::uuid,t);
    IF nullif(part->>'account_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chart_of_accounts WHERE id=(part->>'account_id')::uuid AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Selecione uma classificação financeira ativa desta empresa.'; END IF;
    IF nullif(part->>'cost_center_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cost_centers WHERE id=(part->>'cost_center_id')::uuid AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Selecione um centro de custo ativo desta empresa.'; END IF;$patch$,
$patch$competence_date,payment_method_id,account_id,cost_center_id,installment_number,installment_total,notes,created_by,origin_type,origin_id)$patch$,
$patch$nullif(part->>'payment_method_id','')::uuid,nullif(part->>'account_id','')::uuid,nullif(part->>'cost_center_id','')::uuid,coalesce((part->>'installment_number')::integer,1)$patch$];
 n integer;
BEGIN
 SELECT pg_get_functiondef(p.oid),md5(replace(p.prosrc,chr(13),'')) INTO definition,source_hash
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.create_purchase_order(jsonb,jsonb,jsonb,uuid)');
 IF source_hash='e43955469451409d7f8018f19c2e7253' THEN RETURN; END IF;
 IF source_hash IS DISTINCT FROM '91fab98c6b56d138bd26da9ad27ddf51' THEN RAISE EXCEPTION 'Review the purchase installment writer before applying financial classification.'; END IF;
 FOR n IN 1..array_length(needles,1) LOOP
  IF length(definition)-length(replace(definition,needles[n],''))<>length(needles[n]) THEN RAISE EXCEPTION 'Review the purchase classification patch.'; END IF;
  definition:=replace(definition,needles[n],replacements[n]);
 END LOOP;
 EXECUTE definition;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.create_purchase_order(jsonb,jsonb,jsonb,uuid)')) IS DISTINCT FROM 'e43955469451409d7f8018f19c2e7253' THEN
  RAISE EXCEPTION 'The purchase installment writer does not match the reviewed financial classification.';
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
