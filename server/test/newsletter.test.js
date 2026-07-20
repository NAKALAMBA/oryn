'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

describe('Newsletter API', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('rejects a signup missing an email', async () => {
    const res = await fetch(`${baseUrl}/api/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('subscribes a new email', async () => {
    const email = `subscriber-${Date.now()}@example.com`;
    const res = await fetch(`${baseUrl}/api/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, sourcePage: 'index.html' }),
    });
    assert.equal(res.status, 201);

    const list = await (await fetch(`${baseUrl}/api/admin/newsletter`)).json();
    assert.ok(list.some(n => n.email === email));
  });

  it('does not error or duplicate on a repeat signup of the same email', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const first = await fetch(`${baseUrl}/api/newsletter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const second = await fetch(`${baseUrl}/api/newsletter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201, 'a repeat signup should be silently ignored, not error');

    const list = await (await fetch(`${baseUrl}/api/admin/newsletter`)).json();
    const matches = list.filter(n => n.email === email);
    assert.equal(matches.length, 1, 'duplicate subscribe should not create a second row');
  });
});
