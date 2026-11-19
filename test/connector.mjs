// Runs the built connector the way Cloudflare would (calling its fetch handler) against the
// stand-in Google APIs: Claude's OAuth sign-in, every tool, token refresh and Disconnect.
// Usage: node build.mjs && node test/connector.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { createFakeGoogle } = require('./fake-google.cjs');
const here = dirname(fileURLToPath(import.meta.url));
const pkgVersion = /VERSION = '([^']+)'/.exec(readFileSync(join(here, '../connector/src/worker.js'), 'utf8'))[1];

const SECRET = 'test-secret-0123456789abcdefghijklmnop';
const fake = createFakeGoogle({ apiKey: 'AIzaTest', project: 'dcf-test' });
await fake.listen();
const uid = fake.addUser('me@example.com', 'hunter22');
fake.put(uid, 'claude', { id: 'claude', type: 'connector', secret: SECRET, gen: 7, createdAt: Date.now(), url: '' });

// The connector with this account's settings, as the calculator hands it out.
let code = readFileSync(join(here, `../dist/dcf-connector-v${pkgVersion}.js`), 'utf8');
code = code.replace(/\/\*DCF_CONFIG\*\/.*?\/\*END_DCF_CONFIG\*\//, `/*DCF_CONFIG*/${JSON.stringify({ apiKey: 'AIzaTest', projectId: 'dcf-test', secret: SECRET })}/*END_DCF_CONFIG*/`);
const file = join(mkdtempSync(join(tmpdir(), 'dcf-conn-')), 'worker.mjs');
writeFileSync(file, code);
const worker = (await import(pathToFileURL(file).href)).default;
const env = { DCF_GOOGLE_API: fake.url };
const ORIGIN = 'https://dcf.me.workers.dev';
const call = (path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env);

let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

// ---- before sign-in ----
let r = await call('/health');
let j = await r.json();
assert.equal(j.ok, true); assert.equal(j.app, 'dcf-connector'); assert.equal(j.projectId, 'dcf-test');
ok('health says it is a configured DCF connector');
r = await call('/', { headers: { accept: 'text/html' } });
assert.match(await r.text(), /DCF calculator connector is running/);
ok('home page shows the address to add to Claude');
r = await call('/mcp', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
assert.equal(r.status, 401);
assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/dcf\.me\.workers\.dev\/\.well-known\/oauth-protected-resource\/mcp"/);
ok('MCP without a token asks for sign-in');
j = await (await call('/.well-known/oauth-authorization-server')).json();
assert.equal(j.authorization_endpoint, ORIGIN + '/authorize');
j = await (await call('/.well-known/oauth-protected-resource/mcp')).json();
assert.equal(j.resource, ORIGIN + '/mcp'); assert.equal(j.resource_name, 'DCF Calculator');
ok('OAuth metadata');

// ---- Claude's sign-in ----
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
r = await call('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) });
assert.equal(r.status, 400);
r = await call('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Claude' }) });
const client = await r.json();
assert.match(client.client_id, /^dcf_/);
ok('only Claude (or this computer) can register');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8' });
r = await call('/authorize?' + q, { headers: { 'accept-language': 'zh-TW,zh;q=0.9' } });
let page = await r.text();
assert.match(page, /將 Claude 連接到你的 DCF 計算機/);
r = await call('/authorize?' + q);
page = await r.text();
assert.match(page, /Connect Claude to your DCF calculator/);
assert.match(page, /dcf-test/);
const req = /name="req" value="([^"]+)"/.exec(page)[1];
ok('sign-in page (English and Chinese)');
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
r = await call('/authorize', form({ req, email: 'me@example.com', password: 'wrong', action: 'allow' }));
assert.equal(r.status, 400);
assert.match(await r.text(), /email or password isn’t right/);
ok('a wrong password is refused on the page');
r = await call('/authorize', form({ req, email: 'me@example.com', password: 'hunter22', action: 'allow' }));
assert.equal(r.status, 302);
const back = new URL(r.headers.get('location'));
assert.equal(back.origin + back.pathname, REDIRECT); assert.equal(back.searchParams.get('state'), 'st8');
const authCode = back.searchParams.get('code');
assert.ok(fake.docsOf(uid).claude.authAt > 0, 'the calculator sees when Claude connected');
assert.equal(fake.docsOf(uid).claude.authEmail, 'me@example.com');
ok('signing in sends Claude back with a code and notes the connection for the calculator');
const tokenReq = (o) => call('/token', form(o));
r = await tokenReq({ grant_type: 'authorization_code', code: authCode, code_verifier: 'x'.repeat(43), redirect_uri: REDIRECT, client_id: client.client_id });
assert.equal(r.status, 400);
r = await tokenReq({ grant_type: 'authorization_code', code: authCode, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id });
let tokens = await r.json();
assert.match(tokens.access_token, /^dca_/); assert.match(tokens.refresh_token, /^dcr_/);
ok('PKCE checked; tokens issued');

