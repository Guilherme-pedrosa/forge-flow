-- Company-owned automation. Defaults never enable marketplace writes.
CREATE TABLE public.marketplace_automation_policies (
 account_id uuid PRIMARY KEY REFERENCES marketplace_accounts(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 orders_auto boolean NOT NULL DEFAULT false,stock_auto boolean NOT NULL DEFAULT false,price_auto boolean NOT NULL DEFAULT false,
 safety_stock integer NOT NULL DEFAULT 0 CHECK(safety_stock BETWEEN 0 AND 1000),
 listing_type_default text NOT NULL DEFAULT 'gold_special' CHECK(listing_type_default IN('gold_special','gold_pro')),
 interval_minutes integer NOT NULL DEFAULT 15 CHECK(interval_minutes IN(5,15,30,60)),
 revision uuid NOT NULL DEFAULT gen_random_uuid(),approved_by uuid NOT NULL REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),next_run_at timestamptz,
 last_run_at timestamptz,last_success_at timestamptz,last_error text
);
ALTER TABLE marketplace_automation_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketplace_automation_policies FROM PUBLIC,anon,authenticated;
GRANT SELECT ON marketplace_automation_policies TO authenticated;
GRANT ALL ON marketplace_automation_policies TO service_role;
CREATE POLICY tenant_read ON marketplace_automation_policies FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON marketplace_automation_policies FOR EACH ROW EXECUTE FUNCTION erp_immutable_tenant();
CREATE TRIGGER erp_tenant_references BEFORE INSERT OR UPDATE ON marketplace_automation_policies FOR EACH ROW EXECUTE FUNCTION erp_check_tenant_references();

CREATE TABLE erp_private.marketplace_automation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),account_id uuid NOT NULL REFERENCES marketplace_accounts(id),
 bridge_id uuid NOT NULL REFERENCES integrador_bridge_bindings(id),seller_id text NOT NULL,actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN('orders','stock','price')),product_ids uuid[] NOT NULL DEFAULT '{}',policy_revision uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','dispatched','running','succeeded','failed','uncertain','cancelled','reviewed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),started_at timestamptz,finished_at timestamptz,
 ticket_sha256 text,ticket_expires_at timestamptz,transport_request_id bigint,result jsonb,result_sha256 text,input_sha256 text,error text
);
CREATE INDEX marketplace_automation_jobs_pending ON erp_private.marketplace_automation_jobs(state,created_at);
CREATE INDEX marketplace_automation_jobs_account ON erp_private.marketplace_automation_jobs(account_id,created_at DESC);
CREATE TABLE erp_private.marketplace_automation_requests (
 tenant_id uuid NOT NULL,request_id uuid NOT NULL,result jsonb NOT NULL,PRIMARY KEY(tenant_id,request_id)
);
ALTER TABLE erp_private.marketplace_automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.marketplace_automation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.marketplace_automation_jobs,erp_private.marketplace_automation_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON erp_private.marketplace_automation_jobs,erp_private.marketplace_automation_requests TO service_role;

CREATE FUNCTION erp_private.marketplace_automation_read(p_account uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE p marketplace_automation_policies; pending integer; running integer; failed integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM marketplace_accounts WHERE id=p_account AND tenant_id=p_tenant AND channel='mercado_livre') THEN RAISE EXCEPTION 'Conta não encontrada nesta empresa.'; END IF;
 SELECT * INTO p FROM marketplace_automation_policies WHERE account_id=p_account AND tenant_id=p_tenant;
 SELECT count(*) FILTER(WHERE state='pending'),count(*) FILTER(WHERE state IN('dispatched','running')),count(*) FILTER(WHERE state IN('failed','uncertain')) INTO pending,running,failed FROM erp_private.marketplace_automation_jobs WHERE account_id=p_account AND tenant_id=p_tenant;
 RETURN jsonb_build_object('policy',jsonb_build_object('configured',p.account_id IS NOT NULL,'orders_auto',coalesce(p.orders_auto,false),'stock_auto',coalesce(p.stock_auto,false),'price_auto',coalesce(p.price_auto,false),'safety_stock',coalesce(p.safety_stock,0),'listing_type_default',coalesce(p.listing_type_default,'gold_special'),'interval_minutes',coalesce(p.interval_minutes,15),'revision',coalesce(p.revision::text,'not_configured')),
 'status',jsonb_build_object('last_success_at',p.last_success_at,'last_run_at',p.last_run_at,'next_run_at',p.next_run_at,'last_error',coalesce((SELECT error FROM erp_private.marketplace_automation_jobs WHERE account_id=p_account AND state='uncertain' ORDER BY created_at DESC LIMIT 1),p.last_error),'pending_jobs',pending,'running_jobs',running,'failed_jobs',failed,'needs_review_actions',coalesce((SELECT jsonb_agg(action ORDER BY action) FROM (SELECT DISTINCT action FROM erp_private.marketplace_automation_jobs WHERE account_id=p_account AND tenant_id=p_tenant AND state='uncertain') actions),'[]'::jsonb)));
