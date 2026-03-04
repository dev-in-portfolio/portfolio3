import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.warn('DATABASE_URL is not set. SignalGrid API will fail until configured.');
}

export const pool = new Pool({ connectionString: DATABASE_URL });

let schemaReady: Promise<void> | null = null;

async function ensureSignalGridSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        create extension if not exists pgcrypto;

        create table if not exists nsg_users (
          id uuid primary key default gen_random_uuid(),
          device_key text not null unique,
          created_at timestamptz not null default now()
        );

        create table if not exists nsg_signals (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references nsg_users(id) on delete cascade,
          name text not null,
          kind text not null default 'generic',
          status text not null default 'ok' check (status in ('ok','warn','bad')),
          note text not null default '',
          value_num numeric(14,4) null,
          value_unit text not null default '',
          updated_at timestamptz not null default now(),
          created_at timestamptz not null default now(),
          unique(user_id, name)
        );

        create table if not exists nsg_rules (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references nsg_users(id) on delete cascade,
          signal_id uuid not null references nsg_signals(id) on delete cascade,
          warn_if_gt numeric(14,4) null,
          warn_if_lt numeric(14,4) null,
          bad_if_gt numeric(14,4) null,
          bad_if_lt numeric(14,4) null,
          created_at timestamptz not null default now(),
          unique(user_id, signal_id)
        );

        create index if not exists idx_nsg_signals_user_status on nsg_signals(user_id, status);
        create index if not exists idx_nsg_signals_user_updated on nsg_signals(user_id, updated_at desc);
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function getUserId(deviceKey: string) {
  await ensureSignalGridSchema();
  const { rows } = await pool.query(
    `insert into nsg_users (device_key)
     values ($1)
     on conflict (device_key) do update set device_key = excluded.device_key
     returning id`,
    [deviceKey]
  );
  return rows[0].id;
}
