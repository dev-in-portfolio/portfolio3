const express = require('express');
const db = require('../../db');
const { requireUserKey } = require('../../middleware/userKey');
const { createRateLimiter } = require('../../middleware/security');
const { validatePayload } = require('../../utils/validate');
const { compressText } = require('./service');

const rateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createCompressionRouter() {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    return res.renderView('index', {
      title: 'Compression',
      userKey: req.userKeyCookie,
      defaultLevels: [75, 50, 25],
      maxSentences: 60
    });
  }));

  router.get('/history', asyncHandler(async (req, res) => {
    const userKey = req.userKeyCookie;
    const { rows } = await db.query(
      'select id, options, result, created_at from compression_runs where user_key = $1 order by created_at desc limit 50',
      [userKey]
    );

    return res.renderView('history', {
      title: 'History',
      userKey,
      runs: rows
    });
  }));

  router.get('/run/:id', asyncHandler(async (req, res) => {
    const userKey = req.userKeyCookie;
    const { rows } = await db.query(
      'select id, original, options, result, created_at from compression_runs where id = $1 and user_key = $2',
      [req.params.id, userKey]
    );

    const run = rows[0];
    if (!run) {
      return res.status(404).renderView('run', {
        title: 'Run Not Found',
        userKey,
        run: null
      });
    }

    return res.renderView('run', {
      title: 'Run',
      userKey,
      run
    });
  }));

  router.post('/api/compress', requireUserKey, rateLimit, asyncHandler(async (req, res) => {
    const { error, value } = validatePayload(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    const result = compressText(value);
    const { rows } = await db.query(
      'insert into compression_runs (user_key, original, options, result) values ($1, $2, $3, $4) returning id',
      [req.userKey, value.text, { levels: value.levels, maxSentences: value.maxSentences }, result]
    );

    return res.json({ id: rows[0].id, result });
  }));

  router.get('/api/history', requireUserKey, asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      'select id, options, result, created_at from compression_runs where user_key = $1 order by created_at desc limit 50',
      [req.userKey]
    );

    return res.json({ runs: rows });
  }));

  router.get('/api/run/:id', requireUserKey, asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      'select id, original, options, result, created_at from compression_runs where id = $1 and user_key = $2',
      [req.params.id, req.userKey]
    );

    const run = rows[0];
    if (!run) {
      return res.status(404).json({ error: 'Run not found.' });
    }

    return res.json({ run });
  }));

  router.delete('/api/run/:id', requireUserKey, asyncHandler(async (req, res) => {
    await db.query(
      'delete from compression_runs where id = $1 and user_key = $2',
      [req.params.id, req.userKey]
    );

    return res.status(204).send();
  }));

  return router;
}

module.exports = {
  createCompressionRouter
};
