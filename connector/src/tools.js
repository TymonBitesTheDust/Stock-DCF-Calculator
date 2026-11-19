// The tools Claude can use. Valuations are worked out by src/dcf-core.js, the same code the
// calculator runs, and saved as the same snapshots the calculator's "Save snapshot" makes, so
// a valuation Claude saves shows exactly the same numbers when it's opened in the calculator.
import DCF from '../../src/dcf-core.js';
import { isConflict, isAuthError } from './firebase.js';

export const CONNECTOR_ID = 'claude';
const MAX_DELETE = 50;

export class ToolError extends Error {}
export class AccessError extends Error {}

const { F, SCN, SC_KEYS, FACT_KEYS, DEF_W, isNum } = DCF;
const AMOUNT_UNITS = { thousands: '1e3', millions: '1e6', billions: '1e9' };
const SHARE_UNITS = { single: '1', thousands: '1e3', millions: '1e6', billions: '1e9' };
const UNIT_WORD = { '1e3': 'thousands', '1e6': 'millions', '1e9': 'billions' };
const SHARE_WORD = { '1': 'single', '1e3': 'thousands', '1e6': 'millions', '1e9': 'billions' };
const CURRENCIES = DCF.CURRENCIES.map((c) => c[0]);
// ISO codes and common spellings Claude may use, mapped to the calculator's currency symbols.
const CURRENCY_ALIASES = {
  USD: '$', US$: '$', AUD: 'A$', AU$: 'A$', TWD: 'NT$', NTD: 'NT$', HKD: 'HK$', JPY: '¥', CNY: '¥', RMB: '¥', EUR: '€', GBP: '£',
};
const FACT_IN = ['fcf', 'revenue', 'sbc', 'cash', 'debt', 'shares', 'price', 'dps', 'dg', 'wacc', 'past5', 'ath'];
const CASE_IN = ['g1', 'g2', 'rg1', 'rg2', 'tm', 'tmYear', 'tg', 'w'];

const r2 = (v, d = 2) => (isNum(v) ? +v.toFixed(d) : null);
const pct = (f, d = 1) => (isNum(f) ? +(f * 100).toFixed(d) : null);
const clone = (o) => JSON.parse(JSON.stringify(o));
const label = (k) => F[k].s[0];

// ---------- reading Claude's inputs ----------

function text(v, name, { max = 200 } = {}) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') throw new ToolError(`“${name}” must be text.`);
  const s = String(v).trim();
  if (s.length > max) throw new ToolError(`“${name}” is too long (${s.length} characters; the limit is ${max}).`);
  return s;
}

function currencyIn(v, name) {
  const s = text(v, name, { max: 8 });
  if (s == null) return null;
  const up = s.toUpperCase();
  if (CURRENCIES.includes(s)) return s;
  if (CURRENCY_ALIASES[up]) return CURRENCY_ALIASES[up];
  const sym = CURRENCIES.find((c) => c.toUpperCase() === up);
  if (sym) return sym;
  throw new ToolError(`${name} “${s}” isn’t one the calculator has. Use one of ${CURRENCIES.join(' ')} (or USD, AUD, TWD, HKD, JPY, CNY, EUR, GBP).`);
}

