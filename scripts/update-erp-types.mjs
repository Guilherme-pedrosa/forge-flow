import { readFile, writeFile } from 'node:fs/promises';
const target=new URL('../src/integrations/supabase/types.ts',import.meta.url);
let source=await readFile(target,'utf8');
const columns={
  jobs:{ inventory_posted_at:'string | null', secondary_actual_grams:'number | null',order_item_id:'string | null',order_unit_index:'number | null',est_extras_cost:'number | null',actual_extras_cost:'number | null',creation_request_id:'string | null',actual_time_seconds:'number | null',actual_material_usage:'Json | null',produced_quantity:'number | null',print_plate_id:'string | null',planned_quantity:'number' },
  products:{actual_print_grams_per_unit:'number | null',actual_print_seconds_per_unit:'number | null',actual_print_cost_per_unit:'number | null',actual_print_sample_units:'number | null',actual_print_updated_at:'string | null',actual_print_source:'string | null'},
  accounts_payable:{origin_id:'string | null',origin_type:'string | null'},
  orders:{shipping:'number',source_quote_id:'string | null'}, order_items:{source_quote_item_id:'string | null',product_snapshot:'Json | null'}, purchase_orders:{additional_costs:'number'},
  purchase_order_items:{stock_quantity:'number | null'},consignment_locations:{commission_percent:'number'},
};
Object.assign(columns.jobs, { production_snapshot: 'Json | null', production_snapshot_origin: 'string | null', production_snapshot_at: 'string | null', print_file_snapshot: 'Json | null' });
Object.assign(columns.orders, { requires_material_recipe: 'boolean' });
Object.assign(columns.order_items, { quoted_estimated_cost: 'number | null' });
columns.inventory_items = { material_code: 'string | null', material_description: 'string | null', color_code: 'string | null', color_hex: 'string | null', material_identified_at: 'string | null', material_identified_by: 'string | null' };
for(const [table, fields] of Object.entries(columns)) {
  const start=source.indexOf(`      ${table}: {`);
  if(start<0) throw Error(`Missing table ${table}`);
  const next=source.slice(start+1).search(/^      [a-z_]+: \{/m);
  const end=next<0?source.indexOf('    Views:',start):start+1+next;
  let block=source.slice(start,end);
  for(const kind of ['Row','Insert','Update']) {
    const marker=`        ${kind}: {`;
    const at=block.indexOf(marker)+marker.length;
    const additions=Object.entries(fields).filter(([name])=>!block.slice(at,block.indexOf('        }',at)).includes(`          ${name}`))
      .map(([name,type])=>`\n          ${name}${kind==='Row'?'':'?'}: ${type}`).join('');
    block=block.slice(0,at)+additions+block.slice(at);
  }
  source=source.slice(0,start)+block+source.slice(end);
}
const rpcs={
  product_material_recipe_catalog:'',
  register_bank_transaction:'p_bank_account_id: string; p_type: string; p_amount: number; p_date: string; p_description: string; p_request_id: string',
  settle_financial_title:'p_kind: string; p_title_id: string; p_amount: number; p_date: string; p_bank_account_id: string; p_request_id: string',
  create_purchase_order:'p_order: Json; p_items: Json; p_installments: Json; p_request_id: string',
  receive_purchase_order:'p_order_id: string; p_received_date: string',cancel_purchase_order:'p_order_id: string',
  save_sales_order:'p_order_id: string | null; p_order: Json; p_items: Json; p_request_id: string',transition_sales_order:'p_order_id: string; p_status: string',
  save_product_with_photos:'p_product_id: string | null; p_product: Json; p_photos: Json; p_request_id: string',
  post_inventory_movement:'p_movement: Json; p_request_id: string',
  create_consignment_location:'p_location: Json; p_customer: Json | null; p_request_id: string',
  post_consignment_movement:'p_location_id: string; p_type: string; p_items: Json; p_notes: string | null; p_request_id: string',
  adjust_consignment_stock:'p_item_id: string; p_new_quantity: number; p_expected_quantity: number; p_reason: string; p_request_id: string',
  disconnect_bambu_connection:'p_connection_id: string',
  transition_job:'p_job_id: string; p_status: string; p_actual_grams?: number | null; p_actual_time_minutes?: number | null; p_waste_grams?: number | null; p_failure_reason?: string | null; p_printer_id?: string | null; p_secondary_actual_grams?: number | null; p_actual_labor_cost?: number | null; p_actual_overhead?: number | null; p_actual_extras_cost?: number | null',
  create_jobs:'p_jobs: Json; p_request_id: string',
  save_product_print_source:'p_source_id: string | null; p_product_id: string; p_source: Json',
  archive_product_print_source:'p_source_id: string',bind_product_print_source:'p_source_id: string; p_task_id: string',
  save_product_print_plate:'p_plate_id: string | null; p_product_id: string; p_source_id: string | null; p_plate: Json',
  archive_product_print_plate:'p_plate_id: string',bind_product_print_plate:'p_plate_id: string; p_task_id: string',
  plan_product_plates:'p_product_id: string; p_quantity: number; p_request_id: string',
  request_bambu_sync:'',bambu_production_preview:'p_task_id: string',
  configure_bambu_production:'p_task_id: string; p_product_id: string; p_units: number; p_materials: Json; p_auto: boolean; p_use_slicer: boolean; p_labor_cost: number; p_overhead: number; p_extras_cost: number; p_allocations: Json; p_plate_id?: string | null',
  account_bambu_production:'p_task_id: string; p_materials: Json | null; p_seconds: number | null; p_units: number | null; p_labor_cost: number | null; p_overhead: number | null; p_extras_cost: number | null; p_reason: string | null; p_request_id: string',
};
const entries=Object.entries(rpcs).filter(([name])=>!source.includes(`      ${name}:`)).map(([name,args])=>`      ${name}: { Args: { ${args} }; Returns: ${['create_jobs','plan_product_plates'].includes(name)?'string[]':['request_bambu_sync','bambu_production_preview','account_bambu_production','product_material_recipe_catalog'].includes(name)?'Json':['disconnect_bambu_connection','archive_product_print_source','archive_product_print_plate'].includes(name)?'undefined':'string'} }`).join('\n');
source=source.replace('    Functions: {',`    Functions: {\n${entries}`);
await writeFile(target,source);
