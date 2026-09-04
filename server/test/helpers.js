'use strict';

// Test-mode flag: auth.js treats this like "local dev" (requireAdmin is a
// no-op) so the existing admin tests can hit /api/admin/* without a token.
// admin-auth.test.js / admin-failclosed.test.js opt out by setting their
// own env before requiring this.
process.env.ORYN_TEST = process.env.ORYN_TEST || '1';

// Lock every test to demo/fail-open mode regardless of the developer's
// local .env (dotenv only fills in still-undefined vars).
process.env.MSG91_AUTH_KEY = '';
process.env.SHIPROCKET_EMAIL = '';
process.env.SHIPROCKET_PASSWORD = '';
process.env.SHIPROCKET_PICKUP_LOCATION = '';

// Supabase is the only datastore — point it at the in-memory fake.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-key';

const fakeSupabase = require('./fake-supabase');
fakeSupabase.install();

function startServer() {
  fakeSupabase.reset();
  const app = require('../server');
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://localhost:${port}`, fakeSupabase });
    });
  });
}

// Valid-looking Indian mobile numbers (10 digits, starts 6-9), unique per call.
let phoneSeq = 0;
function uniquePhone() {
  phoneSeq += 1;
  return `9${String(Date.now()).slice(-8)}${phoneSeq % 10}`;
}

module.exports = { startServer, uniquePhone, fakeSupabase };