END $$;
CREATE FUNCTION public.read_marketplace_automation(p_account_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Sessão Forge obrigatória.' USING ERRCODE='42501'; END IF;
 RETURN erp_private.marketplace_automation_read(p_account_id,t);
END $$;

CREATE FUNCTION public.save_marketplace_automation(p_account_id uuid,p_values jsonb,p_expected_revision text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid; p marketplace_automation_policies; result jsonb; b integrador_bridge_bindings; link integrador_marketplace_account_links;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'marketplace_automation_save',jsonb_build_array(p_account_id,p_values,p_expected_revision));
 IF prior IS NOT NULL THEN SELECT r.result INTO result FROM erp_private.marketplace_automation_requests r WHERE r.tenant_id=t AND r.request_id=p_request_id; RETURN result; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('marketplace-automation-'||p_account_id::text,0));
 SELECT * INTO link FROM integrador_marketplace_account_links WHERE account_id=p_account_id AND tenant_id=t;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=link.bridge_id AND tenant_id=t AND enabled;
 IF b.id IS NULL OR NOT(link.source_seller_id=ANY(b.approved_seller_ids)) OR NOT EXISTS(SELECT 1 FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t AND channel='mercado_livre' AND external_seller_id=link.source_seller_id) THEN RAISE EXCEPTION 'Conecte a conta Mercado Livre desta empresa antes de configurar as rotinas.'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_values))<>6 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN('orders_auto','stock_auto','price_auto','safety_stock','listing_type_default','interval_minutes'))
  OR jsonb_typeof(p_values->'orders_auto') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_values->'stock_auto') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_values->'price_auto') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_values->'safety_stock') IS DISTINCT FROM 'number' OR NOT erp_private.valid_number((p_values->>'safety_stock')::numeric) OR (p_values->>'safety_stock')::numeric NOT BETWEEN 0 AND 1000 OR (p_values->>'safety_stock')::numeric<>trunc((p_values->>'safety_stock')::numeric)
  OR jsonb_typeof(p_values->'interval_minutes') IS DISTINCT FROM 'number' OR (p_values->>'interval_minutes')::numeric NOT IN(5,15,30,60)
  OR jsonb_typeof(p_values->'listing_type_default') IS DISTINCT FROM 'string' OR p_values->>'listing_type_default' NOT IN('gold_special','gold_pro') THEN RAISE EXCEPTION 'Confira as opções de automação desta conta.'; END IF;
 SELECT * INTO p FROM marketplace_automation_policies WHERE account_id=p_account_id AND tenant_id=t FOR UPDATE;
 IF p_expected_revision IS DISTINCT FROM coalesce(p.revision::text,'not_configured') THEN RAISE EXCEPTION 'A configuração mudou. Recarregue antes de salvar.' USING ERRCODE='40001'; END IF;
 INSERT INTO marketplace_automation_policies(account_id,tenant_id,orders_auto,stock_auto,price_auto,safety_stock,listing_type_default,interval_minutes,approved_by,next_run_at)
 VALUES(p_account_id,t,(p_values->>'orders_auto')::boolean,(p_values->>'stock_auto')::boolean,(p_values->>'price_auto')::boolean,(p_values->>'safety_stock')::integer,p_values->>'listing_type_default',(p_values->>'interval_minutes')::integer,auth.uid(),CASE WHEN (p_values->>'orders_auto')::boolean OR (p_values->>'stock_auto')::boolean OR (p_values->>'price_auto')::boolean THEN clock_timestamp()+make_interval(mins=>(p_values->>'interval_minutes')::integer) END)
 ON CONFLICT(account_id) DO UPDATE SET orders_auto=excluded.orders_auto,stock_auto=excluded.stock_auto,price_auto=excluded.price_auto,safety_stock=excluded.safety_stock,listing_type_default=excluded.listing_type_default,interval_minutes=excluded.interval_minutes,approved_by=excluded.approved_by,next_run_at=excluded.next_run_at,revision=gen_random_uuid(),updated_at=clock_timestamp(),last_error=NULL;
 UPDATE erp_private.marketplace_automation_jobs SET state='cancelled',finished_at=clock_timestamp(),error='A configuração foi alterada.' WHERE account_id=p_account_id AND tenant_id=t AND state IN('pending','dispatched');
 -- An uncertain provider write is never silently retried after a policy edit.
 result:=erp_private.marketplace_automation_read(p_account_id,t);
 INSERT INTO erp_private.marketplace_automation_requests VALUES(t,p_request_id,result);
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'save','marketplace_automation_policies',p_account_id,p_values);
 PERFORM erp_private.finish_request(t,p_request_id,p_account_id);RETURN result;
