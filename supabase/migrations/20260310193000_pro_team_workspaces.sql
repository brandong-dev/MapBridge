do $$
begin
	if not exists (
		select 1 from pg_type where typname = 'plan_tier'
	) then
		create type public.plan_tier as enum ('free', 'pro', 'team');
	end if;
end
$$;

do $$
begin
	if not exists (
		select 1 from pg_type where typname = 'workspace_role'
	) then
		create type public.workspace_role as enum ('owner', 'member');
	end if;
end
$$;

create table if not exists public.user_profiles (
	user_id uuid primary key references auth.users (id) on delete cascade,
	plan_tier public.plan_tier not null default 'free',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
	id uuid primary key default gen_random_uuid(),
	name text not null check (char_length(name) between 2 and 80),
	owner_user_id uuid not null references auth.users (id) on delete cascade,
	created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
	workspace_id uuid not null references public.workspaces (id) on delete cascade,
	user_id uuid not null references auth.users (id) on delete cascade,
	role public.workspace_role not null default 'member',
	created_at timestamptz not null default now(),
	primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invites (
	id uuid primary key default gen_random_uuid(),
	workspace_id uuid not null references public.workspaces (id) on delete cascade,
	created_by_user_id uuid not null references auth.users (id) on delete cascade,
	code text not null unique,
	expires_at timestamptz not null,
	used_at timestamptz,
	used_by_user_id uuid references auth.users (id) on delete set null,
	created_at timestamptz not null default now()
);

create index if not exists workspaces_owner_user_id_idx
on public.workspaces (owner_user_id);

create index if not exists workspace_members_user_id_idx
on public.workspace_members (user_id);

create index if not exists workspace_invites_workspace_id_idx
on public.workspace_invites (workspace_id, created_at desc);

create index if not exists workspace_invites_code_idx
on public.workspace_invites (code);

alter table public.links
add column if not exists workspace_id uuid references public.workspaces (id) on delete set null;

create index if not exists links_workspace_id_created_at_idx
on public.links (workspace_id, created_at desc);

create index if not exists links_workspace_id_disabled_created_at_idx
on public.links (workspace_id, is_disabled, created_at desc);

create or replace function public.is_workspace_member(workspace_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.workspace_members member_row
		where member_row.workspace_id = workspace_id_input
			and member_row.user_id = auth.uid()
	);
$$;

create or replace function public.is_workspace_owner(workspace_id_input uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1
		from public.workspace_members member_row
		where member_row.workspace_id = workspace_id_input
			and member_row.user_id = auth.uid()
			and member_row.role = 'owner'
	);
$$;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

create or replace function public.handle_user_profile_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.user_profiles (user_id)
	values (new.id)
	on conflict (user_id) do nothing;

	return new;
end;
$$;

drop trigger if exists on_auth_user_created_navqr on auth.users;
create trigger on_auth_user_created_navqr
after insert on auth.users
for each row
execute function public.handle_user_profile_defaults();

insert into public.user_profiles (user_id)
select user_row.id
from auth.users user_row
on conflict (user_id) do nothing;

alter table public.user_profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.links enable row level security;

drop policy if exists "users can read own profile" on public.user_profiles;
drop policy if exists "users can insert own profile" on public.user_profiles;
drop policy if exists "users can update own profile" on public.user_profiles;

create policy "users can read own profile"
on public.user_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "users can insert own profile"
on public.user_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users can update own profile"
on public.user_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "members can read workspaces" on public.workspaces;
drop policy if exists "team owners can create workspaces" on public.workspaces;
drop policy if exists "owners can update workspaces" on public.workspaces;
drop policy if exists "owners can delete workspaces" on public.workspaces;

create policy "members can read workspaces"
on public.workspaces
for select
to authenticated
using (public.is_workspace_member(id));

create policy "team owners can create workspaces"
on public.workspaces
for insert
to authenticated
with check (
	auth.uid() = owner_user_id
	and exists (
		select 1
		from public.user_profiles profile_row
		where profile_row.user_id = auth.uid()
			and profile_row.plan_tier = 'team'
	)
);

create policy "owners can update workspaces"
on public.workspaces
for update
to authenticated
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy "owners can delete workspaces"
on public.workspaces
for delete
to authenticated
using (auth.uid() = owner_user_id);

drop policy if exists "members can read workspace memberships" on public.workspace_members;
drop policy if exists "owners can add workspace members" on public.workspace_members;
drop policy if exists "owners and self can remove workspace members" on public.workspace_members;

create policy "members can read workspace memberships"
on public.workspace_members
for select
to authenticated
using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

create policy "owners can add workspace members"
on public.workspace_members
for insert
to authenticated
with check (public.is_workspace_owner(workspace_id));

create policy "owners and self can remove workspace members"
on public.workspace_members
for delete
to authenticated
using (public.is_workspace_owner(workspace_id) or user_id = auth.uid());

drop policy if exists "owners can read workspace invites" on public.workspace_invites;
drop policy if exists "owners can create workspace invites" on public.workspace_invites;
drop policy if exists "owners can update workspace invites" on public.workspace_invites;
drop policy if exists "owners can delete workspace invites" on public.workspace_invites;

create policy "owners can read workspace invites"
on public.workspace_invites
for select
to authenticated
using (public.is_workspace_owner(workspace_id));

create policy "owners can create workspace invites"
on public.workspace_invites
for insert
to authenticated
with check (
	public.is_workspace_owner(workspace_id)
	and created_by_user_id = auth.uid()
);

create policy "owners can update workspace invites"
on public.workspace_invites
for update
to authenticated
using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

create policy "owners can delete workspace invites"
on public.workspace_invites
for delete
to authenticated
using (public.is_workspace_owner(workspace_id));

drop policy if exists "users can read own links" on public.links;
drop policy if exists "users can create own links" on public.links;
drop policy if exists "users can update own links" on public.links;
drop policy if exists "users can delete own links" on public.links;
drop policy if exists "anon can create unowned links" on public.links;

create policy "users can read accessible links"
on public.links
for select
to authenticated
using (
	(workspace_id is null and auth.uid() = user_id)
	or (workspace_id is not null and public.is_workspace_member(workspace_id))
);

create policy "users can create accessible links"
on public.links
for insert
to authenticated
with check (
	(workspace_id is null and auth.uid() = user_id)
	or (workspace_id is not null and public.is_workspace_member(workspace_id))
);

create policy "users can update accessible links"
on public.links
for update
to authenticated
using (
	(workspace_id is null and auth.uid() = user_id)
	or (workspace_id is not null and public.is_workspace_member(workspace_id))
)
with check (
	(workspace_id is null and auth.uid() = user_id)
	or (workspace_id is not null and public.is_workspace_member(workspace_id))
);

create policy "users can delete accessible links"
on public.links
for delete
to authenticated
using (
	(workspace_id is null and auth.uid() = user_id)
	or (workspace_id is not null and public.is_workspace_member(workspace_id))
);

create policy "anon can create unowned links"
on public.links
for insert
to anon
with check (user_id is null and workspace_id is null);