// A number for one box, written the way the calculator writes it after loading a save.
// null clears the box. Text such as "1.2B" or "(120)" is read the way the calculator reads typing.
function boxText(k, v) {
  if (v === null) return '';
  const kind = F[k].kind;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new ToolError(`“${k}” must be a finite number.`);
    if (kind === 'int' && (v !== Math.round(v) || v < 1 || v > 10)) throw new ToolError(`“${k}” (${label(k)}) must be a whole number from 1 to 10.`);
    if (kind === 'rate' && !(v > 0)) throw new ToolError('The exchange rate must be above 0.');
    return DCF.fmtInput(v, kind);
  }
  if (typeof v === 'string') {
    const p = DCF.parseRaw(v, kind);
    if (p.empty) return '';
    if (p.bad) throw new ToolError(`Couldn’t read “${v}” for “${k}” (${label(k)}). Pass a plain number${kind === 'pct' ? ': 12 means 12%' : ''}.`);
    return v.trim();
  }
  throw new ToolError(`“${k}” must be a number (or null to leave it blank).`);
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Turns the tool's arguments into a model the calculator understands: { values, sc, active }.
// `start` is a saved valuation's model to change, or null to start from a blank one.
function modelFrom(args, start) {
  const st = start ? clone(start) : { values: { ...DCF.DEFAULTS }, sc: DCF.emptySc(), active: 'base' };
  st.active = 'base';
  const v = st.values;
  const tk = DCF.normTicker(text(args.ticker, 'ticker', { max: 24 }) || v.ticker);
  if (!tk) throw new ToolError('“ticker” is required, such as "NVDA", "WTC.AX" or "2330.TW".');
  v.ticker = tk;
  const company = text(args.company, 'company', { max: 120 });
  if (company) v.name = company;

  const s = args.settings;
  if (s != null && !isObj(s)) throw new ToolError('“settings” must be an object.');
  if (s) {
    const pc = currencyIn(s.priceCurrency, 'priceCurrency');
    if (pc) v.currency = pc;
    if ('reportCurrency' in s) {
      const rc = currencyIn(s.reportCurrency, 'reportCurrency');
      v.rcurrency = rc && rc !== (v.currency || '$') ? rc : '';
    } else if (pc && v.rcurrency === pc) v.rcurrency = '';
    if (s.fxRate !== undefined) v.fx = s.fxRate == null ? '' : boxText('fx', s.fxRate);
    if (s.amountUnit != null) {
      if (!AMOUNT_UNITS[s.amountUnit]) throw new ToolError('amountUnit must be "thousands", "millions" or "billions".');
      v.unit = AMOUNT_UNITS[s.amountUnit];
    }
    if (s.sharesUnit != null) {
      if (!SHARE_UNITS[s.sharesUnit]) throw new ToolError('sharesUnit must be "single", "thousands", "millions" or "billions".');
      v.sharesUnit = SHARE_UNITS[s.sharesUnit];
    }
    if (s.baseYear != null) {
      const y = Number(s.baseYear);
      if (!(Number.isInteger(y) && y > 1900 && y < 3000)) throw new ToolError('baseYear must be a year such as 2026.');
      v.baseYear = String(y);
    }
  }
  if (DCF.needFxOf(st) && !String(v.fx || '').trim()) {
    throw new ToolError(`The figures are in ${v.rcurrency} but the share price is in ${v.currency}, so settings.fxRate is needed: how many ${v.currency} one ${v.rcurrency} buys.`);
  }
  if (args.method != null) {
    if (args.method !== 'fcf' && args.method !== 'margin') throw new ToolError('method must be "fcf" or "margin".');
    v.method = args.method;
  }

  if (args.facts != null && !isObj(args.facts)) throw new ToolError('“facts” must be an object.');
  const facts = args.facts || {};
  for (const k of Object.keys(facts)) {
    if (!FACT_IN.includes(k)) throw new ToolError(`Unknown fact “${k}”. Facts are ${FACT_IN.join(', ')}.`);
    if (facts[k] !== undefined) v[k] = boxText(k, facts[k]);
  }
  for (const k of ['r', 'buyAt', 'sellAt']) if (args[k] !== undefined) v[k] = boxText(k, args[k]);
  const r = DCF.num(st, 'r');
  if (isNum(r) && r > 0 && r < 1) throw new ToolError(`The discount rate ${r} looks like a fraction. Percentages are plain numbers: pass 10 for 10%.`);

  if (args.cases != null && !isObj(args.cases)) throw new ToolError('“cases” must be an object with bear, base and bull.');
  const cases = args.cases || {};
  for (const name of Object.keys(cases)) {
    if (!SCN.includes(name)) throw new ToolError(`Unknown case “${name}”. Cases are bear, base and bull.`);
    const c = cases[name];
    if (c === null) {
      if (name === 'base') throw new ToolError('The base case can’t be removed.');
      st.sc[name] = { w: String(DEF_W[name]) };
      continue;
    }
    if (!isObj(c)) throw new ToolError(`cases.${name} must be an object such as {"g1": 12, "g2": 8, "tg": 3, "w": 50}.`);
    const box = start ? { ...(st.sc[name] || {}) } : { w: String(DEF_W[name]) };
    for (const k of Object.keys(c)) {
      if (!CASE_IN.includes(k)) throw new ToolError(`Unknown key “${k}” in cases.${name}. Case keys are ${CASE_IN.join(', ')}.`);
      if (c[k] !== undefined) box[k] = boxText(k, c[k]);
    }
    if (!String(box.w || '').trim()) box.w = String(DEF_W[name]);
    st.sc[name] = box;
  }
  return st;
}

// ---------- describing a valuation ----------

