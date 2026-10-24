CREATE TABLE public.storefront_payment_credentials (
 channel_id uuid PRIMARY KEY REFERENCES storefront_channels(id), access_token text NOT NULL, webhook_secret text NOT NULL,
 mode text NOT NULL CHECK(mode IN('sandbox','production')), collector_id text, verified_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storefront_payment_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON storefront_payment_credentials FROM PUBLIC,anon,authenticated;
GRANT ALL ON storefront_payment_credentials TO service_role;
ALTER TABLE storefront_channels ADD COLUMN shipping_fee numeric(14,2) CHECK(shipping_fee>=0),
 ADD COLUMN shipping_states text[] NOT NULL DEFAULT '{}';
ALTER TABLE storefront_requests ADD COLUMN payment_status text NOT NULL DEFAULT 'not_started',
 ADD COLUMN payment_review text, ADD COLUMN checkout_url text, ADD COLUMN preference_id text,
 ADD COLUMN checkout_expires_at timestamptz, ADD COLUMN checkout_lock uuid,
 ADD COLUMN checkout_locked_until timestamptz, ADD COLUMN payment_checked_at timestamptz;
ALTER TABLE storefront_requests ADD COLUMN preference_attempted_at timestamptz, ADD COLUMN payment_reviewed_fingerprint text;
CREATE TABLE public.storefront_payments (
 payment_id text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), request_id uuid NOT NULL REFERENCES storefront_requests(id),
 status text NOT NULL, amount numeric NOT NULL, refunded_amount numeric NOT NULL DEFAULT 0,
 provider_updated_at timestamptz NOT NULL, net_received numeric, money_release_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storefront_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON storefront_payments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON storefront_payments TO authenticated;
GRANT ALL ON storefront_payments TO service_role;
CREATE POLICY tenant_read ON storefront_payments FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE TABLE erp_private.storefront_stock_holds (
 request_id uuid NOT NULL REFERENCES storefront_requests(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 item_id uuid NOT NULL REFERENCES inventory_items(id), quantity integer NOT NULL CHECK(quantity>0),
 expires_at timestamptz NOT NULL, PRIMARY KEY(request_id,item_id)
);
REVOKE ALL ON erp_private.storefront_stock_holds FROM PUBLIC,anon,authenticated;
ALTER FUNCTION erp_private.finished_stock_free(uuid,uuid) RENAME TO finished_stock_before_storefront;
CREATE FUNCTION erp_private.finished_stock_free(p_item uuid,p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT greatest(0,erp_private.finished_stock_before_storefront(p_item,p_tenant)-coalesce((SELECT sum(h.quantity) FROM erp_private.storefront_stock_holds h WHERE h.item_id=p_item AND h.tenant_id=p_tenant AND h.expires_at>now()),0))::integer
$$;
REVOKE ALL ON FUNCTION erp_private.finished_stock_free(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.save_storefront_payment_settings(p_channel_id uuid,p_token text,p_secret text,p_mode text,p_shipping_fee numeric,p_states text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM storefront_channels WHERE id=p_channel_id AND tenant_id=t) THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
 IF coalesce(p_mode,'') NOT IN('sandbox','production') OR NOT erp_private.valid_number(p_shipping_fee) OR p_shipping_fee>10000 OR p_shipping_fee<>round(p_shipping_fee,2)
 OR cardinality(coalesce(p_states,'{}'))=0 OR EXISTS(SELECT 1 FROM unnest(p_states) s WHERE s NOT IN('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')) THEN RAISE EXCEPTION 'Informe ambiente, frete fixo e estados atendidos.'; END IF;
 IF length(coalesce(btrim(p_token),'')) NOT BETWEEN 20 AND 500 OR length(coalesce(btrim(p_secret),'')) NOT BETWEEN 16 AND 500 THEN RAISE EXCEPTION 'Informe Access Token e chave secreta do webhook.'; END IF;
 -- Replacing a seller while a preference is payable could send money to the wrong account.
 IF EXISTS(SELECT 1 FROM storefront_requests WHERE channel_id=p_channel_id AND preference_id IS NOT NULL AND payment_status IN('pending','approved','in_process','authorized')) THEN
  IF EXISTS(SELECT 1 FROM storefront_payment_credentials WHERE channel_id=p_channel_id AND (access_token<>btrim(p_token) OR mode<>p_mode)) THEN RAISE EXCEPTION 'Existem pagamentos vinculados à conta. Revise a troca da conta recebedora antes de alterar a credencial.'; END IF;
 END IF;
 INSERT INTO storefront_payment_credentials(channel_id,access_token,webhook_secret,mode) VALUES(p_channel_id,btrim(p_token),btrim(p_secret),p_mode)
 ON CONFLICT(channel_id) DO UPDATE SET access_token=excluded.access_token,webhook_secret=excluded.webhook_secret,mode=excluded.mode,collector_id=NULL,verified_at=NULL,updated_at=now();
 UPDATE storefront_channels SET shipping_fee=p_shipping_fee,shipping_states=p_states WHERE id=p_channel_id;
END $$;
CREATE FUNCTION public.storefront_checkout_config(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('ready',coalesce(k.verified_at IS NOT NULL,false) AND c.shipping_fee IS NOT NULL,'mode',k.mode,'shipping_fee',c.shipping_fee,'shipping_states',c.shipping_states)
 FROM storefront_channels c LEFT JOIN storefront_payment_credentials k ON k.channel_id=c.id WHERE c.slug=p_slug AND c.enabled
$$;

CREATE FUNCTION public.begin_storefront_checkout(p_slug text,p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ch storefront_channels; r storefront_requests; ignored jsonb; lock_id uuid:=gen_random_uuid(); line record; free integer;
BEGIN
 SELECT * INTO ch FROM storefront_channels WHERE slug=p_slug AND enabled;
 IF NOT FOUND OR ch.shipping_fee IS NULL OR NOT EXISTS(SELECT 1 FROM storefront_payment_credentials WHERE channel_id=ch.id AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Pagamento online ainda não configurado pela loja.'; END IF;
 IF NOT coalesce(p_payload->'customer'->'address'->>'state'=ANY(ch.shipping_states),false) THEN RAISE EXCEPTION 'Entrega indisponível para este estado.'; END IF;
 IF (p_payload->>'expected_shipping')::numeric IS DISTINCT FROM ch.shipping_fee THEN RAISE EXCEPTION 'O frete mudou. Confira o total antes de pagar.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||ch.tenant_id::text,0));
 ignored:=submit_storefront_request(p_slug,p_request_id,p_payload);
 SELECT * INTO r FROM storefront_requests WHERE channel_id=ch.id AND request_id=p_request_id FOR UPDATE;
 IF r.payment_status='approved' THEN RETURN jsonb_build_object('paid',true,'request_id',r.request_id); END IF;
 IF r.checkout_expires_at<=now() THEN RAISE EXCEPTION 'Este checkout expirou. Confira o carrinho e envie um novo pedido.'; END IF;
 IF r.preference_id IS NOT NULL THEN
  IF r.checkout_expires_at<=now() THEN RAISE EXCEPTION 'Este checkout expirou. Inicie um novo pedido para conferir novamente preço e estoque.'; END IF;
  RETURN jsonb_build_object('checkout_url',r.checkout_url,'request_id',r.request_id);
 END IF;
 IF r.checkout_locked_until>now() THEN RAISE EXCEPTION 'O pagamento está sendo preparado. Aguarde alguns segundos e tente novamente.'; END IF;
 -- Do not renew a timed-out creation blindly. The Edge Function first searches
 -- for a preference with this durable external_reference before another POST.
 UPDATE orders SET shipping=ch.shipping_fee,total=(SELECT sum(total) FROM order_items WHERE order_id=r.order_id)+ch.shipping_fee,
 notes='Origem: Loracê. Pagamento online via Mercado Pago; conferir aprovação no canal antes de organizar o pedido.'||E'\n'||coalesce(p_payload->>'notes','') WHERE id=r.order_id AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'Este pedido já foi alterado no Forge. Confira com a loja antes de pagar.'; END IF;
 DELETE FROM erp_private.storefront_stock_holds WHERE request_id=r.id;
 FOR line IN SELECT p.stock_item_id,sum(oi.quantity)::integer quantity,bool_and(l.made_to_order) made_to_order FROM order_items oi
  JOIN products p ON p.id=oi.product_id JOIN storefront_listings l ON l.channel_id=ch.id AND l.product_id=p.id
  WHERE oi.order_id=r.order_id GROUP BY p.stock_item_id LOOP
  free:=erp_private.finished_stock_free(line.stock_item_id,ch.tenant_id);
  IF NOT line.made_to_order AND free<line.quantity THEN RAISE EXCEPTION 'O estoque mudou. Atualize o carrinho antes de pagar.'; END IF;
  IF line.stock_item_id IS NOT NULL AND least(free,line.quantity)>0 THEN
   INSERT INTO erp_private.storefront_stock_holds VALUES(r.id,ch.tenant_id,line.stock_item_id,least(free,line.quantity),now()+interval '30 minutes');
  END IF;
 END LOOP;
 UPDATE storefront_requests SET checkout_lock=lock_id,checkout_locked_until=now()+interval '45 seconds',checkout_expires_at=coalesce(checkout_expires_at,now()+interval '30 minutes'),payment_status='pending' WHERE id=r.id;
 RETURN jsonb_build_object('request_id',r.request_id,'internal_request_id',r.id,'order_id',r.order_id,'lock_id',lock_id,'expires_at',coalesce(r.checkout_expires_at,now()+interval '30 minutes'));
END $$;

CREATE FUNCTION public.finish_storefront_checkout(p_request_id uuid,p_lock uuid,p_preference_id text,p_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF length(coalesce(p_preference_id,'')) NOT BETWEEN 1 AND 150 OR coalesce(p_url,'') !~ '^https://(www\.|sandbox\.)?mercadopago\.com\.br/checkout/' THEN RAISE EXCEPTION 'Resposta de checkout inválida.'; END IF;
 UPDATE storefront_requests SET preference_id=p_preference_id,checkout_url=p_url,checkout_locked_until=NULL WHERE id=p_request_id AND checkout_lock=p_lock;
 IF NOT FOUND THEN RAISE EXCEPTION 'Outro processo está finalizando o checkout. Consulte novamente.'; END IF;
END $$;

CREATE FUNCTION public.record_storefront_payment(p_channel_id uuid,p_payment jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r storefront_requests; ch storefront_channels; k storefront_payment_credentials; o orders;
 amount numeric; refunded numeric; previous storefront_payments; revision timestamptz; paid_count integer; has_problem boolean; fingerprint text;
BEGIN
 SELECT * INTO ch FROM storefront_channels WHERE id=p_channel_id;
 SELECT * INTO k FROM storefront_payment_credentials WHERE channel_id=ch.id;
 SELECT * INTO r FROM storefront_requests WHERE id=(p_payment->>'external_reference')::uuid AND channel_id=ch.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não pertence a esta loja.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||ch.tenant_id::text,0));
 SELECT * INTO o FROM orders WHERE id=r.order_id FOR UPDATE;
 SELECT * INTO r FROM storefront_requests WHERE id=r.id FOR UPDATE;
 amount:=(p_payment->>'transaction_amount')::numeric; refunded:=coalesce((p_payment->>'transaction_amount_refunded')::numeric,0); revision:=(p_payment->>'date_last_updated')::timestamptz;
 IF coalesce(p_payment->>'id','') !~ '^[0-9]{1,30}$' OR p_payment->>'currency_id' IS DISTINCT FROM 'BRL'
 OR p_payment->>'collector_id' IS DISTINCT FROM k.collector_id OR (p_payment->>'live_mode')::boolean IS DISTINCT FROM (k.mode='production')
 OR NOT erp_private.valid_number(amount,0.01) OR amount IS DISTINCT FROM o.total OR NOT erp_private.valid_number(refunded) OR refunded>amount
 OR revision IS NULL OR NOT isfinite(revision) OR coalesce(p_payment->>'status','') NOT IN('pending','approved','authorized','in_process','in_mediation','rejected','cancelled','refunded','charged_back') THEN RAISE EXCEPTION 'Pagamento divergente: confira conta recebedora, ambiente, moeda, valor e situação.'; END IF;
 SELECT * INTO previous FROM storefront_payments WHERE payment_id=p_payment->>'id' FOR UPDATE;
 IF FOUND AND previous.request_id<>r.id THEN RAISE EXCEPTION 'Pagamento já vinculado a outro pedido.'; END IF;
 IF previous.provider_updated_at>revision THEN RETURN; END IF;
 INSERT INTO storefront_payments(payment_id,tenant_id,request_id,status,amount,refunded_amount,provider_updated_at,net_received,money_release_at)
 VALUES(p_payment->>'id',ch.tenant_id,r.id,p_payment->>'status',amount,refunded,revision,(p_payment->'transaction_details'->>'net_received_amount')::numeric,nullif(p_payment->>'money_release_date','')::timestamptz)
 ON CONFLICT(payment_id) DO UPDATE SET status=excluded.status,amount=excluded.amount,refunded_amount=excluded.refunded_amount,provider_updated_at=excluded.provider_updated_at,net_received=excluded.net_received,money_release_at=excluded.money_release_at,updated_at=now();
 SELECT count(*) FILTER(WHERE status='approved' AND refunded_amount=0),bool_or(status IN('refunded','charged_back','in_mediation') OR refunded_amount>0)
 INTO paid_count,has_problem FROM storefront_payments WHERE request_id=r.id;
 SELECT md5(jsonb_agg(jsonb_build_array(payment_id,status,refunded_amount) ORDER BY payment_id)::text) INTO fingerprint FROM storefront_payments WHERE request_id=r.id;
 has_problem:=has_problem AND fingerprint IS DISTINCT FROM r.payment_reviewed_fingerprint;
 UPDATE storefront_requests SET payment_status=CASE WHEN has_problem THEN 'review' WHEN paid_count>0 THEN 'approved' ELSE p_payment->>'status' END,
 payment_review=CASE WHEN has_problem THEN 'Pagamento devolvido, contestado ou em análise. Confira no Mercado Pago antes de continuar.' WHEN paid_count>1 THEN 'Mais de um pagamento aprovado para o mesmo pedido. Confira a duplicidade no Mercado Pago.' WHEN r.payment_review IS NOT NULL THEN r.payment_review WHEN paid_count=1 AND r.payment_status<>'approved' AND r.checkout_expires_at<=now() THEN 'Pagamento aprovado após a reserva expirar. Confira estoque e prazo antes de organizar.' END,payment_checked_at=now() WHERE id=r.id;
 IF paid_count>0 THEN
  UPDATE orders SET payment_due_date=coalesce(payment_due_date,(coalesce(nullif(p_payment->>'money_release_date','')::timestamptz,now()) AT TIME ZONE 'America/Sao_Paulo')::date) WHERE id=r.order_id;
  -- Keep stock reserved until an operator confirms the paid order. The regular
  -- sales workflow releases these holds and performs the actual stock debit.
  UPDATE erp_private.storefront_stock_holds SET expires_at=now()+interval '7 days' WHERE request_id=r.id AND expires_at>now();
 ELSIF p_payment->>'status' IN('rejected','cancelled','refunded','charged_back') THEN DELETE FROM erp_private.storefront_stock_holds WHERE request_id=r.id;
 END IF;
END $$;

CREATE FUNCTION public.erp_guard_storefront_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r storefront_requests;
BEGIN
 SELECT * INTO r FROM storefront_requests WHERE order_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF r.checkout_lock IS NOT NULL AND (NEW.total,NEW.customer_id,NEW.shipping,NEW.discount) IS DISTINCT FROM (OLD.total,OLD.customer_id,OLD.shipping,OLD.discount) THEN RAISE EXCEPTION 'Pedido com checkout emitido: preserve valor e cliente do pagamento. Cancele e refaça o pedido se necessário.'; END IF;
 IF NEW.status<>OLD.status AND NEW.status IN('approved','in_production','ready','shipped','delivered') AND (r.payment_status<>'approved' OR r.payment_review IS NOT NULL) THEN RAISE EXCEPTION 'O pagamento da loja precisa estar aprovado e conferido antes de continuar.'; END IF;
 IF NEW.status='cancelled' AND OLD.status<>'cancelled' AND r.payment_status='approved' THEN RAISE EXCEPTION 'Confira o reembolso no Mercado Pago antes de cancelar um pedido pago.'; END IF;
 IF NEW.status<>OLD.status THEN DELETE FROM erp_private.storefront_stock_holds WHERE request_id=r.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_guard_storefront_payment BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION erp_guard_storefront_payment();

CREATE FUNCTION public.erp_guard_storefront_items() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM storefront_requests WHERE order_id=coalesce(NEW.order_id,OLD.order_id) AND checkout_lock IS NOT NULL)
 AND (TG_OP<>'UPDATE' OR (NEW.product_id,NEW.quantity,NEW.unit_price,NEW.total) IS DISTINCT FROM (OLD.product_id,OLD.quantity,OLD.unit_price,OLD.total)) THEN
  RAISE EXCEPTION 'Os itens deste checkout já foram enviados ao Mercado Pago e não podem ser reescritos.';
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER erp_guard_storefront_items BEFORE INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION erp_guard_storefront_items();

CREATE FUNCTION public.review_storefront_payment(p_request_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); r storefront_requests;
BEGIN
 SELECT * INTO r FROM storefront_requests WHERE id=p_request_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND OR length(coalesce(btrim(p_reason),'')) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Informe o resultado da conferência do pagamento e do estoque.'; END IF;
 IF (SELECT count(*) FROM storefront_payments WHERE request_id=r.id AND status='approved' AND refunded_amount=0)<>1
 OR EXISTS(SELECT 1 FROM storefront_payments WHERE request_id=r.id AND (status IN('charged_back','in_mediation') OR status='approved' AND refunded_amount>0)) THEN RAISE EXCEPTION 'Resolva pagamentos duplicados, estornos parciais ou contestações no Mercado Pago antes de liberar.'; END IF;
 UPDATE storefront_requests SET payment_status='approved',payment_review=NULL,payment_reviewed_fingerprint=(SELECT md5(jsonb_agg(jsonb_build_array(payment_id,status,refunded_amount) ORDER BY payment_id)::text) FROM storefront_payments WHERE request_id=r.id) WHERE id=r.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'storefront_payment_review','storefront_requests',r.id,jsonb_build_object('reason',btrim(p_reason)));
END $$;

-- The paid order must be able to consume its own reservation, while other
-- orders still see that stock as unavailable. Restore the hold if preparation
-- remains pending; a raised error rolls the entire transaction back.
CREATE FUNCTION erp_private.take_storefront_holds(p_order uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE r storefront_requests; held jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||p_tenant::text,0));
 SELECT * INTO r FROM storefront_requests WHERE order_id=p_order AND tenant_id=p_tenant;
 IF NOT FOUND THEN RETURN '[]'; END IF;
 IF r.payment_status<>'approved' OR r.payment_review IS NOT NULL THEN RAISE EXCEPTION 'Confira a aprovação do pagamento da loja antes de organizar.'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') INTO held FROM erp_private.storefront_stock_holds h WHERE request_id=r.id;
 DELETE FROM erp_private.storefront_stock_holds WHERE request_id=r.id;
 RETURN held;
END $$;
CREATE FUNCTION erp_private.restore_storefront_holds(p_order uuid,p_holds jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE h jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM orders WHERE id=p_order AND status='draft') THEN
  FOR h IN SELECT value FROM jsonb_array_elements(p_holds) LOOP
   INSERT INTO erp_private.storefront_stock_holds VALUES((h->>'request_id')::uuid,(h->>'tenant_id')::uuid,(h->>'item_id')::uuid,(h->>'quantity')::integer,(h->>'expires_at')::timestamptz) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
END $$;
ALTER FUNCTION public.confirm_sales_workflow(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.confirm_sales_workflow(uuid,jsonb,jsonb,uuid) RENAME TO confirm_sales_before_storefront;
CREATE FUNCTION public.confirm_sales_workflow(p_order_id uuid,p_order jsonb,p_items jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); held jsonb; result jsonb;
BEGIN
 held:=erp_private.take_storefront_holds(p_order_id,t);
 result:=erp_private.confirm_sales_before_storefront(p_order_id,p_order,p_items,p_request_id);
 PERFORM erp_private.restore_storefront_holds(p_order_id,held); RETURN result;
END $$;
REVOKE ALL ON FUNCTION erp_private.confirm_sales_before_storefront(uuid,jsonb,jsonb,uuid),erp_private.take_storefront_holds(uuid,uuid),erp_private.restore_storefront_holds(uuid,jsonb),public.erp_guard_storefront_items() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_sales_workflow(uuid,jsonb,jsonb,uuid),public.review_storefront_payment(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_sales_workflow(uuid,jsonb,jsonb,uuid),public.review_storefront_payment(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.storefront_request_status(p_slug text,p_request_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('received',true,'status',o.status,'total',o.total,'payment_status',r.payment_status,'needs_review',r.payment_review IS NOT NULL,'expired',coalesce(r.checkout_expires_at<=now(),false),'checkout_url',CASE WHEN r.checkout_expires_at>now() AND r.payment_status<>'approved' THEN r.checkout_url END,'created_at',r.created_at)
 FROM storefront_requests r JOIN storefront_channels c ON c.id=r.channel_id JOIN orders o ON o.id=r.order_id AND o.tenant_id=r.tenant_id WHERE c.slug=p_slug AND r.request_id=p_request_id
$$;
GRANT ALL ON storefront_channels,storefront_requests,storefront_listings,storefront_customers TO service_role;
GRANT EXECUTE ON FUNCTION public.storefront_request_status(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.save_storefront_payment_settings(uuid,text,text,text,numeric,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_storefront_payment_settings(uuid,text,text,text,numeric,text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.storefront_checkout_config(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_checkout_config(text) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_storefront_checkout(text,uuid,jsonb),public.finish_storefront_checkout(uuid,uuid,text,text),public.record_storefront_payment(uuid,jsonb),public.erp_guard_storefront_payment() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_storefront_checkout(text,uuid,jsonb),public.finish_storefront_checkout(uuid,uuid,text,text),public.record_storefront_payment(uuid,jsonb) TO service_role;

-- Checkout creation is server-only once online payment is installed.
REVOKE ALL ON FUNCTION public.submit_storefront_request(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_storefront_request(text,uuid,jsonb) TO service_role;
