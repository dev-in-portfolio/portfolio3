const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL =
  process.env.GATEKEEPER_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  '';

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    })
  : null;

let schemaReady;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  const prefix = '/.netlify/functions/server';
  if (req.url === prefix) req.url = '/';
  else if (req.url.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length);
  next();
});

function requireDb() {
  if (!pool) {
    const err = new Error('DATABASE_URL not configured');
    err.status = 500;
    throw err;
  }
}

async function ensureSchema() {
  requireDb();
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query('create extension if not exists pgcrypto');
      await pool.query(`
        create table if not exists gk_users (
          id uuid primary key default gen_random_uuid(),
          device_key text not null unique,
          created_at timestamptz not null default now()
        )
      `);
      await pool.query(`
        create table if not exists gk_keys (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references gk_users(id) on delete cascade,
          label text not null,
          token text not null,
          enabled boolean not null default true,
          created_at timestamptz not null default now()
        )
      `);
      await pool.query(`
        create table if not exists gk_logs (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references gk_users(id) on delete cascade,
          route text not null,
          method text not null,
          status text not null,
          payload jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        )
      `);
      await pool.query('create index if not exists idx_gk_logs_user_time on gk_logs(user_id, created_at desc)');
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  await schemaReady;
}

async function getUserId(deviceKey) {
  await pool.query('insert into gk_users (device_key) values ($1) on conflict do nothing', [deviceKey]);
  const { rows } = await pool.query('select id from gk_users where device_key = $1', [deviceKey]);
  return rows[0].id;
}

function requireDeviceKey(req, res, next) {
  const key = req.header('x-device-key');
  if (!key) return res.status(400).json({ error: 'Missing X-Device-Key header' });
  req.deviceKey = key;
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'gatekeeper' }));
app.get('/api/health/db', async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });
  try {
    await ensureSchema();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/keys', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      'select id, label, enabled, created_at from gk_keys where user_id = $1 order by created_at desc',
      [userId]
    );
    res.json({ keys: rows });
  } catch (e) { next(e); }
});

app.post('/api/admin/keys', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const label = String(req.body.label || '').trim();
    const token = String(req.body.token || '').trim();
    if (!label || !token) return res.status(400).json({ error: 'label and token required' });
    const { rows } = await pool.query(
      'insert into gk_keys (user_id, label, token) values ($1, $2, $3) returning id, label, enabled, created_at',
      [userId, label, token]
    );
    res.status(201).json({ key: rows[0] });
  } catch (e) { next(e); }
});

app.delete('/api/admin/keys/:id', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    await pool.query('delete from gk_keys where id = $1 and user_id = $2', [req.params.id, userId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/proxy/simulate', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const route = String(req.body.route || '/').trim();
    const method = String(req.body.method || 'GET').toUpperCase();
    const apiKey = String(req.body.apiKey || '').trim();
    const payload = req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

    const { rows } = await pool.query(
      'select id from gk_keys where user_id = $1 and token = $2 and enabled = true limit 1',
      [userId, apiKey]
    );
    const allowed = Boolean(rows[0]);
    const status = allowed ? 'allowed' : 'blocked';

    await pool.query(
      'insert into gk_logs (user_id, route, method, status, payload) values ($1, $2, $3, $4, $5)',
      [userId, route, method, status, payload]
    );

    res.json({ ok: true, status, route, method, reason: allowed ? 'api_key_valid' : 'api_key_missing_or_invalid' });
  } catch (e) { next(e); }
});

app.get('/api/proxy/logs', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      'select id, route, method, status, payload, created_at from gk_logs where user_id = $1 order by created_at desc limit 100',
      [userId]
    );
    res.json({ logs: rows });
  } catch (e) { next(e); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`gatekeeper listening on ${PORT}`));
}

module.exports = app;
