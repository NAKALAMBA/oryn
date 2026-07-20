'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.ORYN_DB_PATH = ':memory:';
const db = require('../db');

const EXPECTED_TABLES = [
  'orders',
  'order_items',
  'contact_messages',
  'newsletter_subscribers',
  'event_registrations',
];

test('db: schema has every expected table', () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const table of EXPECTED_TABLES) {
    assert.ok(names.includes(table), `missing table: ${table}`);
  }
});

test('db: orders table has the expected columns', () => {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  const expected = ['id', 'created_at', 'full_name', 'email', 'phone', 'address', 'state', 'city', 'pin_code',
    'delivery_date', 'product_interest', 'quantity_details', 'gift_message', 'cart_summary', 'subtotal', 'status'];
  for (const col of expected) {
    assert.ok(cols.includes(col), `orders missing column: ${col}`);
  }
});

test('db: migration adds address/state/pin_code columns to a pre-existing orders table', () => {
  // Simulate a database created before this migration existed (no address/state/pin_code columns),
  // then re-require db.js against it and confirm it patches the schema in place.
  const path = require('node:path');
  const os = require('node:os');
  const fs = require('node:fs');
  const { DatabaseSync } = require('node:sqlite');

  const legacyPath = path.join(os.tmpdir(), `oryn-legacy-${Date.now()}.db`);
  const legacyDb = new DatabaseSync(legacyPath);
  legacyDb.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      city TEXT NOT NULL,
      delivery_date TEXT,
      product_interest TEXT,
      quantity_details TEXT,
      gift_message TEXT,
      cart_summary TEXT,
      subtotal INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new'
    );
  `);
  legacyDb.close();

  const previousDbPath = process.env.ORYN_DB_PATH;
  process.env.ORYN_DB_PATH = legacyPath;
  delete require.cache[require.resolve('../db')];
  const migratedDb = require('../db');

  const cols = migratedDb.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  assert.ok(cols.includes('address'));
  assert.ok(cols.includes('state'));
  assert.ok(cols.includes('pin_code'));

  migratedDb.close();
  process.env.ORYN_DB_PATH = previousDbPath;
  fs.rmSync(legacyPath, { force: true });
});

test('db: order_items rows cascade-delete when the parent order is deleted', () => {
  const orderId = Number(
    db.prepare('INSERT INTO orders (full_name, email, phone, city, subtotal) VALUES (?, ?, ?, ?, ?)')
      .run('Cascade Test', 't@example.com', '9000000000', 'Delhi', 100)
      .lastInsertRowid
  );
  db.prepare('INSERT INTO order_items (order_id, name, price, quantity) VALUES (?, ?, ?, ?)')
    .run(orderId, 'Test Item', 100, 1);

  let items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  assert.equal(items.length, 1, 'item should exist before delete');

  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  assert.equal(items.length, 0, 'order_items should cascade-delete with its parent order');
});

test('db: newsletter_subscribers rejects duplicate emails at the schema level', () => {
  db.prepare('INSERT INTO newsletter_subscribers (email) VALUES (?)').run('unique-test@example.com');
  assert.throws(() => {
    db.prepare('INSERT INTO newsletter_subscribers (email) VALUES (?)').run('unique-test@example.com');
  }, /UNIQUE/i);
});

