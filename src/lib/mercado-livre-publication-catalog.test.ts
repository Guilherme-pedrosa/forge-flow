import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readMercadoLivrePublicationCatalog} from './mercado-livre-publication-catalog';
import type {IntegradorBridgeBinding} from './mercado-livre-integration';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('./marketplace-orders',()=>({marketplaceRpc:mock.rpc}));
const binding:IntegradorBridgeBinding={configured:true,enabled:true,bridge_id:'bridge-a',source_url:'https://integradorwedo.lovable.app',revision:'r1',approved_seller_ids:['3694120570'],account_mappings:[{account_id:'account-a',bridge_id:'bridge-a',source_seller_id:'3694120570'}]};
const filters={q:'  Caneca  ',publication:'unlisted',stock:'available',offset:20,limit:20,sort:'stock_desc'} as const;
const row=(change:Record<string,unknown>={})=>({id:'product-a',name:'Caneca',sku:'CAN',category:'printed_part',photo_url:null,base_price:20,ml_price:30,available:2,stock_complete:true,listings:[],issues:[],...change});
const call=(options:Partial<IntegradorBridgeBinding>={},context:{userId:string;signal?:AbortSignal}={userId:'owner-a'})=>readMercadoLivrePublicationCatalog({...binding,...options},'3694120570','account-a',filters,context);
beforeEach(()=>mock.rpc.mockReset().mockResolvedValue({items:[row()],total:21,next_offset:null}));
describe('canonical ML publication catalog client',()=>{
 it('requires the exact approved seller/account/bridge before reading the company catalog',async()=>{
  for(const invalid of[{configured:false},{enabled:false},{approved_seller_ids:['999']},{account_mappings:[{account_id:'account-a',bridge_id:'foreign',source_seller_id:'3694120570'}]}])await expect(call(invalid)).rejects.toThrow('associação');expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('uses the paginated canonical RPC with global filters and never asks a provider for stock',async()=>{
  const result=await call();expect(result.items[0].base_price).toBe(20);expect(result.items[0].ml_price).toBe(30);expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('marketplace_publication_catalog',{p_account_id:'account-a',p_q:'Caneca',p_publication:'unlisted',p_stock:'available',p_offset:20,p_limit:20,p_sort:'stock_desc'});
 });
 it('preserves known zero separately from unknown stock and does not substitute a price for either',async()=>{
  mock.rpc.mockResolvedValue({items:[row({id:'zero',available:0,ml_price:null}),row({id:'unknown',available:null,stock_complete:false,ml_price:null})],total:2,next_offset:null});const result=await call();expect(result.items[0].available).toBe(0);expect(result.items[0].stock_complete).toBe(true);expect(result.items[1].available).toBeNull();expect(result.items[1].stock_complete).toBe(false);expect(result.items.every(item=>item.ml_price===null)).toBe(true);
 });
 it('rejects malformed quantities or an oversized provider-looking catalog page instead of displaying invented results',async()=>{
  for(const items of[[row({available:-1})],Array.from({length:21},()=>row())]){mock.rpc.mockResolvedValueOnce({items,total:items.length,next_offset:null});await expect(call()).rejects.toThrow('catálogo');}
 });
 it('discards an aborted old company read even if its RPC resolves later',async()=>{
  const controller=new AbortController();let complete!:(value:unknown)=>void;mock.rpc.mockReturnValueOnce(new Promise(resolve=>{complete=resolve;}));const pending=call({}, {userId:'owner-a',signal:controller.signal});controller.abort();complete({items:[row()],total:1,next_offset:null});await expect(pending).rejects.toThrow();
 });
});
