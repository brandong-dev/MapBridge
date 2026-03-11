alter table public.links
add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists links_user_id_created_at_idx
on public.links (user_id, created_at desc);

alter table public.links enable row level security;

drop policy if exists "public can read links" on public.links;
drop policy if exists "public can insert links" on public.links;
drop policy if exists "users can read own links" on public.links;
drop policy if exists "users can create own links" on public.links;
drop policy if exists "anon can create unowned links" on public.links;

create policy "users can read own links"
on public.links
for select
to authenticated
using (auth.uid() = user_id);

create policy "users can create own links"
on public.links
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "anon can create unowned links"
on public.links
for insert
to anon
with check (user_id is null);
