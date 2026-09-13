-- Public MakerWorld references are imported without Bambu account credentials.
-- They remain design metadata until a human configures exact production recipes.
ALTER TABLE public.products ADD COLUMN external_import jsonb;

CREATE FUNCTION erp_private.makerworld_design_id(p_url text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parts text[]; design text;
BEGIN
  IF p_url IS NULL OR length(p_url)>2048 OR p_url ~ '[[:space:][:cntrl:]]' THEN RAISE EXCEPTION 'Informe um link HTTPS de modelo do MakerWorld.'; END IF;
  parts:=regexp_match(p_url,'^https://(?:www\.)?makerworld\.com/(?:[a-zA-Z]{2}(?:-[a-zA-Z]{2})?/)?models/([0-9]{1,18})(?:[-/][^?#]*)?(?:[?#].*)?$','i');
  IF parts IS NULL THEN RAISE EXCEPTION 'Use um link de modelo em https://makerworld.com/.../models/ID.'; END IF;
  design:=ltrim(parts[1],'0');IF design='' THEN RAISE EXCEPTION 'Identificador MakerWorld inválido.'; END IF;
  RETURN design;
END $$;
REVOKE ALL ON FUNCTION erp_private.makerworld_design_id(text) FROM PUBLIC,anon,authenticated;

CREATE TABLE public.makerworld_import_requests (
  request_id bigint PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),requested_by uuid NOT NULL REFERENCES auth.users(id),
  design_id text NOT NULL,source_url text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','ready','error')),
  requested_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  payload jsonb,message text,completed_at timestamptz,CHECK(payload IS NULL OR octet_length(payload::text)<=2097152)
);
CREATE INDEX makerworld_requests_tenant_time ON makerworld_import_requests(tenant_id,requested_at DESC);
ALTER TABLE makerworld_import_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON makerworld_import_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON makerworld_import_requests TO authenticated;
CREATE POLICY makerworld_request_read ON makerworld_import_requests FOR SELECT TO authenticated
  USING(tenant_id=get_user_tenant_id() AND requested_by=auth.uid() AND expires_at>now());

CREATE FUNCTION public.request_makerworld_import(p_url text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); design text; request bigint; cached makerworld_import_requests;
BEGIN
  design:=erp_private.makerworld_design_id(p_url);
  PERFORM pg_advisory_xact_lock(hashtextextended('makerworld-import-'||t::text,0));
  -- Cleanup is confined to this tenant's temporary import responses.
  PERFORM 1 FROM makerworld_import_requests WHERE tenant_id=t AND expires_at<=now() ORDER BY request_id FOR UPDATE;
  DELETE FROM net._http_response WHERE id IN(SELECT request_id FROM makerworld_import_requests WHERE tenant_id=t AND expires_at<=now());
  DELETE FROM net.http_request_queue WHERE id IN(SELECT request_id FROM makerworld_import_requests WHERE tenant_id=t AND expires_at<=now());
  DELETE FROM makerworld_import_requests WHERE tenant_id=t AND expires_at<=now();
  -- An abandoned browser must not hold every pending slot for ten minutes.
  -- Keep the tracking row so this recovery cannot bypass the minute quota.
  PERFORM 1 FROM makerworld_import_requests WHERE tenant_id=t AND status='pending' AND requested_at<=now()-interval '45 seconds' ORDER BY request_id FOR UPDATE;
  DELETE FROM net._http_response WHERE id IN(SELECT request_id FROM makerworld_import_requests WHERE tenant_id=t AND status='pending' AND requested_at<=now()-interval '45 seconds');
  DELETE FROM net.http_request_queue WHERE id IN(SELECT request_id FROM makerworld_import_requests WHERE tenant_id=t AND status='pending' AND requested_at<=now()-interval '45 seconds');
  UPDATE makerworld_import_requests SET status='error',payload=NULL,message='A consulta não respondeu a tempo. Tente importar novamente.',completed_at=now()
    WHERE tenant_id=t AND status='pending' AND requested_at<=now()-interval '45 seconds';
  SELECT * INTO cached FROM makerworld_import_requests WHERE tenant_id=t AND requested_by=auth.uid() AND design_id=design AND expires_at>now()
    AND status IN('pending','ready') ORDER BY requested_at DESC LIMIT 1;
  IF FOUND THEN RETURN cached.request_id; END IF;
  IF (SELECT count(*) FROM makerworld_import_requests WHERE tenant_id=t AND requested_at>now()-interval '1 minute')>=5 THEN
    RAISE EXCEPTION 'Limite de cinco consultas por minuto. Aguarde antes de importar outro modelo.';
  END IF;
  IF (SELECT count(*) FROM makerworld_import_requests WHERE tenant_id=t AND status='pending' AND expires_at>now())>=3 THEN
    RAISE EXCEPTION 'Há três importações em andamento. Aguarde uma delas terminar.';
  END IF;
  request:=net.http_get(url:='https://api.bambulab.com/v1/design-service/design/'||design,
    params:='{}'::jsonb,headers:='{"Accept":"application/json"}'::jsonb,timeout_milliseconds:=10000);
  INSERT INTO makerworld_import_requests(request_id,tenant_id,requested_by,design_id,source_url)
    VALUES(request,t,auth.uid(),design,p_url);
  RETURN request;
