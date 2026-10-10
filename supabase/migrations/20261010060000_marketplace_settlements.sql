-- A sale remains gross. Only actual net cash reaches the bank ledger.
-- Withheld costs settle principal by compensation; refunds are separate contra-revenue.
ALTER TABLE public.accounts_receivable ADD COLUMN marketplace_cancelled_gross numeric(14,2) NOT NULL DEFAULT 0 CHECK(marketplace_cancelled_gross>=0 AND marketplace_cancelled_gross+amount_received<=amount);
CREATE TABLE public.marketplace_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 account_id uuid NOT NULL REFERENCES marketplace_accounts(id), marketplace_order_id uuid NOT NULL REFERENCES marketplace_orders(id),
 order_id uuid NOT NULL REFERENCES orders(id), receivable_id uuid NOT NULL REFERENCES accounts_receivable(id),
 kind text NOT NULL CHECK(kind IN('payout','release','refund','hold_reversal','adjustment')), external_reference text NOT NULL,
 related_settlement_id uuid REFERENCES marketplace_settlements(id), transaction_date date NOT NULL, competence_date date NOT NULL,
 gross_amount numeric(14,2) NOT NULL CHECK(gross_amount>=0), liquidated_gross numeric(14,2) NOT NULL CHECK(liquidated_gross>=0),
 fees numeric(14,2) NOT NULL DEFAULT 0 CHECK(fees>=0), freight numeric(14,2) NOT NULL DEFAULT 0 CHECK(freight>=0),
 other_debit numeric(14,2) NOT NULL DEFAULT 0 CHECK(other_debit>=0), retained_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(retained_amount>=0),
 fee_credit numeric(14,2) NOT NULL DEFAULT 0 CHECK(fee_credit>=0), freight_credit numeric(14,2) NOT NULL DEFAULT 0 CHECK(freight_credit>=0),
 other_credit numeric(14,2) NOT NULL DEFAULT 0 CHECK(other_credit>=0), net_amount numeric(14,2) NOT NULL,
 bank_account_id uuid REFERENCES bank_accounts(id), bank_transaction_id uuid UNIQUE REFERENCES bank_transactions(id),
 notes text NOT NULL DEFAULT '', request_payload jsonb NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,external_reference), CHECK((net_amount=0) OR bank_account_id IS NOT NULL),
 CHECK((kind='adjustment' AND gross_amount=0) OR (kind<>'adjustment' AND gross_amount>0))
);
CREATE TABLE public.marketplace_settlement_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 settlement_id uuid NOT NULL REFERENCES marketplace_settlements(id),
 kind text NOT NULL CHECK(kind IN('fee','freight','other_debit','fee_credit','freight_credit','other_credit','refund')),
 amount_signed numeric(14,2) NOT NULL CHECK(amount_signed<>0), competence_date date NOT NULL,
 payable_id uuid UNIQUE REFERENCES accounts_payable(id), expense_source_settlement_id uuid REFERENCES marketplace_settlements(id),
 UNIQUE(settlement_id,kind),
 CHECK((kind IN('fee','freight','other_debit') AND amount_signed>0 AND payable_id IS NOT NULL AND expense_source_settlement_id IS NULL)
  OR (kind IN('fee_credit','freight_credit','other_credit') AND amount_signed<0 AND payable_id IS NULL AND expense_source_settlement_id IS NOT NULL)
  OR (kind='refund' AND amount_signed<0 AND payable_id IS NULL AND expense_source_settlement_id IS NULL))
);
CREATE INDEX marketplace_settlement_title ON marketplace_settlements(tenant_id,receivable_id,created_at);
CREATE FUNCTION public.erp_immutable_marketplace_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Conciliações são históricas. Registre um novo evento com origem; não sobrescreva nem exclua o lançamento.'; END $$;
DO $$ DECLARE tbl text; BEGIN
 FOR tbl IN SELECT unnest(ARRAY['marketplace_settlements','marketplace_settlement_components']) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tbl);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tbl);
  EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(tenant_id=public.get_user_tenant_id())',tbl);
  EXECUTE format('CREATE TRIGGER erp_tenant_references BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_check_tenant_references()',tbl);
  EXECUTE format('CREATE TRIGGER erp_immutable_settlement BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.erp_immutable_marketplace_settlement()',tbl);
 END LOOP;
