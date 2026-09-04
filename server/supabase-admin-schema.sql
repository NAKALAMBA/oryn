-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query),
-- AFTER supabase-orders-schema.sql. Additive and safe to re-run.
--
-- Adds the columns the /admin panel manages (discount, shipping, final
-- payment, payment status, order status) plus a durable newsletter table,
-- and grants the admin operations to the service_role only.
--
-- The Express server reads/writes this data with SUPABASE_SERVICE_ROLE_KEY
-- (Project Settings -> API -> service_role secret), which bypasses RLS.
-- The public anon key stays INSERT-only, exactly as before.

-- ── orders: admin-managed amounts + statuses ──────────────────────────
alter table public.orders add column if not exists discount       integer not null default 0;
alter table public.orders add column if not exists shipping       integer;              -- NULL = "not entered yet" (distinct from a real 0)
alter table public.orders add column if not exists final_payment  integer;              -- subtotal - discount + coalesce(shipping,0)
alter table public.orders add column if not exists payment_status text not null default 'Pending';  -- Pending | Paid
alter table public.orders add column if not exists order_status   text not null default 'Pending';  -- Pending | Completed | Cancelled

-- Backfill final_payment for rows created before the column existed.
update public.orders
  set final_payment = subtotal - discount + coalesce(shipping, 0)
  where final_payment is null;

-- ── order_items: human-readable variant/label for the line ────────────
alter table public.order_items add column if not exists variant text;

-- ── newsletter_subscribers: durable copy (was SQLite-only) ────────────
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null unique,
  source_page text
);

alter table public.newsletter_subscribers enable row level security;

-- Anyone can subscribe; nobody can read/edit/delete back out through the
-- public API. The admin panel does that via the service_role key.
drop policy if exists "anon can insert newsletter" on public.newsletter_subscribers;
create policy "anon can insert newsletter" on public.newsletter_subscribers
  for insert to anon with check (true);
