'use strict';

// Production-like: Supabase configured, but NO ADMIN_PASSWORD and NOT in
// test-open mode. The admin API must FAIL CLOSED — never serve customer
// data unauthenticated.
delete process.env.ADMIN_PASSWORD;
delete process.env.ORYN_ADMIN_OPEN;
process.env.ORYN_TEST = '0';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.MSG91_AUTH_KEY = '';
process.env.SHIPROCKET_EMAIL = '';

const fakeSupabase = require('./fake-supabase');
fakeSupabase.install();

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Admin API fails closed when ADMIN_PASSWORD is unset in production', () => {
  let server, baseUrl;

  before(async () => {
    fakeSupabase.reset();
    const app = require('../server');
    await new Promise(resolve => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });
  after(() => server.close());

  it('blocks GET /api/admin/orders with 503', async () => {
    const res = await fetch(`${baseUrl}/api/admin/orders`);
    assert.equal(res.status, 503);
  });

  it('login reports that admin access is not configured', async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'anything' }),
    });
    assert.equal(res.status, 503);
  });

  it('still accepts a public newsletter signup (not an admin route)', async () => {
    const res = await fetch(`${baseUrl}/api/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Open Test', email: `open-${Date.now()}@example.com` }),
    });
    assert.equal(res.status, 201);
  });
});
