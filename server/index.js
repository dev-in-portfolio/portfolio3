import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || '';
const PORT = process.env.PORT || 3010;

if (!DATABASE_URL) {
  console.warn('DATABASE_URL is not set. API will fail until configured.');
}

const pool = new Pool({ connectionString: DATABASE_URL });

const app = express();
app.use(cors());
app.use(express.json({ limit: '128kb' }));

const MAX_VIEWS = 500;
const MAX_STATE_BYTES = 32 * 1024;

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
  if (!deviceKey) {
    return res.status(400).json({ error: 'Missing X-Device-Key header' });
  }
  req.deviceKey = deviceKey;
  next();
}

app.get('/api/switchboard/views', requireDeviceKey, async (req, res) => {
  try {
    const route = req.query.route || '/';
    const userId = await getUserId(req.deviceKey);
    const { rows } = await pool.query(
      `select id, name, route, state, created_at, updated_at
       from switchboard_views
       where user_id = $1 and route = $2
       order by updated_at desc`,
      [userId, route]
    );
    res.json({ views: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/switchboard/views', requireDeviceKey, async (req, res) => {
  try {
    const { name, route = '/', state } = req.body || {};
    if (!name || !state) {
      return res.status(400).json({ error: 'name and state are required' });
    }
    const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
    if (stateBytes > MAX_STATE_BYTES) {
      return res.status(400).json({ error: 'state exceeds 32kb' });
    }
    const userId = await getUserId(req.deviceKey);

    const { rows: countRows } = await pool.query(
      'select count(*)::int as count from switchboard_views where user_id = $1',
      [userId]
    );
    if (countRows[0].count >= MAX_VIEWS) {
      return res.status(400).json({ error: 'view limit reached' });
    }

    const { rows } = await pool.query(
      `insert into switchboard_views (user_id, name, route, state)
       values ($1, $2, $3, $4)
       returning id, name, route, state, created_at, updated_at`,
      [userId, name, route, state]
    );
    res.json({ view: rows[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/switchboard/views/:id', requireDeviceKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, state } = req.body || {};
    if (!name && !state) {
      return res.status(400).json({ error: 'name or state is required' });
    }
    const userId = await getUserId(req.deviceKey);

    if (state) {
      const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
      if (stateBytes > MAX_STATE_BYTES) {
        return res.status(400).json({ error: 'state exceeds 32kb' });
      }
    }

    const { rows } = await pool.query(
      `update switchboard_views
       set name = coalesce($1, name),
           state = coalesce($2, state),
           updated_at = now()
       where id = $3 and user_id = $4
       returning id, name, route, state, created_at, updated_at`,
      [name || null, state || null, id, userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'view not found' });
    }
    res.json({ view: rows[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/switchboard/views/:id', requireDeviceKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = await getUserId(req.deviceKey);
    const { rowCount } = await pool.query(
      'delete from switchboard_views where id = $1 and user_id = $2',
      [id, userId]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'view not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/switchboard/share/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      'select id, name, route, state, created_at, updated_at from switchboard_views where id = $1',
      [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'view not found' });
    }
    res.json({ view: rows[0] });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

if (require.main === module) app.listen(PORT, () => {
  console.log(`Switchboard API running on port ${PORT}`);
});

module.exports = app;
