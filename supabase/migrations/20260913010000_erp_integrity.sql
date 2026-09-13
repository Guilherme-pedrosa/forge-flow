-- ERP integrity: all business operations execute in one PostgreSQL transaction.
-- Existing balances/history are preserved. No credentials or external calls.
CREATE SCHEMA IF NOT EXISTS erp_private;
REVOKE ALL ON SCHEMA erp_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.erp_can_write(financial boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles r JOIN profiles p ON p.user_id = r.user_id AND p.tenant_id = r.tenant_id
    WHERE r.user_id = auth.uid() AND r.role IN ('owner','admin','manager')
      OR (NOT financial AND r.user_id = auth.uid() AND r.role = 'operator'))
$$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles r JOIN profiles p ON p.user_id=r.user_id AND p.tenant_id=r.tenant_id
    WHERE r.user_id=_user_id AND r.role=_role)
$$;
CREATE FUNCTION erp_private.actor(financial boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR t IS NULL OR NOT erp_can_write(financial) THEN
    RAISE EXCEPTION 'Seu perfil não tem permissão para esta operação.' USING ERRCODE='42501';
  END IF;
  RETURN t;
END $$;
CREATE FUNCTION erp_private.valid_number(n numeric, minimum numeric DEFAULT 0) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT n IS NOT NULL AND n::text NOT IN ('NaN','Infinity','-Infinity') AND n >= minimum $$;
CREATE FUNCTION erp_private.today(t uuid) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT (now() AT TIME ZONE timezone)::date FROM tenants WHERE id=t
$$;
CREATE TABLE erp_private.document_numbers(tenant_id uuid REFERENCES public.tenants(id),prefix text,year integer,number bigint NOT NULL,PRIMARY KEY(tenant_id,prefix,year));
CREATE FUNCTION erp_private.next_code(t uuid,p_prefix text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE y integer:=extract(year FROM erp_private.today(t)); n bigint;
BEGIN
  INSERT INTO erp_private.document_numbers AS numbers(tenant_id,prefix,year,number) VALUES(t,p_prefix,y,1)
    ON CONFLICT(tenant_id,prefix,year) DO UPDATE SET number=numbers.number+1 RETURNING number INTO n;
  RETURN p_prefix||'-'||y::text||'-'||lpad(n::text,greatest(6,length(n::text)),'0');
END $$;
CREATE FUNCTION erp_private.assert_ref(table_name text, record_id uuid, tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ok boolean;
BEGIN
  IF record_id IS NULL THEN RETURN; END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id=$1 AND tenant_id=$2)',table_name) INTO ok USING record_id,tenant;
  IF NOT ok THEN RAISE EXCEPTION 'Vínculo inválido ou de outra empresa (%).',table_name; END IF;
END $$;

-- Stable request identity protects retries, double taps and concurrent submissions.
CREATE TABLE erp_private.requests (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id), request_id uuid NOT NULL,
  operation text NOT NULL, payload jsonb NOT NULL, result_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,request_id)
);
CREATE FUNCTION erp_private.begin_request(t uuid, r uuid, op text, payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE previous erp_private.requests;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'Identificador da operação é obrigatório.'; END IF;
  INSERT INTO erp_private.requests(tenant_id,request_id,operation,payload) VALUES(t,r,op,payload) ON CONFLICT DO NOTHING;
  SELECT * INTO previous FROM erp_private.requests WHERE tenant_id=t AND request_id=r FOR UPDATE;
  IF previous.operation <> op OR previous.payload <> payload THEN RAISE EXCEPTION 'Identificador já utilizado por outra operação.'; END IF;
  RETURN previous.result_id;
END $$;
CREATE FUNCTION erp_private.finish_request(t uuid,r uuid,result uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE erp_private.requests SET result_id=result WHERE tenant_id=t AND request_id=r
$$;

-- A profile is not a self-service route into another company's tenant.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE FUNCTION public.erp_immutable_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN RAISE EXCEPTION 'A empresa do registro não pode ser alterada.'; END IF;
  IF TG_TABLE_NAME='profiles' AND (to_jsonb(NEW)->>'user_id') IS DISTINCT FROM (to_jsonb(OLD)->>'user_id') THEN
    RAISE EXCEPTION 'A identidade do perfil não pode ser alterada.';
  END IF;
  RETURN NEW;
END $$;

-- Enforce tenant agreement on every actual public foreign key (RLS alone does not).
CREATE FUNCTION public.erp_check_tenant_references() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fk record; ref uuid;
BEGIN
  FOR fk IN
    SELECT a.attname col, c.confrelid::regclass::text relation
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    JOIN pg_namespace ns ON ns.oid=(SELECT relnamespace FROM pg_class WHERE oid=c.confrelid)
    WHERE c.contype='f' AND c.conrelid=TG_RELID AND cardinality(c.conkey)=1 AND ns.nspname='public'
      AND EXISTS(SELECT 1 FROM pg_attribute b WHERE b.attrelid=c.confrelid AND b.attname='tenant_id' AND NOT b.attisdropped)
  LOOP
    ref := nullif(to_jsonb(NEW)->>fk.col,'')::uuid;
    PERFORM erp_private.assert_ref(replace(fk.relation,'public.',''),ref,NEW.tenant_id);
  END LOOP;
  RETURN NEW;
END $$;
DO $$ DECLARE t record; fin boolean;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' LOOP
    EXECUTE format('CREATE TRIGGER erp_tenant_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_immutable_tenant()',t.table_name);
    EXECUTE format('CREATE TRIGGER erp_tenant_references BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_check_tenant_references()',t.table_name);
    IF t.table_name NOT IN ('profiles','user_roles','audit_log') THEN
      fin := t.table_name IN ('accounts_payable','accounts_receivable','bank_accounts','bank_transactions','chart_of_accounts','payment_methods','purchase_orders','purchase_order_items','bambu_connections');
      EXECUTE format('CREATE POLICY erp_write_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (erp_can_write(%L))',t.table_name,fin);
      EXECUTE format('CREATE POLICY erp_write_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (erp_can_write(%L)) WITH CHECK (erp_can_write(%L))',t.table_name,fin,fin);
      EXECUTE format('CREATE POLICY erp_write_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (erp_can_write(%L))',t.table_name,fin);
    END IF;
  END LOOP;
END $$;

ALTER TABLE inventory_items ALTER current_stock TYPE numeric(18,6), ALTER min_stock TYPE numeric(18,6), ALTER avg_cost TYPE numeric(18,8), ALTER last_cost TYPE numeric(18,8);
ALTER TABLE inventory_movements ALTER quantity TYPE numeric(18,6), ALTER stock_after TYPE numeric(18,6), ALTER unit_cost TYPE numeric(18,8);
ALTER TABLE purchase_order_items ADD COLUMN stock_quantity numeric(18,6);
ALTER TABLE purchase_orders ADD COLUMN additional_costs numeric NOT NULL DEFAULT 0;
ALTER TABLE accounts_payable ADD COLUMN origin_type text, ADD COLUMN origin_id uuid;
ALTER TABLE jobs ADD COLUMN inventory_posted_at timestamptz, ADD COLUMN secondary_actual_grams numeric(12,4), ADD COLUMN order_item_id uuid REFERENCES order_items(id), ADD COLUMN order_unit_index integer,
  ADD COLUMN est_extras_cost numeric(14,2), ADD COLUMN actual_extras_cost numeric(14,2);
ALTER TABLE orders ADD COLUMN shipping numeric NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX jobs_order_unit_unique ON jobs(order_item_id,order_unit_index) WHERE order_item_id IS NOT NULL AND reprint_of IS NULL;
CREATE UNIQUE INDEX jobs_reprint_unique ON jobs(reprint_of) WHERE reprint_of IS NOT NULL;
CREATE UNIQUE INDEX purchase_nfe_unique ON purchase_orders(tenant_id,nfe_key) WHERE nullif(btrim(nfe_key),'') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_inventory_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item inventory_items; delta numeric; balance numeric; unit_cost numeric; average numeric;
BEGIN
  SELECT * INTO item FROM inventory_items WHERE id=NEW.item_id AND tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND OR NOT item.is_active THEN RAISE EXCEPTION 'Material inválido, inativo ou de outra empresa.'; END IF;
  IF NEW.quantity IS NULL OR NEW.quantity::text IN ('NaN','Infinity','-Infinity') OR NEW.quantity=0
     OR (NEW.movement_type<>'adjustment' AND NEW.quantity<0) THEN RAISE EXCEPTION 'Quantidade inválida para a movimentação.'; END IF;
  IF NEW.movement_type IN ('adjustment','loss') AND nullif(btrim(NEW.notes),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do ajuste ou perda.'; END IF;
  delta := CASE WHEN NEW.movement_type IN ('job_consumption','loss','maintenance') THEN -NEW.quantity ELSE NEW.quantity END;
  balance := item.current_stock+delta;
  IF balance<0 THEN RAISE EXCEPTION 'Estoque insuficiente para %: saldo % %, saída % %.',item.name,item.current_stock,item.unit,abs(delta),item.unit; END IF;
  unit_cost := CASE WHEN NEW.movement_type='purchase_in' THEN NEW.unit_cost ELSE item.avg_cost END;
  IF NOT erp_private.valid_number(unit_cost) THEN RAISE EXCEPTION 'Informe um custo unitário válido.'; END IF;
  average := item.avg_cost;
  IF delta>0 AND NEW.movement_type='purchase_in' THEN average := (item.current_stock*item.avg_cost+delta*unit_cost)/balance; END IF;
  NEW.unit_cost := unit_cost; NEW.total_cost := round(abs(NEW.quantity)*unit_cost,2); NEW.stock_after:=balance;
  NEW.created_by:=coalesce(auth.uid(),NEW.created_by);
  UPDATE inventory_items SET current_stock=balance,avg_cost=average,last_cost=CASE WHEN NEW.movement_type='purchase_in' THEN unit_cost ELSE last_cost END WHERE id=item.id;
  RETURN NEW;
END $$;
CREATE FUNCTION public.erp_guard_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS(SELECT 1 FROM public.inventory_movements WHERE item_id=OLD.id) THEN
    RAISE EXCEPTION 'Material com histórico não pode mudar de unidade. Cadastre outro item.';
  END IF;
  IF current_user IN ('authenticated','anon') THEN
    IF TG_OP='INSERT' AND NEW.current_stock<>0 THEN RAISE EXCEPTION 'Cadastre o saldo pela movimentação de entrada.'; END IF;
    IF TG_OP='UPDATE' AND (NEW.current_stock,NEW.avg_cost,NEW.last_cost) IS DISTINCT FROM (OLD.current_stock,OLD.avg_cost,OLD.last_cost) THEN
      RAISE EXCEPTION 'Saldo e custo são calculados pelas movimentações de estoque.';
    END IF;
  END IF;
  IF NOT erp_private.valid_number(NEW.current_stock) OR NOT erp_private.valid_number(NEW.min_stock) OR NOT erp_private.valid_number(NEW.avg_cost) OR NOT erp_private.valid_number(NEW.loss_coefficient) OR NEW.loss_coefficient>1 THEN
    RAISE EXCEPTION 'Saldo, custo e coeficiente de perda inválidos.';
  END IF;
  RETURN NEW;
END $$;
-- Trigger must be able to validate without exposing the private helper schema.
GRANT USAGE ON SCHEMA erp_private TO authenticated;
GRANT EXECUTE ON FUNCTION erp_private.valid_number(numeric,numeric) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC;
CREATE TRIGGER erp_inventory_guard BEFORE INSERT OR UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION erp_guard_inventory();

CREATE FUNCTION public.erp_bank_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.type NOT IN ('credit','debit') OR NOT erp_private.valid_number(NEW.amount,0.01) THEN RAISE EXCEPTION 'Lançamento bancário inválido.'; END IF;
  PERFORM 1 FROM bank_accounts WHERE id=NEW.bank_account_id AND tenant_id=NEW.tenant_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta bancária inválida ou inativa.'; END IF;
  UPDATE bank_accounts SET current_balance=current_balance+CASE WHEN NEW.type='credit' THEN NEW.amount ELSE -NEW.amount END WHERE id=NEW.bank_account_id;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_bank_post AFTER INSERT ON bank_transactions FOR EACH ROW EXECUTE FUNCTION erp_bank_ledger();
CREATE FUNCTION public.erp_guard_bank() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.initial_balance IS NULL OR NEW.initial_balance::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Saldo inicial deve ser um número finito.'; END IF;
  IF TG_OP='INSERT' THEN NEW.current_balance:=NEW.initial_balance;
  ELSIF current_user IN ('authenticated','anon') AND (NEW.current_balance IS DISTINCT FROM OLD.current_balance OR NEW.initial_balance IS DISTINCT FROM OLD.initial_balance) THEN
    RAISE EXCEPTION 'Saldo é alterado por lançamentos. Não edite o saldo inicial de uma conta cadastrada.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_bank_guard BEFORE INSERT OR UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION erp_guard_bank();
DROP POLICY bt_i ON bank_transactions;
CREATE FUNCTION public.erp_guard_bank_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['is_reconciled','memo','ofx_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_reconciled','memo','ofx_id']) THEN
    RAISE EXCEPTION 'Lançamentos bancários são históricos; registre um novo lançamento de correção.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_bank_transaction_guard BEFORE UPDATE ON bank_transactions FOR EACH ROW EXECUTE FUNCTION erp_guard_bank_transaction();

CREATE FUNCTION public.register_bank_transaction(p_bank_account_id uuid,p_type text,p_amount numeric,p_date date,p_description text,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'bank_transaction',jsonb_build_array(p_bank_account_id,p_type,p_amount,p_date,p_description));
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF p_type NOT IN ('credit','debit') OR NOT erp_private.valid_number(p_amount,0.01) OR p_amount<>round(p_amount,2) OR p_date IS NULL OR p_date>erp_private.today(t) OR nullif(btrim(p_description),'') IS NULL THEN
    RAISE EXCEPTION 'Informe tipo, valor em centavos, data não futura e descrição.';
  END IF;
  INSERT INTO bank_transactions(tenant_id,bank_account_id,type,amount,transaction_date,description) VALUES(t,p_bank_account_id,p_type,p_amount,p_date,btrim(p_description)) RETURNING id INTO result;
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.settle_financial_title(p_kind text,p_title_id uuid,p_amount numeric,p_date date,p_bank_account_id uuid,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; a accounts_payable; r accounts_receivable; remaining numeric; label text;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'settlement',jsonb_build_array(p_kind,p_title_id,p_amount,p_date,p_bank_account_id));
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF NOT erp_private.valid_number(p_amount,0.01) OR p_amount<>round(p_amount,2) OR p_date IS NULL OR p_date>erp_private.today(t) THEN RAISE EXCEPTION 'Valor e data de baixa inválidos.'; END IF;
  IF p_kind='payable' THEN
    SELECT * INTO a FROM accounts_payable WHERE id=p_title_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND OR a.status='cancelled' THEN RAISE EXCEPTION 'Conta a pagar inválida ou cancelada.'; END IF;
    remaining:=a.amount-a.amount_paid; label:=a.description;
  ELSIF p_kind='receivable' THEN
    SELECT * INTO r FROM accounts_receivable WHERE id=p_title_id AND tenant_id=t FOR UPDATE;
    IF NOT FOUND OR r.status='reversed' THEN RAISE EXCEPTION 'Conta a receber inválida ou estornada.'; END IF;
    remaining:=r.amount-r.amount_received; label:=r.description;
  ELSE RAISE EXCEPTION 'Tipo de título inválido.'; END IF;
  IF p_amount>remaining THEN RAISE EXCEPTION 'O valor supera o saldo pendente de %.',remaining; END IF;
  INSERT INTO bank_transactions(tenant_id,bank_account_id,type,amount,transaction_date,description,reference_type,reference_id)
    VALUES(t,p_bank_account_id,CASE WHEN p_kind='payable' THEN 'debit' ELSE 'credit' END,p_amount,p_date,label,
      CASE WHEN p_kind='payable' THEN 'accounts_payable' ELSE 'accounts_receivable' END,p_title_id) RETURNING id INTO result;
  IF p_kind='payable' THEN
    UPDATE accounts_payable SET amount_paid=amount_paid+p_amount,status=CASE WHEN p_amount=remaining THEN 'paid'::payable_status ELSE 'partial'::payable_status END,payment_date=p_date,bank_account_id=p_bank_account_id WHERE id=p_title_id;
  ELSE
    UPDATE accounts_receivable SET amount_received=amount_received+p_amount,status=CASE WHEN p_amount=remaining THEN 'received'::receivable_status ELSE 'partial'::receivable_status END,receipt_date=p_date,bank_account_id=p_bank_account_id WHERE id=p_title_id;
  END IF;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'settle',CASE WHEN p_kind='payable' THEN 'accounts_payable' ELSE 'accounts_receivable' END,p_title_id,jsonb_build_object('amount',p_amount,'bank_transaction',result));
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.erp_guard_financial_title() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_paid numeric:=coalesce((to_jsonb(OLD)->>'amount_paid')::numeric,(to_jsonb(OLD)->>'amount_received')::numeric,0);
  new_paid numeric:=coalesce((to_jsonb(NEW)->>'amount_paid')::numeric,(to_jsonb(NEW)->>'amount_received')::numeric,0);
BEGIN
  IF TG_OP='DELETE' THEN
    IF old_paid>0 OR OLD.origin_id IS NOT NULL THEN RAISE EXCEPTION 'Título com baixa ou origem vinculada não pode ser excluído.'; END IF;
    RETURN OLD;
  END IF;
  IF NOT erp_private.valid_number(NEW.amount,0.01) OR NOT erp_private.valid_number(new_paid) OR new_paid>NEW.amount THEN RAISE EXCEPTION 'Valores do título inválidos.'; END IF;
  IF current_user IN ('authenticated','anon') THEN
    IF TG_OP='INSERT' AND (new_paid<>0 OR NEW.status::text NOT IN ('open','overdue')) THEN RAISE EXCEPTION 'Cadastre o título em aberto e use a operação de baixa.'; END IF;
    IF TG_OP='UPDATE' AND (new_paid<>old_paid OR NEW.status::text IN ('paid','received') AND new_paid<NEW.amount OR (old_paid>0 AND (NEW.amount,NEW.status::text) IS DISTINCT FROM (OLD.amount,OLD.status::text))) THEN RAISE EXCEPTION 'Use a operação de baixa. Histórico financeiro não pode ser sobrescrito.'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER erp_payable_guard BEFORE INSERT OR UPDATE OR DELETE ON accounts_payable FOR EACH ROW EXECUTE FUNCTION erp_guard_financial_title();
CREATE TRIGGER erp_receivable_guard BEFORE INSERT OR UPDATE OR DELETE ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION erp_guard_financial_title();

CREATE FUNCTION public.create_purchase_order(p_order jsonb,p_items jsonb,p_installments jsonb,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); result uuid; item jsonb; part jsonb; subtotal numeric:=0; installments numeric:=0; total numeric; discount numeric; shipping numeric; other_costs numeric; qty numeric; price numeric; stock numeric;
BEGIN
  result:=erp_private.begin_request(t,p_request_id,'purchase',jsonb_build_array(p_order,p_items,p_installments));
  IF result IS NOT NULL THEN RETURN result; END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>500 OR jsonb_typeof(p_installments)<>'array' OR jsonb_array_length(p_installments)>120 THEN RAISE EXCEPTION 'Itens e parcelas inválidos.'; END IF;
  discount:=coalesce((p_order->>'discount')::numeric,0); shipping:=coalesce((p_order->>'shipping')::numeric,0); total:=(p_order->>'total')::numeric;
  other_costs:=coalesce((p_order->>'additional_costs')::numeric,0);
  IF other_costs::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Outros componentes do total inválidos.'; END IF;
  IF NOT erp_private.valid_number(discount) OR NOT erp_private.valid_number(shipping) OR NOT erp_private.valid_number(total,0.01) OR nullif(p_order->>'order_date','') IS NULL THEN RAISE EXCEPTION 'Valores ou data da compra inválidos.'; END IF;
  PERFORM erp_private.assert_ref('vendors',nullif(p_order->>'vendor_id','')::uuid,t);
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    qty:=(item->>'quantity')::numeric; price:=(item->>'unit_price')::numeric; stock:=nullif(item->>'stock_quantity','')::numeric;
    IF NOT erp_private.valid_number(qty,0.000001) OR NOT erp_private.valid_number(price) OR nullif(btrim(item->>'description'),'') IS NULL OR (item->>'total')::numeric IS DISTINCT FROM round(qty*price,2) THEN RAISE EXCEPTION 'Quantidade, preço ou total de item inválido.'; END IF;
    IF stock IS NOT NULL AND NOT erp_private.valid_number(stock,0.000001) THEN RAISE EXCEPTION 'Conversão de estoque inválida.'; END IF;
    PERFORM erp_private.assert_ref('inventory_items',nullif(item->>'inventory_item_id','')::uuid,t);
    subtotal:=subtotal+round(qty*price,2);
  END LOOP;
  IF subtotal IS DISTINCT FROM (p_order->>'subtotal')::numeric OR total<>round(subtotal-discount+shipping+other_costs,2) OR discount>subtotal THEN RAISE EXCEPTION 'Total da compra não confere com itens, desconto, frete e outros componentes.'; END IF;
  FOR part IN SELECT value FROM jsonb_array_elements(p_installments) LOOP
    IF NOT erp_private.valid_number((part->>'amount')::numeric,0.01) OR nullif(part->>'due_date','') IS NULL THEN RAISE EXCEPTION 'Parcela inválida.'; END IF;
    PERFORM erp_private.assert_ref('payment_methods',nullif(part->>'payment_method_id','')::uuid,t);
    installments:=installments+round((part->>'amount')::numeric,2);
  END LOOP;
  IF jsonb_array_length(p_installments)>0 AND installments<>total THEN RAISE EXCEPTION 'A soma das parcelas deve ser igual ao total da compra.'; END IF;
  result:=gen_random_uuid();
  INSERT INTO purchase_orders(id,tenant_id,code,vendor_id,status,order_date,expected_date,subtotal,discount,shipping,additional_costs,total,nfe_number,nfe_key,nfe_xml,notes,created_by)
    VALUES(result,t,erp_private.next_code(t,'CMP'),nullif(p_order->>'vendor_id','')::uuid,'pending',(p_order->>'order_date')::date,nullif(p_order->>'expected_date','')::date,subtotal,discount,shipping,other_costs,total,nullif(p_order->>'nfe_number',''),nullif(btrim(p_order->>'nfe_key'),''),p_order->>'nfe_xml',p_order->>'notes',auth.uid());
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO purchase_order_items(tenant_id,purchase_order_id,inventory_item_id,description,quantity,unit_price,total,cfop,ncm,notes,stock_quantity)
      VALUES(t,result,nullif(item->>'inventory_item_id','')::uuid,btrim(item->>'description'),(item->>'quantity')::numeric,(item->>'unit_price')::numeric,(item->>'total')::numeric,item->>'cfop',item->>'ncm',item->>'notes',nullif(item->>'stock_quantity','')::numeric);
  END LOOP;
  FOR part IN SELECT value FROM jsonb_array_elements(p_installments) LOOP
    INSERT INTO accounts_payable(tenant_id,vendor_id,description,amount,due_date,competence_date,payment_method_id,installment_number,installment_total,notes,created_by,origin_type,origin_id)
      VALUES(t,nullif(p_order->>'vendor_id','')::uuid,coalesce(nullif(btrim(part->>'description'),''),'Compra '||substr(result::text,1,8)),round((part->>'amount')::numeric,2),(part->>'due_date')::date,(p_order->>'order_date')::date,nullif(part->>'payment_method_id','')::uuid,coalesce((part->>'installment_number')::integer,1),coalesce((part->>'installment_total')::integer,1),part->>'notes',auth.uid(),'purchase_order',result);
  END LOOP;
  PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;

CREATE FUNCTION public.receive_purchase_order(p_order_id uuid,p_received_date date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); po purchase_orders; item purchase_order_items;
BEGIN
  SELECT * INTO po FROM purchase_orders WHERE id=p_order_id AND tenant_id=t FOR UPDATE;
  IF NOT FOUND OR po.status='cancelled' THEN RAISE EXCEPTION 'Compra inválida ou cancelada.'; END IF;
  IF po.status='received' THEN RETURN po.id; END IF;
  IF p_received_date IS NULL OR p_received_date>erp_private.today(t) OR p_received_date<po.order_date THEN RAISE EXCEPTION 'Data de recebimento inválida.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM purchase_order_items WHERE purchase_order_id=po.id) THEN RAISE EXCEPTION 'Compra sem itens.'; END IF;
  FOR item IN SELECT * FROM purchase_order_items WHERE purchase_order_id=po.id ORDER BY inventory_item_id,id FOR UPDATE LOOP
    IF item.inventory_item_id IS NOT NULL THEN
      IF NOT erp_private.valid_number(item.stock_quantity,0.000001) OR po.subtotal<=0 THEN RAISE EXCEPTION 'Informe a quantidade convertida para a unidade de estoque de %.',item.description; END IF;
      INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,created_by)
        VALUES(t,item.inventory_item_id,'purchase_in',item.stock_quantity,(po.total*item.total/po.subtotal)/item.stock_quantity,'purchase_order',po.id,'Recebimento '||po.code,auth.uid());
    END IF;
  END LOOP;
  UPDATE purchase_orders SET status='received',received_date=p_received_date WHERE id=po.id;
  INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id) VALUES(t,auth.uid(),'receive','purchase_orders',po.id);
  RETURN po.id;
END $$;

-- API functions only for signed-in users; helper routines never become public RPCs.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.valid_number(numeric,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.register_bank_transaction(uuid,text,numeric,date,text,uuid),public.settle_financial_title(text,uuid,numeric,date,uuid,uuid),public.create_purchase_order(jsonb,jsonb,jsonb,uuid),public.receive_purchase_order(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_bank_transaction(uuid,text,numeric,date,text,uuid),public.settle_financial_title(text,uuid,numeric,date,uuid,uuid),public.create_purchase_order(jsonb,jsonb,jsonb,uuid),public.receive_purchase_order(uuid,date) TO authenticated;
