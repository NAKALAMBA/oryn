'use strict';

// Every test file gets its own process under `node --test`, so setting this
// here (before ../server / ../db is ever required) gives each file a fresh,
// isolated in-memory database instead of touching the real oryn.db.
process.env.ORYN_DB_PATH = ':memory:';

// Tests must never depend on (or accidentally hit) whatever real provider
// keys happen to be sitting in the developer's local .env — dotenv only
// fills in env vars that are still undefined, so pre-setting this to an
// empty string here locks every test file to demo/fail-open mode regardless
// of what's configured for local dev. email.test.js/shiprocket.test.js opt
// back in per-test via their own explicit env values.
process.env.MSG91_AUTH_KEY = '';
process.env.SHIPROCKET_EMAIL = '';
process.env.SHIPROCKET_PASSWORD = '';
process.env.SHIPROCKET_PICKUP_LOCATION = '';

function startServer() {
  const app = require('../server');
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

// Valid-looking Indian mobile numbers (10 digits, starts 6-9). Unique per
// call within a test run via a millisecond timestamp tail plus a sequence
// digit.
let phoneSeq = 0;
function uniquePhone() {
  phoneSeq += 1;
  return `9${String(Date.now()).slice(-8)}${phoneSeq % 10}`;
}

module.exports = { startServer, uniquePhone };