END $$;

-- Extend the existing source contract without treating a fee as a purchase or a sale discount.
CREATE OR REPLACE FUNCTION public.erp_guard_title_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.origin_id IS NOT NULL THEN
  IF TG_TABLE_NAME='accounts_payable' AND NEW.origin_type='purchase_order' THEN PERFORM erp_private.assert_ref('purchase_orders',NEW.origin_id,NEW.tenant_id);
  ELSIF TG_TABLE_NAME='accounts_payable' AND NEW.origin_type='marketplace_settlement' THEN
   PERFORM erp_private.assert_ref('marketplace_settlements',NEW.origin_id,NEW.tenant_id);
  ELSIF TG_TABLE_NAME='accounts_receivable' AND NEW.origin_type='order' THEN PERFORM erp_private.assert_ref('orders',NEW.origin_id,NEW.tenant_id);
  ELSE RAISE EXCEPTION 'Origem financeira não reconhecida.'; END IF;
 ELSIF nullif(NEW.origin_type,'') IS NOT NULL THEN RAISE EXCEPTION 'Informe um vínculo válido para a origem financeira.'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.erp_guard_marketplace_payable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.origin_type='marketplace_settlement' THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['account_id','notes','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['account_id','notes','updated_at']) THEN RAISE EXCEPTION 'A despesa compensada do canal deve permanecer no histórico. Registre crédito com origem em Repasses.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM chart_of_accounts WHERE id=NEW.account_id AND tenant_id=NEW.tenant_id AND account_type='expense') THEN RAISE EXCEPTION 'Despesas do canal precisam de classificação de despesa.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_marketplace_payable_history BEFORE UPDATE OR DELETE ON accounts_payable FOR EACH ROW EXECUTE FUNCTION erp_guard_marketplace_payable();
CREATE FUNCTION public.erp_no_direct_marketplace_payable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.origin_type='marketplace_settlement' AND current_user IN('authenticated','anon') THEN RAISE EXCEPTION 'Use a conciliação de Repasses para registrar despesas do canal.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_no_direct_marketplace_payable BEFORE INSERT ON accounts_payable FOR EACH ROW EXECUTE FUNCTION erp_no_direct_marketplace_payable();

-- A retention can have zero cash and zero cleared principal: it is still financial history.
-- Prevent cancellation or title rewrites from making that origin disappear.
CREATE FUNCTION public.erp_guard_marketplace_receivable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cancelled numeric;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.marketplace_cancelled_gross<>0 THEN RAISE EXCEPTION 'Registre o estorno do principal retido por Repasses.'; END IF;
  RETURN NEW;
 END IF;
 SELECT coalesce(sum(gross_amount),0) INTO cancelled FROM marketplace_settlements WHERE receivable_id=OLD.id AND kind='hold_reversal';
 IF EXISTS(SELECT 1 FROM marketplace_settlements WHERE receivable_id=OLD.id) THEN
  IF TG_OP='DELETE' OR (NEW.amount,NEW.origin_type,NEW.origin_id,NEW.tenant_id) IS DISTINCT FROM (OLD.amount,OLD.origin_type,OLD.origin_id,OLD.tenant_id) OR (NEW.status='reversed' AND NOT(NEW.amount_received=0 AND cancelled=NEW.amount)) THEN
   RAISE EXCEPTION 'Recebível com conciliação do canal deve preservar o bruto e a origem. Registre estornos e libere retenções por Repasses.';
  END IF;
  IF NEW.amount_received IS DISTINCT FROM (SELECT coalesce(sum(liquidated_gross),0) FROM marketplace_settlements WHERE receivable_id=OLD.id) THEN RAISE EXCEPTION 'O bruto liquidado deve corresponder às conciliações registradas em Repasses.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.marketplace_cancelled_gross IS DISTINCT FROM cancelled THEN RAISE EXCEPTION 'O principal retido estornado deve corresponder ao histórico de Repasses.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER erp_marketplace_receivable_history BEFORE INSERT OR UPDATE OR DELETE ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION erp_guard_marketplace_receivable();

