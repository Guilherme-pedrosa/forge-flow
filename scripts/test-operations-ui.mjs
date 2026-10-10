// Browser checks use intercepted fixture responses; no operational database writes.
import { chromium, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const base = process.env.FORGE_TEST_URL || 'http://127.0.0.1:5174';
const output = process.env.FORGE_TEST_ARTIFACTS || '/tmp/forge-operations-review';
await mkdir(output, { recursive: true });
const executablePath = process.env.FORGE_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date(), later = new Date(now.getTime() + 2 * 86400000).toISOString();
const tenant = id(1), product = id(2), material = id(3), machine = id(4), order = id(5), account = id(6);
const tables = {
  tenants: { id: tenant, name: 'Farm de revisão', timezone: 'America/Sao_Paulo', settings: {} },
  orders: [
    { id: order, tenant_id: tenant, code: 'PED-QA', status: 'in_production', total: 60, due_date: later.slice(0, 10), ship_by_at: later, internal_due_at: null, workflow_issues: [], workflow_checked_at: null, customer_id: id(7), created_at: now.toISOString(), customers: { name: 'Cliente de revisão' } },
    { id: id(8), tenant_id: tenant, code: 'PED-PRONTO', status: 'ready', total: 30, ship_by_at: later, due_date: null, workflow_issues: [] },
  ],
  order_items: [{ id: id(9), order_id: order, tenant_id: tenant, product_id: product, description: 'Produto de revisão', quantity: 2, unit_price: 30, total: 60, material_overrides: [], products: { name: 'Produto de revisão' } }],
  products: [{ id: product, name: 'Produto de revisão', sku: 'QA-3D', category: 'printed_part', is_active: true, sale_price: 30, est_grams: 350, est_time_minutes: 120, prints_per_plate: 2 }],
  customers: [{ id: id(7), name: 'Cliente de revisão', is_active: true }],
  printers: [{ id: machine, tenant_id: tenant, name: 'A1 de revisão', model: 'Bambu A1', status: 'idle', is_active: true }],
  jobs: [{ id: id(10), tenant_id: tenant, code: 'OI-QA', name: 'Placa de revisão', status: 'queued', printer_id: machine, order_id: order, production_order_id: id(11), production_order_item_id: id(12), priority: 5, est_grams: 350, est_time_minutes: 120, material_id: material, secondary_material_id: null, print_plate_id: null, inventory_posted_at: null, due_date: later.slice(0, 10), production_snapshot: null, created_at: now.toISOString(), products: { name: 'Produto de revisão' } }],
  production_orders: [{ id: id(11), tenant_id: tenant, code: 'OP-QA', status: 'released', source_order_id: order, due_date: later.slice(0, 10) }],
  production_order_items: [{ id: id(12), production_order_id: id(11), product_id: product, description: 'Produto de revisão', quantity: 2, production_snapshot: null }],
  inventory_items: [{ id: material, tenant_id: tenant, name: 'PLA Preto de revisão', category: 'filament', unit: 'kg', current_stock: 0.4, min_stock: 0.8, avg_cost: 70, is_active: true, vendor_id: id(13), material_code: 'PLA', color: 'Preto' }],
  vendors: [{ id: id(13), name: 'Fornecedor de revisão', is_active: true }],
  filament_spools: [{ id: id(14), item_id: material, label: 'Bobina QA 01', tare_grams: 200, initial_net_grams: 1000, estimated_remaining_grams: 400, measured_gross_grams: 600, measured_at: now.toISOString(), weight_source: 'manual_weighing', location_kind: 'storage', location_label: 'Prateleira 1', printer_id: null, needs_weighing: false, is_active: true }],
  filament_active_reservations: [], filament_replenishment_policies: [], purchase_orders: [], purchase_order_items: [],
  marketplace_accounts: [{ id: account, channel: 'mercado_livre', name: 'Loja de revisão', external_seller_id: '12345', connection_state: 'pending_credentials', last_sync_at: null }, { id: id(21), channel: 'shopee', name: 'Shopee de revisão', external_seller_id: null, connection_state: 'pending_access', last_sync_at: null }],
  marketplace_orders: [],
  bank_accounts: [{ id: id(22), name: 'Banco de revisão', is_active: true }],
  marketplace_receivable_positions: [{ receivable_id: id(23), tenant_id: tenant, channel: 'mercado_livre', account_name: 'Loja de revisão', external_order_id: 'QA-123', order_code: 'PED-QA', description: 'Pedido QA', status: 'open', due_date: later.slice(0, 10), gross_sale_amount: 60, gross_title_amount: 60, available_gross: 60, outstanding_gross: 60, liquidated_gross: 0, net_bank: 0, retained_open: 0, refunded_gross: 0 }],
};
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/src/contexts/AuthContext.tsx') return route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({profile:{id:'${id(20)}',user_id:'${id(20)}',tenant_id:'${tenant}',display_name:'Revisão',email:'qa@example.invalid'},user:{id:'${id(20)}'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;` });
      if (url.pathname.includes('/rest/v1/')) {
        if (request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Este teste não permite gravações.' }) }); }
        const table = url.pathname.split('/').pop();
        let data = tables[table] ?? [];
        if (!Array.isArray(data) && !request.headers().accept?.includes('object+json')) data = [data];
        if (Array.isArray(data) && request.headers().accept?.includes('object+json')) data = data[0] ?? null;
        const offset = Number(request.headers().range?.split('-')[0] || url.searchParams.get('offset') || 0);
        if (offset > 0 || url.searchParams.get('limit') === '0') data = [];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (url.origin === base) return route.continue();
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    });
    async function check(path, title, label, settledText) {
      await page.goto(`${base}${path}`);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      if (settledText) await expect(page.getByText(settledText, { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `${label}: viewport overflow`).toBe(false);
      await page.screenshot({ path: `${output}/${label}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    await check('/', 'Hoje', 'hoje', 'PED-QA');
    await expect(page.getByRole('link', { name: /PED-PRONTO/ })).toContainText('Embalar e postar');
    await expect(page.getByRole('link', { name: /PED-QA/ })).toHaveAttribute('href', `/comercial/pedidos?pedido=${order}`);
    await check('/estoque/bobinas', 'Bobinas e filamentos', 'bobinas', 'Bobina QA 01');
    await page.getByRole('button', { name: 'Pesar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth + 1), 'weighing dialog overflow').toBe(false);
    await page.screenshot({ path: `${output}/pesagem-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await check('/estoque/reposicao', 'Reposição de filamentos', 'reposicao', 'Sugestões por fornecedor');
    await expect(page.getByRole('link', { name: 'Revisar só este material', exact: true })).toHaveAttribute('href', /reposicao_item=/);
    await expect(page.getByRole('link', { name: 'Revisar compra do fornecedor', exact: true })).toHaveAttribute('href', /reposicao_itens=/);
    await check('/comercial/marketplaces', 'Vendas dos marketplaces', 'marketplaces', 'Importar pedidos de Mercado Livre');
    await expect(page.getByRole('checkbox', { name: /Organizar os pedidos elegíveis/ })).not.toBeChecked();
    await page.getByLabel('Conta', { exact: true }).selectOption(id(21));
    await expect(page.getByRole('button', { name: 'Autorizar Shopee', exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/shopee-${width}.png`, fullPage: true, animations: 'disabled' });
    await check('/financeiro/repasses', 'Repasses dos marketplaces', 'repasses');
    await page.getByRole('combobox', { name: 'Recebível do marketplace' }).selectOption(id(23));
    await expect(page.getByLabel('Bruto deste evento', { exact: true })).toHaveValue('60');
    await page.getByLabel('Tarifas debitadas pelo canal', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Usar valor conferido' }).click();
    await expect(page.getByLabel('Líquido real no banco', { exact: true })).toHaveValue('50');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), 'payout form viewport overflow').toBe(false);
    await page.screenshot({ path: `${output}/repasse-formulario-${width}.png`, fullPage: true, animations: 'disabled' });
    await check('/planejamento/capacidade', 'Simular prazo', 'capacidade');
    expect(writes, 'reading and simulating must not write to the database').toEqual([]);
    expect(errors, 'browser runtime errors').toEqual([]);
    console.log(`PASS ${width}px: Hoje, próximo passo, bobinas/pesagem, reposição, ML/Shopee, política, repasses e simulação; nenhuma gravação.`);
    await page.close();
  }
} finally { await browser.close(); }
