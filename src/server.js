const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3092);
const DATABASE_URL =
  process.env.DIFFATLAS_DATABASE_URL ||
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
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => {
  const fnPrefix = '/.netlify/functions/server';
  if (req.url === fnPrefix) {
    req.url = '/';
  } else if (req.url.startsWith(`${fnPrefix}/`)) {
    req.url = req.url.slice(fnPrefix.length);
  }
  next();
});

function requireDb() {
  if (!pool) {
    const error = new Error('DATABASE_URL not configured');
    error.status = 500;
    throw error;
  }
}

function hashRecord(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/health/db', async (_req, res) => {
  if (!pool) return res.json({ ok: false, error: 'DATABASE_URL not configured' });
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/jobs', async (_req, res, next) => {
  try {
    requireDb();
    const { rows } = await pool.query('select id, name, key_field, created_at from diff_jobs order by created_at desc');
    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs', async (req, res, next) => {
  try {
    requireDb();
    const name = String(req.body.name || '').trim().slice(0, 120);
    const keyField = String(req.body.keyField || 'id').trim().slice(0, 80);
    if (!name) {
      const error = new Error('name required');
      error.status = 422;
      throw error;
    }
    const { rows } = await pool.query(
      'insert into diff_jobs (name, key_field) values ($1, $2) returning id, name, key_field, created_at',
      [name, keyField]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:jobId/snapshots', async (req, res, next) => {
  try {
    requireDb();
    const { rows } = await pool.query(
      `select s.id, s.label, s.created_at, count(r.id)::int as record_count
       from diff_snapshots s
       left join diff_records r on r.snapshot_id = s.id
       where s.job_id = $1
       group by s.id
       order by s.created_at desc`,
      [req.params.jobId]
    );
    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:jobId/snapshots', async (req, res, next) => {
  const client = await pool.connect();
  try {
    requireDb();
    const label = String(req.body.label || '').trim().slice(0, 120);
    const records = Array.isArray(req.body.records) ? req.body.records : [];
    if (!label || records.length === 0) {
      const error = new Error('label and records required');
      error.status = 422;
      throw error;
    }
    const { rows } = await client.query('select key_field from diff_jobs where id = $1 limit 1', [req.params.jobId]);
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
    const keyField = rows[0].key_field;

    await client.query('begin');
    const snap = await client.query(
      'insert into diff_snapshots (job_id, label) values ($1, $2) returning id, label, created_at',
      [req.params.jobId, label]
    );
    const snapshotId = snap.rows[0].id;
    for (const rec of records.slice(0, 5000)) {
      const recordKey = String(rec[keyField] ?? '');
      if (!recordKey) continue;
      await client.query(
        'insert into diff_records (snapshot_id, record_key, record_hash, record_json) values ($1, $2, $3, $4)',
        [snapshotId, recordKey, hashRecord(rec), rec]
      );
    }
    await client.query('commit');
    res.status(201).json({ id: snapshotId, label: snap.rows[0].label, createdAt: snap.rows[0].created_at });
  } catch (error) {
    await client.query('rollback');
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/jobs/:jobId/compare', async (req, res, next) => {
  try {
    requireDb();
    const baseSnapshot = String(req.body.baseSnapshot || '');
    const compareSnapshot = String(req.body.compareSnapshot || '');
    if (!baseSnapshot || !compareSnapshot) {
      const error = new Error('baseSnapshot and compareSnapshot required');
      error.status = 422;
      throw error;
    }
    const base = await pool.query('select record_key, record_hash, record_json from diff_records where snapshot_id = $1', [baseSnapshot]);
    const cmp = await pool.query('select record_key, record_hash, record_json from diff_records where snapshot_id = $1', [compareSnapshot]);
    const mapBase = new Map(base.rows.map((r) => [r.record_key, r]));
    const mapCmp = new Map(cmp.rows.map((r) => [r.record_key, r]));
    const added = [];
    const removed = [];
    const modified = [];
    for (const [key, row] of mapCmp) {
      if (!mapBase.has(key)) added.push(row.record_json);
      else if (mapBase.get(key).record_hash !== row.record_hash) {
        modified.push({ key, before: mapBase.get(key).record_json, after: row.record_json });
      }
    }
    for (const [key, row] of mapBase) {
      if (!mapCmp.has(key)) removed.push(row.record_json);
    }
    const result = await pool.query(
      `insert into diff_results (job_id, base_snapshot, compare_snapshot, added, removed, modified)
       values ($1, $2, $3, $4, $5, $6)
       returning id, created_at`,
      [req.params.jobId, baseSnapshot, compareSnapshot, added, removed, modified]
    );
    res.json({
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at,
      summary: { added: added.length, removed: removed.length, modified: modified.length }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:jobId/results', async (req, res, next) => {
  try {
    requireDb();
    const { rows } = await pool.query(
      `select id, base_snapshot, compare_snapshot, jsonb_array_length(added) as added_count,
              jsonb_array_length(removed) as removed_count, jsonb_array_length(modified) as modified_count, created_at
       from diff_results where job_id = $1 order by created_at desc limit 50`,
      [req.params.jobId]
    );
    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`diffatlas listening on ${PORT}`));
}

module.exports = app;