END $$;

CREATE FUNCTION erp_private.marketplace_automation_enqueue(p_account uuid,p_tenant uuid,p_action text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p marketplace_automation_policies; link integrador_marketplace_account_links; b integrador_bridge_bindings; act text; ids uuid[]; chunk uuid[]; i integer; queued integer:=0;
BEGIN
 SELECT * INTO p FROM marketplace_automation_policies WHERE account_id=p_account AND tenant_id=p_tenant FOR UPDATE;
 SELECT * INTO link FROM integrador_marketplace_account_links WHERE account_id=p.account_id AND tenant_id=p_tenant;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=link.bridge_id AND tenant_id=p_tenant AND enabled;
 IF p.account_id IS NULL OR b.id IS NULL OR NOT(link.source_seller_id=ANY(b.approved_seller_ids)) THEN RETURN 0; END IF;
 FOREACH act IN ARRAY ARRAY['orders','stock','price'] LOOP
  IF p_action IS NOT NULL AND act<>p_action THEN CONTINUE; END IF;
  IF NOT (CASE act WHEN 'orders' THEN p.orders_auto WHEN 'stock' THEN p.stock_auto ELSE p.price_auto END) THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.marketplace_automation_jobs WHERE account_id=p_account AND action=act AND state IN('pending','dispatched','running','uncertain')) THEN CONTINUE; END IF;
  IF act='orders' THEN ids:='{}';
  ELSE SELECT array_agg(DISTINCT sb.product_id ORDER BY sb.product_id) INTO ids FROM marketplace_sku_bindings sb JOIN products product ON product.id=sb.product_id AND product.tenant_id=p_tenant AND product.is_active AND NOT product.is_component WHERE sb.account_id=p_account AND sb.tenant_id=p_tenant;
   IF cardinality(ids) IS NULL THEN UPDATE marketplace_automation_policies SET last_error='Vincule anúncios aos produtos antes de atualizar estoque ou preços.' WHERE account_id=p_account;CONTINUE; END IF;
  END IF;
  FOR i IN 0..greatest(0,(coalesce(cardinality(ids),0)-1)/50) LOOP
   chunk:=CASE WHEN act='orders' THEN '{}'::uuid[] ELSE ids[(i*50+1):(i*50+50)] END;
   INSERT INTO erp_private.marketplace_automation_jobs(tenant_id,account_id,bridge_id,seller_id,actor_id,action,product_ids,policy_revision) VALUES(p_tenant,p_account,b.id,link.source_seller_id,p.approved_by,act,chunk,p.revision);queued:=queued+1;
  END LOOP;
 END LOOP;
 UPDATE marketplace_automation_policies SET next_run_at=CASE WHEN orders_auto OR stock_auto OR price_auto THEN clock_timestamp()+make_interval(mins=>interval_minutes) END WHERE account_id=p_account;
 RETURN queued;
