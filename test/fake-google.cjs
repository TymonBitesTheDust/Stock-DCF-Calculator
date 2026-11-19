// A stand-in for the Google APIs the calculator and its Claude connector call: Firebase Auth's
// REST API (sign up, sign in, refresh) and Firestore's REST API (batchGet, runQuery, commit).
// Adapted from Checkmate's test double. Documents live in server.docs[uid][id], with `srv` as
// the server's write time in milliseconds.
//
// It is strict where real Firestore is strict: tokens must be valid, users can only reach
// users/{their uid}/..., preconditions are checked, and queries that would need a composite
// index are refused. It answers CORS preflights so a page in a browser can call it.
const http = require('http');

const COLLECTION = 'dcf';

function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    if (v.some(Array.isArray)) throw new Error('Firestore does not allow arrays inside arrays');
    return { arrayValue: v.length ? { values: v.map(encode) } : {} };
  }
  return { mapValue: { fields: fieldsOf(v) } };
}
const fieldsOf = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)]));
function decode(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  throw new Error('bad value ' + JSON.stringify(v));
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function test(doc, f) {
  const path = f.field.fieldPath;
  if (!(path in doc)) return false;
  const want = decode(f.value);
  const v = doc[path];
  switch (f.op) {
    case 'EQUAL': return same(v, want);
    case 'NOT_EQUAL': return v !== null && !same(v, want);
    case 'IN': return want.some((w) => same(v, w));
    default: {
      if (typeOf(v) !== typeOf(want) || v === null) return false;
      if (f.op === 'LESS_THAN') return v < want;
      if (f.op === 'LESS_THAN_OR_EQUAL') return v <= want;
      if (f.op === 'GREATER_THAN') return v > want;
      if (f.op === 'GREATER_THAN_OR_EQUAL') return v >= want;
      throw new Error('op ' + f.op);
    }
  }
}

function createFakeGoogle({ server = {}, apiKey, project, log = () => {} }) {
  server.users = server.users || {};
  server.docs = server.docs || {};
  server.clock = server.clock || Date.UTC(2026, 10, 1);
  const ids = new Map(); // idToken -> { uid, exp }
  const refreshTokens = new Map(); // refreshToken -> uid
  const stats = { signIns: 0, signUps: 0, refreshes: 0, queries: [], commits: 0, reads: 0 };
  let n = 0;
  const root = `projects/${project}/databases/(default)/documents`;
  const iso = (ms) => new Date(ms).toISOString();
  const docOut = (uid, id, d) => {
    const { srv, ...rest } = d;
    return { name: `${root}/users/${uid}/${COLLECTION}/${id}`, fields: { ...fieldsOf(rest), srv: { timestampValue: iso(srv) } }, createTime: iso(srv), updateTime: iso(srv) };
  };
  const mint = (uid, ttl = 3600) => {
    const t = `idt.${uid}.${++n}.${Math.random().toString(36).slice(2)}`;
    ids.set(t, { uid, exp: Date.now() + ttl * 1000 });
    return t;
  };
  const session = (uid, email) => {
    const rt = `rt.${uid}.${++n}`;
    refreshTokens.set(rt, uid);
    return { localId: uid, email, idToken: mint(uid), refreshToken: rt, expiresIn: '3600', registered: true };
  };
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
  };
  const fsError = (res, code, status, message) => send(res, code, { error: { code, status, message } });

  const api = {
    stats,
    server,
    docsOf: (uid) => server.docs[uid] || {},
    addUser(email, password) {
      const uid = 'u' + (Object.keys(server.users).length + 1);
      server.users[email] = { uid, pw: password };
      return uid;
    },
    expireIdTokens() { for (const v of ids.values()) v.exp = 0; },
    // What changing the password does: every sign-in for that user ends.
    revokeRefresh(uid) { for (const [k, v] of refreshTokens) if (v === uid) refreshTokens.delete(k); for (const v of ids.values()) if (v.uid === uid) v.exp = 0; },
    // Writes a document the way another device would (for tests).
    put(uid, id, data) {
      server.clock = Math.max(Date.now(), server.clock + 1);
      (server.docs[uid] = server.docs[uid] || {})[id] = { ...data, srv: server.clock };
    },
  };

  api.handle = async (method, url, headers, raw) => {
    const out = { status: 200, body: null };
    await new Promise((resolve) => {
      const res = { writeHead: (s) => { out.status = s; }, end: (b) => { out.body = b; resolve(); } };
      route(method, url, headers, raw, res).catch((e) => { out.status = e.status || 500; out.body = JSON.stringify({ error: { message: e.message } }); resolve(); });
    });
    return out;
  };

  async function route(method, rawUrl, headers, raw, res) {
    const url = new URL(rawUrl, 'http://x');
    const path = decodeURIComponent(url.pathname);
    log(method, path);
    if (method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(''); }
    // ----- Firebase Auth -----
    if (path === '/identitytoolkit/v1/accounts:signInWithPassword' || path === '/identitytoolkit/v1/accounts:signUp') {
      if (url.searchParams.get('key') !== apiKey) return send(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
      const b = JSON.parse(raw);
      if (path.endsWith(':signUp')) {
        stats.signUps++;
        if (server.users[b.email]) return send(res, 400, { error: { code: 400, message: 'EMAIL_EXISTS' } });
        if (!b.password || b.password.length < 6) return send(res, 400, { error: { code: 400, message: 'WEAK_PASSWORD : Password should be at least 6 characters' } });
        api.addUser(b.email, b.password);
      } else stats.signIns++;
      const u = server.users[b.email];
      if (!u || u.pw !== b.password) return send(res, 400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } });
      return send(res, 200, session(u.uid, b.email));
    }
    if (path === '/securetoken/v1/token') {
      if (url.searchParams.get('key') !== apiKey) return send(res, 400, { error: { code: 400, message: 'API key not valid.' } });
      const p = new URLSearchParams(raw);
      const uid = refreshTokens.get(p.get('refresh_token'));
      stats.refreshes++;
      if (p.get('grant_type') !== 'refresh_token' || !uid) return send(res, 400, { error: { code: 400, message: 'INVALID_REFRESH_TOKEN', status: 'INVALID_ARGUMENT' } });
      return send(res, 200, { access_token: 'x', expires_in: '3600', token_type: 'Bearer', refresh_token: p.get('refresh_token'), id_token: mint(uid), user_id: uid, project_id: '1' });
    }

    // ----- Firestore -----
    if (!path.startsWith('/firestore/v1/')) return send(res, 404, { error: { message: 'no such api' } });
    const m = /^Bearer (.+)$/.exec(headers.authorization || '');
    const who = m && ids.get(m[1]);
    if (!who || who.exp < Date.now()) return fsError(res, 401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.');
    const rest = path.slice('/firestore/v1/'.length);
    const body = raw ? JSON.parse(raw) : {};
    const own = (uid) => uid === who.uid;
    const esc = root.replace(/[()]/g, '\\$&');
    const parseName = (name) => {
      const mm = new RegExp(`^${esc}/users/([^/]+)/${COLLECTION}/([^/]+)$`).exec(name);
      if (!mm) throw Object.assign(new Error('bad name ' + name), { status: 400 });
      return { uid: mm[1], id: mm[2] };
    };

    if (rest === `${root}:batchGet`) {
      const out = [];
      for (const name of body.documents) {
        const { uid, id } = parseName(name);
        if (!own(uid)) return fsError(res, 403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
        const d = (server.docs[uid] || {})[id];
        stats.reads++;
        out.push(d ? { found: docOut(uid, id, d), readTime: iso(Date.now()) } : { missing: name, readTime: iso(Date.now()) });
      }
      return send(res, 200, out);
    }

    const q = new RegExp(`^${esc}/users/([^/]+):runQuery$`).exec(rest);
    if (q) {
      if (!own(q[1])) return fsError(res, 403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
      const sq = body.structuredQuery;
      if (!sq || !sq.from || sq.from[0].collectionId !== COLLECTION) return fsError(res, 400, 'INVALID_ARGUMENT', 'bad query');
      const w = sq.where;
      const filters = !w ? [] : w.fieldFilter ? [w.fieldFilter] : w.compositeFilter.filters.map((f) => f.fieldFilter);
      const ineq = new Set(filters.filter((f) => !['EQUAL', 'IN'].includes(f.op)).map((f) => f.field.fieldPath));
      const fieldsUsed = new Set(filters.map((f) => f.field.fieldPath));
      const orders = (sq.orderBy || []).map((o) => o.field.fieldPath);
      // Like Firestore without composite indexes: one field at a time, and ordering only by it.
      if (ineq.size > 1 || (ineq.size === 1 && fieldsUsed.size > 1) || orders.length > 1 || (orders.length && fieldsUsed.size && !fieldsUsed.has(orders[0]))) {
        return fsError(res, 400, 'FAILED_PRECONDITION', 'The query requires an index.');
      }
      stats.queries.push(filters.map((f) => `${f.field.fieldPath} ${f.op}`).join(' & ') || 'all');
      let docs = Object.entries(server.docs[q[1]] || {}).filter(([, d]) => filters.every((f) => test(d, f)));
      if (orders.length) docs.sort((a, b) => (a[1][orders[0]] > b[1][orders[0]] ? 1 : -1) * (sq.orderBy[0].direction === 'DESCENDING' ? -1 : 1));
      const limited = docs.slice(0, sq.limit || 1e9);
      stats.reads += Math.max(1, limited.length);
      const now = iso(Date.now());
      return send(res, 200, limited.length ? limited.map(([id, d]) => ({ document: docOut(q[1], id, d), readTime: now })) : [{ readTime: now }]);
    }

    if (rest === `${root}:commit`) {
      stats.commits++;
      const plan = [];
      for (const wr of body.writes) {
        const { uid, id } = parseName(wr.update.name);
        if (!own(uid)) return fsError(res, 403, 'PERMISSION_DENIED', 'Missing or insufficient permissions.');
        const cur = (server.docs[uid] || {})[id];
        const pre = wr.currentDocument;
        if (pre && pre.exists === false && cur) return fsError(res, 409, 'ALREADY_EXISTS', `Document already exists: ${wr.update.name}`);
        if (pre && pre.exists === true && !cur) return fsError(res, 404, 'NOT_FOUND', 'No document to update');
        if (pre && pre.updateTime && (!cur || iso(cur.srv) !== pre.updateTime)) return fsError(res, 400, 'FAILED_PRECONDITION', 'the stored version does not match the required base version.');
        const data = Object.fromEntries(Object.entries(wr.update.fields || {}).map(([k, v]) => [k, decode(v)]));
        const t = (wr.updateTransforms || []).find((x) => x.fieldPath === 'srv');
        if (!t || t.setToServerValue !== 'REQUEST_TIME') return fsError(res, 400, 'INVALID_ARGUMENT', 'expected srv = REQUEST_TIME (test check)');
        const mask = wr.updateMask && wr.updateMask.fieldPaths;
        plan.push({ uid, id, data, mask, cur });
      }
      server.clock = Math.max(Date.now(), server.clock + 1);
      for (const p of plan) {
        let d = p.data;
        if (p.mask) {
          d = { ...(p.cur || {}) };
          for (const f of p.mask) { if (f in p.data) d[f] = p.data[f]; else delete d[f]; }
        }
        delete d.srv;
        (server.docs[p.uid] = server.docs[p.uid] || {})[p.id] = { ...d, srv: server.clock };
      }
      return send(res, 200, { writeResults: plan.map(() => ({ updateTime: iso(server.clock) })), commitTime: iso(server.clock) });
    }
    return send(res, 404, { error: { message: 'unknown firestore call ' + rest } });
  }

  const httpServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    route(req.method, req.url, req.headers, Buffer.concat(chunks).toString(), res).catch((e) => {
      res.writeHead(e.status || 500, { 'content-type': 'application/json', ...CORS });
      res.end(JSON.stringify({ error: { message: e.message } }));
    });
  });
  api.listen = () => new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => { api.url = `http://127.0.0.1:${httpServer.address().port}`; resolve(api.url); }));
  api.close = () => new Promise((resolve) => httpServer.close(resolve));
  return api;
}

module.exports = { createFakeGoogle, encode, decode, COLLECTION };
