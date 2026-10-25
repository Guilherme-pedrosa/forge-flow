-- Private, bounded transfer queue for local Bambu Studio simulation.
-- A worker token grants access only to this tenant's simulation files/results.
CREATE TABLE erp_private.slicer_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL, token_hash text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  profiles text[] NOT NULL DEFAULT '{}', engine_version text, last_seen_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE erp_private.slicer_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  created_by uuid NOT NULL REFERENCES auth.users(id), request_id uuid NOT NULL,
  file_name text NOT NULL, extension text NOT NULL CHECK(extension IN ('stl','3mf')),
  source_size bigint NOT NULL CHECK(source_size BETWEEN 1 AND 67108864),
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  profile_id text NOT NULL CHECK(profile_id='bambu-a1-04-pla-020-v1'),
  status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','queued','running','done','failed','cancelled')),
  worker_id uuid REFERENCES erp_private.slicer_workers(id), lease_id uuid, leased_until timestamptz,
  attempts integer NOT NULL DEFAULT 0, progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  result_size bigint CHECK(result_size BETWEEN 1 AND 67108864), result_sha256 text CHECK(result_sha256 ~ '^[0-9a-f]{64}$'),
  raw_result_size bigint CHECK(raw_result_size BETWEEN 1 AND 67108864), raw_result_sha256 text CHECK(raw_result_sha256 ~ '^[0-9a-f]{64}$'),
  stats jsonb, error text, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,created_by,request_id)
);
CREATE TABLE erp_private.slicer_chunks (
  job_id uuid NOT NULL REFERENCES erp_private.slicer_jobs(id), kind text NOT NULL CHECK(kind IN ('source','result','raw')),
  part integer NOT NULL CHECK(part BETWEEN 0 AND 170), data bytea NOT NULL CHECK(octet_length(data) BETWEEN 1 AND 393216),
  PRIMARY KEY(job_id,kind,part)
);
CREATE INDEX slicer_jobs_queue ON erp_private.slicer_jobs(tenant_id,status,created_at);
CREATE INDEX slicer_jobs_user ON erp_private.slicer_jobs(tenant_id,created_by,status);
REVOKE ALL ON erp_private.slicer_workers,erp_private.slicer_jobs,erp_private.slicer_chunks FROM PUBLIC,anon,authenticated;

CREATE FUNCTION erp_private.slicer_cleanup() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE erp_private.slicer_jobs SET status='failed',error='O prazo desta simulação terminou. Envie o arquivo novamente.',completed_at=now(),updated_at=now()
    WHERE status IN ('uploading','queued','running') AND created_at<now()-interval '48 hours';
  UPDATE erp_private.slicer_jobs SET status='failed',error='O fatiador não respondeu. Confira a conexão e tente novamente.',completed_at=now(),updated_at=now()
    WHERE status='running' AND leased_until<now() AND attempts>=2;
  UPDATE erp_private.slicer_jobs SET status='queued',worker_id=NULL,lease_id=NULL,leased_until=NULL,progress=0,
    result_size=NULL,result_sha256=NULL,raw_result_size=NULL,raw_result_sha256=NULL,stats=NULL,error=NULL,updated_at=now()
    WHERE status='running' AND leased_until<now() AND attempts<2;
  DELETE FROM erp_private.slicer_chunks c USING erp_private.slicer_jobs j WHERE c.job_id=j.id AND
    ((c.kind='source' AND j.status IN ('done','failed','cancelled')) OR j.created_at<now()-interval '48 hours'
      OR (c.kind IN ('result','raw') AND j.status IN ('queued','failed','cancelled')));
END $$;

CREATE FUNCTION erp_private.slicer_access(p_job uuid,p_write boolean DEFAULT false) RETURNS erp_private.slicer_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs;
BEGIN
  IF auth.uid() IS NULL OR (p_write AND NOT erp_can_write(false)) THEN RAISE EXCEPTION 'Entre no Forge com acesso à produção.' USING ERRCODE='42501'; END IF;
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE id=p_job AND tenant_id=get_user_tenant_id() AND created_by=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Simulação não encontrada para este usuário.' USING ERRCODE='42501'; END IF;
  IF p_write AND j.created_at<now()-interval '48 hours' THEN RAISE EXCEPTION 'O envio deste arquivo expirou.'; END IF;
  RETURN j;
