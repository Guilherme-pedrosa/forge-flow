-- Approved public bridge references only. Credentials remain in the Integrador.
CREATE TABLE public.integrador_bridge_bindings (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
 source_url text NOT NULL DEFAULT 'https://integradorwedo.lovable.app' CHECK(source_url='https://integradorwedo.lovable.app'),
 approved_seller_ids text[] NOT NULL CHECK(cardinality(approved_seller_ids) BETWEEN 1 AND 20),
 enabled boolean NOT NULL DEFAULT true, approved_by uuid REFERENCES auth.users(id),
 approval_note text NOT NULL CHECK(length(btrim(approval_note)) BETWEEN 10 AND 2000),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.integrador_marketplace_account_links (
 account_id uuid PRIMARY KEY REFERENCES marketplace_accounts(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 bridge_id uuid NOT NULL REFERENCES integrador_bridge_bindings(id), source_seller_id text NOT NULL CHECK(source_seller_id ~ '^[0-9]{1,24}$'),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,source_seller_id)
);
ALTER TABLE integrador_bridge_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrador_marketplace_account_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON integrador_bridge_bindings,integrador_marketplace_account_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON integrador_bridge_bindings,integrador_marketplace_account_links TO authenticated;
GRANT ALL ON integrador_bridge_bindings,integrador_marketplace_account_links TO service_role;
CREATE POLICY tenant_read ON integrador_bridge_bindings FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE POLICY tenant_read ON integrador_marketplace_account_links FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON integrador_bridge_bindings FOR EACH ROW EXECUTE FUNCTION erp_immutable_tenant();
CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON integrador_marketplace_account_links FOR EACH ROW EXECUTE FUNCTION erp_immutable_tenant();
CREATE TRIGGER erp_tenant_references BEFORE INSERT OR UPDATE ON integrador_marketplace_account_links FOR EACH ROW EXECUTE FUNCTION erp_check_tenant_references();

CREATE FUNCTION public.integrador_bridge_binding() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); b integrador_bridge_bindings;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Sessão Forge obrigatória.' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE tenant_id=t;
 RETURN jsonb_build_object('configured',b.id IS NOT NULL AND b.enabled,'bridge_id',b.id,'source_url',coalesce(b.source_url,'https://integradorwedo.lovable.app'),
  'revision',CASE WHEN b.id IS NOT NULL THEN md5(to_jsonb(b)::text) ELSE 'unconfigured' END,'enabled',coalesce(b.enabled,false),
  'approved_seller_ids',coalesce(to_jsonb(b.approved_seller_ids),'[]'),
  'account_mappings',coalesce((SELECT jsonb_agg(jsonb_build_object('account_id',account_id,'source_seller_id',source_seller_id,'bridge_id',bridge_id) ORDER BY account_id) FROM integrador_marketplace_account_links WHERE tenant_id=t AND bridge_id=b.id),'[]'));
END $$;

CREATE FUNCTION public.link_integrador_marketplace_account(p_source_seller_id text,p_name text,p_account_id uuid,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); b integrador_bridge_bindings; a marketplace_accounts; result uuid; prior integrador_marketplace_account_links;
BEGIN
 SELECT * INTO b FROM integrador_bridge_bindings WHERE tenant_id=t AND enabled FOR UPDATE;
 IF b.id IS NULL OR coalesce(p_source_seller_id,'') !~ '^[0-9]{1,24}$' OR NOT(p_source_seller_id=ANY(b.approved_seller_ids)) THEN RAISE EXCEPTION 'Vendedor fora do vínculo aprovado.'; END IF;
 IF length(coalesce(btrim(p_name),'')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Informe o nome da conta.'; END IF;
 result:=erp_private.begin_request(t,p_request_id,'link_integrador_marketplace_account',jsonb_build_array(p_source_seller_id,p_name,p_account_id));
 IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_account_id IS NOT NULL THEN
  SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t FOR UPDATE;
  IF a.id IS NULL OR a.channel<>'mercado_livre' OR(a.external_seller_id IS NOT NULL AND a.external_seller_id<>p_source_seller_id) THEN RAISE EXCEPTION 'A conta selecionada pertence a outro vendedor ou empresa.'; END IF;
 ELSE
  SELECT * INTO a FROM marketplace_accounts WHERE tenant_id=t AND channel='mercado_livre' AND external_seller_id=p_source_seller_id FOR UPDATE;
 END IF;
 IF a.id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM marketplace_credentials WHERE account_id=a.id) THEN RAISE EXCEPTION 'Preserve a autorização própria desta conta. Não transfira suas credenciais para o Integrador.'; END IF;
  IF a.external_seller_id IS NULL AND EXISTS(SELECT 1 FROM marketplace_orders WHERE account_id=a.id) THEN RAISE EXCEPTION 'A conta possui histórico sem vendedor identificado. Cadastre outra conta para preservar esse histórico.'; END IF;
  SELECT * INTO prior FROM integrador_marketplace_account_links WHERE account_id=a.id;
  IF prior.account_id IS NOT NULL AND(prior.bridge_id<>b.id OR prior.source_seller_id<>p_source_seller_id) THEN RAISE EXCEPTION 'A conta já tem outro vínculo de origem.'; END IF;
  UPDATE marketplace_accounts SET external_seller_id=p_source_seller_id,updated_at=clock_timestamp() WHERE id=a.id;
 ELSE
  INSERT INTO marketplace_accounts(tenant_id,channel,name,external_seller_id,connection_state) VALUES(t,'mercado_livre',btrim(p_name),p_source_seller_id,'import_only') RETURNING * INTO a;
 END IF;
 INSERT INTO integrador_marketplace_account_links(account_id,tenant_id,bridge_id,source_seller_id,created_by) VALUES(a.id,t,b.id,p_source_seller_id,auth.uid()) ON CONFLICT(account_id) DO NOTHING;
 -- An older native OAuth attempt must not create a second credential owner.
 DELETE FROM marketplace_oauth_states WHERE account_id=a.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'link_integrador','marketplace_accounts',a.id,jsonb_build_object('bridge_id',b.id,'seller_id',p_source_seller_id,'credentials_owner','integrador','automatic_stock_write',false));
 PERFORM erp_private.finish_request(t,p_request_id,a.id);RETURN a.id;
END $$;
REVOKE ALL ON FUNCTION public.integrador_bridge_binding(),public.link_integrador_marketplace_account(text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.integrador_bridge_binding(),public.link_integrador_marketplace_account(text,text,uuid,uuid) TO authenticated;

CREATE FUNCTION erp_private.guard_integrador_credential_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM marketplace_accounts WHERE id=NEW.account_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM integrador_marketplace_account_links WHERE account_id=NEW.account_id) THEN
  RAISE EXCEPTION 'Esta conta usa a autorização do Integrador. Preserve o proprietário único das credenciais.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.guard_integrador_credential_owner() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER integrador_credential_owner BEFORE INSERT OR UPDATE ON marketplace_credentials FOR EACH ROW EXECUTE FUNCTION erp_private.guard_integrador_credential_owner();
CREATE TRIGGER integrador_oauth_owner BEFORE INSERT OR UPDATE ON marketplace_oauth_states FOR EACH ROW EXECUTE FUNCTION erp_private.guard_integrador_credential_owner();
NOTIFY pgrst,'reload schema';
