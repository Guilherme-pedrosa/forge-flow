-- Authenticated storefront editing. Public visitors see only published content.
CREATE TABLE erp_private.storefront_content (
  channel_id uuid PRIMARY KEY REFERENCES public.storefront_channels(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  draft jsonb NOT NULL DEFAULT '{}',
  published jsonb NOT NULL DEFAULT '{}',
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  published_revision bigint NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE TABLE erp_private.storefront_content_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.storefront_channels(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  revision bigint NOT NULL,
  content jsonb NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel_id, revision)
);
REVOKE ALL ON erp_private.storefront_content, erp_private.storefront_content_history FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.storefront_cms_can_manage(p_channel_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.storefront_channels c
    JOIN public.profiles p ON p.tenant_id=c.tenant_id AND p.user_id=auth.uid()
    JOIN public.user_roles r ON r.user_id=p.user_id AND r.tenant_id=p.tenant_id
    WHERE c.id=p_channel_id AND r.role IN ('owner','admin')
  )
$$;
REVOKE ALL ON FUNCTION public.storefront_cms_can_manage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storefront_cms_can_manage(uuid) TO authenticated;

CREATE FUNCTION erp_private.storefront_cms_channel(p_slug text) RETURNS public.storefront_channels
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE channel public.storefront_channels;
BEGIN
  SELECT * INTO channel FROM public.storefront_channels WHERE slug=p_slug;
  IF channel.id IS NULL OR NOT public.storefront_cms_can_manage(channel.id) THEN
    RAISE EXCEPTION 'Seu usuário não tem permissão para administrar esta loja.' USING ERRCODE='42501';
  END IF;
  RETURN channel;
END $$;

CREATE FUNCTION erp_private.storefront_cms_image_url(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT p_value IS NOT NULL AND length(p_value) BETWEEN 1 AND 2048
    AND p_value !~ '[[:space:]<>"''\\]'
    AND (
      (p_value ~ '^/($|[^/])' AND position('//' in p_value)=0)
      OR p_value ~* '^https://([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(:[0-9]{1,5})?([/?#].*)?$'
    )
$$;
CREATE FUNCTION erp_private.storefront_cms_link_url(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT erp_private.storefront_cms_image_url(p_value)
    OR (p_value IS NOT NULL AND length(p_value)<=2048 AND (
      p_value ~ '^#[A-Za-z][A-Za-z0-9_-]{0,79}$'
      OR p_value ~* '^mailto:[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$'
      OR p_value ~ '^tel:\+?[0-9]{8,20}$'
    ))
$$;

CREATE FUNCTION erp_private.storefront_cms_validate(p_content jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE pair record; element jsonb; collection text; item_id text; ids text[]; value_text text;
BEGIN
  IF p_content IS NULL OR jsonb_typeof(p_content) IS DISTINCT FROM 'object'
    OR octet_length(p_content::text)>262144
    OR p_content-'schemaVersion'-'values'-'sections'-'banners'-'highlights'-'navigation'-'footerLinks'-'pages' <> '{}'::jsonb
    OR p_content->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(p_content->'values') IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_content->'values'))>250 THEN
    RAISE EXCEPTION 'Formato ou tamanho do conteúdo da loja inválido.' USING ERRCODE='22023';
  END IF;
  FOR pair IN SELECT key,value FROM jsonb_each(p_content->'values') LOOP
    IF pair.key !~ '^[a-z][a-z0-9_.-]{0,79}$' OR jsonb_typeof(pair.value) IS DISTINCT FROM 'string'
      OR length(pair.value#>>'{}')>20000 THEN
      RAISE EXCEPTION 'Confira os campos de texto da loja.' USING ERRCODE='22023';
    END IF;
    value_text:=pair.value#>>'{}';
    IF value_text<>'' AND (pair.key ~ '(\.image|\.logo|\.favicon|\.url)$' OR pair.key IN ('image','logo','favicon'))
      AND NOT erp_private.storefront_cms_image_url(value_text) THEN
      RAISE EXCEPTION 'Informe um endereço HTTPS ou caminho local válido para a imagem ou link.' USING ERRCODE='22023';
    END IF;
    IF value_text<>'' AND pair.key ~ '(^|[_.])href$' AND NOT erp_private.storefront_cms_link_url(value_text) THEN
      RAISE EXCEPTION 'Informe um link válido para o botão.' USING ERRCODE='22023';
    END IF;
    IF pair.key ~ '\.color$' AND value_text !~ '^#[0-9a-fA-F]{6}$' THEN
      RAISE EXCEPTION 'Informe as cores no formato #RRGGBB.' USING ERRCODE='22023';
    END IF;
    IF pair.key='theme.heading_font' AND value_text NOT IN ('cormorant','georgia','inter')
      OR pair.key='theme.body_font' AND value_text NOT IN ('inter','arial','georgia') THEN
      RAISE EXCEPTION 'Selecione uma das fontes disponíveis.' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(p_content->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(p_content->'sections')>5 THEN
    RAISE EXCEPTION 'Confira as seções da página inicial.' USING ERRCODE='22023';
  END IF;
  ids:=ARRAY[]::text[];
  FOR element IN SELECT value FROM jsonb_array_elements(p_content->'sections') LOOP
    value_text:=element#>>'{}';
    IF jsonb_typeof(element) IS DISTINCT FROM 'string' OR value_text NOT IN ('categories','hero','benefits','catalog','story') OR value_text=ANY(ids) THEN
      RAISE EXCEPTION 'As seções da página inicial devem ser válidas e não podem se repetir.' USING ERRCODE='22023';
    END IF;
    ids:=array_append(ids,value_text);
  END LOOP;
  FOREACH collection IN ARRAY ARRAY['banners','highlights','navigation','footerLinks','pages'] LOOP
    IF jsonb_typeof(p_content->collection) IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_content->collection)>(CASE collection WHEN 'banners' THEN 8 WHEN 'highlights' THEN 6 WHEN 'pages' THEN 12 ELSE 16 END) THEN
      RAISE EXCEPTION 'Confira a quantidade e o formato dos blocos da loja.' USING ERRCODE='22023';
    END IF;
    ids:=ARRAY[]::text[];
    FOR element IN SELECT value FROM jsonb_array_elements(p_content->collection) LOOP
      item_id:=element->>'id';
      IF jsonb_typeof(element) IS DISTINCT FROM 'object' OR jsonb_typeof(element->'id') IS DISTINCT FROM 'string'
        OR coalesce(item_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$' OR item_id=ANY(ids) THEN
        RAISE EXCEPTION 'Cada bloco da loja precisa de uma identificação válida e única.' USING ERRCODE='22023';
      END IF;
      ids:=array_append(ids,item_id);
      IF collection='banners' THEN
        IF element-'id'-'title'-'subtitle'-'image'-'alt'-'buttonLabel'-'buttonHref'-'align'-'enabled'<>'{}'::jsonb
          OR jsonb_typeof(element->'enabled') IS DISTINCT FROM 'boolean'
          OR jsonb_typeof(element->'align') IS DISTINCT FROM 'string'
          OR coalesce(element->>'align','') NOT IN ('left','center','right') THEN
          RAISE EXCEPTION 'Confira a configuração dos banners.' USING ERRCODE='22023';
        END IF;
        FOREACH value_text IN ARRAY ARRAY['title','subtitle','image','alt','buttonLabel','buttonHref'] LOOP
          IF jsonb_typeof(element->value_text) IS DISTINCT FROM 'string' OR length(element->>value_text)>(CASE WHEN value_text IN ('image','buttonHref') THEN 2048 ELSE 20000 END) THEN
            RAISE EXCEPTION 'Confira os textos e endereços do banner.' USING ERRCODE='22023';
          END IF;
        END LOOP;
        IF element->>'image'<>'' AND NOT erp_private.storefront_cms_image_url(element->>'image')
          OR element->>'buttonHref'<>'' AND NOT erp_private.storefront_cms_link_url(element->>'buttonHref') THEN
          RAISE EXCEPTION 'Use uma imagem e um link válidos no banner.' USING ERRCODE='22023';
        END IF;
      ELSIF collection='highlights' THEN
        IF element-'id'-'title'-'text'-'icon'<>'{}'::jsonb
          OR jsonb_typeof(element->'title') IS DISTINCT FROM 'string' OR length(element->>'title')>20000
          OR jsonb_typeof(element->'text') IS DISTINCT FROM 'string' OR length(element->>'text')>20000
          OR jsonb_typeof(element->'icon') IS DISTINCT FROM 'string'
          OR coalesce(element->>'icon','') NOT IN ('box','gift','heart','truck','clock','check') THEN
          RAISE EXCEPTION 'Confira os textos e ícones dos destaques.' USING ERRCODE='22023';
        END IF;
      ELSIF collection IN ('navigation','footerLinks') THEN
        IF element-'id'-'label'-'href'<>'{}'::jsonb OR jsonb_typeof(element->'label') IS DISTINCT FROM 'string'
          OR length(element->>'label') NOT BETWEEN 1 AND 20000 OR jsonb_typeof(element->'href') IS DISTINCT FROM 'string'
          OR NOT erp_private.storefront_cms_link_url(element->>'href') THEN
          RAISE EXCEPTION 'Confira o nome e o endereço dos links de navegação.' USING ERRCODE='22023';
        END IF;
      ELSE
        IF element-'id'-'slug'-'title'-'body'-'enabled'<>'{}'::jsonb
          OR jsonb_typeof(element->'slug') IS DISTINCT FROM 'string' OR length(element->>'slug') NOT BETWEEN 1 AND 80
          OR element->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          OR jsonb_typeof(element->'title') IS DISTINCT FROM 'string' OR length(element->>'title') NOT BETWEEN 1 AND 20000
          OR jsonb_typeof(element->'body') IS DISTINCT FROM 'string' OR length(element->>'body')>20000
          OR jsonb_typeof(element->'enabled') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'Confira título, endereço e texto das páginas da loja.' USING ERRCODE='22023';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_content->'pages')) <> (SELECT count(DISTINCT value->>'slug') FROM jsonb_array_elements(p_content->'pages')) THEN
    RAISE EXCEPTION 'Cada página da loja precisa de um endereço diferente.' USING ERRCODE='22023';
  END IF;
END $$;

CREATE FUNCTION erp_private.storefront_cms_result(p_channel public.storefront_channels) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('channel_id',(p_channel).id,'tenant_id',(p_channel).tenant_id,
    'draft',coalesce(c.draft,'{}'::jsonb),'published',coalesce(c.published,'{}'::jsonb),
    'revision',coalesce(c.revision,0),'published_revision',coalesce(c.published_revision,0),
    'updated_at',c.updated_at,'published_at',c.published_at)
  FROM (SELECT 1) one LEFT JOIN erp_private.storefront_content c ON c.channel_id=(p_channel).id
$$;

CREATE FUNCTION public.storefront_site(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('content',coalesce(c.published,'{}'::jsonb),'revision',coalesce(c.published_revision,0),'published_at',c.published_at)
  FROM (SELECT 1) one LEFT JOIN public.storefront_channels channel ON channel.slug=p_slug
  LEFT JOIN erp_private.storefront_content c ON c.channel_id=channel.id
$$;
CREATE FUNCTION public.storefront_cms_get(p_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE channel public.storefront_channels:=erp_private.storefront_cms_channel(p_slug);
BEGIN RETURN erp_private.storefront_cms_result(channel); END $$;

CREATE FUNCTION public.storefront_cms_save(p_slug text,p_content jsonb,p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE channel public.storefront_channels:=erp_private.storefront_cms_channel(p_slug); current erp_private.storefront_content;
BEGIN
  PERFORM erp_private.storefront_cms_validate(p_content);
  INSERT INTO erp_private.storefront_content(channel_id,tenant_id) VALUES(channel.id,channel.tenant_id) ON CONFLICT DO NOTHING;
  SELECT * INTO current FROM erp_private.storefront_content WHERE channel_id=channel.id FOR UPDATE;
  IF p_expected_revision IS NULL OR p_expected_revision<>current.revision THEN
    RAISE EXCEPTION 'O conteúdo foi alterado em outra sessão. Recarregue a versão atual antes de salvar.' USING ERRCODE='40001';
  END IF;
  UPDATE erp_private.storefront_content SET draft=p_content,revision=revision+1,updated_at=now(),updated_by=auth.uid() WHERE channel_id=channel.id;
  RETURN erp_private.storefront_cms_result(channel);
END $$;
CREATE FUNCTION public.storefront_cms_publish(p_slug text,p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE channel public.storefront_channels:=erp_private.storefront_cms_channel(p_slug); current erp_private.storefront_content; next_revision bigint; actor text;
BEGIN
  SELECT * INTO current FROM erp_private.storefront_content WHERE channel_id=channel.id FOR UPDATE;
  IF current.channel_id IS NULL THEN RAISE EXCEPTION 'Salve um rascunho antes de publicar.' USING ERRCODE='22023'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<>current.revision THEN
    RAISE EXCEPTION 'O conteúdo foi alterado em outra sessão. Recarregue a versão atual antes de publicar.' USING ERRCODE='40001';
  END IF;
  PERFORM erp_private.storefront_cms_validate(current.draft);
  next_revision:=current.revision+1;
  SELECT display_name INTO actor FROM public.profiles WHERE user_id=auth.uid() AND tenant_id=channel.tenant_id;
  INSERT INTO erp_private.storefront_content_history(channel_id,tenant_id,revision,content,actor_id,actor_name)
    VALUES(channel.id,channel.tenant_id,next_revision,current.draft,auth.uid(),coalesce(nullif(btrim(actor),''),'Administrador'));
  UPDATE erp_private.storefront_content SET published=draft,revision=next_revision,published_revision=next_revision,
    updated_at=now(),published_at=now(),updated_by=auth.uid(),published_by=auth.uid() WHERE channel_id=channel.id;
  RETURN erp_private.storefront_cms_result(channel);
END $$;
CREATE FUNCTION public.storefront_cms_history(p_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE channel public.storefront_channels:=erp_private.storefront_cms_channel(p_slug); result jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) INTO result FROM (
    SELECT id,revision,published_at,actor_name FROM erp_private.storefront_content_history
    WHERE channel_id=channel.id ORDER BY revision DESC LIMIT 20
  ) h;
  RETURN result;
END $$;
CREATE FUNCTION public.storefront_cms_restore(p_slug text,p_history_id uuid,p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE channel public.storefront_channels:=erp_private.storefront_cms_channel(p_slug); current erp_private.storefront_content; historical jsonb;
BEGIN
  SELECT * INTO current FROM erp_private.storefront_content WHERE channel_id=channel.id FOR UPDATE;
  IF current.channel_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<>current.revision THEN
    RAISE EXCEPTION 'O conteúdo foi alterado em outra sessão. Recarregue a versão atual antes de restaurar.' USING ERRCODE='40001';
  END IF;
  SELECT content INTO historical FROM erp_private.storefront_content_history WHERE id=p_history_id AND channel_id=channel.id AND tenant_id=channel.tenant_id;
  IF historical IS NULL THEN RAISE EXCEPTION 'Versão de publicação não encontrada nesta loja.' USING ERRCODE='22023'; END IF;
  PERFORM erp_private.storefront_cms_validate(historical);
  UPDATE erp_private.storefront_content SET draft=historical,revision=revision+1,updated_at=now(),updated_by=auth.uid() WHERE channel_id=channel.id;
  RETURN erp_private.storefront_cms_result(channel);
END $$;

REVOKE ALL ON FUNCTION erp_private.storefront_cms_channel(text),erp_private.storefront_cms_image_url(text),
  erp_private.storefront_cms_link_url(text),erp_private.storefront_cms_validate(jsonb),
  erp_private.storefront_cms_result(public.storefront_channels) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.storefront_site(text),public.storefront_cms_get(text),
  public.storefront_cms_save(text,jsonb,bigint),public.storefront_cms_publish(text,bigint),
  public.storefront_cms_history(text),public.storefront_cms_restore(text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_site(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_cms_get(text),public.storefront_cms_save(text,jsonb,bigint),
  public.storefront_cms_publish(text,bigint),public.storefront_cms_history(text),public.storefront_cms_restore(text,uuid,bigint) TO authenticated;

-- Existing Supabase installations already have these metadata columns. IF NOT
-- EXISTS also keeps database-only development harnesses compatible with Storage.
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[];
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('storefront-media','storefront-media',true,5242880,ARRAY['image/png','image/jpeg','image/webp','image/avif','image/gif'])
  ON CONFLICT(id) DO UPDATE SET public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
CREATE FUNCTION public.storefront_cms_media_allowed(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp|avif|gif)$'
    AND EXISTS(SELECT 1 FROM public.storefront_channels c
      WHERE c.id::text=split_part(p_name,'/',2) AND c.tenant_id::text=split_part(p_name,'/',1)
      AND public.storefront_cms_can_manage(c.id))
$$;
REVOKE ALL ON FUNCTION public.storefront_cms_media_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.storefront_cms_media_allowed(text) TO authenticated;
CREATE POLICY storefront_media_read ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='storefront-media' AND public.storefront_cms_media_allowed(name));
CREATE POLICY storefront_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(bucket_id='storefront-media' AND public.storefront_cms_media_allowed(name));
CREATE POLICY storefront_media_update ON storage.objects FOR UPDATE TO authenticated
  USING(bucket_id='storefront-media' AND public.storefront_cms_media_allowed(name))
  WITH CHECK(bucket_id='storefront-media' AND public.storefront_cms_media_allowed(name));
CREATE POLICY storefront_media_delete ON storage.objects FOR DELETE TO authenticated
  USING(bucket_id='storefront-media' AND public.storefront_cms_media_allowed(name));
