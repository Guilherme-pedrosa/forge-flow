-- Expose the actual factory cost and company policy before a marketplace price
-- has been accepted. Missing marketplace tariffs must not hide factory evidence.
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.integrador_publication_snapshot(uuid,uuid)')) IS DISTINCT FROM '4e216bf18125d5e6f698b8eaba18cca1' THEN
  RAISE EXCEPTION 'Review the publication snapshot before adding official quotation context.';
 END IF;
END $$;
ALTER FUNCTION public.integrador_publication_snapshot(uuid,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.integrador_publication_snapshot(uuid,uuid) RENAME TO publication_before_quote_context;
REVOKE ALL ON FUNCTION erp_private.publication_before_quote_context(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.integrador_publication_snapshot(p_account_id uuid,p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); snapshot jsonb; current_preview jsonb; accepted product_channel_pricing_acceptances;
 manufacturing jsonb; policy jsonb; cost_context jsonb;
BEGIN
 snapshot:=erp_private.publication_before_quote_context(p_account_id,p_product_id);
 SELECT a.* INTO accepted FROM product_channel_pricing_acceptances a
 JOIN product_channel_prices p ON p.acceptance_id=a.id AND p.tenant_id=t AND p.product_id=p_product_id AND p.channel='mercado_livre'
 WHERE a.tenant_id=t AND a.product_id=p_product_id AND a.channel='mercado_livre' AND a.quantity=1;
 snapshot:=jsonb_set(snapshot,'{price}',(snapshot->'price')||jsonb_build_object('official_quote',accepted.snapshot->'official_quote','listing_type_id',accepted.snapshot->>'listing_type_id'));
 IF accepted.snapshot->>'cost_source'='simulation' THEN cost_context:=accepted.snapshot->'cost_snapshot'->'cost_context'; END IF;
 BEGIN
  current_preview:=erp_private.channel_preview(p_product_id,t,'mercado_livre',1,'{}',NULL,cost_context);
 EXCEPTION WHEN OTHERS THEN
  -- An obsolete simulation cannot silently become a different manufacturing cost.
  current_preview:=jsonb_build_object('cost_revision','unavailable','cost_snapshot',jsonb_build_object('complete',false,'missing',jsonb_build_array('Confira o custo atual da produção.')),
   'policy',erp_private.read_channel_policy(t,'mercado_livre'));
 END;
 manufacturing:=jsonb_build_object('unit_cost',current_preview->'unit_cost','complete',coalesce(current_preview->'cost_snapshot'->>'complete'='true',false),
  'cost_revision',current_preview->>'cost_revision','missing',coalesce(current_preview->'cost_snapshot'->'missing','[]'));
 policy:=jsonb_build_object('revision',current_preview->'policy'->>'revision',
  'tax_provision_percent',current_preview->'policy'->'assumptions'->'tax_percent',
  'minimum_margin_percent',current_preview->'policy'->'assumptions'->'target_margin',
  'other_assumptions',current_preview->'policy'->'assumptions');
 RETURN snapshot||jsonb_build_object('manufacturing',manufacturing,'pricing_policy',policy,
  'revision',encode(sha256(convert_to(jsonb_build_array(snapshot->>'revision',manufacturing,policy)::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.integrador_publication_snapshot(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.integrador_publication_snapshot(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