END $$;

CREATE FUNCTION public.get_makerworld_import(p_request_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); r makerworld_import_requests; response record; body jsonb; problem text;
BEGIN
  SELECT * INTO r FROM makerworld_import_requests WHERE request_id=p_request_id AND tenant_id=t AND requested_by=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação de importação não encontrada.'; END IF;
  IF r.expires_at<=now() THEN
    UPDATE makerworld_import_requests SET status='error',payload=NULL,message='A importação expirou. Consulte o link novamente.' WHERE request_id=r.request_id;
    DELETE FROM net._http_response WHERE id=r.request_id;DELETE FROM net.http_request_queue WHERE id=r.request_id;
    RETURN jsonb_build_object('status','error','message','A importação expirou. Consulte o link novamente.');
  END IF;
  IF r.status='ready' THEN RETURN jsonb_build_object('status','ready','payload',r.payload,'source_url',r.source_url,'design_id',r.design_id); END IF;
  IF r.status='error' THEN RETURN jsonb_build_object('status','error','message',r.message); END IF;
  SELECT status_code,content,timed_out,error_msg INTO response FROM net._http_response WHERE id=r.request_id ORDER BY created DESC LIMIT 1;
  IF NOT FOUND THEN
    IF r.requested_at>now()-interval '45 seconds' THEN RETURN jsonb_build_object('status','pending','retry_after_ms',1000); END IF;
    problem:='A consulta não respondeu a tempo. Tente importar novamente.';
  ELSIF coalesce(response.timed_out,false) OR response.error_msg IS NOT NULL THEN problem:='A consulta não respondeu a tempo. Tente importar novamente.';
  ELSIF response.status_code IS DISTINCT FROM 200 THEN problem:='O MakerWorld não disponibilizou este projeto. Confira se o modelo é público e tente novamente.';
  ELSIF response.content IS NULL OR octet_length(response.content)>2097152 THEN problem:='A resposta do projeto está vazia ou excede o limite de 2 MB.';
  ELSE
    BEGIN
      body:=response.content::jsonb;
      IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>2097152 THEN RAISE EXCEPTION 'invalid'; END IF;
      -- A public design response must identify the same requested design.
      IF coalesce(body->>'id',body->'data'->>'id') IS DISTINCT FROM r.design_id THEN RAISE EXCEPTION 'wrong design'; END IF;
    EXCEPTION WHEN OTHERS THEN problem:='O projeto retornou dados inválidos ou não corresponde ao link informado.';body:=NULL;
    END;
  END IF;
  DELETE FROM net._http_response WHERE id=r.request_id;DELETE FROM net.http_request_queue WHERE id=r.request_id;
  IF problem IS NOT NULL THEN
    UPDATE makerworld_import_requests SET status='error',message=problem,payload=NULL,completed_at=now() WHERE request_id=r.request_id;
    RETURN jsonb_build_object('status','error','message',problem);
  END IF;
  UPDATE makerworld_import_requests SET status='ready',payload=body,message=NULL,completed_at=now() WHERE request_id=r.request_id;
  RETURN jsonb_build_object('status','ready','payload',body,'source_url',r.source_url,'design_id',r.design_id);