function blockersText(x) {
  const b = x.b, out = [];
  if (b.missing.length) out.push(`missing ${b.missing.map((k) => `${k} (${label(k)})`).join(', ')}`);
  if (b.bad.length) out.push(`can’t read ${b.bad.join(', ')}`);
  if (b.rate) out.push('the discount rate r must be above terminal growth tg');
  if (b.shares) out.push('shares must be above 0');
  if (b.rev0) out.push('the margin method needs revenue above 0');
  return out.join('; ') || 'not enough inputs';
}

function caseInputs(x) {
  const o = {};
  CASE_IN.forEach((k) => { o[k] = isNum(x.n[k]) ? x.n[k] : null; });
  return o;
}

// Plain-English notes about inputs worth a second look (the calculator shows its own versions).
function checksFor(st, all, W) {
  const out = [];
  const base = all[1], n = base.n, res = base.res;
  const unitW = UNIT_WORD[st.values.unit] || 'millions', shareW = SHARE_WORD[st.values.sharesUnit] || 'millions';
  all.forEach((x) => {
    if (x.filled && !x.res) out.push(`The ${x.s} case can’t be valued yet: ${blockersText(x)}.`);
  });
  if (DCF.rule(n).bad) out.push('The buy level is below the sell level, so the calculator ignores both and shows HOLD around 0%.');
  const f0 = isNum(n.fcf) ? n.fcf - (isNum(n.sbc) ? n.sbc : 0) : null;
  if (n.method === 'fcf' && isNum(f0) && f0 <= 0) out.push('Free cash flow (after stock-based pay) is zero or negative, so growing it gives a negative value. Use method "margin" with revenue and a target FCF margin instead.');
  if (isNum(n.tg) && n.tg > 4) out.push(`Terminal growth of ${n.tg}% is high for growth that lasts forever; 2–3% is usual.`);
  if (isNum(n.r) && n.r > 0 && n.r < 6) out.push(`A discount rate of ${n.r}% is low; 8–12% is common for stocks.`);
  all.forEach((x) => {
    if (!x.filled) return;
    const m = x.n;
    if (m.method === 'fcf' && isNum(m.g1) && m.g1 > 40) out.push(`The ${x.s} case grows free cash flow ${m.g1}% a year for five years, which few companies manage.`);
    if (m.method === 'fcf' && isNum(m.g1) && isNum(m.g2) && m.g2 > m.g1) out.push(`In the ${x.s} case, growth in years 6–10 is above years 1–5; it usually slows.`);
    const small = ['g1', 'g2', 'rg1', 'rg2', 'tm', 'tg'].filter((k) => isNum(m[k]) && m[k] !== 0 && Math.abs(m[k]) < 0.5);
    if (small.length >= 2) out.push(`In the ${x.s} case, ${small.join(', ')} are below 0.5. Percentages are plain numbers (12 means 12%); check these aren’t fractions.`);
  });
  if (isNum(n.past5) && isNum(n.g1) && n.method === 'fcf' && n.g1 > n.past5 + 10) out.push(`Base-case growth of ${n.g1}% is well above the past five years’ ${n.past5}%.`);
  const paid = DCF.dividendsPaid(n);
  if (paid && isNum(f0) && paid > f0) out.push('Dividends paid are larger than free cash flow, so the dividend may not be covered.');
  if (W && W.equal) out.push('Every weight is 0, so the cases are weighted equally.');
  if (res) {
    if (res.ev > 0 && res.pvTV / res.ev > 0.8) out.push(`The terminal value is ${Math.round((res.pvTV / res.ev) * 100)}% of enterprise value, so the result leans heavily on growth after year 10.`);
    if (isNum(n.ath)) {
      const hit = res.years.find((y) => y.margin != null && y.margin * 100 > n.ath + 1e-9);
      if (hit) out.push(`The projected FCF margin reaches ${pct(hit.margin)}% in ${hit.year}, above the company’s peak of ${n.ath}%.`);
    }
    if (res.price && res.fair > 0) {
      const ratio = res.fair / res.price;
      if (ratio > 8 || ratio < 0.125) out.push(`The fair value is ${ratio > 1 ? `${r2(ratio, 1)} times` : `${r2(ratio * 100, 1)}% of`} the share price. Check the units: amounts are in ${unitW} and shares in ${shareW === 'single' ? 'single shares' : shareW}.`);
    }
    if (!isNum(n.cash) && !isNum(n.debt)) out.push('Cash and debt are blank, so both count as 0.');
    if (!res.price) out.push('There’s no share price, so there’s no margin of safety or signal.');
  }
  return out;
}

/**
 * Everything Claude needs to judge a valuation. `detail` adds the base case's 10-year
 * projection, the bridge from enterprise value to fair value, and the sensitivity table.
 */
