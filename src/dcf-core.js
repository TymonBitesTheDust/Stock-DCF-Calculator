/* DCF core: the calculator's fields, number parsing and valuation maths, with no page code.
 * The app (src/app.html) and the Claude connector (connector/) both run this same file, so a
 * valuation Claude saves gives exactly the numbers the app shows when it is loaded.
 *
 * A model is `st` = { values, sc, active }: values holds the stock-wide inputs as the text the
 * user typed ('1,250', '12', '1.2B'), sc holds the bear/base/bull inputs the same way.
 * build.mjs pastes this file into the app's script and bundles it into the connector. */
const DCF = (function () {
  'use strict';

  /* ================= configuration ================= */
  const UNITS = {
    '1e3': { mult: 1e3, short: 'K', word: ['thousands', '千'], label: ['Thousands (K)', '千 (K)'] },
    '1e6': { mult: 1e6, short: 'M', word: ['millions', '百萬'], label: ['Millions (M)', '百萬 (M)'] },
    '1e9': { mult: 1e9, short: 'B', word: ['billions', '十億'], label: ['Billions (B)', '十億 (B)'] },
  };
  const SHARE_UNITS = {
    '1':   { mult: 1,   label: ['shares', '股'], word: ['single shares', '股'] },
    '1e3': { mult: 1e3, label: ['K', '千股'], word: ['thousands of shares', '千股'] },
    '1e6': { mult: 1e6, label: ['M', '百萬股'], word: ['millions of shares', '百萬股'] },
    '1e9': { mult: 1e9, label: ['B', '十億股'], word: ['billions of shares', '十億股'] },
  };
  const CURRENCIES = [['$', ['$ · US dollar', '$ · 美元']], ['A$', ['A$ · Australian dollar', 'A$ · 澳幣']], ['NT$', ['NT$ · NT dollar', 'NT$ · 新台幣']], ['HK$', ['HK$ · HK dollar', 'HK$ · 港幣']],
    ['¥', ['¥ · Yen / Yuan', '¥ · 日圓／人民幣']], ['€', ['€ · Euro', '€ · 歐元']], ['£', ['£ · Pound', '£ · 英鎊']]];

  // sc: true = kept separately for each case. en/zh labels (zh follows the sheet), s = short names for messages, h = hints.
  const F = {
    fcf:     { kind: 'money', en: 'TTM free cash flow', zh: '自由現金流（基期）', s: ['TTM free cash flow', '自由現金流'], h: ['Last 12 months. Negative: -120 or (120).', '近 12 個月。負數可輸入 -120 或 (120)。'] },
    revenue: { kind: 'money', en: 'TTM revenue', zh: 'TTM 營收', s: ['TTM revenue', 'TTM 營收'], h: ['Needed for the Revenue × FCF margin method and the margin check.', '「營收 × FCF 利潤率」方法和利潤率檢查需要。'] },
    sbc:     { kind: 'money', en: 'Stock-based compensation', zh: '股票薪酬 (SBC)', s: ['stock-based pay', '股票薪酬'], h: ['Optional. Subtracted from FCF, because paying staff in stock dilutes shareholders.', '選填。會從 FCF 扣除，因為用股票發薪會稀釋股東權益。'] },
    g1:      { kind: 'pct', sc: true, en: 'FCF growth, years 1–5', zh: '未來成長率（一~五年）', s: ['FCF growth for years 1–5', '一~五年成長率'], h: ['Yearly growth of free cash flow.', '自由現金流每年的成長率。'] },
    rg1:     { kind: 'pct', sc: true, en: 'Revenue growth, years 1–5', zh: '營收成長（y1-5）', s: ['revenue growth for years 1–5', '一~五年營收成長'], h: ['Optional. For the margin check.', '選填。用於利潤率檢查。'], hM: ['Drives revenue in this method.', '此方法用它推估營收。'] },
    g2:      { kind: 'pct', sc: true, en: 'FCF growth, years 6–10', zh: '二階成長率（六~十年）', s: ['FCF growth for years 6–10', '六~十年成長率'], h: ['Usually lower than years 1–5.', '通常低於一~五年。'], copyFrom: 'g1' },
    rg2:     { kind: 'pct', sc: true, en: 'Revenue growth, years 6–10', zh: '營收成長（y6-10）', s: ['revenue growth for years 6–10', '六~十年營收成長'], h: ['Optional.', '選填。'], hM: ['Usually lower than years 1–5.', '通常低於一~五年。'], copyFrom: 'rg1' },
    tm:      { kind: 'pct', sc: true, en: 'Target FCF margin', zh: '目標 FCF 利潤率', s: ['target FCF margin', '目標 FCF 利潤率'], h: ['FCF as a % of revenue once the business settles.', '營運穩定後 FCF 佔營收的比例。'] },
    tmYear:  { kind: 'int', sc: true, en: 'Year the target is reached', zh: '達到目標的年份', s: ['target year', '目標年份'], h: ['1–10. The margin moves in a straight line until then. Blank = 5.', '1–10。在此之前利潤率直線變化，空白視為 5。'], ph: '5' },
    tg:      { kind: 'pct', sc: true, en: 'Terminal growth', zh: '永久成長率', s: ['terminal growth', '永久成長率'], h: ['Growth after year 10, forever. Usually 2–3%.', '第十年之後的永續成長率，通常 2–3%。'] },
    w:       { kind: 'pct', sc: true, en: 'Weight of this case', zh: '此情境權重', s: ['weight', '權重'], h: ['How likely you think this case is. Used for the weighted value.', '你認為此情境發生的機率，用於加權合理價。'] },
    r:       { kind: 'pct', en: 'Discount rate', zh: '期望折現率（期望收益率）', s: ['discount rate', '折現率'], h: ['Your required return. Discounts every year, as in the sheet.', '你要求的報酬率。和試算表一樣，每一年都用它折現。'] },
    wacc:    { kind: 'pct', en: 'WACC', zh: '折現率 (WACC)', s: ['WACC', 'WACC'], h: ['Reference only.', '僅供參考。'], useWacc: true },
    cash:    { kind: 'money', en: 'Cash & investments', zh: '(+) 現金及其他投資', s: ['cash & investments', '現金及其他投資'], h: ['Blank counts as 0.', '空白視為 0。'] },
    debt:    { kind: 'money', en: 'Total debt', zh: '(−) 總負債', s: ['total debt', '總負債'], h: ['Interest-bearing debt, not all liabilities. Blank counts as 0.', '只填有息負債，不是全部負債。空白視為 0。'] },
    shares:  { kind: 'shares', en: 'Shares outstanding', zh: '流通股數', s: ['shares outstanding', '流通股數'], h: ['Pick the unit your source uses.', '選擇和資料來源相同的單位。'] },
    price:   { kind: 'price', en: 'Current share price', zh: '股票當前價格', s: ['current share price', '股票當前價格'], h: ['Needed for margin of safety.', '計算安全邊際需要。'] },
    dps:     { kind: 'price', en: 'Dividend per share, yearly', zh: '每股股利（年）', s: ['dividend per share', '每股股利'], h: ['Optional. Last 12 months, or the quarterly dividend × 4.', '選填。近 12 個月，或季配息 × 4。'] },
    dg:      { kind: 'pct', en: 'Dividend growth, years 1–10', zh: '股利成長率（1–10 年）', s: ['dividend growth', '股利成長率'], h: ['Optional. Blank = terminal growth.', '選填。空白視為永久成長率。'] },
    past5:   { kind: 'pct', en: 'Past 5-year growth', zh: '過去五年成長率', s: ['past 5-year growth', '過去五年成長率'], h: ['Compared with your growth inputs.', '用來對照你的成長假設。'] },
    ath:     { kind: 'pct', en: 'Peak FCF margin (all-time high)', zh: '歷史最高 FCF 利潤率', s: ['peak FCF margin', '歷史最高 FCF 利潤率'], h: ['Flags projected margins above it.', '預測利潤率超過時會提醒。'] },
    buyAt:   { kind: 'pct', en: 'Buy when margin of safety ≥', zh: '安全邊際 ≥ 此值時買進', s: ['buy level', '買進門檻'], h: ['Default 25%.', '預設 25%。'], ph: '25' },
    sellAt:  { kind: 'pct', en: 'Sell when margin of safety ≤', zh: '安全邊際 ≤ 此值時賣出', s: ['sell level', '賣出門檻'], h: ['Default −10%. Set both to 0 to match the sheet.', '預設 −10%。兩者都設 0 就和試算表一樣。'], ph: '-10' },
    fx:      { kind: 'rate', en: 'Exchange rate', zh: '匯率', s: ['exchange rate', '匯率'], h: ['', ''] },
  };
  const FKEYS = Object.keys(F);
  const SC_KEYS = FKEYS.filter(k => F[k].sc);
  const FACT_KEYS = FKEYS.filter(k => !F[k].sc);
  const SCN = ['bear', 'base', 'bull'];
  const DEF_W = { bear: 25, base: 50, bull: 25 };
  const REQ = { fcf: ['fcf', 'g1', 'g2', 'r', 'tg', 'shares'], margin: ['fcf', 'revenue', 'rg1', 'rg2', 'tm', 'r', 'tg', 'shares'] };
  const DEFAULTS = { ticker: '', name: '', currency: '$', rcurrency: '', unit: '1e6', sharesUnit: '1e6', baseYear: String(new Date().getFullYear()), method: 'fcf', buyAt: '25', sellAt: '-10' };

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const pick = (a, b) => (a != null ? a : b);
  const normTicker = s => String(s || '').trim().toUpperCase().slice(0, 24);
  function emptySc() { return { bear: { w: '25' }, base: { w: '50' }, bull: { w: '25' } }; }

  /* ================= number parsing ================= */
  // Accepts 1,234.5 · $1.2B · (120) · 12% · 25億 · full-width digits from CJK keyboards.
  const SUF = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, '萬': 1e4, '万': 1e4, '億': 1e8, '亿': 1e8 };
  function toAscii(s) { return s.replace(/[０-９．－％（），＋]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); }
  function parseRaw(raw, kind) {
    let s = toAscii(String(raw == null ? '' : raw)).trim();
    if (!s) return { empty: true };
    s = s.replace(/−/g, '-').replace(/[\s,_]/g, '').replace(/^([-+]?)(?:US|NT|HK|RMB|CN|AU|A)?[$¥€£]/i, '$1');
    let neg = false;
    const paren = s.match(/^\((.*)\)$/);
    if (paren) { neg = true; s = paren[1]; }
    let pct = false;
    if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
    const m = s.match(/^([-+]?)(\d+(?:\.\d*)?|\.\d+)([kmbt萬万億亿]?)$/i);
    if (!m) return { empty: false, bad: true };
    let v = parseFloat(m[2]);
    if (m[1] === '-') v = -v;
    if (neg) v = -v;
    const suf = m[3] ? SUF[m[3].toLowerCase()] : null;
    if (suf && (kind === 'pct' || kind === 'int' || kind === 'rate')) return { empty: false, bad: true };
    if (kind === 'rate' && !(v > 0)) return { empty: false, bad: true };
    if (pct && kind !== 'pct') return { empty: false, bad: true };
    if (kind === 'int' && (v !== Math.round(v) || v < 1 || v > 10)) return { empty: false, bad: true };
    return { empty: false, bad: false, v: v, suf: suf, text: m[2] };
  }
  // How a number is written back into a box (the same text the app shows after loading a save).
  function fmtInput(v, kind) {
    if (kind === 'pct') return String(+v.toFixed(4));
    if (kind === 'int') return String(Math.round(v));
    if (kind === 'rate') return String(+v.toFixed(6));
    if (kind === 'price') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  /* ================= reading a model ================= */
  const unitOf = st => UNITS[st.values.unit] || UNITS['1e6'];
  const sharesOf = st => SHARE_UNITS[st.values.sharesUnit] || SHARE_UNITS['1e6'];
  const curOf = st => st.values.currency || '$';
  // Financial statements can use another currency than the share price (e.g. WiseTech reports in US$, trades in A$).
  const rcurOf = st => st.values.rcurrency || curOf(st);
  const needFxOf = st => !!st.values.rcurrency && st.values.rcurrency !== curOf(st);
  const methodOf = st => (st.values.method === 'margin' ? 'margin' : 'fcf');
  const scFilledOf = (st, s) => SC_KEYS.some(k => k !== 'w' && String((st.sc[s] || {})[k] || '').trim() !== '');
  function baseYearOf(st) {
    const y = parseInt(toAscii(String(st.values.baseYear || '')), 10);
    return y > 1900 && y < 3000 ? y : new Date().getFullYear();
  }
  function baseMult(st, kind) { return kind === 'money' ? unitOf(st).mult : kind === 'shares' ? sharesOf(st).mult : 1; }
  const rawOf = (st, k, s) => (F[k].sc ? (st.sc[s || st.active || 'base'] || {})[k] : st.values[k]);
  function num(st, k, s) {
    const p = parseRaw(rawOf(st, k, s), F[k].kind);
    if (p.empty) return null;
    if (p.bad) return NaN;
    return p.suf ? p.v * p.suf / baseMult(st, F[k].kind) : p.v;
  }

  /* ================= the model ================= */
  // Sheet formulas, extended: FCF_t grows at C3 (yrs 1–5) / C8 (yrs 6–10), or revenue × a margin path in the margin method.
  // TV = FCF10 × (1 + g∞) / (r − g∞) · EV = NPV(r, years 1–10 incl. TV) · equity = EV + cash − debt · fair = equity / shares.
  // n = one case's numbers plus what compute needs from the settings (units, exchange rate, base year).
  function readModel(st, s) {
    const n = { method: methodOf(st), s: s, unitMult: unitOf(st).mult, shareMult: sharesOf(st).mult, needFx: needFxOf(st), baseYear: baseYearOf(st) };
    FKEYS.forEach(k => { n[k] = num(st, k, s); });
    return n;
  }
  function blockers(n) {
    const req = REQ[n.method];
    const keys = FACT_KEYS.concat(SC_KEYS);
    const bad = keys.filter(k => Number.isNaN(n[k]));
    const missing = req.filter(k => n[k] == null);
    if (n.needFx && n.fx == null) missing.push('fx');
    const rate = isNum(n.r) && isNum(n.tg) && n.r <= n.tg;
    const shares = isNum(n.shares) && n.shares <= 0;
    const rev0 = n.method === 'margin' && isNum(n.revenue) && n.revenue <= 0;
    const blocking = bad.filter(k => req.indexOf(k) >= 0 || (k === 'tmYear' && n.method === 'margin') || k === 'sbc' || (k === 'fx' && n.needFx));
    return { bad: bad, missing: missing, rate: rate, shares: shares, rev0: rev0, ok: !blocking.length && !missing.length && !rate && !shares && !rev0 };
  }
  function rule(n) {
    const buy = isNum(n.buyAt) ? n.buyAt / 100 : 0.25, sell = isNum(n.sellAt) ? n.sellAt / 100 : -0.10;
    return buy < sell ? { buy: 0, sell: 0, bad: true } : { buy: buy, sell: sell, bad: false };
  }
  function signalFor(mos, n) {
    if (mos == null) return null;
    const q = rule(n);
    if (mos >= q.buy && mos > q.sell) return 'BUY';
    if (mos <= q.sell) return 'SELL';
    return 'HOLD';
  }
  // o: overrides for what-ifs (r, tg, g1, tm) and for values from outside the settings (unitMult, shareMult, fx).
  function compute(n, o) {
    o = o || {};
    const r = pick(o.r, n.r) / 100, tg = pick(o.tg, n.tg) / 100;
    if (!(r > tg)) return null;
    const margin = n.method === 'margin';
    const sbc = isNum(n.sbc) ? n.sbc : 0;
    const f0 = n.fcf - sbc;
    const rev0 = isNum(n.revenue) && n.revenue > 0 ? n.revenue : null;
    if (margin && rev0 == null) return null;
    const m0 = rev0 ? f0 / rev0 : null;
    const g1 = pick(o.g1, n.g1) / 100, g2 = n.g2 / 100;
    const rg1 = isNum(n.rg1) ? n.rg1 / 100 : null, rg2 = isNum(n.rg2) ? n.rg2 / 100 : null;
    const tm = pick(o.tm, n.tm) / 100, N = isNum(n.tmYear) ? n.tmYear : 5;
    const by = isNum(n.baseYear) ? n.baseYear : new Date().getFullYear();
    let f = f0, rev = rev0, sumPV = 0;
    const years = [];
    for (let i = 1; i <= 10; i++) {
      const rg = i <= 5 ? rg1 : rg2, prev = f;
      rev = rev != null && rg != null ? rev * (1 + rg) : null;
      if (margin) f = rev * (i < N ? m0 + (tm - m0) * i / N : tm);
      else f = f * (1 + (i <= 5 ? g1 : g2));
      const g = margin ? (prev > 0 ? f / prev - 1 : null) : (i <= 5 ? g1 : g2);
      const df = Math.pow(1 + r, -i), pv = f * df;
      sumPV += pv;
      years.push({ t: i, year: by + i, g: g, rev: rev, fcf: f, margin: rev ? f / rev : null, df: df, pv: pv });
    }
    const last = years[9];
    const tv = last.fcf * (1 + tg) / (r - tg), pvTV = tv * last.df;
    const cash = isNum(n.cash) ? n.cash : 0, debt = isNum(n.debt) ? n.debt : 0;
    const ev = sumPV + pvTV, equity = ev + cash - debt;
    const fx = o.fx != null ? o.fx : n.needFx ? n.fx : 1;
    const fair = equity * pick(o.unitMult, isNum(n.unitMult) ? n.unitMult : 1e6) * fx / (n.shares * pick(o.shareMult, isNum(n.shareMult) ? n.shareMult : 1e6));
    const price = isNum(n.price) && n.price > 0 ? n.price : null;
    const mos = price ? (fair - price) / price : null;
    return { fx: fx, years: years, tv: tv, pvTV: pvTV, sumPV: sumPV, ev: ev, cash: cash, debt: debt, equity: equity, fair: fair, price: price, mos: mos,
      signal: signalFor(mos, n), f0: f0, rev0: rev0, m0: m0 };
  }
  function evalCase(st, s) {
    const n = readModel(st, s), b = blockers(n);
    return { s: s, n: n, b: b, res: b.ok ? compute(n) : null, filled: s === 'base' || scFilledOf(st, s) };
  }
  function weightedOf(all) {
    const done = all.filter(x => x.res && x.filled);
    if (done.length < 2) return null;
    let ws = done.map(x => (isNum(x.n.w) ? Math.max(0, x.n.w) : DEF_W[x.s]));
    let sum = ws.reduce((a, b) => a + b, 0), equal = false;
    if (sum <= 0) { ws = ws.map(() => 1); sum = ws.length; equal = true; }
    const fair = done.reduce((acc, x, i) => acc + x.res.fair * ws[i], 0) / sum;
    const price = done[0].res.price, mos = price ? (fair - price) / price : null;
    const fairs = done.map(x => x.res.fair);
    return { fair: fair, price: price, mos: mos, signal: signalFor(mos, done[0].n), count: done.length, min: Math.min.apply(null, fairs), max: Math.max.apply(null, fairs),
      equal: equal, share: done.reduce((m, x, i) => { m[x.s] = ws[i] / sum; return m; }, {}) };
  }
  // Reverse DCF: the years 1–5 growth (or target margin) that makes fair value equal the price, holding everything else.
  function implied(n) {
    if (!isNum(n.price) || n.price <= 0) return null;
    const key = n.method === 'margin' ? 'tm' : 'g1';
    if (key === 'g1' && !(n.fcf - (isNum(n.sbc) ? n.sbc : 0) > 0)) return null;
    const lo = key === 'tm' ? -30 : -90, hi = key === 'tm' ? 80 : 200;
    const f = x => { const o = {}; o[key] = x; const r = compute(n, o); return r ? r.fair - n.price : NaN; };
    let a = lo, b = hi;
    const fa = f(a), fb = f(b);
    if (!isNum(fa) || !isNum(fb)) return null;
    if (fa > 0) return { key: key, below: true, value: lo };
    if (fb < 0) return { key: key, above: true, value: hi };
    for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (f(m) > 0) b = m; else a = m; }
    return { key: key, value: (a + b) / 2 };
  }
  // Dividend discount model: dividends grow at dg for 10 years, then at terminal growth forever.
  function ddm(n) {
    if (!isNum(n.dps) || n.dps <= 0 || !isNum(n.r) || !isNum(n.tg)) return null;
    const r = n.r / 100, tg = n.tg / 100, dg = isNum(n.dg) ? n.dg / 100 : tg;
    if (!(r > tg)) return null;
    let d = n.dps, pv = 0;
    for (let i = 1; i <= 10; i++) { d *= 1 + dg; pv += d / Math.pow(1 + r, i); }
    return pv + d * (1 + tg) / (r - tg) / Math.pow(1 + r, 10);
  }
  // Dividends paid, in the reporting currency and amount unit (the dividend per share is in the share price currency).
  const dividendsPaid = n => {
    const fx = n.needFx ? n.fx : 1;
    return isNum(n.dps) && n.dps > 0 && isNum(n.shares) && n.shares > 0 && isNum(fx) && fx > 0 ? n.dps * n.shares * n.shareMult / n.unitMult / fx : null;
  };

  /* ================= saved snapshots ================= */
  // What "Save snapshot" stores (version 2): the numbers as numbers, each case's inputs, and the result.
  function snapshot(st) {
    const clean = v => (isNum(v) ? v : null);
    const all = SCN.map(s => evalCase(st, s)), W = weightedOf(all), base = all[1];
    const inputs = {};
    FACT_KEYS.forEach(k => { inputs[k] = clean(base.n[k]); });
    Object.assign(inputs, { currency: curOf(st), rcurrency: st.values.rcurrency || null, unit: st.values.unit, sharesUnit: st.values.sharesUnit, baseYear: baseYearOf(st), method: methodOf(st) });
    const scenarios = {};
    all.forEach(x => {
      if (!x.filled) { scenarios[x.s] = null; return; }
      const o = {}; SC_KEYS.forEach(k => { o[k] = clean(x.n[k]); }); scenarios[x.s] = o;
    });
    const head = W || (base.res ? { fair: base.res.fair, price: base.res.price, mos: base.res.mos, signal: base.res.signal } : null);
    const fairOf = s => { const x = all.find(z => z.s === s); return x && x.res && x.filled ? clean(x.res.fair) : null; };
    return {
      inputs: inputs, scenarios: scenarios,
      result: head ? { fair: clean(head.fair), price: clean(head.price), mos: clean(head.mos), signal: head.signal || null, weighted: !!W,
        bear: fairOf('bear'), base: fairOf('base'), bull: fairOf('bull'), ddm: clean(ddm(base.n)) } : null,
    };
  }
  // A saved snapshot back into a model, the way "Load" fills in the boxes. Returns null for saves older than version 2.
  function fromSnapshot(e) {
    if (!e || !e.scenarios) return null;
    const i = e.inputs || {};
    const values = {
      ticker: e.ticker, name: e.name || '', currency: i.currency || '$', rcurrency: i.rcurrency || '', method: i.method === 'margin' ? 'margin' : 'fcf',
      unit: UNITS[i.unit] ? i.unit : '1e6', sharesUnit: SHARE_UNITS[i.sharesUnit] ? i.sharesUnit : '1e6',
      baseYear: String(i.baseYear || DEFAULTS.baseYear),
    };
    FACT_KEYS.forEach(k => { values[k] = isNum(i[k]) ? fmtInput(i[k], F[k].kind) : (k === 'buyAt' || k === 'sellAt' ? DEFAULTS[k] : ''); });
    const sc = emptySc();
    SCN.forEach(s => {
      const o = e.scenarios[s];
      if (o) SC_KEYS.forEach(k => { sc[s][k] = isNum(o[k]) ? fmtInput(o[k], F[k].kind) : (k === 'w' ? String(DEF_W[s]) : ''); });
    });
    return { values: values, sc: sc, active: 'base' };
  }

  return {
    UNITS: UNITS, SHARE_UNITS: SHARE_UNITS, CURRENCIES: CURRENCIES, F: F, FKEYS: FKEYS, SC_KEYS: SC_KEYS, FACT_KEYS: FACT_KEYS, SCN: SCN, DEF_W: DEF_W, REQ: REQ, DEFAULTS: DEFAULTS,
    isNum: isNum, pick: pick, normTicker: normTicker, emptySc: emptySc, toAscii: toAscii, parseRaw: parseRaw, fmtInput: fmtInput,
    unitOf: unitOf, sharesOf: sharesOf, curOf: curOf, rcurOf: rcurOf, needFxOf: needFxOf, methodOf: methodOf, scFilledOf: scFilledOf, baseYearOf: baseYearOf, rawOf: rawOf, num: num,
    readModel: readModel, blockers: blockers, rule: rule, signalFor: signalFor, compute: compute, evalCase: evalCase, weightedOf: weightedOf,
    implied: implied, ddm: ddm, dividendsPaid: dividendsPaid, snapshot: snapshot, fromSnapshot: fromSnapshot,
  };
})();
