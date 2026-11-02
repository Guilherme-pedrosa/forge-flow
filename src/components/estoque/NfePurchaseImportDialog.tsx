import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { allRows, currency } from '@/lib/finance';
import { parseNfePurchaseXml, suggestNfeInventory, MAX_NFE_XML_BYTES, type NfePurchaseData } from '@/lib/nfe-purchase';
import { loadPurchaseMaterials, type PurchaseMaterial } from '@/lib/purchase-catalog';
import { buildNfePurchasePayload, nfePaymentLabel, nfeStockLinks, type NfeStockLink } from '@/lib/nfe-purchase-draft';
import { orderRequest } from '@/lib/sales-order';
import { purchaseMaterialLabel } from '@/lib/purchase-stock';
import { invalidateInventoryPricing } from '@/lib/inventory-cache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SearchableItemSelect } from '@/components/shared/SearchableItemSelect';
import { InstallmentEditor, generateParts, type PaymentPart } from '@/components/shared/InstallmentEditor';
import { PartnerDialog, type PartnerInitialValues } from '@/components/comercial/PartnerDialog';
import { PurchaseFinancialFields, blankPurchaseClassification, type PurchasePaymentMethod } from './PurchaseFinancialFields';
import { PurchaseStockQuantity } from './PurchaseStockQuantity';
import { QuickInventoryItem } from './QuickInventoryItem';
import { FilamentRegistration } from './FilamentRegistration';

