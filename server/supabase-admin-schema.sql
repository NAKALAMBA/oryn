-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query),
-- AFTER supabase-orders-schema.sql. Additive and safe to re-run.
--
-- Supabase is now the ONLY datastore for the Oryn server (no SQLite).
-- This adds:
--   * the amounts + statuses the /admin panel manages
--   * order_number  — a sequential, customer-facing order id (tracking
--     asks for a number, not a uuid)
--   * shiprocket_*   — shipment-sync bookkeeping (not shown in the UI)
--   * newsletter_subscribers table
--
-- The Express server reads/writes all of this with SUPABASE_SERVICE_ROLE_KEY
-- (Project Settings -> API -> service_role / secret key), which bypasses RLS.
-- The publishable key stays INSERT-only for the browser-direct paths.

-- ── orders: admin-managed amounts + statuses ──────────────────────────
alter table public.orders add column if not exists discount       integer not null default 0;
alter table public.orders add column if not exists shipping       integer;              -- NULL = "not entered yet" (distinct from a real 0)
alter table public.orders add column if not exists final_payment  integer;
alter table public.orders add column if not exists payment_status text not null default 'Pending';  -- Pending | Paid
alter table public.orders add column if not exists order_status   text not null default 'Pending';  -- Pending | Completed | Cancelled

update public.orders
  set final_payment = subtotal - discount + coalesce(shipping, 0)
  where final_payment is null;

-- ── orders: sequential customer-facing order number ───────────────────
create sequence if not exists public.orders_order_number_seq;
alter table public.orders add column if not exists order_number bigint;

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.orders
  where order_number is null
)
update public.orders o
  set order_number = ordered.rn
  from ordered
  where o.id = ordered.id;

select setval(
  'public.orders_order_number_seq',
  coalesce((select max(order_number) from public.orders), 0) + 1,
  false
);
alter table public.orders alter column order_number set default nextval('public.orders_order_number_seq');
create unique index if not exists orders_order_number_key on public.orders(order_number);

-- ── orders: Shiprocket shipment-sync bookkeeping ──────────────────────
alter table public.orders add column if not exists shiprocket_order_id     text;
alter table public.orders add column if not exists shiprocket_shipment_id  text;
alter table public.orders add column if not exists shiprocket_status       text;
alter table public.orders add column if not exists shiprocket_error        text;
alter table public.orders add column if not exists shiprocket_synced_at    timestamptz;

-- ── order_items: human-readable variant/label for the line ────────────
alter table public.order_items add column if not exists variant text;

-- ── newsletter_subscribers ───────────────────────────────────────────
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text,
  email text not null unique,
  source_page text
);
alter table public.newsletter_subscribers enable row level security;
drop policy if exists "anon can insert newsletter" on public.newsletter_subscribers;
create policy "anon can insert newsletter" on public.newsletter_subscribers
  for insert to anon with check (true);
