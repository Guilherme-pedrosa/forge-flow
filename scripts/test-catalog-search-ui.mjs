import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const output = 'artifacts/catalog-search';
await mkdir(output, { recursive: true });
const products = [
  ...Array.from({ length: 1120 }, (_, i) => ({ id: `product-${i}`, name: `Chaveiro personalizado modelo ${i + 1}`, sku: `CH-${String(i).padStart(3, '0')}`, sale_price: 12, is_active: true })),
  { id: 'apple-red', name: 'Maçã termoformável vermelha para presente de professores', sku: 'MA-01', sale_price: 30, is_active: true },
  { id: 'apple-green', name: 'Maçã termoformável verde', sku: 'MA-02', sale_price: 35, is_active: true },
];
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1108, height: 580 }, { width: 854, height: 480 }, { width: 390, height: 720 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(); const errors = []; const mutations = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/src/contexts/AuthContext.tsx') return route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant',display_name:'Teste'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;` });
      if (url.pathname.includes('/rest/v1/')) {
        const name = url.pathname.split('/').pop(); let data = [];
        if (url.pathname.includes('/rpc/')) {
          if (name === 'product_material_variant_preview') data = { complete: false, material_options: [], missing: ['Composição a preparar'] };
          else mutations.push(name);
        } else data = ({ products, customers: [{ id: 'customer', name: 'José da Silva' }], vendors: [{ id: 'vendor', name: 'Filamentos São Paulo' }], tenants: { name: 'Teste', settings: {} } })[name] || [];
        // Match the server's 1,000-row cap: both apples require a second page.
        if (name === 'products') { const offset=Number(url.searchParams.get('offset') || 0);data=data.slice(offset,offset+Math.min(1000,Number(url.searchParams.get('limit') || 1000))); }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (url.hostname !== '127.0.0.1') return route.fulfill({ contentType: 'application/json', body: '{}' });
      return route.continue();
    });

    const checkBounds = async locator => {
      await expect(locator).toBeVisible(); const box = await locator.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    };
    await page.goto('http://127.0.0.1:5173/comercial/orcamentos');
    await page.getByRole('button', { name: 'Novo orçamento', exact: true }).click();
    await page.getByRole('combobox', { name: 'Produto 1', exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Buscar produto 1', exact: true });
    await expect(search).toBeFocused(); await checkBounds(search);
    await checkBounds(page.locator('[cmdk-root]')); await checkBounds(page.getByRole('listbox'));
    await page.getByRole('listbox').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await checkBounds(search);
    await page.screenshot({ path: `${output}/lista-${viewport.width}x${viewport.height}.png` });
    await search.fill('maca professores');
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option')).toContainText('MA-01');
    await search.press('Enter');
    await expect(page.getByLabel('Descrição para o cliente', { exact: true })).toHaveValue(products.find(p => p.id === "apple-red").name);
    await expect(page.getByLabel('Preço unitário (R$)', { exact: true })).toHaveValue('30');
    await expect(page.getByRole('combobox', { name: 'Produto 1', exact: true })).toBeFocused();
    await page.getByRole('combobox', { name: 'Produto 1', exact: true }).click();
    await search.fill('ma-02'); await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: /MA-02/ }).click();
    await expect(page.getByLabel('Preço unitário (R$)', { exact: true })).toHaveValue('35');
    await page.getByRole('combobox', { name: 'Produto 1', exact: true }).click();
    await search.fill('produto inexistente'); await expect(page.getByText('Nenhum resultado. Tente outro nome ou código.')).toBeVisible();
    await search.press('Escape');
    await expect(page.getByRole('heading', { name: 'Novo orçamento', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Produto 1', exact: true })).toContainText('MA-02');
    await page.getByRole('combobox', { name: 'Cliente do orçamento', exact: true }).click();
    await page.getByRole('combobox', { name: 'Buscar cliente do orçamento' }).fill('jose');
    await page.getByRole('option', { name: /José da Silva/ }).click();
    await page.getByRole('button', { name: 'Adicionar produto', exact: true }).click();
    await page.getByRole('combobox', { name: 'Produto 2', exact: true }).click();
    await checkBounds(page.getByRole('combobox', { name: 'Buscar produto 2', exact: true }));
    await page.getByRole('combobox', { name: 'Buscar produto 2', exact: true }).fill('CH-119');
    await page.getByRole('option', { name: /CH-119/ }).click();
    await expect(page.getByRole('combobox', { name: 'Buscar produto 2', exact: true })).not.toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Produto 1', exact: true })).toContainText('MA-02');
    await checkBounds(page.getByRole('button', { name: 'Salvar rascunho', exact: true }));
    const overflow = await page.getByRole('dialog', { name: 'Novo orçamento', exact: true }).evaluate(node => node.scrollWidth > node.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `${output}/orcamento-${viewport.width}x${viewport.height}.png` });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await page.goto('http://127.0.0.1:5173/comercial/pedidos');
    await page.getByRole('button', { name: 'Novo pedido', exact: true }).click();
    await page.getByRole('combobox', { name: 'Produto do item 1', exact: true }).click();
    await page.getByRole('combobox', { name: 'Buscar produto do item 1', exact: true }).fill('ma-02');
    await page.getByRole('option', { name: /MA-02/ }).click();
    await expect(page.getByRole('combobox', { name: 'Produto do item 1', exact: true })).toContainText('verde');
    await expect(page.getByLabel('Preço unitário do item 1', { exact: true })).toHaveValue('35');
    expect(errors).toEqual([]); expect(mutations).toEqual([]);
    console.log(`PASS ${viewport.width}x${viewport.height}: 1122 produtos (paginação real), busca sem acentos, SKU, teclado, fechamento seguro, dois itens e venda.`);
    await context.close();
  }
} finally { await browser.close(); }
