-- Confirm absolute physical counts against the balances actually shown to the
-- operator. A purchase received meanwhile must never be erased by a cached delta.
CREATE FUNCTION public.post_inventory_count(p_items jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; line jsonb; item_id uuid; ids uuid[]:='{}';
 target numeric; expected numeric; locked integer; child_request uuid;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'inventory_count',p_items);
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'Confira de 1 a 500 itens por conferência de estoque.' USING ERRCODE='22023';
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR line-ARRAY['item_id','current_stock','expected_stock']<>'{}'
   OR jsonb_typeof(line->'item_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(line->'current_stock') IS DISTINCT FROM 'number'
   OR jsonb_typeof(line->'expected_stock') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION 'Informe o item, o saldo conferido e o saldo anterior mostrado na tela.' USING ERRCODE='22023';
  END IF;
  item_id:=(line->>'item_id')::uuid; target:=(line->>'current_stock')::numeric; expected:=(line->>'expected_stock')::numeric;
  IF item_id=ANY(ids) THEN RAISE EXCEPTION 'O mesmo item não pode aparecer duas vezes na conferência.'; END IF;
  IF NOT erp_private.valid_number(target) OR NOT erp_private.valid_number(expected)
   OR target<>round(target,6) OR expected<>round(expected,6) THEN
   RAISE EXCEPTION 'Informe saldos maiores ou iguais a zero, com até seis casas decimais.' USING ERRCODE='22023';
  END IF;
  ids:=array_append(ids,item_id);
 END LOOP;
 -- A stable inventory lock order also matches purchase receiving. Validate
 -- every snapshot before accepting any count; a later failure rolls all back.
 PERFORM 1 FROM inventory_items WHERE tenant_id=t AND is_active AND id=ANY(ids) ORDER BY id FOR UPDATE;
 GET DIAGNOSTICS locked=ROW_COUNT;
 IF locked<>cardinality(ids) THEN RAISE EXCEPTION 'Selecione somente itens ativos da sua empresa.' USING ERRCODE='42501'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  item_id:=(line->>'item_id')::uuid;
  child_request:=md5(p_request_id::text||'/inventory-count/'||item_id::text)::uuid;
  PERFORM public.save_inventory_catalog(item_id,jsonb_build_object('current_stock',line->'current_stock','expected_stock',line->'expected_stock'),child_request);
 END LOOP;
 result:=ids[1];
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
  VALUES(t,auth.uid(),'confirm_stock_count','inventory_items',result,jsonb_build_object('request_id',p_request_id,'counts',p_items));
 PERFORM erp_private.finish_request(t,p_request_id,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.post_inventory_count(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_inventory_count(jsonb,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
