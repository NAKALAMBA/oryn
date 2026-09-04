'use strict';

// Admin authentication for the /admin panel.
//
// A single shared password (ADMIN_PASSWORD) is exchanged once, via
// POST /api/admin/login, for a short-lived signed token. The token is a
// self-contained `<base64url(payload)>.<hmac>` string — no server-side
// session store, which matters on hosts that reset local state on every
// restart (Render's free tier). The browser keeps it in localStorage and
// sends it as `Authorization: Bearer <token>` on every /api/admin/* call.
//
// Fails OPEN when unconfigured: if ADMIN_PASSWORD is unset (local dev, the
// test suite), `requireAdmin` is a no-op and `login` reports that auth is
// disabled. Production sets both ADMIN_PASSWORD and ADMIN_TOKEN_SECRET.

const crypto = require('node:crypto');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Read lazily (not at module load) so tests can set process.env before the
// first call without fighting require() ordering.
function adminPassword() {
  return process.env.ADMIN_PASSWORD || '';
}
function tokenSecret() {
  // Falls back to the password itself so a deploy that sets only
  // ADMIN_PASSWORD still gets working, signed tokens.
  return process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASSWORD || 'oryn-admin-dev-secret';
}

function authEnabled() {
  return adminPassword().length > 0;
}

// When ADMIN_PASSWORD is unset we normally FAIL CLOSED (block every admin
// route) so a misconfigured production deploy never exposes customer data.
// The two exceptions are the test suite (isolated in-memory DB) and an
// explicit local opt-in.
function openWhenUnconfigured() {
  return process.env.ORYN_DB_PATH === ':memory:' || process.env.ORYN_ADMIN_OPEN === '1';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payloadStr) {
  return b64url(crypto.createHmac('sha256', tokenSecret()).update(payloadStr).digest());
}

// Constant-time string compare that never throws on length mismatch.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function issueToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  if (!safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

// Returns { ok: true, token } on success, { ok: false, reason } otherwise.
function login(password) {
  if (!authEnabled()) {
    return { ok: false, reason: openWhenUnconfigured() ? 'open' : 'disabled' };
  }
  if (!safeEqual(password || '', adminPassword())) {
    return { ok: false, reason: 'bad-password' };
  }
  return { ok: true, token: issueToken() };
}

// Express middleware. Fails CLOSED when auth is unconfigured (see
// openWhenUnconfigured) so a production deploy missing ADMIN_PASSWORD does
// not serve customer data to the public.
function requireAdmin(req, res, next) {
  if (!authEnabled()) {
    if (openWhenUnconfigured()) return next();
    return res.status(503).json({ error: 'Admin access is not configured on the server. Set ADMIN_PASSWORD.' });
  }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Not authorised. Log in again.' });
  }
  return next();
}

module.exports = { login, requireAdmin, verifyToken, issueToken, authEnabled, openWhenUnconfigured };
