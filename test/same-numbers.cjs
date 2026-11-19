// Loads the same saved valuations into two builds of the calculator and checks every number
// on screen matches. Usage: node test/same-numbers.cjs old.html new.html
const { chromium } = require('playwright');
const path = require('path');
const [, , A, B] = process.argv;
const E = (tk, inputs, scenarios) => ({ v: 2, ticker: tk, name: tk + ' Inc', savedAtMs: Date.UTC(2026, 10, 1), savedAt: '2026-11-01T00:00:00.000Z', inputs, scenarios, result: { fair: 1 } });
const base = { currency: '$', rcurrency: null, unit: '1e6', sharesUnit: '1e6', baseYear: 2026, buyAt: 25, sellAt: -10 };
const ENTRIES = [
  E('FCFA', { ...base, method: 'fcf', fcf: 2000, revenue: 10000, sbc: 150, r: 10, wacc: 9, cash: 5000, debt: 3000, shares: 1000, price: 40, dps: 0.8, dg: 5, past5: 15, ath: 25 },
    { bear: { g1: 5, rg1: 5, g2: 4, rg2: 4, tm: 18, tmYear: 5, tg: 2, w: 25 }, base: { g1: 12, rg1: 10, g2: 8, rg2: 7, tm: 22, tmYear: 5, tg: 3, w: 50 }, bull: { g1: 18, rg1: 14, g2: 10, rg2: 9, tm: 25, tmYear: 5, tg: 3, w: 25 } }),
  E('MARG', { ...base, method: 'margin', fcf: -50, revenue: 4000, sbc: 80, r: 11, cash: 900, debt: 200, shares: 250, price: 22.5, ath: 20 },
    { bear: { rg1: 8, rg2: 5, tm: 10, tmYear: 6, tg: 2, w: 30 }, base: { rg1: 15, rg2: 8, tm: 15, tmYear: 4, tg: 2.5, w: 40 }, bull: { rg1: 22, rg2: 10, tm: 20, tmYear: 3, tg: 3, w: 30 } }),
  E('WTC.AX', { ...base, currency: 'A$', rcurrency: '$', fx: 1.53, method: 'fcf', fcf: 380, revenue: 1050, r: 9, cash: 120, debt: 400, shares: 334, price: 105.2, dps: 0.24 },
    { bear: { g1: 10, g2: 7, tg: 2.5, w: 25 }, base: { g1: 18, g2: 12, tg: 3, w: 50 }, bull: null }),
  E('KUNIT', { ...base, unit: '1e3', sharesUnit: '1', method: 'fcf', fcf: 52000, r: 12, cash: 3000, debt: 0, shares: 41000000, price: 7.1 },
    { bear: null, base: { g1: 4, g2: 3, tg: 2, w: 50 }, bull: null }),
];
async function grab(file) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(h => { if (!localStorage.getItem('seeded')) { localStorage.setItem('dcf-history-v1', JSON.stringify(h)); localStorage.setItem('seeded', '1'); } }, ENTRIES.map((e, i) => ({ id: 'e' + i, ...e })));
  await p.goto('file://' + path.resolve(file)); await p.waitForTimeout(400);
  const out = {};
  for (const e of ENTRIES) {
    await p.click(`.stock[data-ticker="${e.ticker}"] .stock-head`);
    await p.click(`.stock[data-ticker="${e.ticker}"] [data-act="load"]`);
    await p.waitForTimeout(150);
    for (const s of ['bear', 'base', 'bull']) {
      await p.click('#tab-' + s); await p.waitForTimeout(60);
      out[e.ticker + ':' + s] = await p.evaluate(() => ['#signal', '#fair', '#v-price', '#v-mos', '#v-weighted', '#scen', '#checks', '#xchk', '#bridge', '#proj', '#sens-wrap', '#tv-bear', '#tv-base', '#tv-bull'].map(sel => { const el = document.querySelector(sel); return el ? el.innerText.replace(/\s+/g, ' ') : ''; }).join(' | '));
    }
  }
  await b.close();
  return { out, errs };
}
(async () => {
  const a = await grab(A), b = await grab(B);
  let diff = 0;
  for (const k of Object.keys(a.out)) if (a.out[k] !== b.out[k]) { diff++; console.log('DIFF', k, '\n  old:', a.out[k].slice(0, 300), '\n  new:', b.out[k].slice(0, 300)); }
  console.log('compared', Object.keys(a.out).length, 'screens;', diff, 'differ; errors:', a.errs.concat(b.errs).join('; ') || 'none');
  console.log('sample:', b.out['WTC.AX:base'].slice(0, 160));
  process.exit(diff || a.errs.length || b.errs.length ? 1 : 0);
})();
