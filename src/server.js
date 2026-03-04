const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3113);
const DATABASE_URL =
  process.env.QWIK_SIGNALTILL_DATABASE_URL ||
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
app.use(express.json({ limit: '128kb' }));
app.use((req, _res, next) => {
  const fnPrefix = '/.netlify/functions/server';
  if (req.url === fnPrefix) req.url = '/';
  else if (req.url.startsWith(`${fnPrefix}/`)) req.url = req.url.slice(fnPrefix.length);
  next();
});

function requireDb() {
  if (!pool) {
    const error = new Error('DATABASE_URL not configured');
    error.status = 500;
    throw error;
  }
}

async function getUserId(deviceKey) {
  const { rows } = await pool.query(
    `insert into users (device_key)
     values ($1)
     on conflict (device_key) do update set device_key = excluded.device_key
     returning id`,
    [deviceKey]
  );
  return rows[0].id;
}

function requireDeviceKey(req, res, next) {
  const deviceKey = req.header('X-Device-Key');
  if (!deviceKey) return res.status(400).json({ error: 'Missing X-Device-Key header' });
  req.deviceKey = deviceKey;
  next();
}

function evaluateStatus(valueNum, rule, manualStatus) {
  if (valueNum == null || !rule) return manualStatus || 'ok';
  const value = Number(valueNum);
  if (rule.bad_if_gt != null && value > Number(rule.bad_if_gt)) return 'bad';
  if (rule.bad_if_lt != null && value < Number(rule.bad_if_lt)) return 'bad';
  if (rule.warn_if_gt != null && value > Number(rule.warn_if_gt)) return 'warn';
  if (rule.warn_if_lt != null && value < Number(rule.warn_if_lt)) return 'warn';
  return 'ok';
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

app.get('/api/qst/board', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      `select id, name, kind, status, note, value_num, value_unit, updated_at, created_at
       from qst_signals where user_id = $1
       order by case status when 'bad' then 1 when 'warn' then 2 else 3 end, updated_at desc`,
      [userId]
    );
    res.json({ signals: rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/qst/signals', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const name = String(req.body.name || '').trim().slice(0, 100);
    const kind = String(req.body.kind || 'generic').slice(0, 80);
    const note = String(req.body.note || '').slice(0, 2000);
    const valueNum = req.body.valueNum ?? null;
    const valueUnit = String(req.body.valueUnit || '').slice(0, 20);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      `insert into qst_signals (user_id, name, kind, note, value_num, value_unit)
       values ($1, $2, $3, $4, $5, $6)
       returning id, name, kind, status, note, value_num, value_unit, updated_at, created_at`,
      [userId, name, kind, note, valueNum, valueUnit]
    );
    res.status(201).json({ signal: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/qst/signals/:id', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const ruleRows = await pool.query(
      'select warn_if_gt, warn_if_lt, bad_if_gt, bad_if_lt from qst_rules where user_id = $1 and signal_id = $2',
      [userId, req.params.id]
    );
    const computedStatus = evaluateStatus(req.body.valueNum, ruleRows.rows[0] || null, req.body.status || null);
    const { rows } = await pool.query(
      `update qst_signals
       set note = coalesce($1, note), value_num = coalesce($2, value_num), value_unit = coalesce($3, value_unit),
           status = $4, updated_at = now()
       where id = $5 and user_id = $6
       returning id, name, kind, status, note, value_num, value_unit, updated_at, created_at`,
      [
        req.body.note ? String(req.body.note).slice(0, 2000) : null,
        req.body.valueNum ?? null,
        req.body.valueUnit ? String(req.body.valueUnit).slice(0, 20) : null,
        computedStatus,
        req.params.id,
        userId
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'signal not found' });
    res.json({ signal: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/qst/signals/:id', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const result = await pool.query('delete from qst_signals where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'signal not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/qst/signals/:id/rule', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      'select warn_if_gt, warn_if_lt, bad_if_gt, bad_if_lt from qst_rules where user_id = $1 and signal_id = $2',
      [userId, req.params.id]
    );
    res.json({ rule: rows[0] || null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/qst/signals/:id/rule', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      `insert into qst_rules (user_id, signal_id, warn_if_gt, warn_if_lt, bad_if_gt, bad_if_lt)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, signal_id)
       do update set warn_if_gt = excluded.warn_if_gt, warn_if_lt = excluded.warn_if_lt,
                     bad_if_gt = excluded.bad_if_gt, bad_if_lt = excluded.bad_if_lt
       returning warn_if_gt, warn_if_lt, bad_if_gt, bad_if_lt`,
      [userId, req.params.id, req.body.warnIfGt ?? null, req.body.warnIfLt ?? null, req.body.badIfGt ?? null, req.body.badIfLt ?? null]
    );
    res.json({ rule: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/qst/signals/:id/rule', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    await pool.query('delete from qst_rules where user_id = $1 and signal_id = $2', [userId, req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) app.listen(PORT, () => console.log(`qwik-signaltill listening on ${PORT}`));

module.exports = app;
