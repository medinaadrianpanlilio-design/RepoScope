-- AI summaries are private to whoever generated them, even on public repositories. A
-- corrected summary is kept beside the original, as future fine-tuning data.

create table public.ai_summaries (
  user_id uuid not null references auth.users (id) on delete cascade,
  analysis_id uuid not null references public.analysis_runs (id) on delete cascade,
  file_path text not null,
  summary text not null check (char_length(summary) <= 4000),
  corrected_summary text check (char_length(corrected_summary) <= 4000),
  model text not null check (char_length(model) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, analysis_id, file_path)
);

create index ai_summaries_analysis_id_idx on public.ai_summaries (analysis_id);

alter table public.ai_summaries enable row level security;

grant select, insert, update, delete on public.ai_summaries to authenticated;
grant select, insert, update, delete on public.ai_summaries to service_role;

create policy "Users read their own summaries"
  on public.ai_summaries for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users add their own summaries"
  on public.ai_summaries for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their own summaries"
  on public.ai_summaries for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own summaries"
  on public.ai_summaries for delete
  to authenticated
  using ((select auth.uid()) = user_id);
