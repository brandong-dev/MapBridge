create extension if not exists pgcrypto;

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

alter table public.links enable row level security;

drop policy if exists "public can read links" on public.links;
create policy "public can read links"
on public.links
for select
using (true);

drop policy if exists "public can insert links" on public.links;
create policy "public can insert links"
on public.links
for insert
with check (true);
