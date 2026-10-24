-- A deliberately small public contract; ERP tables and costs stay private.
CREATE TABLE public.storefront_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9-]{3,60}$'), name text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,slug)
);
CREATE TABLE public.storefront_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 channel_id uuid NOT NULL REFERENCES storefront_channels(id), product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 published boolean NOT NULL DEFAULT false, category text NOT NULL DEFAULT 'Personalizados' CHECK(length(btrim(category)) BETWEEN 1 AND 80),
 price_override numeric(14,2) CHECK(price_override>0 AND price_override<=1000000),
 made_to_order boolean NOT NULL DEFAULT false, lead_days integer NOT NULL DEFAULT 7 CHECK(lead_days BETWEEN 1 AND 180),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(channel_id,product_id)
);
CREATE TABLE public.storefront_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 channel_id uuid NOT NULL REFERENCES storefront_channels(id), request_id uuid NOT NULL,
 order_id uuid NOT NULL UNIQUE REFERENCES orders(id), payload jsonb NOT NULL,
 contact_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(channel_id,request_id)
);
CREATE TABLE public.storefront_customers (
 tenant_id uuid NOT NULL REFERENCES tenants(id), channel_id uuid NOT NULL REFERENCES storefront_channels(id),
 contact_key text NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id), PRIMARY KEY(channel_id,contact_key)
);
DO $$ DECLARE tab text; BEGIN
 FOR tab IN SELECT unnest(ARRAY['storefront_channels','storefront_listings','storefront_requests','storefront_customers']) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tab);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=public.get_user_tenant_id())',tab);
  EXECUTE format('CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_immutable_tenant()',tab);
  EXECUTE format('CREATE TRIGGER erp_tenant_references BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_check_tenant_references()',tab);
 END LOOP;
END $$;
CREATE INDEX storefront_request_rate ON storefront_requests(channel_id,created_at);
CREATE INDEX storefront_request_contact ON storefront_requests(channel_id,contact_key,created_at);

CREATE FUNCTION public.configure_storefront(p_slug text,p_enabled boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid;
BEGIN
 IF p_slug IS NULL OR p_slug !~ '^[a-z0-9-]{3,60}$' OR p_enabled IS NULL THEN RAISE EXCEPTION 'Identificação da loja inválida.'; END IF;
 IF EXISTS(SELECT 1 FROM storefront_channels WHERE slug=p_slug AND tenant_id<>t) THEN RAISE EXCEPTION 'Esta identificação de loja já está em uso.'; END IF;
 INSERT INTO storefront_channels(tenant_id,slug,name,enabled) VALUES(t,p_slug,'Loracê',p_enabled)
 ON CONFLICT(slug) DO UPDATE SET enabled=excluded.enabled WHERE storefront_channels.tenant_id=t RETURNING id INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.save_storefront_listing(p_channel_id uuid,p_product_id uuid,p_settings jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; pr products; price numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 IF NOT EXISTS(SELECT 1 FROM storefront_channels WHERE id=p_channel_id AND tenant_id=t) THEN RAISE EXCEPTION 'Loja não encontrada.'; END IF;
 SELECT * INTO pr FROM products WHERE id=p_product_id AND tenant_id=t;
 IF NOT FOUND OR pr.is_component THEN RAISE EXCEPTION 'Selecione um produto final desta empresa.'; END IF;
 IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' OR jsonb_typeof(p_settings->'published') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_settings->'made_to_order') IS DISTINCT FROM 'boolean'
 OR length(coalesce(btrim(p_settings->>'category'),'')) NOT BETWEEN 1 AND 80
 OR coalesce(p_settings->>'lead_days','') !~ '^[0-9]{1,3}$' OR (p_settings->>'lead_days')::integer NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Confira categoria, publicação e prazo de produção.'; END IF;
 price:=nullif(p_settings->>'price_override','')::numeric;
 IF price IS NOT NULL AND (NOT erp_private.valid_number(price,0.01) OR price>1000000 OR price<>round(price,2)) THEN RAISE EXCEPTION 'Preço do canal inválido.'; END IF;
 IF (p_settings->>'published')::boolean AND (NOT pr.is_active OR coalesce(price,pr.sale_price,0)<=0 OR coalesce(pr.photo_url,'')!~ '^https://[^/@]+(/|$)') THEN RAISE EXCEPTION 'Para publicar, ative o produto e informe uma foto HTTPS e preço positivo.'; END IF;
 INSERT INTO storefront_listings(tenant_id,channel_id,product_id,published,category,price_override,made_to_order,lead_days)
 VALUES(t,p_channel_id,p_product_id,(p_settings->>'published')::boolean,btrim(p_settings->>'category'),price,(p_settings->>'made_to_order')::boolean,(p_settings->>'lead_days')::integer)
 ON CONFLICT(channel_id,product_id) DO UPDATE SET published=excluded.published,category=excluded.category,price_override=excluded.price_override,made_to_order=excluded.made_to_order,lead_days=excluded.lead_days,updated_at=now() RETURNING id INTO result;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'storefront_listing','storefront_listings',result,p_settings);
 RETURN result;
END $$;

CREATE FUNCTION public.storefront_catalog(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('name',c.name,'slug',c.slug,'products',coalesce((
 SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku,'description',p.description,
 'price',round(coalesce(l.price_override,p.sale_price),2),'category',l.category,'image',p.photo_url,
 'images',coalesce((SELECT jsonb_agg(ph.url ORDER BY ph.sort_order) FROM product_photos ph WHERE ph.product_id=p.id AND ph.tenant_id=c.tenant_id AND ph.url ~ '^https://[^/@]+(/|$)'),'[]'::jsonb),
 'stock',erp_private.finished_stock_free(p.stock_item_id,c.tenant_id),'made_to_order',l.made_to_order,'lead_days',l.lead_days) ORDER BY p.name,p.id)
 FROM storefront_listings l JOIN products p ON p.id=l.product_id AND p.tenant_id=c.tenant_id
 WHERE l.channel_id=c.id AND l.tenant_id=c.tenant_id AND l.published AND p.is_active AND NOT p.is_component
 AND coalesce(l.price_override,p.sale_price,0)>0 AND p.photo_url ~ '^https://[^/@]+(/|$)'),'[]'::jsonb))
 FROM storefront_channels c WHERE c.slug=p_slug AND c.enabled
