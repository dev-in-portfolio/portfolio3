const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3135);
const DATABASE_URL =
  process.env.STREAMLIT_DATABASE_URL ||
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
  await pool.query('insert into st_users(device_key) values ($1) on conflict do nothing', [deviceKey]);
  const row = await pool.query('select id from st_users where device_key = $1', [deviceKey]);
  return row.rows[0].id;
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

app.get('/api/streamlit/notes', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const { rows } = await pool.query(
      'select id, title, body, tags, created_at, updated_at from st_notes where user_id = $1 order by updated_at desc',
      [userId]
    );
    res.json({ notes: rows });
  } catch (error) { next(error); }
});

app.post('/api/streamlit/notes', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '');
    const tags = Array.isArray(req.body.tags) ? req.body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 30) : [];
    if (!title) return res.status(400).json({ error: 'title required' });
    if (!body) return res.status(400).json({ error: 'body required' });
    const { rows } = await pool.query(
      `insert into st_notes (user_id, title, body, tags)
       values ($1, $2, $3, $4)
       returning id, title, body, tags, created_at, updated_at`,
      [userId, title, body, tags]
    );
    res.status(201).json({ note: rows[0] });
  } catch (error) { next(error); }
});

app.patch('/api/streamlit/notes/:id', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const existing = await pool.query('select * from st_notes where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'note not found' });

    const title = req.body.title != null ? String(req.body.title).trim() : existing.rows[0].title;
    const body = req.body.body != null ? String(req.body.body) : existing.rows[0].body;
    const tags = Array.isArray(req.body.tags)
      ? req.body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 30)
      : existing.rows[0].tags;

    const { rows } = await pool.query(
      `update st_notes
       set title = $1, body = $2, tags = $3, updated_at = now()
       where id = $4 and user_id = $5
       returning id, title, body, tags, created_at, updated_at`,
      [title, body, tags, req.params.id, userId]
    );
    res.json({ note: rows[0] });
  } catch (error) { next(error); }
});

app.delete('/api/streamlit/notes/:id', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    await pool.query('delete from st_notes where id = $1 and user_id = $2', [req.params.id, userId]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/streamlit/query', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const q = String(req.body.q || '').trim();
    const tags = Array.isArray(req.body.tags) ? req.body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [];
    const params = [userId];
    let where = 'where user_id = $1';
    if (q) {
      params.push(`%${q}%`);
      where += ` and (title ilike $${params.length} or body ilike $${params.length})`;
    }
    if (tags.length) {
      params.push(tags);
      where += ` and tags @> $${params.length}`;
    }
    const { rows } = await pool.query(
      `select id, title, body, tags, created_at, updated_at
       from st_notes ${where}
       order by updated_at desc limit 100`,
      params
    );
    res.json({ results: rows });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) app.listen(PORT, () => console.log(`streamlit runtime listening on ${PORT}`));

module.exports = app;
