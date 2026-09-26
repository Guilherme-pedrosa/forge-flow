-- Complete customer/vendor forms share the same contract and keep existing IDs.
ALTER TABLE customers ADD COLUMN registration_details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN registration_details jsonb NOT NULL DEFAULT '{}';

CREATE FUNCTION public.save_partner(p_kind text,p_id uuid,p_data jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; target text; details jsonb; k text; current_stamp timestamptz;
BEGIN
 target:=CASE p_kind WHEN 'customer' THEN 'customers' WHEN 'vendor' THEN 'vendors' END;
 IF target IS NULL THEN RAISE EXCEPTION 'Cadastro inválido.'; END IF;
 result:=erp_private.begin_request(t,p_request_id,'save_partner',jsonb_build_array(p_kind,p_id,p_data));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR nullif(btrim(p_data->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Informe o nome.'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_data) LOOP
   IF NOT k=ANY(ARRAY['name','email','phone','document','address','birthday','notes','is_active','registration_details','expected_updated_at']) THEN RAISE EXCEPTION 'Campo não permitido: %',k; END IF;
 END LOOP;
 details:=coalesce(p_data->'registration_details','{}');
 IF jsonb_typeof(details)<>'object' OR octet_length(details::text)>100000 THEN RAISE EXCEPTION 'Dados adicionais inválidos.'; END IF;
 IF details ? 'person_type' AND details->>'person_type' NOT IN('individual','company','foreign') THEN RAISE EXCEPTION 'Tipo de pessoa inválido.'; END IF;
 IF details ? 'addresses' AND jsonb_typeof(details->'addresses')<>'array' THEN RAISE EXCEPTION 'Endereços inválidos.'; END IF;
 IF details ? 'contacts' AND jsonb_typeof(details->'contacts')<>'array' THEN RAISE EXCEPTION 'Contatos inválidos.'; END IF;
 IF p_id IS NOT NULL THEN
   EXECUTE format('SELECT updated_at FROM %I WHERE id=$1 AND tenant_id=$2 FOR UPDATE',target) INTO current_stamp USING p_id,t;
   IF current_stamp IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
   IF nullif(p_data->>'expected_updated_at','')::timestamptz IS DISTINCT FROM current_stamp THEN RAISE EXCEPTION 'O cadastro foi alterado. Atualize antes de salvar.'; END IF;
 END IF;
 result:=coalesce(p_id,gen_random_uuid());
 EXECUTE format('INSERT INTO %I(id,tenant_id,name,email,phone,document,address,notes,is_active,registration_details)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,
 phone=excluded.phone,document=excluded.document,address=excluded.address,notes=excluded.notes,is_active=excluded.is_active,
 registration_details=excluded.registration_details,updated_at=now()',target)
 USING result,t,btrim(p_data->>'name'),nullif(btrim(p_data->>'email'),''),nullif(btrim(p_data->>'phone'),''),
 nullif(btrim(p_data->>'document'),''),nullif(p_data->'address','null'),nullif(btrim(p_data->>'notes'),''),coalesce((p_data->>'is_active')::boolean,true),details;
 IF p_kind='customer' THEN UPDATE customers SET birthday=nullif(p_data->>'birthday','')::date WHERE id=result; END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'save',target,result);
 PERFORM erp_private.finish_request(t,p_request_id,result);RETURN result;
END $$;

CREATE FUNCTION public.delete_partner(p_kind text,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); target text; found_id uuid;
BEGIN
 target:=CASE p_kind WHEN 'customer' THEN 'customers' WHEN 'vendor' THEN 'vendors' END;
 IF target IS NULL THEN RAISE EXCEPTION 'Cadastro inválido.'; END IF;
 EXECUTE format('DELETE FROM %I WHERE id=$1 AND tenant_id=$2 RETURNING id',target) INTO found_id USING p_id,t;
 IF found_id IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'delete',target,p_id);
EXCEPTION WHEN foreign_key_violation THEN
 RAISE EXCEPTION 'Este cadastro possui documentos vinculados. Use Inativar para retirá-lo das novas operações e preservar o histórico.';
END $$;
REVOKE ALL ON FUNCTION public.save_partner(text,uuid,jsonb,uuid),public.delete_partner(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_partner(text,uuid,jsonb,uuid),public.delete_partner(text,uuid) TO authenticated;
