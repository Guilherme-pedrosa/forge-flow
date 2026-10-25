-- Quote transport reuses the owner's Correios contract inside the Selovac
-- server. Credentials never leave that runtime. This database sends only an
-- unguessable quote ID; the bridge reads the sealed manifest below.
ALTER TABLE public.storefront_channels ADD COLUMN shipping_mode text NOT NULL DEFAULT 'fixed'
  CHECK(shipping_mode IN ('fixed','correios'));
CREATE TABLE erp_private.storefront_shipping_config (
  channel_id uuid PRIMARY KEY REFERENCES public.storefront_channels(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  origin_zip text NOT NULL CHECK(origin_zip ~ '^[0-9]{8}$'),
  handling_days integer NOT NULL DEFAULT 0 CHECK(handling_days BETWEEN 0 AND 30),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE erp_private.storefront_shipping_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel_id uuid NOT NULL REFERENCES public.storefront_channels(id),
  fingerprint text NOT NULL, snapshot jsonb NOT NULL, destination_zip text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','error')),
  options jsonb NOT NULL DEFAULT '[]', destination_state text,
  transport_request_id bigint, error text, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE INDEX storefront_shipping_quotes_cache ON erp_private.storefront_shipping_quotes(channel_id,fingerprint,expires_at);
CREATE INDEX storefront_shipping_quotes_rate ON erp_private.storefront_shipping_quotes(channel_id,created_at);
REVOKE ALL ON erp_private.storefront_shipping_config,erp_private.storefront_shipping_quotes FROM PUBLIC,anon,authenticated;
ALTER TABLE public.storefront_requests ADD COLUMN shipping_quote_id uuid REFERENCES erp_private.storefront_shipping_quotes(id),
  ADD COLUMN shipping_service text, ADD COLUMN shipping_price numeric(14,2), ADD COLUMN shipping_delivery_days integer;

CREATE FUNCTION public.storefront_shipping_settings(p_channel_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.storefront_cms_can_manage(p_channel_id) THEN RAISE EXCEPTION 'Somente um administrador pode configurar o frete.'; END IF;
  RETURN (SELECT jsonb_build_object('origin_zip',coalesce(s.origin_zip,''),'handling_days',coalesce(s.handling_days,0),
    'enabled',coalesce(s.enabled,false),'mode',c.shipping_mode,'provider','Correios · contrato Selovac')
    FROM storefront_channels c LEFT JOIN erp_private.storefront_shipping_config s ON s.channel_id=c.id WHERE c.id=p_channel_id);
END $$;
CREATE FUNCTION public.save_storefront_shipping_settings(p_channel_id uuid,p_origin_zip text,p_handling_days integer,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tenant uuid;
BEGIN
  IF NOT public.storefront_cms_can_manage(p_channel_id) THEN RAISE EXCEPTION 'Somente um administrador pode configurar o frete.'; END IF;
  SELECT tenant_id INTO tenant FROM storefront_channels WHERE id=p_channel_id;
  IF coalesce(p_origin_zip,'') !~ '^[0-9]{8}$' OR p_handling_days IS NULL OR p_handling_days NOT BETWEEN 0 AND 30 OR p_enabled IS NULL THEN RAISE EXCEPTION 'Informe CEP de origem e prazo de preparação válido.'; END IF;
  INSERT INTO erp_private.storefront_shipping_config(channel_id,tenant_id,origin_zip,handling_days,enabled)
    VALUES(p_channel_id,tenant,p_origin_zip,p_handling_days,p_enabled)
    ON CONFLICT(channel_id) DO UPDATE SET origin_zip=excluded.origin_zip,handling_days=excluded.handling_days,enabled=excluded.enabled,updated_at=now();
  UPDATE storefront_channels SET shipping_mode='correios' WHERE id=p_channel_id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(tenant,auth.uid(),'storefront_shipping_settings','storefront_channels',p_channel_id,jsonb_build_object('origin_zip',p_origin_zip,'handling_days',p_handling_days,'enabled',p_enabled));
END $$;

CREATE FUNCTION erp_private.storefront_shipping_snapshot(p_channel_id uuid,p_zip text,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ch storefront_channels; cfg erp_private.storefront_shipping_config; line jsonb; product products; listing storefront_listings;
  qty integer; units integer:=0; unit_index integer; price numeric; pack jsonb; dims numeric[];
  length numeric; width numeric; height numeric; weight numeric; value numeric:=0;
  boxes jsonb:='[]'; current_box jsonb; sealed_items jsonb:='[]'; dispatch integer; production_days integer:=0;
BEGIN
  SELECT * INTO ch FROM storefront_channels WHERE id=p_channel_id AND enabled AND shipping_mode='correios';
  SELECT * INTO cfg FROM erp_private.storefront_shipping_config WHERE channel_id=p_channel_id AND enabled;
  IF ch.id IS NULL OR cfg.channel_id IS NULL THEN RAISE EXCEPTION 'O cálculo de frete ainda não foi configurado pela loja.'; END IF;
  IF coalesce(p_zip,'') !~ '^[0-9]{8}$' THEN RAISE EXCEPTION 'Informe um CEP com 8 dígitos.'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR octet_length(p_items::text)>16384 OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'product_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Confira os produtos do carrinho.'; END IF;
  dispatch:=cfg.handling_days;
  FOR line IN SELECT x FROM jsonb_array_elements(p_items) x ORDER BY x->>'product_id' LOOP
    SELECT * INTO product FROM products WHERE id=(line->>'product_id')::uuid AND tenant_id=ch.tenant_id AND is_active AND NOT is_component;
    SELECT * INTO listing FROM storefront_listings WHERE channel_id=ch.id AND product_id=product.id AND tenant_id=ch.tenant_id AND published;
    IF product.id IS NULL OR listing.id IS NULL OR coalesce(product.photo_url,'') !~ '^https://[^/@]+(/|$)' THEN RAISE EXCEPTION 'Um produto saiu do catálogo. Atualize o carrinho.'; END IF;
    IF jsonb_typeof(line->'quantity') IS DISTINCT FROM 'number' OR NOT erp_private.valid_number((line->>'quantity')::numeric,1)
      OR (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) OR (line->>'quantity')::numeric>500 THEN RAISE EXCEPTION 'Quantidade inválida para cotar frete.'; END IF;
    qty:=(line->>'quantity')::integer; units:=units+qty;
    IF units>500 THEN RAISE EXCEPTION 'O carrinho excede o limite de unidades para cotação online.'; END IF;
    price:=round(coalesce(listing.price_override,product.sale_price),2);
    IF NOT erp_private.valid_number(price,0.01) THEN RAISE EXCEPTION 'O preço de % precisa ser conferido.',product.name; END IF;
    IF line ? 'expected_price' AND (line->>'expected_price')::numeric IS DISTINCT FROM price THEN RAISE EXCEPTION 'O preço de % mudou. Atualize o carrinho.',product.name; END IF;
    IF NOT listing.made_to_order AND qty>erp_private.finished_stock_free(product.stock_item_id,ch.tenant_id) THEN RAISE EXCEPTION 'Quantidade indisponível para %.',product.name; END IF;
    pack:=product.shipping_package;
    IF pack IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY['length_cm','width_cm','height_cm','weight_grams']) field WHERE jsonb_typeof(pack->field) IS DISTINCT FROM 'number' OR NOT erp_private.valid_number((pack->>field)::numeric,0.0001)) THEN
      RAISE EXCEPTION 'Complete comprimento, largura, altura e peso embalado de % no Forge.',product.name;
    END IF;
    SELECT array_agg(v ORDER BY v DESC) INTO dims FROM unnest(ARRAY[(pack->>'length_cm')::numeric,(pack->>'width_cm')::numeric,(pack->>'height_cm')::numeric]) v;
    length:=dims[1];width:=dims[2];height:=dims[3];weight:=(pack->>'weight_grams')::numeric;
    IF length>100 OR length+width+height>200 OR weight>30000 OR length<11 OR width<6 OR height<0.4 OR price>100000 THEN RAISE EXCEPTION 'A embalagem de % está fora dos limites de pacote para cotação online dos Correios.',product.name; END IF;
    value:=value+price*qty;
    IF value>1000000 THEN RAISE EXCEPTION 'Valor acima do limite de pedido online.'; END IF;
    production_days:=greatest(production_days,CASE WHEN listing.made_to_order THEN listing.lead_days ELSE 0 END);
    sealed_items:=sealed_items||jsonb_build_array(jsonb_build_object('product_id',product.id,'quantity',qty,'price',price,'package',pack,'made_to_order',listing.made_to_order,'lead_days',listing.lead_days));
    FOR unit_index IN 1..qty LOOP
      IF current_box IS NOT NULL AND (greatest((current_box->>'length_cm')::numeric,length)+greatest((current_box->>'width_cm')::numeric,width)+(current_box->>'height_cm')::numeric+height>200
        OR (current_box->>'height_cm')::numeric+height>100 OR (current_box->>'weight_grams')::numeric+weight>30000
        OR (current_box->>'declared_value')::numeric+price>100000) THEN boxes:=boxes||jsonb_build_array(current_box);current_box:=NULL; END IF;
      IF current_box IS NULL THEN current_box:=jsonb_build_object('length_cm',length,'width_cm',width,'height_cm',height,'weight_grams',weight,'declared_value',price);
      ELSE current_box:=jsonb_build_object('length_cm',greatest((current_box->>'length_cm')::numeric,length),'width_cm',greatest((current_box->>'width_cm')::numeric,width),
        'height_cm',(current_box->>'height_cm')::numeric+height,'weight_grams',(current_box->>'weight_grams')::numeric+weight,'declared_value',(current_box->>'declared_value')::numeric+price); END IF;
    END LOOP;
  END LOOP;
  IF current_box IS NOT NULL THEN boxes:=boxes||jsonb_build_array(current_box); END IF;
  dispatch:=dispatch+production_days;
  IF jsonb_array_length(boxes)>30 THEN RAISE EXCEPTION 'O carrinho exige mais de 30 volumes. Solicite uma cotação à loja.'; END IF;
  RETURN jsonb_build_object('origin_zip',cfg.origin_zip,'destination_zip',p_zip,'packages',boxes,'dispatch_days',dispatch,
    'items',sealed_items,'settings_revision',extract(epoch from cfg.updated_at));
END $$;

CREATE FUNCTION public.storefront_shipping_manifest(p_slug text,p_quote_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT q.snapshot-'items'-'settings_revision' FROM erp_private.storefront_shipping_quotes q
  JOIN storefront_channels c ON c.id=q.channel_id JOIN erp_private.storefront_shipping_config s ON s.channel_id=c.id
  WHERE c.slug=p_slug AND c.enabled AND c.shipping_mode='correios' AND s.enabled AND q.id=p_quote_id
    AND q.status='pending' AND q.expires_at>now() AND (q.snapshot->>'settings_revision')::numeric=extract(epoch from s.updated_at)
$$;

CREATE FUNCTION erp_private.storefront_shipping_advance(p_quote_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE quote erp_private.storefront_shipping_quotes; response jsonb; payload jsonb; v_options jsonb:='[]'; option jsonb;
  service text; services text[]:='{}'; price numeric; days integer; dispatch integer;
BEGIN
  SELECT * INTO quote FROM erp_private.storefront_shipping_quotes WHERE id=p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM storefront_channels c JOIN erp_private.storefront_shipping_config s ON s.channel_id=c.id
    WHERE c.id=quote.channel_id AND c.enabled AND c.shipping_mode='correios' AND s.enabled
      AND (quote.snapshot->>'settings_revision')::numeric=extract(epoch from s.updated_at)) THEN
    UPDATE erp_private.storefront_shipping_quotes SET status='error',options='[]',error='A configuração de entrega mudou. Calcule o frete novamente.' WHERE id=quote.id;
    SELECT * INTO quote FROM erp_private.storefront_shipping_quotes WHERE id=p_quote_id;
  END IF;
  IF quote.status='pending' THEN
    EXECUTE 'SELECT jsonb_build_object(''status'',status_code,''body'',content,''timeout'',timed_out,''error'',error_msg) FROM net._http_response WHERE id=$1' INTO response USING quote.transport_request_id;
    IF response IS NOT NULL THEN
      BEGIN
        payload:=(response->>'body')::jsonb;
        IF (response->>'status')::integer IS DISTINCT FROM 200 OR coalesce((response->>'timeout')::boolean,false) OR nullif(response->>'error','') IS NOT NULL
          OR jsonb_typeof(payload->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'options') NOT BETWEEN 1 AND 2
          OR (payload->>'package_count')::integer IS DISTINCT FROM jsonb_array_length(quote.snapshot->'packages')
          OR payload->'destination'->>'zip' IS DISTINCT FROM quote.destination_zip
          OR coalesce(payload->'destination'->>'state','') NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') THEN RAISE EXCEPTION 'invalid provider response'; END IF;
        dispatch:=(quote.snapshot->>'dispatch_days')::integer;
        FOR option IN SELECT x FROM jsonb_array_elements(payload->'options') x LOOP
          service:=option->>'service'; price:=(option->>'price')::numeric; days:=(option->>'delivery_days')::integer;
          IF coalesce(service,'') NOT IN ('PAC','SEDEX') OR service=ANY(services) OR jsonb_typeof(option->'price') IS DISTINCT FROM 'number'
            OR NOT erp_private.valid_number(price,0.01) OR price>100000 OR price<>round(price,2)
            OR jsonb_typeof(option->'delivery_days') IS DISTINCT FROM 'number' OR days NOT BETWEEN 0 AND 365 OR (option->>'delivery_days')::numeric<>days THEN RAISE EXCEPTION 'invalid service'; END IF;
          services:=array_append(services,service);
          v_options:=v_options||jsonb_build_array(jsonb_build_object('service',service,'label',CASE WHEN service='PAC' THEN 'Correios PAC' ELSE 'Correios SEDEX' END,
            'price',price,'delivery_days',days,'dispatch_days',dispatch,'total_days',days+dispatch));
        END LOOP;
        UPDATE erp_private.storefront_shipping_quotes SET status='ready',options=v_options,destination_state=payload->'destination'->>'state' WHERE id=quote.id;
      EXCEPTION WHEN OTHERS THEN UPDATE erp_private.storefront_shipping_quotes SET status='error',error='Não foi possível obter uma cotação válida dos Correios. Tente novamente.' WHERE id=quote.id;
      END;
    ELSIF quote.created_at<now()-interval '50 seconds' THEN UPDATE erp_private.storefront_shipping_quotes SET status='error',error='A consulta de frete demorou mais que o esperado. Tente calcular novamente.' WHERE id=quote.id;
    END IF;
    SELECT * INTO quote FROM erp_private.storefront_shipping_quotes WHERE id=p_quote_id;
  END IF;
  IF quote.expires_at<=now() THEN RETURN jsonb_build_object('id',quote.id,'status','error','error','A cotação expirou. Calcule novamente.','options','[]'::jsonb,'destination_zip',quote.destination_zip,'expires_at',quote.expires_at); END IF;
  RETURN jsonb_build_object('id',quote.id,'status',quote.status,'options',quote.options,'error',quote.error,'destination_zip',quote.destination_zip,'expires_at',quote.expires_at,'package_count',jsonb_array_length(quote.snapshot->'packages'));
END $$;

CREATE FUNCTION public.storefront_shipping_quote(p_slug text,p_zip text,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE channel uuid; snapshot jsonb; v_fingerprint text; quote_id uuid; request_id bigint;
BEGIN
  SELECT id INTO channel FROM storefront_channels WHERE slug=p_slug AND enabled;
  IF channel IS NULL THEN RAISE EXCEPTION 'Loja temporariamente indisponível.'; END IF;
  snapshot:=erp_private.storefront_shipping_snapshot(channel,p_zip,p_items); v_fingerprint:=md5(snapshot::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('storefront-shipping-'||channel::text,0));
  SELECT id INTO quote_id FROM erp_private.storefront_shipping_quotes q WHERE q.channel_id=channel AND q.fingerprint=v_fingerprint AND q.status IN ('pending','ready') AND q.expires_at>now() ORDER BY q.created_at DESC LIMIT 1;
  IF quote_id IS NOT NULL THEN RETURN erp_private.storefront_shipping_advance(quote_id); END IF;
  IF (SELECT count(*) FROM erp_private.storefront_shipping_quotes WHERE channel_id=channel AND created_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'Muitas consultas de frete. Aguarde um minuto e tente novamente.'; END IF;
  INSERT INTO erp_private.storefront_shipping_quotes(channel_id,fingerprint,snapshot,destination_zip) VALUES(channel,v_fingerprint,snapshot,p_zip) RETURNING id INTO quote_id;
  EXECUTE 'SELECT net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=40000)' INTO request_id
    USING 'https://selovacembalagens.com.br/api/public/forge-frete',jsonb_build_object('quote_id',quote_id),jsonb_build_object('Content-Type','application/json');
  UPDATE erp_private.storefront_shipping_quotes SET transport_request_id=request_id WHERE id=quote_id;
  RETURN jsonb_build_object('id',quote_id,'status','pending','options','[]'::jsonb,'destination_zip',p_zip,'expires_at',now()+interval '15 minutes','package_count',jsonb_array_length(snapshot->'packages'));
END $$;
CREATE FUNCTION public.storefront_shipping_quote_status(p_slug text,p_quote_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM erp_private.storefront_shipping_quotes q JOIN storefront_channels c ON c.id=q.channel_id WHERE c.slug=p_slug AND c.enabled AND q.id=p_quote_id) THEN RETURN NULL; END IF;
  RETURN erp_private.storefront_shipping_advance(p_quote_id);
END $$;

CREATE OR REPLACE FUNCTION public.storefront_checkout_config(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('ready',coalesce(k.verified_at IS NOT NULL,false) AND CASE WHEN c.shipping_mode='correios' THEN coalesce(s.enabled,false) ELSE c.shipping_fee IS NOT NULL END,
   'mode',k.mode,'shipping_mode',c.shipping_mode,'shipping_ready',CASE WHEN c.shipping_mode='correios' THEN coalesce(s.enabled,false) ELSE c.shipping_fee IS NOT NULL END,
   'shipping_fee',CASE WHEN c.shipping_mode='fixed' THEN c.shipping_fee END,'shipping_states',c.shipping_states)
 FROM storefront_channels c LEFT JOIN storefront_payment_credentials k ON k.channel_id=c.id
 LEFT JOIN erp_private.storefront_shipping_config s ON s.channel_id=c.id WHERE c.slug=p_slug AND c.enabled
$$;

REVOKE ALL ON FUNCTION public.storefront_shipping_settings(uuid),public.save_storefront_shipping_settings(uuid,text,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.storefront_shipping_settings(uuid),public.save_storefront_shipping_settings(uuid,text,integer,boolean) TO authenticated;
REVOKE ALL ON FUNCTION erp_private.storefront_shipping_snapshot(uuid,text,jsonb),erp_private.storefront_shipping_advance(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.storefront_shipping_quote(text,text,jsonb),public.storefront_shipping_quote_status(text,uuid),public.storefront_shipping_manifest(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_shipping_quote(text,text,jsonb),public.storefront_shipping_quote_status(text,uuid),public.storefront_shipping_manifest(text,uuid) TO anon,authenticated;

-- The already deployed payment function calls this routine and charges the
-- order's server-validated shipping amount. No payment Edge redeploy is needed.
CREATE OR REPLACE FUNCTION public.begin_storefront_checkout(p_slug text,p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ch storefront_channels; r storefront_requests; ignored jsonb; lock_id uuid:=gen_random_uuid(); line record; free integer;
  quote erp_private.storefront_shipping_quotes; selected jsonb; current_snapshot jsonb;
  trusted_shipping numeric; chosen_service text; chosen_days integer;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>32768 THEN RAISE EXCEPTION 'Pedido inválido.'; END IF;
  SELECT * INTO ch FROM storefront_channels WHERE slug=p_slug AND enabled;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM storefront_payment_credentials WHERE channel_id=ch.id AND verified_at IS NOT NULL) THEN RAISE EXCEPTION 'Pagamento online ainda não configurado pela loja.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||ch.tenant_id::text,0));
  SELECT * INTO r FROM storefront_requests WHERE channel_id=ch.id AND request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF r.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Este envio já foi utilizado com outro conteúdo. Inicie um novo pedido.'; END IF;
    IF r.payment_status='approved' THEN RETURN jsonb_build_object('paid',true,'request_id',r.request_id); END IF;
    IF r.checkout_expires_at<=now() THEN RAISE EXCEPTION 'Este checkout expirou. Confira o carrinho e envie um novo pedido.'; END IF;
    IF r.preference_id IS NOT NULL THEN RETURN jsonb_build_object('checkout_url',r.checkout_url,'request_id',r.request_id); END IF;
  END IF;
  IF r.id IS NOT NULL AND r.shipping_price IS NOT NULL THEN
    -- Recover the exact accepted request after a lost network response, even
    -- when its original quote has since expired or settings have changed.
    trusted_shipping:=r.shipping_price; chosen_service:=r.shipping_service; chosen_days:=r.shipping_delivery_days;
  ELSIF ch.shipping_mode='correios' THEN
    SELECT * INTO quote FROM erp_private.storefront_shipping_quotes WHERE id=(p_payload->>'shipping_quote_id')::uuid AND channel_id=ch.id AND status='ready' AND expires_at>now();
    IF quote.id IS NULL THEN RAISE EXCEPTION 'Calcule e selecione um frete válido antes de pagar.'; END IF;
    current_snapshot:=erp_private.storefront_shipping_snapshot(ch.id,p_payload->'customer'->'address'->>'zip',p_payload->'items');
    IF md5(current_snapshot::text) IS DISTINCT FROM quote.fingerprint THEN RAISE EXCEPTION 'O carrinho, a embalagem ou o CEP mudou. Calcule o frete novamente.'; END IF;
    IF quote.destination_state IS NOT NULL AND quote.destination_state IS DISTINCT FROM p_payload->'customer'->'address'->>'state' THEN RAISE EXCEPTION 'A UF informada não corresponde ao CEP da cotação.'; END IF;
    chosen_service:=p_payload->>'shipping_service';
    SELECT x INTO selected FROM jsonb_array_elements(quote.options) x WHERE x->>'service'=chosen_service;
    IF selected IS NULL THEN RAISE EXCEPTION 'Selecione um dos serviços da cotação de frete.'; END IF;
    trusted_shipping:=(selected->>'price')::numeric; chosen_days:=(selected->>'total_days')::integer;
  ELSE
    IF ch.shipping_fee IS NULL THEN RAISE EXCEPTION 'O frete ainda não foi configurado pela loja.'; END IF;
    IF NOT coalesce(p_payload->'customer'->'address'->>'state'=ANY(ch.shipping_states),false) THEN RAISE EXCEPTION 'Entrega indisponível para este estado.'; END IF;
    trusted_shipping:=ch.shipping_fee;
  END IF;
  IF (p_payload->>'expected_shipping')::numeric IS DISTINCT FROM trusted_shipping THEN RAISE EXCEPTION 'O frete mudou. Confira o total antes de pagar.'; END IF;
  ignored:=submit_storefront_request(p_slug,p_request_id,p_payload);
  SELECT * INTO r FROM storefront_requests WHERE channel_id=ch.id AND request_id=p_request_id FOR UPDATE;
  IF r.checkout_locked_until>now() THEN RAISE EXCEPTION 'O pagamento está sendo preparado. Aguarde alguns segundos e tente novamente.'; END IF;
  UPDATE orders SET shipping=trusted_shipping,total=(SELECT sum(total) FROM order_items WHERE order_id=r.order_id)+trusted_shipping,
    notes='Origem: Elevare3D. Pagamento online via Mercado Pago; conferir aprovação no canal antes de organizar o pedido.'
      ||CASE WHEN chosen_service IS NOT NULL THEN E'\nFrete: Correios '||chosen_service||' · prazo cotado: '||chosen_days||' dias úteis, incluindo preparação/produção.' ELSE '' END
      ||E'\n'||coalesce(p_payload->>'notes','') WHERE id=r.order_id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Este pedido já foi alterado no Forge. Confira com a loja antes de pagar.'; END IF;
  DELETE FROM erp_private.storefront_stock_holds WHERE request_id=r.id;
  FOR line IN SELECT p.stock_item_id,sum(oi.quantity)::integer quantity,bool_and(l.made_to_order) made_to_order FROM order_items oi
    JOIN products p ON p.id=oi.product_id JOIN storefront_listings l ON l.channel_id=ch.id AND l.product_id=p.id
    WHERE oi.order_id=r.order_id GROUP BY p.stock_item_id LOOP
    free:=erp_private.finished_stock_free(line.stock_item_id,ch.tenant_id);
    IF NOT line.made_to_order AND free<line.quantity THEN RAISE EXCEPTION 'O estoque mudou. Atualize o carrinho antes de pagar.'; END IF;
    IF line.stock_item_id IS NOT NULL AND least(free,line.quantity)>0 THEN INSERT INTO erp_private.storefront_stock_holds VALUES(r.id,ch.tenant_id,line.stock_item_id,least(free,line.quantity),now()+interval '30 minutes'); END IF;
  END LOOP;
  UPDATE storefront_requests SET checkout_lock=lock_id,checkout_locked_until=now()+interval '45 seconds',
    checkout_expires_at=coalesce(checkout_expires_at,now()+interval '30 minutes'),payment_status='pending',
    shipping_quote_id=coalesce(r.shipping_quote_id,quote.id),shipping_service=chosen_service,shipping_price=trusted_shipping,shipping_delivery_days=chosen_days WHERE id=r.id;
  RETURN jsonb_build_object('request_id',r.request_id,'internal_request_id',r.id,'order_id',r.order_id,'lock_id',lock_id,'expires_at',coalesce(r.checkout_expires_at,now()+interval '30 minutes'));
END $$;
REVOKE ALL ON FUNCTION public.begin_storefront_checkout(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_storefront_checkout(text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
