-- Phase 8: analyze only what changed.
--
-- A snapshot holds each source file's parse result and content hash from a repository's latest
-- analysis, so the next one fetches and parses only files whose hash changed. It holds no source
-- code. It is the server's working data, never shown to anyone, so no role but the server can
-- read it.

create table public.analysis_snapshots (
  repository_id uuid primary key references public.repositories (id) on delete cascade,
  analysis_id uuid not null references public.analysis_runs (id) on delete cascade,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  data text not null,
  updated_at timestamptz not null default now()
);

create index analysis_snapshots_analysis_id_idx on public.analysis_snapshots (analysis_id);

alter table public.analysis_snapshots enable row level security;

revoke all on public.analysis_snapshots from anon, authenticated;
grant select, insert, update, delete on public.analysis_snapshots to service_role;
