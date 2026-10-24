-- Add presentation blocks without rewriting any draft, publication or history.
-- Campaign images continue to use banners[].image and the existing media ACL.
CREATE OR REPLACE FUNCTION erp_private.storefront_cms_validate(p_content jsonb) RETURNS void
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
  IF jsonb_typeof(p_content->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(p_content->'sections')>8 THEN
    RAISE EXCEPTION 'Confira as seções da página inicial.' USING ERRCODE='22023';
  END IF;
  ids:=ARRAY[]::text[];
  FOR element IN SELECT value FROM jsonb_array_elements(p_content->'sections') LOOP
    value_text:=element#>>'{}';
    IF jsonb_typeof(element) IS DISTINCT FROM 'string' OR value_text NOT IN ('categories','hero','benefits','catalog','story','campaigns','collection','spotlight') OR value_text=ANY(ids) THEN
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
        IF element-'id'-'title'-'subtitle'-'image'-'alt'-'buttonLabel'-'buttonHref'-'align'-'enabled'-'kind'<>'{}'::jsonb
          OR jsonb_typeof(element->'enabled') IS DISTINCT FROM 'boolean'
          OR jsonb_typeof(element->'align') IS DISTINCT FROM 'string'
          OR coalesce(element->>'align','') NOT IN ('left','center','right')
          OR (element ? 'kind' AND (jsonb_typeof(element->'kind') IS DISTINCT FROM 'string' OR element->>'kind' NOT IN ('hero','campaign'))) THEN
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
REVOKE ALL ON FUNCTION erp_private.storefront_cms_validate(jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
