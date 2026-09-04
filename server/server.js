require('dotenv').config({ quiet: true });

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
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

  // Single source of truth: Supabase. discount/shipping/final_payment/
  // payment_status/order_status start at their defaults (0 / null /
  // subtotal / Pending / Pending) — see server/supabase.js.
  let created;
  try {
    created = await supabase.createOrder(
      { full_name: fullName, email: emailAddress, phone, address, state, city, pin_code: pinCode, delivery_date: deliveryDate, product_interest: product, quantity_details: quantityDetails, gift_message: giftMessage, cart_summary: cartSummary, subtotal },
      items
    );
  } catch (err) {
    console.error('[orders] could not save order:', err.message);
    return res.status(502).json({ error: "We couldn't save your order just now. Please try again in a moment, or reach us on Instagram @oryn.patisserie." });
  }

  const orderNumber = created.order_number;

  /* ── Shiprocket: stage the shipment immediately. Fails open — a shipping
     partner hiccup never loses or blocks a real customer order; the
     failure is recorded on the order row for the admin dashboard. ── */
  try {
    const shiprocketOrder = await shiprocket.createShiprocketOrder(
      { id: orderNumber, full_name: fullName, email: emailAddress, phone, address, city, pin_code: pinCode, state, subtotal },
      created.items
    );
    await supabase.setOrderShiprocket(created.id, {
      shiprocket_order_id: shiprocketOrder.shiprocketOrderId,
      shiprocket_shipment_id: shiprocketOrder.shipmentId,
      shiprocket_status: shiprocketOrder.status,
    });
  } catch (err) {
    if (!(err instanceof shiprocket.ShiprocketUnavailableError)) {
      console.error('[orders] unexpected Shiprocket error:', err.message);
    } else {
      console.warn(`[orders] Shiprocket sync failed for order ${orderNumber}: ${err.message}`);
    }
    try {
      await supabase.setOrderShiprocket(created.id, { shiprocket_status: 'failed', shiprocket_error: err.message });
    } catch (e) {
      console.warn(`[orders] could not record Shiprocket failure for order ${orderNumber}: ${e.message}`);
    }
  }

  res.status(201).json({ id: orderNumber, subtotal });
});

/* ── Order tracking (track-order.html) — order ID + phone number proves
   ownership since there's no customer login. On any mismatch we return the
   same generic "not found" error regardless of which part was wrong, so a
   guess-the-order-id attempt can't be used to enumerate real orders. ── */
app.post('/api/orders/track', async (req, res) => {
  const orderNumber = Number(req.body && req.body.orderId);
  const phone = normalizePhone(req.body && req.body.phone);
  if (!Number.isInteger(orderNumber) || orderNumber <= 0 || !phone) {
    return res.status(400).json({ error: 'Please enter both your Order ID and phone number.' });
  }

  let order, items;
  try {
    order = await supabase.findOrderByNumber(orderNumber);
    if (order && normalizePhone(order.phone) === phone) {
      items = await supabase.listOrderItems(order.id);
    }
  } catch (err) {
    console.error('[orders/track] lookup failed:', err.message);
    return res.status(502).json({ error: 'Order tracking is temporarily unavailable. Please try again shortly.' });
  }

  if (!order || normalizePhone(order.phone) !== phone) {
    return res.status(404).json({ error: "We couldn't find an order with that ID and phone number. Please double-check both." });
  }

  let tracking = { status: 'Not yet dispatched', activities: [] };
  if (order.shiprocket_shipment_id) {
    try {
      tracking = await shiprocket.trackShipment(order.shiprocket_shipment_id);
    } catch (err) {
      console.warn(`[orders/track] tracking lookup failed for order ${orderNumber}: ${err.message}`);
      tracking = { status: 'Shipment status temporarily unavailable — please check again shortly.', activities: [] };
    }
  }

  res.json({
    id: order.order_number,
    createdAt: order.created_at,
    city: order.city,
    subtotal: order.subtotal,
    items: (items || []).map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
    tracking,
  });
});

/* ── Contact form (contact.html) ── */
app.post('/api/contact', async (req, res) => {
  const { fullName, email, phone, subject, message } = req.body || {};

  if (!isNonEmptyString(fullName) || !isNonEmptyString(email) || !isNonEmptyString(phone) || !isNonEmptyString(message)) {
    return res.status(400).json({ error: 'fullName, email, phone and message are required.' });
  }

  try {
    const row = await supabase.insertContact({ full_name: fullName, email, phone, subject, message });
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error('[contact] could not save message:', err.message);
    res.status(502).json({ error: "We couldn't send this just now. Please try again, or reach us on Instagram @oryn.patisserie." });
  }
});

/* ── Newsletter signup (footer form, every page) ── */
app.post('/api/newsletter', async (req, res) => {
  const { name, email, sourcePage } = req.body || {};

  if (!isNonEmptyString(email)) {
    return res.status(400).json({ error: 'email is required.' });
  }

  const cleanName = isNonEmptyString(name) ? name.trim() : null;

  try {
    await supabase.upsertNewsletter({ name: cleanName, email, sourcePage });
    res.status(201).json({ email });
  } catch (err) {
    console.error('[newsletter] could not save signup:', err.message);
    res.status(502).json({ error: "Couldn't sign you up just now — please try again shortly." });
  }
});

