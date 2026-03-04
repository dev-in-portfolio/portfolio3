const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3129);
const DATABASE_URL =
  process.env.POCKET_DOSSIER_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  '';

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
      max: 5
    })
  : null;

app.use(cors());
app.use(express.json({ limit: '64kb' }));
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
  const deviceKey = req.header('X-Device-Key');
  if (!deviceKey || deviceKey.length < 8) {
    return res.status(401).json({ error: 'Missing device key.' });
  }
  req.deviceKey = deviceKey;
  next();
}

async function ensureUser(deviceKey) {
  await pool.query('insert into pd_users(device_key) values ($1) on conflict do nothing', [deviceKey]);
  const result = await pool.query('select id from pd_users where device_key = $1', [deviceKey]);
  return result.rows[0].id;
}

function normalizeTag(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

function validateEntry(body) {
  if (!body || String(body).trim().length === 0) return 'Body required.';
  if (String(body).length > 20000) return 'Body too long.';
  return null;
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

const router = express.Router();
router.use(requireDeviceKey);

router.get('/entries', async (req, res) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const { q, tag, from, to, cursor, limit = '50' } = req.query;

    const filters = ['e.user_id = $1'];
    const values = [userId];
    let idx = 2;

    if (from) {
      values.push(from);
      filters.push(`e.occurred_at >= $${idx++}`);
    }
    if (to) {
      values.push(to);
      filters.push(`e.occurred_at <= $${idx++}`);
    }
    if (cursor) {
      values.push(cursor);
      filters.push(`e.occurred_at < $${idx++}`);
    }
    if (q) {
      values.push(`%${q}%`);
      filters.push(`(e.title ilike $${idx} or e.body ilike $${idx})`);
      idx++;
    }
    let tagJoin = '';
    if (tag) {
      values.push(normalizeTag(tag));
      tagJoin = `join pd_entry_tags det on det.entry_id = e.id join pd_tags dt on dt.id = det.tag_id and dt.name = $${idx++}`;
    }

    values.push(Math.min(Number(limit), 100));
    const sql = `
      select e.*, coalesce(array_agg(dt.name) filter (where dt.name is not null), '{}') as tags
      from pd_entries e
      left join pd_entry_tags det_all on det_all.entry_id = e.id
      left join pd_tags dt on dt.id = det_all.tag_id
      ${tagJoin}
      where ${filters.join(' and ')}
      group by e.id
      order by e.occurred_at desc
      limit $${idx}
    `;

    const result = await pool.query(sql, values);
    return res.json(result.rows);
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to list entries.' });
  }
});

router.post('/entries', async (req, res) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const { title = '', body, occurredAt, tags = [] } = req.body;
    const validation = validateEntry(body);
    if (validation) return res.status(400).json({ error: validation });

    const result = await pool.query('insert into pd_entries(user_id, title, body, occurred_at) values ($1,$2,$3,$4) returning *', [
      userId,
      title,
      body,
      occurredAt ?? new Date().toISOString()
    ]);
    const entry = result.rows[0];

    if (Array.isArray(tags) && tags.length > 0) {
      await replaceTags(userId, entry.id, tags);
    }

    const tagNames = Array.isArray(tags) ? tags.map(normalizeTag) : [];
    return res.status(201).json({ ...entry, tags: tagNames });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to create entry.' });
  }
});

router.patch('/entries/:id', async (req, res) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const { title, body, occurredAt, tags } = req.body;
    if (body) {
      const validation = validateEntry(body);
      if (validation) return res.status(400).json({ error: validation });
    }

    const existing = await pool.query('select * from pd_entries where id = $1 and user_id = $2', [req.params.id, userId]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Not found.' });

    const updated = await pool.query('update pd_entries set title = $1, body = $2, occurred_at = $3 where id = $4 returning *', [
      title ?? existing.rows[0].title,
      body ?? existing.rows[0].body,
      occurredAt ?? existing.rows[0].occurred_at,
      req.params.id
    ]);

    if (Array.isArray(tags)) {
      await replaceTags(userId, req.params.id, tags);
    }

    return res.json({ ...updated.rows[0], tags: Array.isArray(tags) ? tags.map(normalizeTag) : [] });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to update entry.' });
  }
});

router.delete('/entries/:id', async (req, res) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const result = await pool.query('delete from pd_entries where id = $1 and user_id = $2', [req.params.id, userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found.' });
    return res.json({ ok: true });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to delete entry.' });
  }
});

router.get('/tags', async (req, res) => {
  try {
    requireDb();
    const userId = await ensureUser(req.deviceKey);
    const result = await pool.query('select id, name from pd_tags where user_id = $1 order by name asc', [userId]);
    return res.json(result.rows);
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to list tags.' });
  }
});

async function replaceTags(userId, entryId, tags) {
  const normalized = tags.map(normalizeTag).filter(Boolean).slice(0, 25);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const entry = await client.query('select id from pd_entries where id = $1 and user_id = $2', [entryId, userId]);
    if (entry.rowCount === 0) throw new Error('Entry not found');
    const tagIds = [];
    for (const name of normalized) {
      const tag = await client.query(
        'insert into pd_tags(user_id, name) values ($1, $2) on conflict (user_id, name) do update set name = excluded.name returning id',
        [userId, name]
      );
      tagIds.push(tag.rows[0].id);
    }
    await client.query('delete from pd_entry_tags where entry_id = $1', [entryId]);
    for (const tagId of tagIds) {
      await client.query('insert into pd_entry_tags(entry_id, tag_id) values ($1, $2)', [entryId, tagId]);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

app.use('/api/dossier', router);

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'request_error', detail: error.message });
});

if (require.main === module) app.listen(PORT, () => console.log(`pocket-dossier listening on ${PORT}`));

module.exports = app;
