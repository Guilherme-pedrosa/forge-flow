-- The financial operator accepts the live official ML quote through the Source
-- server. A browser cannot manufacture official fees using this RPC directly.
CREATE FUNCTION public.confirm_integrador_publication_quote(p_bridge_id uuid,p_account_id uuid,p_product_id uuid,p_seller_id text,
 p_source_proof text,p_quote jsonb,p_listing_type_id text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); b integrador_bridge_bindings; a marketplace_accounts; snapshot jsonb; selected jsonb;
 current_preview jsonb; cost_context jsonb; accepted product_channel_pricing_acceptances; prior uuid; result uuid;
 overrides jsonb; quote_time timestamptz; price numeric; variable_fee numeric; fixed_fee numeric; official_fee numeric; shipping numeric; cost numeric; k text;
BEGIN
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=p_bridge_id AND tenant_id=t AND enabled FOR UPDATE;
 SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t AND channel='mercado_livre' FOR UPDATE;
 IF b.id IS NULL OR a.id IS NULL OR a.external_seller_id IS DISTINCT FROM p_seller_id OR NOT(p_seller_id=ANY(b.approved_seller_ids))
  OR NOT EXISTS(SELECT 1 FROM integrador_marketplace_account_links WHERE account_id=a.id AND tenant_id=t AND bridge_id=b.id AND source_seller_id=p_seller_id)
  OR coalesce(p_source_proof,'') !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM erp_private.integrador_enrollment_proofs WHERE bridge_id=b.id AND enabled
   AND proof_sha256=encode(sha256(convert_to(p_source_proof,'UTF8')),'hex')) THEN
  RAISE EXCEPTION 'A cotação oficial precisa ser confirmada pelo servidor Mercado Livre desta empresa.' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_quote) IS DISTINCT FROM 'object' OR octet_length(p_quote::text)>65536 OR p_request_id IS NULL
  OR p_listing_type_id NOT IN('gold_special','gold_pro') OR p_listing_type_id IS NULL
  OR p_quote->>'account_id' IS DISTINCT FROM a.id::text OR p_quote->>'product_id' IS DISTINCT FROM p_product_id::text
  OR p_quote->>'seller_id' IS DISTINCT FROM p_seller_id OR coalesce(p_quote->>'revision','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_quote->>'forge_revision','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_quote->'quotes') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Confira a identidade e a revisão da cotação oficial.';
 END IF;
 prior:=erp_private.begin_request(t,p_request_id,'integrador_publication_quote',jsonb_build_array(b.id,a.id,p_product_id,p_seller_id,p_quote-'quoted_at',p_listing_type_id));
 IF prior IS NOT NULL THEN RETURN jsonb_build_object('accepted',true,'acceptance_id',prior,'quote_revision',p_quote->>'revision','replayed',true); END IF;
 quote_time:=(p_quote->>'quoted_at')::timestamptz;
 IF quote_time IS NULL OR quote_time<clock_timestamp()-interval '5 minutes' OR quote_time>clock_timestamp()+interval '1 minute' THEN
  RAISE EXCEPTION 'Atualize a cotação de tarifas e frete antes de confirmar o preço.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('channel-pricing-'||t::text||':mercado_livre',0));
 PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active AND NOT is_component FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 snapshot:=public.integrador_publication_snapshot(a.id,p_product_id);
 IF snapshot->>'revision' IS DISTINCT FROM p_quote->>'forge_revision'
  OR snapshot->'manufacturing'->>'complete' IS DISTINCT FROM 'true'
  OR snapshot->'manufacturing'->>'cost_revision' IS DISTINCT FROM p_quote->>'cost_revision'
  OR snapshot->'pricing_policy'->>'revision' IS DISTINCT FROM p_quote->>'policy_revision' THEN
  RAISE EXCEPTION 'O produto, o custo, o estoque ou as condições mudaram. Atualize a cotação do anúncio.';
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_quote->'quotes') q WHERE q->>'listing_type_id'=p_listing_type_id)<>1 THEN
  RAISE EXCEPTION 'Escolha uma única cotação Clássico ou Premium.';
 END IF;
 SELECT q INTO selected FROM jsonb_array_elements(p_quote->'quotes') q WHERE q->>'listing_type_id'=p_listing_type_id;
 IF selected->'complete' IS DISTINCT FROM 'true'::jsonb OR coalesce(selected->>'official_revision','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Complete as tarifas, o frete e as despesas antes de confirmar o preço.'; END IF;
 FOREACH k IN ARRAY ARRAY['commission_amount','commission_percent','fixed_fee','shipping_cost'] LOOP
  IF jsonb_typeof(selected->k) IS DISTINCT FROM 'number' OR NOT erp_private.valid_number((selected->>k)::numeric) OR (selected->>k)::numeric>1000000000 THEN
   RAISE EXCEPTION 'A cotação oficial está incompleta: %.',k;
  END IF;
 END LOOP;
 IF jsonb_typeof(p_quote->'unit_price') IS DISTINCT FROM 'number' OR jsonb_typeof(p_quote->'unit_cost') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Confira o preço e o custo cotados.'; END IF;
 price:=(p_quote->>'unit_price')::numeric; cost:=(p_quote->>'unit_cost')::numeric;
 variable_fee:=(selected->>'commission_percent')::numeric; fixed_fee:=(selected->>'fixed_fee')::numeric;
 official_fee:=(selected->>'commission_amount')::numeric; shipping:=(selected->>'shipping_cost')::numeric;
 IF NOT erp_private.valid_number(price,0.01) OR price>1000000000 OR price<>round(price,2) OR variable_fee>=100
  OR NOT erp_private.valid_number(cost) OR round(cost,4) IS DISTINCT FROM round((snapshot->'manufacturing'->>'unit_cost')::numeric,4)
  OR abs(round(price*variable_fee/100+fixed_fee,2)-round(official_fee,2))>0.01 THEN
  RAISE EXCEPTION 'O preço, o custo ou a composição da tarifa oficial precisam ser conferidos.';
 END IF;
 SELECT old.* INTO accepted FROM product_channel_pricing_acceptances old JOIN product_channel_prices p ON p.acceptance_id=old.id
  AND p.tenant_id=t AND p.product_id=p_product_id AND p.channel='mercado_livre'
  WHERE old.tenant_id=t AND old.product_id=p_product_id AND old.channel='mercado_livre' AND old.quantity=1;
 IF accepted.snapshot->>'cost_source'='simulation' THEN cost_context:=accepted.snapshot->'cost_snapshot'->'cost_context'; END IF;
 overrides:=jsonb_build_object('commission_percent',variable_fee,'fixed_fee_per_item',fixed_fee,'fixed_fee_per_order',0,'seller_shipping_per_order',shipping);
 current_preview:=erp_private.channel_preview(p_product_id,t,'mercado_livre',1,overrides,price,cost_context);
 IF current_preview->>'cost_revision' IS DISTINCT FROM p_quote->>'cost_revision'
  OR current_preview->>'policy_revision' IS DISTINCT FROM p_quote->>'policy_revision' THEN RAISE EXCEPTION 'O custo ou as condições mudaram. Atualize a cotação do anúncio.'; END IF;
 result:=erp_private.accept_channel_preview(p_product_id,t,current_preview||jsonb_build_object('official_quote',p_quote,'listing_type_id',p_listing_type_id));
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'accept_official_marketplace_quote','products',p_product_id,
  jsonb_build_object('account_id',a.id,'seller_id',p_seller_id,'acceptance_id',result,'quote_revision',p_quote->>'revision','listing_type_id',p_listing_type_id));
 PERFORM erp_private.finish_request(t,p_request_id,result);
 RETURN jsonb_build_object('accepted',true,'acceptance_id',result,'quote_revision',p_quote->>'revision','replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.confirm_integrador_publication_quote(uuid,uuid,uuid,text,text,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_integrador_publication_quote(uuid,uuid,uuid,text,text,jsonb,text,uuid) TO authenticated;

-- Recover an accepted local price before re-quoting. Accepting the price changes
-- the publication revision, so a lost HTTP receipt must not force a second write.
CREATE FUNCTION public.lookup_integrador_publication_quote(p_bridge_id uuid,p_account_id uuid,p_product_id uuid,p_seller_id text,
 p_source_proof text,p_expected_quote_revision text,p_listing_type_id text,p_unit_price numeric,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); b integrador_bridge_bindings; a marketplace_accounts; prior erp_private.requests; accepted product_channel_pricing_acceptances;
BEGIN
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=p_bridge_id AND tenant_id=t AND enabled;
 SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t AND channel='mercado_livre';
 IF b.id IS NULL OR a.id IS NULL OR a.external_seller_id IS DISTINCT FROM p_seller_id OR NOT(p_seller_id=ANY(b.approved_seller_ids))
  OR NOT EXISTS(SELECT 1 FROM integrador_marketplace_account_links WHERE account_id=a.id AND tenant_id=t AND bridge_id=b.id AND source_seller_id=p_seller_id)
  OR coalesce(p_source_proof,'') !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM erp_private.integrador_enrollment_proofs WHERE bridge_id=b.id AND enabled
   AND proof_sha256=encode(sha256(convert_to(p_source_proof,'UTF8')),'hex')) THEN
  RAISE EXCEPTION 'A cotação oficial precisa ser confirmada pelo servidor Mercado Livre desta empresa.' USING ERRCODE='42501';
 END IF;
 IF p_request_id IS NULL OR coalesce(p_expected_quote_revision,'') !~ '^[a-f0-9]{64}$' OR p_listing_type_id IS NULL
  OR p_listing_type_id NOT IN('gold_special','gold_pro') OR NOT erp_private.valid_number(p_unit_price,0.01) THEN RAISE EXCEPTION 'Confira a solicitação da cotação oficial.'; END IF;
 SELECT * INTO prior FROM erp_private.requests WHERE tenant_id=t AND request_id=p_request_id;
 IF prior.request_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO accepted FROM product_channel_pricing_acceptances WHERE id=prior.result_id AND tenant_id=t AND product_id=p_product_id AND channel='mercado_livre' AND quantity=1 AND created_by=auth.uid();
 IF prior.operation<>'integrador_publication_quote' OR prior.payload->>0 IS DISTINCT FROM b.id::text OR prior.payload->>1 IS DISTINCT FROM a.id::text
  OR prior.payload->>2 IS DISTINCT FROM p_product_id::text OR prior.payload->>3 IS DISTINCT FROM p_seller_id OR prior.payload->>5 IS DISTINCT FROM p_listing_type_id
  OR accepted.id IS NULL OR accepted.snapshot->'official_quote'->>'revision' IS DISTINCT FROM p_expected_quote_revision
  OR accepted.unit_price IS DISTINCT FROM p_unit_price THEN RAISE EXCEPTION 'Identificador já utilizado por outra cotação ou operação.'; END IF;
 RETURN jsonb_build_object('accepted',true,'acceptance_id',accepted.id,'quote_revision',p_expected_quote_revision,'replayed',true);
