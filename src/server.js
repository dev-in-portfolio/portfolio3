const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3112);
const DATABASE_URL =
  process.env.QWIK_CARDFORGE_DATABASE_URL ||
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

function normalizeSlug(slug) {
  return String(slug).toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
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

app.get('/api/qcf/pages', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      `select id, title, slug, status, published_slug, created_at, updated_at
       from qcf_pages where user_id = $1 order by updated_at desc`,
      [userId]
    );
    res.json({ pages: rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/qcf/pages', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const title = String(req.body.title || '').trim().slice(0, 120);
    const slug = normalizeSlug(req.body.slug || '');
    if (!title || !slug) return res.status(400).json({ error: 'title and slug are required' });
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      `insert into qcf_pages (user_id, title, slug)
       values ($1, $2, $3)
       returning id, title, slug, status, published_slug, created_at, updated_at`,
      [userId, title, slug]
    );
    res.status(201).json({ page: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/qcf/pages/:id', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const pageRows = await pool.query(
      `select id, title, slug, status, published_slug, created_at, updated_at
       from qcf_pages where id = $1 and user_id = $2`,
      [req.params.id, userId]
    );
    if (!pageRows.rows[0]) return res.status(404).json({ error: 'page not found' });
    const cardRows = await pool.query(
      `select id, type, ord, title, body, image_url, embed_url from qcf_cards
       where page_id = $1 order by ord asc`,
      [req.params.id]
    );
    res.json({ page: pageRows.rows[0], cards: cardRows.rows });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/qcf/pages/:id', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const title = req.body.title ? String(req.body.title).slice(0, 120) : null;
    const slug = req.body.slug ? normalizeSlug(req.body.slug) : null;
    const status = req.body.status ? String(req.body.status) : null;
    const publishedSlug = status === 'published' ? crypto.randomBytes(6).toString('hex') : null;
    const { rows } = await pool.query(
      `update qcf_pages
       set title = coalesce($1, title), slug = coalesce($2, slug), status = coalesce($3, status),
           published_slug = coalesce($4, published_slug), updated_at = now()
       where id = $5 and user_id = $6
       returning id, title, slug, status, published_slug, created_at, updated_at`,
      [title, slug, status, publishedSlug, req.params.id, userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'page not found' });
    res.json({ page: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/qcf/pages/:id/cards', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const page = await pool.query('select id from qcf_pages where id = $1 and user_id = $2', [req.params.id, userId]);
    if (!page.rows[0]) return res.status(404).json({ error: 'page not found' });
    const type = String(req.body.type || '').trim();
    const ord = Number(req.body.ord);
    if (!type || !Number.isFinite(ord)) return res.status(400).json({ error: 'type and ord are required' });
    const { rows } = await pool.query(
      `insert into qcf_cards (page_id, type, ord, title, body, image_url, embed_url)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, type, ord, title, body, image_url, embed_url`,
      [
        req.params.id,
        type,
        ord,
        String(req.body.title || '').slice(0, 120),
        String(req.body.body || '').slice(0, 20000),
        String(req.body.imageUrl || '').slice(0, 500),
        String(req.body.embedUrl || '').slice(0, 500)
      ]
    );
    res.status(201).json({ card: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/qcf/cards/:cardId', requireDeviceKey, async (req, res, next) => {
  try {
    requireDb();
    const userId = await getUserId(req.deviceKey);
    const result = await pool.query(
      `delete from qcf_cards where id = $1 and page_id in (select id from qcf_pages where user_id = $2)`,
      [req.params.cardId, userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'card not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/qcf/public/:publishedSlug', async (req, res, next) => {
  try {
    requireDb();
    const pageRows = await pool.query(
      `select id, title, slug, status, published_slug, created_at, updated_at
       from qcf_pages where published_slug = $1 and status = 'published'`,
      [req.params.publishedSlug]
    );
    if (!pageRows.rows[0]) return res.status(404).json({ error: 'page not found' });
    const cards = await pool.query(
      `select id, type, ord, title, body, image_url, embed_url from qcf_cards where page_id = $1 order by ord asc`,
      [pageRows.rows[0].id]
    );
    res.json({ page: pageRows.rows[0], cards: cards.rows });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) app.listen(PORT, () => console.log(`qwik-cardforge listening on ${PORT}`));

module.exports = app;
