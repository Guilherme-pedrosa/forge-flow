-- Authenticated multichannel inbox. Ingestion never reserves stock, prints, or posts receivables.
CREATE TABLE public.marketplace_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 channel text NOT NULL CHECK(channel IN('mercado_livre','shopee','tiktok_shop')),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120), external_seller_id text,
 connection_state text NOT NULL DEFAULT 'import_only' CHECK(connection_state IN('import_only','pending_access','pending_credentials','connected','reauthorization_required')),
 last_sync_at timestamptz, sync_locked_until timestamptz, sync_lock_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,channel,name)
);
CREATE UNIQUE INDEX marketplace_seller_identity ON marketplace_accounts(tenant_id,channel,external_seller_id) WHERE external_seller_id IS NOT NULL;
CREATE TABLE public.marketplace_sku_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL REFERENCES marketplace_accounts(id),
 external_item_id text NOT NULL DEFAULT '', external_variant_id text NOT NULL DEFAULT '', external_sku text NOT NULL DEFAULT '',
 product_id uuid NOT NULL REFERENCES products(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(external_item_id<>'' OR external_sku<>''), UNIQUE(account_id,external_item_id,external_variant_id,external_sku)
);
CREATE TABLE public.marketplace_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL REFERENCES marketplace_accounts(id),
 external_order_id text NOT NULL, external_pack_id text NOT NULL DEFAULT '', external_shipment_id text NOT NULL DEFAULT '', external_status text NOT NULL,
 normalized_state text NOT NULL CHECK(normalized_state IN('paid','awaiting_payment','shipped','delivered','cancelled','unknown')),
 external_updated_at timestamptz NOT NULL, shipping_deadline_at timestamptz, deadline_source text NOT NULL DEFAULT '',
 currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'), shipping_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(shipping_amount>=0),
 discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(discount_amount>=0), total numeric(14,2) NOT NULL CHECK(total>=0),
 reported_total numeric(14,2), seller_fees numeric(14,2), canonical_payload jsonb NOT NULL,
 internal_order_id uuid UNIQUE REFERENCES orders(id), needs_review boolean NOT NULL DEFAULT false, review_reason text,
 imported_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,external_order_id)
);
CREATE INDEX marketplace_inbox_tenant_deadline ON marketplace_orders(tenant_id,shipping_deadline_at);
CREATE TABLE public.marketplace_order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), marketplace_order_id uuid NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
 external_line_id text NOT NULL, external_item_id text NOT NULL DEFAULT '', external_variant_id text NOT NULL DEFAULT '', external_sku text NOT NULL DEFAULT '',
 description text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 500), unit_price numeric(14,2) NOT NULL CHECK(unit_price>=0),
 product_id uuid REFERENCES products(id), UNIQUE(marketplace_order_id,external_line_id)
);
CREATE TABLE public.marketplace_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), account_id uuid NOT NULL REFERENCES marketplace_accounts(id),
 event_key text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processed','failed','ignored')),
 attempts integer NOT NULL DEFAULT 0, last_error text, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 UNIQUE(account_id,event_key)
);
-- Only the Edge Function service role can read credentials and single-use OAuth state.
CREATE TABLE public.marketplace_credentials (
 account_id uuid PRIMARY KEY REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
 access_token text NOT NULL, refresh_token text NOT NULL, expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.marketplace_oauth_states (
 state uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES marketplace_accounts(id),
 user_id uuid NOT NULL REFERENCES auth.users(id), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
ALTER TABLE public.orders ADD COLUMN marketplace_order_id uuid UNIQUE REFERENCES marketplace_orders(id);

DO $$ DECLARE table_name text; BEGIN
 FOR table_name IN SELECT unnest(ARRAY['marketplace_accounts','marketplace_sku_bindings','marketplace_orders','marketplace_order_items','marketplace_events']) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',table_name);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',table_name);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',table_name);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=public.get_user_tenant_id())',table_name);
  EXECUTE format('CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_immutable_tenant()',table_name);
  EXECUTE format('CREATE TRIGGER erp_tenant_references BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_check_tenant_references()',table_name);
 END LOOP;
 FOR table_name IN SELECT unnest(ARRAY['marketplace_credentials','marketplace_oauth_states']) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',table_name);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',table_name);
 END LOOP;
