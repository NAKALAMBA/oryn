'use strict';

// Shiprocket integration — creates a shipment record in Shiprocket the
// moment a checkout order is saved. This only registers the order inside
// Shiprocket (staging it); actually generating an AWB / scheduling courier
// pickup is a separate step done by hand in the Shiprocket dashboard once
// payment has been confirmed, so nothing physically ships prematurely.
//
// Auth contract (confirmed against Shiprocket's public API reference):
//   POST https://apiv2.shiprocket.in/v1/external/auth/login
//     body: { email, password } -> { token, ... }, token valid ~10 days,
//     used afterwards as `Authorization: Bearer <token>`.
//   POST https://apiv2.shiprocket.in/v1/external/orders/create/adhoc
//     body: order_id, order_date, pickup_location, billing_*, shipping_is_billing,
//     order_items[] ({name, sku, units, selling_price}), payment_method,
//     sub_total, length/breadth/height/weight -> { order_id, shipment_id, status }.
//
// Fails OPEN by design: if Shiprocket is unreachable, misconfigured, or
// rejects the request, the caller should still keep the order saved locally
// and just mark the Shiprocket sync as failed — a shipping-partner hiccup
// should never lose a real customer order.

const SHIPROCKET_EMAIL = process.env.SHIPROCKET_EMAIL;
const SHIPROCKET_PASSWORD = process.env.SHIPROCKET_PASSWORD;
const SHIPROCKET_PICKUP_LOCATION = process.env.SHIPROCKET_PICKUP_LOCATION;
const SHIPROCKET_CHANNEL_ID = process.env.SHIPROCKET_CHANNEL_ID || undefined;
const SHIPROCKET_PAYMENT_METHOD = process.env.SHIPROCKET_PAYMENT_METHOD || 'Prepaid';

const DEFAULT_WEIGHT_KG = Number(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG) || 0.5;
const DEFAULT_LENGTH_CM = Number(process.env.SHIPROCKET_DEFAULT_LENGTH_CM) || 20;
const DEFAULT_BREADTH_CM = Number(process.env.SHIPROCKET_DEFAULT_BREADTH_CM) || 15;
const DEFAULT_HEIGHT_CM = Number(process.env.SHIPROCKET_DEFAULT_HEIGHT_CM) || 10;

const AUTH_URL = 'https://apiv2.shiprocket.in/v1/external/auth/login';
const CREATE_ORDER_URL = 'https://apiv2.shiprocket.in/v1/external/orders/create/adhoc';
const TRACK_SHIPMENT_URL_BASE = 'https://apiv2.shiprocket.in/v1/external/courier/track/shipment/';

// Re-login a day early, well inside Shiprocket's ~10 day token lifetime.
const TOKEN_LIFETIME_MS = 9 * 24 * 60 * 60 * 1000;

class ShiprocketUnavailableError extends Error {}

function shiprocketConfigured() {
  return Boolean(SHIPROCKET_EMAIL && SHIPROCKET_PASSWORD && SHIPROCKET_PICKUP_LOCATION);
}

let cachedToken = null;
let cachedTokenAt = 0;

