import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

const output = 'artifacts/commercial-pdf';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  for (const scenario of ['order', 'quote', 'converted-order', 'long', 'missing-image', 'company-error']) {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); const errors = [], mutations = []; let popups = 0, prints = 0;
    page.on('pageerror', error => errors.push(error.message)); page.on('popup', () => popups++);
    await page.exposeFunction('recordPrint', () => prints++);
    await page.addInitScript(() => { window.print = () => window.recordPrint(); });
    const logo = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 180;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#386F68'; ctx.fillRect(0, 0, 180, 180);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 66px Arial'; ctx.textAlign = 'center'; ctx.fillText('E3D', 90, 113);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const imageUrl = 'https://gaomleftwxpzjivrnzjk.supabase.co/storage/v1/object/public/attachments/tenant/logo.png';
    const company = { name: 'Elevare 3D', logo_url: imageUrl, settings: { phone: '62983017676', email: 'contato@example.test', address: { street: 'Rua PB48', complement: 'q5 l57', neighborhood: 'Parque Brasilia', city: 'Anápolis', state: 'GO', zip: '75093630' } } };
    const customer = { name: 'Cliente Demonstração', document: '000.000.000-00', email: 'cliente@example.test', phone: '(62) 90000-0000', address: { street: 'Rua São José', number: '100', city: 'Anápolis', state: 'GO' } };
    const long = scenario === 'long';
    const code = long ? 'ORC-TESTE-075' : scenario === 'converted-order' ? 'PED-20260420-003' : 'ORC-20260420-003';
    const base = { id: 'document', code, status: 'draft', tenant_id: 'tenant', created_at: '2026-04-20T18:33:04Z', due_date: '2026-05-07', valid_until: '2026-04-30', payment_due_date: '2026-05-07', discount: 5, shipping: 10, subtotal: long ? 7492.5 : 99.9, total: long ? 7497.5 : 104.9, customers: customer, customer_snapshot: customer, notes: long ? ('Personalização: impressão 3D com acabamento fosco e embalagem individual.\n').repeat(65) + 'FIM DAS OBSERVAÇÕES' : 'Personalização: nome em dourado. Embalagem individual para presente.', payment_schedule: [{ amount: 52.45, due_date: '2026-04-25' }, { amount: 52.45, due_date: '2026-05-07' }] };
    if (long) base.payment_schedule = base.payment_schedule.map(part => ({ ...part, amount: 3748.75 }));
    if (scenario === 'converted-order') { base.status = 'approved'; base.source_quote_id = 'quote-origin'; }
    const items = Array.from({ length: long ? 75 : 1 }, (_, i) => ({ id: `item-${i}`, line_index: i, order_id: 'document', quote_id: 'document', description: long ? `Item ${i + 1} - Maçã termoformável com caule e folha para presente personalizado` : 'Kit Nossa Senhora Aparecida', quantity: 1, unit_price: 99.9, total: 99.9, notes: 'Acabamento fosco', products: scenario === 'order' ? { photo_url: imageUrl } : null, product_snapshot: { complete: true, cost_per_unit: 32.17, requirements: [{ item_id: 'material', material_type: 'PLA', color: 'Dourado', grams_per_unit: 15 }] }, estimated_unit_cost: 32.17, estimated_total_cost: 32.17 }));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/src/contexts/AuthContext.tsx') return route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;` });
      if (url.pathname.includes('/storage/v1/')) return route.fulfill({ status: scenario === 'missing-image' ? 404 : 200, contentType: 'image/png', body: Buffer.from(logo, 'base64') });
      if (url.pathname.includes('/rest/v1/')) {
        if (request.method() !== 'GET') mutations.push(request.method() + ' ' + url.pathname);
        const name = url.pathname.split('/').pop();
        if (name === 'tenants' && scenario === 'company-error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Falha temporária' }) });
        const data = ({ orders: [base], order_items: items, sales_quotes: scenario === 'converted-order' ? base : [base], sales_quote_items: items, tenants: company, customers: [customer], accounts_receivable: [] })[name] || [];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (url.hostname !== '127.0.0.1') return route.fulfill({ contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    const isOrder = ['order', 'converted-order', 'missing-image', 'company-error'].includes(scenario);
    await page.goto(`http://127.0.0.1:5174/comercial/${isOrder ? 'pedidos?pedido=document' : 'orcamentos'}`);
    if (!isOrder) await page.getByRole('button', { name: `Abrir ${code}`, exact: true }).click();
    const button = page.getByRole('button', { name: 'Baixar PDF', exact: true }); await expect(button).toBeEnabled();
    if (scenario === 'company-error') {
      let downloaded = false; page.on('download', () => { downloaded = true; }); await button.click();
      await expect(page.getByText('Não foi possível gerar o PDF', { exact: true })).toBeVisible();
      await expect(button).toBeEnabled(); expect(downloaded).toBe(false);
    } else {
      const downloadPromise = page.waitForEvent('download'); await button.click(); const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`${scenario === 'converted-order' ? 'Pedido' : 'Orcamento'}-${code}.pdf`);
      const file = `${output}/${scenario}.pdf`; await download.saveAs(file);
      const bytes = await readFile(file); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.length).toBeGreaterThan(1500);
      await expect(page.getByText('PDF baixado', { exact: true })).toBeVisible();
      if (scenario === 'missing-image') await expect(page.getByText('O documento foi gerado. Algumas imagens estavam indisponíveis e não foram incluídas.', { exact: true })).toBeVisible();
      await expect(button).toBeEnabled();
    }
    expect(errors).toEqual([]); expect(mutations).toEqual([]); expect(popups).toBe(0); expect(prints).toBe(0);
    console.log(`PASS ${scenario}: real PDF download, no print dialog, no database mutations.`);
    await context.close();
  }
} finally { await browser.close(); }