END $$;

CREATE FUNCTION public.save_marketplace_account(p_channel text,p_name text,p_external_seller_id text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid;
BEGIN
 IF coalesce(p_channel,'') NOT IN('mercado_livre','shopee','tiktok_shop') OR length(coalesce(btrim(p_name),'')) NOT BETWEEN 1 AND 120
  OR length(coalesce(p_external_seller_id,''))>160 THEN RAISE EXCEPTION 'Canal, nome ou identificação da conta inválidos.'; END IF;
 INSERT INTO marketplace_accounts(tenant_id,channel,name,external_seller_id,connection_state)
 VALUES(t,p_channel,btrim(p_name),nullif(btrim(p_external_seller_id),''),CASE WHEN p_channel='mercado_livre' THEN 'pending_credentials' ELSE 'pending_access' END)
 ON CONFLICT(tenant_id,channel,name) DO UPDATE SET name=excluded.name RETURNING id INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.save_marketplace_sku_binding(p_account_id uuid,p_external_item_id text,p_external_variant_id text,p_external_sku text,p_product_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM erp_private.assert_ref('marketplace_accounts',p_account_id,t); PERFORM erp_private.assert_ref('products',p_product_id,t);
 IF p_account_id IS NULL OR p_product_id IS NULL OR NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND is_active)
  OR greatest(length(coalesce(p_external_item_id,'')),length(coalesce(p_external_variant_id,'')),length(coalesce(p_external_sku,'')))>160
  OR (coalesce(btrim(p_external_item_id),'')='' AND coalesce(btrim(p_external_sku),'')='') THEN RAISE EXCEPTION 'Informe conta, identificação externa e produto ativo.'; END IF;
 INSERT INTO marketplace_sku_bindings(tenant_id,account_id,external_item_id,external_variant_id,external_sku,product_id)
 VALUES(t,p_account_id,coalesce(btrim(p_external_item_id),''),coalesce(btrim(p_external_variant_id),''),coalesce(btrim(p_external_sku),''),p_product_id)
 ON CONFLICT(account_id,external_item_id,external_variant_id,external_sku) DO UPDATE SET product_id=excluded.product_id RETURNING id INTO result;
 UPDATE marketplace_orders mo SET needs_review=true,review_reason='O vínculo do SKU mudou. Atualize o rascunho antes de organizar a venda.'
 WHERE mo.account_id=p_account_id AND mo.tenant_id=t AND mo.internal_order_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM orders WHERE id=mo.internal_order_id AND status='draft')
  AND EXISTS(SELECT 1 FROM marketplace_order_items li WHERE li.marketplace_order_id=mo.id AND li.external_item_id=coalesce(btrim(p_external_item_id),'') AND li.external_variant_id=coalesce(btrim(p_external_variant_id),'') AND li.external_sku=coalesce(btrim(p_external_sku),'') AND li.product_id IS DISTINCT FROM p_product_id);
 UPDATE marketplace_order_items li SET product_id=p_product_id FROM marketplace_orders mo
 WHERE li.marketplace_order_id=mo.id AND mo.account_id=p_account_id AND mo.tenant_id=t
  AND li.external_item_id=coalesce(btrim(p_external_item_id),'') AND li.external_variant_id=coalesce(btrim(p_external_variant_id),'') AND li.external_sku=coalesce(btrim(p_external_sku),'')
  AND (mo.internal_order_id IS NULL OR EXISTS(SELECT 1 FROM orders WHERE id=mo.internal_order_id AND status='draft'));
 RETURN result;
END $$;

