create extension if not exists pgcrypto;

create table if not exists ddm_users (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists ddm_config_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ddm_users(id) on delete cascade,
  env text not null,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists ddm_config_items (
  snapshot_id uuid not null references ddm_config_snapshots(id) on delete cascade,
  key text not null,
  value text not null,
  value_hash text not null,
  primary key(snapshot_id, key)
);

create index if not exists idx_ddm_cfg_env_time on ddm_config_snapshots(user_id, env, created_at desc);
create index if not exists idx_ddm_cfg_key on ddm_config_items(key);
