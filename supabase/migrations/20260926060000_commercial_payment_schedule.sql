ALTER TABLE sales_quotes ADD COLUMN payment_schedule jsonb NOT NULL DEFAULT '[]';
ALTER TABLE orders ADD COLUMN payment_schedule jsonb NOT NULL DEFAULT '[]';
CREATE FUNCTION erp_private.validate_payment_schedule(p_parts jsonb,p_total numeric,p_tenant uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE part jsonb; amount numeric; total numeric:=0;
BEGIN
 IF jsonb_typeof(p_parts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_parts)>120 THEN RAISE EXCEPTION 'Condições de pagamento inválidas.'; END IF;
 IF jsonb_array_length(p_parts)=0 THEN RETURN; END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
   amount:=(part->>'amount')::numeric;
   IF NOT erp_private.valid_number(amount,0.01) OR amount<>round(amount,2) OR nullif(part->>'due_date','')::date IS NULL THEN RAISE EXCEPTION 'Revise os valores e vencimentos das parcelas.'; END IF;
   PERFORM erp_private.assert_ref('payment_methods',nullif(part->>'payment_method_id','')::uuid,p_tenant);
   total:=total+amount;
 END LOOP;
 IF total IS DISTINCT FROM p_total THEN RAISE EXCEPTION 'A soma das parcelas deve ser igual ao total da venda.'; END IF;
END $$;

DO $$ DECLARE definition text; needle text; BEGIN
 definition:=pg_get_functiondef('public.save_sales_quote(uuid,jsonb,jsonb,uuid)'::regprocedure);
 needle:='''notes'',''expected_revision'']';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review quotation payment fields.'; END IF;
 EXECUTE replace(definition,needle,'''notes'',''expected_revision'',''payment_schedule'']');
END $$;
ALTER FUNCTION public.save_sales_quote(uuid,jsonb,jsonb,uuid) SET SCHEMA erp_private;
ALTER FUNCTION erp_private.save_sales_quote(uuid,jsonb,jsonb,uuid) RENAME TO save_sales_quote_before_payments;
CREATE FUNCTION public.save_sales_quote(p_quote_id uuid,p_quote jsonb,p_items jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(); result uuid; parts jsonb;
BEGIN
 result:=erp_private.begin_request(t,p_request_id,'sales_quote',jsonb_build_array(p_quote_id,p_quote,p_items));
 IF result IS NOT NULL THEN RETURN result; END IF;
 parts:=coalesce(p_quote->'payment_schedule','[]');
 PERFORM erp_private.validate_payment_schedule(parts,(p_quote->>'total')::numeric,t);
 result:=erp_private.save_sales_quote_before_payments(p_quote_id,p_quote,p_items,p_request_id);
 UPDATE sales_quotes SET payment_schedule=parts WHERE id=result;
 RETURN result;
END $$;

CREATE FUNCTION erp_private.post_order_receivables(p_order uuid,p_tenant uuid) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE o orders; parts jsonb; part jsonb; idx integer:=0; cnt integer;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order AND tenant_id=p_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
 parts:=o.payment_schedule;
 IF jsonb_array_length(parts)=0 THEN parts:=jsonb_build_array(jsonb_build_object('amount',o.total,'due_date',o.payment_due_date)); END IF;
 PERFORM erp_private.validate_payment_schedule(parts,o.total,p_tenant);cnt:=jsonb_array_length(parts);
 FOR part IN SELECT value FROM jsonb_array_elements(parts) LOOP
   idx:=idx+1;
   INSERT INTO accounts_receivable(tenant_id,customer_id,description,amount,due_date,competence_date,origin_type,origin_id,payment_method_id,created_by)
   VALUES(p_tenant,o.customer_id,'Venda '||o.code||CASE WHEN cnt>1 THEN ' ('||idx||'/'||cnt||')' ELSE '' END,(part->>'amount')::numeric,(part->>'due_date')::date,erp_private.today(p_tenant),'order',o.id,nullif(part->>'payment_method_id','')::uuid,auth.uid());
 END LOOP;
END $$;
DO $$ DECLARE definition text; needle text; BEGIN
 definition:=pg_get_functiondef('erp_private.transition_sales_order_legacy(uuid,text)'::regprocedure);
 needle:='INSERT INTO accounts_receivable(tenant_id,customer_id,description,amount,due_date,competence_date,origin_type,origin_id,created_by)';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review receivable generation.'; END IF;
 definition:=regexp_replace(definition,'INSERT INTO accounts_receivable\(tenant_id,customer_id,description,amount,due_date,competence_date,origin_type,origin_id,created_by\)[^;]+;','PERFORM erp_private.post_order_receivables(o.id,t);');
 EXECUTE definition;
 definition:=pg_get_functiondef('erp_private.convert_sales_quote_before_production(uuid,uuid)'::regprocedure);
 needle:='PERFORM public.transition_sales_order(result,''approved'');';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Review quotation conversion.'; END IF;
 EXECUTE replace(definition,needle,'UPDATE orders SET payment_schedule=q.payment_schedule WHERE id=result;'||E'\n  '||needle);
END $$;

-- Installments from an approved offer are protected like its other commercial terms.
CREATE FUNCTION public.erp_guard_order_payment_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.payment_schedule IS DISTINCT FROM OLD.payment_schedule AND OLD.status<>'draft' THEN RAISE EXCEPTION 'As condições aprovadas estão preservadas. Ajuste os títulos no financeiro.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_guard_order_payment_schedule BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION erp_guard_order_payment_schedule();
REVOKE ALL ON FUNCTION erp_private.validate_payment_schedule(jsonb,numeric,uuid),erp_private.post_order_receivables(uuid,uuid),erp_private.save_sales_quote_before_payments(uuid,jsonb,jsonb,uuid),public.erp_guard_order_payment_schedule() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_sales_quote(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_sales_quote(uuid,jsonb,jsonb,uuid) TO authenticated;
