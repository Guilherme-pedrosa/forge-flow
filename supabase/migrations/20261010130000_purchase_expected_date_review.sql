-- Revise only the delivery forecast of a saved pending purchase, including XML
-- imports. Commercial lines, titles, receipts and physical stock stay intact.
CREATE FUNCTION public.set_purchase_expected_date(
  p_order_id uuid, p_expected_date text, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  t uuid:=erp_private.actor(true);
  previous uuid;
  po purchase_orders;
  delivery date;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'Informe a compra para revisar a previsão.'; END IF;
  -- This required argument accepts explicit NULL to clear the forecast. A date
  -- is accepted only in canonical ISO form and with a real calendar day.
  IF p_expected_date IS NOT NULL THEN
    IF p_expected_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Informe uma previsão válida no formato AAAA-MM-DD.';
    END IF;
    BEGIN
      delivery:=p_expected_date::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Informe uma previsão válida no calendário.';
    END;
    IF to_char(delivery,'YYYY-MM-DD') IS DISTINCT FROM p_expected_date THEN
      RAISE EXCEPTION 'Informe uma previsão válida no calendário.';
    END IF;
  END IF;

  previous:=erp_private.begin_request(t,p_request_id,'purchase_expected_date',jsonb_build_array(p_order_id,p_expected_date));
  IF previous IS NOT NULL THEN RETURN previous; END IF;
  SELECT * INTO po FROM purchase_orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra não encontrada nesta empresa.'; END IF;
  IF po.status<>'pending' THEN RAISE EXCEPTION 'A previsão pode ser revisada somente em compras pendentes.'; END IF;

  IF po.expected_date IS DISTINCT FROM delivery THEN
    UPDATE purchase_orders SET expected_date=delivery WHERE id=po.id AND tenant_id=t;
    INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,old_data,new_data,metadata)
    VALUES(t,auth.uid(),'purchase_expected_date_review','purchase_orders',po.id,
      jsonb_build_object('expected_date',po.expected_date),jsonb_build_object('expected_date',delivery),
      jsonb_build_object('request_id',p_request_id));
  END IF;
  PERFORM erp_private.finish_request(t,p_request_id,po.id);
  RETURN po.id;
END $$;
REVOKE ALL ON FUNCTION public.set_purchase_expected_date(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_purchase_expected_date(uuid,text,uuid) TO authenticated;

-- A read-only capability check lets the detail view handle an older database
-- before presenting a save action, and honors the financial write role policy.
CREATE FUNCTION public.purchase_expected_date_review_available() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND get_user_tenant_id() IS NOT NULL
    AND erp_can_write(true)
    AND to_regprocedure('public.set_purchase_expected_date(uuid,text,uuid)') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.purchase_expected_date_review_available() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.purchase_expected_date_review_available() TO authenticated;

NOTIFY pgrst, 'reload schema';
