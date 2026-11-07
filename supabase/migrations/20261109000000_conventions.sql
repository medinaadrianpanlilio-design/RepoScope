-- Phase 7: Conventions.
--
-- Rules and notes belong to one user, even on a public Repository. Whether a rule is broken
-- isn't stored: it's worked out from the analysis, so editing a rule applies straight away.

create table public.conventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  kind text not null check (kind in ('import_rule', 'note')),
  rule_from text check (char_length(rule_from) <= 200),
  rule_to text check (char_length(rule_to) <= 200),
  rule_mode text check (rule_mode in ('must_not', 'only')),
  note_body text check (char_length(note_body) <= 2000),
  note_path text check (char_length(note_path) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conventions_shape check (
    (kind = 'import_rule' and rule_from is not null and rule_to is not null and rule_mode is not null
      and note_body is null and note_path is null)
    or (kind = 'note' and note_body is not null
      and rule_from is null and rule_to is null and rule_mode is null)
  )
);

create index conventions_user_repository_idx on public.conventions (user_id, repository_id);
create index conventions_repository_idx on public.conventions (repository_id);

alter table public.conventions enable row level security;

grant select, insert, update, delete on public.conventions to authenticated;
grant select, insert, update, delete on public.conventions to service_role;

create policy "Users read their own conventions"
  on public.conventions for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- The check on repositories runs under that table's own policies, so a user can only attach a
-- Convention to a Repository they're allowed to see.
create policy "Users add conventions to repositories they can see"
  on public.conventions for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.repositories r where r.id = repository_id)
  );

create policy "Users update their own conventions"
  on public.conventions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own conventions"
  on public.conventions for delete
  to authenticated
  using ((select auth.uid()) = user_id);
