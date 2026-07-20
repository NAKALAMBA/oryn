'use strict';

const { test, describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

function freshEmailModule(env) {
  const previous = process.env.MSG91_AUTH_KEY;
  if (env.MSG91_AUTH_KEY === undefined) delete process.env.MSG91_AUTH_KEY;
  else process.env.MSG91_AUTH_KEY = env.MSG91_AUTH_KEY;

  delete require.cache[require.resolve('../email')];
  const email = require('../email');

  if (previous === undefined) delete process.env.MSG91_AUTH_KEY;
  else process.env.MSG91_AUTH_KEY = previous;
  delete require.cache[require.resolve('../email')];

  return email;
}

test('email: emailValidationConfigured() is false with no MSG91_AUTH_KEY', () => {
  const email = freshEmailModule({});
  assert.equal(email.emailValidationConfigured(), false);
});

test('email: emailValidationConfigured() is true once MSG91_AUTH_KEY is set', () => {
  const email = freshEmailModule({ MSG91_AUTH_KEY: 'test-key' });
  assert.equal(email.emailValidationConfigured(), true);
});

test('email: validateEmail() throws EmailValidationUnavailableError when unconfigured', async () => {
  const email = freshEmailModule({});
  await assert.rejects(() => email.validateEmail('a@example.com'), email.EmailValidationUnavailableError);
});

// Fixtures below mirror the real MSG91 v5 response shape, confirmed live
// against the actual API on 2026-07-15 (see email.js for the raw examples).

test('email: validateEmail() resolves valid:true for a deliverable address', async () => {
  const email = freshEmailModule({ MSG91_AUTH_KEY: 'test-key' });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: 'success',
      hasError: false,
      data: { result: { valid: true, result: 'deliverable', reason: 'ACCEPTED_EMAIL', is_disposable: false, is_free: true, is_role: false } },
    }),
  });

  try {
    const result = await email.validateEmail('real@example.com');
    assert.equal(result.valid, true);
    assert.equal(result.status, 'deliverable');
  } finally {
    global.fetch = originalFetch;
  }
});

test('email: validateEmail() resolves valid:false for an undeliverable address', async () => {
  const email = freshEmailModule({ MSG91_AUTH_KEY: 'test-key' });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: 'success',
      hasError: false,
      data: { result: { valid: true, result: 'undeliverable', reason: 'NO_MX', is_disposable: false, is_free: false, is_role: false } },
    }),
  });

  try {
    const result = await email.validateEmail('fake@nonexistent-domain-xyz.test');
    assert.equal(result.valid, false);
    assert.equal(result.status, 'undeliverable');
  } finally {
    global.fetch = originalFetch;
  }
});

test('email: validateEmail() does not block a "risky" or "unknown" verdict, only "undeliverable"', async () => {
  const email = freshEmailModule({ MSG91_AUTH_KEY: 'test-key' });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', hasError: false, data: { result: { valid: true, result: 'risky' } } }),
  });

  try {
    const result = await email.validateEmail('catch-all@example.com');
    assert.equal(result.valid, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('email: validateEmail() throws EmailValidationUnavailableError on an HTTP error, not a validity verdict', async () => {
  const email = freshEmailModule({ MSG91_AUTH_KEY: 'test-key' });

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ status: 'fail', hasError: true, errors: 'Unauthorized' }) });

  try {
    await assert.rejects(() => email.validateEmail('a@example.com'), email.EmailValidationUnavailableError);
  } finally {
    global.fetch = originalFetch;
  }
});

describe('POST /api/email/validate (no MSG91 key configured in test env)', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('fails open: reports checked:false, valid:true rather than blocking', async () => {
    const res = await fetch(`${baseUrl}/api/email/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.checked, false);
    assert.equal(body.valid, true);
  });

  it('rejects a missing email', async () => {
    const res = await fetch(`${baseUrl}/api/email/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});
