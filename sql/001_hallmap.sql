create extension if not exists pgcrypto;

create table if not exists hm_wings (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists hm_halls (
  id uuid primary key default gen_random_uuid(),
  wing_id uuid not null references hm_wings(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique(wing_id, slug),
  unique(wing_id, name)
);

create table if not exists hm_exhibits (
  id uuid primary key default gen_random_uuid(),
  hall_id uuid not null references hm_halls(id) on delete cascade,
  title text not null,
  slug text not null,
  summary text not null,
  tags text[] not null default '{}',
  body text not null,
  images jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(hall_id, slug)
);

create index if not exists idx_hm_halls_wing on hm_halls(wing_id);
create index if not exists idx_hm_exhibits_hall on hm_exhibits(hall_id);
create index if not exists idx_hm_exhibits_tags_gin on hm_exhibits using gin(tags);