CREATE FUNCTION public.record_marketplace_event(p_account_id uuid,p_event_key text,p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; previous jsonb;
BEGIN
 PERFORM erp_private.assert_ref('marketplace_accounts',p_account_id,t);
 IF p_account_id IS NULL OR length(coalesce(p_event_key,'')) NOT BETWEEN 1 AND 300 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>65536 THEN RAISE EXCEPTION 'Evento inválido ou acima de 64 KB.'; END IF;
 INSERT INTO marketplace_events(tenant_id,account_id,event_key,payload) VALUES(t,p_account_id,p_event_key,p_payload) ON CONFLICT DO NOTHING;
 SELECT id,payload INTO result,previous FROM marketplace_events WHERE account_id=p_account_id AND event_key=p_event_key FOR UPDATE;
 IF previous IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Identidade de evento reutilizada com conteúdo diferente.'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.import_marketplace_orders(p_account_id uuid,p_orders jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); a marketplace_accounts; input jsonb; item jsonb; existing marketplace_orders; result uuid; event_id uuid;
 revision timestamptz; deadline timestamptz; subtotal numeric; shipping numeric; discount numeric; qty numeric; price numeric; fee numeric; reported numeric; requires_review boolean;
 imported integer:=0; unchanged integer:=0; ignored integer:=0; ids jsonb:='[]';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada.'; END IF;
 IF jsonb_typeof(p_orders) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Importe uma lista de pedidos.'; END IF;
 IF jsonb_array_length(p_orders) NOT BETWEEN 1 AND 100 OR octet_length(p_orders::text)>1048576 THEN RAISE EXCEPTION 'Importe de 1 a 100 pedidos e até 1 MB.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_orders) v GROUP BY v->>'external_order_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Pedido repetido no lote.'; END IF;
 -- Multi-order plate accounting also locks sales in id order; preserve that order for batches.
 PERFORM 1 FROM orders WHERE id IN(SELECT mo.internal_order_id FROM marketplace_orders mo WHERE mo.account_id=a.id AND mo.external_order_id IN(SELECT value->>'external_order_id' FROM jsonb_array_elements(p_orders))) ORDER BY id FOR UPDATE;
 FOR input IN SELECT value FROM jsonb_array_elements(p_orders) LOOP
  IF jsonb_typeof(input) IS DISTINCT FROM 'object' OR jsonb_typeof(input->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Pedido e lista de itens inválidos.'; END IF;
  IF jsonb_typeof(input->'external_order_id') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'external_status') IS DISTINCT FROM 'string'
   OR jsonb_typeof(input->'external_updated_at') IS DISTINCT FROM 'string'
   OR EXISTS(SELECT 1 FROM jsonb_each(input) kv WHERE kv.key IN('external_order_id','external_pack_id','external_shipment_id') AND (jsonb_typeof(kv.value) IS DISTINCT FROM 'string' OR kv.value#>>'{}' IS DISTINCT FROM btrim(kv.value#>>'{}'))) THEN RAISE EXCEPTION 'Identificadores devem ser textos sem espaços externos.'; END IF;
  IF length(coalesce(btrim(input->>'external_order_id'),'')) NOT BETWEEN 1 AND 160
   OR length(coalesce(btrim(input->>'external_status'),'')) NOT BETWEEN 1 AND 80 OR coalesce(input->>'currency','BRL')<>'BRL'
   OR coalesce(input->>'normalized_state','') NOT IN('paid','awaiting_payment','shipped','delivered','cancelled','unknown')
   OR coalesce(input->>'external_updated_at','') !~ 'T.+(Z|[+-][0-9]{2}:[0-9]{2})$'
   OR jsonb_array_length(input->'items') NOT BETWEEN 1 AND 500
   OR greatest(length(coalesce(input->>'external_pack_id','')),length(coalesce(input->>'external_shipment_id','')))>160
   OR length(coalesce(input->>'deadline_source',''))>120 THEN RAISE EXCEPTION 'Identidade, situação, data com fuso ou itens inválidos.'; END IF;
  revision:=(input->>'external_updated_at')::timestamptz; deadline:=nullif(input->>'shipping_deadline_at','')::timestamptz;
  IF NOT isfinite(revision) OR (deadline IS NOT NULL AND (NOT isfinite(deadline) OR coalesce(input->>'shipping_deadline_at','') !~ 'T.+(Z|[+-][0-9]{2}:[0-9]{2})$')) THEN RAISE EXCEPTION 'Data de atualização ou prazo inválidos.'; END IF;
  shipping:=coalesce((input->>'shipping_amount')::numeric,0); discount:=coalesce((input->>'discount_amount')::numeric,0);
  reported:=(input->>'reported_total')::numeric; fee:=(input->>'seller_fees')::numeric;
  IF NOT erp_private.valid_number(shipping) OR NOT erp_private.valid_number(discount) OR shipping<>round(shipping,2) OR discount<>round(discount,2)
   OR (reported IS NOT NULL AND (NOT erp_private.valid_number(reported) OR reported<>round(reported,2)))
   OR (fee IS NOT NULL AND (NOT erp_private.valid_number(fee) OR fee<>round(fee,2))) THEN RAISE EXCEPTION 'Valores monetários inválidos.'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(input->'items') v GROUP BY v->>'external_line_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Linha repetida no pedido.'; END IF;
  subtotal:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'items') LOOP
   qty:=(item->>'quantity')::numeric; price:=(item->>'unit_price')::numeric;
   IF jsonb_typeof(item->'external_line_id') IS DISTINCT FROM 'string'
    OR EXISTS(SELECT 1 FROM jsonb_each(item) kv WHERE kv.key IN('external_line_id','external_item_id','external_variant_id','external_sku') AND (jsonb_typeof(kv.value) IS DISTINCT FROM 'string' OR kv.value#>>'{}' IS DISTINCT FROM btrim(kv.value#>>'{}'))) THEN RAISE EXCEPTION 'Identificadores de linha devem ser textos sem espaços externos.'; END IF;
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR length(coalesce(item->>'external_line_id','')) NOT BETWEEN 1 AND 160 OR length(coalesce(btrim(item->>'description'),'')) NOT BETWEEN 1 AND 500
    OR greatest(length(coalesce(item->>'external_item_id','')),length(coalesce(item->>'external_variant_id','')),length(coalesce(item->>'external_sku','')))>160
    OR (coalesce(btrim(item->>'external_item_id'),'')='' AND coalesce(btrim(item->>'external_sku'),'')='')
    OR NOT erp_private.valid_number(qty,1) OR qty<>trunc(qty) OR qty>500 OR NOT erp_private.valid_number(price) OR price<>round(price,2) OR price>100000000 THEN RAISE EXCEPTION 'SKU, quantidade, descrição ou preço inválidos.'; END IF;
   subtotal:=subtotal+qty*price;
  END LOOP;
  IF discount>subtotal THEN RAISE EXCEPTION 'Desconto maior que os itens.'; END IF;
  -- Order -> inbox is the same lock order used by sales and physical job transitions.
  PERFORM 1 FROM orders WHERE id=(SELECT internal_order_id FROM marketplace_orders WHERE account_id=a.id AND external_order_id=input->>'external_order_id') FOR UPDATE;
  SELECT * INTO existing FROM marketplace_orders WHERE account_id=a.id AND external_order_id=input->>'external_order_id' FOR UPDATE;
  IF existing.id IS NOT NULL AND revision<existing.external_updated_at THEN ignored:=ignored+1; CONTINUE; END IF;
  IF existing.id IS NOT NULL AND input=existing.canonical_payload THEN unchanged:=unchanged+1; ids:=ids||jsonb_build_array(existing.id); CONTINUE; END IF;
  -- Shipment SLA is an independent resource: a cutoff may change without an order revision.
  IF existing.id IS NOT NULL AND revision=existing.external_updated_at
   AND (input-ARRAY['shipping_deadline_at','deadline_source']) IS DISTINCT FROM (existing.canonical_payload-ARRAY['shipping_deadline_at','deadline_source']) THEN RAISE EXCEPTION 'Pedido %: revisão com mesmo horário e dados comerciais diferentes. Confira a origem.',input->>'external_order_id'; END IF;
  requires_review:=existing.internal_order_id IS NOT NULL AND (
   existing.needs_review OR input->>'normalized_state' IN('awaiting_payment','cancelled','unknown') OR deadline IS NULL
   OR EXISTS(SELECT 1 FROM orders WHERE id=existing.internal_order_id AND internal_due_at>deadline)
   OR input->'items' IS DISTINCT FROM existing.canonical_payload->'items'
   OR shipping IS DISTINCT FROM existing.shipping_amount OR discount IS DISTINCT FROM existing.discount_amount
   OR reported IS DISTINCT FROM existing.reported_total OR fee IS DISTINCT FROM existing.seller_fees);
  result:=coalesce(existing.id,gen_random_uuid());
  INSERT INTO marketplace_orders(id,tenant_id,account_id,external_order_id,external_pack_id,external_shipment_id,external_status,normalized_state,external_updated_at,shipping_deadline_at,deadline_source,currency,shipping_amount,discount_amount,total,reported_total,seller_fees,canonical_payload,needs_review,review_reason)
  VALUES(result,t,a.id,input->>'external_order_id',coalesce(input->>'external_pack_id',''),coalesce(input->>'external_shipment_id',''),input->>'external_status',input->>'normalized_state',revision,deadline,coalesce(input->>'deadline_source',''),'BRL',shipping,discount,subtotal+shipping-discount,reported,fee,input,requires_review,CASE WHEN EXISTS(SELECT 1 FROM orders WHERE id=existing.internal_order_id AND internal_due_at>deadline) THEN 'O canal antecipou o despacho para antes da meta interna. Ajuste a meta em Pedidos e confira a revisão antes de continuar.' WHEN requires_review THEN 'O canal alterou pagamento, itens, valores ou exige revisão após sua importação para vendas. Confira antes de continuar.' END)
  ON CONFLICT(id) DO UPDATE SET external_pack_id=excluded.external_pack_id,external_shipment_id=excluded.external_shipment_id,external_status=excluded.external_status,normalized_state=excluded.normalized_state,external_updated_at=excluded.external_updated_at,shipping_deadline_at=excluded.shipping_deadline_at,deadline_source=excluded.deadline_source,shipping_amount=excluded.shipping_amount,discount_amount=excluded.discount_amount,total=excluded.total,reported_total=excluded.reported_total,seller_fees=excluded.seller_fees,canonical_payload=excluded.canonical_payload,needs_review=excluded.needs_review,review_reason=excluded.review_reason,imported_at=now();
  DELETE FROM marketplace_order_items WHERE marketplace_order_id=result;
  FOR item IN SELECT value FROM jsonb_array_elements(input->'items') LOOP
   INSERT INTO marketplace_order_items(tenant_id,marketplace_order_id,external_line_id,external_item_id,external_variant_id,external_sku,description,quantity,unit_price,product_id)
   VALUES(t,result,item->>'external_line_id',coalesce(item->>'external_item_id',''),coalesce(item->>'external_variant_id',''),coalesce(item->>'external_sku',''),btrim(item->>'description'),(item->>'quantity')::integer,(item->>'unit_price')::numeric,
    (SELECT product_id FROM marketplace_sku_bindings WHERE account_id=a.id AND external_item_id=coalesce(item->>'external_item_id','') AND external_variant_id=coalesce(item->>'external_variant_id','') AND external_sku=coalesce(item->>'external_sku','')));
  END LOOP;
  IF existing.internal_order_id IS NOT NULL AND NOT requires_review THEN
   UPDATE orders SET ship_by_at=deadline WHERE id=existing.internal_order_id;
  END IF;
  event_id:=record_marketplace_event(a.id,'import:'||(input->>'external_order_id')||':'||revision::text||':'||md5(input::text),input);
  UPDATE marketplace_events SET status='processed',processed_at=now() WHERE id=event_id;
  imported:=imported+1; ids:=ids||jsonb_build_array(result);
 END LOOP;
 UPDATE marketplace_accounts SET last_sync_at=now(),updated_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('imported',imported,'unchanged',unchanged,'ignored_older',ignored,'order_ids',ids);
END $$;

CREATE FUNCTION public.create_sales_order_from_marketplace(p_marketplace_order_id uuid,p_customer_id uuid,p_payment_due_date date,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); mo marketplace_orders; result uuid; items jsonb; previous uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 PERFORM 1 FROM orders WHERE id=(SELECT internal_order_id FROM marketplace_orders WHERE id=p_marketplace_order_id AND tenant_id=t) FOR UPDATE;
 SELECT * INTO mo FROM marketplace_orders WHERE id=p_marketplace_order_id AND tenant_id=t FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido do canal não encontrado.'; END IF;
 IF mo.normalized_state<>'paid' THEN RAISE EXCEPTION 'Somente pedidos pagos podem entrar em vendas. Confira pagamento/cancelamento no canal.'; END IF;
 IF mo.shipping_deadline_at IS NULL THEN RAISE EXCEPTION 'Confira e importe o prazo real de despacho do pedido antes de organizar a venda.'; END IF;
 IF EXISTS(SELECT 1 FROM orders WHERE id=mo.internal_order_id AND internal_due_at>mo.shipping_deadline_at) THEN RAISE EXCEPTION 'O prazo do canal foi antecipado. Ajuste a meta interna em Pedidos para antes do despacho e revise novamente.'; END IF;
 IF mo.internal_order_id IS NOT NULL AND NOT mo.needs_review THEN RETURN mo.internal_order_id; END IF;
 IF mo.internal_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orders WHERE id=mo.internal_order_id AND status='draft') THEN RAISE EXCEPTION 'Pedido já organizado foi alterado no canal. Revise vendas/produção antes de atualizar.'; END IF;
 IF mo.internal_order_id IS NOT NULL AND EXISTS(SELECT 1 FROM order_items WHERE order_id=mo.internal_order_id AND (jsonb_array_length(material_overrides)>0 OR coalesce(btrim(notes),'')<>'')) THEN RAISE EXCEPTION 'O rascunho tem escolhas de materiais ou observações por item. Revise as alterações do canal em Pedidos; a atualização automática não pode apagar essas escolhas.'; END IF;
 IF p_customer_id IS NULL OR p_payment_due_date IS NULL THEN RAISE EXCEPTION 'Informe cliente e data prevista do recebível. Pagamento no canal não significa repasse recebido.'; END IF;
 IF EXISTS(SELECT 1 FROM marketplace_order_items li LEFT JOIN products p ON p.id=li.product_id WHERE li.marketplace_order_id=mo.id AND (li.product_id IS NULL OR NOT p.is_active OR p.tenant_id<>t)) THEN RAISE EXCEPTION 'Vincule todos os SKUs a produtos ativos antes de criar a venda.'; END IF;
 IF mo.reported_total IS NOT NULL AND mo.reported_total<>mo.total THEN RAISE EXCEPTION 'O valor informado pelo canal difere dos itens/frete/desconto. Reconcilie os valores antes de criar a venda.'; END IF;
 SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'description',description,'quantity',quantity,'unit_price',unit_price,'total',quantity*unit_price)) INTO items FROM marketplace_order_items WHERE marketplace_order_id=mo.id;
 result:=save_sales_order(mo.internal_order_id,jsonb_build_object('customer_id',p_customer_id,'payment_due_date',p_payment_due_date,'shipping',mo.shipping_amount,'discount',mo.discount_amount,'total',mo.total,'ship_by_at',mo.shipping_deadline_at,'notes',coalesce((SELECT notes FROM orders WHERE id=mo.internal_order_id),'Canal: '||(SELECT name FROM marketplace_accounts WHERE id=mo.account_id)||' / pedido '||mo.external_order_id)),items,p_request_id);
 UPDATE orders SET marketplace_order_id=mo.id,ship_by_at=mo.shipping_deadline_at WHERE id=result;
 UPDATE marketplace_orders SET internal_order_id=result,needs_review=false,review_reason=NULL WHERE id=mo.id;
 RETURN result;
END $$;

CREATE FUNCTION public.erp_guard_marketplace_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mo marketplace_orders;
BEGIN
 IF OLD.marketplace_order_id IS NOT NULL AND NEW.marketplace_order_id IS DISTINCT FROM OLD.marketplace_order_id THEN RAISE EXCEPTION 'O vínculo do pedido com o marketplace não pode ser removido ou trocado.'; END IF;
 IF NEW.marketplace_order_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN('approved','in_production','ready','shipped','delivered','completed') THEN
  SELECT * INTO mo FROM marketplace_orders WHERE id=NEW.marketplace_order_id AND tenant_id=NEW.tenant_id FOR UPDATE;
  IF mo.id IS NULL OR mo.normalized_state IN('awaiting_payment','cancelled','unknown') OR mo.needs_review
   OR (NEW.status::text IN('approved','in_production') AND mo.normalized_state<>'paid')
   OR (NEW.status::text='ready' AND OLD.status::text<>'in_production' AND mo.normalized_state<>'paid') THEN RAISE EXCEPTION 'O pedido do marketplace exige revisão de pagamento/cancelamento ou foi alterado. Regularize antes de continuar.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_guard_marketplace_order BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION erp_guard_marketplace_order();

CREATE FUNCTION public.erp_guard_marketplace_job_start() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mo marketplace_orders; source_order uuid;
BEGIN
 IF NEW.status::text='printing' AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
  source_order:=coalesce(NEW.order_id,(SELECT source_order_id FROM production_orders WHERE id=NEW.production_order_id));
  SELECT mo_row.* INTO mo FROM marketplace_orders mo_row JOIN orders o ON o.marketplace_order_id=mo_row.id WHERE o.id=source_order AND o.tenant_id=NEW.tenant_id FOR UPDATE OF mo_row;
  IF mo.id IS NOT NULL AND (mo.normalized_state<>'paid' OR mo.needs_review) THEN RAISE EXCEPTION 'A impressão não pode iniciar ou retomar: o pedido do marketplace exige revisão ou já foi enviado/cancelado.'; END IF;
 END IF;
 -- Finishing/failing an already-started print must still account for real consumption.
 RETURN NEW;
END $$;
CREATE TRIGGER erp_guard_marketplace_job_start BEFORE INSERT OR UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION erp_guard_marketplace_job_start();

CREATE FUNCTION public.review_marketplace_order(p_marketplace_order_id uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); mo marketplace_orders; o orders; external_lines jsonb; internal_lines jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('erp-products-'||t::text,0));
 SELECT * INTO o FROM orders WHERE id=(SELECT internal_order_id FROM marketplace_orders WHERE id=p_marketplace_order_id AND tenant_id=t) AND tenant_id=t FOR UPDATE;
 SELECT * INTO mo FROM marketplace_orders WHERE id=p_marketplace_order_id AND tenant_id=t FOR UPDATE;
 IF mo.id IS NULL OR o.id IS NULL OR o.status='cancelled' THEN RAISE EXCEPTION 'Selecione um pedido vinculado ativo para revisar.'; END IF;
 IF NOT mo.needs_review THEN RETURN o.id; END IF;
 IF length(coalesce(btrim(p_reason),'')) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Registre o que foi conferido na revisão (10 a 1000 caracteres).'; END IF;
 IF mo.normalized_state<>'paid' OR mo.shipping_deadline_at IS NULL THEN RAISE EXCEPTION 'O canal precisa confirmar pagamento e prazo real antes de liberar a revisão.'; END IF;
 IF o.internal_due_at>mo.shipping_deadline_at THEN RAISE EXCEPTION 'O prazo do canal foi antecipado. Ajuste a meta interna em Pedidos para antes do despacho e revise novamente.'; END IF;
 IF mo.shipping_amount IS DISTINCT FROM o.shipping OR mo.discount_amount IS DISTINCT FROM o.discount OR mo.total IS DISTINCT FROM o.total OR (mo.reported_total IS NOT NULL AND mo.reported_total<>mo.total) THEN RAISE EXCEPTION 'Valores do canal e da venda ainda divergem. Reconcilie em Pedidos antes de liberar.'; END IF;
 SELECT jsonb_agg(jsonb_build_array(product_id,description,quantity,unit_price,quantity*unit_price) ORDER BY product_id,description,quantity,unit_price) INTO external_lines FROM marketplace_order_items WHERE marketplace_order_id=mo.id;
 SELECT jsonb_agg(jsonb_build_array(product_id,description,quantity,unit_price,total) ORDER BY product_id,description,quantity,unit_price) INTO internal_lines FROM order_items WHERE order_id=o.id;
 IF external_lines IS NULL OR external_lines IS DISTINCT FROM internal_lines OR EXISTS(SELECT 1 FROM marketplace_order_items li LEFT JOIN products p ON p.id=li.product_id WHERE li.marketplace_order_id=mo.id AND (p.id IS NULL OR NOT p.is_active OR p.tenant_id<>t)) THEN RAISE EXCEPTION 'Itens, produtos, quantidades ou preços do canal e da venda ainda divergem.'; END IF;
 -- Keep operator material choices, stock allocations, production snapshots and financial history.
 UPDATE orders SET ship_by_at=mo.shipping_deadline_at WHERE id=o.id;
 UPDATE marketplace_orders SET needs_review=false,review_reason=NULL WHERE id=mo.id;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'marketplace_review','marketplace_orders',mo.id,jsonb_build_object('reason',btrim(p_reason),'external_updated_at',mo.external_updated_at,'order_id',o.id));
 RETURN o.id;
