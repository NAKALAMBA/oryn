'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function freshSupabaseModule(env) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
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
const SAMPLE_ITEMS = [{ sku: 'AURELIA-BOX', name: 'Aurelia', price: 800, quantity: 1 }];

test('supabase: not configured without both SUPABASE_URL and SUPABASE_ANON_KEY', () => {
  assert.equal(freshSupabaseModule({}).supabaseConfigured(), false);
  assert.equal(freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co' }).supabaseConfigured(), false);
  assert.equal(freshSupabaseModule({ SUPABASE_ANON_KEY: 'key' }).supabaseConfigured(), false);
});

test('supabase: configured once both are set', () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'key' });
  assert.equal(supabase.supabaseConfigured(), true);
});

test('supabase: saveOrderToSupabase() throws SupabaseUnavailableError when unconfigured', async () => {
  const supabase = freshSupabaseModule({});
  await assert.rejects(
    () => supabase.saveOrderToSupabase(SAMPLE_ORDER, SAMPLE_ITEMS),
    supabase.SupabaseUnavailableError
  );
});

test('supabase: saveOrderToSupabase() inserts the order then its items, sharing one generated order id', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key' });

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, status: 201 };
  };

  try {
    const result = await supabase.saveOrderToSupabase(SAMPLE_ORDER, SAMPLE_ITEMS);
    assert.equal(calls.length, 2);

    assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/orders');
    assert.equal(calls[0].headers.apikey, 'anon-key');
    assert.equal(calls[0].headers.Authorization, 'Bearer anon-key');
    assert.equal(calls[0].body[0].id, result.supabaseOrderId);
    assert.equal(calls[0].body[0].full_name, 'Priya Sharma');
    assert.equal(calls[0].body[0].subtotal, 800);

    assert.equal(calls[1].url, 'https://x.supabase.co/rest/v1/order_items');
    assert.equal(calls[1].body[0].order_id, result.supabaseOrderId, 'order_items must reference the same generated order id');
    assert.equal(calls[1].body[0].sku, 'AURELIA-BOX');
  } finally {
    global.fetch = originalFetch;
  }
});

test('supabase: saveOrderToSupabase() skips the order_items call entirely when there are no items', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key' });

  let callCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => { callCount += 1; return { ok: true, status: 201 }; };

  try {
    await supabase.saveOrderToSupabase(SAMPLE_ORDER, []);
    assert.equal(callCount, 1, 'only the orders insert should fire, no order_items call');
  } finally {
    global.fetch = originalFetch;
  }
});

test('supabase: an HTTP failure surfaces as SupabaseUnavailableError', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key' });

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid api key' });

  try {
    await assert.rejects(
      () => supabase.saveOrderToSupabase(SAMPLE_ORDER, SAMPLE_ITEMS),
      supabase.SupabaseUnavailableError
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('supabase: a network-level failure surfaces as SupabaseUnavailableError', async () => {
  const supabase = freshSupabaseModule({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key' });

  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };

  try {
    await assert.rejects(
      () => supabase.saveOrderToSupabase(SAMPLE_ORDER, SAMPLE_ITEMS),
      supabase.SupabaseUnavailableError
    );
  } finally {
    global.fetch = originalFetch;
  }
});
