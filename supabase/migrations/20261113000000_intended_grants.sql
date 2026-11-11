-- Phase 8, ticket 10: browser roles get exactly the grants the migrations meant to give.
--
-- Supabase gives anon and authenticated every privilege on each new public table by default, so a
-- write these roles were never granted still reached Row Level Security and matched no rows, instead
-- of being refused. Nothing got through, but RLS was the only wall. Now both walls stand, and tables
-- made later start with no access for these roles until a migration grants it.

revoke all on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- What each earlier migration granted, gathered in one place. service_role keeps its own grants.
grant select on
  public.repositories,
  public.analysis_runs,
  public.repository_files,
  public.dependency_edges,
  public.unresolved_imports
  to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, delete on public.saved_repositories to authenticated;
grant select, insert, update, delete on public.ai_summaries to authenticated;
grant select, insert, update on public.api_keys to authenticated;
grant select, insert, update, delete on public.conventions to authenticated;
grant select on public.github_installations to authenticated;

-- rate_limits and analysis_snapshots stay server-only: no grant to anon or authenticated.

-- Moving a Convention to another repository was checked only for its owner. The foreign key ignores
-- RLS, so it would accept a repository the user can't see. Now it's checked like an insert.
drop policy "Users update their own conventions" on public.conventions;
create policy "Users update their own conventions"
  on public.conventions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.repositories r where r.id = repository_id)
  );
