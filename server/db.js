const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.ORYN_DB_PATH || path.join(__dirname, 'data', 'oryn.db');
if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    state TEXT,
    city TEXT NOT NULL,
    pin_code TEXT,
    delivery_date TEXT,
    product_interest TEXT,
    quantity_details TEXT,
    gift_message TEXT,
    cart_summary TEXT,
    subtotal INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    shiprocket_order_id TEXT,
    shiprocket_shipment_id TEXT,
    shiprocket_status TEXT,
    shiprocket_error TEXT,
    shiprocket_synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sku TEXT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    email TEXT NOT NULL UNIQUE,
    source_page TEXT
  );

  CREATE TABLE IF NOT EXISTS event_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    group_id TEXT NOT NULL,
    guest_count INTEGER NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT,
    allergies TEXT,
    notes TEXT
  );
`);

// Lightweight migration: CREATE TABLE IF NOT EXISTS above won't add columns
// to a table that already existed from an earlier version of this schema.
function addMissingColumns(table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const [column, definition] of columns) {
    if (!existing.has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
addMissingColumns('orders', [
  ['address', 'TEXT'],
  ['state', 'TEXT'],
  ['pin_code', 'TEXT'],
  ['shiprocket_order_id', 'TEXT'],
  ['shiprocket_shipment_id', 'TEXT'],
  ['shiprocket_status', 'TEXT'],
  ['shiprocket_error', 'TEXT'],
  ['shiprocket_synced_at', 'TEXT'],
  // ── Admin panel: amounts + statuses managed from /admin ──
  // `discount` is admin-entered (0 until then). `shipping` stays NULL —
  // "not set yet" — until an actual charge is entered, deliberately
  // distinct from a real 0. `final_payment` = subtotal - discount +
  // coalesce(shipping,0), recomputed on every admin edit.
  ['discount', 'INTEGER NOT NULL DEFAULT 0'],
  ['shipping', 'INTEGER'],
  ['final_payment', 'INTEGER'],
  // Payment is tracked separately from fulfilment. payment_status:
  // 'Pending' | 'Paid'. order_status: 'Pending' | 'Completed' |
  // 'Cancelled'. The legacy `status` column (default 'new') is left in
  // place, untouched — new code reads/writes `order_status` only.
  ['payment_status', "TEXT NOT NULL DEFAULT 'Pending'"],
  ['order_status', "TEXT NOT NULL DEFAULT 'Pending'"],
]);
addMissingColumns('order_items', [
  // The human-readable variant/label for the line ("Solstice · Box of 8",
  // "500g", …) — mirrors the cart item's `details`.
  ['variant', 'TEXT'],
]);
addMissingColumns('newsletter_subscribers', [
  ['name', 'TEXT'],
]);

// Backfill final_payment for any pre-existing rows created before these
// columns existed (ALTER ... ADD COLUMN can't compute a per-row default).
db.exec(`
  UPDATE orders
  SET final_payment = subtotal - discount + COALESCE(shipping, 0)
  WHERE final_payment IS NULL
`);

module.exports = db;