function report(st, { detail = true } = {}) {
  const all = SCN.map((s) => DCF.evalCase(st, s));
  const W = DCF.weightedOf(all);
  const base = all[1], n = base.n, res = base.res;
  const cur = DCF.curOf(st), rcur = DCF.rcurOf(st);
  const head = W || (res ? { fair: res.fair, price: res.price, mos: res.mos, signal: res.signal } : null);
  const out = {
    ticker: st.values.ticker,
    company: st.values.name || null,
    method: DCF.methodOf(st),
    settings: {
      priceCurrency: cur, reportCurrency: rcur, fxRate: DCF.needFxOf(st) ? n.fx : null,
      amountUnit: UNIT_WORD[st.values.unit] || 'millions', sharesUnit: SHARE_WORD[st.values.sharesUnit] || 'millions', baseYear: DCF.baseYearOf(st),
    },
    fairValuePerShare: head ? r2(head.fair) : null,
    fairValueIs: W ? `weighted across ${W.count} cases` : res ? 'base case' : 'not available yet',
    sharePrice: head ? head.price : isNum(n.price) ? n.price : null,
    marginOfSafetyPct: head ? pct(head.mos) : null,
    signal: head ? head.signal || null : null,
    decisionRule: (() => { const q = DCF.rule(n); return { buyWhenMarginOfSafetyAtLeastPct: r2(q.buy * 100), sellWhenAtOrBelowPct: r2(q.sell * 100) }; })(),
    range: W ? { lowest: r2(W.min), highest: r2(W.max) } : null,
    cases: {},
  };
  all.forEach((x) => {
    if (!x.filled) { out.cases[x.s] = null; return; }
    if (!x.res) { out.cases[x.s] = { inputs: caseInputs(x), error: `Can’t be valued yet: ${blockersText(x)}.` }; return; }
    const r = x.res;
    out.cases[x.s] = {
      inputs: caseInputs(x),
      weightPct: W && W.share[x.s] != null ? pct(W.share[x.s]) : null,
      fairValuePerShare: r2(r.fair),
      marginOfSafetyPct: pct(r.mos),
      signal: r.signal,
      enterpriseValue: r2(r.ev, 1),
      equityValue: r2(r.equity, 1),
      terminalValueShareOfEvPct: r.ev > 0 ? pct(r.pvTV / r.ev, 0) : null,
      fcfMarginYear1Pct: r.years[0].margin != null ? pct(r.years[0].margin) : null,
      fcfMarginYear10Pct: r.years[9].margin != null ? pct(r.years[9].margin) : null,
    };
  });
  const imp = res ? DCF.implied(n) : null;
  if (imp) {
    const what = imp.key === 'tm' ? 'target FCF margin' : 'FCF growth in years 1–5';
    out.priceImplies = imp.below
      ? { metric: what, note: `Even with ${what} of ${imp.value}%, the base case’s fair value is above today’s price.` }
      : imp.above
        ? { metric: what, note: `Even with ${what} of ${imp.value}%, the base case’s fair value is below today’s price.` }
        : { metric: what, valuePct: r2(imp.value, 1), note: `Holding the base case’s other inputs, today’s price assumes ${what} of ${r2(imp.value, 1)}%${imp.key === 'tm' ? '' : ' a year'}.` };
  }
  const d = DCF.ddm(n);
  if (isNum(n.dps) && n.dps > 0) {
    const paid = DCF.dividendsPaid(n), f0 = isNum(n.fcf) ? n.fcf - (isNum(n.sbc) ? n.sbc : 0) : null;
    out.dividends = {
      perShare: n.dps,
      yieldPct: isNum(n.price) && n.price > 0 ? pct(n.dps / n.price, 2) : null,
      paidShareOfFcfPct: paid && isNum(f0) && f0 > 0 ? pct(paid / f0, 0) : null,
      dividendModelValuePerShare: r2(d),
    };
  }
  if (detail && res) {
    out.baseCase = {
      projection: res.years.map((y) => ({
        year: y.year, growthPct: pct(y.g), revenue: r2(y.rev, 1), fcf: r2(y.fcf, 1), fcfMarginPct: y.margin != null ? pct(y.margin) : null, presentValue: r2(y.pv, 1),
      })),
      bridge: {
        startingFcfAfterStockPay: r2(res.f0, 1), sumOfPresentValues: r2(res.sumPV, 1), terminalValue: r2(res.tv, 1), presentValueOfTerminalValue: r2(res.pvTV, 1),
        enterpriseValue: r2(res.ev, 1), plusCash: r2(res.cash, 1), minusDebt: r2(res.debt, 1), equityValue: r2(res.equity, 1),
        shares: n.shares, fxRate: res.fx !== 1 ? res.fx : null, fairValuePerShare: r2(res.fair),
        amountsIn: `${rcur} ${UNIT_WORD[st.values.unit] || 'millions'}`,
      },
      sensitivity: (() => {
        const rs = [-2, -1, 0, 1, 2].map((x) => n.r + x), ts = [-1, -0.5, 0, 0.5, 1].map((x) => n.tg + x);
        return {
          rowsDiscountRatePct: rs, columnsTerminalGrowthPct: ts,
          fairValues: rs.map((r) => ts.map((g) => { const x = r > 0 ? DCF.compute(n, { r, tg: g }) : null; return x ? r2(x.fair) : null; })),
        };
      })(),
    };
  }
  out.checks = checksFor(st, all, W);
  return out;
}

