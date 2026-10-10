-- Shopee reuses the durable inbox and account lease; its shop identity is separate from ML seller identity.
CREATE FUNCTION public.persist_shopee_credentials(p_account_id uuid,p_lease uuid,p_shop_id text,p_access_token text,p_refresh_token text,p_expires_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a marketplace_accounts;
BEGIN
 SELECT * INTO a FROM marketplace_accounts WHERE id=p_account_id FOR UPDATE;
 IF a.id IS NULL OR a.channel<>'shopee' OR a.sync_lock_id IS DISTINCT FROM p_lease OR a.sync_locked_until IS NULL OR a.sync_locked_until<now() OR p_lease IS NULL THEN RAISE EXCEPTION 'A autorização Shopee perdeu sua reserva de execução. Inicie novamente.'; END IF;
 IF coalesce(p_shop_id,'') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'A identificação da loja Shopee é inválida.'; END IF;
 IF p_shop_id::numeric>9007199254740991 OR (a.external_seller_id IS NOT NULL AND a.external_seller_id<>p_shop_id) THEN RAISE EXCEPTION 'A autorização Shopee pertence a outra loja ou identifica uma loja inválida.'; END IF;
 IF length(coalesce(p_access_token,'')) NOT BETWEEN 1 AND 16384 OR length(coalesce(p_refresh_token,'')) NOT BETWEEN 1 AND 16384 OR p_expires_at IS NULL OR NOT isfinite(p_expires_at) OR p_expires_at<=now() THEN RAISE EXCEPTION 'Credenciais Shopee incompletas ou expiradas.'; END IF;
 INSERT INTO marketplace_credentials(account_id,access_token,refresh_token,expires_at) VALUES(a.id,p_access_token,p_refresh_token,p_expires_at)
 ON CONFLICT(account_id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,updated_at=now();
 UPDATE marketplace_accounts SET external_seller_id=p_shop_id,connection_state='connected',updated_at=now() WHERE id=a.id;
END $$;
REVOKE ALL ON FUNCTION public.persist_shopee_credentials(uuid,uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_shopee_credentials(uuid,uuid,text,text,text,timestamptz) TO service_role;

-- A timed-out request must not mark a newer authorization invalid after its lease expired.
CREATE FUNCTION public.mark_shopee_reauthorization_required(p_account_id uuid,p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE marketplace_accounts SET connection_state='reauthorization_required',updated_at=now()
 WHERE id=p_account_id AND channel='shopee' AND sync_lock_id=p_lease AND sync_locked_until>now() AND p_lease IS NOT NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.mark_shopee_reauthorization_required(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_shopee_reauthorization_required(uuid,uuid) TO service_role;
