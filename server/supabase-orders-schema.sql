-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
-- Creates a durable backup copy of orders/order_items — separate from the
-- Express server's own local SQLite database, which resets on every
-- restart on hosts without a persistent disk (e.g. Render's free tier).
--
-- Uses uuid primary keys (not auto-increment integers) so the server can
-- generate the order's id itself before inserting, and immediately use
-- that same id for the order's line items — no "insert...returning"
-- round trip needed, which matters because that would otherwise require
-- granting the anon role SELECT access we deliberately don't want to grant
-- (this data contains customer PII: name, address, phone, email).

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  email text not null,
  phone text not null,
  address text,
  state text,
  city text not null,
  pin_code text,
  delivery_date text,
  product_interest text,
  quantity_details text,
  gift_message text,
  cart_summary text,
  subtotal integer not null default 0
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sku text,
  name text not null,
  price integer not null,
  quantity integer not null,
  details text
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- INSERT-only for the public (anon) role — matches the same privacy
-- pattern already used for contact_messages/event_registrations: anyone
-- can submit an order, but nobody can read, edit, or delete one back out
-- through the public API. Only the server (via its Express admin
-- endpoints backed by local SQLite) ever displays this data.
-- (DROP first so this script is safe to re-run.)
drop policy if exists "anon can insert orders" on public.orders;
create policy "anon can insert orders" on public.orders
  for insert to anon with check (true);

drop policy if exists "anon can insert order_items" on public.order_items;
create policy "anon can insert order_items" on public.order_items
  for insert to anon with check (true);
