'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, uniquePhone } = require('./helpers');

describe('Event Registrations API', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('rejects a registration with no attendees', async () => {
    const res = await fetch(`${baseUrl}/api/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestCount: 0, attendees: [] }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects an attendee missing required fields', async () => {
    const res = await fetch(`${baseUrl}/api/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestCount: 1, attendees: [{ fullName: 'No Contact Info' }] }),
    });
    assert.equal(res.status, 400);
  });

  it('creates one row per attendee, all sharing the same group id', async () => {
    const phone1 = uniquePhone();
    const phone2 = uniquePhone();
    const res = await fetch(`${baseUrl}/api/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestCount: 2,
        attendees: [
          { fullName: 'Attendee One', email: 'one@example.com', phone: phone1, city: 'Noida' },
          { fullName: 'Attendee Two', email: 'two@example.com', phone: phone2, city: 'Noida' },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const { groupId, attendeeCount } = await res.json();
    assert.equal(attendeeCount, 2);

    const list = await (await fetch(`${baseUrl}/api/admin/registrations`)).json();
    const rows = list.filter(r => r.group_id === groupId);
    assert.equal(rows.length, 2, 'both attendees should be stored under the same group id');
    assert.deepEqual(rows.map(r => r.full_name).sort(), ['Attendee One', 'Attendee Two']);
  });
});
