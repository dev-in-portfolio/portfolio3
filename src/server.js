const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3134);
const DATABASE_URL =
  process.env.DASH_DRIFTMETER_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  '';

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false
    })
  : null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => {
  const fnPrefix = '/.netlify/functions/server';
  if (req.url === fnPrefix) req.url = '/';
  else if (req.url.startsWith(`${fnPrefix}/`)) req.url = req.url.slice(fnPrefix.length);
  next();
});

function requireDb() {
  if (!pool) {
    const err = new Error('DATABASE_URL not configured');
    err.status = 500;
    throw err;
  }
}

function requireDeviceKey(req, res, next) {
  const key = req.header('X-Device-Key');
  if (!key) return res.status(400).json({ error: 'Missing X-Device-Key header' });
  req.deviceKey = key;
  next();
}

async function ensureUser(deviceKey) {
  await pool.query('insert into ddm_users(device_key) values ($1) on conflict do nothing', [deviceKey]);
  const row = await pool.query('select id from ddm_users where device_key = $1', [deviceKey]);
  return row.rows[0].id;
}

function parseEnv(text) {
  const out = {};
  String(text || '').split(/\r?\n/).forEach((lineRaw) => {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) return;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (key) out[key] = value;
  });
  return out;
}

function parsePayload(payload) {
  const txt = String(payload || '').trim();
  if (!txt) return {};
  if (txt.startsWith('{')) {
    try {
      const obj = JSON.parse(txt);
      if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k), String(v)]));
    } catch (_e) {
      return parseEnv(txt);
    }
  }
  return parseEnv(txt);
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function riskLevel(key) {
  const upper = String(key).toUpperCase();
  if (/(TOKEN|KEY|SECRET|PASSWORD)/.test(upper)) return 'high';
  if (/(URL|HOST|PORT)/.test(upper)) return 'medium';
  return 'low';
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/health/db', async (_req, res) => {
  if (!pool) return res.json({ ok: false, error: 'DATABASE_URL not configured' });
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/driftmeter/envs', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const { rows } = await pool.query('select distinct env from ddm_config_snapshots where user_id = $1 order by env', [userId]);
    res.json({ envs: rows.map((r) => r.env) });
  } catch (error) { next(error); }
});

app.get('/api/driftmeter/snapshots', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const env = String(req.query.env || '').trim();
    if (!env) return res.status(400).json({ error: 'env required' });
    const { rows } = await pool.query(
      `select id, env, label, created_at
       from ddm_config_snapshots where user_id = $1 and env = $2
       order by created_at desc`,
      [userId, env]
    );
    res.json({ snapshots: rows });
  } catch (error) { next(error); }
});

app.post('/api/driftmeter/snapshots', requireDeviceKey, async (req, res, next) => {
  const client = await pool.connect();
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const env = String(req.body.env || '').trim();
    const label = String(req.body.label || '').trim();
    const raw = String(req.body.payload || '');
    if (!env || !label) return res.status(400).json({ error: 'env and label required' });

    const items = parsePayload(raw);
    await client.query('begin');
    const snap = await client.query(
      'insert into ddm_config_snapshots (user_id, env, label) values ($1, $2, $3) returning id, env, label, created_at',
      [userId, env, label]
    );

    const entries = Object.entries(items);
    for (const [key, value] of entries) {
      await client.query(
        'insert into ddm_config_items (snapshot_id, key, value, value_hash) values ($1, $2, $3, $4)',
        [snap.rows[0].id, key, String(value), hashValue(String(value))]
      );
    }

    await client.query('commit');
    res.status(201).json({ snapshot: { ...snap.rows[0], item_count: entries.length } });
  } catch (error) {
    await client.query('rollback');
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/driftmeter/compare', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const snapshotA = String(req.body.snapshot_a || '').trim();
    const snapshotB = String(req.body.snapshot_b || '').trim();
    if (!snapshotA || !snapshotB) return res.status(400).json({ error: 'snapshot_a and snapshot_b required' });

    const ownA = await pool.query('select 1 from ddm_config_snapshots where id = $1 and user_id = $2', [snapshotA, userId]);
    const ownB = await pool.query('select 1 from ddm_config_snapshots where id = $1 and user_id = $2', [snapshotB, userId]);
    if (!ownA.rows[0] || !ownB.rows[0]) return res.status(404).json({ error: 'snapshot not found' });

    const { rows } = await pool.query(
      `with a as (select key, value, value_hash from ddm_config_items where snapshot_id = $1),
            b as (select key, value, value_hash from ddm_config_items where snapshot_id = $2)
       select coalesce(a.key, b.key) as key,
              a.value as value_a,
              b.value as value_b,
              case
                when a.key is null then 'extra'
                when b.key is null then 'missing'
                when a.value_hash <> b.value_hash then 'changed'
                else 'same'
              end as status
       from a full outer join b on a.key = b.key
       order by key`,
      [snapshotA, snapshotB]
    );

    const diff = rows.map((r) => ({ ...r, risk: riskLevel(r.key) }));
    const weights = { high: 5, medium: 2, low: 1 };
    const riskScore = diff.reduce((acc, row) => acc + (row.status === 'changed' ? (weights[row.risk] || 0) : 0), 0);
    res.json({ diff, risk_score: riskScore });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) app.listen(PORT, () => console.log(`dash-driftmeter listening on ${PORT}`));

module.exports = app;
