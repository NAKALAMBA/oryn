'use strict';

// Supabase is the ONLY datastore for this server. Every order, contact
// message, newsletter subscriber and event registration lives here and
// nowhere else — there is no local SQLite fallback.
//
// All server-side calls use the SERVICE-ROLE (secret) key, which bypasses
// Row Level Security. That key is server-side only and never reaches the
// browser. The browser-direct paths (contact.html, Noida-registration.html
// via supabase-js) keep using the publishable key + the INSERT-only RLS
// policies.
//
// Schema: server/supabase-orders-schema.sql + server/supabase-admin-schema.sql.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

class SupabaseUnavailableError extends Error {}

function configured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfigured() {
  if (!configured()) {
    throw new SupabaseUnavailableError('Supabase is not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
}

// Low-level PostgREST call. `path` is everything after /rest/v1/.
async function rest(path, init = {}) {
  requireConfigured();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    throw new SupabaseUnavailableError(`Supabase request failed (${path}): ${err.message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SupabaseUnavailableError(`Supabase ${init.method || 'GET'} ${path} failed (HTTP ${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

const enc = encodeURIComponent;

async function insert(table, rows, { returning = true, prefer } = {}) {
  const preferParts = [returning ? 'return=representation' : 'return=minimal'];
  if (prefer) preferParts.push(prefer);
  const out = await rest(table, {
    method: 'POST',
    headers: { Prefer: preferParts.join(',') },
    body: JSON.stringify(rows),
  });
  return out;
}

async function selectWhere(table, filters = {}, { order, limit } = {}) {
  const params = ['select=*'];
  for (const [col, val] of Object.entries(filters)) params.push(`${col}=eq.${enc(val)}`);
  if (order) params.push(`order=${order}`);
  if (limit) params.push(`limit=${limit}`);
  return (await rest(`${table}?${params.join('&')}`)) || [];
}

async function updateWhere(table, filters, patch) {
  const params = [];
  for (const [col, val] of Object.entries(filters)) params.push(`${col}=eq.${enc(val)}`);
  const rows = await rest(`${table}?${params.join('&')}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function deleteWhere(table, filters) {
  const params = [];
  for (const [col, val] of Object.entries(filters)) params.push(`${col}=eq.${enc(val)}`);
  await rest(`${table}?${params.join('&')}`, { method: 'DELETE' });
}

/* ── Orders ─────────────────────────────────────────────────────────── */

// order: the customer/billing fields. items: [{sku,name,price,quantity,details}].
// Returns { id (uuid), order_number (sequential int) }.
async function createOrder(order, items) {
  const [row] = await insert('orders', [{
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
    discount: 0,
    shipping: null,
    final_payment: order.subtotal,
    payment_status: 'Pending',
    order_status: 'Pending',
  }]);

  let insertedItems = [];
  if (Array.isArray(items) && items.length) {
    insertedItems = await insert('order_items', items.map(item => ({
      order_id: row.id,
      sku: item.sku || null,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      details: item.details || null,
      variant: item.details || null,
    }))) || [];
  }

  return { id: row.id, order_number: row.order_number, items: insertedItems };
}

async function setOrderShiprocket(orderId, fields) {
  await updateWhere('orders', { id: orderId }, {
    ...fields,
    shiprocket_synced_at: new Date().toISOString(),
  });
}

async function findOrderByNumber(orderNumber) {
  const rows = await selectWhere('orders', { order_number: orderNumber });
  return rows[0] || null;
}

async function listOrderItems(orderId) {
  return selectWhere('order_items', { order_id: orderId }, { order: 'id.asc' });
}

/* ── Contact / newsletter / registrations ───────────────────────────── */

async function insertContact(row) {
  const [out] = await insert('contact_messages', [{
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    subject: row.subject || null,
    message: row.message,
  }]);
  return out;
}

// Idempotent on email. merge-duplicates keeps the row and updates name /
// source_page if a later signup carries them.
async function upsertNewsletter({ name, email, sourcePage }) {
  await insert('newsletter_subscribers?on_conflict=email', [{
    name: name || null,
    email,
    source_page: sourcePage || null,
  }], { returning: false, prefer: 'resolution=merge-duplicates' });
}

async function insertRegistrations(rows) {
  await insert('event_registrations', rows, { returning: false });
}

/* ── Admin reads / writes ───────────────────────────────────────────── */

async function listOrdersWithItems() {
  const orders = await rest('orders?select=*&order=created_at.desc') || [];
  const items = await rest('order_items?select=*') || [];
  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push(it);
  }
  return orders.map(o => ({ ...o, items: byOrder.get(o.id) || [] }));
}

async function updateOrder(id, patch) {
  return updateWhere('orders', { id }, patch);
}

async function listNewsletter() {
  return rest('newsletter_subscribers?select=*&order=created_at.desc') || [];
}

async function deleteNewsletter(id) {
  await deleteWhere('newsletter_subscribers', { id });
}

async function listContacts() {
  return rest('contact_messages?select=*&order=created_at.desc') || [];
}

async function listRegistrations() {
  return rest('event_registrations?select=*&order=created_at.desc') || [];
}

module.exports = {
  configured,
  SupabaseUnavailableError,
  createOrder,
  setOrderShiprocket,
  findOrderByNumber,
  listOrderItems,
  insertContact,
  upsertNewsletter,
  insertRegistrations,
  listOrdersWithItems,
  updateOrder,
  listNewsletter,
  deleteNewsletter,
  listContacts,
  listRegistrations,
};
