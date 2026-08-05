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

  it('GET /api/catalog/products matches the Shopify-style shape Shiprocket expects', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/products`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.data.total, 17);
    assert.equal(body.data.products.length, 17);

    const sample = body.data.products.find(p => p.variants[0].sku === 'AURELIA-BOX');
    assert.ok(sample);
    assert.equal(typeof sample.id, 'number');
    assert.equal(sample.title, 'Aurelia');
    assert.equal(sample.vendor, 'Oryn');
    assert.equal(sample.product_type, 'Cookie Collection');
    assert.equal(sample.status, 'active');
    assert.ok(sample.handle, 'should have a handle (url slug)');
    assert.ok(sample.image && sample.image.src.startsWith('http'), 'product should have a single `image` object, not an `images` array');

    assert.equal(sample.variants.length, 1);
    const variant = sample.variants[0];
    assert.equal(typeof variant.id, 'number');
    assert.equal(variant.price, '800.00');
    assert.equal(variant.sku, 'AURELIA-BOX');
    assert.equal(typeof variant.quantity, 'number');
    assert.equal(variant.taxable, true);
    assert.ok(variant.image && variant.image.src.startsWith('http'), 'each variant must carry its own `image`, or Checkout reports "No product image found for variant"');
    assert.equal(variant.image.src, sample.image.src);
  });

  it('GET /api/catalog/collections returns each collection with an accurate product count', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/collections`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.total, 5);

    const cookieCollection = body.data.collections.find(c => c.handle === 'cookie-collection');
    assert.ok(cookieCollection);
    assert.equal(cookieCollection.title, 'Cookie Collection');
    assert.equal(cookieCollection.products_count, 3);
    assert.ok(cookieCollection.image && cookieCollection.image.src.startsWith('http'), 'collection should have a single `image` object');

    const total = body.data.collections.reduce((sum, c) => sum + c.products_count, 0);
    assert.equal(total, 17, 'every product should belong to exactly one collection');
  });

  it('GET /api/catalog/collections/:id/products filters correctly', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/collections/best-sellers/products`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.total, 2);
    assert.ok(body.data.products.every(p => p.product_type === 'Best Sellers'));
  });

  it('GET /api/catalog/collections/:id/products returns 404 for an unknown collection', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/collections/not-a-real-collection/products`);
    assert.equal(res.status, 404);
  });

  it('GET /api/catalog/products?collection_id=<handle> filters by collection', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/products?collection_id=best-sellers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.total, 2);
    assert.ok(body.data.products.every(p => p.product_type === 'Best Sellers'));
  });

  it('GET /api/catalog/products?collection_id=<numeric id> filters by collection', async () => {
    const collections = await (await fetch(`${baseUrl}/api/catalog/collections`)).json();
    const cookieCollection = collections.data.collections.find(c => c.handle === 'cookie-collection');

    const res = await fetch(`${baseUrl}/api/catalog/products?collection_id=${cookieCollection.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.total, 3);
    assert.ok(body.data.products.every(p => p.product_type === 'Cookie Collection'));
  });

  it('GET /api/catalog/products?collection_id=<unknown> returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/products?collection_id=not-a-real-collection`);
    assert.equal(res.status, 404);
  });

  it('GET /api/catalog/collections ignores collection_id and always returns the full list (it is a separate endpoint from Products-by-Collection)', async () => {
    const res = await fetch(`${baseUrl}/api/catalog/collections?collection_id=best-sellers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.total, 5, 'Collections API should always list every collection, regardless of any collection_id passed');
  });
});
