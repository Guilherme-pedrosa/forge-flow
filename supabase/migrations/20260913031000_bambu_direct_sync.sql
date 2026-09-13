-- Bambu task history directly through pg_net. Requests start only on COMMIT.
-- Credentials never enter public state, function results or error messages.
CREATE TABLE public.bambu_sync_state (
  bambu_device_id uuid PRIMARY KEY REFERENCES public.bambu_devices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.bambu_connections(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','queued','syncing','success','error','disabled')),
  last_requested_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error text,
  http_status integer,
  tasks_received integer NOT NULL DEFAULT 0,
  history_may_be_truncated boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bambu_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY bambu_sync_state_read ON public.bambu_sync_state FOR SELECT TO authenticated
  USING(tenant_id=public.get_user_tenant_id());
REVOKE ALL ON public.bambu_sync_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bambu_sync_state TO authenticated;

CREATE TABLE erp_private.bambu_sync_queue (
  bambu_device_id uuid PRIMARY KEY REFERENCES public.bambu_devices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.bambu_connections(id) ON DELETE CASCADE,
  request_id bigint,
  dispatched_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz
);
CREATE UNIQUE INDEX bambu_sync_inflight_unique ON erp_private.bambu_sync_queue(request_id) WHERE request_id IS NOT NULL;
REVOKE ALL ON erp_private.bambu_sync_queue FROM PUBLIC,anon,authenticated;

-- pg_net has broad default grants in some installations. Its transient queue
-- contains Authorization headers, so a SQL client must not be able to read it.
DO $$ BEGIN
  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON net.http_request_queue FROM PUBLIC,anon,authenticated';
  END IF;
  IF to_regclass('net._http_response') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON net._http_response FROM PUBLIC,anon,authenticated';
  END IF;
END $$;

CREATE FUNCTION erp_private.bambu_sync_seed(p_tenant uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO erp_private.bambu_sync_queue(bambu_device_id,tenant_id,connection_id)
    SELECT d.id,d.tenant_id,d.connection_id FROM bambu_devices d
      JOIN bambu_connections c ON c.id=d.connection_id AND c.tenant_id=d.tenant_id
    WHERE c.is_active AND (p_tenant IS NULL OR d.tenant_id=p_tenant)
    ON CONFLICT(bambu_device_id) DO NOTHING;
  INSERT INTO bambu_sync_state(bambu_device_id,tenant_id,connection_id,next_attempt_at)
    SELECT q.bambu_device_id,q.tenant_id,q.connection_id,q.next_attempt_at
      FROM erp_private.bambu_sync_queue q WHERE p_tenant IS NULL OR q.tenant_id=p_tenant
    ON CONFLICT(bambu_device_id) DO NOTHING;
  -- A successful reconnection updates the protected connection row. Resume an
  -- authentication failure without retaining its one-hour backoff, while still
  -- respecting five minutes since the last HTTP attempt.
  WITH resumed AS (
    UPDATE erp_private.bambu_sync_queue q SET attempts=0,
      next_attempt_at=greatest(now(),q.last_attempt_at+interval '5 minutes')
    FROM bambu_connections c,bambu_sync_state s
    WHERE c.id=q.connection_id AND c.tenant_id=q.tenant_id AND c.is_active
      AND nullif(btrim(c.access_token_encrypted),'') IS NOT NULL
      AND s.bambu_device_id=q.bambu_device_id AND s.last_error_code='auth_required'
      AND q.request_id IS NULL AND c.updated_at>q.last_attempt_at
      AND (p_tenant IS NULL OR q.tenant_id=p_tenant)
    RETURNING q.bambu_device_id,q.next_attempt_at
  )
  UPDATE bambu_sync_state s SET status='queued',next_attempt_at=r.next_attempt_at,
    last_error_code=NULL,last_error=NULL,http_status=NULL,updated_at=now()
    FROM resumed r WHERE s.bambu_device_id=r.bambu_device_id;
END $$;

CREATE FUNCTION erp_private.bambu_sync_fail(p_device uuid,p_code text,p_message text,p_http integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE retry_at timestamptz;
BEGIN
  UPDATE erp_private.bambu_sync_queue SET request_id=NULL,dispatched_at=NULL,
    next_attempt_at=now()+CASE WHEN p_code='auth_required' THEN interval '1 hour'
      ELSE make_interval(mins=>least(60,5*power(2,least(greatest(attempts-1,0),4))::integer)) END
    WHERE bambu_device_id=p_device RETURNING next_attempt_at INTO retry_at;
  UPDATE bambu_sync_state SET status='error',last_error_code=p_code,last_error=p_message,
    http_status=p_http,next_attempt_at=retry_at,updated_at=now() WHERE bambu_device_id=p_device;
END $$;

CREATE FUNCTION erp_private.bambu_sync_timestamp(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=public SET timezone='UTC' AS $$
DECLARE v text:=p_value#>>'{}'; result timestamptz; epoch numeric;
BEGIN
  IF v IS NULL OR btrim(v)='' THEN RETURN NULL; END IF;
  IF v ~ '^[0-9]+(\.[0-9]+)?$' THEN
    epoch:=v::numeric;
    result:=to_timestamp(CASE WHEN epoch>100000000000 THEN epoch/1000 ELSE epoch END);
  ELSE result:=v::timestamptz; END IF;
  IF NOT isfinite(result) THEN RAISE EXCEPTION 'Data Bambu inválida.'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION erp_private.bambu_sync_number(p_value jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result numeric;
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN NULL; END IF;
  result:=(p_value#>>'{}')::numeric;
  IF NOT erp_private.valid_number(result) THEN RAISE EXCEPTION 'Medida Bambu inválida.'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION erp_private.bambu_sync_process(p_tenant uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q record; response record; data jsonb; task jsonb; task_id text; task_count integer;
  grams numeric; seconds numeric; processed integer:=0; discarded boolean;
BEGIN
  IF to_regclass('net._http_response') IS NULL THEN RETURN 0; END IF;
  FOR q IN SELECT queue.* FROM erp_private.bambu_sync_queue queue
    WHERE queue.request_id IS NOT NULL AND (p_tenant IS NULL OR queue.tenant_id=p_tenant)
    ORDER BY queue.dispatched_at LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    SELECT status_code,content,timed_out,error_msg INTO response FROM net._http_response WHERE id=q.request_id ORDER BY created DESC LIMIT 1;
    IF NOT FOUND AND q.dispatched_at>now()-interval '2 minutes' THEN CONTINUE; END IF;
    processed:=processed+1;
    -- Ignore a response if the connection was disconnected or the device moved.
    discarded:=NOT EXISTS(SELECT 1 FROM bambu_devices d JOIN bambu_connections c
      ON c.id=d.connection_id AND c.tenant_id=d.tenant_id
      WHERE d.id=q.bambu_device_id AND d.tenant_id=q.tenant_id AND c.id=q.connection_id AND c.is_active);
    IF discarded THEN
      UPDATE erp_private.bambu_sync_queue SET request_id=NULL,dispatched_at=NULL,next_attempt_at=now()+interval '5 minutes' WHERE bambu_device_id=q.bambu_device_id;
      UPDATE bambu_sync_state SET status='disabled',last_error_code='disconnected',last_error='Conexão Bambu desativada. Conecte novamente para sincronizar.',updated_at=now() WHERE bambu_device_id=q.bambu_device_id;
    ELSIF response.status_code IS NULL OR coalesce(response.timed_out,false) OR response.error_msg IS NOT NULL THEN
      PERFORM erp_private.bambu_sync_fail(q.bambu_device_id,'network_error','A Bambu não respondeu a tempo. Uma nova tentativa será feita automaticamente.');
    ELSIF response.status_code IN (401,403) THEN
      PERFORM erp_private.bambu_sync_fail(q.bambu_device_id,'auth_required','A Bambu recusou a autorização. Reconecte sua conta Bambu.',response.status_code);
    ELSIF response.status_code=429 THEN
      PERFORM erp_private.bambu_sync_fail(q.bambu_device_id,'rate_limited','A Bambu limitou as consultas. Aguarde a próxima tentativa automática.',response.status_code);
    ELSIF response.status_code<>200 THEN
      PERFORM erp_private.bambu_sync_fail(q.bambu_device_id,'http_error','A Bambu retornou uma falha ao consultar o histórico. A sincronização será tentada novamente.',response.status_code);
    ELSE
      -- One bad task (or a rejected ERP reconciliation trigger) rolls back the
      -- whole response. Never report a partial page as a successful import.
      BEGIN
        data:=response.content::jsonb;
        IF jsonb_typeof(data->'hits') IS DISTINCT FROM 'array' OR jsonb_array_length(data->'hits')>500 THEN
          RAISE EXCEPTION 'Página Bambu inválida.';
        END IF;
        task_count:=0;
        FOR task IN SELECT value FROM jsonb_array_elements(data->'hits') LOOP
          task_id:=nullif(btrim(task->>'id'),'');
          IF jsonb_typeof(task)<>'object' OR jsonb_typeof(task->'id') NOT IN ('string','number') OR task_id IS NULL OR length(task_id)>200 THEN RAISE EXCEPTION 'Tarefa Bambu sem identificador válido.'; END IF;
          IF EXISTS(SELECT 1 FROM bambu_tasks WHERE tenant_id=q.tenant_id AND bambu_task_id=task_id
            AND bambu_device_id IS NOT NULL AND bambu_device_id<>q.bambu_device_id) THEN RAISE EXCEPTION 'Tarefa vinculada a outra impressora.'; END IF;
          grams:=erp_private.bambu_sync_number(task->'weight'); seconds:=erp_private.bambu_sync_number(task->'costTime');
          IF seconds IS NOT NULL AND (seconds<>trunc(seconds) OR seconds>2147483647) THEN RAISE EXCEPTION 'Tempo Bambu inválido.'; END IF;
          INSERT INTO bambu_tasks AS existing(tenant_id,bambu_device_id,bambu_task_id,design_title,status,start_time,end_time,weight_grams,cost_time_seconds,cover_url,raw_data,synced_at)
            VALUES(q.tenant_id,q.bambu_device_id,task_id,nullif(task->>'title',''),task->>'status',
              erp_private.bambu_sync_timestamp(task->'startTime'),erp_private.bambu_sync_timestamp(task->'endTime'),grams,seconds::integer,
              nullif(task->>'cover',''),task-ARRAY['access_token','accessToken','token','Authorization','authorization','headers'],now())
            ON CONFLICT(tenant_id,bambu_task_id) DO UPDATE SET
              bambu_device_id=coalesce(existing.bambu_device_id,excluded.bambu_device_id),design_title=excluded.design_title,
              status=excluded.status,start_time=excluded.start_time,end_time=excluded.end_time,
              weight_grams=excluded.weight_grams,cost_time_seconds=excluded.cost_time_seconds,
              cover_url=excluded.cover_url,raw_data=excluded.raw_data,synced_at=excluded.synced_at;
          -- No job_id, printer counters, costs or accounting fields are written.
          -- A separate tenant-safe ERP trigger may reconcile the upsert.
          task_count:=task_count+1;
        END LOOP;
        UPDATE erp_private.bambu_sync_queue SET request_id=NULL,dispatched_at=NULL,attempts=0,
          next_attempt_at=greatest(now(),q.last_attempt_at+interval '5 minutes') WHERE bambu_device_id=q.bambu_device_id;
        UPDATE bambu_sync_state SET status='success',last_success_at=now(),tasks_received=task_count,history_may_be_truncated=task_count=500,
          next_attempt_at=greatest(now(),q.last_attempt_at+interval '5 minutes'),last_error_code=NULL,last_error=NULL,http_status=200,updated_at=now()
          WHERE bambu_device_id=q.bambu_device_id;
        UPDATE bambu_connections SET last_sync_at=now() WHERE id=q.connection_id AND tenant_id=q.tenant_id;
      EXCEPTION WHEN OTHERS THEN
        -- Do not expose response text or SQLERRM: either may contain private data.
        PERFORM erp_private.bambu_sync_fail(q.bambu_device_id,'invalid_data','O histórico recebido não pôde ser importado por completo. Confira os dados e o vínculo da impressora.',200);
      END;
    END IF;
    DELETE FROM net._http_response WHERE id=q.request_id;
    DELETE FROM net.http_request_queue WHERE id=q.request_id;
  END LOOP;
  RETURN processed;
END $$;

CREATE FUNCTION erp_private.bambu_sync_dispatch(p_tenant uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q record; connection bambu_connections; device bambu_devices; request bigint; dispatched integer:=0;
BEGIN
  IF to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN RETURN 0; END IF;
  FOR q IN SELECT queue.* FROM erp_private.bambu_sync_queue queue
    WHERE queue.request_id IS NULL AND queue.next_attempt_at<=now()
      AND (queue.last_attempt_at IS NULL OR queue.last_attempt_at<=now()-interval '5 minutes')
      AND (p_tenant IS NULL OR queue.tenant_id=p_tenant)
    ORDER BY queue.next_attempt_at LIMIT 25 FOR UPDATE SKIP LOCKED LOOP
    SELECT * INTO device FROM bambu_devices WHERE id=q.bambu_device_id AND tenant_id=q.tenant_id;
    SELECT * INTO connection FROM bambu_connections WHERE id=device.connection_id AND tenant_id=q.tenant_id FOR UPDATE;
    IF NOT FOUND OR NOT connection.is_active THEN
      UPDATE bambu_sync_state SET status='disabled',last_error_code='disconnected',last_error='Conexão Bambu desativada. Conecte novamente para sincronizar.',updated_at=now() WHERE bambu_device_id=q.bambu_device_id;
      UPDATE erp_private.bambu_sync_queue SET next_attempt_at=now()+interval '5 minutes' WHERE bambu_device_id=q.bambu_device_id;
      CONTINUE;
    END IF;
    UPDATE erp_private.bambu_sync_queue SET attempts=attempts+1,last_attempt_at=now(),connection_id=connection.id WHERE bambu_device_id=q.bambu_device_id;
    UPDATE bambu_sync_state SET connection_id=connection.id,last_attempt_at=now(),updated_at=now() WHERE bambu_device_id=q.bambu_device_id;
    IF nullif(btrim(connection.access_token_encrypted),'') IS NULL THEN
      PERFORM erp_private.bambu_sync_fail(q.bambu_device_id,'auth_required','Reconecte sua conta Bambu para autorizar a sincronização.');
      CONTINUE;
    END IF;
    BEGIN
      -- Constant origin/path; device id is an encoded query parameter, never a URL.
      SELECT net.http_get(url:='https://api.bambulab.com/v1/user-service/my/tasks',
        params:=jsonb_build_object('deviceId',device.dev_id,'limit',500),
        headers:=jsonb_build_object('Authorization','Bearer '||connection.access_token_encrypted,'Accept','application/json'),
        timeout_milliseconds:=15000) INTO request;
      IF request IS NULL THEN RAISE EXCEPTION 'Requisição indisponível.'; END IF;
      UPDATE erp_private.bambu_sync_queue SET request_id=request,dispatched_at=now(),next_attempt_at=now()+interval '5 minutes' WHERE bambu_device_id=q.bambu_device_id;
      UPDATE bambu_sync_state SET status='syncing',last_requested_at=coalesce(last_requested_at,now()),
        next_attempt_at=now()+interval '5 minutes',last_error_code=NULL,last_error=NULL,http_status=NULL,updated_at=now() WHERE bambu_device_id=q.bambu_device_id;
      dispatched:=dispatched+1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM erp_private.bambu_sync_fail(q.bambu_device_id,'dispatch_error','Não foi possível iniciar a consulta Bambu. Uma nova tentativa será feita automaticamente.');
    END;
  END LOOP;
  RETURN dispatched;
END $$;

CREATE FUNCTION public.request_bambu_sync() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); dispatched integer; devices integer; pending integer; next_at timestamptz;
BEGIN
  IF to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN
    RETURN jsonb_build_object('status','unavailable','queued',0,'devices',0,'next_attempt_at',NULL);
  END IF;
  PERFORM erp_private.bambu_sync_seed(t);
  PERFORM erp_private.bambu_sync_process(t);
  UPDATE bambu_sync_state SET last_requested_at=now(),status=CASE WHEN status='idle' THEN 'queued' ELSE status END,updated_at=now()
    WHERE tenant_id=t AND EXISTS(SELECT 1 FROM bambu_connections c WHERE c.id=connection_id AND c.is_active);
  dispatched:=erp_private.bambu_sync_dispatch(t);
  SELECT count(*)::integer,count(*) FILTER(WHERE q.request_id IS NOT NULL)::integer,min(q.next_attempt_at)
    INTO devices,pending,next_at FROM erp_private.bambu_sync_queue q JOIN bambu_connections c ON c.id=q.connection_id
    WHERE q.tenant_id=t AND c.is_active;
  RETURN jsonb_build_object('status',CASE WHEN devices=0 THEN 'unavailable' WHEN dispatched>0 THEN 'queued' WHEN pending>0 THEN 'syncing' ELSE 'cooldown' END,
    'queued',dispatched,'devices',devices,'next_attempt_at',next_at);
END $$;

CREATE FUNCTION erp_private.bambu_sync_tick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM erp_private.bambu_sync_seed();
  PERFORM erp_private.bambu_sync_process();
  PERFORM erp_private.bambu_sync_dispatch();
END $$;

REVOKE ALL ON FUNCTION public.request_bambu_sync() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_bambu_sync() TO authenticated;
REVOKE ALL ON FUNCTION erp_private.bambu_sync_seed(uuid),erp_private.bambu_sync_fail(uuid,text,text,integer),
  erp_private.bambu_sync_timestamp(jsonb),erp_private.bambu_sync_number(jsonb),
  erp_private.bambu_sync_process(uuid),erp_private.bambu_sync_dispatch(uuid),erp_private.bambu_sync_tick() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE legacy record; BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    PERFORM cron.schedule('bambu-direct-sync','* * * * *','SELECT erp_private.bambu_sync_tick();');
    FOR legacy IN SELECT jobid FROM cron.job WHERE jobname='bambu-hourly-sync' LOOP
      PERFORM cron.alter_job(job_id:=legacy.jobid,active:=false);
    END LOOP;
  END IF;
END $$;
