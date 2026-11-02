-- Explicit company assumptions and product/channel acceptances. No official
-- marketplace tariffs, fiscal rates, credentials or factory-price updates.
CREATE TABLE public.channel_pricing_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 channel text NOT NULL CHECK(channel IN('direct','mercado_livre','shopee','tiktok','other')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), assumptions jsonb NOT NULL CHECK(jsonb_typeof(assumptions)='object'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL REFERENCES auth.users(id),
 UNIQUE(tenant_id,channel)
);
CREATE TABLE public.channel_pricing_policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 policy_id uuid NOT NULL REFERENCES channel_pricing_policies(id), channel text NOT NULL,
 version bigint NOT NULL, assumptions jsonb NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(tenant_id,channel,version)
);
CREATE TABLE public.product_channel_pricing_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 product_id uuid NOT NULL REFERENCES products(id), channel text NOT NULL CHECK(channel IN('direct','mercado_livre','shopee','tiktok','other')),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 10000), unit_cost numeric NOT NULL, unit_price numeric NOT NULL,
 cost_revision text NOT NULL, policy_revision text NOT NULL, preview_revision text NOT NULL, snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(erp_private.valid_number(unit_cost) AND unit_cost<=1000000000),
 CHECK(erp_private.valid_number(unit_price,0.01) AND unit_price<=1000000000 AND unit_price=round(unit_price,2))
);
CREATE TABLE public.product_channel_prices (
 tenant_id uuid NOT NULL REFERENCES tenants(id), product_id uuid NOT NULL REFERENCES products(id),
 channel text NOT NULL CHECK(channel IN('direct','mercado_livre','shopee','tiktok','other')),
 acceptance_id uuid NOT NULL REFERENCES product_channel_pricing_acceptances(id), unit_price numeric NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(tenant_id,product_id,channel)
);
ALTER TABLE channel_pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_pricing_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_channel_pricing_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_channel_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON channel_pricing_policies,channel_pricing_policy_versions,product_channel_pricing_acceptances,product_channel_prices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON channel_pricing_policies,channel_pricing_policy_versions,product_channel_pricing_acceptances,product_channel_prices TO authenticated;
CREATE POLICY channel_policy_read ON channel_pricing_policies FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE POLICY channel_policy_versions_read ON channel_pricing_policy_versions FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE POLICY channel_acceptances_read ON product_channel_pricing_acceptances FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());
CREATE POLICY channel_prices_read ON product_channel_prices FOR SELECT TO authenticated USING(tenant_id=get_user_tenant_id());

CREATE FUNCTION erp_private.immutable_channel_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'O histórico de condições e aceites do canal é imutável.';
END $$;
CREATE TRIGGER immutable_channel_policy_version BEFORE UPDATE OR DELETE ON channel_pricing_policy_versions FOR EACH ROW EXECUTE FUNCTION erp_private.immutable_channel_snapshot();
CREATE TRIGGER immutable_channel_acceptance BEFORE UPDATE OR DELETE ON product_channel_pricing_acceptances FOR EACH ROW EXECUTE FUNCTION erp_private.immutable_channel_snapshot();

CREATE FUNCTION erp_private.check_channel(p_channel text) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
 IF p_channel IS NULL OR p_channel NOT IN('direct','mercado_livre','shopee','tiktok','other') THEN RAISE EXCEPTION 'Escolha um canal de venda válido.'; END IF;
