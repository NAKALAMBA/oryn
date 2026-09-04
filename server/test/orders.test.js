'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uniquePhone } = require('./helpers');

describe('Orders API', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('rejects an order missing required fields', async () => {
    const phone = uniquePhone();
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: '', email: '', phone, city: '' }),
    });
    assert.equal(res.status, 400);
  });

  it('creates an order, computes the subtotal, and links order_items', async () => {
    const phone = uniquePhone();

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Priya Sharma',
        email: 'priya@example.com',
        phone,
        city: 'Gurgaon',
        deliveryDate: '2026-08-01',
        product: 'Classic Box of 6',
        quantityDetails: '2 boxes',
        giftMessage: '',
        cartSummary: '1 x Classic Box - 800',
        cartItems: [
          { sku: 'COOKIE-MIX', name: 'Classic Box of 6', price: 800, quantity: 2, details: 'x' },
          { sku: 'SAANJH-BOX', name: 'Saanjh', price: 400, quantity: 1, details: 'y' },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.subtotal, 800 * 2 + 400 * 1);

    const orders = await (await fetch(`${baseUrl}/api/admin/orders`)).json();
    const created = orders.find(o => o.id === body.id);
    assert.ok(created, 'order should appear in the admin listing');
    assert.equal(created.full_name, 'Priya Sharma');
    assert.equal(created.items.length, 2);
    assert.equal(created.shiprocket_status, 'failed', 'Shiprocket is unconfigured in tests, so sync should fail without blocking the order');
    assert.match(created.shiprocket_error, /not configured/i);
  });

  it('starts every order Pending / unpaid, with shipping blank and final payment = subtotal', async () => {
    const phone = uniquePhone();
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Meera Nair', email: 'meera@example.com', phone, city: 'Kochi',
        cartItems: [{ sku: 'SAANJH-BOX', name: 'Saanjh', price: 400, quantity: 3, details: 'Box of 6' }],
      }),
    });
    assert.equal(res.status, 201);
    const { id } = await res.json();

    const orders = await (await fetch(`${baseUrl}/api/admin/orders`)).json();
    const created = orders.find(o => String(o.id) === String(id));
    assert.ok(created, 'order should appear in the admin listing');
    assert.equal(created.order_status, 'Pending');
    assert.equal(created.payment_status, 'Pending');
    assert.equal(created.discount, 0);
    assert.equal(created.shipping, null, 'shipping stays blank until an admin enters it');
    assert.equal(created.subtotal, 1200);
    assert.equal(created.final_payment, 1200, 'final payment starts equal to the subtotal');
    assert.equal(created.items[0].variant, 'Box of 6', 'the cart item detail is stored as the line variant');
  });

  it('stores the full billing address (address, state, city, pin code) and every customer detail from checkout', async () => {
    const phone = uniquePhone();

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Rahul Verma',
        email: 'rahul@example.com',
        phone,
        address: 'C3-1106, Sheth Midori',
        state: 'Maharashtra',
        city: 'Thane',
        pinCode: '400607',
        deliveryDate: '2026-07-23',
        giftMessage: 'Ring the bell twice',
        cartSummary: '1 x Classic Box of 6 - 800',
        cartItems: [
          { sku: 'COOKIE-MIX', name: 'Classic Box of 6', price: 800, quantity: 1, details: 'Cookie Collection' },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.subtotal, 800, 'total order value should be stored correctly');

    const orders = await (await fetch(`${baseUrl}/api/admin/orders`)).json();
    const created = orders.find(o => o.id === body.id);
    assert.ok(created, 'order should be visible in the dashboard');
    assert.equal(created.full_name, 'Rahul Verma');
    assert.equal(created.email, 'rahul@example.com');
    assert.equal(created.phone, phone);
    assert.equal(created.address, 'C3-1106, Sheth Midori');
    assert.equal(created.state, 'Maharashtra');
    assert.equal(created.city, 'Thane');
    assert.equal(created.pin_code, '400607');
    assert.equal(created.gift_message, 'Ring the bell twice');
    assert.equal(created.subtotal, 800);
    assert.equal(created.items.length, 1);
    assert.equal(created.items[0].name, 'Classic Box of 6');
    assert.equal(created.items[0].price, 800);
    assert.equal(created.items[0].quantity, 1);
  });

  it('excludes cart items with an empty name from both storage and the subtotal', async () => {
    const phone = uniquePhone();

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'X', email: 'x@example.com', phone, city: 'Delhi',
        cartItems: [
          { sku: '', name: '', price: 9999, quantity: 1 },
          { sku: 'A', name: 'Valid Item', price: 50, quantity: 2 },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.subtotal, 100, 'subtotal should only count the named item (50 x 2)');

    const orders = await (await fetch(`${baseUrl}/api/admin/orders`)).json();
    const created = orders.find(o => o.id === body.id);
    assert.equal(created.items.length, 1, 'the empty-name item should not be stored');
    assert.equal(created.items[0].name, 'Valid Item');
  });

  it('defaults quantity to 1 when a cart item omits it, consistently in subtotal and storage', async () => {
    const phone = uniquePhone();

    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Y', email: 'y@example.com', phone, city: 'Noida',
        cartItems: [{ sku: 'B', name: 'No Quantity Given', price: 200 }],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.subtotal, 200, 'a missing quantity should be treated as 1, not 0');

    const orders = await (await fetch(`${baseUrl}/api/admin/orders`)).json();
    const created = orders.find(o => o.id === body.id);
    assert.equal(created.items[0].quantity, 1, 'stored line item should also default quantity to 1');
  });
});
