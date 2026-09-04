'use strict';

// Durable backup of order data in Supabase. The Express server's own
// SQLite database is NOT persistent on hosts without a disk add-on (e.g.
// Render's free tier resets it on every restart) — this gives every order
// a second, always-on home. Everything else (email validation, Shiprocket
// sync, order tracking) keeps working exactly as before; this is purely
// additive and fails open: a Supabase hiccup never blocks or loses a real
// customer order.
//
// Uses the same public anon key already embedded in js/supabase-config.js
// (safe to expose — Row Level Security on the Supabase side only allows
// INSERT, never SELECT/UPDATE/DELETE, for the anon role). Run
// server/supabase-orders-schema.sql once in the Supabase SQL Editor
// before this will work.

const crypto = require('node:crypto');

// No hardcoded fallback on purpose — tests (and any environment that
// hasn't configured this yet) must fail open into SupabaseUnavailableError
// rather than silently writing to a real, shared Supabase project.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Service-role key: bypasses Row Level Security so the admin panel can
// READ / UPDATE / DELETE order + newsletter data that the anon key is
// deliberately only allowed to INSERT. Server-side only — never sent to
// the browser. When unset, the admin endpoints fall back to local SQLite.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

class SupabaseUnavailableError extends Error {}

function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Whether the admin panel can use Supabase as its durable data source.
function adminConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function insertRows(table, rows) {
  if (!supabaseConfigured()) {
    throw new SupabaseUnavailableError('Supabase is not configured (missing SUPABASE_URL/SUPABASE_ANON_KEY).');
  }
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    throw new SupabaseUnavailableError(`Supabase request failed for "${table}": ${err.message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SupabaseUnavailableError(`Supabase insert into "${table}" failed (HTTP ${res.status}): ${text}`);
  }
}

// order: the row already saved locally (full_name/email/phone/address/
// state/city/pin_code/delivery_date/product_interest/quantity_details/
// gift_message/cart_summary/subtotal). items: the order_items rows
// already saved locally (sku/name/price/quantity/details).
//
// Generates its OWN uuid for the Supabase copy rather than reusing the
// local integer id, so order_items can be inserted with the correct
// order_id without an insert...returning round trip — that would need a
// SELECT policy we deliberately don't grant (this data is customer PII).
async function saveOrderToSupabase(order, items) {
  const supabaseOrderId = crypto.randomUUID();

  await insertRows('orders', [{
    id: supabaseOrderId,
    full_name: order.full_name,
    email: order.email,
    phone: order.phone,
    address: order.address || null,
    state: order.state || null,
    city: order.city,
    pin_code: order.pin_code || null,
    delivery_date: order.delivery_date || null,
    product_interest: order.product_interest || null,
    quantity_details: order.quantity_details || null,
    gift_message: order.gift_message || null,
    cart_summary: order.cart_summary || null,
    subtotal: order.subtotal,
    // Admin-panel fields — same starting state as the local SQLite row.
    discount: 0,
    shipping: null,
    final_payment: order.subtotal,
    payment_status: 'Pending',
    order_status: 'Pending',
  }]);

  if (Array.isArray(items) && items.length) {
    await insertRows('order_items', items.map(item => ({
      id: crypto.randomUUID(),
      order_id: supabaseOrderId,
      sku: item.sku || null,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      details: item.details || null,
      variant: item.details || null,
    })));
  }

  return { supabaseOrderId };
}

// Durable copy of a newsletter signup. Fail-open, same as the order path.
async function saveNewsletterToSupabase({ name, email, sourcePage }) {
  await insertRows('newsletter_subscribers', [{
    name: name || null,
    email,
    source_page: sourcePage || null,
  }]);
}

/* ── Admin (service-role) reads & writes ────────────────────────────────
   These bypass RLS. `adminConfigured()` gates every call site; when it's
   false the server uses local SQLite instead. Errors surface as
   SupabaseUnavailableError so callers can fall back rather than 500. */

async function serviceFetch(pathAndQuery, init = {}) {
  if (!adminConfigured()) {
    throw new SupabaseUnavailableError('Supabase admin access is not configured (missing SUPABASE_SERVICE_ROLE_KEY).');
  }
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    throw new SupabaseUnavailableError(`Supabase admin request failed: ${err.message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SupabaseUnavailableError(`Supabase admin request failed (HTTP ${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// Every order + its items, newest first. Filtering is done in server.js so
// the exact same set powers the table and the Excel export.
async function adminListOrders() {
  const orders = await serviceFetch('orders?select=*&order=created_at.desc');
  const items = await serviceFetch('order_items?select=*');
  const byOrder = new Map();
  for (const it of (items || [])) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push(it);
  }
  return (orders || []).map(o => ({ ...o, items: byOrder.get(o.id) || [] }));
}

async function adminUpdateOrder(id, patch) {
  const rows = await serviceFetch(`orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function adminListNewsletter() {
  return (await serviceFetch('newsletter_subscribers?select=*&order=created_at.desc')) || [];
}

async function adminDeleteNewsletter(id) {
  await serviceFetch(`newsletter_subscribers?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

module.exports = {
  saveOrderToSupabase,
  saveNewsletterToSupabase,
  supabaseConfigured,
  adminConfigured,
  adminListOrders,
  adminUpdateOrder,
  adminListNewsletter,
  adminDeleteNewsletter,
  SupabaseUnavailableError,
};
