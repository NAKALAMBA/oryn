'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uniquePhone } = require('./helpers');

async function register(baseUrl, over = {}) {
  const res = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guestCount: 1,
      eventName: over.eventName || 'The Oryn Table — Noida',
      eventLocation: over.eventLocation || 'Noida',
      eventDate: over.eventDate || '2026-07-26',
      attendees: [{
        fullName: over.fullName || 'RSVP Guest',
        email: over.email || 'guest@example.com',
        phone: over.phone || uniquePhone(),
        city: over.city || 'Noida',
      }],
    }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).groupId;
}

async function firstRegistration(baseUrl, groupId) {
  const list = await (await fetch(`${baseUrl}/api/admin/registrations`)).json();
  return list.find(r => r.group_id === groupId);
}

describe('Admin Oryn Table — registrations', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('stores event location + date and defaults both statuses to Pending', async () => {
    const groupId = await register(baseUrl, { eventLocation: 'Noida', eventDate: '2026-07-26' });
    const row = await firstRegistration(baseUrl, groupId);
    assert.ok(row, 'registration should be listed');
    assert.equal(row.event_location, 'Noida');
    assert.equal(row.event_date, '2026-07-26');
    assert.equal(row.rsvp_status, 'Pending');
    assert.equal(row.payment_status, 'Pending');
  });

  it('sets the RSVP status', async () => {
    const groupId = await register(baseUrl);
    const row = await firstRegistration(baseUrl, groupId);

    const res = await fetch(`${baseUrl}/api/admin/registrations/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rsvp_status: 'Confirmed' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).rsvp_status, 'Confirmed');
  });

  it('sets the payment status', async () => {
    const groupId = await register(baseUrl);
    const row = await firstRegistration(baseUrl, groupId);

    const res = await fetch(`${baseUrl}/api/admin/registrations/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: 'Paid' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).payment_status, 'Paid');
  });

  it('rejects an invalid rsvp_status', async () => {
    const groupId = await register(baseUrl);
    const row = await firstRegistration(baseUrl, groupId);
    const res = await fetch(`${baseUrl}/api/admin/registrations/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rsvp_status: 'Maybe' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects an invalid payment_status', async () => {
    const groupId = await register(baseUrl);
    const row = await firstRegistration(baseUrl, groupId);
    const res = await fetch(`${baseUrl}/api/admin/registrations/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: 'Later' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects a patch with nothing to update', async () => {
    const groupId = await register(baseUrl);
    const row = await firstRegistration(baseUrl, groupId);
    const res = await fetch(`${baseUrl}/api/admin/registrations/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('404s for an unknown registration id', async () => {
    const res = await fetch(`${baseUrl}/api/admin/registrations/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rsvp_status: 'Confirmed' }),
    });
    assert.equal(res.status, 404);
  });
});
