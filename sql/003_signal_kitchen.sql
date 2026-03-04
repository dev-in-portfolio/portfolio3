create extension if not exists pgcrypto;

create table if not exists sk_users (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists sk_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sk_users(id) on delete cascade,
  name text not null,
  seconds int not null check (seconds > 0 and seconds <= 86400),
  sound_profile text not null default 'default',
  haptic_profile text not null default 'default',
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table if not exists sk_timer_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sk_users(id) on delete cascade,
  preset_id uuid null references sk_presets(id) on delete set null,
  label text not null default '',
  started_at timestamptz not null default now(),
  target_seconds int not null check (target_seconds > 0 and target_seconds <= 86400),
  ended_at timestamptz null,
  status text not null default 'running'
    check (status in ('running', 'done', 'canceled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_sk_runs_user_time
  on sk_timer_runs(user_id, started_at desc);

create index if not exists idx_sk_runs_user_status
  on sk_timer_runs(user_id, status);

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'users'
  ) then
    insert into sk_users (device_key, created_at)
    select u.device_key, u.created_at
    from users u
    on conflict (device_key) do nothing;

    update sk_presets p
    set user_id = su.id
    from users u
    join sk_users su on su.device_key = u.device_key
    where p.user_id = u.id;

    update sk_timer_runs r
    set user_id = su.id
    from users u
    join sk_users su on su.device_key = u.device_key
    where r.user_id = u.id;
  end if;
end $$;
