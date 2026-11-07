-- Phase 6: local folders and keys.
--
-- A local folder is a private Repository owned by one user. Its source never leaves their
-- PC. Uncommitted work is one Working copy run per Repository, replaced on each sync.

alter table public.repositories
  add column source text not null default 'github' check (source in ('github', 'local')),
  add column owner_user_id uuid references auth.users (id) on delete cascade,
  add column remote_full_name text;

alter table public.repositories alter column github_id drop not null;

alter table public.repositories add constraint repositories_source_shape check (
  (source = 'github' and github_id is not null and owner_user_id is null)
  or (source = 'local' and owner_user_id is not null and is_private)
);

-- Two people can each have a local folder with the same name.
drop index public.repositories_full_name_key;
create unique index repositories_full_name_key
  on public.repositories (lower(full_name)) where owner_user_id is null;
create unique index repositories_owner_full_name_key
  on public.repositories (owner_user_id, lower(full_name)) where owner_user_id is not null;

alter table public.analysis_runs alter column commit_sha drop not null;

alter table public.analysis_runs
  add column is_working_copy boolean not null default false,
  add column base_commit_sha text check (base_commit_sha ~ '^[0-9a-f]{40}$');

alter table public.analysis_runs add constraint analysis_runs_commit_shape check (
  (is_working_copy and commit_sha is null) or (not is_working_copy and commit_sha is not null)
);

create unique index analysis_runs_working_copy_key
  on public.analysis_runs (repository_id) where is_working_copy;

-- Results tables check analysis_runs, so these two policies also open a folder's results
-- to its owner, and to nobody else.
create policy "Owners read their local repositories"
  on public.repositories for select
  to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Owners read runs of their local repositories"
  on public.analysis_runs for select
  to authenticated
  using (
    exists (
      select 1 from public.repositories r
      where r.id = repository_id and r.owner_user_id = (select auth.uid())
    )
  );

-- Only a hash is stored. An MCP key can read, and a sync key can only upload.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('mcp', 'sync')),
  name text not null check (char_length(name) between 1 and 60),
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_user_id_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;

grant select, insert, update on public.api_keys to authenticated;
grant select, insert, update, delete on public.api_keys to service_role;

create policy "Users read their own keys"
  on public.api_keys for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own keys"
  on public.api_keys for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users revoke their own keys"
  on public.api_keys for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
