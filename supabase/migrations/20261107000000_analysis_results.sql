-- Phase 2: what the engine finds. No table here stores source code.
--
-- Access model matches analysis_runs: results of public repositories are readable by
-- everyone, and only the server (secret key) writes them. Numeric ids keep rows small,
-- because a free database holds 500 MB.

alter table public.analysis_runs
  add column stats jsonb;

comment on column public.analysis_runs.stats is
  'Totals, languages, directories, cycles and unanalyzable imports. Never source code.';

create table public.repository_files (
  id bigint generated always as identity primary key,
  analysis_id uuid not null references public.analysis_runs (id) on delete cascade,
  file_path text not null,
  language text not null,
  file_size integer not null check (file_size >= 0),
  line_count integer not null check (line_count >= 0),
  incoming_count integer not null default 0 check (incoming_count >= 0),
  outgoing_count integer not null default 0 check (outgoing_count >= 0),
  exported_names text[] not null default '{}',
  has_syntax_errors boolean not null default false,
  unique (analysis_id, file_path)
);

create table public.dependency_edges (
  id bigint generated always as identity primary key,
  analysis_id uuid not null references public.analysis_runs (id) on delete cascade,
  source_file_id bigint not null references public.repository_files (id) on delete cascade,
  target_file_id bigint not null references public.repository_files (id) on delete cascade,
  relationship_type text not null check (
    relationship_type in ('static', 'dynamic', 'reexport', 'type')
  ),
  import_specifier text not null,
  line_number integer not null check (line_number > 0)
);

create index dependency_edges_analysis_id_idx on public.dependency_edges (analysis_id);
create index dependency_edges_source_file_id_idx on public.dependency_edges (source_file_id);
create index dependency_edges_target_file_id_idx on public.dependency_edges (target_file_id);

create table public.unresolved_imports (
  id bigint generated always as identity primary key,
  analysis_id uuid not null references public.analysis_runs (id) on delete cascade,
  source_file_id bigint not null references public.repository_files (id) on delete cascade,
  import_specifier text not null,
  line_number integer not null check (line_number > 0)
);

create index unresolved_imports_analysis_id_idx on public.unresolved_imports (analysis_id);
create index unresolved_imports_source_file_id_idx on public.unresolved_imports (source_file_id);

alter table public.repository_files enable row level security;
alter table public.dependency_edges enable row level security;
alter table public.unresolved_imports enable row level security;

grant select on public.repository_files, public.dependency_edges, public.unresolved_imports
  to anon, authenticated;

create policy "Files of public repositories are readable by everyone"
  on public.repository_files for select
  to anon, authenticated
  using (
    exists (select 1 from public.analysis_runs a where a.id = analysis_id)
  );

create policy "Edges of public repositories are readable by everyone"
  on public.dependency_edges for select
  to anon, authenticated
  using (
    exists (select 1 from public.analysis_runs a where a.id = analysis_id)
  );

create policy "Unresolved imports of public repositories are readable by everyone"
  on public.unresolved_imports for select
  to anon, authenticated
  using (
    exists (select 1 from public.analysis_runs a where a.id = analysis_id)
  );
