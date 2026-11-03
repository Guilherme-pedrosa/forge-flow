-- Catalog selection is read-only. Zero stock remains zero; this creates no
-- publication, automation policy, provider request, order or financial entry.
CREATE FUNCTION public.marketplace_publication_catalog(
 p_account_id uuid,p_q text DEFAULT '',p_publication text DEFAULT 'all',p_stock text DEFAULT 'all',p_offset integer DEFAULT 0,p_limit integer DEFAULT 20,p_sort text DEFAULT 'name') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true);link integrador_marketplace_account_links;b integrador_bridge_bindings;
 ids uuid[];i integer;snapshot jsonb;item jsonb;product products;listed jsonb;records jsonb:='[]';page jsonb:='[]';price jsonb;
 available integer;uncovered integer;complete boolean;issues jsonb;total integer;q text:=btrim(coalesce(p_q,''));
BEGIN
 IF length(q)>120 OR p_publication IS NULL OR p_publication NOT IN('all','unlisted','listed') OR p_stock IS NULL OR p_stock NOT IN('all','available','empty','unknown')
  OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_sort IS NULL OR p_sort NOT IN('name','stock_asc','stock_desc','price_asc','price_desc') THEN RAISE EXCEPTION 'Confira a busca, os filtros e a página do catálogo.';END IF;
 SELECT * INTO link FROM integrador_marketplace_account_links WHERE account_id=p_account_id AND tenant_id=t;
 SELECT * INTO b FROM integrador_bridge_bindings WHERE id=link.bridge_id AND tenant_id=t AND enabled;
 IF b.id IS NULL OR NOT(link.source_seller_id=ANY(b.approved_seller_ids)) OR NOT EXISTS(SELECT 1 FROM marketplace_accounts WHERE id=p_account_id AND tenant_id=t AND channel='mercado_livre' AND external_seller_id=link.source_seller_id) THEN RAISE EXCEPTION 'Conecte explicitamente a conta Mercado Livre desta empresa antes de escolher os produtos.' USING ERRCODE='42501';END IF;
 SELECT array_agg(p.id ORDER BY lower(p.name),p.id) INTO ids FROM products p
 WHERE p.tenant_id=t AND p.is_active AND NOT p.is_component
  AND (q='' OR strpos(lower(p.name||' '||coalesce(p.sku,'')),lower(q))>0)
  AND (p_publication='all' OR EXISTS(SELECT 1 FROM marketplace_sku_bindings sb WHERE sb.tenant_id=t AND sb.account_id=p_account_id AND sb.product_id=p.id AND sb.external_item_id ~ '^MLB[0-9]{1,24}$')=(p_publication='listed'));
 IF cardinality(ids) IS NULL THEN RETURN jsonb_build_object('items','[]'::jsonb,'total',0,'next_offset',NULL);END IF;
 -- The canonical helper supports batches of 500; all filters/sorts below see
 -- the entire matching company catalog, not only the first page.
 FOR i IN 0..((cardinality(ids)-1)/500) LOOP
  snapshot:=erp_private.publication_stock_snapshot(p_account_id,ids[(i*500+1):(i*500+500)]);
  FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'products') LOOP
   SELECT * INTO product FROM products WHERE id=(item->>'productId')::uuid AND tenant_id=t;
   complete:=coalesce((snapshot->>'localInboxComplete')::boolean,false) AND coalesce((item->>'stockComplete')::boolean,false);
   SELECT coalesce(sum(greatest(0,(line->>'quantity')::integer-(line->>'quantityAlreadyAccounted')::integer)),0)::integer INTO uncovered
    FROM jsonb_array_elements(snapshot->'externalPaidOrders') line WHERE line->>'productId'=product.id::text;
   available:=CASE WHEN complete THEN greatest(0,(item->>'available')::integer-uncovered) END;
   issues:='[]';IF NOT complete THEN issues:=issues||jsonb_build_array('Confira o estoque pronto e os pedidos pagos ainda sem cobertura no Forge.');ELSIF available=0 THEN issues:=issues||jsonb_build_array('Sem estoque disponível para publicar.');END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('item_id',external_item_id,'status',NULL,'permalink',NULL) ORDER BY external_item_id),'[]') INTO listed FROM
    (SELECT DISTINCT external_item_id FROM marketplace_sku_bindings WHERE tenant_id=t AND account_id=p_account_id AND product_id=product.id AND external_item_id ~ '^MLB[0-9]{1,24}$') offers;
   records:=records||jsonb_build_array(jsonb_build_object('id',product.id,'name',product.name,'sku',product.sku,'category',product.category,
    'photo_url',coalesce((SELECT ph.url FROM product_photos ph WHERE ph.tenant_id=t AND ph.product_id=product.id AND ph.url ~ '^https://[^/@]+(/|$)' ORDER BY ph.sort_order,ph.id LIMIT 1),CASE WHEN product.photo_url ~ '^https://[^/@]+(/|$)' THEN product.photo_url END),
    'base_price',product.sale_price,'ml_price',NULL,'available',available,'stock_complete',complete,'listings',listed,'issues',issues));
  END LOOP;
 END LOOP;
 SELECT count(*) INTO total FROM jsonb_array_elements(records) row WHERE p_stock='all' OR p_stock='available' AND (row->>'available')::integer>0 OR p_stock='empty' AND row->>'stock_complete'='true' AND (row->>'available')::integer=0 OR p_stock='unknown' AND row->>'stock_complete'='false';
 FOR item IN SELECT value FROM jsonb_array_elements(records) WHERE p_stock='all' OR p_stock='available' AND (value->>'available')::integer>0 OR p_stock='empty' AND value->>'stock_complete'='true' AND (value->>'available')::integer=0 OR p_stock='unknown' AND value->>'stock_complete'='false'
  ORDER BY CASE WHEN p_sort='stock_asc' THEN (value->>'available')::numeric END ASC NULLS LAST,CASE WHEN p_sort='stock_desc' THEN (value->>'available')::numeric END DESC NULLS LAST,
   CASE WHEN p_sort='price_asc' THEN (value->>'base_price')::numeric END ASC NULLS LAST,CASE WHEN p_sort='price_desc' THEN (value->>'base_price')::numeric END DESC NULLS LAST,lower(value->>'name'),value->>'id'
  OFFSET p_offset LIMIT p_limit LOOP
  price:=erp_private.marketplace_current_channel_price((item->>'id')::uuid,t);
  item:=item||jsonb_build_object('ml_price',CASE WHEN price->>'complete'='true' THEN (price->>'unitPrice')::numeric END);
  IF price IS NULL THEN item:=jsonb_set(item,'{issues}',item->'issues'||jsonb_build_array('Confira e aceite o preço de Mercado Livre para uma unidade do produto.'));
  ELSIF price->>'complete' IS DISTINCT FROM 'true' THEN item:=jsonb_set(item,'{issues}',item->'issues'||jsonb_build_array('O custo ou as condições do canal mudaram. Confira e aceite novamente o preço de Mercado Livre.'));END IF;
  page:=page||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_build_object('items',page,'total',total,'next_offset',CASE WHEN p_offset+jsonb_array_length(page)<total AND jsonb_array_length(page)>0 THEN p_offset+jsonb_array_length(page) END);
END $$;
REVOKE ALL ON FUNCTION public.marketplace_publication_catalog(uuid,text,text,text,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.marketplace_publication_catalog(uuid,text,text,text,integer,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
