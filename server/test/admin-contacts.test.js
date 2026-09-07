'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uniquePhone } = require('./helpers');

async function sendContact(baseUrl, over = {}) {
  const res = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: over.fullName || 'Query Sender',
      email: over.email || 'ask@example.com',
      phone: over.phone || uniquePhone(),
      subject: over.subject || 'A question',
      message: over.message || 'How long does delivery take?',
    }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}

describe('Admin messages — answered flag', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('lists a submitted contact message', async () => {
    const id = await sendContact(baseUrl, { subject: 'Unique subject XYZ' });
    const list = await (await fetch(`${baseUrl}/api/admin/contacts`)).json();
    const row = list.find(m => m.id === id);
    assert.ok(row, 'message should appear in the admin listing');
    assert.equal(row.subject, 'Unique subject XYZ');
  });

  it('marks a message answered, stamping answered_at, then back to not-answered', async () => {
    const id = await sendContact(baseUrl);

    let res = await fetch(`${baseUrl}/api/admin/contacts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answered: true }),
    });
    assert.equal(res.status, 200);
    let updated = await res.json();
    assert.equal(updated.answered, true);
    assert.ok(updated.answered_at, 'answered_at is set when marked answered');

    res = await fetch(`${baseUrl}/api/admin/contacts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answered: false }),
    });
    updated = await res.json();
    assert.equal(updated.answered, false);
    assert.equal(updated.answered_at, null, 'answered_at is cleared when un-marked');
  });

  it('rejects a non-boolean answered value', async () => {
    const id = await sendContact(baseUrl);
    const res = await fetch(`${baseUrl}/api/admin/contacts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answered: 'yes' }),
    });
    assert.equal(res.status, 400);
  });

  it('404s for an unknown message id', async () => {
    const res = await fetch(`${baseUrl}/api/admin/contacts/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answered: true }),
    });
    assert.equal(res.status, 404);
  });
});