END $$;

-- Source holds the SAME ml-stock lease as every provider writer while invoking
-- this function. The server proof is never accepted from a browser or returned.
CREATE FUNCTION public.review_marketplace_automation(p_account_id uuid,p_action text,p_request_id uuid,p_source_proof text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true);link integrador_marketplace_account_links;b integrador_bridge_bindings;prior uuid;result jsonb;queued integer;
BEGIN
 SELECT * INTO link FROM integrador_marketplace_account_links WHERE account_id=p_account_id AND tenant_id=t;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=link.bridge_id AND tenant_id=t AND enabled;
 IF b.id IS NULL OR p_action NOT IN('orders','stock','price') OR coalesce(p_source_proof,'') !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM erp_private.integrador_enrollment_proofs WHERE bridge_id=b.id AND enabled AND proof_sha256=encode(sha256(convert_to(p_source_proof,'UTF8')),'hex')) THEN RAISE EXCEPTION 'A conferência precisa ser confirmada pelo servidor da integração.' USING ERRCODE='42501';END IF;
 prior:=erp_private.begin_request(t,p_request_id,'marketplace_automation_review',jsonb_build_array(p_account_id,p_action));
 IF prior IS NOT NULL THEN SELECT r.result INTO result FROM erp_private.marketplace_automation_requests r WHERE r.tenant_id=t AND r.request_id=p_request_id;RETURN result;END IF;
 PERFORM 1 FROM marketplace_automation_policies WHERE account_id=p_account_id AND tenant_id=t FOR UPDATE;
 PERFORM 1 FROM erp_private.marketplace_automation_jobs WHERE account_id=p_account_id AND tenant_id=t AND action=p_action ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM erp_private.marketplace_automation_jobs WHERE account_id=p_account_id AND tenant_id=t AND action=p_action AND (state IN('dispatched','running') OR state='uncertain' AND ticket_expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'A execução anterior ainda pode estar ativa. Aguarde o encerramento e confira novamente.' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.marketplace_automation_jobs WHERE account_id=p_account_id AND tenant_id=t AND action=p_action AND state='uncertain') THEN RAISE EXCEPTION 'Não há uma execução incerta para conferir nesta rotina.';END IF;
 UPDATE erp_private.marketplace_automation_jobs SET state='reviewed',ticket_sha256=NULL,error='Conferida explicitamente pelo responsável; a próxima execução usará uma nova leitura.' WHERE account_id=p_account_id AND tenant_id=t AND action=p_action AND state='uncertain';
 UPDATE marketplace_automation_policies SET last_error=NULL WHERE account_id=p_account_id AND tenant_id=t;
 queued:=erp_private.marketplace_automation_enqueue(p_account_id,t,p_action);
 result:=jsonb_build_object('queued',queued,'status',erp_private.marketplace_automation_read(p_account_id,t)->'status');
 INSERT INTO erp_private.marketplace_automation_requests VALUES(t,p_request_id,result);
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)VALUES(t,auth.uid(),'review_uncertain','marketplace_automation_policies',p_account_id,jsonb_build_object('action',p_action,'new_jobs',queued));
 PERFORM erp_private.finish_request(t,p_request_id,p_account_id);RETURN result;
END $$;
CREATE FUNCTION public.request_marketplace_automation_sync(p_account_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid; result jsonb; queued integer;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'marketplace_automation_sync',jsonb_build_array(p_account_id));
 IF prior IS NOT NULL THEN SELECT r.result INTO result FROM erp_private.marketplace_automation_requests r WHERE r.tenant_id=t AND r.request_id=p_request_id; RETURN result; END IF;
 IF NOT EXISTS(SELECT 1 FROM marketplace_automation_policies WHERE account_id=p_account_id AND tenant_id=t AND (orders_auto OR stock_auto OR price_auto)) THEN RAISE EXCEPTION 'Ative e salve ao menos uma rotina desta conta antes de executar.'; END IF;
 queued:=erp_private.marketplace_automation_enqueue(p_account_id,t);result:=jsonb_build_object('queued',queued,'status',erp_private.marketplace_automation_read(p_account_id,t)->'status');
 INSERT INTO erp_private.marketplace_automation_requests VALUES(t,p_request_id,result);PERFORM erp_private.finish_request(t,p_request_id,p_account_id);RETURN result;
