import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { allRows, currency, displayDate } from "@/lib/finance";
import { isMissingDatabaseStructure } from "@/lib/database-readiness";
import { marketplaceDb, marketplaceLabels, marketplaceRpc } from "@/lib/marketplace-orders";
import { expectedSettlementNet, newSettlementForm, prepareMarketplaceSettlement, settlementLabels, settlementNumbers, type MarketplaceReceivablePosition, type MarketplaceSettlement, type MarketplaceSettlementKind, type SettlementForm } from "@/lib/marketplace-settlements";
import { orderRequest } from "@/lib/sales-order";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export default function Repasses() {
  const { profile } = useAuth(), { toast } = useToast(), qc = useQueryClient();
  const [params] = useSearchParams();
  const [receivableId, setReceivableId] = useState(params.get("titulo") ?? ""), [search, setSearch] = useState("");
  const [kind, setKind] = useState<MarketplaceSettlementKind>("payout"), [form, setForm] = useState(newSettlementForm);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const initialLinkLoaded = useRef(!params.get("titulo"));
  const positions = useQuery({ queryKey: ["marketplace_receivable_positions", profile?.tenant_id], enabled: !!profile, queryFn: () => allRows<MarketplaceReceivablePosition>((from, to) => marketplaceDb.from("marketplace_receivable_positions").select("*").eq("tenant_id", profile!.tenant_id).order("due_date").order("receivable_id").range(from,to)) });
  const selected = positions.data?.find(row => row.receivable_id === receivableId);
  const banks = useQuery({ queryKey: ["bank_accounts", "marketplace", profile?.tenant_id], enabled: !!profile, queryFn: () => allRows<{ id: string; name: string }>((from, to) => supabase.from("bank_accounts").select("id,name").eq("tenant_id", profile!.tenant_id).eq("is_active", true).order("name").order("id").range(from,to)) });
  const history = useQuery({ queryKey: ["marketplace_settlements", profile?.tenant_id, receivableId], enabled: !!profile && !!receivableId, queryFn: () => allRows<MarketplaceSettlement>((from,to) => marketplaceDb.from("marketplace_settlements").select("*").eq("tenant_id", profile!.tenant_id).eq("receivable_id",receivableId).order("transaction_date",{ascending:false}).order("id").range(from,to)) });
  useEffect(() => {
    if (initialLinkLoaded.current || !selected || !banks.data) return;
    initialLinkLoaded.current = true;
    setForm({ ...newSettlementForm(), gross_amount: String(selected.available_gross), net_amount: String(selected.available_gross), bank_account_id: banks.data.length === 1 ? banks.data[0].id : "" });
  }, [selected, banks.data]);
  const filtered = positions.data?.filter(row => `${row.external_order_id} ${row.order_code} ${row.account_name} ${row.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const update = (key: keyof SettlementForm, value: string) => setForm(current => ({ ...current,[key]:value }));
  function choose(id: string) {
    initialLinkLoaded.current = true;
    setReceivableId(id); setKind("payout"); request.current=null;
    const position = positions.data?.find(row => row.receivable_id===id);
    setForm({ ...newSettlementForm(), gross_amount: position ? String(position.available_gross) : "", net_amount: position ? String(position.available_gross) : "", bank_account_id: banks.data?.length===1 ? banks.data[0].id : "" });
  }
  function changeKind(value: MarketplaceSettlementKind) {
    setKind(value); request.current=null;
    setForm(current => ({ ...newSettlementForm(), bank_account_id:current.bank_account_id, gross_amount:value==="adjustment"?"0":value==="payout"&&selected?String(selected.available_gross):"", net_amount:"" }));
  }
  function chooseSource(id: string) {
    const origin=history.data?.find(row=>row.id===id);
    let gross=form.gross_amount;
    if(origin&&["release","hold_reversal"].includes(kind)) gross=String(Number(origin.retained_amount)-(history.data??[]).filter(row=>["release","hold_reversal"].includes(row.kind)&&row.related_settlement_id===id).reduce((sum,row)=>sum+Number(row.gross_amount),0));
    if(origin&&kind==="refund") gross=String(Number(origin.liquidated_gross)-(history.data??[]).filter(row=>row.kind==="refund"&&row.related_settlement_id===id).reduce((sum,row)=>sum+Number(row.gross_amount),0));
    setForm(current=>({...current,related_settlement_id:id,gross_amount:gross,net_amount:kind==="refund"?String(-Number(gross)):kind==="release"?gross:kind==="hold_reversal"?"0":current.net_amount}));
  }
  let expected: number | null=null, previewError="";
  try { expected=expectedSettlementNet(kind,settlementNumbers(form)); } catch(error) { previewError=(error as Error).message; }
  const post=useMutation({ mutationFn:async()=>{
    if(!selected) throw new Error("Selecione o recebível de uma venda aprovada.");
    const values=prepareMarketplaceSettlement(kind,form);
    request.current=orderRequest(request.current,JSON.stringify([selected.receivable_id,kind,values]));
    return marketplaceRpc<string>("record_marketplace_settlement",{p_receivable_id:selected.receivable_id,p_kind:kind,p_values:values,p_request_id:request.current.id});
  },onSuccess:()=>{
    for(const key of ["marketplace_receivable_positions","marketplace_settlements","accounts_receivable","accounts_payable","bank_accounts","bank_transactions","financial_history","dre_ar","dre_ap","dre_marketplace_adjustments","dashboard","daily-operations"]) void qc.invalidateQueries({queryKey:[key]});
    request.current=null;setForm(newSettlementForm());toast({title:"Extrato conciliado",description:"Bruto preservado, custos separados e somente o líquido real lançado no banco."});
  },onError:error=>toast({title:"Confira a conciliação",description:(error as Error).message,variant:"destructive"}) });
  const field=(key:keyof SettlementForm,label:string,help?:string)=><div className="space-y-1"><Label htmlFor={`payout-${key}`}>{label}</Label><Input id={`payout-${key}`} value={form[key]} onChange={e=>update(key,e.target.value)} inputMode="decimal" placeholder="0,00" />{help&&<p className="text-xs text-muted-foreground">{help}</p>}</div>;
  const sourceOptions=history.data?.filter(row=>["release","hold_reversal"].includes(kind)?row.kind==="payout"&&Number(row.retained_amount)>0:kind==="refund"?["payout","release"].includes(row.kind)&&Number(row.liquidated_gross)>0:true)??[];
  if(positions.error&&isMissingDatabaseStructure(positions.error)) return <div role="status" className="rounded-xl border bg-card p-6 space-y-3"><p>A conciliação de repasses ainda precisa ser ativada nesta empresa.</p><p className="text-sm text-muted-foreground">Publique a estrutura financeira de marketplaces no banco para registrar o líquido e as despesas separados.</p><Button asChild variant="outline"><Link to="/financeiro/receber">Abrir contas a receber</Link></Button><Button variant="ghost" onClick={()=>void positions.refetch()}>Verificar ativação</Button></div>;
  const readError=positions.error||banks.error||history.error;
  return <div className="space-y-5">
    <PageHeader title="Repasses dos marketplaces" description="Confira o extrato do canal: venda pelo bruto, custos separados e líquido real no banco." breadcrumbs={[{label:"Financeiro"},{label:"Repasses"}]} />
    {readError&&<div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">Não foi possível carregar todos os dados: {readError.message}<Button variant="outline" className="ml-2" onClick={()=>{void positions.refetch();void banks.refetch();void history.refetch();}}>Tentar novamente</Button></div>}
    <section className="rounded-xl border bg-card p-4 space-y-3"><h2 className="font-semibold">Venda e recebível</h2><Input aria-label="Buscar pedido do canal" placeholder="Buscar pedido, loja ou título" value={search} onChange={e=>setSearch(e.target.value)} />
      {positions.isLoading?<p>Carregando recebíveis…</p>:!positions.data?.length?<p className="text-sm text-muted-foreground">Nenhuma venda de marketplace com recebível aprovado. Importe o pedido e confirme a venda para gerar o título.</p>:<select className={selectClass} aria-label="Recebível do marketplace" value={receivableId} disabled={post.isPending} onChange={e=>choose(e.target.value)}><option value="">Selecione a parcela da venda</option>{filtered.map(row=><option key={row.receivable_id} value={row.receivable_id}>{row.account_name} · {row.external_order_id} · {row.description} · previsto {currency(Number(row.outstanding_gross))}</option>)}</select>}
      <Button asChild variant="link" className="px-0"><Link to="/comercial/marketplaces">Abrir pedidos dos canais</Link></Button>
    </section>
    {selected&&<>
      <div className="grid gap-3 sm:grid-cols-4">{[{label:"Bruto desta parcela",value:selected.gross_title_amount},{label:"Líquido acumulado no banco",value:selected.net_bank},{label:"Ainda previsto",value:selected.outstanding_gross},{label:"Retido no canal",value:selected.retained_open}].map(card=><div key={card.label} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{card.label}</p><p className="text-xl font-semibold">{currency(Number(card.value))}</p></div>)}</div>
      <p className="text-sm text-muted-foreground">{marketplaceLabels[selected.channel as keyof typeof marketplaceLabels]} · pedido {selected.external_order_id} · venda total {currency(Number(selected.gross_sale_amount))} · bruto liquidado (inclui custos compensados) {currency(Number(selected.liquidated_gross))} · estornos {currency(Number(selected.refunded_gross))} (inclui principal retido cancelado {currency(Number(selected.cancelled_gross ?? 0))}). Previsão do título: {displayDate(selected.due_date)}.</p>
      <section className="rounded-xl border bg-card p-4 space-y-4"><h2 className="font-semibold">Conciliar evento do extrato</h2><fieldset disabled={post.isPending||!!readError||history.isLoading} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="payout-kind">Natureza</Label><select id="payout-kind" className={selectClass} value={kind} onChange={e=>changeKind(e.target.value as MarketplaceSettlementKind)}>{Object.entries(settlementLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div><Label htmlFor="payout-reference">Referência do extrato do canal</Label><Input id="payout-reference" value={form.external_reference} onChange={e=>update("external_reference",e.target.value)} placeholder="Referência única da linha do extrato nesta loja" /></div><div><Label htmlFor="payout-date">Data no extrato</Label><Input id="payout-date" type="date" value={form.transaction_date} onChange={e=>{update("transaction_date",e.target.value);update("competence_date",e.target.value);}} /></div></div>
        {kind!=="payout"&&<div><Label htmlFor="payout-source">Conciliação de origem</Label><select id="payout-source" className={selectClass} value={form.related_settlement_id} onChange={e=>chooseSource(e.target.value)}><option value="">Selecione o evento original</option>{sourceOptions.map(row=><option key={row.id} value={row.id}>{row.external_reference} · {settlementLabels[row.kind]} · bruto {currency(Number(row.gross_amount))} · retido {currency(Number(row.retained_amount))}</option>)}</select></div>}
        <div className="grid gap-3 sm:grid-cols-3">{kind!=="adjustment"&&field("gross_amount",["refund","hold_reversal"].includes(kind)?"Bruto da venda estornado":"Bruto deste evento","Use a parcela do bruto informada no extrato, sem transformar tarifa em desconto da venda.")}{field("fees","Tarifas debitadas pelo canal")}{field("freight","Frete cobrado do vendedor","Frete do canal é custo; o frete cobrado do comprador já pertence ao bruto da venda.")}</div>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Retenção, ajustes e créditos de despesas</summary><div className="grid gap-3 mt-3 sm:grid-cols-3">{kind==="payout"&&field("retained_amount","Retido no canal","Permanece previsto; não entra no banco nem vira despesa.")}{field("other_debit","Outros débitos de despesa")}{field("fee_credit","Crédito de tarifas")}{field("freight_credit","Crédito de frete")}{field("other_credit","Crédito de outras despesas")}<div><Label htmlFor="payout-competence">Competência dos custos/estorno</Label><Input id="payout-competence" type="date" value={form.competence_date} onChange={e=>update("competence_date",e.target.value)} /></div></div>{kind==="payout"&&<div className="mt-3"><Label htmlFor="payout-credit-source">Origem dos créditos de despesas (se de outro evento)</Label><select id="payout-credit-source" className={selectClass} value={form.related_settlement_id} onChange={e=>update("related_settlement_id",e.target.value)}><option value="">Custos deste próprio evento</option>{history.data?.map(row=><option key={row.id} value={row.id}>{row.external_reference}</option>)}</select></div>}<p className="text-xs text-muted-foreground mt-2">Créditos precisam corresponder a despesas já registradas na origem. Subsídios ou receitas adicionais devem ser classificados no financeiro como receitas próprias.</p></details>
        <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="payout-bank">Conta do banco</Label><select id="payout-bank" className={selectClass} value={form.bank_account_id} onChange={e=>update("bank_account_id",e.target.value)}><option value="">Selecione a conta</option>{banks.data?.map(bank=><option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></div>{field("net_amount","Líquido real no banco","Positivo para entrada; negativo para saída. Confira o valor efetivo no extrato.")}<div className="self-center"><p className="text-xs text-muted-foreground">Líquido pela composição</p><p role="status" className="text-xl font-semibold">{expected===null?"Confira os valores":currency(expected)}</p><Button type="button" size="sm" variant="link" className="px-0" disabled={expected===null} onClick={()=>update("net_amount",String(expected))}>Usar valor conferido</Button></div></div>
        {previewError&&<p role="alert" className="text-sm text-destructive">{previewError}</p>}
        <div><Label htmlFor="payout-notes">Observações e motivo do ajuste/estorno</Label><Input id="payout-notes" value={form.notes} onChange={e=>update("notes",e.target.value)} /></div>
        <Button disabled={post.isPending||!form.external_reference.trim()||expected===null||(!form.gross_amount&&kind!=="adjustment")} onClick={()=>post.mutate()}>{post.isPending?"Conciliando…":"Registrar conciliação"}</Button>
      </fieldset><p className="text-xs text-muted-foreground">Estorno do principal retido encerra a previsão sem fingir recebimento no banco. Esta conferência usa os dados reais informados por você. O recebível e a venda mantêm o bruto; taxas são compensadas no canal e o banco recebe apenas o líquido. A referência e a origem protegem o histórico contra duplicação.</p></section>
      <section className="space-y-3"><h2 className="font-semibold">Histórico desta parcela</h2>{history.isLoading?<p>Carregando conciliações…</p>:!history.data?.length?<p className="text-sm text-muted-foreground">Ainda sem conciliações para esta parcela.</p>:history.data.map(row=><article key={row.id} className="rounded-xl border bg-card p-4 text-sm space-y-2"><div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{settlementLabels[row.kind]} · {row.external_reference}</p><p>{displayDate(row.transaction_date)} · banco {currency(Number(row.net_amount))}</p></div><p>Bruto {currency(Number(row.gross_amount))} · tarifas {currency(Number(row.fees))} · frete {currency(Number(row.freight))} · outros débitos {currency(Number(row.other_debit))} · retido {currency(Number(row.retained_amount))} · créditos de despesas {currency(Number(row.fee_credit)+Number(row.freight_credit)+Number(row.other_credit))}</p>{row.related_settlement_id&&<p className="text-xs text-muted-foreground">Origem: {history.data?.find(source=>source.id===row.related_settlement_id)?.external_reference??row.related_settlement_id}</p>}{row.notes&&<p>{row.notes}</p>}</article>)}</section>
    </>}
  </div>;
}
