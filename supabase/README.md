# Oryn — Supabase setup

Connects two forms directly from the browser to Supabase (no server needed):

- **Contact Us** — `contact.html` → `contact_messages` table
- **The Oryn Table registration** — `Noida-registration.html` → `event_registrations` table

## One-time setup

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is fine).

2. **Create the tables + security rules.**
   Dashboard → **SQL Editor** → **New query** → paste all of
   [`schema.sql`](./schema.sql) → **Run**. (Safe to re-run anytime.)

3. **Get your two public values.**
   Dashboard → **Project Settings** → **API**:
   - **Project URL**
   - **Project API keys → `anon` / `public`**

4. **Paste them into** [`../js/supabase-config.js`](../js/supabase-config.js):
   ```js
   window.ORYN_SUPABASE_URL      = 'https://xxxxxxxx.supabase.co';
   window.ORYN_SUPABASE_ANON_KEY = 'eyJhbGciOi...';   // the anon/public key
   ```
   These are **safe to commit and ship in the browser** — the anon key can only
   do what the RLS policies allow (insert form submissions, nothing else).

5. **Done.** Open `contact.html` or `Noida-registration.html` and submit.

## Where do submissions show up?

Supabase Dashboard → **Table Editor** → `contact_messages` / `event_registrations`.

The anon key **cannot read** these tables (by design), so the public site can only
write. To view/export data, use the Dashboard (or add an authenticated admin later).

## Notes

- These two forms no longer need the Node server in `../server/`. The other forms
  (orders, newsletter) still use that server — they were left unchanged.
- `event_registrations` stores one row per attendee; everyone in a single booking
  shares a `group_id`.