END $$;

CREATE FUNCTION public.marketplace_automation_worker(p_job_id uuid,p_ticket text,p_source_proof text,p_operation text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.marketplace_automation_jobs;p marketplace_automation_policies;b integrador_bridge_bindings;link integrador_marketplace_account_links;previous_claim text;v_result jsonb;snapshot jsonb;failure_state text;failure_message text;refresh_ids jsonb;
BEGIN
 IF coalesce(p_ticket,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_source_proof,'') !~ '^[a-f0-9]{64}$' OR p_operation NOT IN('context','snapshot','orders','complete','fail') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>1048576 THEN RAISE EXCEPTION 'Autorização da rotina inválida.' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM erp_private.marketplace_automation_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.ticket_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_ticket,'UTF8')),'hex') OR j.ticket_expires_at<=clock_timestamp() OR j.state NOT IN('dispatched','running','succeeded') THEN RAISE EXCEPTION 'A rotina expirou ou não está autorizada.' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=j.bridge_id AND tenant_id=j.tenant_id AND enabled;
 IF b.id IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.integrador_enrollment_proofs WHERE bridge_id=b.id AND enabled AND proof_sha256=encode(sha256(convert_to(p_source_proof,'UTF8')),'hex')) THEN RAISE EXCEPTION 'Servidor da integração não autorizado.' USING ERRCODE='42501'; END IF;
 -- A completed ticket can only return exactly its immutable receipt.
 IF j.state='succeeded' THEN
  IF p_operation='complete' AND j.result_sha256 IS DISTINCT FROM encode(sha256(convert_to((p_payload->'result')::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Resultado utilizado por outra confirmação.'; END IF;
  IF p_operation='orders' AND j.input_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Pedidos utilizados por outra confirmação.'; END IF;
  RETURN jsonb_build_object('completed',true,'result',j.result,'replayed',true);
 END IF;
 SELECT * INTO p FROM marketplace_automation_policies WHERE account_id=j.account_id AND tenant_id=j.tenant_id;
 SELECT * INTO link FROM integrador_marketplace_account_links WHERE account_id=j.account_id AND tenant_id=j.tenant_id;
 IF p.account_id IS NULL OR p.revision IS DISTINCT FROM j.policy_revision OR p.approved_by IS DISTINCT FROM j.actor_id OR link.bridge_id IS DISTINCT FROM b.id OR link.source_seller_id IS DISTINCT FROM j.seller_id OR NOT(j.seller_id=ANY(b.approved_seller_ids)) OR NOT (CASE j.action WHEN 'orders' THEN p.orders_auto WHEN 'stock' THEN p.stock_auto ELSE p.price_auto END) THEN RAISE EXCEPTION 'A configuração ou associação da rotina mudou.' USING ERRCODE='42501'; END IF;
 previous_claim:=current_setting('request.jwt.claim.sub',true);PERFORM set_config('request.jwt.claim.sub',j.actor_id::text,true);
 IF erp_private.actor(true) IS DISTINCT FROM j.tenant_id THEN RAISE EXCEPTION 'A permissão financeira que autorizou a rotina não está ativa.' USING ERRCODE='42501'; END IF;
 IF p_operation='context' THEN
  IF p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'Contexto da rotina inválido.'; END IF;
  UPDATE erp_private.marketplace_automation_jobs SET state='running',started_at=coalesce(started_at,clock_timestamp()) WHERE id=j.id;
  UPDATE marketplace_automation_policies SET last_run_at=clock_timestamp() WHERE account_id=j.account_id;
  SELECT coalesce(jsonb_agg(external_order_id ORDER BY external_updated_at,external_order_id),'[]') INTO refresh_ids FROM (SELECT external_order_id,external_updated_at FROM marketplace_orders WHERE account_id=j.account_id AND tenant_id=j.tenant_id AND normalized_state NOT IN('cancelled','delivered') ORDER BY external_updated_at,external_order_id LIMIT 101) q;
  IF jsonb_array_length(refresh_ids)>100 AND j.action='orders' THEN RAISE EXCEPTION 'Há mais de 100 pedidos abertos para conferir. Consulte os pedidos em lotes antes de ativar a rotina.'; END IF;
  v_result:=jsonb_build_object('job_id',j.id,'bridge_id',b.id,'tenant_id',j.tenant_id,'account_id',j.account_id,'seller_id',j.seller_id,'seller_ids',b.approved_seller_ids,'user_id',j.actor_id,'action',j.action,'product_ids',j.product_ids,'policy_revision',p.revision,'safety_stock',p.safety_stock,'order_ids_to_refresh',refresh_ids,'from',clock_timestamp()-interval '7 days','to',clock_timestamp());
 ELSIF p_operation='snapshot' THEN
  IF j.action='orders' OR p_payload<>'{}'::jsonb THEN RAISE EXCEPTION 'Snapshot da rotina inválido.'; END IF;
  snapshot:=marketplace_stock_preview_snapshot(j.account_id,j.product_ids);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'competingBindings') binding LEFT JOIN marketplace_automation_policies other ON other.account_id=(binding->>'accountId')::uuid AND other.tenant_id=j.tenant_id WHERE other.account_id IS NULL OR other.safety_stock<>p.safety_stock OR NOT (CASE j.action WHEN 'stock' THEN other.stock_auto ELSE other.price_auto END)) THEN RAISE EXCEPTION 'Confira a mesma política de automação nas demais contas que compartilham este produto.'; END IF;
  snapshot:=jsonb_set(snapshot,'{finishedAvailability}',(SELECT jsonb_agg(CASE WHEN value->'available'='null'::jsonb THEN value ELSE jsonb_set(value,'{available}',to_jsonb(greatest(0,(value->>'available')::numeric-p.safety_stock))) END) FROM jsonb_array_elements(snapshot->'finishedAvailability')));
  snapshot:=jsonb_set(snapshot,'{revision}',to_jsonb(md5(jsonb_build_array(snapshot->>'revision',p.revision,p.safety_stock)::text)));
  v_result:=snapshot||jsonb_build_object('automationSafetyStock',p.safety_stock);
 ELSIF p_operation='orders' THEN
  IF j.action<>'orders' OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>1 OR jsonb_typeof(p_payload->'orders') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'orders')>100 THEN RAISE EXCEPTION 'Pedidos da rotina inválidos.'; END IF;
  v_result:=CASE WHEN jsonb_array_length(p_payload->'orders')=0 THEN jsonb_build_object('imported',0,'unchanged',0,'order_ids','[]'::jsonb) ELSE import_marketplace_orders(j.account_id,p_payload->'orders') END;
  UPDATE erp_private.marketplace_automation_jobs SET state='succeeded',finished_at=clock_timestamp(),result=v_result,result_sha256=encode(sha256(convert_to(v_result::text,'UTF8')),'hex'),input_sha256=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex') WHERE id=j.id;
  UPDATE marketplace_automation_policies SET last_success_at=clock_timestamp(),last_error=NULL WHERE account_id=j.account_id;
 ELSIF p_operation='complete' THEN
  IF j.action='orders' OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>1 OR jsonb_typeof(p_payload->'result') IS DISTINCT FROM 'object' OR octet_length((p_payload->'result')::text)>65536 OR p_payload->'result'->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p_payload->'result'->>'action' IS DISTINCT FROM j.action THEN RAISE EXCEPTION 'Confirmação da rotina inválida.'; END IF;
  v_result:=p_payload->'result';
  UPDATE erp_private.marketplace_automation_jobs SET state='succeeded',finished_at=clock_timestamp(),result=v_result,result_sha256=encode(sha256(convert_to(v_result::text,'UTF8')),'hex') WHERE id=j.id;
  UPDATE marketplace_automation_policies SET last_success_at=clock_timestamp(),last_error=NULL WHERE account_id=j.account_id;
 ELSE
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('uncertain')) OR jsonb_typeof(p_payload->'uncertain') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Falha da rotina inválida.'; END IF;
  failure_state:=CASE WHEN (p_payload->>'uncertain')::boolean AND j.action<>'orders' THEN 'uncertain' ELSE 'failed' END;
  UPDATE erp_private.marketplace_automation_jobs SET state=failure_state,finished_at=clock_timestamp(),error=CASE WHEN failure_state='uncertain' THEN 'O envio ao canal precisa de conferência. A rotina não repetirá essa atualização automaticamente.' ELSE 'A rotina não foi confirmada. Confira os vínculos, o saldo e a autorização da conta.' END WHERE id=j.id RETURNING error INTO failure_message;
  UPDATE marketplace_automation_policies SET last_error=failure_message WHERE account_id=j.account_id;v_result:=jsonb_build_object('failed',true);
 END IF;
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_claim,''),true);RETURN v_result;
EXCEPTION WHEN OTHERS THEN
 IF previous_claim IS NOT NULL THEN PERFORM set_config('request.jwt.claim.sub',previous_claim,true); END IF;RAISE;
