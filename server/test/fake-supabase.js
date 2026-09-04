'use strict';

// In-memory stand-in for Supabase's PostgREST API, used by the test suite
// so `npm test` runs fully offline. It intercepts global.fetch for any URL
// containing "/rest/v1/" and serves it from plain JS arrays; every other
// URL passes through to the real fetch (email.js / shiprocket.js mocks).
//
// Supports only the subset this codebase uses: POST (insert, with
// return=representation|minimal and on_conflict + merge-duplicates),
// GET (?col=eq.val, order=col.dir, limit=N, select=*), PATCH (?col=eq.val),
// DELETE (?col=eq.val). Auto-fills id (uuid), created_at (now), and
// orders.order_number (sequence). Enforces the newsletter_subscribers
// unique-email constraint.

const crypto = require('node:crypto');

const REAL_FETCH = globalThis.fetch;
const store = Object.create(null);
const seqs = Object.create(null);

function tableRows(name) {
  if (!store[name]) store[name] = [];
  return store[name];
}

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(seqs)) delete seqs[k];
}

function seed(name, rows) {
  tableRows(name).push(...rows.map(r => withDefaults(name, r)));
}

function withDefaults(name, row) {
  const r = { ...row };
  if (r.id === undefined) r.id = crypto.randomUUID();
  if (r.created_at === undefined) r.created_at = new Date().toISOString();
  if (name === 'orders' && (r.order_number === undefined || r.order_number === null)) {
    seqs.orders = (seqs.orders || 0) + 1;
    r.order_number = seqs.orders;
  }
  return r;
}

function parsePath(pathAndQuery) {
  const [table, qs] = pathAndQuery.split('?');
  const params = new URLSearchParams(qs || '');
  const filters = [];
  let order = null, limit = null, onConflict = null;
  for (const [k, v] of params) {
    if (k === 'select') continue;
    if (k === 'order') { const [col, dir] = v.split('.'); order = { col, dir: dir || 'asc' }; }
    else if (k === 'limit') limit = Number(v);
    else if (k === 'on_conflict') onConflict = v;
    else if (typeof v === 'string' && v.startsWith('eq.')) filters.push({ col: k, val: decodeURIComponent(v.slice(3)) });
  }
  return { table, filters, order, limit, onConflict };
}

const matches = (row, filters) => filters.every(f => String(row[f.col]) === String(f.val));

function makeRes(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => data,
    text: async () => (data == null ? '' : JSON.stringify(data)),
  };
}

async function handle(url, init) {
  const method = (init.method || 'GET').toUpperCase();
  const pathAndQuery = url.slice(url.indexOf('/rest/v1/') + '/rest/v1/'.length);
  const { table, filters, order, limit, onConflict } = parsePath(pathAndQuery);
  const headers = init.headers || {};
  const prefer = headers.Prefer || headers.prefer || '';
  const body = init.body ? JSON.parse(init.body) : undefined;

  if (method === 'GET') {
    let rows = tableRows(table).filter(r => matches(r, filters));
    if (order) {
      rows = [...rows].sort((a, b) => {
        const av = a[order.col], bv = b[order.col];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return order.dir === 'desc' ? -cmp : cmp;
      });
    }
    if (limit) rows = rows.slice(0, limit);
    return makeRes(200, rows);
  }

  if (method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const raw of rows) {
      if (onConflict && prefer.includes('merge-duplicates')) {
        const existing = tableRows(table).find(r => String(r[onConflict]) === String(raw[onConflict]));
        if (existing) {
          for (const [k, v] of Object.entries(raw)) if (v != null) existing[k] = v;
          out.push(existing);
          continue;
        }
      }
      if (table === 'newsletter_subscribers') {
        const dup = tableRows(table).find(r => r.email === raw.email);
        if (dup) {
          if (onConflict && prefer.includes('ignore-duplicates')) { out.push(dup); continue; }
          if (!onConflict) return makeRes(409, { code: '23505', message: 'duplicate key value violates unique constraint "newsletter_subscribers_email_key"' });
        }
      }
      const r = withDefaults(table, raw);
      tableRows(table).push(r);
      out.push(r);
    }
    if (prefer.includes('return=minimal')) return makeRes(201, null);
    return makeRes(201, out);
  }

  if (method === 'PATCH') {
    const affected = tableRows(table).filter(r => matches(r, filters));
    for (const r of affected) Object.assign(r, body);
    return makeRes(200, affected);
  }

  if (method === 'DELETE') {
    store[table] = tableRows(table).filter(r => !matches(r, filters));
    return makeRes(204, null);
  }

  return makeRes(400, { message: `fake-supabase: unhandled ${method}` });
}

function install() {
  globalThis.fetch = async (url, init = {}) => {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    if (u.includes('/rest/v1/')) return handle(u, init);
    return REAL_FETCH(url, init);
  };
}

module.exports = { install, reset, seed, store };
