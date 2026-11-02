import { supabase } from '@/integrations/supabase/client';
import { allRows } from './finance';

export type PurchaseMaterial = {
  id: string; name: string; sku: string | null; unit: string; category: string | null;
  material_code: string | null; color: string | null; color_code: string | null;
  avg_cost: number; current_stock: number; vendor_id?: string | null;
};

/** A product owns its stock even when archived. Load both complete catalogues or fail closed. */
export async function loadPurchaseMaterials(tenant: string) {
  const results = await Promise.allSettled([
    allRows<PurchaseMaterial>((from, to) => supabase.from('inventory_items')
      .select('id,name,sku,unit,category,material_code,color,color_code,avg_cost,current_stock,vendor_id')
      .eq('tenant_id', tenant).eq('is_active', true).order('name').order('id').range(from, to)),
    allRows<{ stock_item_id: string | null }>((from, to) => supabase.from('products')
      .select('stock_item_id').eq('tenant_id', tenant).order('id').range(from, to)),
  ]);
  if (results[0].status === 'rejected') throw results[0].reason;
  if (results[1].status === 'rejected') throw results[1].reason;
  const productStockItemIds = results[1].value.flatMap(row => row.stock_item_id ? [row.stock_item_id] : []);
  const excluded = new Set(productStockItemIds);
  return { items: results[0].value.filter(item => !excluded.has(item.id) && !['product', 'finished_product'].includes(item.category?.trim().toLowerCase() ?? '')), productStockItemIds };
}
