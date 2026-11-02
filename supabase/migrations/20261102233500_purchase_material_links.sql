-- Restrict newly selected purchase materials, without rewriting legacy links
-- or changing receipts, production movements, monetary values or stock costs.
DO $$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.create_purchase_order(jsonb,jsonb,jsonb,uuid)')) IS DISTINCT FROM 'e43955469451409d7f8018f19c2e7253'
  OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.erp_guard_purchase_item()')) IS DISTINCT FROM 'c26e17f5dbd21d52ae906e498e838662' THEN
  RAISE EXCEPTION 'Review the purchase writers before restricting newly selected materials.';
 END IF;
 IF to_regprocedure('erp_private.guard_purchase_material_link()') IS NOT NULL AND
  (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('erp_private.guard_purchase_material_link()')) IS DISTINCT FROM '08b7b872816c5f292acb621360c2a4e2' THEN
  RAISE EXCEPTION 'Review the purchase material link guard before replacing it.';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION erp_private.guard_purchase_material_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item inventory_items;
BEGIN
 -- Existing pending/posted links are historical. Only an actual new selection
 -- is checked here; receipt and quantity-only corrections do not reselect it.
 IF TG_OP='UPDATE' AND NEW.inventory_item_id IS NOT DISTINCT FROM OLD.inventory_item_id THEN RETURN NEW; END IF;
 IF NEW.inventory_item_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO item FROM inventory_items WHERE id=NEW.inventory_item_id AND tenant_id=NEW.tenant_id;
 IF item.id IS NULL OR NOT item.is_active THEN RAISE EXCEPTION 'Selecione um insumo ativo desta empresa para a compra.'; END IF;
 IF lower(btrim(coalesce(item.category,''))) IN('product','finished_product')
  OR EXISTS(SELECT 1 FROM products WHERE stock_item_id=item.id) THEN
  RAISE EXCEPTION 'Vincule somente insumos à compra. O estoque de produto acabado não pode ser selecionado.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.guard_purchase_material_link() FROM PUBLIC,anon,authenticated;
DO $$
DECLARE existing pg_trigger; item_column smallint;
BEGIN
 SELECT attnum INTO item_column FROM pg_attribute WHERE attrelid='public.purchase_order_items'::regclass AND attname='inventory_item_id' AND NOT attisdropped;
 SELECT * INTO existing FROM pg_trigger WHERE tgrelid='public.purchase_order_items'::regclass AND tgname='erp_purchase_material_link_guard';
 IF FOUND THEN
  IF existing.tgfoid=to_regprocedure('erp_private.guard_purchase_material_link()') AND existing.tgtype=23 AND existing.tgattr::text=item_column::text
   AND existing.tgqual IS NULL AND existing.tgenabled='O' AND octet_length(existing.tgargs)=0 AND NOT existing.tgisinternal THEN RETURN; END IF;
  RAISE EXCEPTION 'Review the purchase material link trigger before replacing it.';
 END IF;
 CREATE TRIGGER erp_purchase_material_link_guard BEFORE INSERT OR UPDATE OF inventory_item_id ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION erp_private.guard_purchase_material_link();
END $$;
NOTIFY pgrst,'reload schema';
