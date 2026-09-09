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
alter table public.orders add column if not exists refunded       boolean not null default false;   -- for a Cancelled + Paid order: has the money been refunded?

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

-- ── contact_messages: the /admin "Messages" tab ──────────────────────
-- The table itself is created by the browser-direct contact form path;
-- the create-if-not-exists below just keeps this file self-contained.
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  email text not null,
  phone text not null,
  subject text,
  message text not null
);
alter table public.contact_messages enable row level security;
drop policy if exists "anon can insert contact" on public.contact_messages;
create policy "anon can insert contact" on public.contact_messages
  for insert to anon with check (true);

-- "Answered / not answered" flag for each query, toggled from the Messages tab.
alter table public.contact_messages add column if not exists answered    boolean not null default false;
alter table public.contact_messages add column if not exists answered_at  timestamptz;

-- ── event_registrations: the /admin "Oryn Table" tab ─────────────────
-- Rows are inserted browser-direct (Noida-registration.html via supabase-js,
-- INSERT-only anon policy) and by POST /api/registrations. The
-- create-if-not-exists below just keeps this file self-contained.
create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  group_id uuid,
  event_name text,
  guest_count integer,
  full_name text not null,
  email text not null,
  phone text not null,
  city text,
  allergies text,
  notes text
);
alter table public.event_registrations enable row level security;
drop policy if exists "anon can insert registrations" on public.event_registrations;
create policy "anon can insert registrations" on public.event_registrations
  for insert to anon with check (true);

-- Event location + date, stored per registration so the Oryn Table tab can
-- filter by them. event_date is an ISO date string, e.g. '2026-07-26'.
alter table public.event_registrations add column if not exists event_location text;
alter table public.event_registrations add column if not exists event_date     text;

-- RSVP + payment, both admin-managed from the Oryn Table tab.
alter table public.event_registrations add column if not exists rsvp_status    text not null default 'Pending';  -- Pending | Confirmed | Cancelled
alter table public.event_registrations add column if not exists payment_status text not null default 'Pending';  -- Pending | Paid | Refunded
