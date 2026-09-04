require('dotenv').config({ quiet: true });

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const email = require('./email');
const shiprocket = require('./shiprocket');
const catalog = require('./catalog');
const supabase = require('./supabase');
const auth = require('./auth');

const ORDER_STATUSES = ['Pending', 'Completed', 'Cancelled'];
const PAYMENT_STATUSES = ['Pending', 'Paid'];

const app = express();
const PORT = process.env.PORT || 3001;
const SITE_ROOT = path.join(__dirname, '..');

app.use(cors());
app.use(express.json());

/* ── Serve the existing static site as-is ── */
app.use(express.static(SITE_ROOT));

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Loose digit-only comparison so "9876543210", "+91 98765 43210" and
// "09876543210" are all treated as the same phone number for the purposes
// of proving order ownership on the tracking lookup below.
function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/* ── Email validation (MSG91), used to catch a mistyped/undeliverable
   address at checkout. Fails open: if the check is unavailable or errors
   out, the order proceeds — an order is only rejected when MSG91 itself
   comes back and confirms the address is invalid. ── */
app.post('/api/email/validate', async (req, res) => {
  const address = String((req.body && req.body.email) || '').trim();
  if (!isNonEmptyString(address)) {
    return res.status(400).json({ error: 'email is required.' });
  }

  try {
    const result = await email.validateEmail(address);
    return res.json({ checked: true, valid: result.valid, status: result.status });
  } catch (err) {
    if (!(err instanceof email.EmailValidationUnavailableError)) {
      console.error('[email/validate] unexpected error:', err.message);
    }
    return res.json({ checked: false, valid: true });
  }
});

/* ── Catalog (Products / Collections / Products-by-Collection) — built for
   Shiprocket Checkout's "SRC Custom Integration" requirements. Read-only,
   no auth (product data is public). Response shape confirmed directly
   against Shiprocket's own example response (Shopify's Product API shape)
   — see server/catalog.js.
   `collection_id` is accepted as a QUERY parameter on /products (matching
   Shopify's own real convention of `products.json?collection_id=X`, and
   Shiprocket's integration team's explicit correction) to power
   Products-by-Collection. /collections always returns the FULL list,
   unconditionally — it's a separate endpoint from Products-by-Collection,
   not a lookup-one-by-id. The older /collections/:id/products path is
   kept working too, so anything already pointed at it doesn't break. ── */
app.get('/api/catalog/products', (req, res) => {
  const collectionId = req.query.collection_id;
  if (collectionId) {
    const products = catalog.getProductsByCollection(collectionId);
    if (products === null) {
      return res.status(404).json({ error: `Unknown collection_id "${collectionId}".` });
    }
    return res.json({ data: { total: products.length, products } });
  }
  const products = catalog.getAllProducts();
  res.json({ data: { total: products.length, products } });
});

app.get('/api/catalog/collections', (req, res) => {
  const collections = catalog.getAllCollections();
  res.json({ data: { total: collections.length, collections } });
});

app.get('/api/catalog/collections/:id/products', (req, res) => {
  const products = catalog.getProductsByCollection(req.params.id);
  if (products === null) {
    return res.status(404).json({ error: `Unknown collection id "${req.params.id}".` });
  }
  res.json({ data: { total: products.length, products } });
});

