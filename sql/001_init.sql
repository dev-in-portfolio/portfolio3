create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'sessionmint_feel' and n.nspname = 'public'
  ) then
    create type public.sessionmint_feel as enum ('drag','neutral','flow');
  end if;
end $$;

create table if not exists public.sessionmint_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds int not null,
  tag text not null,
  feel public.sessionmint_feel not null default 'neutral',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.sessionmint_weekly_mints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  week_start date not null,
  total_seconds int not null,
  session_count int not null,
  flow_count int not null,
  drag_count int not null,
  top_tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, week_start)
);

create index if not exists idx_sessionmint_sessions_user_time on public.sessionmint_sessions(user_id, started_at desc);
create index if not exists idx_sessionmint_mints_user_week on public.sessionmint_weekly_mints(user_id, week_start desc);

alter table public.sessionmint_sessions enable row level security;
alter table public.sessionmint_weekly_mints enable row level security;

drop policy if exists "sessionmint_sessions_rw_own" on public.sessionmint_sessions;
create policy "sessionmint_sessions_rw_own" on public.sessionmint_sessions
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "sessionmint_mints_rw_own" on public.sessionmint_weekly_mints;
create policy "sessionmint_mints_rw_own" on public.sessionmint_weekly_mints
for all using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.sessionmint_mint_week(p_week_start date)
returns public.sessionmint_weekly_mints
language plpgsql
security definer
as $$
declare
  v_total int;
  v_count int;
  v_flow int;
  v_drag int;
  v_top_tags jsonb;
  v_row public.sessionmint_weekly_mints;
begin
  select
    coalesce(sum(duration_seconds),0),
    count(*),
    sum(case when feel='flow' then 1 else 0 end),
    sum(case when feel='drag' then 1 else 0 end)
  into v_total, v_count, v_flow, v_drag
  from public.sessionmint_sessions
  where user_id = auth.uid()
    and started_at >= p_week_start::timestamptz
    and started_at < (p_week_start + 7)::timestamptz;

  select coalesce(jsonb_agg(jsonb_build_object('tag', tag, 'seconds', secs) order by secs desc), '[]'::jsonb)
  into v_top_tags
  from (
    select tag, sum(duration_seconds) as secs
    from public.sessionmint_sessions
    where user_id = auth.uid()
      and started_at >= p_week_start::timestamptz
      and started_at < (p_week_start + 7)::timestamptz
    group by tag
    order by secs desc
    limit 5
  ) t;

  insert into public.sessionmint_weekly_mints(user_id, week_start, total_seconds, session_count, flow_count, drag_count, top_tags)
  values (auth.uid(), p_week_start, v_total, v_count, v_flow, v_drag, v_top_tags)
  on conflict (user_id, week_start)
  do update set
    total_seconds = excluded.total_seconds,
    session_count = excluded.session_count,
    flow_count = excluded.flow_count,
    drag_count = excluded.drag_count,
    top_tags = excluded.top_tags,
    created_at = now()
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.sessionmint_mint_week(date) from public;
grant execute on function public.sessionmint_mint_week(date) to authenticated;
