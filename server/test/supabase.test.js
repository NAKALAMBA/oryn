'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function freshSupabaseModule(env) {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, env);

  delete require.cache[require.resolve('../supabase')];
  const supabase = require('../supabase');

  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  delete require.cache[require.resolve('../supabase')];

  return supabase;
}

const SAMPLE_ORDER = { full_name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210', city: 'Gurgaon', subtotal: 800 };
const SAMPLE_ITEMS = [{ sku: 'AURELIA-BOX', name: 'Aurelia', price: 800, quantity: 1, details: 'Box of 6' }];

test('supabase: not configured without both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY', () => {
  assert.equal(freshSupabaseModule({}).configured(), false);
  assert.equal(freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co' }).configured(), false);
  assert.equal(freshSupabaseModule({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }).configured(), false);
});

test('supabase: configured once both are set', () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' });
  assert.equal(supabase.configured(), true);
});

test('supabase: createOrder() throws SupabaseUnavailableError when unconfigured', async () => {
  const supabase = freshSupabaseModule({});
  await assert.rejects(
    () => supabase.createOrder(SAMPLE_ORDER, SAMPLE_ITEMS),
    supabase.SupabaseUnavailableError
  );
});

test('supabase: createOrder() inserts the order, then its items referencing the returned uuid', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_key' });

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body), headers: opts.headers });
    if (String(url).includes('/orders')) {
      return { ok: true, status: 201, json: async () => [{ id: 'uuid-123', order_number: 42 }], text: async () => '' };
    }
    return { ok: true, status: 201, json: async () => [{ id: 'item-1' }], text: async () => '' };
  };

  try {
    const result = await supabase.createOrder(SAMPLE_ORDER, SAMPLE_ITEMS);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/orders');
    assert.equal(calls[0].headers.apikey, 'sb_secret_key');
    assert.equal(calls[0].headers.Authorization, 'Bearer sb_secret_key');
    assert.equal(calls[0].body[0].full_name, 'Priya Sharma');
    assert.equal(calls[0].body[0].payment_status, 'Pending');
    assert.equal(calls[0].body[0].final_payment, 800);

    assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/order_items');
    assert.equal(calls[1].body[0].order_id, 'uuid-123', 'items must reference the returned order uuid');
    assert.equal(calls[1].body[0].variant, 'Box of 6');

    assert.equal(result.id, 'uuid-123');
    assert.equal(result.order_number, 42);
  } finally {
    global.fetch = originalFetch;
  }
});

test('supabase: createOrder() skips the order_items call when there are no items', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_key' });

  let callCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => { callCount += 1; return { ok: true, status: 201, json: async () => [{ id: 'u', order_number: 1 }], text: async () => '' }; };

  try {
    await supabase.createOrder(SAMPLE_ORDER, []);
    assert.equal(callCount, 1, 'only the orders insert should fire');
  } finally {
    global.fetch = originalFetch;
  }
});

test('supabase: an HTTP failure surfaces as SupabaseUnavailableError', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_key' });
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid api key' });
  try {
    await assert.rejects(() => supabase.createOrder(SAMPLE_ORDER, SAMPLE_ITEMS), supabase.SupabaseUnavailableError);
  } finally {
    global.fetch = originalFetch;
  }
});

test('supabase: a network-level failure surfaces as SupabaseUnavailableError', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_key' });
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  try {
    await assert.rejects(() => supabase.createOrder(SAMPLE_ORDER, SAMPLE_ITEMS), supabase.SupabaseUnavailableError);
  } finally {
    global.fetch = originalFetch;
  }
});
