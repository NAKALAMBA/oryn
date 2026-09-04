'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uniquePhone } = require('./helpers');

// Helper: place an order and return its id.
async function placeOrder(baseUrl, over = {}) {
  const res = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: over.fullName || 'Test Buyer',
      email: over.email || 'buyer@example.com',
      phone: over.phone || uniquePhone(),
      city: over.city || 'Delhi',
      cartItems: over.cartItems || [{ sku: 'X', name: 'Aurelia', price: 800, quantity: 1, details: 'Box of 6' }],
    }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}

describe('Admin orders — filtering & inline updates', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('PATCH updates status and recomputes final payment (subtotal - discount + shipping)', async () => {
    const id = await placeOrder(baseUrl, { cartItems: [{ sku: 'X', name: 'Aurelia', price: 800, quantity: 2, details: 'Box of 6' }] });

    let res = await fetch(`${baseUrl}/api/admin/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount: 200, shipping: 90, order_status: 'Completed', payment_status: 'Paid' }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.subtotal, 1600);
    assert.equal(updated.discount, 200);
    assert.equal(updated.shipping, 90);
    assert.equal(updated.final_payment, 1600 - 200 + 90);
    assert.equal(updated.order_status, 'Completed');
    assert.equal(updated.payment_status, 'Paid');
  });

  it('treats a blank shipping value as "not set" (null), not zero', async () => {
    const id = await placeOrder(baseUrl);
    await fetch(`${baseUrl}/api/admin/orders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipping: 120 }),
    });
    const res = await fetch(`${baseUrl}/api/admin/orders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipping: '' }),
    });
    const updated = await res.json();
    assert.equal(updated.shipping, null);
    assert.equal(updated.final_payment, updated.subtotal, 'blank shipping drops out of the total');
  });

  it('rejects an invalid status', async () => {
    const id = await placeOrder(baseUrl);
    const res = await fetch(`${baseUrl}/api/admin/orders/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_status: 'Shipped' }),
    });
    assert.equal(res.status, 400);
  });

  it('filters by order status and payment status', async () => {
    const a = await placeOrder(baseUrl, { fullName: 'Filter A' });
    const b = await placeOrder(baseUrl, { fullName: 'Filter B' });
    await fetch(`${baseUrl}/api/admin/orders/${a}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_status: 'Cancelled', payment_status: 'Paid' }),
    });

    const cancelled = await (await fetch(`${baseUrl}/api/admin/orders?orderStatus=Cancelled`)).json();
    assert.ok(cancelled.some(o => String(o.id) === String(a)));
    assert.ok(!cancelled.some(o => String(o.id) === String(b)));

    const paid = await (await fetch(`${baseUrl}/api/admin/orders?paymentStatus=Paid`)).json();
    assert.ok(paid.every(o => o.payment_status === 'Paid'));
  });

  it('filters by search term across name / email / product', async () => {
    await placeOrder(baseUrl, { fullName: 'Zebra Unique Name', email: 'zebra@example.com' });
    const hits = await (await fetch(`${baseUrl}/api/admin/orders?q=zebra`)).json();
    assert.ok(hits.length >= 1);
    assert.ok(hits.every(o => `${o.full_name} ${o.email}`.toLowerCase().includes('zebra')));
  });

  it('excludes orders outside the start/end date range', async () => {
    await placeOrder(baseUrl, { fullName: 'Today Order' });
    // A date range entirely in the past should return nothing placed today.
    const past = await (await fetch(`${baseUrl}/api/admin/orders?start=2000-01-01&end=2000-01-02`)).json();
    assert.equal(past.length, 0);
    // A wide range including today should include it.
    const wide = await (await fetch(`${baseUrl}/api/admin/orders?start=2000-01-01&end=2999-12-31`)).json();
    assert.ok(wide.some(o => o.full_name === 'Today Order'));
  });
});
