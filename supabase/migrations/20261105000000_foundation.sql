-- Phase 1: profiles, repositories, saved repositories and analysis runs.
--
-- Access model:
--   * Repositories and analysis runs for public code are readable by everyone.
--   * Only the server (secret key, which bypasses RLS) writes them, so the public
--     key can't be used to plant fake repositories or results.
--   * Profiles and saved repositories belong to one user.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  github_id bigint not null unique,
  owner text not null,
  name text not null,
  full_name text not null,
  github_url text not null,
  description text,
  default_branch text not null,
  primary_language text,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- GitHub names are case-insensitive.
create unique index repositories_full_name_key on public.repositories (lower(full_name));

create table public.saved_repositories (
  user_id uuid not null references auth.users (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, repository_id)
);

create index saved_repositories_repository_id_idx on public.saved_repositories (repository_id);

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories (id) on delete cascade,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  status text not null default 'queued' check (
    status in (
      'queued', 'fetching', 'scanning', 'parsing', 'resolving',
      'generating_graph', 'saving', 'completed', 'failed'
    )
  ),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (repository_id, commit_sha)
);

alter table public.profiles enable row level security;
alter table public.repositories enable row level security;
alter table public.saved_repositories enable row level security;
alter table public.analysis_runs enable row level security;

grant select on public.repositories, public.analysis_runs to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.saved_repositories to authenticated;

create policy "Public repositories are readable by everyone"
  on public.repositories for select
  to anon, authenticated
  using (not is_private);

create policy "Analysis runs of public repositories are readable by everyone"
  on public.analysis_runs for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.repositories r
      where r.id = repository_id and not r.is_private
    )
  );

create policy "Users read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users read their own saved repositories"
  on public.saved_repositories for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users save repositories for themselves"
  on public.saved_repositories for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users remove their own saved repositories"
  on public.saved_repositories for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Create a profile for every new account.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(new.raw_user_meta_data ->> 'display_name', 100));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
