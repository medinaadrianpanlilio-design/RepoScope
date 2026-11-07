-- Phase 8: GitHub App installations and private repositories.
--
-- GitHub installs an App once per account, and an installation here belongs to one user, so a
-- private repository has exactly one owner. Its row reuses the owner policies from Phase 6,
-- which open its runs and results to that owner and nobody else.

create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  github_installation_id bigint not null unique,
  account_login text not null,
  account_type text not null check (account_type in ('User', 'Organization')),
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index github_installations_user_id_idx on public.github_installations (user_id);

alter table public.github_installations enable row level security;

-- Writing a row would claim an installation, so only the server can, after verifying it.
grant select on public.github_installations to authenticated;
grant select, insert, update, delete on public.github_installations to service_role;

create policy "Users read their own installations"
  on public.github_installations for select
  to authenticated
  using ((select auth.uid()) = user_id);

alter table public.repositories
  add column installation_id uuid,
  add column last_indexed_commit text check (last_indexed_commit ~ '^[0-9a-f]{40}$'),
  add column last_synced_at timestamptz;

-- Two columns, so a repository's owner can never differ from its installation's user.
alter table public.repositories add constraint repositories_installation_fkey
  foreign key (installation_id, owner_user_id)
  references public.github_installations (id, user_id)
  on delete cascade;

create index repositories_installation_id_idx
  on public.repositories (installation_id) where installation_id is not null;

-- is_private opens or closes a row to everyone, so it must always agree with the owner.
alter table public.repositories drop constraint repositories_source_shape;
alter table public.repositories add constraint repositories_source_shape check (
  (source = 'github' and github_id is not null and not is_private
    and owner_user_id is null and installation_id is null)
  or (source = 'github' and github_id is not null and is_private
    and owner_user_id is not null and installation_id is not null)
  or (source = 'local' and is_private and owner_user_id is not null and installation_id is null)
);

-- A synced clone and the private repository it came from share a name.
drop index public.repositories_owner_full_name_key;
create unique index repositories_owner_full_name_key
  on public.repositories (owner_user_id, source, lower(full_name))
  where owner_user_id is not null;

-- The foreign key ignores Row Level Security, so this used to let a user save a private
-- repository they couldn't see. The check on repositories runs under that table's policies.
drop policy "Users save repositories for themselves" on public.saved_repositories;
create policy "Users save repositories they can see"
  on public.saved_repositories for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.repositories r where r.id = repository_id)
  );
