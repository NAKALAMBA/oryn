/* ─────────────────────────────────────────────────────────────
   Oryn — Supabase browser config

   These two values are SAFE to expose in the browser. The anon key
   only ever grants what your Row-Level-Security policies allow
   (see supabase/schema.sql — insert-only, no reads).

   WHERE TO FIND THESE:
     Supabase Dashboard → Project Settings → API
       • Project URL      → paste into ORYN_SUPABASE_URL
       • Project API keys → "anon" / "public" key → ORYN_SUPABASE_ANON_KEY

   Load order on a page MUST be:
       1. the supabase-js CDN <script>
       2. this file
       3. the page's own form script (main.js, etc.)
   ───────────────────────────────────────────────────────────── */

window.ORYN_SUPABASE_URL = "https://lebocatqamhvrhttupdz.supabase.co";
// Publishable key — safe in the browser. RLS still only allows INSERT for
// this role (see server/supabase-orders-schema.sql).
window.ORYN_SUPABASE_ANON_KEY = "sb_publishable_HWMrY8x2WCIbQWzubVOwZA_4qxhdsqZ";

(function initOrynSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    console.error(
      "[oryn] supabase-js did not load — check the CDN <script> tag order.",
    );
    return;
  }
  if (
    window.ORYN_SUPABASE_URL.indexOf("YOUR-PROJECT-REF") !== -1 ||
    window.ORYN_SUPABASE_ANON_KEY.indexOf("YOUR-ANON") !== -1
  ) {
    console.warn(
      "[oryn] Supabase URL / anon key not set yet — edit js/supabase-config.js.",
    );
  }
  window.orynSupabase = window.supabase.createClient(
    window.ORYN_SUPABASE_URL,
    window.ORYN_SUPABASE_ANON_KEY,
  );
})();