END $$;

CREATE FUNCTION public.claim_marketplace_sync(p_account_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE lease uuid:=gen_random_uuid();
BEGIN
 UPDATE marketplace_accounts SET sync_locked_until=now()+interval '90 seconds',sync_lock_id=lease WHERE id=p_account_id AND (sync_locked_until IS NULL OR sync_locked_until<now());
 IF FOUND THEN RETURN lease; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_marketplace_sync(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketplace_sync(uuid) TO service_role;
CREATE FUNCTION public.release_marketplace_sync(p_account_id uuid,p_lease uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE marketplace_accounts SET sync_locked_until=NULL,sync_lock_id=NULL WHERE id=p_account_id AND sync_lock_id=p_lease;
$$;
REVOKE ALL ON FUNCTION public.release_marketplace_sync(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_marketplace_sync(uuid,uuid) TO service_role;
CREATE FUNCTION public.persist_marketplace_credentials(p_account_id uuid,p_lease uuid,p_seller_id text,p_access_token text,p_refresh_token text,p_expires_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a marketplace_accounts;
BEGIN
 SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id FOR UPDATE;
 IF a.id IS NULL OR a.channel<>'mercado_livre' OR a.sync_lock_id IS DISTINCT FROM p_lease OR a.sync_locked_until<now() OR p_lease IS NULL THEN RAISE EXCEPTION 'A autorização perdeu sua reserva de execução. Inicie novamente.'; END IF;
 IF coalesce(p_seller_id,'') !~ '^[0-9]{1,24}$' OR (a.external_seller_id IS NOT NULL AND a.external_seller_id<>p_seller_id) THEN RAISE EXCEPTION 'A autorização pertence a outro vendedor.'; END IF;
 IF length(coalesce(p_access_token,'')) NOT BETWEEN 1 AND 16384 OR length(coalesce(p_refresh_token,'')) NOT BETWEEN 1 AND 16384 OR p_expires_at IS NULL OR NOT isfinite(p_expires_at) OR p_expires_at<=now() THEN RAISE EXCEPTION 'Credenciais incompletas ou expiradas.'; END IF;
 INSERT INTO marketplace_credentials(account_id,access_token,refresh_token,expires_at) VALUES(a.id,p_access_token,p_refresh_token,p_expires_at)
 ON CONFLICT(account_id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,updated_at=now();
 UPDATE marketplace_accounts SET external_seller_id=p_seller_id,connection_state='connected',updated_at=now() WHERE id=a.id;
END $$;
REVOKE ALL ON FUNCTION public.persist_marketplace_credentials(uuid,uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_marketplace_credentials(uuid,uuid,text,text,text,timestamptz) TO service_role;
DO $$ DECLARE proc record; BEGIN
 FOR proc IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('save_marketplace_account','save_marketplace_sku_binding','record_marketplace_event','import_marketplace_orders','create_sales_order_from_marketplace','review_marketplace_order') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',proc.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',proc.signature);
 END LOOP;
END $$;
