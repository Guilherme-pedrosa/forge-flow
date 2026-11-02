-- New sellers are authorized at the Integrador. Its proof never reaches a browser.
ALTER TABLE public.integrador_bridge_bindings ADD COLUMN allow_enrollment boolean NOT NULL DEFAULT false;
ALTER TABLE public.integrador_bridge_bindings DROP CONSTRAINT integrador_bridge_bindings_approved_seller_ids_check;
ALTER TABLE public.integrador_bridge_bindings ADD CONSTRAINT integrador_bridge_seller_scope
 CHECK(cardinality(approved_seller_ids) BETWEEN 0 AND 20 AND array_position(approved_seller_ids,NULL) IS NULL
  AND (cardinality(approved_seller_ids)>0 OR allow_enrollment));

CREATE TABLE erp_private.integrador_enrollment_proofs (
 bridge_id uuid PRIMARY KEY REFERENCES public.integrador_bridge_bindings(id) ON DELETE CASCADE,
 proof_sha256 text NOT NULL CHECK(proof_sha256 ~ '^[a-f0-9]{64}$'),
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE erp_private.integrador_enrollment_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.integrador_enrollment_proofs FROM PUBLIC,anon,authenticated;
GRANT ALL ON erp_private.integrador_enrollment_proofs TO service_role;

CREATE OR REPLACE FUNCTION public.integrador_bridge_binding() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); b integrador_bridge_bindings; value jsonb;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Sessão Forge obrigatória.' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE tenant_id=t;
 value:=jsonb_build_object('configured',b.id IS NOT NULL AND b.enabled,'bridge_id',b.id,'source_url',coalesce(b.source_url,'https://integradorwedo.lovable.app'),
  'revision',CASE WHEN b.id IS NOT NULL THEN md5(to_jsonb(b)::text) ELSE 'unconfigured' END,'enabled',coalesce(b.enabled,false),
  'approved_seller_ids',coalesce(to_jsonb(b.approved_seller_ids),'[]'),
  'account_mappings',coalesce((SELECT jsonb_agg(jsonb_build_object('account_id',account_id,'source_seller_id',source_seller_id,'bridge_id',bridge_id) ORDER BY account_id) FROM integrador_marketplace_account_links WHERE tenant_id=t AND bridge_id=b.id),'[]'));
 -- Keep the old shape for tenants that do not use new-account authorization.
 IF coalesce(b.allow_enrollment,false) THEN value:=value||jsonb_build_object('allow_enrollment',b.enabled AND EXISTS(
  SELECT 1 FROM erp_private.integrador_enrollment_proofs WHERE bridge_id=b.id AND enabled)); END IF;
 RETURN value;
END $$;

CREATE FUNCTION public.complete_integrador_marketplace_enrollment(
 p_bridge_id uuid,p_source_seller_id text,p_nickname text,p_account_id uuid,p_request_id uuid,p_source_proof text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); b integrador_bridge_bindings; a marketplace_accounts;
 result uuid; link_request uuid; replayed boolean:=false;
BEGIN
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=p_bridge_id AND tenant_id=t FOR UPDATE;
 IF b.id IS NULL OR NOT b.enabled OR NOT b.allow_enrollment OR p_request_id IS NULL
  OR coalesce(p_source_proof,'') !~ '^[a-f0-9]{64}$' OR NOT EXISTS(
   SELECT 1 FROM erp_private.integrador_enrollment_proofs WHERE bridge_id=b.id AND enabled
    AND proof_sha256=encode(sha256(convert_to(p_source_proof,'UTF8')),'hex')) THEN
  RAISE EXCEPTION 'A autorização desta conta precisa ser confirmada pelo Integrador.' USING ERRCODE='42501';
 END IF;
 IF coalesce(p_source_seller_id,'') !~ '^[1-9][0-9]{0,23}$' OR length(coalesce(btrim(p_nickname),'')) NOT BETWEEN 1 AND 120
  OR p_nickname ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Identificação da conta autorizada inválida.'; END IF;
 result:=erp_private.begin_request(t,p_request_id,'complete_integrador_marketplace_enrollment',jsonb_build_array(b.id,p_source_seller_id,p_nickname,p_account_id));
 IF result IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM integrador_marketplace_account_links WHERE account_id=result AND tenant_id=t AND bridge_id=b.id AND source_seller_id=p_source_seller_id) THEN
   RAISE EXCEPTION 'O vínculo mudou após a autorização. Confira a conta antes de continuar.';
  END IF;
  RETURN jsonb_build_object('connected',true,'account_id',result,'seller_id',p_source_seller_id,'replayed',true);
 END IF;
 IF p_account_id IS NOT NULL THEN
  SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t FOR UPDATE;
  IF a.id IS NULL OR a.channel<>'mercado_livre' OR(a.external_seller_id IS NOT NULL AND a.external_seller_id<>p_source_seller_id) THEN
   RAISE EXCEPTION 'Escolha o cadastro da conta que será conectada nesta empresa.';
  END IF;
  IF EXISTS(SELECT 1 FROM marketplace_credentials WHERE account_id=a.id) THEN RAISE EXCEPTION 'Preserve a autorização própria desta conta; escolha outro cadastro.'; END IF;
  IF EXISTS(SELECT 1 FROM marketplace_oauth_states WHERE account_id=a.id AND expires_at>now()) THEN
   RAISE EXCEPTION 'Há outra autorização em andamento para esta conta. Conclua ou cancele essa tentativa antes de continuar.';
  END IF;
  IF a.external_seller_id IS NULL AND (
   EXISTS(SELECT 1 FROM marketplace_orders WHERE account_id=a.id) OR EXISTS(SELECT 1 FROM marketplace_events WHERE account_id=a.id)
   OR EXISTS(SELECT 1 FROM marketplace_sku_bindings WHERE account_id=a.id)) THEN
   RAISE EXCEPTION 'Este cadastro tem histórico sem vendedor identificado. Crie outro cadastro para preservar os dados.';
  END IF;
 END IF;
 IF NOT(p_source_seller_id=ANY(b.approved_seller_ids)) THEN
  IF cardinality(b.approved_seller_ids)>=20 THEN RAISE EXCEPTION 'Confira o limite de contas desta conexão.'; END IF;
  UPDATE integrador_bridge_bindings SET approved_seller_ids=array_append(approved_seller_ids,p_source_seller_id),updated_at=clock_timestamp() WHERE id=b.id;
 END IF;
 -- The nested mapping command uses a stable, distinct idempotency key.
 link_request:=md5('integrador-enrollment-link:'||p_request_id::text)::uuid;
 result:=link_integrador_marketplace_account(p_source_seller_id,btrim(p_nickname),p_account_id,link_request);
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
  VALUES(t,auth.uid(),'enroll_integrador_account','marketplace_accounts',result,
   jsonb_build_object('bridge_id',b.id,'source_seller_id',p_source_seller_id,'authorization_request',p_request_id,'credentials_owner','integrador'));
 PERFORM erp_private.finish_request(t,p_request_id,result);
 RETURN jsonb_build_object('connected',true,'account_id',result,'seller_id',p_source_seller_id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.complete_integrador_marketplace_enrollment(uuid,text,text,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_integrador_marketplace_enrollment(uuid,text,text,uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
