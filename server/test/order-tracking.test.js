'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uniquePhone } = require('./helpers');

describe('POST /api/orders/track', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  async function placeOrder(phone) {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Track Test',
        email: 'track@example.com',
        phone,
        city: 'Pune',
        cartItems: [{ sku: 'A', name: 'Classic Box of 6', price: 800, quantity: 2 }],
      }),
    });
    return res.json();
  }

  it('rejects a request missing orderId or phone', async () => {
    const res = await fetch(`${baseUrl}/api/orders/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: '', phone: '' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 404 for a non-existent order id', async () => {
    const res = await fetch(`${baseUrl}/api/orders/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 999999, phone: '9876543210' }),
    });
    assert.equal(res.status, 404);
  });

  it('returns 404 when the order exists but the phone does not match (prevents enumeration)', async () => {
    const phone = uniquePhone();
    const { id } = await placeOrder(phone);

    const res = await fetch(`${baseUrl}/api/orders/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id, phone: uniquePhone() }),
    });
    assert.equal(res.status, 404);
  });

  it('returns the order summary and "Not yet dispatched" status for a matching id + phone', async () => {
    const phone = uniquePhone();
    const { id, subtotal } = await placeOrder(phone);

    const res = await fetch(`${baseUrl}/api/orders/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id, phone }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, id);
    assert.equal(body.subtotal, subtotal);
    assert.equal(body.city, 'Pune');
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].name, 'Classic Box of 6');
    assert.equal(body.items[0].quantity, 2);
    assert.equal(body.tracking.status, 'Not yet dispatched');
  });

  it('matches phone numbers regardless of +91/0 prefix formatting', async () => {
    const phone = uniquePhone();
    const { id } = await placeOrder(phone);

    const res = await fetch(`${baseUrl}/api/orders/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: id, phone: `+91 ${phone}` }),
    });
    assert.equal(res.status, 200);
  });
});