// ---- MCP ----
let rpcId = 0;
async function rpc(method, params, token = tokens.access_token) {
  const res = await call('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  if (res.status !== 200) return { status: res.status, auth: res.headers.get('www-authenticate') };
  return res.json();
}
async function tool(name, args) {
  const out = await rpc('tools/call', { name, arguments: args });
  if (!out.result) throw new Error(`${name}: ${JSON.stringify(out)}`);
  const text = out.result.content[0].text;
  return out.result.isError ? { error: text } : JSON.parse(text);
}
j = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
assert.equal(j.result.serverInfo.title, 'DCF Calculator');
assert.match(j.result.instructions, /Call get-overview first/);
j = await rpc('tools/list', {});
assert.deepEqual(j.result.tools.map((t) => t.name), ['get-overview', 'get-valuation', 'run-dcf', 'save-valuation', 'delete-valuations']);
assert.equal(j.result.tools.find((t) => t.name === 'delete-valuations').annotations.destructiveHint, true);
ok('initialize and tools/list');

let o = await tool('get-overview', {});
assert.equal(o.savedStocks, 0);
ok('get-overview with nothing saved');

// The same Vistra inputs the calculator's own Claude test uses: bear $93.79, base $150.14, bull $236.85.
const VST = {
  ticker: 'vst', company: 'Vistra Corp.', method: 'fcf',
  settings: { priceCurrency: 'USD', reportCurrency: '$', amountUnit: 'millions', sharesUnit: 'millions', baseYear: 2026 },
  facts: { fcf: 4325, cash: 435, debt: 19595, shares: 335.6, price: 120.29, dps: 0.924 }, r: 10,
  cases: { bear: { g1: 0, g2: 2, tg: 2, w: 25 }, base: { g1: 6, g2: 3, tg: 2.5, w: 50 }, bull: { g1: 12, g2: 5, tg: 3, w: 25 } },
};
o = await tool('run-dcf', VST);
assert.equal(o.ticker, 'VST');
assert.equal(o.cases.bear.fairValuePerShare, 93.79); assert.equal(o.cases.base.fairValuePerShare, 150.14); assert.equal(o.cases.bull.fairValuePerShare, 236.85);
assert.equal(o.fairValueIs, 'weighted across 3 cases');
assert.ok(Math.abs(o.fairValuePerShare - (93.79 * 25 + 150.14 * 50 + 236.85 * 25) / 100) < 0.01);
assert.equal(o.baseCase.projection.length, 10); assert.equal(o.baseCase.projection[0].year, 2027);
assert.equal(o.baseCase.sensitivity.fairValues[2][2], 150.14);
assert.ok(o.priceImplies && typeof o.priceImplies.valuePct === 'number');
assert.ok(o.dividends.dividendModelValuePerShare > 0);
assert.equal(fake.stats.commits, 1, 'run-dcf saves nothing (the one commit is the sign-in note)');
ok(`run-dcf gives the calculator's numbers (weighted ${o.fairValuePerShare}, ${o.signal}, MoS ${o.marginOfSafetyPct}%)`);

o = await tool('save-valuation', { ...VST, asOf: 'Q3 2026', note: 'From the Q3 2026 release.' });
assert.ok(o.saved.id);
const saved = fake.docsOf(uid)[o.saved.id];
assert.equal(saved.type, 'valuation'); assert.equal(saved.by, 'claude'); assert.equal(saved.v, 2);
assert.equal(saved.ticker, 'VST'); assert.equal(saved.asOf, 'Q3 2026');
assert.equal(saved.inputs.fcf, 4325); assert.equal(saved.inputs.currency, '$'); assert.equal(saved.scenarios.base.g1, 6);
assert.equal(+saved.result.base.toFixed(2), 150.14); assert.equal(saved.result.weighted, true); assert.equal(saved.result.signal, o.signal);
ok('save-valuation stores a snapshot in the calculator’s own format');

o = await tool('get-overview', {});
assert.equal(o.savedStocks, 1); assert.equal(o.stocks[0].ticker, 'VST'); assert.equal(o.stocks[0].latest.savedBy, 'Claude');
o = await tool('get-valuation', { ticker: 'vst' });
assert.equal(o.valuation.cases.base.fairValuePerShare, 150.14); assert.equal(o.note, 'From the Q3 2026 release.'); assert.equal(o.history.length, 1);
ok('get-overview and get-valuation read it back');

o = await tool('run-dcf', { ticker: 'VST', startFrom: 'latest', facts: { price: 100 } });
assert.equal(o.cases.base.fairValuePerShare, 150.14); assert.equal(o.sharePrice, 100); assert.equal(o.startedFrom.figuresAsOf, 'Q3 2026');
ok('startFrom "latest" changes only what is passed');

// A company that reports in US$ but trades in A$ needs the exchange rate.
o = await tool('run-dcf', { ticker: 'WTC.AX', settings: { priceCurrency: 'AUD', reportCurrency: 'USD' }, facts: { fcf: 380, shares: 334, price: 105.2 }, r: 9, cases: { base: { g1: 18, g2: 12, tg: 3 } } });
assert.match(o.error, /fxRate is needed/);
o = await tool('run-dcf', { ticker: 'WTC.AX', settings: { priceCurrency: 'AUD', reportCurrency: 'USD', fxRate: 1.53 }, facts: { fcf: 380, cash: 120, debt: 400, shares: 334, price: 105.2 }, r: 9, cases: { base: { g1: 18, g2: 12, tg: 3 } } });
assert.equal(o.settings.priceCurrency, 'A$'); assert.equal(o.settings.reportCurrency, '$'); assert.equal(o.fairValueIs, 'base case');
assert.ok(o.fairValuePerShare > 0);
ok(`currencies and exchange rate (WTC.AX ${o.settings.priceCurrency}${o.fairValuePerShare})`);
o = await tool('run-dcf', { ticker: 'X', facts: { fcf: 10, shares: 1 }, r: 0.1, cases: { base: { g1: 5, g2: 3, tg: 2 } } });
assert.match(o.error, /looks like a fraction/);
o = await tool('run-dcf', { ticker: 'X', settings: { priceCurrency: 'CHF' }, cases: { base: {} } });
assert.match(o.error, /isn’t one the calculator has/);
o = await tool('save-valuation', { ticker: 'X', facts: { fcf: 10 }, r: 10, cases: { base: { g1: 5 } } });
assert.match(o.error, /Nothing was saved.*missing/);
o = await tool('run-dcf', { ticker: 'X', facts: { fcf: 100, shares: 10, price: 50 }, r: 10, cases: { base: { g1: 0.05, g2: 0.03, tg: 0.02 } } });
assert.ok(o.checks.some((c) => /aren’t fractions/.test(c)));
ok('bad inputs get clear messages; nothing half-valued is saved');

const first = Object.keys(fake.docsOf(uid)).find((k) => k !== 'claude');
o = await tool('delete-valuations', { ids: [first, 'nope'] });
assert.equal(o.deleted.length, 1); assert.deepEqual(o.notFound, ['nope']);
assert.equal(fake.docsOf(uid)[first].deleted, true);
o = await tool('get-overview', {});
assert.equal(o.savedStocks, 0);
ok('delete-valuations removes it everywhere');

// ---- refresh and Disconnect ----
r = await tokenReq({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
const fresh = await r.json();
assert.match(fresh.access_token, /^dca_/);
o = await rpc('tools/call', { name: 'get-overview', arguments: {} }, fresh.access_token);
assert.ok(o.result && !o.result.isError);
ok('refresh token gives a working access token');
fake.put(uid, 'claude', { ...fake.docsOf(uid).claude, gen: 8 }); // what Disconnect in the calculator does
o = await rpc('tools/call', { name: 'get-overview', arguments: {} }, fresh.access_token);
assert.equal(o.status, 401); assert.match(o.auth, /invalid_token/);
r = await tokenReq({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token });
assert.equal((await r.json()).error, 'invalid_grant');
ok('Disconnect in the calculator cuts Claude off straight away');

await fake.close();
console.log(`connector: ${passed} checks passed`);
