import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

// Real pure translator and real Edge handler, isolated API/session/database boundaries.
// No seller account, real authorization code or upstream request is used.
const moduleSource = await readFile(new URL('../supabase/functions/shopee-sync/shopee.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(moduleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, crypto: webcrypto, URL, URLSearchParams, TextEncoder, Uint8Array });
const pure = exports;
const fixture = (extra = {}) => ({ order_sn: '261010ABCD123', region: 'BR', currency: 'BRL', order_status: 'READY_TO_SHIP', cod: false,
  update_time: 1791633600, ship_by_date: 1791810000, days_to_ship: 90, pay_time: 1791620000, total_amount: 20,
  estimated_shipping_fee: 99, actual_shipping_fee: 88, item_list: [{ item_id: 100, item_name: 'Suporte', item_sku: 'PARENT', model_id: 200,
    model_name: 'Azul', model_sku: 'BLUE', model_quantity_purchased: 2, model_discounted_price: 10, model_original_price: 12 }], ...extra });
const accountId = '70000000-0000-4000-8000-000000000001';
const stateId = '70000000-0000-4000-8000-000000000002';
const leaseId = '70000000-0000-4000-8000-000000000003';
const config = { partnerId: '12345', partnerKey: 'QA_PARTNER_KEY', redirect: 'https://erp.qa.invalid/integracoes/marketplaces', host: pure.SHOPEE_HOSTS.BR };
const handlerSource = await readFile(new URL('../supabase/functions/shopee-sync/index.ts', import.meta.url), 'utf8');
const handlerCode = ts.transpileModule(handlerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^import .*;\s*$/gm, '');
const initial = extra => ({ clients: 0, calls: [], requests: [], writes: [], rows: [fixture()], ...extra });
async function handler(state) {
  let serve;
  function createClient() {
    const session = ++state.clients === 1;
    return {
      auth: { getUser: async () => ({ data: { user: state.invalidSession ? null : { id: 'user-qa' } }, error: state.invalidSession ? { message: 'invalid session' } : null }) },
      from: table => {
        const filters = []; let mutation;
        const query = {};
        for (const key of ['select', 'gt', 'order', 'limit', 'in', 'lt']) query[key] = () => query;
        query.eq = (key, value) => { filters.push([key, value]); return query; };
        for (const key of ['delete', 'insert', 'update']) query[key] = data => { mutation = { table, key, data }; return query; };
        query.single = async () => {
          if (table === 'marketplace_accounts') {
            assert.ok(session, 'Account tenant must be checked through authenticated session');
            assert.ok(filters.some(([key, value]) => key === 'tenant_id' && value === 'tenant-qa'));
            return state.foreignAccount ? { data: null, error: { message: 'Account outside company scope' } } : { data: { id: accountId, tenant_id: 'tenant-qa', channel: state.channel ?? 'shopee', external_seller_id: state.seller ?? '123', connection_state: state.connection ?? 'connected' }, error: null };
          }
          assert.equal(table, 'marketplace_credentials'); assert.equal(session, false);
          return { data: { access_token: 'OLD_ACCESS', refresh_token: 'OLD_REFRESH', expires_at: new Date(Date.now() + (state.expired ? -1000 : 600000)).toISOString() }, error: null };
        };
        query.then = (resolve, reject) => {
          if (mutation) state.writes.push(mutation);
          const data = table === 'marketplace_oauth_states' && mutation?.key === 'delete' ? state.nonceUsed ? [] : [{ account_id: accountId }] : null;
          if (table === 'marketplace_oauth_states' && mutation?.key === 'delete') { assert.ok(filters.some(([key, value]) => key === 'user_id' && value === 'user-qa')); state.nonceUsed = true; }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        };
        return query;
      },
      rpc: async (name, args) => {
        state.calls.push({ name, args });
        if (name === 'get_user_tenant_id') return { data: 'tenant-qa', error: null };
        if (name === 'erp_can_write') return { data: !state.viewer && !(args.financial && state.staff), error: null };
        if (name === 'claim_marketplace_sync') { assert.equal(session, false); return { data: state.busy ? null : leaseId, error: null }; }
        if (name === 'release_marketplace_sync') { assert.equal(args.p_lease, leaseId); return { data: null, error: null }; }
        if (name === 'persist_shopee_credentials') { assert.equal(session, false); state.persisted = args; return { data: null, error: null }; }
        if (name === 'mark_shopee_reauthorization_required') { assert.equal(session, false); assert.equal(args.p_lease, leaseId); state.reauthorization = true; return { data: true, error: null }; }
        if (name === 'import_marketplace_orders') { assert.equal(session, true); state.imported = args; return { data: { imported: args.p_orders.length, unchanged: 0, workflow: { organized: 0, results: [] } }, error: null }; }
        throw new Error('Unexpected RPC: ' + name);
      }
    };
  }
  const env = { SUPABASE_URL: 'https://database.qa.invalid', SUPABASE_ANON_KEY: 'QA_ANON', SUPABASE_SERVICE_ROLE_KEY: 'QA_SERVICE',
    ...(state.missingConfig ? {} : { SHOPEE_PARTNER_ID: config.partnerId, SHOPEE_PARTNER_KEY: config.partnerKey, SHOPEE_REDIRECT_URI: config.redirect }), ...state.env };
  const fetch = async (input, options) => {
    const url = new URL(input); state.requests.push({ url, options });
    assert.equal(url.origin, config.host);
    const timestamp = Number(url.searchParams.get('timestamp'));
    const token = url.searchParams.get('access_token') ?? '', shopId = url.searchParams.get('shop_id') ?? '';
    assert.equal(url.searchParams.get('sign'), createHmac('sha256', config.partnerKey).update(config.partnerId + url.pathname + timestamp + token + shopId).digest('hex'));
    if (state.apiError) return Response.json({ error: state.errorCode ?? 'invalid_access_token', message: 'SECRET_ACCESS must never appear in response' });
    if (url.pathname.startsWith('/api/v2/auth/')) {
      assert.equal(options.method, 'POST'); assert.equal(token, ''); assert.equal(shopId, '');
      const body = JSON.parse(options.body); assert.equal(body.shop_id, 123); assert.equal(body.partner_id, 12345);
      return Response.json({ access_token: 'NEW_ACCESS', refresh_token: 'NEW_REFRESH', expire_in: 14400, ...(state.wrongShop ? { shop_id: 456 } : {}) });
    }
    assert.equal(shopId, '123'); assert.equal(token, state.expired || state.exchanging ? 'NEW_ACCESS' : 'OLD_ACCESS');
    if (url.pathname === '/api/v2/shop/get_shop_info') return Response.json({ shop_name: 'QA', region: state.badRegion ? 'SG' : 'BR', status: 'NORMAL' });
    if (url.pathname === '/api/v2/order/get_order_list') {
      assert.equal(url.searchParams.get('time_range_field'), 'update_time'); assert.equal(url.searchParams.has('order_status'), false);
      assert.equal(url.searchParams.get('request_order_status_pending'), 'true');
      return Response.json({ response: { more: !!state.more, next_cursor: state.more ? 'opaque-next-cursor' : '', order_list: state.rows.map(row => ({ order_sn: row.order_sn })) } });
    }
    assert.equal(url.pathname, '/api/v2/order/get_order_detail');
    assert.match(url.searchParams.get('response_optional_fields'), /item_list/); assert.match(url.searchParams.get('response_optional_fields'), /pay_time/);
    return Response.json({ response: { order_list: state.rows } });
  };
  vm.runInNewContext(handlerCode, { ...pure, createClient, Deno: { env: { get: key => env[key] }, serve: fn => { serve = fn; } }, crypto: webcrypto, Request, Response, URL, URLSearchParams, TextEncoder, Uint8Array, AbortSignal, fetch });
  return serve;
}
const request = (body, auth = true) => new Request('https://edge.qa.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer QA_SESSION' } : {}) }, body: JSON.stringify(body) });
const fetchBody = { action: 'fetch_orders', account_id: accountId, order_ids: ['261010ABCD123'] };
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
await test('Public auth and shop API signatures match independent HMAC vectors and fixed paths', async () => {
  for (const [path, token, shop] of [['/api/v2/auth/token/get', '', ''], ['/api/v2/order/get_order_detail', 'TOKEN', '123']]) {
    assert.equal(await pure.signShopeeRequest('key', '12345', path, 1700000000, token, shop), createHmac('sha256', 'key').update('12345' + path + '1700000000' + token + shop).digest('hex'));
  }
  await assert.rejects(pure.signedShopeeUrl(config, '//attacker.qa.invalid'), /não permitido/);
  assert.throws(() => pure.numericId(9007199254740992), /precisão/);
});
await test('Real Unix deadline and model SKU survive; DTS and shipping estimates never become actuals', () => {
  const order = pure.normalizeShopeeOrder(fixture()); assert.equal(order.shipping_deadline_at, new Date(1791810000 * 1000).toISOString());
  assert.equal(order.items[0].external_variant_id, '200'); assert.equal(order.items[0].external_sku, 'BLUE'); assert.equal(order.items[0].unit_price, 10);
  assert.equal(order.shipping_amount, 0); assert.equal(order.seller_fees, null);
  assert.equal(pure.normalizeShopeeOrder(fixture({ ship_by_date: null })).shipping_deadline_at, null);
  const zero = fixture(); zero.item_list[0].model_discounted_price = 0; assert.equal(pure.normalizeShopeeOrder(zero).items[0].unit_price, 0);
  const noSku = fixture(); noSku.item_list[0].model_sku = ''; assert.equal(pure.normalizeShopeeOrder(noSku).items[0].external_sku, 'PARENT');
  const noVariation = fixture(); noVariation.item_list[0].model_id = 0; assert.equal(pure.normalizeShopeeOrder(noVariation).items[0].external_variant_id, '0');
  const two = fixture(); two.item_list.push({ ...two.item_list[0], model_id: 199, model_sku: 'RED' });
  assert.deepEqual(pure.normalizeShopeeOrder(two), pure.normalizeShopeeOrder({ ...two, item_list: [...two.item_list].reverse() }));
});
await test('Unpaid, cancellation, unconfirmed amount and COD never release paid production', () => {
  assert.equal(pure.normalizeShopeeOrder(fixture({ order_status: 'UNPAID', pay_time: null, total_amount: null })).normalized_state, 'awaiting_payment');
    assert.equal(pure.normalizeShopeeOrder(fixture({ order_status: 'IN_CANCEL' })).normalized_state, 'unknown');
  assert.equal(pure.normalizeShopeeOrder(fixture({ total_amount: null })).normalized_state, 'unknown');
  assert.equal(pure.normalizeShopeeOrder(fixture({ cod: true })).normalized_state, 'unknown');
  assert.equal(pure.normalizeShopeeOrder(fixture({ cod: undefined })).normalized_state, 'unknown');
  assert.equal(pure.normalizeShopeeOrder(fixture({ cod: 'true' })).normalized_state, 'unknown');
  assert.equal(pure.normalizeShopeeOrder(fixture({ pending_terms: ['SYSTEM_PENDING'] })).normalized_state, 'unknown');
  assert.throws(() => pure.normalizeShopeeOrder(fixture({ ship_by_date: 'NaN' })), /Unix/);
  assert.throws(() => pure.normalizeShopeeOrder(fixture({ currency: 'SGD' })), /BRL/);
});
await test('Anonymous, invalid session, viewer and staff authorization stop before upstream secrets', async () => {
  for (const [extra, auth, body, status] of [[{}, false, fetchBody, 401], [{ invalidSession: true }, true, fetchBody, 401], [{ viewer: true }, true, fetchBody, 403], [{ staff: true }, true, { action: 'oauth_begin', account_id: accountId }, 403]]) {
    const s = initial(extra), fn = await handler(s); assert.equal((await fn(request(body, auth))).status, status); assert.equal(s.requests.length, 0); assert.equal(s.persisted, undefined);
  }
});
await test('Missing configuration, wrong channel, foreign tenant and busy lease remain explicit pending access', async () => {
  for (const [extra, pattern] of [[{ missingConfig: true }, /SHOPEE_PARTNER_ID/], [{ channel: 'mercado_livre' }, /conta Shopee/], [{ foreignAccount: true }, /company scope/], [{ busy: true }, /andamento/]]) {
    const s = initial(extra), fn = await handler(s), response = await fn(request(fetchBody)); assert.ok(response.status >= 400); assert.match((await response.json()).error, pattern); assert.equal(s.requests.length, 0);
  }
});
await test('Official native OAuth state binds the user and requires validated active BR shop before secret persistence', async () => {
  const s = initial(), fn = await handler(s), begin = await fn(request({ action: 'oauth_begin', account_id: accountId }));
  const url = new URL((await begin.json()).authorization_url); assert.equal(url.origin, 'https://open.shopee.com.br'); assert.equal(url.pathname, '/auth');
  assert.equal(url.searchParams.get('redirect_uri'), config.redirect); assert.equal(url.searchParams.get('auth_type'), 'seller'); assert.ok(url.searchParams.get('state'));
  const exchanging = initial({ exchanging: true }), exchangeFn = await handler(exchanging);
  const body = { action: 'oauth_exchange', state: stateId, code: 'QA_ONE_TIME_CODE', shop_id: '123' };
  const response = await exchangeFn(request(body)); assert.equal(response.status, 200); assert.equal((await response.json()).connected, true);
  assert.equal(exchanging.persisted.p_shop_id, '123'); assert.equal(exchanging.persisted.p_refresh_token, 'NEW_REFRESH');
  assert.equal(exchanging.calls.filter(call => call.name === 'release_marketplace_sync').length, 1);
  for (const extra of [{ nonceUsed: true }, { wrongShop: true, exchanging: true }, { badRegion: true, exchanging: true }]) {
    const bad = initial(extra), badFn = await handler(bad); assert.ok((await badFn(request(body))).status >= 400); assert.equal(bad.persisted, undefined);
  }
});
await test('Refresh rotates and saves a token pair once under lease; the import still uses the authenticated tenant RPC', async () => {
  const s = initial({ expired: true }), fn = await handler(s), response = await fn(request(fetchBody)); assert.equal(response.status, 200);
  assert.equal(s.persisted.p_refresh_token, 'NEW_REFRESH'); assert.equal(s.imported.p_account_id, accountId); assert.equal(s.imported.p_orders[0].normalized_state, 'paid');
  assert.ok(s.calls.findIndex(call => call.name === 'persist_shopee_credentials') < s.calls.findIndex(call => call.name === 'import_marketplace_orders'));
  const text = JSON.stringify(await response.json()); assert.doesNotMatch(text, /NEW_ACCESS|NEW_REFRESH|OLD_ACCESS|QA_PARTNER_KEY/); assert.match(text, /workflow/);
});
await test('Update-time pages retain cancellation and missing unpaid totals, and expose cursor and unknown cutoffs', async () => {
  const s = initial({ more: true, rows: [fixture(), fixture({ order_sn: 'UNPAID1', order_status: 'UNPAID', pay_time: null, total_amount: null, ship_by_date: null }), fixture({ order_sn: 'CANCEL1', order_status: 'CANCELLED' })] });
  const fn = await handler(s), response = await fn(request({ action: 'fetch_recent_orders', account_id: accountId, from: new Date(Date.now() - 7 * 86400000).toISOString(), to: new Date().toISOString() }));
  assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.next_cursor, 'opaque-next-cursor'); assert.equal(value.missing_deadline, 1);
  assert.equal(s.imported.p_orders.length, 3); assert.equal(s.imported.p_orders[1].reported_total, null); assert.equal(s.imported.p_orders[2].normalized_state, 'cancelled');
  const firstList = s.requests.find(call => call.url.pathname.endsWith('get_order_list')).url;
  const next = initial(), nextFn = await handler(next);
  assert.equal((await nextFn(request({ action: 'fetch_recent_orders', account_id: accountId, from: value.effective_from, to: value.effective_to, cursor: value.next_cursor }))).status, 200);
  const nextList = next.requests.find(call => call.url.pathname.endsWith('get_order_list')).url;
  assert.equal(nextList.searchParams.get('time_from'), firstList.searchParams.get('time_from'));
  assert.equal(nextList.searchParams.get('time_to'), firstList.searchParams.get('time_to'));
  assert.equal(nextList.searchParams.get('cursor'), value.next_cursor);
});
await test('Upstream token errors cannot leak secret messages, and always release the claimed lease', async () => {
  const s = initial({ apiError: true }), fn = await handler(s), response = await fn(request(fetchBody)); assert.equal(response.status, 401);
  assert.doesNotMatch(JSON.stringify(await response.json()), /SECRET_ACCESS/); assert.equal(s.reauthorization, true);
  assert.equal(s.calls.filter(call => call.name === 'release_marketplace_sync').length, 1); assert.equal(s.imported, undefined);
});
await test('Failed new authorization preserves existing credentials; official refresh revocation codes require reauthorization', async () => {
  const body = { action: 'oauth_exchange', state: stateId, code: 'EXPIRED_NEW_CODE', shop_id: '123' };
  const s = initial({ exchanging: true, apiError: true, errorCode: 'invalid_code' }), fn = await handler(s);
  assert.ok((await fn(request(body))).status >= 400); assert.equal(s.persisted, undefined); assert.equal(s.reauthorization, undefined);
  for (const errorCode of ['error_auth', 'error_shop_refresh_token', 'shop_no_linked']) {
    const revoked = initial({ expired: true, apiError: true, errorCode }), revokedFn = await handler(revoked);
    assert.equal((await revokedFn(request(fetchBody))).status, 401); assert.equal(revoked.reauthorization, true); assert.equal(revoked.imported, undefined);
  }
});
console.log(`${passed} isolated Shopee Edge and documented contract scenarios passed.`);
