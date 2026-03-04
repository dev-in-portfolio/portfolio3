const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL =
  process.env.HALLMAP_DATABASE_URL ||
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
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => {
  const prefix = '/.netlify/functions/server';
  if (req.url === prefix) req.url = '/';
  else if (req.url.startsWith(`${prefix}/`)) req.url = req.url.slice(prefix.length);
  next();
});

function normalizeSlug(v) {
  return String(v || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTags(raw) {
  if (Array.isArray(raw)) return [...new Set(raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].sort();
  return [...new Set(String(raw || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
}

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
        create table if not exists hm_wings (
          id uuid primary key default gen_random_uuid(),
          name text not null unique,
          slug text not null unique,
          created_at timestamptz not null default now()
        )
      `);
      await pool.query(`
        create table if not exists hm_halls (
          id uuid primary key default gen_random_uuid(),
          wing_id uuid not null references hm_wings(id) on delete cascade,
          name text not null,
          slug text not null,
          created_at timestamptz not null default now(),
          unique(wing_id, slug),
          unique(wing_id, name)
        )
      `);
      await pool.query(`
        create table if not exists hm_exhibits (
          id uuid primary key default gen_random_uuid(),
          hall_id uuid not null references hm_halls(id) on delete cascade,
          title text not null,
          slug text not null,
          summary text not null,
          tags text[] not null default '{}',
          body text not null,
          images jsonb not null default '[]'::jsonb,
          created_at timestamptz not null default now(),
          unique(hall_id, slug)
        )
      `);
      await pool.query('create index if not exists idx_hm_halls_wing on hm_halls(wing_id)');
      await pool.query('create index if not exists idx_hm_exhibits_hall on hm_exhibits(hall_id)');
      await pool.query('create index if not exists idx_hm_exhibits_tags_gin on hm_exhibits using gin(tags)');
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  await schemaReady;
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'hallmap-studio' }));
app.get('/api/health/db', async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not configured' });
  try {
    await ensureSchema();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/hallmap/wings', async (req, res, next) => {
  try {
    await ensureSchema();
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const slug = normalizeSlug(req.body.slug || name);
    const { rows } = await pool.query(
      'insert into hm_wings (name, slug) values ($1, $2) on conflict (slug) do update set name = excluded.name returning *',
      [name, slug]
    );
    res.status(201).json({ wing: rows[0] });
  } catch (e) { next(e); }
});

app.get('/api/hallmap/wings', async (_req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query('select * from hm_wings order by name asc');
    res.json({ wings: rows });
  } catch (e) { next(e); }
});

app.post('/api/hallmap/halls', async (req, res, next) => {
  try {
    await ensureSchema();
    const wingId = String(req.body.wingId || '').trim();
    const name = String(req.body.name || '').trim();
    if (!wingId || !name) return res.status(400).json({ error: 'wingId and name required' });
    const slug = normalizeSlug(req.body.slug || name);
    const { rows } = await pool.query(
      `insert into hm_halls (wing_id, name, slug) values ($1, $2, $3)
       on conflict (wing_id, slug) do update set name = excluded.name
       returning *`,
      [wingId, name, slug]
    );
    res.status(201).json({ hall: rows[0] });
  } catch (e) { next(e); }
});

app.get('/api/hallmap/halls', async (req, res, next) => {
  try {
    await ensureSchema();
    const wingId = String(req.query.wingId || '').trim();
    const params = [];
    let where = '';
    if (wingId) {
      params.push(wingId);
      where = ` where h.wing_id = $1`;
    }
    const { rows } = await pool.query(
      `select h.*, w.name as wing_name
       from hm_halls h join hm_wings w on w.id = h.wing_id
       ${where}
       order by w.name asc, h.name asc`,
      params
    );
    res.json({ halls: rows });
  } catch (e) { next(e); }
});

app.post('/api/hallmap/exhibits', async (req, res, next) => {
  try {
    await ensureSchema();
    const hallId = String(req.body.hallId || '').trim();
    const title = String(req.body.title || '').trim();
    const summary = String(req.body.summary || '').trim();
    const body = String(req.body.body || '').trim();
    if (!hallId || !title || !summary || !body) return res.status(400).json({ error: 'hallId, title, summary, body required' });
    const slug = normalizeSlug(req.body.slug || title);
    const tags = normalizeTags(req.body.tags);
    const images = Array.isArray(req.body.images) ? req.body.images : [];
    const { rows } = await pool.query(
      `insert into hm_exhibits (hall_id, title, slug, summary, tags, body, images)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (hall_id, slug)
       do update set title = excluded.title, summary = excluded.summary, tags = excluded.tags, body = excluded.body, images = excluded.images
       returning *`,
      [hallId, title, slug, summary, tags, body, JSON.stringify(images)]
    );
    res.status(201).json({ exhibit: rows[0] });
  } catch (e) { next(e); }
});

app.get('/api/hallmap/exhibits', async (req, res, next) => {
  try {
    await ensureSchema();
    const q = String(req.query.q || '').trim();
    const tag = String(req.query.tag || '').trim().toLowerCase();
    const params = [];
    const where = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(e.title ilike $${params.length} or e.summary ilike $${params.length} or e.body ilike $${params.length})`);
    }
    if (tag) {
      params.push(tag);
      where.push(`$${params.length} = any(e.tags)`);
    }
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';
    const { rows } = await pool.query(
      `select e.id, e.title, e.slug, e.summary, e.tags, e.created_at,
              h.name as hall_name, w.name as wing_name
       from hm_exhibits e
       join hm_halls h on h.id = e.hall_id
       join hm_wings w on w.id = h.wing_id
       ${whereSql}
       order by e.created_at desc
       limit 200`,
      params
    );
    res.json({ exhibits: rows });
  } catch (e) { next(e); }
});

app.get('/api/hallmap/map', async (_req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `select w.id as wing_id, w.name as wing_name, h.id as hall_id, h.name as hall_name,
              coalesce(count(e.id), 0)::int as exhibits
       from hm_wings w
       left join hm_halls h on h.wing_id = w.id
       left join hm_exhibits e on e.hall_id = h.id
       group by w.id, w.name, h.id, h.name
       order by w.name asc, h.name asc`
    );
    res.json({ map: rows });
  } catch (e) { next(e); }
});

app.get('/api/hallmap/export', async (_req, res, next) => {
  try {
    await ensureSchema();
    const [w, h, e] = await Promise.all([
      pool.query('select * from hm_wings order by name asc'),
      pool.query('select * from hm_halls order by name asc'),
      pool.query('select * from hm_exhibits order by created_at desc')
    ]);
    res.json({ wings: w.rows, halls: h.rows, exhibits: e.rows });
  } catch (err) { next(err); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`hallmap-studio listening on ${PORT}`));
}

module.exports = app;
