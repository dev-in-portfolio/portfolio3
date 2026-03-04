create extension if not exists pgcrypto;

create table if not exists st_users (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists st_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references st_users(id) on delete cascade,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_st_notes_user_time on st_notes(user_id, updated_at desc);
create index if not exists idx_st_notes_tags on st_notes using gin(tags);