-- A closed title may combine liquidated and cancelled principal. Classification
-- must remain possible without pretending the cancelled portion was received.
CREATE OR REPLACE FUNCTION public.erp_guard_financial_title() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_paid numeric:=coalesce((to_jsonb(OLD)->>'amount_paid')::numeric,(to_jsonb(OLD)->>'amount_received')::numeric,0);
 new_paid numeric:=coalesce((to_jsonb(NEW)->>'amount_paid')::numeric,(to_jsonb(NEW)->>'amount_received')::numeric,0);
 cancelled numeric:=coalesce((to_jsonb(NEW)->>'marketplace_cancelled_gross')::numeric,0);
BEGIN
 IF TG_OP='DELETE' THEN
  IF old_paid>0 OR OLD.origin_id IS NOT NULL THEN RAISE EXCEPTION 'Título com baixa ou origem vinculada não pode ser excluído.'; END IF;
  RETURN OLD;
 END IF;
 IF NOT erp_private.valid_number(NEW.amount,0.01) OR NOT erp_private.valid_number(new_paid) OR new_paid>NEW.amount THEN RAISE EXCEPTION 'Valores do título inválidos.'; END IF;
 IF current_user IN('authenticated','anon') THEN
  IF TG_OP='INSERT' AND (new_paid<>0 OR NEW.status::text NOT IN('open','overdue')) THEN RAISE EXCEPTION 'Cadastre o título em aberto e use a operação de baixa.'; END IF;
  IF TG_OP='UPDATE' AND (new_paid<>old_paid OR NEW.status::text IN('paid','received') AND new_paid+cancelled<NEW.amount OR (old_paid>0 AND (NEW.amount,NEW.status::text) IS DISTINCT FROM (OLD.amount,OLD.status::text))) THEN RAISE EXCEPTION 'Use a operação de baixa. Histórico financeiro não pode ser sobrescrito.'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Generic gross-cash settlement cannot double-post a marketplace title or consume held principal.