END $$;
CREATE FUNCTION erp_private.slicer_worker(p_worker uuid,p_token text) RETURNS erp_private.slicer_workers
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w erp_private.slicer_workers;
BEGIN
  IF coalesce(p_token,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Conexão do fatiador inválida.' USING ERRCODE='42501'; END IF;
  SELECT * INTO w FROM erp_private.slicer_workers WHERE id=p_worker AND is_active AND token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  IF NOT FOUND THEN RAISE EXCEPTION 'Conexão do fatiador inválida.' USING ERRCODE='42501'; END IF;
  RETURN w;
END $$;
CREATE FUNCTION erp_private.slicer_lease(p_worker uuid,p_token text,p_job uuid,p_lease uuid) RETURNS erp_private.slicer_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w erp_private.slicer_workers:=erp_private.slicer_worker(p_worker,p_token); j erp_private.slicer_jobs;
BEGIN
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE id=p_job AND tenant_id=w.tenant_id AND worker_id=w.id AND lease_id=p_lease FOR UPDATE;
  IF NOT FOUND OR j.status<>'running' OR j.leased_until<now() OR j.created_at<now()-interval '48 hours' THEN RAISE EXCEPTION 'A simulação não está mais atribuída a este fatiador.' USING ERRCODE='42501'; END IF;
  RETURN j;
END $$;
CREATE FUNCTION erp_private.slicer_metadata(j erp_private.slicer_jobs) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('id',j.id,'file_name',j.file_name,'extension',j.extension,'source_size',j.source_size,'source_sha256',j.source_sha256,
    'profile_id',j.profile_id,'status',j.status,'progress',j.progress,'error',j.error,'stats',j.stats,'created_at',j.created_at,'started_at',j.started_at,
    'result_size',j.result_size,'result_sha256',j.result_sha256,'raw_result_size',j.raw_result_size,'raw_result_sha256',j.raw_result_sha256,'chunk_bytes',393216,
    'result_available',j.status='done' AND EXISTS(SELECT 1 FROM erp_private.slicer_chunks WHERE job_id=j.id AND kind='result'),
    'result_chunks',coalesce(ceil(j.result_size::numeric/393216)::integer,0))
$$;
CREATE FUNCTION erp_private.slicer_put_chunk(j erp_private.slicer_jobs,p_kind text,p_part integer,p_base64 text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bytes bytea; expected integer; total bigint:=CASE WHEN p_kind='source' THEN j.source_size WHEN p_kind='raw' THEN j.raw_result_size ELSE j.result_size END; previous bytea;
BEGIN
  IF total IS NULL OR p_part IS NULL OR p_part<0 OR p_part>=ceil(total::numeric/393216) OR coalesce(length(p_base64),0) NOT BETWEEN 1 AND 524288
    OR p_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' THEN RAISE EXCEPTION 'Bloco do arquivo inválido.'; END IF;
  bytes:=decode(p_base64,'base64'); expected:=least(393216,total-p_part::bigint*393216)::integer;
  IF octet_length(bytes)<>expected OR replace(encode(bytes,'base64'),E'\n','')<>p_base64 THEN RAISE EXCEPTION 'Tamanho ou conteúdo do bloco inválido.'; END IF;
  SELECT data INTO previous FROM erp_private.slicer_chunks WHERE job_id=j.id AND kind=p_kind AND part=p_part;
  IF FOUND AND previous<>bytes THEN RAISE EXCEPTION 'Este bloco já foi enviado com outro conteúdo.'; END IF;
  INSERT INTO erp_private.slicer_chunks(job_id,kind,part,data) VALUES(j.id,p_kind,p_part,bytes) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION erp_private.slicer_verify(j erp_private.slicer_jobs,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bytes bytea; count_parts integer; total bigint:=CASE WHEN p_kind='source' THEN j.source_size WHEN p_kind='raw' THEN j.raw_result_size ELSE j.result_size END;
  expected_hash text:=CASE WHEN p_kind='source' THEN j.source_sha256 WHEN p_kind='raw' THEN j.raw_result_sha256 ELSE j.result_sha256 END;
BEGIN
  IF total IS NULL OR expected_hash IS NULL THEN RAISE EXCEPTION 'O arquivo de resultado ainda não foi informado.'; END IF;
  SELECT string_agg(data,''::bytea ORDER BY part),count(*) INTO bytes,count_parts FROM erp_private.slicer_chunks WHERE job_id=j.id AND kind=p_kind;
  IF count_parts<>ceil(total::numeric/393216)::integer OR coalesce(octet_length(bytes),0)<>total THEN RAISE EXCEPTION 'O arquivo ainda não foi enviado por completo.'; END IF;
  IF encode(sha256(bytes),'hex')<>expected_hash THEN RAISE EXCEPTION 'O hash do arquivo não confere. Envie novamente.'; END IF;
END $$;

CREATE FUNCTION public.slicer_profiles() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); can_manage boolean;
BEGIN
  IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Entre no Forge para simular.' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM user_roles WHERE tenant_id=t AND user_id=auth.uid() AND role IN ('owner','admin')) INTO can_manage;
  RETURN jsonb_build_object('can_manage_workers',can_manage,'max_file_bytes',67108864,'chunk_bytes',393216,'profiles',jsonb_build_array(jsonb_build_object(
    'id','bambu-a1-04-pla-020-v1','name','Bambu A1 · bico 0,4 mm · PLA · camada 0,20 mm','engine','Bambu Studio','engine_version','02.08.02.61',
    'available',EXISTS(SELECT 1 FROM erp_private.slicer_workers WHERE tenant_id=t AND is_active AND last_seen_at>now()-interval '90 seconds' AND 'bambu-a1-04-pla-020-v1'=ANY(profiles)))));
END $$;
CREATE FUNCTION public.create_slicer_worker(p_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id(); token text; worker uuid;
BEGIN
  IF auth.uid() IS NULL OR t IS NULL OR NOT EXISTS(SELECT 1 FROM user_roles WHERE tenant_id=t AND user_id=auth.uid() AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Somente um administrador pode conectar o fatiador.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('slicer-workers-'||t::text,0));
  IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 80 OR (SELECT count(*) FROM erp_private.slicer_workers WHERE tenant_id=t AND is_active)>=5 THEN RAISE EXCEPTION 'Informe um nome e mantenha até cinco conexões de fatiador ativas.'; END IF;
  token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  INSERT INTO erp_private.slicer_workers(tenant_id,name,token_hash,created_by) VALUES(t,btrim(p_name),encode(sha256(convert_to(token,'UTF8')),'hex'),auth.uid()) RETURNING id INTO worker;
  RETURN jsonb_build_object('worker_id',worker,'worker_token',token);
END $$;
CREATE FUNCTION public.revoke_slicer_worker(p_worker uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR t IS NULL OR NOT EXISTS(SELECT 1 FROM user_roles WHERE tenant_id=t AND user_id=auth.uid() AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Somente um administrador pode desconectar o fatiador.' USING ERRCODE='42501'; END IF;
  UPDATE erp_private.slicer_workers SET is_active=false WHERE id=p_worker AND tenant_id=t;
END $$;
CREATE FUNCTION public.start_slicer_upload(p_name text,p_size bigint,p_sha256 text,p_profile text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(false); j erp_private.slicer_jobs; ext text;
BEGIN
  PERFORM erp_private.slicer_cleanup();
  PERFORM pg_advisory_xact_lock(hashtextextended('slicer-user-'||auth.uid()::text,0));
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE tenant_id=t AND created_by=auth.uid() AND request_id=p_request;
  IF FOUND THEN
    IF (j.file_name,j.source_size,j.source_sha256,j.profile_id) IS DISTINCT FROM (p_name,p_size,p_sha256,p_profile) THEN RAISE EXCEPTION 'Identificador já usado com outro arquivo ou perfil.'; END IF;
    RETURN erp_private.slicer_metadata(j);
  END IF;
  ext:=lower(substring(p_name from '\.([^.]+)$'));
  IF p_request IS NULL OR length(coalesce(p_name,'')) NOT BETWEEN 1 AND 200 OR p_name ~ '[[:cntrl:]/\\]' OR ext NOT IN ('stl','3mf') OR ext IS NULL
    OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 67108864 OR coalesce(p_sha256,'') !~ '^[0-9a-f]{64}$' OR p_profile IS DISTINCT FROM 'bambu-a1-04-pla-020-v1' THEN RAISE EXCEPTION 'Envie um STL ou 3MF de até 64 MB e escolha um perfil disponível.'; END IF;
  IF (SELECT count(*) FROM erp_private.slicer_jobs WHERE tenant_id=t AND created_by=auth.uid() AND status IN ('uploading','queued','running'))>=3 THEN RAISE EXCEPTION 'Você já tem três simulações ativas. Aguarde ou cancele uma delas.'; END IF;
  INSERT INTO erp_private.slicer_jobs(tenant_id,created_by,request_id,file_name,extension,source_size,source_sha256,profile_id)
    VALUES(t,auth.uid(),p_request,p_name,ext,p_size,p_sha256,p_profile) RETURNING * INTO j;
  RETURN erp_private.slicer_metadata(j);
END $$;
CREATE FUNCTION public.upload_slicer_chunk(p_job uuid,p_part integer,p_base64 text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_access(p_job,true);
BEGIN
  PERFORM 1 FROM erp_private.slicer_jobs WHERE id=j.id FOR UPDATE;
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE id=j.id;
  IF j.status<>'uploading' THEN RAISE EXCEPTION 'O envio deste arquivo já foi concluído.'; END IF;
  PERFORM erp_private.slicer_put_chunk(j,'source',p_part,p_base64);
END $$;
CREATE FUNCTION public.finish_slicer_upload(p_job uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_access(p_job,true);
BEGIN
  PERFORM 1 FROM erp_private.slicer_jobs WHERE id=j.id FOR UPDATE;
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE id=j.id;
  IF j.status='uploading' THEN
    PERFORM erp_private.slicer_verify(j,'source');
    UPDATE erp_private.slicer_jobs SET status='queued',updated_at=now() WHERE id=j.id RETURNING * INTO j;
  END IF;
  RETURN erp_private.slicer_metadata(j);
END $$;
CREATE FUNCTION public.slicer_job(p_job uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs;
BEGIN PERFORM erp_private.slicer_access(p_job); PERFORM erp_private.slicer_cleanup(); j:=erp_private.slicer_access(p_job); RETURN erp_private.slicer_metadata(j); END $$;
CREATE FUNCTION public.cancel_slicer_job(p_job uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_access(p_job);
BEGIN
  UPDATE erp_private.slicer_jobs SET status='cancelled',error=NULL,completed_at=now(),updated_at=now() WHERE id=j.id AND status IN ('uploading','queued','running');
  DELETE FROM erp_private.slicer_chunks WHERE job_id=j.id AND EXISTS(SELECT 1 FROM erp_private.slicer_jobs WHERE id=j.id AND status='cancelled');
END $$;
CREATE FUNCTION public.slicer_result_chunk(p_job uuid,p_part integer,p_raw boolean DEFAULT false) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_access(p_job); result text; chunk_kind text:='result'; size bigint;
BEGIN
  IF p_raw AND j.raw_result_sha256 IS DISTINCT FROM j.result_sha256 THEN chunk_kind:='raw'; END IF;
  size:=CASE WHEN p_raw THEN j.raw_result_size ELSE j.result_size END;
  IF j.status<>'done' OR j.created_at<now()-interval '48 hours' OR size IS NULL OR p_part IS NULL OR p_part<0 OR p_part>=ceil(size::numeric/393216) THEN RAISE EXCEPTION 'O arquivo da simulação não está disponível.'; END IF;
  SELECT replace(encode(c.data,'base64'),E'\n','') INTO result FROM erp_private.slicer_chunks c WHERE c.job_id=j.id AND c.kind=chunk_kind AND c.part=p_part;
  IF result IS NULL THEN RAISE EXCEPTION 'O arquivo da simulação expirou.'; END IF; RETURN result;
END $$;

CREATE FUNCTION public.slicer_worker_hello(p_worker uuid,p_token text,p_profiles text[],p_engine_version text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w erp_private.slicer_workers:=erp_private.slicer_worker(p_worker,p_token);
BEGIN
  IF p_profiles IS DISTINCT FROM ARRAY['bambu-a1-04-pla-020-v1']::text[] OR p_engine_version IS DISTINCT FROM '02.08.02.61' THEN RAISE EXCEPTION 'Perfil ou versão do fatiador não suportado.'; END IF;
  UPDATE erp_private.slicer_workers SET profiles=p_profiles,engine_version=p_engine_version,last_seen_at=now() WHERE id=w.id;
END $$;
CREATE FUNCTION public.claim_slicer_job(p_worker uuid,p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w erp_private.slicer_workers:=erp_private.slicer_worker(p_worker,p_token); j erp_private.slicer_jobs;
BEGIN
  PERFORM erp_private.slicer_cleanup();
  PERFORM 1 FROM erp_private.slicer_workers WHERE id=w.id FOR UPDATE;
  UPDATE erp_private.slicer_workers SET last_seen_at=now() WHERE id=w.id;
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE worker_id=w.id AND status='running' AND leased_until>now() ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO j FROM erp_private.slicer_jobs WHERE tenant_id=w.tenant_id AND status='queued' AND profile_id=ANY(w.profiles) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE erp_private.slicer_jobs SET status='running',worker_id=w.id,lease_id=gen_random_uuid(),leased_until=now()+interval '120 seconds',
      attempts=attempts+1,progress=1,started_at=coalesce(started_at,now()),updated_at=now() WHERE id=j.id RETURNING * INTO j;
  END IF;
  RETURN erp_private.slicer_metadata(j)||jsonb_build_object('lease_id',j.lease_id,'source_chunks',ceil(j.source_size::numeric/393216)::integer);
END $$;
CREATE FUNCTION public.slicer_worker_heartbeat(p_worker uuid,p_token text,p_job uuid,p_lease uuid,p_progress integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_lease(p_worker,p_token,p_job,p_lease);
BEGIN
  IF p_progress IS NULL OR p_progress NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'Progresso inválido.'; END IF;
  UPDATE erp_private.slicer_jobs SET leased_until=now()+interval '120 seconds',progress=greatest(progress,p_progress),updated_at=now() WHERE id=j.id;
  UPDATE erp_private.slicer_workers SET last_seen_at=now() WHERE id=p_worker;
END $$;
CREATE FUNCTION public.slicer_worker_source(p_worker uuid,p_token text,p_job uuid,p_lease uuid,p_part integer) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_lease(p_worker,p_token,p_job,p_lease); result text;
BEGIN
  IF p_part IS NULL OR p_part<0 OR p_part>=ceil(j.source_size::numeric/393216) THEN RAISE EXCEPTION 'Bloco inválido.'; END IF;
  SELECT replace(encode(data,'base64'),E'\n','') INTO result FROM erp_private.slicer_chunks WHERE job_id=j.id AND kind='source' AND part=p_part;
  IF result IS NULL THEN RAISE EXCEPTION 'Arquivo de origem indisponível.'; END IF; RETURN result;
END $$;
CREATE FUNCTION public.slicer_worker_result(p_worker uuid,p_token text,p_job uuid,p_lease uuid,p_size bigint,p_sha256 text,p_stats jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_lease(p_worker,p_token,p_job,p_lease);
BEGIN
  PERFORM 1 FROM erp_private.slicer_jobs WHERE id=j.id FOR UPDATE;
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE id=j.id;
  IF p_size IS NULL OR p_size NOT BETWEEN 1 AND 67108864 OR coalesce(p_sha256,'') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_stats) IS DISTINCT FROM 'object'
    OR octet_length(p_stats::text)>65536 OR p_stats->>'engine' IS DISTINCT FROM 'Bambu Studio' OR p_stats->>'engine_version' IS DISTINCT FROM '02.08.02.61'
    OR p_stats->>'profile_id' IS DISTINCT FROM j.profile_id OR NOT erp_private.valid_number((p_stats->>'time_seconds')::numeric,0.001)
    OR (p_stats->>'time_seconds')::numeric>31536000 OR NOT erp_private.valid_number((p_stats->>'weight_grams')::numeric,0.001)
    OR (p_stats->>'weight_grams')::numeric>1000000
    OR p_stats->>'input_sha256' IS DISTINCT FROM j.source_sha256 OR p_stats->>'output_sha256' IS DISTINCT FROM p_sha256
    OR coalesce(p_stats->>'raw_output_sha256','') !~ '^[0-9a-f]{64}$' OR (p_stats->>'raw_output_size')::bigint NOT BETWEEN 1 AND 67108864
    OR p_stats->>'raw_output_size' IS NULL OR jsonb_typeof(p_stats->'normalizations') IS DISTINCT FROM 'array'
    OR p_stats->'normalizations' NOT IN ('[]'::jsonb,'["bambu_compatible_printers_xml_escape_v1"]'::jsonb,'["bambu_print_extruder_variant_xml_escape_v1"]'::jsonb,'["bambu_compatible_printers_xml_escape_v1","bambu_print_extruder_variant_xml_escape_v1"]'::jsonb)
    OR ((p_stats->>'raw_output_sha256'=p_sha256) IS DISTINCT FROM (p_stats->'normalizations'='[]'::jsonb))
    OR (p_stats->>'raw_output_sha256'=p_sha256 AND (p_stats->>'raw_output_size')::bigint<>p_size)
    THEN RAISE EXCEPTION 'Resultado do fatiador inválido.'; END IF;
  IF j.result_sha256 IS NOT NULL AND (j.result_size,j.result_sha256,j.stats) IS DISTINCT FROM (p_size,p_sha256,p_stats) THEN RAISE EXCEPTION 'O resultado já foi iniciado com outro conteúdo.'; END IF;
  UPDATE erp_private.slicer_jobs SET result_size=p_size,result_sha256=p_sha256,raw_result_size=(p_stats->>'raw_output_size')::bigint,raw_result_sha256=p_stats->>'raw_output_sha256',stats=p_stats,updated_at=now() WHERE id=j.id;
END $$;
CREATE FUNCTION public.slicer_worker_result_chunk(p_worker uuid,p_token text,p_job uuid,p_lease uuid,p_part integer,p_base64 text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_lease(p_worker,p_token,p_job,p_lease);
BEGIN PERFORM 1 FROM erp_private.slicer_jobs WHERE id=j.id FOR UPDATE; PERFORM erp_private.slicer_put_chunk(j,'result',p_part,p_base64); END $$;
CREATE FUNCTION public.slicer_worker_raw_chunk(p_worker uuid,p_token text,p_job uuid,p_lease uuid,p_part integer,p_base64 text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_lease(p_worker,p_token,p_job,p_lease);
BEGIN
  PERFORM 1 FROM erp_private.slicer_jobs WHERE id=j.id FOR UPDATE;
  IF j.raw_result_sha256 IS NOT DISTINCT FROM j.result_sha256 THEN RAISE EXCEPTION 'A saída bruta já corresponde ao resultado.'; END IF;
  PERFORM erp_private.slicer_put_chunk(j,'raw',p_part,p_base64);
END $$;
CREATE FUNCTION public.reset_slicer_result(p_worker uuid,p_token text,p_job uuid,p_lease uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_lease(p_worker,p_token,p_job,p_lease);
BEGIN
  PERFORM 1 FROM erp_private.slicer_jobs WHERE id=j.id FOR UPDATE;
  DELETE FROM erp_private.slicer_chunks WHERE job_id=j.id AND kind IN ('raw','result');
  UPDATE erp_private.slicer_jobs SET result_size=NULL,result_sha256=NULL,raw_result_size=NULL,raw_result_sha256=NULL,stats=NULL,updated_at=now() WHERE id=j.id;
END $$;
CREATE FUNCTION public.finish_slicer_job(p_worker uuid,p_token text,p_job uuid,p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w erp_private.slicer_workers:=erp_private.slicer_worker(p_worker,p_token); j erp_private.slicer_jobs;
BEGIN
  SELECT * INTO j FROM erp_private.slicer_jobs WHERE id=p_job AND tenant_id=w.tenant_id AND worker_id=w.id AND lease_id=p_lease FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Simulação não atribuída a este fatiador.' USING ERRCODE='42501'; END IF;
  IF j.status='done' THEN RETURN erp_private.slicer_metadata(j); END IF;
  PERFORM erp_private.slicer_lease(p_worker,p_token,p_job,p_lease);
  PERFORM erp_private.slicer_verify(j,'result');
  IF j.raw_result_sha256 IS DISTINCT FROM j.result_sha256 THEN PERFORM erp_private.slicer_verify(j,'raw'); END IF;
  UPDATE erp_private.slicer_jobs SET status='done',progress=100,completed_at=now(),leased_until=NULL,updated_at=now() WHERE id=j.id RETURNING * INTO j;
  DELETE FROM erp_private.slicer_chunks WHERE job_id=j.id AND kind='source';
  RETURN erp_private.slicer_metadata(j);
END $$;
CREATE FUNCTION public.fail_slicer_job(p_worker uuid,p_token text,p_job uuid,p_lease uuid,p_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j erp_private.slicer_jobs:=erp_private.slicer_lease(p_worker,p_token,p_job,p_lease);
BEGIN
  UPDATE erp_private.slicer_jobs SET status='failed',error=left(coalesce(nullif(btrim(p_error),''),'Não foi possível simular este arquivo.'),1000),completed_at=now(),leased_until=NULL,updated_at=now() WHERE id=j.id;
  DELETE FROM erp_private.slicer_chunks WHERE job_id=j.id;
END $$;

REVOKE ALL ON FUNCTION erp_private.slicer_cleanup(),erp_private.slicer_access(uuid,boolean),erp_private.slicer_worker(uuid,text),erp_private.slicer_lease(uuid,text,uuid,uuid),erp_private.slicer_metadata(erp_private.slicer_jobs),erp_private.slicer_put_chunk(erp_private.slicer_jobs,text,integer,text),erp_private.slicer_verify(erp_private.slicer_jobs,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.slicer_profiles(),public.create_slicer_worker(text),public.revoke_slicer_worker(uuid),public.start_slicer_upload(text,bigint,text,text,uuid),public.upload_slicer_chunk(uuid,integer,text),public.finish_slicer_upload(uuid),public.slicer_job(uuid),public.cancel_slicer_job(uuid),public.slicer_result_chunk(uuid,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.slicer_profiles(),public.create_slicer_worker(text),public.revoke_slicer_worker(uuid),public.start_slicer_upload(text,bigint,text,text,uuid),public.upload_slicer_chunk(uuid,integer,text),public.finish_slicer_upload(uuid),public.slicer_job(uuid),public.cancel_slicer_job(uuid),public.slicer_result_chunk(uuid,integer,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.slicer_worker_hello(uuid,text,text[],text),public.claim_slicer_job(uuid,text),public.slicer_worker_heartbeat(uuid,text,uuid,uuid,integer),public.slicer_worker_source(uuid,text,uuid,uuid,integer),public.slicer_worker_result(uuid,text,uuid,uuid,bigint,text,jsonb),public.slicer_worker_result_chunk(uuid,text,uuid,uuid,integer,text),public.finish_slicer_job(uuid,text,uuid,uuid),public.fail_slicer_job(uuid,text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slicer_worker_hello(uuid,text,text[],text),public.claim_slicer_job(uuid,text),public.slicer_worker_heartbeat(uuid,text,uuid,uuid,integer),public.slicer_worker_source(uuid,text,uuid,uuid,integer),public.slicer_worker_result(uuid,text,uuid,uuid,bigint,text,jsonb),public.slicer_worker_result_chunk(uuid,text,uuid,uuid,integer,text),public.finish_slicer_job(uuid,text,uuid,uuid),public.fail_slicer_job(uuid,text,uuid,uuid,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.slicer_worker_raw_chunk(uuid,text,uuid,uuid,integer,text),public.reset_slicer_result(uuid,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slicer_worker_raw_chunk(uuid,text,uuid,uuid,integer,text),public.reset_slicer_result(uuid,text,uuid,uuid) TO anon,authenticated;
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    EXECUTE $schedule$SELECT cron.schedule('forge-slicer-cleanup','17 * * * *','SELECT erp_private.slicer_cleanup()')$schedule$;
  END IF;
END $$;
