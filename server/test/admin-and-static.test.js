'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

describe('Health, static site, and admin API endpoints', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('GET /api/health responds ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('serves the static site (order.html)', async () => {
    const res = await fetch(`${baseUrl}/order.html`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<title>Order/);
  });

  it('every admin read endpoint returns an array', async () => {
    const endpoints = ['orders', 'contacts', 'newsletter', 'registrations'];
    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}/api/admin/${ep}`);
      assert.equal(res.status, 200, `/api/admin/${ep} should respond 200`);
      const body = await res.json();
      assert.ok(Array.isArray(body), `/api/admin/${ep} should return an array`);
    }
  });

  it('sends permissive CORS headers so a separately-deployed dashboard can read the API', async () => {
    const res = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { Origin: 'https://some-other-deployment.example.com' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
