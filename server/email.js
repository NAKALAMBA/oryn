'use strict';

// Email validation via MSG91's "Validate Email" product (the same MSG91
// account already used elsewhere on this project — reuses MSG91_AUTH_KEY).
// Used to catch a mistyped/undeliverable email at checkout before an order
// is accepted, not to process post-send bounce webhooks.
//
// Confirmed live against the real API (2026-07-15) — a deliverable address
// returns:
//   { status: "success", hasError: false,
//     data: { result: { valid: true, result: "deliverable", reason: "ACCEPTED_EMAIL",
//                        is_disposable: false, is_free: true, is_role: false } } }
// and an undeliverable one (no MX record) returns the same shape with
// data.result.result === "undeliverable". An auth failure returns HTTP 401
// with { status: "fail", hasError: true, errors: "Unauthorized" }.
//
// Fails OPEN by design: any misconfiguration, network error, or unexpected
// response is treated as "couldn't check" rather than "invalid", so a
// third-party outage never blocks a real order.

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const EMAIL_VALIDATE_URL = 'https://api.msg91.com/api/v5/email/validate';

function emailValidationConfigured() {
  return Boolean(MSG91_AUTH_KEY);
}

class EmailValidationUnavailableError extends Error {}

function parseResult(data) {
  const result = data && data.data && data.data.result;
  const status = String((result && result.result) || '').toLowerCase();
  // Only "undeliverable" blocks the order — genuinely wrong/nonexistent
  // addresses. "risky"/"unknown" (e.g. catch-all servers) are left alone
  // rather than rejecting a possibly-legitimate customer.
  const invalid = status === 'undeliverable';
  return { valid: !invalid, status: status || 'unknown', raw: data };
}

// Resolves { valid, status, raw } when MSG91 answers successfully.
// Throws EmailValidationUnavailableError when nothing is configured or the
// request itself fails — callers should treat that as "unknown, let it
// through" rather than blocking the customer.
async function validateEmail(email) {
  if (!emailValidationConfigured()) {
    throw new EmailValidationUnavailableError('MSG91_AUTH_KEY not configured');
  }

  let res;
  try {
    res = await fetch(EMAIL_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: MSG91_AUTH_KEY },
      body: JSON.stringify({ email }),
    });
  } catch (err) {
    throw new EmailValidationUnavailableError(`MSG91 email validation request failed: ${err.message}`);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new EmailValidationUnavailableError((data && data.errors) || `MSG91 email validation failed (HTTP ${res.status})`);
  }
  return parseResult(data);
}

module.exports = { validateEmail, emailValidationConfigured, EmailValidationUnavailableError };