async function login() {
  let res;
  try {
    res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD }),
    });
  } catch (err) {
    throw new ShiprocketUnavailableError(`Shiprocket login request failed: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new ShiprocketUnavailableError((data && (data.message || data.errors)) || `Shiprocket login failed (HTTP ${res.status})`);
  }
  cachedToken = data.token;
  cachedTokenAt = Date.now();
  return cachedToken;
}

async function ensureToken() {
  if (cachedToken && Date.now() - cachedTokenAt < TOKEN_LIFETIME_MS) {
    return cachedToken;
  }
  return login();
}

function formatOrderDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// order: a row from the `orders` table. items: rows from `order_items` for that order.
// Resolves { shiprocketOrderId, shipmentId, status } on success.
// Throws ShiprocketUnavailableError on any config/network/API failure — the
// caller (server.js) should catch this and mark the order's sync as failed
// rather than let it block the checkout response.
async function createShiprocketOrder(order, items) {
  if (!shiprocketConfigured()) {
    throw new ShiprocketUnavailableError('Shiprocket is not configured (missing email/password/pickup location).');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ShiprocketUnavailableError('Cannot create a Shiprocket order with no items.');
  }

  const token = await ensureToken();

  const [firstName, ...rest] = String(order.full_name || '').trim().split(/\s+/);
  const lastName = rest.join(' ');

  // Includes a timestamp, not just the local row id — on hosts without a
  // persistent disk (e.g. Render's free tier), the SQLite database resets
  // on every restart and local ids restart from 1, which would otherwise
  // collide with a previous order's Shiprocket order_id and cause
  // Shiprocket to silently return the OLD shipment instead of creating a
  // new one for a genuinely different customer.
  const body = {
    order_id: `ORYN-${order.id}-${Date.now()}`,
    order_date: formatOrderDate(new Date()),
    pickup_location: SHIPROCKET_PICKUP_LOCATION,
    billing_customer_name: firstName || order.full_name || 'Customer',
    billing_last_name: lastName || '',
    billing_address: order.address || order.city,
    billing_city: order.city,
    billing_pincode: order.pin_code || '',
    billing_state: order.state || '',
    billing_country: 'India',
    billing_email: order.email,
    billing_phone: order.phone,
    shipping_is_billing: true,
    order_items: items.map(item => ({
      name: item.name,
      sku: item.sku || `ITEM-${item.id}`,
      units: item.quantity,
      selling_price: item.price,
    })),
    payment_method: SHIPROCKET_PAYMENT_METHOD,
    sub_total: order.subtotal,
    length: DEFAULT_LENGTH_CM,
    breadth: DEFAULT_BREADTH_CM,
    height: DEFAULT_HEIGHT_CM,
    weight: DEFAULT_WEIGHT_KG,
  };
  if (SHIPROCKET_CHANNEL_ID) body.channel_id = SHIPROCKET_CHANNEL_ID;

  let res;
  try {
    res = await fetch(CREATE_ORDER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ShiprocketUnavailableError(`Shiprocket order-create request failed: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ShiprocketUnavailableError((data && (data.message || JSON.stringify(data.errors))) || `Shiprocket order creation failed (HTTP ${res.status})`);
  }

  return {
    shiprocketOrderId: data.order_id != null ? String(data.order_id) : null,
    shipmentId: data.shipment_id != null ? String(data.shipment_id) : null,
    status: data.status || 'created',
  };
}

// Resolves { status, activities } for a shipment. A shipment that hasn't
// been assigned an AWB/courier yet (i.e. you haven't dispatched it from
// Shiprocket's dashboard yet) is a NORMAL state, not an error — resolves
// { status: 'Not yet dispatched', activities: [] } rather than throwing.
// Only real config/network/auth failures throw ShiprocketUnavailableError.
async function trackShipment(shipmentId) {
  if (!shiprocketConfigured()) {
    throw new ShiprocketUnavailableError('Shiprocket is not configured.');
  }
  if (!shipmentId) {
    return { status: 'Not yet dispatched', activities: [] };
  }

  const token = await ensureToken();

  let res;
  try {
    res = await fetch(`${TRACK_SHIPMENT_URL_BASE}${encodeURIComponent(shipmentId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new ShiprocketUnavailableError(`Shiprocket tracking request failed: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A shipment with no AWB/courier assigned yet commonly 404s here —
    // that's "not shipped yet", not a real failure.
    if (res.status === 404) return { status: 'Not yet dispatched', activities: [] };
    throw new ShiprocketUnavailableError((data && (data.message || data.errors)) || `Shiprocket tracking failed (HTTP ${res.status})`);
  }

  // Shiprocket's tracking response nesting varies slightly by lookup method
  // (AWB vs shipment ID) — read defensively rather than assume one exact
  // shape, since this is best-effort display, not something that should
  // ever throw over an unexpected-but-successful response.
  const trackData = data.tracking_data || data[shipmentId] || data;
  const shipmentTrack = Array.isArray(trackData.shipment_track) ? trackData.shipment_track[0] : null;
  const status = (shipmentTrack && (shipmentTrack.current_status || shipmentTrack.status))
    || trackData.track_status
    || 'Not yet dispatched';
  const activities = Array.isArray(trackData.shipment_track_activities)
    ? trackData.shipment_track_activities.map(a => ({ date: a.date, status: a.status || a.activity, location: a.location }))
    : [];

  return { status, activities };
}

module.exports = {
  shiprocketConfigured,
  createShiprocketOrder,
  trackShipment,
  ShiprocketUnavailableError,
};
