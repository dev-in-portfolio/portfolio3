create extension if not exists pgcrypto;

create table if not exists dr_users (
  id uuid primary key default gen_random_uuid(),
  device_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists dr_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references dr_users(id) on delete cascade,
  title text not null,
  slug text not null,
  status text not null default 'draft' check (status in ('draft','published')),
  published_slug text null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, slug)
);

create table if not exists dr_cards (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references dr_pages(id) on delete cascade,
  type text not null check (type in ('text','image','embed','quote')),
  ord int not null,
  title text not null default '',
  body text not null default '',
  image_url text not null default '',
  embed_url text not null default '',
  created_at timestamptz not null default now(),
  unique(page_id, ord)
);

create index if not exists idx_dr_pages_user_status on dr_pages(user_id, status, updated_at desc);
create index if not exists idx_dr_cards_page_ord on dr_cards(page_id, ord);
