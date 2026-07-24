'use strict';

// Canonical product/collection data for the catalog API (Products,
// Collections, Products-by-Collection — built for the Shiprocket Checkout
// "SRC Custom Integration" requirements). Mirrors PRODUCT_CATALOG in
// js/main.js (the site's existing single list of every orderable product,
// already used there for the cart drawer's "You May Also Like").
//
// Response shape confirmed directly against the real "SRC Custom
// Integration" example response (Shopify's own Product API shape —
// {data:{total,products:[{id,title,body_html,vendor,product_type,
// handle,tags,status,variants:[{id,title,price,sku,quantity,...}]}]}}).
// Every orderable product here has exactly one variant, since none of
// Oryn's products have real Shopify-style options (color/size, etc.).

const SITE_DOMAIN = process.env.PUBLIC_SITE_URL || 'https://orynpatisserie.in';
const VENDOR = 'Oryn';
// Static products, no per-item created/updated tracking — one fixed
// timestamp for the whole catalog is more honest than a fake per-call one.
const CATALOG_TIMESTAMP = '2026-01-01T00:00:00+05:30';

// [sku, name, price, collectionName, unitLabel, href, image]
const PRODUCTS = [
  ['CSB-150', 'Citrus Spice Bloom', 600, 'A Delhi Love Story', 'Box of 4', 'muffin-citrus-spice-bloom.html', 'All Product Images/Malabar Gold Éclair/1.png'],
  ['ML-150', 'Mace Latte', 600, 'A Delhi Love Story', 'Box of 4', 'muffin-mace-latte.html', 'All Product Images/Apricus Bento Cake/1.png'],
  ['MB-180', 'Matcha Butterscotch', 720, 'A Delhi Love Story', 'Box of 4', 'muffin-matcha-butterscotch.html', 'All Product Images/Saanjh/1.png'],
  ['SCE-150', 'Spiced Cocoa Ember', 600, 'A Delhi Love Story', 'Box of 4', 'muffin-spiced-cocoa-ember.html', 'All Product Images/Nolen Halo Cupcake/1.png'],
  ['SCP-180', 'Salted Caramel Power Crunch', 720, 'A Delhi Love Story', 'Box of 4', 'muffin-salted-caramel.html', 'All Product Images/Banana Cookie Melt Loaf/1.png'],
  ['AURELIA-BOX', 'Aurelia', 800, 'Cookie Collection', 'Box of 6', 'cookie-aurelia.html', 'All Product Images/All Cookies/Aurelia Cookies/2.png'],
  ['JADECARAMEL-BOX', 'Jade Caramel', 800, 'Cookie Collection', 'Box of 6', 'cookie-jade-caramel.html', 'All Product Images/All Cookies/Oryn - Invitation-12.png'],
  ['CLOUDCRUMB-BOX', 'Cloud Crumb', 800, 'Cookie Collection', 'Box of 6', 'cookie-cloud-crumb.html', 'All Product Images/All Cookies/Oryn - Invitation-17.png'],
  ['ACC-500', 'Almond Cinnamon Cookies', 500, 'WOH DIN - Yaad Hai?', 'Pack of 4', 'almond-cinnamon-cookies.html', 'All Product Images/Almond Cinnamon Cookies/1.jpg'],
  ['ACB-500', 'Almond Chocolate Biscotti', 500, 'WOH DIN - Yaad Hai?', 'Pack of 6', 'almond-chocolate-biscotti.html', 'All Product Images/Almond Chocolate Biscotti/1.jpg'],
  ['ANTC-600', 'Almond & Nuts Tea Cake', 600, 'WOH DIN - Yaad Hai?', '1 loaf', 'almond-nuts-tea-cake.html', 'All Product Images/Almond Nuts Tea Cake/1.jpg'],
  ['DCAB-400', 'Dark Chocolate Almond Bars', 400, 'WOH DIN - Yaad Hai?', 'Pack of 4', 'dark-chocolate-almond-bars.html', 'All Product Images/Dark Chocolate Almond Bars/1.jpg'],
  ['MALABAR-ECL', 'Malabar Gold Éclair', 600, 'Flavours of India', 'Set of 3', 'eclair-malabar-gold.html', 'All Product Images/Malabar Gold Éclair/1.png'],
  ['NOLEN-CUP', 'Nolen Halo Cupcake', 600, 'Flavours of India', 'Set of 4', 'cupcake-nolen-halo.html', 'All Product Images/Nolen Halo Cupcake/1.png'],
  ['APRICUS-BENTO', 'Apricus Bento Cake', 450, 'Flavours of India', '1 box', 'bento-apricus.html', 'All Product Images/Apricus Bento Cake/1.png'],
  ['SAANJH-BOX', 'Saanjh', 400, 'Best Sellers', 'Box of 6', 'saanjh.html', 'All Product Images/Saanjh/1.png'],
  ['BCM-350', 'Banana Cookie Melt', 350, 'Best Sellers', '350g', 'banana-cookie-melt.html', 'All Product Images/Banana Cookie Melt Loaf/1.png'],
];

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function absoluteUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_DOMAIN}/${encodeURI(pathOrUrl)}`;
}

// Stable numeric ids derived from list position (1-indexed) — the example
// response uses large numeric ids (Shopify's real ones), but nothing in
// the shown shape depends on any particular magnitude, only that id is a
// number. Variant ids are offset so they never collide with product ids.
function toProduct([sku, name, price, collectionName, unitLabel, href, image], index) {
  const productId = index + 1;
  return {
    id: productId,
    title: name,
    body_html: `<p>${name} — ${unitLabel}</p>`,
    vendor: VENDOR,
    product_type: collectionName,
    created_at: CATALOG_TIMESTAMP,
    handle: href.replace(/\.html$/, ''),
    updated_at: CATALOG_TIMESTAMP,
    tags: unitLabel,
    status: 'active',
    images: [{ src: absoluteUrl(image) }],
    variants: [
      {
        id: 100000 + productId,
        title: 'Default Title',
        price: price.toFixed(2),
        compare_at_price: null,
        sku,
        quantity: 999,
        created_at: CATALOG_TIMESTAMP,
        updated_at: CATALOG_TIMESTAMP,
        taxable: true,
        option_values: { Title: 'Default Title' },
      },
    ],
  };
}

function getAllProducts() {
  return PRODUCTS.map(toProduct);
}

function getAllCollections() {
  const byName = new Map();
  PRODUCTS.forEach((row, index) => {
    const collectionName = row[3];
    if (!byName.has(collectionName)) {
      byName.set(collectionName, {
        id: byName.size + 1,
        title: collectionName,
        handle: slugify(collectionName),
        body_html: '',
        updated_at: CATALOG_TIMESTAMP,
        products_count: 0,
      });
    }
    byName.get(collectionName).products_count += 1;
  });
  return Array.from(byName.values());
}

// Returns null if the collection handle doesn't exist (distinct from an
// empty array, so callers can tell "unknown collection" apart from "no
// products in this real collection").
function getProductsByCollection(collectionHandle) {
  const collection = getAllCollections().find(c => c.handle === collectionHandle);
  if (!collection) return null;
  return getAllProducts().filter(p => p.product_type === collection.title);
}

module.exports = { getAllProducts, getAllCollections, getProductsByCollection };
