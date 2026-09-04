'use strict';

// Set the admin password BEFORE anything requires ../server / ../auth.
process.env.ADMIN_PASSWORD = 'test-secret-pw';
process.env.ADMIN_TOKEN_SECRET = 'test-token-secret-xxxxxxxxxxxxxxxx';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

describe('Admin auth', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('rejects the wrong password', async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    assert.equal(res.status, 401);
  });

  it('issues a token for the correct password', async () => {
    const res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-secret-pw' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.token === 'string' && body.token.includes('.'), 'should return a signed token');
  });

  it('blocks an admin endpoint without a token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/orders`);
    assert.equal(res.status, 401);
  });

  it('blocks an admin endpoint with a garbage token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { Authorization: 'Bearer not.a.real.token' },
    });
    assert.equal(res.status, 401);
  });

  it('allows an admin endpoint with a valid token', async () => {
    const login = await (await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-secret-pw' }),
    })).json();

    const res = await fetch(`${baseUrl}/api/admin/orders`, {
      headers: { Authorization: `Bearer ${login.token}` },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  });
});
