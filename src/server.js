require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const ejs = require('ejs');
const compression = require('compression');

const { applySecurity } = require('./middleware/security');
const { createCompressionRouter } = require('./apps/compression/routes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const VIEWS_DIR = path.join(__dirname, 'views');

function parseCookies(cookieHeader = '') {
  const cookies = {};
  cookieHeader.split(';').forEach((pair) => {
    const [rawKey, ...rest] = pair.trim().split('=');
    if (!rawKey) return;
    cookies[rawKey] = decodeURIComponent(rest.join('=') || '');
  });
  return cookies;
}

app.use((req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  let userKey = cookies.user_key;

  if (!userKey) {
    userKey = crypto.randomUUID();
    res.setHeader('Set-Cookie', `user_key=${encodeURIComponent(userKey)}; Path=/; SameSite=Lax`);
  }

  req.userKeyCookie = userKey;
  res.locals.userKey = userKey;
  next();
});

applySecurity(app);
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('views', VIEWS_DIR);
app.set('view engine', 'ejs');

app.use(async (req, res, next) => {
  res.renderView = async (view, data = {}) => {
    const viewPath = path.join(VIEWS_DIR, `${view}.ejs`);
    const layoutPath = path.join(VIEWS_DIR, 'layout.ejs');
    const body = await ejs.renderFile(viewPath, data, { async: true });
    const html = await ejs.renderFile(layoutPath, { ...data, body }, { async: true });
    res.send(html);
  };
  next();
});

app.use('/', createCompressionRouter());

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Server error.');
});

if (require.main === module) app.listen(PORT, () => {
  console.log(`Compression running on http://localhost:${PORT}`);
});

module.exports = app;