/* ── Event registrations (Noida-registration.html) ── */
app.post('/api/registrations', async (req, res) => {
  const { guestCount, attendees, eventName } = req.body || {};
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
  const guests = Number(guestCount) || list.length;
  const rows = list.map(attendee => ({
    group_id: groupId,
    event_name: eventName || null,
    guest_count: guests,
    full_name: attendee.fullName,
    email: attendee.email,
    phone: attendee.phone,
    city: attendee.city || null,
    allergies: attendee.allergies || null,
    notes: attendee.notes || null,
  }));

  try {
    await supabase.insertRegistrations(rows);
    res.status(201).json({ groupId, attendeeCount: list.length });
  } catch (err) {
    console.error('[registrations] could not save:', err.message);
    res.status(502).json({ error: "We couldn't save your registration just now. Please try again shortly." });
  }
});

/* ── Admin panel (/admin) ──────────────────────────────────────────────
   Auth: one shared password (ADMIN_PASSWORD) is swapped for a signed
   token via /api/admin/login; every other /api/admin/* route then
   requires `Authorization: Bearer <token>`. When ADMIN_PASSWORD is unset
   (local dev, tests) auth is a no-op — see auth.js.

   Data source: Supabase (the only store). Filtering happens here so the
   table and the Excel export are always built from the exact same rows. */

function toInt(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

// Normalise one Supabase order row + recompute derived money.
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

// created_at is ISO "YYYY-MM-DDTHH:MM:SS...Z" — the first 10 chars are the
// date, which is all the start/end filter needs.
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
        o.order_number, o.full_name, o.email, o.phone, o.city, o.product_interest,
        ...o.items.map(i => `${i.name} ${i.variant || ''}`),
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
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
  let raw;
  try {
    raw = await supabase.listOrdersWithItems();
  } catch (err) {
    console.error('[admin/orders] Supabase read failed:', err.message);
    return res.status(502).json({ error: 'Could not load orders from the database.' });
  }
  const shaped = raw.map(shapeOrder);
  res.json(filterOrders(shaped, req.query));
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

  // :id may be the order's uuid (what the admin table sends) or its
  // sequential order_number.
  const id = String(req.params.id);
  let target, items;
  try {
    const all = await supabase.listOrdersWithItems();
    const found = all.find(o => String(o.id) === id || String(o.order_number) === id);
    target = found;
    items = found && found.items;
  } catch (err) {
    console.error('[admin/orders PATCH] read failed:', err.message);
    return res.status(502).json({ error: 'Could not update the order.' });
  }
  if (!target) return res.status(404).json({ error: 'Order not found.' });

  // Recompute final_payment from the row's current values + this patch.
  const nextDiscount = patch.discount ?? toInt(target.discount, 0);
  const nextShipping = patch.shipping !== undefined ? patch.shipping
    : (target.shipping === null || target.shipping === undefined ? null : toInt(target.shipping, 0));
  patch.final_payment = toInt(target.subtotal, 0) - nextDiscount + (nextShipping || 0);

  try {
    await supabase.updateOrder(target.id, patch);
  } catch (err) {
    console.error('[admin/orders PATCH] update failed:', err.message);
    return res.status(502).json({ error: 'Could not update the order.' });
  }

  res.json(shapeOrder({ ...target, ...patch, items: items || [] }));
});

app.get('/api/admin/newsletter', async (req, res) => {
  let rows;
  try {
    rows = await supabase.listNewsletter();
  } catch (err) {
    console.error('[admin/newsletter] Supabase read failed:', err.message);
    return res.status(502).json({ error: 'Could not load subscribers.' });
  }
  const q = isNonEmptyString(req.query.q) ? req.query.q.trim().toLowerCase() : null;
  const shaped = rows
    .map(r => ({ id: r.id, name: r.name || null, email: r.email, created_at: r.created_at, source_page: r.source_page || null }))
    .filter(r => !q || `${r.name || ''} ${r.email}`.toLowerCase().includes(q));
  res.json(shaped);
});

app.delete('/api/admin/newsletter/:id', async (req, res) => {
  try {
    await supabase.deleteNewsletter(req.params.id);
  } catch (err) {
    console.error('[admin/newsletter DELETE] Supabase delete failed:', err.message);
    return res.status(502).json({ error: 'Could not remove that subscriber.' });
  }
  res.json({ ok: true });
});

app.get('/api/admin/contacts', async (req, res) => {
  try {
    res.json(await supabase.listContacts());
  } catch (err) {
    console.error('[admin/contacts] Supabase read failed:', err.message);
    res.status(502).json({ error: 'Could not load contact messages.' });
  }
});

app.get('/api/admin/registrations', async (req, res) => {
  try {
    res.json(await supabase.listRegistrations());
  } catch (err) {
    console.error('[admin/registrations] Supabase read failed:', err.message);
    res.status(502).json({ error: 'Could not load registrations.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Oryn server running at http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin-dashboard/  (in production it's served at /admin)`);
    if (!process.env.ADMIN_PASSWORD) console.log('  ⚠  ADMIN_PASSWORD is not set — the admin panel is currently open (no login).');
    if (!supabase.configured()) console.log('  ⚠  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — every form endpoint will 502. Supabase is the only datastore.');
  });
}

module.exports = app;
