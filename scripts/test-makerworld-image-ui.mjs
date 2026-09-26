import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const imageUrl = 'https://makerworld.bblmw.com/makerworld/model/US58554a31ea5504/836978891/instance/plate_1.png';
const output = 'artifacts/makerworld-image';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 760 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [], writes = [], imports = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/src/contexts/AuthContext.tsx') return route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;` });
      if (url.pathname.includes('/rest/v1/')) {
        const name = url.pathname.split('/').pop();
        if (name.includes('makerworld')) imports.push(name);
        if (name === 'save_product_with_photos') writes.push(request.postDataJSON());
        return route.fulfill({ contentType: 'application/json', body: name === 'save_product_with_photos' ? '"saved-product"' : name === 'tenants' ? '{"settings":{}}' : '[]' });
      }
      // The public image is live; every application database call is mocked.
      if (url.hostname === '127.0.0.1' || url.hostname === 'makerworld.bblmw.com') return route.continue();
      return route.fulfill({ contentType: 'application/json', body: '{"projects":[]}' });
    });
    await page.goto('http://127.0.0.1:5174/comercial/produtos');
    await page.getByRole('button', { name: 'Importar da Bambu', exact: true }).click();
    await page.getByRole('button', { name: 'MakerWorld', exact: true }).click();
    await page.getByLabel('Link do modelo MakerWorld').fill(imageUrl);
    const useImage = page.getByRole('button', { name: 'Usar imagem no novo produto' });
    await expect(useImage).toBeEnabled({ timeout: 20000 });
    const preview = page.getByAltText('Prévia da imagem do MakerWorld');
    expect(await preview.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: `${output}/preview-${viewport.width}.png` });
    const overflow = await page.getByRole('dialog').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, children: [...node.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > node.getBoundingClientRect().right).map(el => ({ tag: el.tagName, text: el.textContent?.slice(0,70), width: el.getBoundingClientRect().width })) }));
    if (overflow.scroll > overflow.width + 1) console.log(JSON.stringify(overflow));
    expect(overflow.scroll > overflow.width + 1).toBe(false);
    await useImage.click();
    await expect(page.getByRole('dialog', { name: 'Novo Produto' })).toBeVisible();
    await expect(page.getByLabel('Nome *', { exact: true })).toHaveValue('');
    expect(writes).toHaveLength(0); expect(imports).toHaveLength(0);
    await page.getByLabel('Nome *', { exact: true }).fill('Produto com foto da placa');
    await page.getByRole('tab', { name: 'Fotos', exact: true }).click();
    await expect(page.getByAltText('Foto 1', { exact: true })).toHaveAttribute('src', imageUrl);
    await page.getByLabel('Link da imagem').pressSequentially(imageUrl);
    await expect(page.getByLabel('Link da imagem')).toHaveValue(imageUrl);
    await page.getByRole('button', { name: 'Adicionar imagem', exact: true }).click();
    await expect(page.getByAltText('Foto 2', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${output}/product-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Criar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].p_product.photo_url).toBe(imageUrl);
    expect(writes[0].p_product.external_import).toBeUndefined();
    expect(imports).toHaveLength(0); expect(errors).toEqual([]);
    console.log(`PASS ${viewport.width}: live image, responsive preview, new product, persistent photo field, mocked save, no model lookup.`);
    await page.close();
  }
} finally { await browser.close(); }