END $$;
CREATE FUNCTION erp_private.channel_assumptions(p_values jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE k text; v jsonb; n numeric; result jsonb:='{}'; keys text[]:=ARRAY['commission_percent','tax_percent','fixed_fee_per_order','fixed_fee_per_item','seller_shipping_per_order','advertising_per_order','other_cost_per_order','target_margin'];
BEGIN
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR octet_length(p_values::text)>8192
   OR p_values-keys<>'{}'::jsonb THEN RAISE EXCEPTION 'Condições do canal inválidas.'; END IF;
 FOREACH k IN ARRAY keys LOOP
  v:=coalesce(p_values->k,'null'::jsonb);
  IF v<>'null'::jsonb THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Confirme um número ou deixe não informado: %.',k; END IF;
   n:=(v#>>'{}')::numeric;
   IF NOT erp_private.valid_number(n) OR n>1000000000 OR (k=ANY(ARRAY['commission_percent','tax_percent','target_margin']) AND n>=100) THEN RAISE EXCEPTION 'Condição do canal fora do limite: %.',k; END IF;
  END IF;
  result:=result||jsonb_build_object(k,v);
 END LOOP;
 IF coalesce((result->>'commission_percent')::numeric,0)+coalesce((result->>'tax_percent')::numeric,0)+coalesce((result->>'target_margin')::numeric,0)>=100 THEN
  RAISE EXCEPTION 'Comissão + tributo + margem desejada devem somar menos de 100%%.';
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION erp_private.read_channel_policy(p_tenant uuid,p_channel text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE saved channel_pricing_policies; assumptions jsonb;
BEGIN
 PERFORM erp_private.check_channel(p_channel);
 SELECT * INTO saved FROM channel_pricing_policies WHERE tenant_id=p_tenant AND channel=p_channel;
 assumptions:=erp_private.channel_assumptions(coalesce(saved.assumptions,'{}'::jsonb));
 RETURN jsonb_build_object('channel',p_channel,'configured',saved.id IS NOT NULL,'assumptions',assumptions,
  'revision',md5(jsonb_build_array(p_tenant,p_channel,saved.id,saved.version,saved.updated_at,assumptions)::text));
END $$;
CREATE FUNCTION public.channel_pricing_policy(p_channel text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Entre na sua empresa para consultar as condições do canal.' USING ERRCODE='42501'; END IF;
 RETURN erp_private.read_channel_policy(t,p_channel);
END $$;
CREATE FUNCTION public.save_channel_pricing_policy(p_channel text,p_assumptions jsonb,p_expected_revision text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; current jsonb; normalized jsonb; saved channel_pricing_policies;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'channel_pricing_policy',jsonb_build_array(p_channel,p_assumptions,p_expected_revision)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM erp_private.check_channel(p_channel);
 PERFORM pg_advisory_xact_lock(hashtextextended('channel-pricing-'||t::text||':'||p_channel,0));
 current:=erp_private.read_channel_policy(t,p_channel);
 IF current->>'revision' IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'As condições do canal mudaram. Reabra antes de salvar.'; END IF;
 normalized:=erp_private.channel_assumptions(p_assumptions);
 INSERT INTO channel_pricing_policies(tenant_id,channel,assumptions,updated_by) VALUES(t,p_channel,normalized,auth.uid())
 ON CONFLICT(tenant_id,channel) DO UPDATE SET assumptions=excluded.assumptions,version=channel_pricing_policies.version+1,updated_at=clock_timestamp(),updated_by=auth.uid() RETURNING * INTO saved;
 INSERT INTO channel_pricing_policy_versions(tenant_id,policy_id,channel,version,assumptions,created_by) VALUES(t,saved.id,p_channel,saved.version,normalized,auth.uid());
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'save_channel_pricing_policy','channel_pricing_policies',saved.id,jsonb_build_object('channel',p_channel,'version',saved.version,'assumptions',normalized));
 PERFORM erp_private.finish_request(t,p_request_id,saved.id); RETURN saved.id;
END $$;

CREATE FUNCTION erp_private.channel_catalog_cost(p_product uuid,p_tenant uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE p products; source text; canonical jsonb; cost numeric; accessory numeric; other numeric; complete boolean; missing jsonb:='[]'; revision text;
BEGIN
 SELECT * INTO p FROM products WHERE id=p_product AND tenant_id=p_tenant AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 source:=CASE WHEN p.catalog_details->>'cost_source'='composition' THEN 'composition' ELSE 'manual' END;
 IF source='composition' THEN
  canonical:=erp_private.catalog_pricing_snapshot(p_product,p_tenant);
  accessory:=coalesce((p.catalog_details->>'accessory_cost')::numeric,0); other:=coalesce((p.catalog_details->>'other_cost')::numeric,0);
  IF canonical->>'complete'='true' AND erp_private.valid_number((canonical->>'cost_per_unit')::numeric)
   AND erp_private.valid_number(accessory) AND erp_private.valid_number(other) THEN cost:=(canonical->>'cost_per_unit')::numeric+accessory+other;
  ELSE missing:=coalesce(canonical->'missing','[]'::jsonb)||jsonb_build_array('Complete os custos da composição e as despesas do cadastro.'); END IF;
 ELSIF p.manual_cost_override IS NOT NULL THEN cost:=p.manual_cost_override;
 ELSIF p.catalog_details ? 'base_cost' THEN
  accessory:=coalesce((p.catalog_details->>'accessory_cost')::numeric,0); other:=coalesce((p.catalog_details->>'other_cost')::numeric,0);
  IF erp_private.valid_number((p.catalog_details->>'base_cost')::numeric) AND erp_private.valid_number(accessory) AND erp_private.valid_number(other) THEN
   cost:=(p.catalog_details->>'base_cost')::numeric+accessory+other;
  END IF;
 ELSE cost:=p.cost_estimate;
 END IF;
 complete:=erp_private.valid_number(cost) AND cost<=1000000000;
 IF NOT complete THEN cost:=NULL; missing:=missing||jsonb_build_array('Confirme o custo completo por unidade no cadastro.'); END IF;
 revision:=md5(jsonb_build_array(p.id,p.updated_at,source,p.manual_cost_override,p.cost_estimate,p.catalog_details,canonical->'revision',cost)::text);
 RETURN jsonb_build_object('product_id',p.id,'source',source,'complete',complete,'missing',missing,'cost_per_unit',cost,'revision',revision,
  'catalog_details',p.catalog_details,'manual_cost_override',p.manual_cost_override,'legacy_cost_estimate',p.cost_estimate,'updated_at',p.updated_at,'canonical',canonical);
END $$;

CREATE FUNCTION erp_private.channel_simulation_cost(p_product uuid,p_tenant uuid,p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE preview jsonb; stock_state jsonb; catalog_stock_revision text; cost numeric; n numeric; revision text;
BEGIN
 IF jsonb_typeof(p_context) IS DISTINCT FROM 'object' OR NOT p_context ?& ARRAY['quantity','overrides']
  OR p_context-ARRAY['quantity','overrides','expected_revision']<>'{}'::jsonb OR jsonb_typeof(p_context->'quantity') IS DISTINCT FROM 'number'
  OR jsonb_typeof(p_context->'overrides') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Contexto da simulação de produção inválido.'; END IF;
 n:=(p_context->>'quantity')::numeric;
 IF NOT erp_private.valid_number(n,1) OR n>10000 OR n<>trunc(n) THEN RAISE EXCEPTION 'Confira a quantidade da simulação de produção.'; END IF;
 preview:=public.product_pricing_preview(p_product,n::integer,p_context->'overrides');
 IF p_context->>'expected_revision' IS NOT NULL AND p_context->>'expected_revision' IS DISTINCT FROM preview->>'revision' THEN
  RAISE EXCEPTION 'O custo da simulação de produção mudou. Atualize antes de simular o canal.';
 END IF;
 cost:=CASE WHEN preview->>'complete'='true' THEN (preview->'breakdown'->>'unit_cost')::numeric END;
 SELECT coalesce(jsonb_agg(jsonb_build_array(i.id,i.unit,i.current_stock,i.avg_cost,i.is_active,i.updated_at) ORDER BY i.id),'[]') INTO stock_state
 FROM inventory_items i WHERE i.tenant_id=p_tenant AND i.id::text IN
  (SELECT DISTINCT value#>>'{}' FROM jsonb_path_query(preview,'$.**.item_id') AS ids(value));
 -- Legacy unplated simulations expose no material lines in their preview.
 -- The canonical dependency snapshot includes their BOM/leaf stock identities.
 catalog_stock_revision:=erp_private.catalog_pricing_snapshot(p_product,p_tenant)->>'stock_revision';
 revision:=md5(jsonb_build_array(p_product,p_context,preview->'revision',stock_state,catalog_stock_revision,cost)::text);
 RETURN jsonb_build_object('product_id',p_product,'source','simulation','complete',preview->>'complete'='true' AND erp_private.valid_number(cost),
  'missing',coalesce(preview->'missing','[]'),'cost_per_unit',cost,'revision',revision,'preview',preview,'cost_context',p_context,'catalog_stock_revision',catalog_stock_revision);
END $$;

-- Same one-order formula as priceChannel: per-item fee times quantity, all
-- order fees once, percentages only on product revenue. Missing is not zero.
CREATE FUNCTION erp_private.channel_result(p_cost numeric,p_quantity integer,p_assumptions jsonb,p_price numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE a jsonb:=erp_private.channel_assumptions(p_assumptions); k text; commission numeric; tax numeric; margin numeric;
 fixed numeric; per_item numeric; item_fees numeric; shipping numeric; advertising numeric; other numeric; expenses numeric;
 basis numeric; rate numeric; suggested numeric; break_even numeric; target numeric; revenue numeric; selling numeric; manufacturing numeric; total numeric; profit numeric; n numeric;
BEGIN
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Unidades por pedido deve ser um inteiro entre 1 e 10000.'; END IF;
 IF NOT erp_private.valid_number(p_cost) OR p_cost>1000000000 THEN RAISE EXCEPTION 'Confirme o custo completo por unidade.'; END IF;
 FOR k IN SELECT jsonb_object_keys(a) LOOP IF a->k='null'::jsonb THEN RAISE EXCEPTION 'Confirme a condição do canal %, inclusive zero quando não se aplicar.',k; END IF; END LOOP;
 commission:=(a->>'commission_percent')::numeric; tax:=(a->>'tax_percent')::numeric; margin:=(a->>'target_margin')::numeric;
 fixed:=(a->>'fixed_fee_per_order')::numeric; per_item:=(a->>'fixed_fee_per_item')::numeric; item_fees:=per_item*p_quantity;
 shipping:=(a->>'seller_shipping_per_order')::numeric; advertising:=(a->>'advertising_per_order')::numeric; other:=(a->>'other_cost_per_order')::numeric;
 expenses:=fixed+item_fees+shipping+advertising+other; rate:=(commission+tax)/100; basis:=p_cost+expenses/p_quantity;
 suggested:=CASE WHEN basis=0 THEN 0 ELSE greatest(0.01,ceil(basis/(1-rate-margin/100)*100-0.000000001)/100) END;
 break_even:=CASE WHEN basis=0 THEN 0 ELSE greatest(0.01,ceil(basis/(1-rate)*100-0.000000001)/100) END;
 IF p_price IS NOT NULL AND (NOT erp_private.valid_number(p_price,0.01) OR p_price>1000000000 OR p_price<>round(p_price,2)) THEN RAISE EXCEPTION 'Informe um preço alvo entre R$0,01 e o limite, com até duas casas decimais.'; END IF;
 target:=coalesce(p_price,suggested); revenue:=target*p_quantity; manufacturing:=p_cost*p_quantity;
 selling:=revenue*rate+expenses; total:=manufacturing+selling; profit:=revenue-total;
 FOREACH n IN ARRAY ARRAY[p_cost,expenses,suggested,break_even,target,revenue,total,selling,manufacturing,profit,revenue-selling] LOOP
  IF n IS NULL OR n::text IN('NaN','Infinity','-Infinity') OR abs(n)>1000000000 THEN RAISE EXCEPTION 'Os valores da simulação comercial são muito altos.'; END IF;
 END LOOP;
 RETURN jsonb_build_object('quantity',p_quantity,'unitCost',p_cost,'variableUnitCost',p_cost,'suggested',suggested,'breakEven',break_even,'target',target,'revenue',revenue,
  'commission',revenue*commission/100,'tax',revenue*tax/100,'fixedFee',fixed,'fixedFeePerItem',per_item,'itemFees',item_fees,'orderExpenses',expenses,
  'sellerShipping',shipping,'advertising',advertising,'otherCost',other,'sellingExpenses',selling,'manufacturingCost',manufacturing,'variableManufacturingCost',manufacturing,
  'totalCost',total,'afterSellingExpenses',revenue-selling,'includedResult',profit,'contribution',profit,
  'includedMargin',CASE WHEN revenue>0 THEN profit/revenue*100 END,'contributionMargin',CASE WHEN revenue>0 THEN profit/revenue*100 END,
  'markup',CASE WHEN total>0 THEN profit/total*100 END);
END $$;
CREATE FUNCTION erp_private.channel_preview(p_product uuid,p_tenant uuid,p_channel text,p_quantity integer,p_overrides jsonb,p_price numeric,p_cost_context jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE policy jsonb; assumptions jsonb; cost jsonb; result jsonb; missing jsonb; k text; revision text;
BEGIN
 PERFORM erp_private.check_channel(p_channel);
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Unidades por pedido deve ser um inteiro entre 1 e 10000.'; END IF;
 -- Validate sparse overrides without manufacturing defaults for absent keys.
 PERFORM erp_private.channel_assumptions(p_overrides);
 policy:=erp_private.read_channel_policy(p_tenant,p_channel);
 assumptions:=erp_private.channel_assumptions((policy->'assumptions')||p_overrides);
 cost:=CASE WHEN p_cost_context IS NULL THEN erp_private.channel_catalog_cost(p_product,p_tenant) ELSE erp_private.channel_simulation_cost(p_product,p_tenant,p_cost_context) END; missing:=cost->'missing';
 FOR k IN SELECT jsonb_object_keys(assumptions) LOOP IF assumptions->k='null'::jsonb THEN missing:=missing||jsonb_build_array('Confirme a condição do canal: '||k||', inclusive zero quando não se aplicar.'); END IF; END LOOP;
 IF jsonb_array_length(missing)=0 THEN result:=erp_private.channel_result((cost->>'cost_per_unit')::numeric,p_quantity,assumptions,p_price); END IF;
 revision:=md5(jsonb_build_array(p_product,p_channel,p_quantity,cost->'revision',policy->'revision',assumptions,p_price,result)::text);
 RETURN jsonb_build_object('product_id',p_product,'channel',p_channel,'quantity',p_quantity,'complete',result IS NOT NULL,'missing',missing,
  'assumptions',assumptions,'policy',policy,'cost_source',cost->'source','unit_cost',cost->'cost_per_unit','cost_revision',cost->'revision',
  'policy_revision',policy->'revision','revision',revision,'result',result,'cost_snapshot',cost);
END $$;
CREATE FUNCTION public.product_channel_pricing_preview(p_product_id uuid,p_channel text,p_quantity integer,p_overrides jsonb DEFAULT '{}',p_unit_price numeric DEFAULT NULL,p_cost_context jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Entre na sua empresa para consultar a precificação.' USING ERRCODE='42501'; END IF;
 RETURN erp_private.channel_preview(p_product_id,t,p_channel,p_quantity,p_overrides,p_unit_price,p_cost_context);
END $$;
CREATE FUNCTION public.product_channel_price_catalog(p_product_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); result jsonb;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Entre na sua empresa para consultar preços por canal.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM products WHERE id=p_product_id AND tenant_id=t) THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channel',price.channel,'acceptance_id',price.acceptance_id,'unit_price',price.unit_price,
  'unit_cost',accepted.unit_cost,'quantity',accepted.quantity,'assumptions',accepted.snapshot->'assumptions','cost_revision',accepted.cost_revision,
  'policy_revision',accepted.policy_revision,'updated_at',price.updated_at) ORDER BY price.channel),'[]'::jsonb) INTO result
 FROM product_channel_prices price JOIN product_channel_pricing_acceptances accepted ON accepted.id=price.acceptance_id AND accepted.tenant_id=t
 WHERE price.product_id=p_product_id AND price.tenant_id=t;
 RETURN result;
END $$;
CREATE FUNCTION erp_private.accept_channel_preview(p_product uuid,p_tenant uuid,p_preview jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result uuid; cost numeric; price numeric; selected_channel text:=p_preview->>'channel';
BEGIN
 IF p_preview->>'complete' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Complete o custo e as condições do canal antes de salvar o preço.'; END IF;
 cost:=(p_preview->>'unit_cost')::numeric; price:=(p_preview->'result'->>'target')::numeric;
 IF NOT erp_private.valid_number(price,0.01) THEN RAISE EXCEPTION 'Informe um preço de venda de pelo menos R$0,01 para o canal.'; END IF;
 INSERT INTO product_channel_pricing_acceptances(tenant_id,product_id,channel,quantity,unit_cost,unit_price,cost_revision,policy_revision,preview_revision,snapshot,created_by)
 VALUES(p_tenant,p_product,selected_channel,(p_preview->>'quantity')::integer,cost,price,p_preview->>'cost_revision',p_preview->>'policy_revision',p_preview->>'revision',p_preview,auth.uid()) RETURNING id INTO result;
 INSERT INTO product_channel_prices(tenant_id,product_id,channel,acceptance_id,unit_price) VALUES(p_tenant,p_product,selected_channel,result,price)
 ON CONFLICT(tenant_id,product_id,channel) DO UPDATE SET acceptance_id=excluded.acceptance_id,unit_price=excluded.unit_price,updated_at=clock_timestamp();
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(p_tenant,auth.uid(),'apply_product_channel_pricing','products',p_product,
  jsonb_build_object('acceptance_id',result,'channel',selected_channel,'quantity',p_preview->'quantity','unit_cost',cost,'unit_price',price,'cost_revision',p_preview->'cost_revision','policy_revision',p_preview->'policy_revision'));
 RETURN result;
END $$;
CREATE FUNCTION public.apply_product_channel_pricing(p_product_id uuid,p_channel text,p_quantity integer,p_overrides jsonb,
 p_expected_cost_revision text,p_expected_policy_revision text,p_expected_revision text,p_request_id uuid,p_unit_price numeric DEFAULT NULL,p_cost_context jsonb DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; preview jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'apply_product_channel_pricing',jsonb_build_array(p_product_id,p_channel,p_quantity,p_overrides,p_expected_cost_revision,p_expected_policy_revision,p_expected_revision,p_unit_price,p_cost_context)); IF result IS NOT NULL THEN RETURN result; END IF;
 PERFORM erp_private.check_channel(p_channel);
 PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('channel-pricing-'||t::text||':'||p_channel,0));
 PERFORM 1 FROM products WHERE id=p_product_id AND tenant_id=t AND is_active FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado ou arquivado.'; END IF;
 preview:=erp_private.channel_preview(p_product_id,t,p_channel,p_quantity,p_overrides,p_unit_price,p_cost_context);
 IF preview->>'cost_revision' IS DISTINCT FROM p_expected_cost_revision OR preview->>'policy_revision' IS DISTINCT FROM p_expected_policy_revision
  OR preview->>'revision' IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'O custo, as condições ou a quantidade mudaram. Atualize a simulação do canal.'; END IF;
 result:=erp_private.accept_channel_preview(p_product_id,t,preview);
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

-- Preserve the ORIGINAL full payload through all earlier wrappers so their
-- request fingerprints agree. Any channel failure rolls the entire save back.
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.save_product_with_photos(uuid,jsonb,jsonb,uuid)')) IS DISTINCT FROM '4995095582579f697392881612a595ee' THEN
  RAISE EXCEPTION 'Review the canonical catalog save function before applying channel pricing.';
 END IF;
END $$;
ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_channel_pricing;
REVOKE ALL ON FUNCTION erp_private.save_product_before_channel_pricing(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; entries jsonb:=p_product->'channel_pricing'; entry jsonb; seen text[]:='{}'; channel text; preview jsonb; quote numeric;
BEGIN
 IF entries IS NOT NULL THEN
  IF jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries)>5 THEN RAISE EXCEPTION 'Confira os preços por canal do cadastro.'; END IF;
  IF jsonb_array_length(entries)>0 THEN PERFORM erp_private.actor(true); END IF;
 END IF;
 result:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos)); IF result IS NOT NULL THEN RETURN result; END IF;
 -- Same lock order as separate apply and pricing-policy updates.
 IF coalesce(jsonb_array_length(entries),0)>0 THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('pricing-'||t::text,0));
  FOR channel IN SELECT value->>'channel' FROM jsonb_array_elements(entries) ORDER BY value->>'channel' LOOP
   PERFORM erp_private.check_channel(channel); PERFORM pg_advisory_xact_lock(hashtextextended('channel-pricing-'||t::text||':'||channel,0));
  END LOOP;
 END IF;
 result:=erp_private.save_product_before_channel_pricing(p_product_id,p_product,p_photos,p_request_id);
 FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(entries,'[]'::jsonb)) LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ?& ARRAY['channel','quantity','assumptions','expected_policy_revision','quoted_unit_cost','unit_price']
   OR entry-ARRAY['channel','quantity','assumptions','expected_policy_revision','quoted_unit_cost','unit_price']<>'{}'::jsonb THEN RAISE EXCEPTION 'Preço por canal inválido no cadastro.'; END IF;
  channel:=entry->>'channel'; IF channel=ANY(seen) THEN RAISE EXCEPTION 'Informe cada canal uma única vez.'; END IF; seen:=array_append(seen,channel);
  IF jsonb_typeof(entry->'quantity') IS DISTINCT FROM 'number' OR (entry->>'quantity')::numeric<>trunc((entry->>'quantity')::numeric)
   OR jsonb_typeof(entry->'quoted_unit_cost') IS DISTINCT FROM 'number' OR jsonb_typeof(entry->'unit_price') NOT IN('number','null')
   OR jsonb_typeof(entry->'expected_policy_revision') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Confira quantidade e custo conferido do canal.'; END IF;
  quote:=(entry->>'quoted_unit_cost')::numeric;
  preview:=erp_private.channel_preview(result,t,channel,(entry->>'quantity')::integer,entry->'assumptions',(entry->>'unit_price')::numeric);
  IF preview->>'policy_revision' IS DISTINCT FROM entry->>'expected_policy_revision' THEN RAISE EXCEPTION 'As condições do canal mudaram. Atualize antes de salvar o produto.'; END IF;
  IF NOT erp_private.valid_number(quote) OR round((preview->>'unit_cost')::numeric,4) IS DISTINCT FROM quote THEN RAISE EXCEPTION 'O custo final do produto mudou. Confira novamente o preço por canal.'; END IF;
  PERFORM erp_private.accept_channel_preview(result,t,preview);
 END LOOP;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.channel_pricing_policy(text),public.save_channel_pricing_policy(text,jsonb,text,uuid),public.product_channel_pricing_preview(uuid,text,integer,jsonb,numeric,jsonb),public.apply_product_channel_pricing(uuid,text,integer,jsonb,text,text,text,uuid,numeric,jsonb),public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.channel_pricing_policy(text),public.save_channel_pricing_policy(text,jsonb,text,uuid),public.product_channel_pricing_preview(uuid,text,integer,jsonb,numeric,jsonb),public.apply_product_channel_pricing(uuid,text,integer,jsonb,text,text,text,uuid,numeric,jsonb),public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.product_channel_price_catalog(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.product_channel_price_catalog(uuid) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