/* ── Orders (order.html enquiry form + cart) ── */
app.post('/api/orders', async (req, res) => {
  const { fullName, email: emailAddress, phone, address, state, city, pinCode, deliveryDate, product, quantityDetails, giftMessage, cartSummary, cartItems } = req.body || {};

  if (!isNonEmptyString(fullName) || !isNonEmptyString(emailAddress) || !isNonEmptyString(phone) || !isNonEmptyString(city)) {
    return res.status(400).json({ error: 'fullName, email, phone and city are required.' });
  }

  try {
    const validation = await email.validateEmail(emailAddress);
    if (!validation.valid) {
      return res.status(400).json({ error: 'That email address looks incorrect or undeliverable. Please double-check it.' });
    }
  } catch (err) {
    if (!(err instanceof email.EmailValidationUnavailableError)) {
      console.error('[orders] email validation error:', err.message);
    }
    // Fail open — never block a real order over our own validation tooling.
  }

  const items = (Array.isArray(cartItems) ? cartItems : [])
    .filter(item => isNonEmptyString(item.name))
    .map(item => ({
      sku: item.sku || null,
      name: item.name,
      price: Number(item.price) || 0,
      quantity: Number(item.quantity) || 1,
      details: item.details || null,
    }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // discount / payment_status / order_status take their column DEFAULTs
  // (0 / 'Pending' / 'Pending'); shipping stays NULL ("not set yet");
  // final_payment starts equal to the subtotal.
  const insertOrder = db.prepare(`
    INSERT INTO orders (full_name, email, phone, address, state, city, pin_code, delivery_date, product_interest, quantity_details, gift_message, cart_summary, subtotal, final_payment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insertOrder.run(fullName, emailAddress, phone, address || null, state || null, city, pinCode || null, deliveryDate || null, product || null, quantityDetails || null, giftMessage || null, cartSummary || null, subtotal, subtotal);
  const orderId = Number(result.lastInsertRowid);

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, sku, name, price, quantity, details, variant)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertedItems = items.map(item => {
    const itemResult = insertItem.run(orderId, item.sku, item.name, item.price, item.quantity, item.details, item.details);
    return { ...item, id: Number(itemResult.lastInsertRowid) };
  });

  /* ── Shiprocket: stage the shipment immediately. Fails open — a shipping
     partner hiccup never loses or blocks a real customer order; failures
     are recorded on the order row so the admin dashboard can surface and
     retry them. ── */
  try {
    const shiprocketOrder = await shiprocket.createShiprocketOrder(
      { id: orderId, full_name: fullName, email: emailAddress, phone, address, city, pin_code: pinCode, state, subtotal },
      insertedItems
    );
    db.prepare(`
      UPDATE orders SET shiprocket_order_id = ?, shiprocket_shipment_id = ?, shiprocket_status = ?, shiprocket_synced_at = datetime('now')
      WHERE id = ?
    `).run(shiprocketOrder.shiprocketOrderId, shiprocketOrder.shipmentId, shiprocketOrder.status, orderId);
  } catch (err) {
    if (!(err instanceof shiprocket.ShiprocketUnavailableError)) {
      console.error('[orders] unexpected Shiprocket error:', err.message);
    } else {
      console.warn(`[orders] Shiprocket sync failed for order ${orderId}: ${err.message}`);
    }
    db.prepare(`
      UPDATE orders SET shiprocket_status = 'failed', shiprocket_error = ?, shiprocket_synced_at = datetime('now')
      WHERE id = ?
    `).run(err.message, orderId);
  }

  /* ── Supabase: durable backup copy. The local SQLite file is NOT
     persistent on hosts without a disk add-on (e.g. Render's free tier
     resets it on every restart) — this gives every order a second,
     always-on home. Fails open, same as Shiprocket above: a Supabase
     hiccup never blocks or loses a real customer order. ── */
  try {
    await supabase.saveOrderToSupabase(
      { full_name: fullName, email: emailAddress, phone, address, state, city, pin_code: pinCode, delivery_date: deliveryDate, product_interest: product, quantity_details: quantityDetails, gift_message: giftMessage, cart_summary: cartSummary, subtotal },
      insertedItems
    );
  } catch (err) {
    if (!(err instanceof supabase.SupabaseUnavailableError)) {
      console.error('[orders] unexpected Supabase error:', err.message);
    } else {
      console.warn(`[orders] Supabase backup failed for order ${orderId}: ${err.message}`);
    }
  }

  res.status(201).json({ id: orderId, subtotal });
});

/* ── Order tracking (track-order.html) — order ID + phone number proves
   ownership since there's no customer login. On any mismatch we return the
   same generic "not found" error regardless of which part was wrong, so a
   guess-the-order-id attempt can't be used to enumerate real orders. ── */
app.post('/api/orders/track', async (req, res) => {
  const orderId = Number(req.body && req.body.orderId);
  const phone = normalizePhone(req.body && req.body.phone);
  if (!Number.isInteger(orderId) || orderId <= 0 || !phone) {
    return res.status(400).json({ error: 'Please enter both your Order ID and phone number.' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || normalizePhone(order.phone) !== phone) {
    return res.status(404).json({ error: "We couldn't find an order with that ID and phone number. Please double-check both." });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);

  let tracking = { status: order.shiprocket_shipment_id ? 'Not yet dispatched' : 'Not yet dispatched', activities: [] };
  if (order.shiprocket_shipment_id) {
    try {
      tracking = await shiprocket.trackShipment(order.shiprocket_shipment_id);
    } catch (err) {
      console.warn(`[orders/track] tracking lookup failed for order ${orderId}: ${err.message}`);
      tracking = { status: 'Shipment status temporarily unavailable — please check again shortly.', activities: [] };
    }
  }

  res.json({
    id: order.id,
    createdAt: order.created_at,
    city: order.city,
    subtotal: order.subtotal,
    items: items.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
    tracking,
  });
});

/* ── Contact form (contact.html) ── */
app.post('/api/contact', (req, res) => {
  const { fullName, email, phone, subject, message } = req.body || {};

  if (!isNonEmptyString(fullName) || !isNonEmptyString(email) || !isNonEmptyString(phone) || !isNonEmptyString(message)) {
    return res.status(400).json({ error: 'fullName, email, phone and message are required.' });
  }

  const insert = db.prepare(`
    INSERT INTO contact_messages (full_name, email, phone, subject, message)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = insert.run(fullName, email, phone, subject || null, message);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

/* ── Newsletter signup (footer form, every page) ── */
app.post('/api/newsletter', async (req, res) => {
  const { name, email, sourcePage } = req.body || {};

  if (!isNonEmptyString(email)) {
    return res.status(400).json({ error: 'email is required.' });
  }

  const cleanName = isNonEmptyString(name) ? name.trim() : null;

  // INSERT OR IGNORE keeps repeat signups idempotent; a follow-up UPDATE
  // fills in a name if we now have one and didn't before.
  db.prepare(`
    INSERT OR IGNORE INTO newsletter_subscribers (name, email, source_page)
    VALUES (?, ?, ?)
  `).run(cleanName, email, sourcePage || null);
  if (cleanName) {
    db.prepare(`UPDATE newsletter_subscribers SET name = ? WHERE email = ? AND (name IS NULL OR name = '')`).run(cleanName, email);
  }

  // Durable backup (fail-open — never block a signup over the backup).
  try {
    await supabase.saveNewsletterToSupabase({ name: cleanName, email, sourcePage });
  } catch (err) {
    if (!(err instanceof supabase.SupabaseUnavailableError)) {
      console.error('[newsletter] unexpected Supabase error:', err.message);
    }
  }

  res.status(201).json({ email });
});

/* ── Event registrations (Noida-registration.html) ── */
app.post('/api/registrations', (req, res) => {
  const { guestCount, attendees } = req.body || {};
  const list = Array.isArray(attendees) ? attendees : [];

  if (!list.length) {
    return res.status(400).json({ error: 'At least one attendee is required.' });
  }
  for (const attendee of list) {
    if (!isNonEmptyString(attendee.fullName) || !isNonEmptyString(attendee.email) || !isNonEmptyString(attendee.phone)) {
      return res.status(400).json({ error: 'Each attendee needs a full name, email and phone number.' });
    }
  }

  const groupId = crypto.randomUUID();
  const insert = db.prepare(`
    INSERT INTO event_registrations (group_id, guest_count, full_name, email, phone, city, allergies, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const attendee of list) {
    insert.run(groupId, Number(guestCount) || list.length, attendee.fullName, attendee.email, attendee.phone, attendee.city || null, attendee.allergies || null, attendee.notes || null);
  }

  res.status(201).json({ groupId, attendeeCount: list.length });
});

/* ── Admin panel (/admin) ──────────────────────────────────────────────
   Auth: one shared password (ADMIN_PASSWORD) is swapped for a signed
   token via /api/admin/login; every other /api/admin/* route then
   requires `Authorization: Bearer <token>`. When ADMIN_PASSWORD is unset
   (local dev, tests) auth is a no-op — see auth.js.

   Data source: Supabase when a service-role key is configured (durable —
   survives Render's periodic local-disk resets), otherwise local SQLite.
   Filtering happens here so the table and the Excel export are always
   built from the exact same set of rows. */

function toInt(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

// Normalise one order row (SQLite or Supabase) + recompute derived money.
function shapeOrder(order) {
  const subtotal = toInt(order.subtotal, 0);
  const discount = toInt(order.discount, 0);
  const shipping = (order.shipping === null || order.shipping === undefined || order.shipping === '')
    ? null : toInt(order.shipping, 0);
  const items = (order.items || []).map(it => ({
    id: it.id,
    sku: it.sku || null,
    name: it.name,
    quantity: toInt(it.quantity, 1),
    price: toInt(it.price, 0),
    variant: it.variant || it.details || null,
    details: it.details || null,
  }));
  // Spread the raw row first so passthrough columns (shiprocket_*, legacy
  // `status`, etc.) survive, then override with the normalised/derived
  // admin fields.
  return {
    ...order,
    subtotal,
    discount,
    shipping,
    final_payment: subtotal - discount + (shipping || 0),
    payment_status: PAYMENT_STATUSES.includes(order.payment_status) ? order.payment_status : 'Pending',
    order_status: ORDER_STATUSES.includes(order.order_status) ? order.order_status : 'Pending',
    items,
  };
}

// created_at comes back as "YYYY-MM-DD HH:MM:SS" (SQLite) or ISO
// "YYYY-MM-DDTHH:MM:SS...Z" (Supabase) — the first 10 chars are the date
// in both, which is all the start/end filter needs.
function orderDateKey(order) {
  return String(order.created_at || '').slice(0, 10);
}

function filterOrders(orders, query) {
  const start = isNonEmptyString(query.start) ? query.start.slice(0, 10) : null;
  const end = isNonEmptyString(query.end) ? query.end.slice(0, 10) : null;
  const orderStatus = isNonEmptyString(query.orderStatus) && query.orderStatus !== 'all' ? query.orderStatus : null;
  const paymentStatus = isNonEmptyString(query.paymentStatus) && query.paymentStatus !== 'all' ? query.paymentStatus : null;
  const q = isNonEmptyString(query.q) ? query.q.trim().toLowerCase() : null;

  return orders.filter(o => {
    const day = orderDateKey(o);
    if (start && day < start) return false;
    if (end && day > end) return false;
    if (orderStatus && o.order_status !== orderStatus) return false;
    if (paymentStatus && o.payment_status !== paymentStatus) return false;
    if (q) {
      const haystack = [
        o.full_name, o.email, o.phone, o.city, o.product_interest,
        ...o.items.map(i => `${i.name} ${i.variant || ''}`),
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function readOrdersFromSqlite() {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
  return orders.map(order => ({ ...order, items: itemsStmt.all(order.id) }));
}

app.post('/api/admin/login', async (req, res) => {
  const password = String((req.body && req.body.password) || '');
  const result = auth.login(password);
  if (result.ok) {
    return res.json({ token: result.token });
  }
  // Constant-ish delay so a wrong password can't be timed, and a generic
  // message regardless of reason.
  await new Promise(r => setTimeout(r, 400));
  if (result.reason === 'open') {
    // Explicit local opt-in (ORYN_ADMIN_OPEN=1 or in-memory test DB).
    return res.status(200).json({ token: null, authDisabled: true });
  }
  if (result.reason === 'disabled') {
    return res.status(503).json({ error: 'Admin access is not configured on the server. Set ADMIN_PASSWORD and redeploy.' });
  }
  return res.status(401).json({ error: 'Incorrect password.' });
});

app.use('/api/admin', auth.requireAdmin);

app.get('/api/admin/orders', async (req, res) => {
  let source = 'sqlite';
  let raw;
  if (supabase.adminConfigured()) {
    try {
      raw = await supabase.adminListOrders();
      source = 'supabase';
    } catch (err) {
      console.warn('[admin/orders] Supabase read failed, falling back to SQLite:', err.message);
      raw = readOrdersFromSqlite();
    }
  } else {
    raw = readOrdersFromSqlite();
  }
  const shaped = raw.map(shapeOrder);
  const filtered = filterOrders(shaped, req.query);
  res.set('X-Oryn-Data-Source', source);
  res.json(filtered);
});

app.patch('/api/admin/orders/:id', async (req, res) => {
  const { order_status, payment_status, discount, shipping } = req.body || {};
  const patch = {};

  if (order_status !== undefined) {
    if (!ORDER_STATUSES.includes(order_status)) {
      return res.status(400).json({ error: `order_status must be one of: ${ORDER_STATUSES.join(', ')}` });
    }
    patch.order_status = order_status;
  }
  if (payment_status !== undefined) {
    if (!PAYMENT_STATUSES.includes(payment_status)) {
      return res.status(400).json({ error: `payment_status must be one of: ${PAYMENT_STATUSES.join(', ')}` });
    }
    patch.payment_status = payment_status;
  }
  if (discount !== undefined) {
    const d = toInt(discount, NaN);
    if (!Number.isFinite(d) || d < 0) return res.status(400).json({ error: 'discount must be a non-negative number.' });
    patch.discount = d;
  }
  if (shipping !== undefined) {
    if (shipping === null || shipping === '') {
      patch.shipping = null;
    } else {
      const s = toInt(shipping, NaN);
      if (!Number.isFinite(s) || s < 0) return res.status(400).json({ error: 'shipping must be a non-negative number, or blank.' });
      patch.shipping = s;
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  // Local SQLite row (also the fallback source of `subtotal` for the
  // final_payment recompute).
  const localId = Number(req.params.id);
  const localRow = Number.isInteger(localId) ? db.prepare('SELECT * FROM orders WHERE id = ?').get(localId) : null;

  let updated = null;

  if (supabase.adminConfigured()) {
    try {
      // Recompute final_payment from the row's current values + this patch.
      const current = await supabase.adminListOrders();
      const target = current.find(o => String(o.id) === String(req.params.id));
      if (!target) return res.status(404).json({ error: 'Order not found.' });
      const nextDiscount = patch.discount ?? toInt(target.discount, 0);
      const nextShipping = patch.shipping !== undefined ? patch.shipping
        : (target.shipping === null || target.shipping === undefined ? null : toInt(target.shipping, 0));
      patch.final_payment = toInt(target.subtotal, 0) - nextDiscount + (nextShipping || 0);
      updated = shapeOrder({ ...target, ...patch, items: target.items || [] });
      await supabase.adminUpdateOrder(req.params.id, patch);
    } catch (err) {
      console.warn('[admin/orders PATCH] Supabase update failed:', err.message);
      if (!localRow) return res.status(502).json({ error: 'Could not update the order.' });
    }
  }

  if (localRow) {
    const nextDiscount = patch.discount ?? toInt(localRow.discount, 0);
    const nextShipping = patch.shipping !== undefined ? patch.shipping
      : (localRow.shipping === null || localRow.shipping === undefined ? null : toInt(localRow.shipping, 0));
    const finalPayment = toInt(localRow.subtotal, 0) - nextDiscount + (nextShipping || 0);
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'final_payment') continue;
      sets.push(`${k} = ?`); vals.push(v);
    }
    sets.push('final_payment = ?'); vals.push(finalPayment);
    vals.push(localRow.id);
    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(localRow.id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(localRow.id);
    if (!updated) updated = shapeOrder({ ...fresh, items });
  }

  if (!updated) return res.status(404).json({ error: 'Order not found.' });
  res.json(updated);
});

app.get('/api/admin/newsletter', async (req, res) => {
  let rows;
  if (supabase.adminConfigured()) {
    try {
      rows = await supabase.adminListNewsletter();
    } catch (err) {
      console.warn('[admin/newsletter] Supabase read failed, falling back to SQLite:', err.message);
      rows = db.prepare('SELECT * FROM newsletter_subscribers ORDER BY id DESC').all();
    }
  } else {
    rows = db.prepare('SELECT * FROM newsletter_subscribers ORDER BY id DESC').all();
  }
  const q = isNonEmptyString(req.query.q) ? req.query.q.trim().toLowerCase() : null;
  const shaped = rows
    .map(r => ({ id: r.id, name: r.name || null, email: r.email, created_at: r.created_at, source_page: r.source_page || null }))
    .filter(r => !q || `${r.name || ''} ${r.email}`.toLowerCase().includes(q));
  res.json(shaped);
});

app.delete('/api/admin/newsletter/:id', async (req, res) => {
  const localId = Number(req.params.id);
  if (Number.isInteger(localId)) {
    db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(localId);
  }
  if (supabase.adminConfigured()) {
    try {
      await supabase.adminDeleteNewsletter(req.params.id);
    } catch (err) {
      console.warn('[admin/newsletter DELETE] Supabase delete failed:', err.message);
      return res.status(502).json({ error: 'Could not remove that subscriber.' });
    }
  }
  res.json({ ok: true });
});

app.get('/api/admin/contacts', (req, res) => {
  res.json(db.prepare('SELECT * FROM contact_messages ORDER BY id DESC').all());
});

app.get('/api/admin/registrations', (req, res) => {
  res.json(db.prepare('SELECT * FROM event_registrations ORDER BY id DESC').all());
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Oryn server running at http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin-dashboard/  (in production it's served at /admin)`);
    if (!process.env.ADMIN_PASSWORD) console.log('  ⚠  ADMIN_PASSWORD is not set — the admin panel is currently open (no login).');
    if (!supabase.adminConfigured()) console.log('  ⓘ  SUPABASE_SERVICE_ROLE_KEY not set — admin reads from local SQLite (resets on restart).');
  });
}

module.exports = app;
