-- Fixed-window rate limits. In-memory counters don't work on serverless, because each
-- request can land on a different instance. Keys hold a hash, never a raw IP address.

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Enabled with no policies and no grants: only the server can reach this table.
alter table public.rate_limits enable row level security;

create function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  new_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, current_window, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into new_count;

  return new_count <= p_limit;
end;
$$;

revoke execute on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
