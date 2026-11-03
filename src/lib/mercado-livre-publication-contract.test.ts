import {beforeEach,describe,expect,it,vi} from 'vitest';
import {acceptMercadoLivrePublicationQuote,browseMercadoLivreCategories,quoteMercadoLivrePublication,readMercadoLivrePublicationReference,searchMercadoLivreCatalog,searchMercadoLivreCategories} from './mercado-livre-workspace';
import type {IntegradorBridgeBinding} from './mercado-livre-integration';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('./mercado-livre-integration',()=>({requestIntegradorWorkspace:mock.request}));
// Generated offline by the actual Source createForgePublicationPricing factory
// with synthetic provider reads; the fixed fee is already inside commission_amount.
const sourceQuote={account_id:'a1000000-0000-4000-8000-000000000001',product_id:'a1000000-0000-4000-8000-000000000002',seller_id:'3694120570',forge_revision:'f'.repeat(64),unit_cost:30,cost_revision:'factory-r1',policy_revision:'policy-r1',unit_price:100,category_id:'MLB123',
 quotes:[{listing_type_id:'gold_special',commission_amount:14,commission_percent:12,fixed_fee:2,shipping_cost:9,shipping_coverage:'Todo o país',receives:77,profit:32,margin_percent:32,tax_provision:10,advertising_cost:3,other_cost:2,official_revision:'c198c9f2a567db4c3521cc2aa2289736af101eb184830d997e61bab389de5ac5',complete:true,issues:[]},
 {listing_type_id:'gold_pro',commission_amount:18,commission_percent:16,fixed_fee:2,shipping_cost:9,shipping_coverage:'Todo o país',receives:73,profit:28,margin_percent:28,tax_provision:10,advertising_cost:3,other_cost:2,official_revision:'1a19d6400384fb4a51f1cc9aee88223b1c226059ed064683bd87ea0dce0a008c',complete:true,issues:[]}],
 assumptions:{tax_provision_percent:10,minimum_margin_percent:20},revision:'654be1f4aa75cf907fdac414f8fbf3b0d24b25253bda14f24837d7801b94f41c',quoted_at:'2026-11-02T12:00:00.000Z'};
