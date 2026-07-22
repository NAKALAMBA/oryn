'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

describe('Catalog API (Products / Collections)', () => {
  let server, baseUrl;

  before(async () => {
    ({ server, baseUrl } = await startServer());
  });
  after(() => server.close());

  it('GET /api/catalog/products returns every product with the expected fields', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/products`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.products.length, 17);
    const sample = body.products.find(p => p.sku === 'AURELIA-BOX');
    assert.ok(sample);
    assert.equal(sample.name, 'Aurelia');
    assert.equal(sample.price, 800);
    assert.equal(sample.currency, 'INR');
    assert.equal(sample.collection_id, 'cookie-collection');
    assert.ok(sample.image.startsWith('http'), 'image should be an absolute URL');
    assert.ok(sample.url.startsWith('http'), 'url should be an absolute URL');
  });

  it('GET /api/catalog/collections returns each collection with an accurate product count', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/collections`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const cookieCollection = body.collections.find(c => c.id === 'cookie-collection');
    assert.ok(cookieCollection);
    assert.equal(cookieCollection.name, 'Cookie Collection');
    assert.equal(cookieCollection.product_count, 3);

    const total = body.collections.reduce((sum, c) => sum + c.product_count, 0);
    assert.equal(total, 17, 'every product should belong to exactly one collection');
  });

  it('GET /api/catalog/collections/:id/products filters correctly', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/collections/best-sellers/products`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.products.length, 2);
    assert.ok(body.products.every(p => p.collection_id === 'best-sellers'));
  });

  it('GET /api/catalog/collections/:id/products returns 404 for an unknown collection', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/collections/not-a-real-collection/products`);
    assert.equal(res.status, 404);
  });
});
