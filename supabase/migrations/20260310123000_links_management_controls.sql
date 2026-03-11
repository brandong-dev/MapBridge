alter table public.links
add column if not exists is_disabled boolean not null default false;

create index if not exists links_user_id_disabled_created_at_idx
on public.links (user_id, is_disabled, created_at desc);

alter table public.links enable row level security;

drop policy if exists "users can update own links" on public.links;
drop policy if exists "users can delete own links" on public.links;

create policy "users can update own links"
on public.links
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can delete own links"
on public.links
for delete
to authenticated
using (auth.uid() = user_id);