$$;

-- Unauthenticated visitors submit a request for confirmation, never a paid or
-- released sale. The caller cannot choose tenant, prices, status or customer id.
CREATE FUNCTION public.submit_storefront_request(p_slug text,p_request_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ch storefront_channels; previous storefront_requests; line jsonb; pr products; listing storefront_listings;
 qty numeric; price numeric; amount numeric:=0; customer uuid; sale uuid; item_rows jsonb:='[]';
 customer_name text; email text; phone text; contact text; address jsonb; result_id uuid;
BEGIN
 SELECT * INTO ch FROM storefront_channels WHERE slug=p_slug AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Loja temporariamente indisponível.'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>32768 THEN RAISE EXCEPTION 'Pedido inválido.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||ch.tenant_id::text,0));
 SELECT * INTO previous FROM storefront_requests WHERE channel_id=ch.id AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Este envio já foi utilizado com outro conteúdo. Inicie um novo pedido.'; END IF;
  RETURN jsonb_build_object('request_id',p_request_id,'received',true);
 END IF;
 customer_name:=btrim(p_payload->'customer'->>'name'); email:=lower(btrim(p_payload->'customer'->>'email'));
 phone:=regexp_replace(coalesce(p_payload->'customer'->>'phone',''),'[^0-9]','','g'); address:=p_payload->'customer'->'address';
 IF length(coalesce(customer_name,'')) NOT BETWEEN 2 AND 120 OR length(coalesce(email,'')) NOT BETWEEN 5 AND 254 OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 OR length(phone) NOT BETWEEN 10 AND 13 OR jsonb_typeof(address) IS DISTINCT FROM 'object'
 OR coalesce(address->>'zip','') !~ '^[0-9]{8}$' OR length(coalesce(btrim(address->>'street'),'')) NOT BETWEEN 2 AND 160
 OR length(coalesce(btrim(address->>'number'),'')) NOT BETWEEN 1 AND 20 OR length(coalesce(btrim(address->>'city'),'')) NOT BETWEEN 2 AND 100
 OR coalesce(address->>'state','') !~ '^[A-Z]{2}$' OR length(coalesce(p_payload->>'notes',''))>2000 THEN RAISE EXCEPTION 'Confira nome, e-mail, telefone e endereço de entrega.'; END IF;
 contact:=md5(email||':'||phone);
 IF (SELECT count(*) FROM storefront_requests WHERE channel_id=ch.id AND contact_key=contact AND created_at>now()-interval '1 hour')>=5
 OR (SELECT count(*) FROM storefront_requests WHERE channel_id=ch.id AND created_at>now()-interval '1 hour')>=100 THEN RAISE EXCEPTION 'Limite temporário de envios atingido. Aguarde antes de enviar outro pedido.'; END IF;
 IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Inclua produtos no carrinho.'; END IF;
 IF jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'items') x GROUP BY x->>'product_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Carrinho inválido ou com itens repetidos.'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
  SELECT * INTO pr FROM products WHERE id=(line->>'product_id')::uuid AND tenant_id=ch.tenant_id AND is_active AND NOT is_component;
  SELECT * INTO listing FROM storefront_listings WHERE channel_id=ch.id AND product_id=pr.id AND tenant_id=ch.tenant_id AND published;
  IF pr.id IS NULL OR listing.id IS NULL OR coalesce(pr.photo_url,'')!~ '^https://[^/@]+(/|$)' THEN RAISE EXCEPTION 'Um produto saiu do catálogo. Atualize seu carrinho.'; END IF;
  qty:=(line->>'quantity')::numeric; price:=round(coalesce(listing.price_override,pr.sale_price),2);
  IF NOT erp_private.valid_number(qty,1) OR qty<>trunc(qty) OR qty>500 OR price IS NULL OR price<=0 THEN RAISE EXCEPTION 'Quantidade ou preço inválido.'; END IF;
  IF (line->>'expected_price')::numeric IS DISTINCT FROM price THEN RAISE EXCEPTION 'O preço de % mudou. Atualize o carrinho e confira antes de enviar.',pr.name; END IF;
  IF NOT listing.made_to_order AND qty>erp_private.finished_stock_free(pr.stock_item_id,ch.tenant_id) THEN RAISE EXCEPTION 'Quantidade indisponível para %. Atualize o carrinho.',pr.name; END IF;
  amount:=amount+price*qty;
  item_rows:=item_rows||jsonb_build_array(jsonb_build_object('product_id',pr.id,'description',pr.name,'quantity',qty,'unit_price',price,'total',price*qty,'notes',CASE WHEN listing.made_to_order THEN 'Sob encomenda: prazo de produção informado de '||listing.lead_days||' dias úteis, a confirmar.' ELSE 'Disponibilidade sujeita à confirmação do pedido.' END));
 END LOOP;
 IF amount>1000000 THEN RAISE EXCEPTION 'Valor acima do limite de pedido online.'; END IF;
 SELECT customer_id INTO customer FROM storefront_customers WHERE channel_id=ch.id AND contact_key=contact;
 IF customer IS NULL THEN
  INSERT INTO customers(tenant_id,name,email,phone,address,notes) VALUES(ch.tenant_id,customer_name,email,phone,address,'Cadastro recebido pela loja '||ch.name||'; dados informados pelo comprador.') RETURNING id INTO customer;
  INSERT INTO storefront_customers VALUES(ch.tenant_id,ch.id,contact,customer);
 END IF;
 -- Keep existing customer data intact; the request retains this delivery address.
 INSERT INTO orders(tenant_id,customer_id,code,status,total,discount,shipping,notes)
 VALUES(ch.tenant_id,customer,erp_private.next_code(ch.tenant_id,'PED'),'draft',amount,0,0,
 'Origem: '||ch.name||'. Pedido online aguardando confirmação de frete, prazo e pagamento. Frete ainda não incluído.'||E'\n'||coalesce(p_payload->>'notes','')) RETURNING id INTO sale;
 FOR line IN SELECT value FROM jsonb_array_elements(item_rows) LOOP
  INSERT INTO order_items(tenant_id,order_id,product_id,description,quantity,unit_price,total,notes)
  VALUES(ch.tenant_id,sale,(line->>'product_id')::uuid,line->>'description',(line->>'quantity')::integer,(line->>'unit_price')::numeric,(line->>'total')::numeric,line->>'notes');
 END LOOP;
 INSERT INTO storefront_requests(tenant_id,channel_id,request_id,order_id,payload,contact_key) VALUES(ch.tenant_id,ch.id,p_request_id,sale,p_payload,contact) RETURNING id INTO result_id;
 INSERT INTO audit_log(tenant_id,action,table_name,record_id,metadata) VALUES(ch.tenant_id,'storefront_request','orders',sale,jsonb_build_object('channel_id',ch.id,'request_id',result_id));
 RETURN jsonb_build_object('request_id',p_request_id,'received',true);
END $$;

CREATE FUNCTION public.storefront_request_status(p_slug text,p_request_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('received',true,'status',o.status,'total',o.total,'created_at',r.created_at)
 FROM storefront_requests r JOIN storefront_channels c ON c.id=r.channel_id JOIN orders o ON o.id=r.order_id AND o.tenant_id=r.tenant_id
 WHERE c.slug=p_slug AND r.request_id=p_request_id
$$;

REVOKE ALL ON FUNCTION public.save_storefront_listing(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_storefront_listing(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.configure_storefront(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_storefront(text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.storefront_catalog(text),public.submit_storefront_request(text,uuid,jsonb),public.storefront_request_status(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_catalog(text),public.submit_storefront_request(text,uuid,jsonb),public.storefront_request_status(text,uuid) TO anon,authenticated;
