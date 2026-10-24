-- Keep stable integration identifiers while using the owner's store brand.
DO $$
DECLARE fn text;
BEGIN
 FOR fn IN SELECT unnest(ARRAY['public.configure_storefront(text,boolean)','public.submit_storefront_request(text,uuid,jsonb)','public.begin_storefront_checkout(text,uuid,jsonb)']) LOOP
  EXECUTE replace(pg_get_functiondef(fn::regprocedure),'Loracê','Elevare3D');
 END LOOP;
END $$;
UPDATE public.storefront_channels SET name='Elevare3D' WHERE slug='lorace';