ALTER FUNCTION public.settle_financial_title(text,uuid,numeric,date,uuid,uuid) SET SCHEMA erp_private;
REVOKE ALL ON FUNCTION erp_private.settle_financial_title(text,uuid,numeric,date,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.settle_financial_title(p_kind text,p_title_id uuid,p_amount numeric,p_date date,p_bank_account_id uuid,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true);
BEGIN
 IF p_kind='receivable' AND EXISTS(SELECT 1 FROM accounts_receivable r JOIN orders o ON o.id=r.origin_id WHERE r.id=p_title_id AND r.tenant_id=t AND r.origin_type='order' AND o.marketplace_order_id IS NOT NULL) THEN RAISE EXCEPTION 'Este recebível é de marketplace. Concilie em Repasses para separar bruto, taxas, retenções e líquido no banco.'; END IF;
 IF p_kind='payable' AND EXISTS(SELECT 1 FROM accounts_payable WHERE id=p_title_id AND tenant_id=t AND origin_type='marketplace_settlement') THEN RAISE EXCEPTION 'Esta despesa já foi compensada pelo canal. Use crédito com origem em Repasses.'; END IF;
 RETURN erp_private.settle_financial_title(p_kind,p_title_id,p_amount,p_date,p_bank_account_id,p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.settle_financial_title(text,uuid,numeric,date,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.settle_financial_title(text,uuid,numeric,date,uuid,uuid) TO authenticated;

CREATE FUNCTION public.record_marketplace_settlement(p_receivable_id uuid,p_kind text,p_values jsonb,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t uuid:=erp_private.actor(true); prior uuid; result uuid; r accounts_receivable; o orders; mo marketplace_orders; source marketplace_settlements;
 posted marketplace_settlements; held numeric; remaining numeric; source_available numeric; credit_available numeric; gross numeric; liquidated numeric;
 fees numeric; freight numeric; other_debit numeric; retained numeric; fee_credit numeric; freight_credit numeric; other_credit numeric; net numeric; expected_net numeric;
 day date; competence date; bank uuid; transaction_id uuid; source_id uuid; reference text; notes text; label text; expense_account uuid; payable uuid; component record;
BEGIN
 prior:=erp_private.begin_request(t,p_request_id,'marketplace_settlement',jsonb_build_array(p_receivable_id,p_kind,p_values));
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF coalesce(p_kind,'') NOT IN('payout','release','refund','hold_reversal','adjustment') OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Informe uma conciliação de repasse, liberação, estorno ou ajuste válida.'; END IF;
 -- Same lock order as sale cancellation; source operations on a title are serialized together.
 SELECT * INTO o FROM orders WHERE id=(SELECT origin_id FROM accounts_receivable WHERE id=p_receivable_id AND tenant_id=t AND origin_type='order') AND tenant_id=t FOR UPDATE;
 SELECT * INTO r FROM accounts_receivable WHERE id=p_receivable_id AND tenant_id=t FOR UPDATE;
 IF r.id IS NULL OR o.id IS NULL OR o.status='draft' OR o.marketplace_order_id IS NULL THEN RAISE EXCEPTION 'Selecione um recebível ativo de uma venda de marketplace já aprovada.'; END IF;
 SELECT * INTO mo FROM marketplace_orders WHERE id=o.marketplace_order_id AND tenant_id=t;
 IF mo.id IS NULL OR mo.internal_order_id IS DISTINCT FROM o.id THEN RAISE EXCEPTION 'O vínculo entre a venda e o pedido do canal é inválido.'; END IF;
 IF r.amount_received IS DISTINCT FROM (SELECT coalesce(sum(liquidated_gross),0) FROM marketplace_settlements WHERE receivable_id=r.id) THEN RAISE EXCEPTION 'Há baixa fora da conciliação neste recebível. Revise o histórico antes de registrar o repasse.'; END IF;
 reference:=btrim(p_values->>'external_reference'); notes:=coalesce(btrim(p_values->>'notes'),'');
 IF length(coalesce(reference,'')) NOT BETWEEN 1 AND 160 OR length(notes)>1000 THEN RAISE EXCEPTION 'Informe a referência do extrato do canal (até 160 caracteres) e observações até 1000 caracteres.'; END IF;
 SELECT * INTO posted FROM marketplace_settlements WHERE account_id=mo.account_id AND external_reference=reference;
 IF posted.id IS NOT NULL THEN
  IF posted.receivable_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'Referência do extrato já vinculada a outro recebível desta conta. Não duplique o líquido; informe a identidade da linha individual conferida no extrato.'; END IF;
  IF posted.request_payload IS DISTINCT FROM jsonb_build_array(p_kind,p_values) THEN RAISE EXCEPTION 'Referência do extrato já conciliada com dados diferentes. Registre um evento novo com origem.'; END IF;
  PERFORM erp_private.finish_request(t,p_request_id,posted.id); RETURN posted.id;
 END IF;
 IF (r.status='reversed' OR o.status='cancelled') AND p_kind<>'adjustment' THEN RAISE EXCEPTION 'Este título está encerrado. Somente ajustes de custos com origem podem continuar.'; END IF;
 day:=(p_values->>'transaction_date')::date; competence:=coalesce((p_values->>'competence_date')::date,day);
 IF day IS NULL OR day>erp_private.today(t) OR competence IS NULL OR competence>erp_private.today(t) OR NOT isfinite(day) OR NOT isfinite(competence) THEN RAISE EXCEPTION 'Informe datas válidas de extrato e competência, até hoje.'; END IF;
 gross:=(p_values->>'gross_amount')::numeric; fees:=coalesce((p_values->>'fees')::numeric,0); freight:=coalesce((p_values->>'freight')::numeric,0);
 other_debit:=coalesce((p_values->>'other_debit')::numeric,0); retained:=coalesce((p_values->>'retained_amount')::numeric,0);
 fee_credit:=coalesce((p_values->>'fee_credit')::numeric,0); freight_credit:=coalesce((p_values->>'freight_credit')::numeric,0); other_credit:=coalesce((p_values->>'other_credit')::numeric,0);
 net:=(p_values->>'net_amount')::numeric; bank:=nullif(p_values->>'bank_account_id','')::uuid; source_id:=nullif(p_values->>'related_settlement_id','')::uuid;
 IF NOT erp_private.valid_number(gross) OR (p_kind='adjustment' AND gross<>0) OR (p_kind<>'adjustment' AND gross<0.01) OR gross>100000000 OR gross<>round(gross,2)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY[fees,freight,other_debit,retained,fee_credit,freight_credit,other_credit]) value WHERE NOT erp_private.valid_number(value) OR value>100000000 OR value<>round(value,2))
  OR net IS NULL OR net::text IN('NaN','Infinity','-Infinity') OR abs(net)>100000000 OR net<>round(net,2) THEN RAISE EXCEPTION 'Valores devem ser finitos, em centavos; bruto positivo e custos/créditos não negativos.'; END IF;
 remaining:=r.amount-r.amount_received-r.marketplace_cancelled_gross;
 SELECT coalesce(sum(CASE WHEN kind='payout' THEN retained_amount WHEN kind IN('release','hold_reversal') THEN -gross_amount ELSE 0 END),0) INTO held FROM marketplace_settlements WHERE receivable_id=r.id;
 IF source_id IS NOT NULL THEN
  SELECT * INTO source FROM marketplace_settlements WHERE id=source_id AND receivable_id=r.id AND tenant_id=t FOR UPDATE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'A origem deve ser uma conciliação do mesmo recebível e empresa.'; END IF;
 END IF;
 IF p_kind IN('release','refund','hold_reversal','adjustment') AND source.id IS NULL THEN RAISE EXCEPTION 'Informe a conciliação de origem da retenção, do estorno ou do ajuste.'; END IF;
 IF p_kind='payout' THEN
  IF retained>gross OR gross>remaining-held THEN RAISE EXCEPTION 'O bruto supera o saldo disponível fora das retenções. Libere retenções pela origem.'; END IF;
  liquidated:=gross-retained;
 ELSIF p_kind IN('release','hold_reversal') THEN
  IF source.kind<>'payout' OR retained<>0 THEN RAISE EXCEPTION 'Liberação exige uma retenção original e não cria outra retenção.'; END IF;
  SELECT source.retained_amount-coalesce(sum(gross_amount),0) INTO source_available FROM marketplace_settlements WHERE related_settlement_id=source.id AND kind IN('release','hold_reversal');
  IF gross>source_available OR gross>remaining THEN RAISE EXCEPTION 'A liberação supera a retenção pendente ou o saldo do recebível.'; END IF;
  liquidated:=CASE WHEN p_kind='release' THEN gross ELSE 0 END;
 ELSIF p_kind='refund' THEN
  IF source.kind NOT IN('payout','release') OR retained<>0 THEN RAISE EXCEPTION 'Estorno exige repasse liquidado e não cria retenção.'; END IF;
  SELECT source.liquidated_gross-coalesce(sum(gross_amount),0) INTO source_available FROM marketplace_settlements WHERE related_settlement_id=source.id AND kind='refund';
  IF gross>source_available THEN RAISE EXCEPTION 'O estorno supera o bruto liquidado ainda não estornado da origem.'; END IF;
  liquidated:=0;
 ELSE
  IF retained<>0 OR fees+freight+other_debit+fee_credit+freight_credit+other_credit=0 THEN RAISE EXCEPTION 'Ajuste posterior exige custo ou crédito e não movimenta bruto/retido.'; END IF;
  liquidated:=0;
 END IF;
 -- Credits reverse recorded costs, never create an extra sale/revenue title.
 FOR component IN SELECT * FROM (VALUES('fee',fee_credit,fees),('freight',freight_credit,freight),('other_debit',other_credit,other_debit)) v(kind,credit,current_debit) LOOP
  credit_available:=CASE WHEN source.id IS NULL THEN component.current_debit ELSE 0 END;
  IF source.id IS NOT NULL THEN
   SELECT credit_available+coalesce(sum(CASE WHEN c.kind=component.kind THEN c.amount_signed ELSE 0 END),0)
    +coalesce((SELECT sum(c2.amount_signed) FROM marketplace_settlement_components c2 WHERE c2.expense_source_settlement_id=source.id AND c2.kind=CASE component.kind WHEN 'fee' THEN 'fee_credit' WHEN 'freight' THEN 'freight_credit' ELSE 'other_credit' END),0)
   INTO credit_available FROM marketplace_settlement_components c WHERE c.settlement_id=source.id;
  END IF;
  IF component.credit>credit_available THEN RAISE EXCEPTION 'O crédito de % supera a despesa registrada e ainda não creditada da origem.',component.kind; END IF;
 END LOOP;
 expected_net:=CASE WHEN p_kind='refund' THEN -gross-fees-freight-other_debit+fee_credit+freight_credit+other_credit ELSE liquidated-fees-freight-other_debit+fee_credit+freight_credit+other_credit END;
 IF net<>expected_net THEN RAISE EXCEPTION 'O líquido do banco (%) difere da composição do extrato (%). Confira bruto, custos, créditos e retenção.',net,expected_net; END IF;
 IF net<>0 THEN
  PERFORM erp_private.assert_ref('bank_accounts',bank,t);
  IF bank IS NULL OR NOT EXISTS(SELECT 1 FROM bank_accounts WHERE id=bank AND tenant_id=t AND is_active) THEN RAISE EXCEPTION 'Selecione uma conta bancária ativa para o valor efetivamente recebido/debitado.'; END IF;
 ELSIF bank IS NOT NULL THEN PERFORM erp_private.assert_ref('bank_accounts',bank,t); END IF;
 result:=gen_random_uuid(); label:='Marketplace '||(SELECT name FROM marketplace_accounts WHERE id=mo.account_id)||' / pedido '||mo.external_order_id||' / extrato '||reference;
 IF net<>0 THEN
  INSERT INTO bank_transactions(tenant_id,bank_account_id,type,amount,transaction_date,description,reference_type,reference_id,memo)
  VALUES(t,bank,CASE WHEN net>0 THEN 'credit' ELSE 'debit' END,abs(net),day,label,'accounts_receivable',r.id,'Conciliação '||result::text||' · bruto do evento '||gross::text||' · líquido real '||net::text) RETURNING id INTO transaction_id;
 END IF;
 INSERT INTO marketplace_settlements(id,tenant_id,account_id,marketplace_order_id,order_id,receivable_id,kind,external_reference,related_settlement_id,transaction_date,competence_date,gross_amount,liquidated_gross,fees,freight,other_debit,retained_amount,fee_credit,freight_credit,other_credit,net_amount,bank_account_id,bank_transaction_id,notes,request_payload,created_by)
 VALUES(result,t,mo.account_id,mo.id,o.id,r.id,p_kind,reference,source_id,day,competence,gross,liquidated,fees,freight,other_debit,retained,fee_credit,freight_credit,other_credit,net,bank,transaction_id,notes,jsonb_build_array(p_kind,p_values),auth.uid());
 FOR component IN SELECT * FROM (VALUES('fee',fees,'FF-MKT-FEES','Tarifas de marketplace'),('freight',freight,'FF-MKT-FREIGHT','Frete cobrado pelo marketplace'),('other_debit',other_debit,'FF-MKT-ADJUST','Ajustes de despesa do marketplace')) v(kind,amount,code,name) LOOP
  IF component.amount=0 THEN CONTINUE; END IF;
  INSERT INTO chart_of_accounts(tenant_id,code,name,account_type,is_system) VALUES(t,component.code,component.name,'expense',true) ON CONFLICT(tenant_id,code) DO NOTHING;
  SELECT id INTO expense_account FROM chart_of_accounts WHERE tenant_id=t AND code=component.code AND account_type='expense' AND is_active;
  IF expense_account IS NULL THEN RAISE EXCEPTION 'Classifique/ative a conta de despesa % antes de conciliar.',component.code; END IF;
  INSERT INTO accounts_payable(tenant_id,description,amount,amount_paid,due_date,competence_date,payment_date,status,account_id,notes,origin_type,origin_id,created_by)
  VALUES(t,component.name||' · '||label,component.amount,component.amount,day,competence,day,'paid',expense_account,'Compensada pelo canal no extrato; não é um débito separado no banco. '||notes,'marketplace_settlement',result,auth.uid()) RETURNING id INTO payable;
  INSERT INTO marketplace_settlement_components(tenant_id,settlement_id,kind,amount_signed,competence_date,payable_id) VALUES(t,result,component.kind,component.amount,competence,payable);
 END LOOP;
 FOR component IN SELECT * FROM (VALUES('fee_credit',fee_credit),('freight_credit',freight_credit),('other_credit',other_credit)) v(kind,amount) LOOP
  IF component.amount=0 THEN CONTINUE; END IF;
  INSERT INTO marketplace_settlement_components(tenant_id,settlement_id,kind,amount_signed,competence_date,expense_source_settlement_id) VALUES(t,result,component.kind,-component.amount,competence,coalesce(source.id,result));
 END LOOP;
 IF p_kind IN('refund','hold_reversal') THEN
  INSERT INTO marketplace_settlement_components(tenant_id,settlement_id,kind,amount_signed,competence_date) VALUES(t,result,'refund',-gross,competence);
 END IF;
 IF p_kind='hold_reversal' THEN
  UPDATE accounts_receivable SET marketplace_cancelled_gross=marketplace_cancelled_gross+gross,
   status=CASE WHEN gross=remaining AND amount_received=0 THEN 'reversed'::receivable_status WHEN gross=remaining THEN 'received'::receivable_status WHEN amount_received>0 THEN 'partial'::receivable_status ELSE status END WHERE id=r.id;
 ELSIF p_kind IN('payout','release') THEN
  UPDATE accounts_receivable SET amount_received=amount_received+liquidated,status=CASE WHEN liquidated=remaining THEN 'received'::receivable_status WHEN amount_received+liquidated>0 THEN 'partial'::receivable_status ELSE status END,
   receipt_date=CASE WHEN liquidated>0 THEN day ELSE receipt_date END,bank_account_id=CASE WHEN net<>0 THEN bank ELSE bank_account_id END WHERE id=r.id;
 END IF;
 INSERT INTO audit_log(tenant_id,user_id,action,table_name,record_id,metadata) VALUES(t,auth.uid(),'marketplace_settlement','marketplace_settlements',result,jsonb_build_object('kind',p_kind,'receivable_id',r.id,'gross',gross,'liquidated_gross',liquidated,'net_bank',net,'source_id',source_id));
 PERFORM erp_private.finish_request(t,p_request_id,result); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_marketplace_settlement(uuid,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_marketplace_settlement(uuid,text,jsonb,uuid) TO authenticated;

CREATE VIEW public.marketplace_receivable_positions WITH(security_invoker=true) AS
SELECT r.id AS receivable_id,r.tenant_id,r.description,r.amount AS gross_title_amount,r.amount_received AS liquidated_gross,r.marketplace_cancelled_gross AS cancelled_gross,r.due_date,r.status,
 o.id AS order_id,o.code AS order_code,o.total AS gross_sale_amount,mo.id AS marketplace_order_id,mo.external_order_id,a.id AS account_id,a.name AS account_name,a.channel,
 coalesce(s.retained_open,0) AS retained_open, r.amount-r.amount_received-r.marketplace_cancelled_gross AS outstanding_gross,
 r.amount-r.amount_received-r.marketplace_cancelled_gross-coalesce(s.retained_open,0) AS available_gross,
 coalesce(s.net_bank,0) AS net_bank,coalesce(s.refunded_gross,0) AS refunded_gross,
 coalesce(s.fees,0) AS fees,coalesce(s.freight,0) AS freight,coalesce(s.other_debit,0) AS other_debit,
 coalesce(s.fee_credit,0) AS fee_credit,coalesce(s.freight_credit,0) AS freight_credit,coalesce(s.other_credit,0) AS other_credit
FROM accounts_receivable r JOIN orders o ON r.origin_type='order' AND r.origin_id=o.id AND r.tenant_id=o.tenant_id
JOIN marketplace_orders mo ON mo.id=o.marketplace_order_id AND mo.internal_order_id=o.id AND mo.tenant_id=o.tenant_id
JOIN marketplace_accounts a ON a.id=mo.account_id AND a.tenant_id=o.tenant_id
LEFT JOIN LATERAL(SELECT sum(CASE WHEN kind='payout' THEN retained_amount WHEN kind IN('release','hold_reversal') THEN -gross_amount ELSE 0 END) retained_open,
 sum(net_amount) net_bank,sum(CASE WHEN kind IN('refund','hold_reversal') THEN gross_amount ELSE 0 END) refunded_gross,
 sum(fees) fees,sum(freight) freight,sum(other_debit) other_debit,sum(fee_credit) fee_credit,sum(freight_credit) freight_credit,sum(other_credit) other_credit
 FROM marketplace_settlements WHERE receivable_id=r.id) s ON true;
REVOKE ALL ON public.marketplace_receivable_positions FROM PUBLIC,anon;
GRANT SELECT ON public.marketplace_receivable_positions TO authenticated;
