create extension if not exists pgcrypto;

create table if not exists pd_users (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists pd_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references pd_users(id) on delete cascade,
  title text not null default '',
  body text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pd_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references pd_users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table if not exists pd_entry_tags (
  entry_id uuid not null references pd_entries(id) on delete cascade,
  tag_id uuid not null references pd_tags(id) on delete cascade,
  primary key(entry_id, tag_id)
);

create index if not exists idx_pd_entries_user_time
  on pd_entries(user_id, occurred_at desc);

create index if not exists idx_pd_tags_user_name
  on pd_tags(user_id, name);

create index if not exists idx_pd_entry_tags_entry
  on pd_entry_tags(entry_id);

create or replace function pd_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_pd_touch on pd_entries;
create trigger trg_pd_touch
before update on pd_entries
for each row execute function pd_touch_updated_at();
