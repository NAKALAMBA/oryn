'use strict';

// Canonical product/collection data for the catalog API (Products,
// Collections, Products-by-Collection — built for the Shiprocket Checkout
// "SRC Custom Integration" requirements). Mirrors PRODUCT_CATALOG in
// js/main.js (the site's existing single list of every orderable product,
// already used there for the cart drawer's "You May Also Like").
//
// IMPORTANT: this response shape is a best-effort, standard e-commerce API
// design (id/sku/name/price/images/collection) — it was NOT built against
// Shiprocket's actual published contract, because that page (a Postman
// "SRC Custom Integration" doc) is JS-rendered and couldn't be read by any
// available tool. If Shiprocket's real spec uses different field names,
// only PRODUCTS below and the two mapping functions need to change —
// nothing else in server.js depends on this shape.

const SITE_DOMAIN = process.env.PUBLIC_SITE_URL || 'https://orynpatisserie.in';

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

function toProduct([sku, name, price, collectionName, unitLabel, href, image]) {
  return {
    id: sku,
    sku,
    name,
    description: `${name} — ${unitLabel}`,
    price,
    currency: 'INR',
    unit: unitLabel,
    image: absoluteUrl(image),
    url: absoluteUrl(href),
    collection_id: slugify(collectionName),
    collection_name: collectionName,
    in_stock: true,
  };
}

function getAllProducts() {
  return PRODUCTS.map(toProduct);
}

function getAllCollections() {
  const byId = new Map();
  for (const row of PRODUCTS) {
    const collectionName = row[3];
    const id = slugify(collectionName);
    if (!byId.has(id)) byId.set(id, { id, name: collectionName, product_count: 0 });
    byId.get(id).product_count += 1;
  }
  return Array.from(byId.values());
}

// Returns null if the collection id doesn't exist (distinct from an empty array).
function getProductsByCollection(collectionId) {
  const exists = getAllCollections().some(c => c.id === collectionId);
  if (!exists) return null;
  return getAllProducts().filter(p => p.collection_id === collectionId);
}

module.exports = { getAllProducts, getAllCollections, getProductsByCollection };