END $$;
REVOKE ALL ON FUNCTION public.lookup_integrador_publication_quote(uuid,uuid,uuid,text,text,text,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lookup_integrador_publication_quote(uuid,uuid,uuid,text,text,text,text,numeric,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';

-- A marketing-only edit can renew a still-current immutable price acceptance.
-- Retain the official tariff proof and listing type with that NEW acceptance;
-- packaging/economic changes continue to require a new official quotation.
DO $migration$
DECLARE definition text;needle text:='reaccepted:=erp_private.accept_channel_preview(product.id,t,fresh);';replacement text;
BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.save_marketplace_publication_details(uuid,uuid,jsonb,text,uuid)')) IS DISTINCT FROM '4649d950eb89010d2c78c530d0d9593d' THEN
  RAISE EXCEPTION 'Review commercial completion before preserving the official price evidence.';
 END IF;
 SELECT pg_get_functiondef('public.save_marketplace_publication_details(uuid,uuid,jsonb,text,uuid)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Commercial price-renewal adapter did not match.';END IF;
 replacement:='reaccepted:=erp_private.accept_channel_preview(product.id,t,fresh||CASE WHEN acceptance.snapshot ? ''official_quote'' THEN jsonb_build_object(''official_quote'',acceptance.snapshot->''official_quote'',''listing_type_id'',acceptance.snapshot->>''listing_type_id'') ELSE ''{}''::jsonb END);';
 EXECUTE replace(definition,needle,replacement);
END $migration$;