// ---------- the saved valuations ----------

const isValuation = (d) => d && d.type === 'valuation' && !d.deleted && d.ticker;
const savedAtOf = (d) => (isNum(d.savedAtMs) ? new Date(d.savedAtMs).toISOString() : d.savedAt || null);
function brief(d) {
  const r = d.result || {}, i = d.inputs || {};
  return {
    id: d.id, savedAt: savedAtOf(d), savedBy: d.by === 'claude' ? 'Claude' : 'the user',
    fairValuePerShare: isNum(r.fair) ? r2(r.fair) : null, sharePrice: isNum(r.price) ? r.price : null,
    marginOfSafetyPct: isNum(r.mos) ? pct(r.mos) : null, signal: r.signal || null, currency: i.currency || '$',
    ...(d.asOf ? { figuresAsOf: d.asOf } : {}),
  };
}
function byTicker(docs) {
  const m = new Map();
  docs.filter(isValuation).forEach((d) => {
    const tk = String(d.ticker);
    if (!m.has(tk)) m.set(tk, []);
    m.get(tk).push(d);
  });
  m.forEach((a) => a.sort((x, y) => (y.savedAtMs || 0) - (x.savedAtMs || 0)));
  return m;
}
function findTicker(groups, raw) {
  const tk = DCF.normTicker(raw);
  if (groups.has(tk)) return groups.get(tk);
  // "WTC" finds "WTC.AX" when only one saved ticker starts that way.
  const near = [...groups.keys()].filter((k) => k.split('.')[0] === tk.split('.')[0]);
  return near.length === 1 ? groups.get(near[0]) : null;
}
function newId() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return 'c' + Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 19);
}

// The model to start from: the newest save of this ticker, a given save, or nothing.
function startingPoint(args, docs) {
  const from = args.startFrom == null ? 'blank' : String(args.startFrom);
  if (from === 'blank') return { start: null, from: null };
  const groups = byTicker(docs);
  let d;
  if (from === 'latest') {
    if (!args.ticker) throw new ToolError('startFrom "latest" needs the ticker.');
    const arr = findTicker(groups, args.ticker);
    if (!arr) throw new ToolError(`There’s no saved valuation for ${DCF.normTicker(args.ticker)} yet. Leave out startFrom to start from a blank model.`);
    d = arr[0];
  } else {
    d = docs.find((x) => x.id === from && isValuation(x));
    if (!d) throw new ToolError(`No saved valuation has the id “${from}”. Use "latest", "blank" or an id from get-overview or get-valuation.`);
  }
  const st = DCF.fromSnapshot(d);
  if (!st) throw new ToolError('That save is from an older version of the calculator and can’t be used as a starting point. Start from a blank model instead.');
  return { start: st, from: d };
}

// ---------- the tools ----------

const MODEL_GUIDE = `How the calculator values a stock: a two-stage DCF. Ten projected years of free cash flow plus a terminal value (FCF in year 10 × (1 + tg) ÷ (r − tg)), all discounted at the discount rate r. Enterprise value = the sum of the present values; equity = enterprise value + cash − debt; fair value per share = equity ÷ shares (times fxRate when the figures are in another currency than the share price).
- method "fcf": free cash flow grows at g1 a year in years 1–5 and g2 in years 6–10.
- method "margin": revenue grows at rg1 (years 1–5) and rg2 (years 6–10); the FCF margin moves in a straight line from today's (fcf ÷ revenue) to the target tm by year tmYear (1–10) and stays there. Use it when today's margin is far from normal.
- sbc (stock-based compensation), if given, is subtracted from fcf before projecting.
- Three cases, bear, base and bull, each with g1, g2, rg1, rg2, tm, tmYear, tg and w (weight in percent; 25/50/25 by default). The headline fair value blends the cases by weight. Only base is required.
- Signal: BUY when the margin of safety is at least buyAt % (default 25), SELL at or below sellAt % (default −10), HOLD in between.
Units: percentages are plain numbers (12 means 12%). fcf, revenue, sbc, cash and debt are trailing-12-month figures in the report currency and the amount unit (millions unless you set settings.amountUnit). shares are diluted shares in the shares unit (millions by default). price and dps are in the share price currency. debt is interest-bearing debt (plus preferred stock), not all liabilities.`;

