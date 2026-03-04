const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3133);
const DATABASE_URL =
  process.env.DASH_CLAIMSCOPE_DATABASE_URL ||
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
app.use(express.json({ limit: '256kb' }));
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
  await pool.query('insert into dcs_users(device_key) values ($1) on conflict do nothing', [deviceKey]);
  const row = await pool.query('select id from dcs_users where device_key = $1', [deviceKey]);
  return row.rows[0].id;
}

const fieldMap = {
  ER: 'er_visits',
  HOSP_DAY: 'hospital_days',
  ICU_DAY: 'icu_days',
  SURGERY: 'surgery_events',
  OUTPATIENT: 'outpatient_visits',
  AMBULANCE: 'ambulance_events',
  IMAGING: 'imaging_events'
};

function unitsForLine(benefitType, unit, scenario) {
  const key = fieldMap[String(benefitType || '').toUpperCase()];
  if (key) return Number(scenario[key] || 0);
  if (unit === 'per_day') return Number(scenario.hospital_days || 0);
  if (unit === 'per_visit') return Number(scenario.er_visits || 0);
  return Number(scenario.surgery_events || 0);
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

app.get('/api/claimscope/models', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const { rows } = await pool.query(
      'select id, name, notes, created_at, updated_at from dcs_benefit_models where user_id = $1 order by updated_at desc',
      [userId]
    );
    res.json({ models: rows });
  } catch (error) { next(error); }
});

app.post('/api/claimscope/models', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const name = String(req.body.name || '').trim();
    const notes = String(req.body.notes || '').slice(0, 2000);
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await pool.query(
      'insert into dcs_benefit_models (user_id, name, notes) values ($1, $2, $3) returning id, name, notes, created_at, updated_at',
      [userId, name, notes]
    );
    res.status(201).json({ model: rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/claimscope/models/:id/lines', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const own = await pool.query('select 1 from dcs_benefit_models where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!own.rows[0]) return res.status(404).json({ error: 'model not found' });
    const { rows } = await pool.query(
      `select id, benefit_type, amount, unit, max_units, waiting_days, is_enabled
       from dcs_benefit_lines where model_id = $1 order by benefit_type`,
      [req.params.id]
    );
    res.json({ lines: rows });
  } catch (error) { next(error); }
});

app.post('/api/claimscope/models/:id/lines', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const own = await pool.query('select 1 from dcs_benefit_models where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!own.rows[0]) return res.status(404).json({ error: 'model not found' });

    const payload = {
      benefit_type: String(req.body.benefit_type || '').trim(),
      amount: Number(req.body.amount || 0),
      unit: String(req.body.unit || '').trim(),
      max_units: Math.max(0, Number(req.body.max_units || 0)),
      waiting_days: Math.max(0, Number(req.body.waiting_days || 0)),
      is_enabled: req.body.is_enabled !== false
    };
    if (!payload.benefit_type || !payload.unit || !Number.isFinite(payload.amount)) {
      return res.status(400).json({ error: 'invalid benefit line payload' });
    }

    const { rows } = await pool.query(
      `insert into dcs_benefit_lines (model_id, benefit_type, amount, unit, max_units, waiting_days, is_enabled)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, benefit_type, amount, unit, max_units, waiting_days, is_enabled`,
      [req.params.id, payload.benefit_type, payload.amount, payload.unit, payload.max_units, payload.waiting_days, payload.is_enabled]
    );

    await pool.query('update dcs_benefit_models set updated_at = now() where id = $1', [req.params.id]);
    res.status(201).json({ line: rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/claimscope/models/:id/scenarios', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const own = await pool.query('select 1 from dcs_benefit_models where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!own.rows[0]) return res.status(404).json({ error: 'model not found' });
    const { rows } = await pool.query(
      'select id, name, inputs, created_at from dcs_claim_scenarios where model_id = $1 order by created_at desc',
      [req.params.id]
    );
    res.json({ scenarios: rows });
  } catch (error) { next(error); }
});

app.post('/api/claimscope/models/:id/scenarios', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const own = await pool.query('select 1 from dcs_benefit_models where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!own.rows[0]) return res.status(404).json({ error: 'model not found' });

    const name = String(req.body.name || '').trim();
    const inputs = req.body.inputs && typeof req.body.inputs === 'object' ? req.body.inputs : {};
    if (!name) return res.status(400).json({ error: 'scenario name required' });

    const { rows } = await pool.query(
      'insert into dcs_claim_scenarios (model_id, name, inputs) values ($1, $2, $3) returning id, name, inputs, created_at',
      [req.params.id, name, inputs]
    );
    res.status(201).json({ scenario: rows[0] });
  } catch (error) { next(error); }
});

app.post('/api/claimscope/models/:id/simulate', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const own = await pool.query('select 1 from dcs_benefit_models where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!own.rows[0]) return res.status(404).json({ error: 'model not found' });

    const scenario = req.body.scenario && typeof req.body.scenario === 'object' ? req.body.scenario : {};
    const { rows: lines } = await pool.query(
      `select benefit_type, amount, unit, max_units, waiting_days, is_enabled
       from dcs_benefit_lines where model_id = $1 order by benefit_type`,
      [req.params.id]
    );

    const breakdown = [];
    let totalPayout = 0;
    for (const line of lines) {
      if (!line.is_enabled) continue;
      const units = unitsForLine(line.benefit_type, line.unit, scenario);
      const eligible = Math.max(units - Number(line.waiting_days || 0), 0);
      const paid = Math.min(eligible, Number(line.max_units || 0));
      const payout = Number(line.amount) * paid;
      totalPayout += payout;
      breakdown.push({
        benefit_type: line.benefit_type,
        unit: line.unit,
        eligible_units: eligible,
        paid_units: paid,
        amount: Number(line.amount),
        payout: Number(payout.toFixed(2))
      });
    }

    const estimatedBills = Number(scenario.estimated_bills || 0);
    const gap = Number((estimatedBills - totalPayout).toFixed(2));

    res.json({
      summary: {
        total_payout: Number(totalPayout.toFixed(2)),
        estimated_bills: Number(estimatedBills.toFixed(2)),
        payout_gap: gap,
        payout_ratio: estimatedBills > 0 ? Number((totalPayout / estimatedBills).toFixed(4)) : null
      },
      breakdown
    });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) app.listen(PORT, () => console.log(`dash-claimscope listening on ${PORT}`));

module.exports = app;
