import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const output = 'artifacts/registration-autofill'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 760 }]) {
    const page = await browser.newPage({ viewport }); const errors = [], mutations = [], queries = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (/minhareceita|viacep|brasilapi/.test(response.url())) queries.push({ url: response.url(), status: response.status() }); });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/src/contexts/AuthContext.tsx') return route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;` });
      if (url.pathname.includes('/rest/v1/')) {
        if (request.method() !== 'GET') mutations.push({ method: request.method(), path: url.pathname, payload: request.postDataJSON() });
        return route.fulfill({ contentType: 'application/json', body: url.pathname.endsWith('/save_partner') ? '"saved-fixture"' : '[]' });
      }
      // Real public lookup APIs; all application database calls above are isolated.
      if (url.hostname === '127.0.0.1' || ['minhareceita.org', 'brasilapi.com.br', 'viacep.com.br'].includes(url.hostname)) return route.continue();
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    });
    await page.goto('http://127.0.0.1:5174/comercial/clientes');
    await page.getByRole('button', { name: 'Adicionar cliente', exact: true }).click();
    await page.getByLabel('CPF / CNPJ', { exact: true }).fill('19131243000197');
    await expect(page.getByLabel('Razão social / nome *', { exact: true })).toHaveValue('OPEN KNOWLEDGE BRASIL', { timeout: 16000 });
    await expect(page.getByLabel('Tipo de pessoa')).toHaveValue('company');
    await expect(page.getByLabel('CEP', { exact: true })).toHaveValue('01311-902');
    await page.getByLabel('Número', { exact: true }).fill('57');
    await page.getByLabel('Complemento', { exact: true }).fill('Galpão B');
    await page.getByLabel('CEP', { exact: true }).fill('75093630');
    await expect(page.getByLabel('Cidade', { exact: true })).toHaveValue('Anápolis', { timeout: 16000 });
    await expect(page.getByLabel('Logradouro', { exact: true })).toHaveValue('Rua PB 48');
    await expect(page.getByLabel('Número', { exact: true })).toHaveValue('57');
    await expect(page.getByLabel('Complemento', { exact: true })).toHaveValue('Galpão B');
    await expect(page.getByLabel('CEP', { exact: true })).toBeFocused();
    const dialog = page.getByRole('dialog');
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: `${output}/address-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Consultar CNPJ', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/company-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Salvar cliente', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(mutations).toHaveLength(1); expect(mutations[0].path).toContain('/rpc/save_partner');
    expect(mutations[0].payload.p_data.address).toMatchObject({ cep: '75093-630', city: 'Anápolis', number: '57', complement: 'Galpão B' });
    expect(errors).toEqual([]);
    console.log(`PASS ${viewport.width}: real CNPJ and CEP lookup, automatic fill, editable address, mocked save. ${JSON.stringify(queries)}`);
    await page.close();
  }
} finally { await browser.close(); }