const MONEY = (what) => ({ type: ['number', 'null'], description: what });
const MODEL_PROPS = {
  ticker: { type: 'string', description: 'The ticker as the calculator lists it: "NVDA", "WTC.AX" (ASX), "2330.TW" (Taiwan), "0700.HK".' },
  company: { type: 'string', description: 'Company name.' },
  startFrom: { type: 'string', description: '"blank" (default) starts a new model. "latest" starts from the newest saved valuation of this ticker and changes only what you pass. Or the id of a saved valuation.' },
  method: { type: 'string', enum: ['fcf', 'margin'], description: '"fcf" grows free cash flow; "margin" grows revenue toward a target FCF margin.' },
  settings: {
    type: 'object',
    description: 'Currencies and units. Leave out to keep $ and millions.',
    properties: {
      priceCurrency: { type: 'string', description: `Share price currency: ${CURRENCIES.join(' ')} (ISO codes such as USD or AUD work too).` },
      reportCurrency: { type: 'string', description: 'Currency of the financial statements, if different from the share price’s.' },
      fxRate: { type: ['number', 'null'], description: 'Share-price-currency units per one report-currency unit. Needed when the currencies differ.' },
      amountUnit: { type: 'string', enum: ['thousands', 'millions', 'billions'], description: 'Unit for fcf, revenue, sbc, cash and debt.' },
      sharesUnit: { type: 'string', enum: ['single', 'thousands', 'millions', 'billions'], description: 'Unit for shares.' },
      baseYear: { type: 'integer', description: 'The year of the starting figures; projections start the year after.' },
    },
  },
  facts: {
    type: 'object',
    description: 'The company’s figures. null clears one.',
    properties: {
      fcf: MONEY('Trailing-12-month free cash flow = operating cash flow − capital expenditure.'),
      revenue: MONEY('Trailing-12-month revenue (needed for method "margin").'),
      sbc: MONEY('Trailing-12-month stock-based compensation (optional; subtracted from fcf).'),
      cash: MONEY('Cash and short-term investments.'),
      debt: MONEY('Interest-bearing debt plus preferred stock.'),
      shares: MONEY('Diluted shares outstanding, in the shares unit.'),
      price: MONEY('Current share price.'),
      dps: MONEY('Dividends per share over the last 12 months (optional).'),
      dg: MONEY('Dividend growth % a year for years 1–10 (optional; default terminal growth).'),
      wacc: MONEY('WACC % (reference only).'),
      past5: MONEY('Revenue or FCF growth % a year over the past five years (reference).'),
      ath: MONEY('Highest FCF margin % the company has reached (flags projections above it).'),
    },
  },
  r: { type: 'number', description: 'Discount rate % (the yearly return wanted). 8–12 is common.' },
  buyAt: { type: 'number', description: 'BUY when the margin of safety is at least this %. Default 25.' },
  sellAt: { type: 'number', description: 'SELL when the margin of safety is at or below this %. Default −10.' },
  cases: {
    type: 'object',
    description: 'bear, base and bull. Each takes g1, g2, rg1, rg2, tm, tmYear, tg and w as percent numbers (tmYear is a year number 1–10). null removes bear or bull.',
    properties: Object.fromEntries(SCN.map((s) => [s, {
      type: ['object', 'null'],
      properties: {
        g1: { type: 'number', description: 'FCF growth %, years 1–5 (method fcf)' },
        g2: { type: 'number', description: 'FCF growth %, years 6–10 (method fcf)' },
        rg1: { type: 'number', description: 'Revenue growth %, years 1–5' },
        rg2: { type: 'number', description: 'Revenue growth %, years 6–10' },
        tm: { type: 'number', description: 'Target FCF margin % (method margin)' },
        tmYear: { type: 'integer', description: 'Year 1–10 the target margin is reached (default 5)' },
        tg: { type: 'number', description: 'Terminal growth % after year 10, usually 2–3' },
        w: { type: 'number', description: `Weight % (default ${DEF_W[s]})` },
      },
    }])),
  },
};

