require('dotenv').config({ quiet: true });

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const email = require('./email');

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
  for (const item of items) {
    insertItem.run(orderId, item.sku, item.name, item.price, item.quantity, item.details);
  }

  res.status(201).json({ id: orderId, subtotal });
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
