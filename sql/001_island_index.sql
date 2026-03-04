create extension if not exists pgcrypto;

create table if not exists ii_users (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists ii_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ii_users(id) on delete cascade,
  name text not null,
  route text not null default '/',
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);

create index if not exists idx_ii_views_user_route on ii_views(user_id, route);