export const TOOLS = [
  {
    name: 'get-overview',
    title: 'Saved stocks',
    description: 'Start here. Lists the stocks saved in the user’s DCF calculator, newest first, with each one’s latest fair value, share price, margin of safety and BUY/HOLD/SELL signal, plus today’s date.',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    async run(docs) {
      const groups = byTicker(docs);
      const stocks = [...groups.entries()]
        .sort((a, b) => (b[1][0].savedAtMs || 0) - (a[1][0].savedAtMs || 0))
        .map(([tk, arr]) => ({ ticker: tk, company: arr[0].name || null, saves: arr.length, latest: brief(arr[0]) }));
      const last = docs.filter(isValuation).sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0))[0];
      const li = (last && last.inputs) || {};
      return {
        today: new Date().toISOString().slice(0, 10),
        savedStocks: stocks.length,
        stocks: stocks.slice(0, 200),
        usualDecisionRule: { buyAtPct: isNum(li.buyAt) ? li.buyAt : 25, sellAtPct: isNum(li.sellAt) ? li.sellAt : -10 },
        tip: 'run-dcf tries a valuation without saving; save-valuation keeps it in the calculator. get-valuation shows a saved one in full.',
      };
    },
  },
  {
    name: 'get-valuation',
    title: 'A saved valuation',
    description: 'Shows a saved valuation in full: the figures and assumptions, the result recalculated with the calculator’s maths (cases, 10-year projection, sensitivity, checks) and the list of earlier saves of the same stock. Give a ticker for its newest save, or an id.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Ticker, such as "VST" or "WTC.AX".' },
        id: { type: 'string', description: 'The id of one save (from get-overview or the history list).' },
      },
    },
    async run(docs, args) {
      const groups = byTicker(docs);
      let d, arr;
      if (args.id) {
        d = docs.find((x) => x.id === String(args.id) && isValuation(x));
        if (!d) throw new ToolError(`No saved valuation has the id “${args.id}”.`);
        arr = groups.get(String(d.ticker)) || [d];
      } else {
        if (!args.ticker) throw new ToolError('Give a ticker or an id.');
        arr = findTicker(groups, args.ticker);
        if (!arr) throw new ToolError(`There’s no saved valuation for ${DCF.normTicker(args.ticker)}. Saved tickers: ${[...groups.keys()].slice(0, 40).join(', ') || 'none yet'}.`);
        d = arr[0];
      }
      const st = DCF.fromSnapshot(d);
      const out = { ...brief(d), ticker: d.ticker, company: d.name || null };
      if (d.note) out.note = d.note;
      if (st) out.valuation = report(st);
      else out.stored = { inputs: d.inputs || null, result: d.result || null, olderFormat: true };
      out.history = arr.map(brief);
      return out;
    },
  },
  {
    name: 'run-dcf',
    title: 'Run a DCF valuation',
    description: `Values a stock with the calculator’s own DCF maths and returns the fair value per share for each case, the weighted fair value, margin of safety, BUY/HOLD/SELL signal, the growth today’s price implies, the base case’s 10-year projection and sensitivity table, and checks on the inputs. Nothing is saved. Look up the company’s latest reported figures first; then try your inputs here and adjust anything implausible before saving with save-valuation.\n\n${MODEL_GUIDE}`,
    readOnly: true,
    inputSchema: { type: 'object', properties: MODEL_PROPS, required: ['ticker'] },
    async run(docs, args) {
      const { start, from } = startingPoint(args, docs);
      const st = modelFrom(args, start);
      const out = report(st);
      if (from) out.startedFrom = brief(from);
      return out;
    },
  },
  {
    name: 'save-valuation',
    title: 'Save a valuation',
    description: `Saves a valuation to the user’s DCF calculator as a new dated snapshot, the same as pressing Save snapshot in the app. It appears there within seconds, marked as saved by Claude; earlier saves stay in the stock’s history. Takes the same inputs as run-dcf, plus asOf (the period of the figures) and an optional note. The base case must be complete.\n\n${MODEL_GUIDE}`,
    inputSchema: {
      type: 'object',
      properties: {
        ...MODEL_PROPS,
        asOf: { type: 'string', description: 'The period the figures come from, such as "Q3 2026 (quarter to 30 Sep 2026)".' },
        note: { type: 'string', description: 'A short note for the user: sources, the reasoning behind the cases, what to check. Up to 1,500 characters.' },
      },
      required: ['ticker'],
    },
    async run(docs, args, ctx) {
      const { start, from } = startingPoint(args, docs);
      const st = modelFrom(args, start);
      const base = DCF.evalCase(st, 'base');
      if (!base.res) throw new ToolError(`Nothing was saved: the base case can’t be valued yet (${blockersText(base)}). Fix it and try again.`);
      const now = Date.now();
      const entry = {
        id: newId(), type: 'valuation', v: 2,
        ticker: st.values.ticker, name: String(st.values.name || '').trim().slice(0, 120),
        savedAtMs: now, savedAt: new Date(now).toISOString(),
        ...DCF.snapshot(st),
        by: 'claude', updatedAt: now,
      };
      const asOf = text(args.asOf, 'asOf', { max: 120 });
      const note = text(args.note, 'note', { max: 1500 });
      if (asOf) entry.asOf = asOf;
      if (note) entry.note = note;
      await ctx.db.save([entry]);
      const out = report(st, { detail: false });
      out.saved = { id: entry.id, savedAt: entry.savedAt, message: `Saved to the DCF calculator. It appears under ${entry.ticker} in the Saved stocks list within a few seconds.` };
      if (from) out.startedFrom = brief(from);
      return out;
    },
  },
  {
    name: 'delete-valuations',
    title: 'Delete saved valuations',
    description: 'Deletes saved valuations by id (from get-overview or get-valuation’s history). They disappear from the calculator on every device. Always ask the user first.',
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, description: `Ids of the saves to delete (up to ${MAX_DELETE}).` } },
      required: ['ids'],
    },
    async run(docs, args, ctx) {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : args.ids != null ? [String(args.ids)] : [];
      if (!ids.length) throw new ToolError('Give the ids to delete.');
      if (ids.length > MAX_DELETE) throw new ToolError(`Delete up to ${MAX_DELETE} at a time.`);
      const now = Date.now();
      const found = docs.filter((d) => ids.includes(d.id) && isValuation(d));
      await ctx.db.save(found.map((d) => ({ ...d, deleted: true, updatedAt: Math.max(now, (d.updatedAt || 0) + 1) })));
      return {
        deleted: found.map((d) => ({ id: d.id, ticker: d.ticker, savedAt: savedAtOf(d) })),
        notFound: ids.filter((id) => !found.some((d) => d.id === id)),
      };
    },
  },
];

