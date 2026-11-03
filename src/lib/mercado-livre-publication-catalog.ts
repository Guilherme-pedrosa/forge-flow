import {z} from 'zod';
import {marketplaceRpc} from './marketplace-orders';
import type {IntegradorBridgeBinding} from './mercado-livre-integration';
const id=z.string().min(1),amount=z.number().finite().nonnegative().nullable();
export const publicationCatalogSchema=z.object({items:z.array(z.object({id,name:z.string(),sku:z.string().nullable(),category:z.string().nullable(),photo_url:z.string().nullable(),base_price:amount,ml_price:amount,available:z.number().int().nonnegative().nullable(),stock_complete:z.boolean(),listings:z.array(z.object({item_id:id,status:z.string().nullable(),permalink:z.string().nullable()})),issues:z.array(z.string())})).max(20),total:z.number().int().nonnegative(),next_offset:z.number().int().nonnegative().nullable()});
export type MercadoLivrePublicationCatalog=z.infer<typeof publicationCatalogSchema>;
export type PublicationCatalogFilters={q?:string;publication:'all'|'unlisted'|'listed';stock:'all'|'available'|'empty'|'unknown';offset:number;limit?:20;sort?:'name'|'stock_asc'|'stock_desc'|'price_asc'|'price_desc'};
export async function readMercadoLivrePublicationCatalog(binding:IntegradorBridgeBinding,seller:string,accountId:string,filters:PublicationCatalogFilters,context:{userId:string;signal?:AbortSignal}):Promise<MercadoLivrePublicationCatalog>{
 context.signal?.throwIfAborted();
 if(!context.userId||!binding.configured||!binding.enabled||!binding.approved_seller_ids.includes(seller)||!binding.account_mappings.some(row=>row.account_id===accountId&&row.bridge_id===binding.bridge_id&&row.source_seller_id===seller))throw new Error('Confira a associação da conta antes de escolher os produtos.');
 const value=await marketplaceRpc('marketplace_publication_catalog',{p_account_id:accountId,p_q:(filters.q??'').trim(),p_publication:filters.publication,p_stock:filters.stock,p_offset:filters.offset,p_limit:filters.limit??20,p_sort:filters.sort??'name'});context.signal?.throwIfAborted();
 const result=publicationCatalogSchema.safeParse(value);if(!result.success)throw new Error('O catálogo desta empresa não foi confirmado. Atualize a consulta para continuar.');return result.data;
}
