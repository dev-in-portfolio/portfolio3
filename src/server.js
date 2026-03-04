const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3130);
const DATABASE_URL =
  process.env.ISLAND_INDEX_DATABASE_URL ||
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

const seedTags = ['signal', 'archive', 'atlas', 'index', 'field', 'relay', 'grid'];
const items = Array.from({ length: 60 }).map((_, index) => {
  const createdAt = new Date(Date.now() - index * 36 * 60 * 60 * 1000).toISOString();
  return {
    id: `item-${index + 1}`,
    title: `Island Record ${index + 1}`,
    summary: 'Curated content snapshot with lightweight metadata for fast indexing.',
    tags: [seedTags[index % seedTags.length], seedTags[(index + 2) % seedTags.length]],
    score: 40 + (index % 60),
    createdAt
  };
});

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
  await pool.query('insert into ii_users(device_key) values ($1) on conflict do nothing', [deviceKey]);
  const result = await pool.query('select id from ii_users where device_key = $1', [deviceKey]);
  return result.rows[0].id;
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

app.get('/api/items', (req, res) => {
  const search = String(req.query.search || '').toLowerCase();
  const tag = String(req.query.tag || '');
  const sort = String(req.query.sort || 'newest');
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 12)));

  let filtered = items.filter(
    (item) => (!search || item.title.toLowerCase().includes(search)) && (!tag || item.tags.includes(tag))
  );

  filtered = [...filtered].sort((a, b) => {
    if (sort === 'score') return b.score - a.score;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const total = filtered.length;
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  res.json({ items: paged, total, page, pageSize });
});

app.get('/api/views', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const { rows } = await pool.query(
      'select id, name, state, updated_at from ii_views where user_id = $1 order by updated_at desc',
      [userId]
    );
    res.json({ views: rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/views', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const state = req.body.state && typeof req.body.state === 'object' ? req.body.state : {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await pool.query(
      `insert into ii_views (user_id, name, route, state)
       values ($1, $2, '/', $3)
       on conflict (user_id, name)
       do update set state = excluded.state, updated_at = now()
       returning id, name, state, updated_at`,
      [userId, name, state]
    );
    res.status(201).json({ view: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/views', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const id = String(req.query.id || '');
    if (!id) return res.status(400).json({ error: 'id is required' });
    await pool.query('delete from ii_views where user_id = $1 and id = $2', [userId, id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) app.listen(PORT, () => console.log(`island-index listening on ${PORT}`));

module.exports = app;