// ---------- running a tool ----------

export const toolList = () =>
  TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, idempotentHint: !!t.readOnly, openWorldHint: false },
  }));

export function findTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

/**
 * session: { db: () => UserDb, gen }
 * Reads the user's calculator documents (a handful per stock), checks Claude still has access,
 * then runs the tool. Throws ToolError for something Claude should fix and AccessError when
 * Claude's access was turned off in the calculator.
 */
export async function callTool(tool, args, session) {
  for (let attempt = 0; ; attempt++) {
    const db = session.db();
    let docs;
    try {
      docs = await db.query([]);
    } catch (e) {
      if (isAuthError(e)) throw new AccessError('sign-in expired');
      throw e;
    }
    const conn = docs.find((d) => d.id === CONNECTOR_ID && d.type === 'connector' && !d.deleted);
    if (!conn || conn.gen !== session.gen) throw new AccessError('Claude’s access was turned off in the DCF calculator.');
    try {
      return await tool.run(docs, { ...args }, { db, conn });
    } catch (e) {
      if (isConflict(e) && attempt < 2) continue;
      throw e;
    }
  }
}

export const SERVER_INSTRUCTIONS = `DCF Calculator is the user's own stock valuation app: a two-stage discounted cash flow model with bear, base and bull cases. Valuations you save appear in the app on the user's devices within seconds.
- Call get-overview first to see which stocks the user has saved.
- To value a stock, look up its latest reported figures first (search the web if you can, prefer the company's own filings and releases, and note the period you used). Then call run-dcf to try your inputs, adjust anything implausible, and call save-valuation when the user wants it kept or asked you to build a model.
- Percentages are plain numbers: 12 means 12%. Amounts are in the report currency and amount unit (millions unless set), shares in the shares unit, the price and dividend in the share price currency.
- To update a saved stock (a new price or new results), pass startFrom "latest" and only what changes. Each save is a new dated snapshot; earlier ones stay in the history.
- Ask before deleting anything. A valuation is only as good as its assumptions and isn't financial advice; say so when you give a verdict.`;