END $$;

CREATE FUNCTION erp_private.marketplace_automation_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE row record;j erp_private.marketplace_automation_jobs;ticket text;transport bigint;
BEGIN
 -- Recover abandoned transports without retrying an uncertain marketplace write.
 UPDATE erp_private.marketplace_automation_jobs SET state=CASE WHEN action='orders' THEN 'failed' ELSE 'uncertain' END,finished_at=clock_timestamp(),error='A execução demorou mais que o esperado. Confira o resultado antes de atualizar novamente.' WHERE state IN('dispatched','running') AND ticket_expires_at<clock_timestamp();
 FOR row IN SELECT account_id,tenant_id FROM marketplace_automation_policies WHERE next_run_at<=clock_timestamp() AND (orders_auto OR stock_auto OR price_auto) ORDER BY next_run_at,account_id FOR UPDATE SKIP LOCKED LIMIT 20 LOOP
  PERFORM erp_private.marketplace_automation_enqueue(row.account_id,row.tenant_id);
 END LOOP;
 IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN RETURN; END IF;
 FOR j IN SELECT * FROM erp_private.marketplace_automation_jobs q WHERE state='pending' AND NOT EXISTS(SELECT 1 FROM erp_private.marketplace_automation_jobs earlier WHERE earlier.account_id=q.account_id AND earlier.state IN('dispatched','running') OR earlier.account_id=q.account_id AND earlier.state='pending' AND (earlier.created_at,earlier.id)<(q.created_at,q.id)) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 10 LOOP
  ticket:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  EXECUTE 'SELECT net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=90000)' INTO transport USING 'https://integradorwedo.lovable.app/api/public/hooks/forge-bridge-worker',jsonb_build_object('bridge_id',j.bridge_id,'job_id',j.id,'ticket',ticket),jsonb_build_object('Content-Type','application/json');
  UPDATE erp_private.marketplace_automation_jobs SET state='dispatched',ticket_sha256=encode(sha256(convert_to(ticket,'UTF8')),'hex'),ticket_expires_at=clock_timestamp()+interval '5 minutes',transport_request_id=transport WHERE id=j.id;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION erp_private.marketplace_automation_read(uuid,uuid),erp_private.marketplace_automation_enqueue(uuid,uuid,text),erp_private.marketplace_automation_tick() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_marketplace_automation(uuid),public.save_marketplace_automation(uuid,jsonb,text,uuid),public.request_marketplace_automation_sync(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_marketplace_automation(uuid),public.save_marketplace_automation(uuid,jsonb,text,uuid),public.request_marketplace_automation_sync(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.review_marketplace_automation(uuid,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_marketplace_automation(uuid,text,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.marketplace_automation_worker(uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_automation_worker(uuid,text,text,text,jsonb) TO anon,service_role;
DO $$ BEGIN
 IF to_regnamespace('cron') IS NOT NULL AND to_regnamespace('net') IS NOT NULL THEN
  EXECUTE $schedule$SELECT cron.schedule('forge-marketplace-automation','* * * * *','SELECT erp_private.marketplace_automation_tick()')$schedule$;
 END IF;
END $$;