const binding={bridge_id:'a1000000-0000-4000-8000-000000000003'} as IntegradorBridgeBinding,context={userId:'a1000000-0000-4000-8000-000000000004'},seller=sourceQuote.seller_id,account=sourceQuote.account_id,product=sourceQuote.product_id,requestId='a1000000-0000-4000-8000-000000000005';
const draft={category_id:'MLB123',category_confirmed:true,listing_type_id:'gold_special' as const,shipping:{mode:'me2' as const,free_shipping:false,local_pick_up:false}};
const receipt=()=>({confirmed:true,account_id:account,product_id:product,seller_id:seller,acceptance_id:'a1000000-0000-4000-8000-000000000006',unit_price:100,listing_type_id:'gold_special',request_id:requestId,quote_revision:sourceQuote.revision,replayed:false});
const quote=()=>quoteMercadoLivrePublication(binding,seller,account,product,draft,context,100);
const accept=()=>acceptMercadoLivrePublicationQuote(binding,seller,account,product,draft,100,'gold_special',sourceQuote.revision,requestId,context);
beforeEach(()=>mock.request.mockReset());
describe('Publication discovery and official-price client contracts',()=>{
 it('decodes the real Source pricing factory without adding its fixed fee twice or discarding company expenses',async()=>{
  mock.request.mockResolvedValue(structuredClone(sourceQuote));const result=await quote();expect(result.unit_cost).toBe(30);expect(result.quotes[0]).toMatchObject({commission_amount:14,fixed_fee:2,shipping_cost:9,receives:77,tax_provision:10,advertising_cost:3,other_cost:2,profit:32});expect(result.quotes[1].profit).toBe(28);
  expect(mock.request).toHaveBeenCalledExactlyOnceWith(binding,'publication_quote',seller,{account_id:account,product_id:product,draft,unit_price:100},context);
 });
 it.each([
  ['seller_id','999'],['account_id','other-account'],['product_id','other-product'],['request_id','other-request'],['quote_revision','e'.repeat(64)],['unit_price',101],['listing_type_id','gold_pro'],
 ])('rejects an accepted-price receipt with mismatched %s',async(field,value)=>{
  mock.request.mockResolvedValue({...receipt(),[field]:value});await expect(accept()).rejects.toThrow('não corresponde');expect(mock.request).toHaveBeenCalledTimes(1);
 });
 it('confirms only the selected quote, product, seller and immutable command while excluding unknown private fields',async()=>{
  mock.request.mockResolvedValue({...receipt(),access_token:'SYNTHETIC_PRIVATE',source_proof:'SYNTHETIC_PRIVATE'});const result=await accept();expect(result.acceptance_id).toBe(receipt().acceptance_id);expect(result).not.toHaveProperty('access_token');expect(result).not.toHaveProperty('source_proof');
  expect(mock.request).toHaveBeenCalledExactlyOnceWith(binding,'publication_quote_accept',seller,{account_id:account,product_id:product,draft,unit_price:100,listing_type_id:'gold_special',expected_quote_revision:sourceQuote.revision,request_id:requestId,acknowledge_marketplace_write:true},context);
 });
 it('rejects a quotation for a different seller, account, product or requested price before showing it as this quote',async()=>{
  for(const change of[{seller_id:'999'},{account_id:'other-account'},{product_id:'other-product'},{unit_price:101}]){mock.request.mockResolvedValueOnce({...structuredClone(sourceQuote),...change});await expect(quote()).rejects.toThrow('não corresponde');}
 });
 it('keeps unconfirmed official fees null rather than turning a missing tariff into free selling',async()=>{
  const value=structuredClone(sourceQuote);Object.assign(value.quotes[0],{commission_amount:null,commission_percent:null,fixed_fee:null,shipping_cost:null,receives:null,profit:null,margin_percent:null,complete:false,issues:['A tarifa ainda não foi confirmada.']});mock.request.mockResolvedValue(value);const result=await quote();expect(result.quotes[0].complete).toBe(false);for(const field of['commission_amount','commission_percent','fixed_fee','shipping_cost','receives','profit'] as const)expect(result.quotes[0][field]).toBeNull();expect(result.quotes[0].advertising_cost).toBe(3);expect(result.quotes[1].complete).toBe(true);
 });
 it('accepts the provider category path string and unknown leaf state without inventing a leaf category',async()=>{
  const value={items:[{id:'MLB123',name:'Decoração',path:'Casa > Decoração',leaf:null}],path:[{id:'MLB100',name:'Casa'}]};mock.request.mockResolvedValue(value);const found=await searchMercadoLivreCategories(binding,seller,'decoração',context);expect(found.items[0].path).toBe('Casa > Decoração');expect(found.items[0].leaf).toBeNull();expect(mock.request).toHaveBeenLastCalledWith(binding,'publication_categories',seller,{q:'decoração'},context);
  await browseMercadoLivreCategories(binding,seller,undefined,context);expect(mock.request).toHaveBeenLastCalledWith(binding,'publication_categories',seller,{},context);await browseMercadoLivreCategories(binding,seller,'MLB100',context);expect(mock.request).toHaveBeenLastCalledWith(binding,'publication_categories',seller,{category_id:'MLB100'},context);
 });
 it('preserves catalog attributes and unknown category/value facts while searching the actual catalog endpoint',async()=>{
  mock.request.mockResolvedValue({items:[{id:'MLB100001',name:'Caneca decorativa',domain_id:'MLB-MUGS',category_id:null,permalink:null,attributes:[{id:'COLOR',name:'Cor',value_name:null}]}]});const result=await searchMercadoLivreCatalog(binding,seller,'caneca',context);expect(result.items[0].category_id).toBeNull();expect(result.items[0].attributes[0].value_name).toBeNull();expect(mock.request).toHaveBeenCalledExactlyOnceWith(binding,'publication_catalog_search',seller,{q:'caneca'},context);
 });
 it('accepts sanitized reference attributes with omitted value IDs and refuses an unexpected null ID',async()=>{
  const reference={mode:'own',catalog_product_id:null,reference_item_id:'MLB123',title:'Caneca de referência',description:null,category_id:'MLB100',pictures:[{url:'https://http2.mlstatic.com/photo.jpg'}],attributes:[{id:'BRAND',value_name:'Genérica'}],issues:[]};mock.request.mockResolvedValue(reference);const result=await readMercadoLivrePublicationReference(binding,seller,'https://produto.mercadolivre.com.br/MLB-123',context);expect(result.attributes[0]).toEqual({id:'BRAND',value_name:'Genérica'});expect(Object.prototype.hasOwnProperty.call(result.attributes[0],'value_id')).toBe(false);expect(mock.request).toHaveBeenLastCalledWith(binding,'publication_reference',seller,{reference:'https://produto.mercadolivre.com.br/MLB-123'},context);
  mock.request.mockResolvedValue({...reference,attributes:[{id:'BRAND',value_id:null,value_name:'Genérica'}]});await expect(readMercadoLivrePublicationReference(binding,seller,'MLB123',context)).rejects.toThrow('não confirmou');
 });
});
