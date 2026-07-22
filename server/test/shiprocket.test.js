'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function freshShiprocketModule(env) {
  const keys = [
    'SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD', 'SHIPROCKET_PICKUP_LOCATION',
    'SHIPROCKET_CHANNEL_ID', 'SHIPROCKET_PAYMENT_METHOD',
    'SHIPROCKET_DEFAULT_WEIGHT_KG', 'SHIPROCKET_DEFAULT_LENGTH_CM',
    'SHIPROCKET_DEFAULT_BREADTH_CM', 'SHIPROCKET_DEFAULT_HEIGHT_CM',
  ];
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, env);

  delete require.cache[require.resolve('../shiprocket')];
  const shiprocket = require('../shiprocket');

  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  delete require.cache[require.resolve('../shiprocket')];

  return shiprocket;
}

const SAMPLE_ORDER = { id: 42, full_name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210', address: '123 MG Road', city: 'Gurgaon', pin_code: '122001', state: 'Haryana', subtotal: 1600 };
const SAMPLE_ITEMS = [
  { id: 1, sku: 'COOKIE-MIX', name: 'Classic Box of 6', price: 800, quantity: 2 },
];

test('shiprocket: not configured without email/password/pickup location', () => {
  const shiprocket = freshShiprocketModule({});
  assert.equal(shiprocket.shiprocketConfigured(), false);
});

test('shiprocket: configured once email, password, and pickup location are all set', () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });
  assert.equal(shiprocket.shiprocketConfigured(), true);
});

test('shiprocket: createShiprocketOrder() throws ShiprocketUnavailableError when unconfigured', async () => {
  const shiprocket = freshShiprocketModule({});
  await assert.rejects(
    () => shiprocket.createShiprocketOrder(SAMPLE_ORDER, SAMPLE_ITEMS),
    shiprocket.ShiprocketUnavailableError
  );
});

test('shiprocket: createShiprocketOrder() throws when there are no items', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });
  await assert.rejects(
    () => shiprocket.createShiprocketOrder(SAMPLE_ORDER, []),
    shiprocket.ShiprocketUnavailableError
  );
});

test('shiprocket: createShiprocketOrder() logs in then creates the order, returning the mapped result', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (String(url).includes('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok_123' }) };
    }
    if (String(url).includes('/orders/create/adhoc')) {
      const body = JSON.parse(opts.body);
      assert.equal(body.pickup_location, 'Main Warehouse');
      assert.match(body.order_id, /^ORYN-42-\d+$/);
      assert.equal(body.billing_customer_name, 'Priya');
      assert.equal(body.billing_last_name, 'Sharma');
      assert.equal(body.shipping_is_billing, true);
      assert.equal(body.order_items.length, 1);
      assert.equal(body.order_items[0].units, 2);
      assert.equal(body.order_items[0].selling_price, 800);
      assert.equal(opts.headers.Authorization, 'Bearer tok_123');
      return { ok: true, status: 200, json: async () => ({ order_id: 999, shipment_id: 555, status: 'NEW' }) };
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  try {
    const result = await shiprocket.createShiprocketOrder(SAMPLE_ORDER, SAMPLE_ITEMS);
    assert.deepEqual(result, { shiprocketOrderId: '999', shipmentId: '555', status: 'NEW' });
    assert.equal(calls.filter(c => String(c.url).includes('/auth/login')).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: two orders sharing the same local row id (e.g. after a database reset on ephemeral storage) get DIFFERENT Shiprocket order_ids', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const sentOrderIds = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok_123' }) };
    }
    sentOrderIds.push(JSON.parse(opts.body).order_id);
    return { ok: true, status: 200, json: async () => ({ order_id: sentOrderIds.length, shipment_id: sentOrderIds.length + 100, status: 'NEW' }) };
  };

  try {
    // Same order.id (1) on both calls — simulates two different customers'
    // orders landing on row id 1 across separate ephemeral-database resets.
    await shiprocket.createShiprocketOrder({ ...SAMPLE_ORDER, id: 1 }, SAMPLE_ITEMS);
    await new Promise(r => setTimeout(r, 2));
    await shiprocket.createShiprocketOrder({ ...SAMPLE_ORDER, id: 1 }, SAMPLE_ITEMS);

    assert.equal(sentOrderIds.length, 2);
    assert.notEqual(sentOrderIds[0], sentOrderIds[1], 'Shiprocket order_id must differ even when the local row id repeats');
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: reuses the cached token across calls instead of logging in again', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  let loginCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).includes('/auth/login')) {
      loginCalls += 1;
      return { ok: true, status: 200, json: async () => ({ token: 'tok_abc' }) };
    }
    return { ok: true, status: 200, json: async () => ({ order_id: 1, shipment_id: 2, status: 'NEW' }) };
  };

  try {
    await shiprocket.createShiprocketOrder(SAMPLE_ORDER, SAMPLE_ITEMS);
    await shiprocket.createShiprocketOrder(SAMPLE_ORDER, SAMPLE_ITEMS);
    assert.equal(loginCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: login failure surfaces as ShiprocketUnavailableError', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'wrong',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Invalid credentials' }) });

  try {
    await assert.rejects(
      () => shiprocket.createShiprocketOrder(SAMPLE_ORDER, SAMPLE_ITEMS),
      shiprocket.ShiprocketUnavailableError
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: order-creation API failure surfaces as ShiprocketUnavailableError', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).includes('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok_123' }) };
    }
    return { ok: false, status: 422, json: async () => ({ message: 'pickup_location invalid' }) };
  };

  try {
    await assert.rejects(
      () => shiprocket.createShiprocketOrder(SAMPLE_ORDER, SAMPLE_ITEMS),
      shiprocket.ShiprocketUnavailableError
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: trackShipment() resolves "Not yet dispatched" without calling the API when there is no shipment id', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('should not be called'); };

  try {
    const result = await shiprocket.trackShipment(null);
    assert.deepEqual(result, { status: 'Not yet dispatched', activities: [] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: trackShipment() parses a live status and activity log', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).includes('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok_123' }) };
    }
    assert.ok(String(url).includes('/courier/track/shipment/555'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tracking_data: {
          shipment_track: [{ current_status: 'In Transit' }],
          shipment_track_activities: [{ date: '2026-07-20', status: 'Out for delivery', location: 'Delhi' }],
        },
      }),
    };
  };

  try {
    const result = await shiprocket.trackShipment('555');
    assert.equal(result.status, 'In Transit');
    assert.deepEqual(result.activities, [{ date: '2026-07-20', status: 'Out for delivery', location: 'Delhi' }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: trackShipment() treats a 404 (no AWB assigned yet) as "Not yet dispatched", not an error', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).includes('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok_123' }) };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
  };

  try {
    const result = await shiprocket.trackShipment('999');
    assert.deepEqual(result, { status: 'Not yet dispatched', activities: [] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('shiprocket: trackShipment() surfaces a real (non-404) API failure as ShiprocketUnavailableError', async () => {
  const shiprocket = freshShiprocketModule({
    SHIPROCKET_EMAIL: 'api@example.com',
    SHIPROCKET_PASSWORD: 'secret',
    SHIPROCKET_PICKUP_LOCATION: 'Main Warehouse',
  });

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).includes('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok_123' }) };
    }
    return { ok: false, status: 500, json: async () => ({ message: 'server error' }) };
  };

  try {
    await assert.rejects(() => shiprocket.trackShipment('555'), shiprocket.ShiprocketUnavailableError);
  } finally {
    global.fetch = originalFetch;
  }
});