END $$;
REVOKE ALL ON FUNCTION public.request_makerworld_import(text),public.get_makerworld_import(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_makerworld_import(text),public.get_makerworld_import(bigint) TO authenticated;

CREATE FUNCTION erp_private.assert_makerworld_reference_shape(p_reference jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; profile jsonb; variant jsonb; plate jsonb;
BEGIN
  IF p_reference->'schema_version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'Versão da referência MakerWorld inválida. Consulte o modelo novamente.'; END IF;
  FOREACH field IN ARRAY ARRAY['profiles','images','gallery','tags','categories','files','accessories','documentation','warnings'] LOOP
    IF jsonb_typeof(p_reference->field) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Referência MakerWorld incompleta. Consulte o modelo novamente.'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['images','gallery','tags','categories','warnings'] LOOP
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_reference->field) entry WHERE jsonb_typeof(entry) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Lista de textos da referência MakerWorld inválida.'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['files','accessories','documentation'] LOOP
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_reference->field) entry WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'Lista de arquivos ou instruções MakerWorld inválida.'; END IF;
  END LOOP;
  FOR profile IN SELECT value FROM jsonb_array_elements(p_reference->'profiles') LOOP
    IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR jsonb_typeof(profile->'variants') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Perfil MakerWorld incompleto. Consulte o modelo novamente.'; END IF;
    FOR variant IN SELECT profile UNION ALL SELECT value FROM jsonb_array_elements(profile->'variants') LOOP
      IF jsonb_typeof(variant) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Configuração de impressora MakerWorld inválida.'; END IF;
      FOREACH field IN ARRAY ARRAY['plate_details','filaments','images','warnings'] LOOP
        IF jsonb_typeof(variant->field) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Configuração de impressora MakerWorld incompleta. Consulte o modelo novamente.'; END IF;
      END LOOP;
      FOREACH field IN ARRAY ARRAY['images','warnings'] LOOP
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(variant->field) entry WHERE jsonb_typeof(entry) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Textos da configuração MakerWorld inválidos.'; END IF;
      END LOOP;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(variant->'filaments') entry WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'Filamentos da configuração MakerWorld inválidos.'; END IF;
      FOR plate IN SELECT value FROM jsonb_array_elements(variant->'plate_details') LOOP
        IF jsonb_typeof(plate) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Placa MakerWorld inválida.'; END IF;
        FOREACH field IN ARRAY ARRAY['filaments','images','objects','warnings'] LOOP
          IF jsonb_typeof(plate->field) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Placa MakerWorld incompleta. Consulte o modelo novamente.'; END IF;
        END LOOP;
        FOREACH field IN ARRAY ARRAY['images','warnings'] LOOP
          IF EXISTS(SELECT 1 FROM jsonb_array_elements(plate->field) entry WHERE jsonb_typeof(entry) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Textos da placa MakerWorld inválidos.'; END IF;
        END LOOP;
        FOREACH field IN ARRAY ARRAY['filaments','objects'] LOOP
          IF EXISTS(SELECT 1 FROM jsonb_array_elements(plate->field) entry WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'Materiais ou objetos da placa MakerWorld inválidos.'; END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION erp_private.assert_makerworld_reference_shape(jsonb) FROM PUBLIC,anon,authenticated;

-- Expand the old gallery guard with explicit resource limits, never truncation.
DO $$ DECLARE definition text; needle text:='jsonb_array_length(p_photos)>30'; BEGIN
  definition:=pg_get_functiondef('erp_private.save_product_with_photos_legacy(uuid,jsonb,jsonb,uuid)'::regprocedure);
  IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review the product gallery contract before applying this migration.'; END IF;
  EXECUTE replace(definition,needle,'jsonb_array_length(p_photos)>100 OR octet_length(p_photos::text)>2097152');
END $$;

ALTER FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_product_with_photos(uuid,jsonb,jsonb,uuid) RENAME TO save_product_before_external_import;
REVOKE ALL ON FUNCTION erp_private.save_product_before_external_import(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_product_with_photos(p_product_id uuid,p_product jsonb,p_photos jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); prior uuid; result uuid; reference jsonb; design text; selected text; selected_variant text; selected_profile jsonb; url text;
BEGIN
  -- The original RPC uses this same operation/payload identity, so retries from
  -- older clients remain valid and a partial nested save never commits alone.
  prior:=erp_private.begin_request(t,p_request_id,'product',jsonb_build_array(p_product_id,p_product,p_photos));
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF jsonb_typeof(p_product) IS DISTINCT FROM 'object' OR jsonb_typeof(p_photos) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_photos)>100 OR octet_length(p_photos::text)>2097152 THEN
    RAISE EXCEPTION 'Informe o produto e até 100 fotos, com no máximo 2 MB de endereços. Nenhuma foto foi descartada.';
  END IF;
  IF p_product ? 'external_import' AND p_product->'external_import'<>'null'::jsonb THEN
    reference:=p_product->'external_import';
    IF jsonb_typeof(reference) IS DISTINCT FROM 'object' OR reference->>'provider' IS DISTINCT FROM 'makerworld' OR octet_length(reference::text)>2097152 THEN
      RAISE EXCEPTION 'Referência MakerWorld inválida ou maior que 2 MB.';
    END IF;
    url:=reference->>'source_url';design:=erp_private.makerworld_design_id(url);
    IF coalesce(reference->>'design_id',reference->>'id') IS DISTINCT FROM design THEN RAISE EXCEPTION 'O identificador do projeto não corresponde ao link MakerWorld.'; END IF;
    PERFORM erp_private.assert_makerworld_reference_shape(reference);
    selected:=coalesce(nullif(reference->>'selected_profile_id',''),nullif(reference->>'selected_instance_id',''));
    SELECT profile INTO selected_profile FROM jsonb_array_elements(reference->'profiles') profile WHERE profile->>'instance_id'=selected LIMIT 1;
    IF selected IS NOT NULL AND selected_profile IS NULL THEN
      RAISE EXCEPTION 'Selecione um perfil público existente na referência importada.';
    END IF;
    selected_variant:=nullif(reference->>'selected_variant_profile_id','');
    IF selected_variant IS NOT NULL AND (selected_profile IS NULL OR (selected_profile->>'profile_id' IS DISTINCT FROM selected_variant AND
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected_profile->'variants') variant WHERE variant->>'profile_id'=selected_variant))) THEN
      RAISE EXCEPTION 'A configuração de impressora não pertence ao perfil público selecionado.';
    END IF;
    -- Keep the complete normalizer output (profiles, variants, filaments,
    -- detailed plates, licence and documents), with no productive ID mapping.
  END IF;
  result:=erp_private.save_product_before_external_import(p_product_id,p_product,p_photos,p_request_id);
  IF reference IS NOT NULL THEN
    UPDATE products SET external_import=reference WHERE id=result AND tenant_id=t;
    -- Reuse an existing reference without overwriting its verified cloud IDs.
    IF NOT EXISTS(SELECT 1 FROM product_print_sources WHERE tenant_id=t AND product_id=result AND is_active
      AND design_id=design AND source_url IS NOT NULL) THEN
      PERFORM public.save_product_print_source(NULL,result,jsonb_build_object('source_url','https://makerworld.com/models/'||design,
        'design_id',design,'label',coalesce(nullif(reference->>'title',''),'Referência MakerWorld')));
    END IF;
    INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata)
      VALUES(t,auth.uid(),'external_reference_import','products',result,jsonb_build_object('provider','makerworld','design_id',design,'selected_public_instance_id',selected,'production_recipe_changed',false));
  END IF;
  -- Omitting external_import (or sending null) keeps its previous reference.
  -- Import never creates material identities, recipe versions or ready plates.
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_with_photos(uuid,jsonb,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.erp_preserve_external_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN('authenticated','anon','service_role') THEN
    IF TG_OP='INSERT' THEN NEW.external_import:=NULL; ELSE NEW.external_import:=OLD.external_import; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_preserve_external_import BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION erp_preserve_external_import();
REVOKE ALL ON FUNCTION public.erp_preserve_external_import() FROM PUBLIC,anon,authenticated;
