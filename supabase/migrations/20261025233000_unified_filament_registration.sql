-- One transaction creates a material/color, its physical spool and the optional
-- stock entry. Existing physical-only spool operations keep their old contract.
CREATE TABLE erp_private.filament_registration_receipts (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 request_id uuid NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY (tenant_id,request_id),
 FOREIGN KEY (tenant_id,request_id) REFERENCES erp_private.requests(tenant_id,request_id)
);
REVOKE ALL ON erp_private.filament_registration_receipts FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.register_filament_spool(
 p_item_id uuid,p_material jsonb,p_spool jsonb,p_stock_mode text,
 p_cost_per_kg numeric,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 t uuid:=erp_private.actor(); prior uuid; result jsonb; item inventory_items;
 material jsonb:=coalesce(p_material,'{}'::jsonb); spool jsonb:=p_spool;
 machine uuid; parent uuid; material_label text; item_name text; color_name text; stable_color text;
 initial_weight numeric; tare numeric; gross numeric; net numeric; delta numeric;
 stock_before numeric; stock_after numeric; new_item boolean:=p_item_id IS NULL;
 spool_id uuid; movement_id uuid; reason text; spool_label text; ordinal integer;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'filament_registration',
   jsonb_build_array(p_item_id,p_material,p_spool,p_stock_mode,p_cost_per_kg));
 IF prior IS NOT NULL THEN
  SELECT r.result INTO result FROM erp_private.filament_registration_receipts r
   WHERE r.tenant_id=t AND r.request_id=p_request_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Não foi possível recuperar o comprovante do cadastro. Atualize para conferir.'; END IF;
  RETURN result;
 END IF;
 IF jsonb_typeof(material) IS DISTINCT FROM 'object' OR spool IS NULL OR jsonb_typeof(spool) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Informe os dados do filamento e da bobina.';
 END IF;
 IF p_stock_mode IS NULL OR p_stock_mode NOT IN('already_in_stock','add_to_stock') THEN
  RAISE EXCEPTION 'Escolha se esta bobina já está no estoque ou se deve gerar uma entrada.';
 END IF;
 IF new_item AND p_stock_mode<>'add_to_stock' THEN
  RAISE EXCEPTION 'O cadastro de um novo filamento deve informar a entrada da primeira bobina.';
 END IF;
 IF p_stock_mode='add_to_stock' AND NOT erp_private.valid_number(p_cost_per_kg) THEN
  RAISE EXCEPTION 'Informe explicitamente o custo por kg da entrada, inclusive zero quando não houver custo.';
 END IF;
 IF p_cost_per_kg IS NOT NULL AND NOT erp_private.valid_number(p_cost_per_kg) THEN
  RAISE EXCEPTION 'Custo por kg inválido.';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(material) k WHERE k NOT IN(
  'name','material_code','material_description','color','color_code','color_hex','brand','diameter','sku','notes',
  'parent_id','vendor_id','min_stock','max_stock','loss_coefficient')) THEN RAISE EXCEPTION 'Campo do filamento não permitido.'; END IF;
 IF NOT new_item AND material<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Para usar um filamento existente, selecione o cadastro sem alterar sua identificação.';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(spool) k WHERE k NOT IN(
  'label','tare_grams','initial_net_grams','estimated_remaining_grams','measured_gross_grams','weight_source',
  'location_kind','location_label','printer_id','ams_unit','ams_slot','is_active','reason')) THEN
  RAISE EXCEPTION 'Campo da bobina não permitido.';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(material) e WHERE e.key IN(
  'name','material_code','material_description','color','color_code','color_hex','brand','sku','notes','parent_id','vendor_id')
  AND jsonb_typeof(e.value) NOT IN('string','null')) THEN RAISE EXCEPTION 'Confira os textos e a identificação do filamento.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(spool) e WHERE e.key IN(
  'label','weight_source','location_kind','location_label','printer_id','reason')
  AND jsonb_typeof(e.value) NOT IN('string','null')) THEN RAISE EXCEPTION 'Confira a identificação e a posição da bobina.'; END IF;
 initial_weight:=(spool->>'initial_net_grams')::numeric;
 tare:=(spool->>'tare_grams')::numeric;
 IF NOT erp_private.valid_number(initial_weight,0.001) OR NOT erp_private.valid_number(tare)
  OR initial_weight<>round(initial_weight,3) OR tare<>round(tare,3) THEN
  RAISE EXCEPTION 'Informe capacidade e tara em gramas, com até três casas decimais.';
 END IF;
 IF spool->>'weight_source'='manual_weighing' THEN
  gross:=(spool->>'measured_gross_grams')::numeric;
  IF NOT erp_private.valid_number(gross,tare) OR gross<>round(gross,3) THEN
   RAISE EXCEPTION 'O peso bruto deve ser maior ou igual à tara, com até três casas decimais.';
  END IF;
  net:=gross-tare;
 ELSIF spool->>'weight_source'='manual_estimate' THEN
  net:=(spool->>'estimated_remaining_grams')::numeric;
 ELSE RAISE EXCEPTION 'Selecione pesagem ou estimativa manual.';
 END IF;
 IF NOT erp_private.valid_number(net) OR net>initial_weight OR net<>round(net,3) THEN
  RAISE EXCEPTION 'O filamento restante deve ficar entre zero e a capacidade líquida da bobina.';
 END IF;
 reason:=coalesce(nullif(btrim(spool->>'reason'),''),
   CASE WHEN p_stock_mode='add_to_stock' THEN 'Cadastro de bobina com entrada de filamento' ELSE 'Identificação de bobina já contabilizada no estoque' END);
 spool:=spool-'reason';
 machine:=nullif(btrim(spool->>'printer_id'),'')::uuid;
 PERFORM erp_private.assert_ref('printers',machine,t);
 -- Keep the same lock order as production, weighing and relocation. Never
 -- create/update an item first and then acquire its printer lock.
 PERFORM 1 FROM printers WHERE tenant_id=t AND id=machine ORDER BY id FOR UPDATE;
 IF machine IS NOT NULL AND NOT EXISTS(SELECT 1 FROM printers WHERE id=machine AND tenant_id=t AND is_active) THEN
  RAISE EXCEPTION 'Selecione uma impressora ativa.';
 END IF;
 -- Different material rows may have the same readable name. Their individual
 -- inventory locks cannot serialize the tenant-wide unique generated label.
 -- Take this tenant lock after the printer and before any material mutation;
 -- manual labels continue to use the existing unique-index validation.
 IF nullif(btrim(spool->>'label'),'') IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('filament-auto-label-'||t::text,0));
 END IF;
 IF new_item THEN
  parent:=nullif(btrim(material->>'parent_id'),'')::uuid;
  PERFORM erp_private.assert_ref('inventory_items',parent,t);
  IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items WHERE id=parent AND tenant_id=t AND is_active AND category='filament' AND lower(btrim(unit))='g') THEN
   RAISE EXCEPTION 'O grupo de origem deve ser um filamento ativo com estoque em gramas.';
  END IF;
  IF nullif(btrim(material->>'material_code'),'') IS NOT NULL THEN
   SELECT c.label INTO material_label FROM material_code_catalog c WHERE c.code=upper(btrim(material->>'material_code'));
   IF material_label IS NULL THEN RAISE EXCEPTION 'Selecione um material do catálogo.'; END IF;
   IF upper(btrim(material->>'material_code'))='OTHER' THEN material_label:=nullif(btrim(material->>'material_description'),''); END IF;
  END IF;
  color_name:=nullif(btrim(material->>'color'),'');
  stable_color:=nullif(upper(btrim(material->>'color_code')),'');
  IF stable_color IS NULL AND color_name IS NOT NULL THEN
   stable_color:=coalesce(nullif(upper(btrim(material->>'color_hex')),''),nullif(btrim(regexp_replace(
    translate(upper(color_name),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','AAAAAEEEEIIIIOOOOOUUUUCN'),'[^A-Z0-9#_. /+\-]','','g')),''));
  END IF;
  item_name:=coalesce(nullif(btrim(material->>'name'),''),nullif(btrim(concat_ws(' ',material_label,color_name,nullif(btrim(material->>'brand'),''))),''));
  IF item_name IS NULL OR length(item_name)>200 THEN RAISE EXCEPTION 'Informe o material ou um nome para o filamento, com até 200 caracteres.'; END IF;
  IF material ? 'diameter' AND material->'diameter'<>'null'::jsonb AND NOT erp_private.valid_number((material->>'diameter')::numeric,0.001) THEN
   RAISE EXCEPTION 'Informe um diâmetro válido.';
  END IF;
  p_item_id:=public.save_inventory_catalog(NULL,material||jsonb_build_object('name',item_name,'category','filament','unit','g',
   'color_code',stable_color,'avg_cost',p_cost_per_kg/1000,'current_stock',0),gen_random_uuid());
 END IF;
 SELECT * INTO item FROM inventory_items WHERE id=p_item_id AND tenant_id=t FOR UPDATE;
 IF item.id IS NULL OR NOT item.is_active OR item.category<>'filament' OR lower(btrim(item.unit)) NOT IN('g','kg') THEN
  RAISE EXCEPTION 'Selecione um filamento ativo com estoque em g ou kg.';
 END IF;
 stock_before:=item.current_stock;
 spool_label:=nullif(btrim(spool->>'label'),'');
 IF spool_label IS NULL THEN
  SELECT count(*)::integer+1 INTO ordinal FROM filament_spools WHERE tenant_id=t AND item_id=item.id;
  spool_label:=left(item.name,160)||' · bobina '||ordinal;
  WHILE EXISTS(SELECT 1 FROM filament_spools WHERE tenant_id=t AND is_active AND lower(spool_label)=lower(filament_spools.label)) LOOP
   ordinal:=ordinal+1;spool_label:=left(item.name,160)||' · bobina '||ordinal;
  END LOOP;
 END IF;
 IF length(spool_label)>200 THEN RAISE EXCEPTION 'Use uma identificação de bobina com até 200 caracteres.'; END IF;
 spool_id:=public.save_filament_spool(NULL,spool||jsonb_build_object('item_id',item.id,'label',spool_label),reason,gen_random_uuid());
 IF p_stock_mode='add_to_stock' AND net>0 THEN
  delta:=net/CASE WHEN lower(btrim(item.unit))='kg' THEN 1000 ELSE 1 END;
  -- A positive acquisition is the only new ledger movement. Physical spool
  -- registration remains free of aggregate movements and future consumption.
  INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
   VALUES(t,item.id,'purchase_in',delta,p_cost_per_kg/CASE WHEN lower(btrim(item.unit))='g' THEN 1000 ELSE 1 END,
    'filament_registration',spool_id,reason,auth.uid()) RETURNING id INTO movement_id;
 END IF;
 SELECT current_stock INTO stock_after FROM inventory_items WHERE id=item.id AND tenant_id=t;
 result:=jsonb_build_object('spool_id',spool_id,'item_id',item.id,'item_created',new_item,'net_grams',net,
  'stock_mode',p_stock_mode,'stock_before',stock_before,'stock_after',stock_after,'stock_unit',item.unit);
 INSERT INTO erp_private.filament_registration_receipts VALUES(t,p_request_id,result);
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
  VALUES(t,auth.uid(),'register_filament_spool','filament_spools',spool_id,result||jsonb_build_object('request_id',p_request_id,'movement_id',movement_id));
 PERFORM erp_private.finish_request(t,p_request_id,spool_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.register_filament_spool(uuid,jsonb,jsonb,text,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_filament_spool(uuid,jsonb,jsonb,text,numeric,uuid) TO authenticated;
