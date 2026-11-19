// End to end, in a real browser: sync between two "devices", setting up the Claude connector from
// Sync & Claude, Claude saving a valuation through the connector, and that save showing up in the
// calculator. Google's APIs are the stand-in from fake-google.cjs; the connector runs from the very
// file the calculator hands out. Usage: node build.mjs && node test/sync.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createFakeGoogle } = require('./fake-google.cjs');

const PAGE = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = process.env.SHOTS || '';
const FIREBASE_CONFIG = `const firebaseConfig = {
  apiKey: "AIzaTest",
  authDomain: "dcf-test.firebaseapp.com",
  projectId: "dcf-test",
  storageBucket: "dcf-test.firebasestorage.app",
  messagingSenderId: "1234",
  appId: "1:1234:web:abcd"
};`;
const WORKER = 'https://dcf.me.workers.dev';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

(async () => {
  const fake = createFakeGoogle({ apiKey: 'AIzaTest', project: 'dcf-test' });
  await fake.listen(); // the connector reaches it over HTTP; the pages go through page.route
  let worker = null;
  const errors = [];
  const browser = await chromium.launch();

  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, deviceScaleFactor: SHOTS ? 2 : 1 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.route(/^https:\/\/(identitytoolkit|securetoken|firestore)\.googleapis\.com\//, async (route) => {
      const q = route.request(), u = new URL(q.url());
      const host = u.hostname.split('.')[0];
      if (q.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const r = await fake.handle(q.method(), '/' + host + u.pathname + u.search, await q.allHeaders(), q.postData() || '');
      return route.fulfill({ status: r.status, headers: { ...CORS, 'content-type': 'application/json' }, body: r.body });
    });
    await p.route(WORKER + '/**', async (route) => {
      const q = route.request();
      if (!worker) return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Hello World!' });
      const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: await q.allHeaders(), body: ['GET', 'HEAD'].includes(q.method()) ? undefined : q.postData() }), { DCF_GOOGLE_API: fake.url });
      return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    // A new Claude chat opened from the calculator lands here.
    await ctx.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Claude</title>' }));
    return { ctx, p };
  }
  // Presses a button that hands a request to Claude; returns the request the new chat was opened with.
  async function handOff(d, click) {
    const [chat] = await Promise.all([d.ctx.waitForEvent('page'), click()]);
    await chat.waitForLoadState().catch(() => {});
    const u = new URL(chat.url());
    await chat.close();
    assert.equal(u.origin + u.pathname, 'https://claude.ai/new');
    return u.searchParams.get('q');
  }
  const txt = (p, sel) => p.textContent(sel).then((x) => (x || '').replace(/\s+/g, ' ').trim());
  const syncNow = async (p) => { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(700); };

  // ---- device A: a save made before sync, then Create account ----
  const A = await device('A');
  await A.p.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('dcf-history-v1', JSON.stringify([{ id: 'lold1', v: 2, ticker: 'EXMP', name: 'Example Co.', savedAtMs: Date.UTC(2026, 9, 1), savedAt: '2026-10-01T00:00:00.000Z',
      inputs: { currency: '$', rcurrency: null, unit: '1e6', sharesUnit: '1e6', baseYear: 2026, method: 'fcf', fcf: 2000, cash: 5000, debt: 3000, shares: 1000, price: 40, r: 10, buyAt: 25, sellAt: -10 },
      scenarios: { bear: null, base: { g1: 12, g2: 8, tg: 3, w: 50 }, bull: null }, result: { fair: 61.43, price: 40, mos: 0.53, signal: 'BUY', weighted: false } }]));
  });
  await A.p.goto(PAGE); await A.p.waitForTimeout(400);
  assert.equal(await A.p.isVisible('#btn-sync'), true);
  assert.equal(await A.p.isVisible('#ai-plan-btn'), true, 'the plan note offers Sync & Claude');
  assert.match(await txt(A.p, '#store-text'), /this browser only/);
  // ---- Ask Claude on your Claude plan, before the connector exists ----
  assert.equal(await A.p.getAttribute('[data-route="plan"]', 'aria-checked'), 'true');
  assert.equal(await A.p.isHidden('#ai-connect'), true, 'no API key box on the plan route');
  assert.equal(await A.p.isEnabled('#ai-build-btn'), true, 'no key needed');
  assert.match(await txt(A.p, '#ai-plan'), /list the figures for you to type in/);
  await A.p.fill('#ai-tk', 'nvda');
  let q = await handOff(A, () => A.p.click('#ai-build-btn'));
  assert.match(q, /^Build a DCF valuation for NVDA that I can type into my DCF calculator/);
  assert.match(q, /HOW THIS PAGE VALUES A STOCK/);
  assert.match(await txt(A.p, '#ai-status-t'), /Opened a new Claude chat/);
  assert.match(await A.p.getAttribute('#ai-desktop', 'href'), /^claude:\/\/claude\.ai\/new\?q=Build%20a%20DCF/);
  q = await handOff(A, () => A.p.click('#ai-review'));
  assert.match(q, /^Review my DCF valuation of EXMP/);
  assert.match(q, /"fcf":2000/);
  await A.p.fill('#ai-q', 'Is 10% right here?');
  q = await handOff(A, () => A.p.press('#ai-q', 'Enter'));
  assert.match(q, /^Is 10% right here\?/);
  await A.p.click('[data-route="key"]');
  assert.equal(await A.p.isVisible('#ai-connect'), true);
  assert.equal(await A.p.isDisabled('#ai-build-btn'), true);
  assert.equal(await A.p.evaluate(() => localStorage.getItem('dcf-ai-route-v1')), '"key"');
  {
    // A fresh page with that choice stored opens on it. (A reload right after the click can race the
    // browser saving it, so this starts from the stored value instead.)
    const C = await device('C');
    await C.p.addInitScript(() => localStorage.setItem('dcf-ai-route-v1', '"key"'));
    await C.p.goto(PAGE);
    await C.p.waitForFunction(() => document.querySelector('[data-route="key"]').getAttribute('aria-checked') === 'true', null, { timeout: 5000 });
    assert.equal(await C.p.isVisible('#ai-connect'), true);
    await C.ctx.close();
  }
  await A.p.click('[data-route="plan"]');
  ok('“Your Claude plan” is the default: requests open a Claude chat, no API key needed');

  await A.p.click('#btn-sync');
  assert.equal(await A.p.isVisible('#sy-modal'), true);
  assert.equal(await A.p.isVisible('#cl-need'), true);
  ok('Sync & Claude opens; Claude waits for sync');

  await A.p.fill('#sy-cfg', FIREBASE_CONFIG);
  await A.p.fill('#sy-email', 'me@example.com');
  await A.p.fill('#sy-pw', '123');
  await A.p.click('#sy-signup'); await A.p.waitForTimeout(400);
  assert.match(await txt(A.p, '#sy-err'), /at least 6 characters/);
  await A.p.fill('#sy-pw', 'hunter22');
  await A.p.click('#sy-signup'); await A.p.waitForTimeout(900);
  assert.equal(await A.p.isVisible('#sy-on'), true);
  assert.match(await txt(A.p, '#sy-who'), /me@example\.com.*dcf-test/);
  const uid = fake.server.users['me@example.com'].uid;
  const up = fake.docsOf(uid).lold1;
  assert.ok(up && up.type === 'valuation' && up.ticker === 'EXMP', 'the earlier save went up');
  assert.match(await txt(A.p, '#store-text'), /synced to your Firebase/);
  ok('Create account turns sync on and uploads earlier saves');

  // ---- the Claude connector, set up from the window ----
  assert.equal(await A.p.isVisible('#cl-steps'), true);
  const [dl] = await Promise.all([A.p.waitForEvent('download'), A.p.click('#cl-save')]);
  const code = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(code, /DCF Calculator connector for Claude, version \d/);
  const cfg = JSON.parse(/\/\*DCF_CONFIG\*\/(.*?)\/\*END_DCF_CONFIG\*\//.exec(code)[1]);
  assert.equal(cfg.apiKey, 'AIzaTest'); assert.equal(cfg.projectId, 'dcf-test'); assert.ok(cfg.secret.length >= 40);
  await syncNow(A.p);
  const conn = fake.docsOf(uid).claude;
  assert.equal(conn.type, 'connector'); assert.equal(conn.secret, cfg.secret);
  ok('Save as file gives connector code with this account’s settings; the connector record syncs');

  await A.p.fill('#cl-url', 'dcf.me.workers.dev');
  await A.p.click('#cl-check'); await A.p.waitForTimeout(400);
  assert.match(await txt(A.p, '#cl-check-msg'), /isn’t running the DCF connector|Couldn’t reach/);
  assert.equal(await A.p.getAttribute('#cl-add', 'aria-disabled'), 'true');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-w-')), 'worker.mjs');
  fs.writeFileSync(file, code);
  worker = (await import(pathToFileURL(file).href)).default; // "Deploy"
  await A.p.click('#cl-check'); await A.p.waitForTimeout(500);
  assert.match(await txt(A.p, '#cl-check-msg'), /Your connector is running \(version \d+\.\d+\.\d+\)/);
  assert.equal(await A.p.inputValue('#cl-url'), WORKER);
  const href = await A.p.getAttribute('#cl-add', 'href');
  assert.equal(href, 'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=DCF%20Calculator&connectorUrl=' + encodeURIComponent(WORKER + '/mcp'));
  assert.match(await txt(A.p, '#cl-status'), /hasn’t connected yet/);
  await syncNow(A.p);
  assert.equal(fake.docsOf(uid).claude.url, WORKER);
  ok('Check spots a Hello World Worker, then the deployed connector; Add to Claude points at it');
  if (SHOTS) {
    await A.p.setViewportSize({ width: 900, height: 1500 });
    await A.p.locator('#sy-card').screenshot({ path: path.join(SHOTS, 'sync-claude.png') });
    await A.p.setViewportSize({ width: 1440, height: 1000 });
  }

  // ---- Claude connects and saves a valuation (what claude.ai does) ----
  const call = (p, init) => worker.fetch(new Request(WORKER + p, init), { DCF_GOOGLE_API: fake.url });
  const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
  const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
  const client = await (await call('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const page = await (await call('/authorize?' + new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's' }))).text();
  const req = /name="req" value="([^"]+)"/.exec(page)[1];
  const back = await call('/authorize', form({ req, email: 'me@example.com', password: 'hunter22', action: 'allow' }));
  const authCode = new URL(back.headers.get('location')).searchParams.get('code');
  const tokens = await (await call('/token', form({ grant_type: 'authorization_code', code: authCode, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id }))).json();
  const tool = async (name, args, token = tokens.access_token) => {
    const res = await call('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    if (res.status !== 200) return { status: res.status };
    const j = await res.json();
    return JSON.parse(j.result.content[0].text);
  };
  let o = await tool('get-overview', {});
  assert.equal(o.stocks[0].ticker, 'EXMP');
  o = await tool('save-valuation', {
    ticker: 'VST', company: 'Vistra Corp.', method: 'fcf', settings: { priceCurrency: '$', amountUnit: 'millions', sharesUnit: 'millions', baseYear: 2026 },
    facts: { fcf: 4325, cash: 435, debt: 19595, shares: 335.6, price: 120.29, dps: 0.924 }, r: 10,
    cases: { bear: { g1: 0, g2: 2, tg: 2, w: 25 }, base: { g1: 6, g2: 3, tg: 2.5, w: 50 }, bull: { g1: 12, g2: 5, tg: 3, w: 25 } },
    asOf: 'Q3 2026', note: 'Figures from the Q3 2026 results release.',
  });
  assert.ok(o.saved.id);
  await syncNow(A.p);
  assert.match(await txt(A.p, '#cl-status'), /Claude connected on .*me@example\.com/);
  assert.match(await txt(A.p, '#ai-plan'), /saved straight into it/);
  assert.equal(await A.p.isVisible('#cl-disconnect'), true);
  await A.p.click('#sy-close');
  assert.equal(await A.p.isHidden('#sy-modal'), true);
  assert.match(await txt(A.p, '#toast'), /Claude saved a valuation for VST: fair value \$157\.73/);
  await A.p.click('#toast button'); await A.p.waitForTimeout(300);
  assert.equal(await A.p.inputValue('#f-ticker'), 'VST');
  assert.equal(await A.p.inputValue('#f-fcf'), '4,325');
  assert.equal(await txt(A.p, '#tv-bear'), '$93.79'); assert.equal(await txt(A.p, '#tv-base'), '$150.14'); assert.equal(await txt(A.p, '#tv-bull'), '$236.85');
  assert.match(await txt(A.p, '.stock[data-ticker="VST"]'), /Saved by Claude.*figures from Q3 2026.*Q3 2026 results release/);
  ok('Claude’s save appears in the calculator with a toast; Open loads it with the same numbers');

  // ---- with the connector, the plan route asks Claude to save into the calculator ----
  await A.p.fill('#ai-tk', 'WTC.AX');
  q = await handOff(A, () => A.p.click('#ai-build-btn'));
  assert.match(q, /^Use the DCF Calculator connector to build a new DCF model for WTC\.AX/);
  assert.match(q, /save-valuation/);
  assert.match(await txt(A.p, '#ai-status-t'), /Opened a new Claude chat for WTC\.AX\. When Claude saves the valuation, it appears here/);
  q = await handOff(A, () => A.p.click('#ai-draft-all'));
  assert.match(q, /^Use the DCF Calculator connector to update my DCF valuation of VST/);
  assert.match(q, /"fcf":4325/);
  assert.match(await txt(A.p, '#ai-build-hint'), /saves the model here/);
  ok('with the connector, Build and Update ask Claude to save the valuation into the calculator');
  if (SHOTS) await A.p.screenshot({ path: path.join(SHOTS, 'claude-saved.png') });

  // ---- device B: the setup code, then a delete that reaches device A ----
  await A.p.click('#btn-sync');
  const setup = await A.p.inputValue('#sy-code');
  assert.match(setup, /^TW1-/);
  await A.p.click('#sy-close');
  const B = await device('B');
  await B.p.goto(PAGE); await B.p.waitForTimeout(300);
  await B.p.click('#btn-sync');
  await B.p.fill('#sy-cfg', setup);
  await B.p.fill('#sy-email', 'me@example.com');
  await B.p.fill('#sy-pw', 'wrong-one');
  await B.p.click('#sy-signin'); await B.p.waitForTimeout(400);
  assert.match(await txt(B.p, '#sy-err'), /email or password isn’t right/);
  await B.p.fill('#sy-pw', 'hunter22');
  await B.p.click('#sy-signin'); await B.p.waitForTimeout(900);
  await B.p.click('#sy-close');
  assert.deepEqual(await B.p.$$eval('.stock', (els) => els.map((e) => e.dataset.ticker).sort()), ['EXMP', 'VST']);
  assert.match(await txt(B.p, '.stock[data-ticker="VST"]'), /\$157\.73/);
  ok('a second device signs in with the setup code and gets every save');

  await B.p.click('.stock[data-ticker="VST"] .stock-head');
  await B.p.click('.stock[data-ticker="VST"] [data-act="del"]');
  await B.p.click('.stock[data-ticker="VST"] [data-act="del-yes"]'); await B.p.waitForTimeout(800);
  assert.equal(fake.docsOf(uid)[o.saved.id].deleted, true);
  await syncNow(A.p);
  assert.deepEqual(await A.p.$$eval('.stock', (els) => els.map((e) => e.dataset.ticker)), ['EXMP']);
  o = await tool('get-overview', {});
  assert.equal(o.savedStocks, 1);
  ok('a delete on one device reaches the other device and Claude');

  // ---- Disconnect ----
  await A.p.click('#btn-sync');
  await A.p.click('#cl-disconnect'); await A.p.waitForTimeout(700);
  assert.equal((await tool('get-overview', {})).status, 401);
  assert.match(await txt(A.p, '#cl-status'), /hasn’t connected yet/);
  ok('Disconnect cuts Claude off');

  // ---- Chinese, phone width, sign out ----
  await A.p.click('#sy-close');
  await A.p.click('[data-lang="zh"]');
  await A.p.click('#btn-sync');
  assert.equal(await txt(A.p, '[data-route="plan"]'), '你的 Claude 方案');
  assert.equal(await txt(A.p, '#sy-title'), '同步與 Claude');
  assert.match(await txt(A.p, '#cl-h'), /用你的 Claude 帳戶使用 Claude/);
  await A.p.setViewportSize({ width: 390, height: 844 });
  const overflow = await A.p.evaluate(() => document.getElementById('sy-card').scrollWidth - document.getElementById('sy-card').clientWidth);
  assert.ok(overflow <= 1, 'no sideways scrolling in the window on a phone: ' + overflow);
  if (SHOTS) await A.p.screenshot({ path: path.join(SHOTS, 'sync-phone-zh.png') });
  await A.p.keyboard.press('Escape');
  assert.equal(await A.p.isHidden('#sy-modal'), true);
  await A.p.click('[data-lang="en"]');
  await A.p.setViewportSize({ width: 1440, height: 1000 });
  await A.p.click('#btn-sync');
  await A.p.click('#sy-out'); await A.p.waitForTimeout(200);
  assert.equal(await A.p.isVisible('#sy-form'), true);
  assert.match(await txt(A.p, '#store-text'), /this browser only/);
  assert.deepEqual(await A.p.$$eval('.stock', (els) => els.map((e) => e.dataset.ticker)), ['EXMP']);
  ok('Chinese, phone width and Escape work; signing out keeps saves in the browser');

  // ---- a sign-in that has ended (say, the password changed elsewhere) ----
  fake.revokeRefresh(uid);
  await syncNow(B.p);
  assert.match(await txt(B.p, '#store-text'), /Sync paused/);
  await B.p.click('#btn-sync');
  assert.equal(await B.p.isVisible('#sy-form'), true);
  assert.match(await txt(B.p, '#sy-err'), /sign-in has ended/);
  assert.equal(await B.p.inputValue('#sy-email'), 'me@example.com');
  await B.p.fill('#sy-pw', 'hunter22');
  await B.p.click('#sy-signin'); await B.p.waitForTimeout(800);
  assert.equal(await B.p.isVisible('#sy-on'), true);
  assert.match(await txt(B.p, '#store-text'), /synced to your Firebase/);
  ok('an ended sign-in pauses sync and asks for the password again');

  assert.deepEqual(errors, []);
  await browser.close();
  await fake.close();
  console.log(`sync: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
