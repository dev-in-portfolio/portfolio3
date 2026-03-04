const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL =
  process.env.CAPSULECACHE_DATABASE_URL ||
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
        create table if not exists cc_users (
          id uuid primary key default gen_random_uuid(),
          device_key text not null unique,
          created_at timestamptz not null default now()
        )
      `);
      await pool.query(`
        create table if not exists cc_entries (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references cc_users(id) on delete cascade,
          namespace text not null,
          cache_key text not null,
          value_json jsonb not null,
          expires_at timestamptz null,
          updated_at timestamptz not null default now(),
          created_at timestamptz not null default now(),
          unique(user_id, namespace, cache_key)
        )
      `);
      await pool.query('create index if not exists idx_cc_entries_user_ns on cc_entries(user_id, namespace)');
      await pool.query('create index if not exists idx_cc_entries_expiry on cc_entries(expires_at)');
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  await schemaReady;
}

async function getUserId(deviceKey) {
  await pool.query('insert into cc_users (device_key) values ($1) on conflict do nothing', [deviceKey]);
  const { rows } = await pool.query('select id from cc_users where device_key = $1', [deviceKey]);
  return rows[0].id;
}

function requireDeviceKey(req, res, next) {
  const key = req.header('x-device-key');
  if (!key) return res.status(400).json({ error: 'Missing X-Device-Key header' });
  req.deviceKey = key;
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'capsulecache' }));

app.get('/api/health/db', async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });
  try {
    await ensureSchema();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/cache/:namespace/:key', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const namespace = String(req.params.namespace || '').trim();
    const cacheKey = String(req.params.key || '').trim();
    if (!namespace || !cacheKey) return res.status(400).json({ error: 'namespace and key required' });
    const ttlSeconds = Number(req.body.ttlSeconds || 0);
    const expiresAt = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;
    const value = req.body.value ?? null;
    const { rows } = await pool.query(
      `insert into cc_entries (user_id, namespace, cache_key, value_json, expires_at)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, namespace, cache_key)
       do update set value_json = excluded.value_json, expires_at = excluded.expires_at, updated_at = now()
       returning namespace, cache_key, value_json as value, expires_at, updated_at`,
      [userId, namespace, cacheKey, value, expiresAt]
    );
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

app.get('/api/cache/:namespace/:key', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const { namespace, key } = req.params;
    const { rows } = await pool.query(
      `select namespace, cache_key, value_json as value, expires_at, updated_at
       from cc_entries
       where user_id = $1 and namespace = $2 and cache_key = $3
         and (expires_at is null or expires_at > now())`,
      [userId, namespace, key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'cache_miss' });
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

app.get('/api/cache/:namespace', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const namespace = String(req.params.namespace || '').trim();
    const { rows } = await pool.query(
      `select cache_key, value_json as value, expires_at, updated_at
       from cc_entries
       where user_id = $1 and namespace = $2 and (expires_at is null or expires_at > now())
       order by updated_at desc
       limit 200`,
      [userId, namespace]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

app.delete('/api/cache/:namespace/:key', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const { namespace, key } = req.params;
    await pool.query('delete from cc_entries where user_id = $1 and namespace = $2 and cache_key = $3', [userId, namespace, key]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/admin/cleanup', requireDeviceKey, async (req, res, next) => {
  try {
    await ensureSchema();
    const userId = await getUserId(req.deviceKey);
    const { rowCount } = await pool.query('delete from cc_entries where user_id = $1 and expires_at is not null and expires_at <= now()', [userId]);
    res.json({ ok: true, removed: rowCount });
  } catch (e) { next(e); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`capsulecache listening on ${PORT}`));
}

module.exports = app;