type Vendor = {id:string;name:string;document:string|null};
const cleanDocument = (value:string) => value.replace(/[^0-9A-Z]/gi,'').toUpperCase();
type Props = {open:boolean;onOpenChange:(open:boolean)=>void;onImported:()=>void};
/** Keep drafts, requests and callbacks scoped to one signed-in operator. */
export function NfePurchaseImportDialog(props:Props) {
  const {profile,user} = useAuth();
  return props.open ? <NfePurchaseImportSession key={`${profile?.tenant_id}:${user?.id}`} {...props}/> : null;
}
function NfePurchaseImportSession({open,onOpenChange,onImported}:Props) {
  const {profile} = useAuth(); const qc = useQueryClient();
  const [invoice,setInvoice] = useState<NfePurchaseData|null>(null),[xml,setXml] = useState('');
  const [links,setLinks] = useState<NfeStockLink[]>([]),[vendorId,setVendorId] = useState('');
  const [classification,setClassification] = useState(blankPurchaseClassification),[parts,setParts] = useState<PaymentPart[]>([]);
  const [count,setCount] = useState('1'),[firstDate,setFirstDate] = useState(''),[days,setDays] = useState('');
  const [partMethods,setPartMethods] = useState<string[]>([]),[paymentMethods,setPaymentMethods] = useState<PurchasePaymentMethod[]>([]);
  const [receive,setReceive] = useState(false),[createPayables,setCreatePayables] = useState(true);
  const [error,setError] = useState(''),[reading,setReading] = useState(false),[childBusy,setChildBusy] = useState(false);
  const [vendorOpen,setVendorOpen] = useState(false),[newItem,setNewItem] = useState<{index:number;kind:'filament'|'other'}|null>(null);
  const fileInput = useRef<HTMLInputElement>(null),version = useRef(0),alive = useRef(true);
  const request = useRef<ReturnType<typeof orderRequest>|null>(null);
  const renameRequest = useRef<ReturnType<typeof orderRequest>|null>(null);
  useEffect(() => {alive.current=true;return()=>{alive.current=false;};},[]);
  const materialsQuery = useQuery({queryKey:['inventory_items',profile?.tenant_id,'purchase-materials'],enabled:!!profile,
    queryFn:()=>loadPurchaseMaterials(profile!.tenant_id)});
  const vendorQuery = useQuery({queryKey:['vendors',profile?.tenant_id,'purchase-import'],enabled:!!profile,
    queryFn:()=>allRows<Vendor>((from,to)=>supabase.from('vendors').select('id,name,document').eq('tenant_id',profile!.tenant_id).eq('is_active',true).order('name').order('id').range(from,to))});
  const materials = materialsQuery.data?.items ?? [], vendors = vendorQuery.data ?? [];
  const autoVendor = useRef('');
  useEffect(()=>{
    if(!invoice || !vendorQuery.data || autoVendor.current===invoice.nfeKey) return;
    autoVendor.current=invoice.nfeKey;
    const matching=vendorQuery.data.filter(v=>cleanDocument(v.document??'')===cleanDocument(invoice.vendorDoc));
    if(invoice.vendorDoc && matching.length===1) setVendorId(matching[0].id);
  },[invoice,vendorQuery.data]);
  const supplierDefaults: PartnerInitialValues|undefined = invoice ? {name:invoice.supplier.name || invoice.vendorName, document:invoice.vendorDoc,
    phone:invoice.supplier.phone,email:invoice.supplier.email,address:{cep:invoice.supplier.address.postalCode,street:invoice.supplier.address.street,
      number:invoice.supplier.address.number,complement:invoice.supplier.address.complement,neighborhood:invoice.supplier.address.district,
      city:invoice.supplier.address.municipality,state:invoice.supplier.address.state},
    registration_details:{trade_name:invoice.supplier.tradeName,state_registration:invoice.supplier.stateRegistration,municipal_registration:invoice.supplier.municipalRegistration}} : undefined;
  const save = useMutation({mutationFn:async()=>{
    if(!profile || !invoice || !materialsQuery.data || materialsQuery.error) throw new Error('Aguarde a conferência dos insumos da empresa.');
    if(!vendors.some(v=>v.id===vendorId)) throw new Error('Selecione um fornecedor ativo.');
    const schedule = parts.length ? parts : createPayables ? generateParts(invoice.total,Number(count),firstDate,days) : [];
    const payload = buildNfePurchasePayload(invoice,xml,links,materials,vendorId,{...classification,partPaymentMethodIds:partMethods,parts:schedule,createPayables},receive);
    request.current=orderRequest(request.current,JSON.stringify(payload));
    const {data,error:failure}=await (supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>)('save_quick_purchase',{...payload,p_request_id:request.current.id});
    if(failure) throw new Error(failure.message);
    if(typeof data!=='string') throw new Error('A importação não foi confirmada. Tente novamente para conferir a mesma operação.');
    return {id:data,receive};
  },onSuccess:async result=>{
    if(!alive.current) return;
    await Promise.all(['purchase_orders','accounts_payable','filament-planning','daily-operations','financial_options'].map(key=>qc.invalidateQueries({queryKey:[key]})));
    if(result.receive) await invalidateInventoryPricing(qc);
    if(!alive.current) return;
    onImported();onOpenChange(false);
  },onError:failure=>{if(alive.current)setError(failure.message);}});
  const rename = useMutation({mutationFn:async({id,name}:{id:string;name:string})=>{
    if(!name.trim())throw new Error('Informe o nome do insumo.');
    const payload={p_item_id:id,p_item:{name:name.trim()}};
    renameRequest.current=orderRequest(renameRequest.current,JSON.stringify(payload));
    const result=await (supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>)('save_inventory_catalog',{...payload,p_request_id:renameRequest.current.id});
    if(result.error)throw new Error(result.error.message);
    if(result.data!==id)throw new Error('A alteração do nome não foi confirmada. Tente novamente.');
  },onSuccess:async()=>{if(!alive.current)return;await qc.invalidateQueries({queryKey:['inventory_items']});},onError:failure=>{if(alive.current)setError(failure.message);}});
  const busy = reading || save.isPending || rename.isPending || childBusy || vendorOpen || !!newItem;
  async function readFile(file:File|undefined) {
    if(!file || busy) return;
    const current=++version.current;setReading(true);setError('');setInvoice(null);setXml('');setLinks([]);
    try{
      if(file.size>MAX_NFE_XML_BYTES) throw new Error('O XML deve ter até 5 MB.');
      const raw=await file.text(),next=parseNfePurchaseXml(raw);
      if(!alive.current || current!==version.current) return;
      setXml(raw);setInvoice(next);setLinks(nfeStockLinks(next));setVendorId('');setReceive(false);setCreatePayables(true);
      setClassification(blankPurchaseClassification());setParts(next.billing.duplicates.map(part=>({due_date:part.dueDate,amount:part.amountExact})));
      setCount(String(next.billing.duplicates.length || 1));setFirstDate(next.billing.duplicates[0]?.dueDate || '');setDays('');setPartMethods([]);request.current=null;autoVendor.current='';
    }catch(failure){if(alive.current&&current===version.current)setError(failure instanceof Error?failure.message:'Não foi possível ler o XML.');}
    finally{if(alive.current&&current===version.current)setReading(false);}
  }
  const changeLink = (index:number,patch:Partial<NfeStockLink>)=>{setError('');setLinks(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));};
  const selectMaterial = (index:number,id:string,known?:PurchaseMaterial)=>{
    const material=known || materials.find(item=>item.id===id);
    // Unit-count conversion is explicit from structured units; package mass is never inferred from a name.
    const unit=invoice?.items[index].purchaseUnit.trim().toLowerCase();
    changeLink(index,{itemId:id,...(material?{name:material.name}:{}),skipStock:false,stockQuantity:material?.unit==='un'&&['un','und','unid'].includes(unit??'')?String(invoice!.items[index].quantity):''});
  };
  async function selectCreatedItem(id:string,index:number) {
    const refreshed=await materialsQuery.refetch();
    if(!alive.current) return;
    const item=refreshed.data?.items.find(item=>item.id===id);
    if(!item) {setError('O cadastro foi criado, mas não foi possível atualizar os insumos. Tente carregar os cadastros novamente.');setNewItem(null);return;}
    selectMaterial(index,id,item);setNewItem(null);
  }
  const catalogueError = materialsQuery.error || vendorQuery.error;
  return <Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><DialogContent closeDisabled={busy} className="flex max-h-[94dvh] w-[96vw] max-w-5xl flex-col overflow-hidden p-0">
    <DialogHeader className="shrink-0 border-b p-5 pr-14"><DialogTitle>Importar NFe XML</DialogTitle><DialogDescription>Confira fornecedor, insumos e pagamento antes de salvar a compra.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      <input ref={fileInput} type="file" accept=".xml,text/xml,application/xml" aria-label="Arquivo XML da NFe" className="hidden" onChange={event=>{void readFile(event.target.files?.[0]);event.target.value='';}}/>
      {!invoice ? <div className="space-y-4 py-8 text-center"><p>Selecione o XML da nota fiscal.</p><Button type="button" disabled={busy} onClick={()=>fileInput.current?.click()}>{reading?'Lendo XML…':'Selecionar Arquivo XML'}</Button></div> : <>
        <section className="rounded-lg border bg-muted/30 p-4"><div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">NFe {invoice.nfeNumber} · {invoice.issueDate}</h3><p className="text-sm text-muted-foreground">{invoice.vendorName} · {invoice.vendorDoc}</p></div><strong>{currency(invoice.total)}</strong></div><details className="mt-3 text-sm"><summary className="cursor-pointer">Valores da nota</summary><dl className="mt-3 grid grid-cols-2 gap-2"><dt>Subtotal</dt><dd>{currency(invoice.subtotal)}</dd><dt>Desconto</dt><dd>{currency(invoice.discount)}</dd><dt>Frete</dt><dd>{currency(invoice.shipping)}</dd><dt>Outros componentes</dt><dd>{currency(invoice.additionalCosts)}</dd></dl></details></section>
        {invoice.review.warnings.length>0 && <div role="alert" className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">{invoice.review.warnings.map(warning=><p key={warning}>{warning}</p>)}</div>}
        {catalogueError && <p role="alert" className="text-sm text-destructive">Não foi possível conferir os insumos e fornecedores. <Button type="button" variant="link" onClick={()=>{void materialsQuery.refetch();void vendorQuery.refetch();}}>Carregar cadastros novamente</Button></p>}
        <section className="space-y-2"><div className="flex justify-between gap-3"><h3 className="font-semibold">Fornecedor da compra</h3><Button type="button" variant="link" className="h-auto p-0" disabled={busy} onClick={()=>setVendorOpen(true)}>Cadastrar fornecedor da nota</Button></div><SearchableItemSelect label="Fornecedor da NFe" value={vendorId} emptyLabel="Selecionar fornecedor" disabled={busy||vendorQuery.isLoading||!!vendorQuery.error} options={vendors.map(v=>({id:v.id,label:v.name,description:v.document??''}))} onChange={setVendorId}/></section>
        <section className="space-y-3"><h3 className="font-semibold">Insumos da compra</h3><p className="text-sm text-muted-foreground">A descrição fiscal fica preservada. Confirme as sugestões ou escolha o insumo cadastrado; o nome interno pode ser definido ao cadastrar.</p>
          {invoice.items.map((item,index)=>{
            const link=links[index],selected=materials.find(material=>material.id===link.itemId);
            const suggestion=materialsQuery.data?suggestNfeInventory(item,materials,{productStockItemIds:materialsQuery.data.productStockItemIds,supplierDocument:invoice.vendorDoc,vendorId}):null;
            const proposed=materials.find(material=>material.id===suggestion?.proposal?.itemId);
            return <article key={`${invoice.nfeKey}:${index}`} className="space-y-3 rounded-lg border p-4" aria-label={`Item ${index+1} da nota`}>
              <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{item.fiscalDescription}</p><p className="text-xs text-muted-foreground">Código {item.supplierCode||'não informado'} · {item.quantity} {item.purchaseUnit} × {currency(item.unitPrice)}</p></div><strong>{currency(item.total)}</strong></div>
              {!selected&&!link.skipStock&&proposed&&<div className="rounded-md bg-primary/5 p-3 text-sm"><p>Sugestão: <strong>{purchaseMaterialLabel(proposed)}</strong></p><p className="text-xs text-muted-foreground">{suggestion?.proposal?.reasons.join(' · ')}</p><Button type="button" variant="outline" className="mt-2 h-auto min-h-10 whitespace-normal" disabled={busy} onClick={()=>selectMaterial(index,proposed.id)}>Confirmar insumo sugerido do item {index+1}</Button></div>}
              {!selected&&!link.skipStock&&suggestion?.ambiguous&&<p className="text-sm text-muted-foreground">Há mais de um insumo parecido. Escolha o material e a cor corretos abaixo.</p>}
              <SearchableItemSelect label={`Insumo do item ${index+1}`} value={link.itemId} emptyLabel="Escolher insumo existente" disabled={busy||materialsQuery.isLoading||!!materialsQuery.error||link.skipStock} options={materials.map(material=>({id:material.id,label:purchaseMaterialLabel(material)}))} onChange={id=>selectMaterial(index,id)}/>
              {selected ? <div className="space-y-3 rounded-md bg-muted/30 p-3"><p className="text-sm">Nome no estoque: <strong>{selected.name}</strong></p><details className="text-sm"><summary className="cursor-pointer">Alterar nome do insumo</summary><div className="mt-2 space-y-2"><Input aria-label={`Nome interno do item ${index+1}`} value={link.name} disabled={busy} onChange={event=>changeLink(index,{name:event.target.value})}/><Button type="button" variant="outline" disabled={busy||!link.name.trim()||link.name.trim()===selected.name} onClick={()=>{setError('');rename.mutate({id:selected.id,name:link.name});}}>Atualizar nome no estoque do item {index+1}</Button><p className="text-xs text-muted-foreground">Altera o cadastro compartilhado desse insumo; a descrição da nota permanece igual.</p></div></details><PurchaseStockQuantity key={selected.id} label={item.fiscalDescription} value={link.stockQuantity} purchasedQuantity={item.quantity} purchaseUnit={item.purchaseUnit} stockUnit={selected.unit} onChange={value=>changeLink(index,{stockQuantity:value})} disabled={busy}/></div> : !link.skipStock&&<div className="space-y-2"><label className="block text-sm">Nome do novo insumo<Input aria-label={`Nome interno do item ${index+1}`} value={link.name} disabled={busy} onChange={event=>changeLink(index,{name:event.target.value})}/></label><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||!link.name.trim()} onClick={()=>setNewItem({index,kind:'filament'})}>Cadastrar filamento do item {index+1}</Button><Button type="button" variant="outline" disabled={busy||!link.name.trim()} onClick={()=>setNewItem({index,kind:'other'})}>Cadastrar outro insumo do item {index+1}</Button></div></div>}
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={link.skipStock} disabled={busy} onChange={event=>changeLink(index,{skipStock:event.target.checked,itemId:'',stockQuantity:''})}/><span>Este item é uma despesa ou serviço sem controle de estoque</span></label>
            </article>;
          })}
        </section>
        <section className="space-y-4 border-t pt-4"><h3 className="font-semibold">Pagamento e plano de contas</h3>
          {invoice.payments.length>0?<div className="rounded-md bg-muted/30 p-3 text-sm"><p className="mb-2 font-medium">Pagamento declarado na nota</p>{invoice.payments.map((payment,index)=><p key={index}>{nfePaymentLabel(payment.code)} ({payment.code}){payment.description?` · ${payment.description}`:''} · {currency(payment.amount)}</p>)}<p className="mt-2 text-xs text-muted-foreground">Confira a forma correspondente no seu cadastro. A nota não registra uma baixa bancária no Forge.</p></div>:<p className="text-sm text-muted-foreground">A nota não informa a forma de pagamento. Selecione a condição combinada com o fornecedor.</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createPayables} disabled={busy} onChange={event=>setCreatePayables(event.target.checked)}/>Lançar parcelas no financeiro</label>
          {createPayables?<><PurchaseFinancialFields value={classification} onChange={setClassification} disabled={busy} onBusyChange={setChildBusy} onMethodsLoaded={setPaymentMethods}/><InstallmentEditor total={invoice.total} count={count} firstDate={firstDate} days={days} parts={parts} onCount={value=>{setCount(value);setPartMethods([]);}} onFirstDate={setFirstDate} onDays={setDays} onParts={setParts} disabled={busy}/>{parts.length>0&&<details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer">Formas de pagamento diferentes por parcela</summary><p className="my-2 text-muted-foreground">A forma da compra vale por padrão. Ajuste cada parcela se o acordo tiver mais de uma forma de pagamento.</p><div className="grid gap-3 sm:grid-cols-2">{parts.map((part,index)=><label key={index}>Parcela {index+1} · {part.due_date}<select aria-label={`Forma de pagamento da parcela ${index+1}`} className="mt-1 h-11 w-full rounded-md border bg-background px-3" value={partMethods[index]||''} disabled={busy} onChange={event=>setPartMethods(values=>Array.from({length:parts.length},(_,i)=>i===index?event.target.value:values[i]||''))}><option value="">Usar forma da compra</option>{paymentMethods.map(method=><option key={method.id} value={method.id}>{method.name}</option>)}</select></label>)}</div></details>}{invoice.billing.duplicates.length===0&&<p className="text-sm text-muted-foreground">O XML não trouxe duplicatas. Informe o vencimento combinado; nenhuma data foi presumida.</p>}</>:<p className="text-sm text-muted-foreground">A compra será salva sem contas a pagar. Isso não registra que ela foi paga.</p>}
        </section>
        <label className="flex items-start gap-3 rounded-lg border p-4 text-sm"><input type="checkbox" checked={receive} disabled={busy} onChange={event=>setReceive(event.target.checked)}/><span><strong>Já recebi os insumos</strong><span className="mt-1 block text-muted-foreground">Ao importar, a entrada atualiza o saldo e o custo médio dos insumos vinculados. Desmarcado: salvar pendente para receber depois.</span></span></label>
      </>}
      {error&&<p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    </div><DialogFooter className="shrink-0 border-t p-4"><Button type="button" variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>Cancelar</Button>{invoice&&<><Button type="button" variant="outline" disabled={busy} onClick={()=>fileInput.current?.click()}>Trocar Arquivo</Button><Button type="button" disabled={busy||!!catalogueError||materialsQuery.isLoading||vendorQuery.isLoading} onClick={()=>{setError('');save.mutate();}}>{save.isPending?'Importando…':receive?'Importar e Receber':'Importar NFe'}</Button></>}</DialogFooter>
    <PartnerDialog key={`${invoice?.nfeKey}:vendor`} kind="vendor" open={vendorOpen} initialValues={supplierDefaults} onBusyChange={setChildBusy} onClose={()=>setVendorOpen(false)} onSaved={id=>setVendorId(id)}/>
    {newItem?.kind==='other'&&<QuickInventoryItem key={`${invoice?.nfeKey}:${newItem.index}`} open initialName={links[newItem.index].name} purchaseContext onBusyChange={setChildBusy} onClose={()=>setNewItem(null)} onCreated={item=>void selectCreatedItem(item.id,newItem.index)}/>}
    {newItem?.kind==='filament'&&<FilamentRegistration key={`${invoice?.nfeKey}:${newItem.index}`} initialName={links[newItem.index].name} onBusyChange={setChildBusy} onClose={()=>setNewItem(null)} onSaved={id=>selectCreatedItem(id,newItem.index)}/>}
  </DialogContent></Dialog>;
}
