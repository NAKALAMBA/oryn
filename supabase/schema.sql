-- ============================================================
--  Oryn — Supabase schema
--
--  HOW TO RUN:
--    Supabase Dashboard → SQL Editor → New query → paste this → Run.
--  Safe to re-run: everything uses "if not exists" / "drop ... if exists".
--
--  Covers the two browser-connected forms:
--    1. Contact Us            → contact.html
--    2. The Oryn Table (event) → Noida-registration.html
-- ============================================================


-- ─── 1) Contact Us form (contact.html) ──────────────────────
create table if not exists public.contact_messages (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  full_name   text not null,
  email       text not null,
  phone       text not null,
  subject     text,
  message     text not null
);


-- ─── 2) The Oryn Table — event registration ─────────────────
--  One row per attendee. Attendees booked together share group_id.
create table if not exists public.event_registrations (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  group_id     uuid not null,
  event_name   text not null default 'The Oryn Table — Noida',
  guest_count  integer not null default 1,
  full_name    text not null,
  email        text not null,
  phone        text not null,
  city         text,
  allergies    text,
  notes        text
);

create index if not exists event_registrations_group_id_idx
  on public.event_registrations (group_id);


-- ============================================================
--  Row-Level Security (RLS)
--
--  The website runs in the browser with the PUBLIC "anon" key.
--  We allow anonymous INSERTs (so the forms work) but grant NO
--  read/update/delete — so nobody can pull the submitted data
--  back out with that public key. You read submissions in the
--  Dashboard → Table Editor (which uses the privileged key).
-- ============================================================

alter table public.contact_messages    enable row level security;
alter table public.event_registrations enable row level security;

drop policy if exists "Anyone can submit a contact message" on public.contact_messages;
create policy "Anyone can submit a contact message"
  on public.contact_messages
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Anyone can submit an event registration" on public.event_registrations;
create policy "Anyone can submit an event registration"
  on public.event_registrations
  for insert
  to anon, authenticated
  with check (true);
