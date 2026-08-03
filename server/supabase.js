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

class SupabaseUnavailableError extends Error {}

function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
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
    })));
  }

  return { supabaseOrderId };
}

module.exports = { saveOrderToSupabase, supabaseConfigured, SupabaseUnavailableError };
