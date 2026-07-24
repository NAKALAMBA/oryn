require('dotenv').config({ quiet: true });

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const email = require('./email');
const shiprocket = require('./shiprocket');
const catalog = require('./catalog');

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
   — see server/catalog.js. ── */
app.get('/api/catalog/products', (req, res) => {
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

  const insertOrder = db.prepare(`
    INSERT INTO orders (full_name, email, phone, address, state, city, pin_code, delivery_date, product_interest, quantity_details, gift_message, cart_summary, subtotal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insertOrder.run(fullName, emailAddress, phone, address || null, state || null, city, pinCode || null, deliveryDate || null, product || null, quantityDetails || null, giftMessage || null, cartSummary || null, subtotal);
  const orderId = Number(result.lastInsertRowid);

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, sku, name, price, quantity, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertedItems = items.map(item => {
    const itemResult = insertItem.run(orderId, item.sku, item.name, item.price, item.quantity, item.details);
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
app.post('/api/newsletter', (req, res) => {
  const { email, sourcePage } = req.body || {};

  if (!isNonEmptyString(email)) {
    return res.status(400).json({ error: 'email is required.' });
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO newsletter_subscribers (email, source_page)
    VALUES (?, ?)
  `);
  insert.run(email, sourcePage || null);
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

/* ── Admin read endpoints (local dashboard use) ── */
app.get('/api/admin/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
  const withItems = orders.map(order => ({ ...order, items: itemsStmt.all(order.id) }));
  res.json(withItems);
});

app.get('/api/admin/contacts', (req, res) => {
  res.json(db.prepare('SELECT * FROM contact_messages ORDER BY id DESC').all());
});

app.get('/api/admin/newsletter', (req, res) => {
  res.json(db.prepare('SELECT * FROM newsletter_subscribers ORDER BY id DESC').all());
});

app.get('/api/admin/registrations', (req, res) => {
  res.json(db.prepare('SELECT * FROM event_registrations ORDER BY id DESC').all());
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Oryn server running at http://localhost:${PORT}`);
    console.log(`Admin dashboard: open admin-dashboard/index.html and point its API URL at this address.`);
  });
}

module.exports = app;
