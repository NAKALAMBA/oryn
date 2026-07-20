'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uniquePhone } = require('./helpers');

describe('Contact API', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('rejects a message missing required fields', async () => {
    const res = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: '', email: '', phone: '', message: '' }),
    });
    assert.equal(res.status, 400);
  });

  it('stores a valid contact message', async () => {
    const phone = uniquePhone();
    const res = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Jane Doe', email: 'jane@example.com', phone,
        subject: 'General Enquiry', message: 'Just testing the contact form.',
      }),
    });
    assert.equal(res.status, 201);
    const { id } = await res.json();

    const list = await (await fetch(`${baseUrl}/api/admin/contacts`)).json();
    const created = list.find(c => c.id === id);
    assert.ok(created, 'message should appear in the admin listing');
    assert.equal(created.full_name, 'Jane Doe');
    assert.equal(created.message, 'Just testing the contact form.');
  });
});
