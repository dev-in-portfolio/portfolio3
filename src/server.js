try {
  require('dotenv').config();
} catch {
  // Netlify provides env vars directly; dotenv is only needed for local dev.
}
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const ejs = require('ejs');
const compression = require('compression');

const { applySecurity } = require('./middleware/security');
const { createCompressionRouter } = require('./apps/compression/routes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const candidateViews = [
  path.join(process.cwd(), 'src', 'views'),
  path.join(__dirname, 'views'),
  path.join(__dirname, '..', 'src', 'views'),
];
const candidatePublic = [
  path.join(process.cwd(), 'public'),
  path.join(__dirname, '..', 'public'),
  path.join(__dirname, '..', '..', 'public'),
];
const VIEWS_DIR = candidateViews.find((p) => fs.existsSync(p)) || candidateViews[0];
const PUBLIC_DIR = candidatePublic.find((p) => fs.existsSync(p)) || candidatePublic[0];

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
app.use((req, _res, next) => {
  const fnPrefix = '/.netlify/functions/server';
  if (req.url === fnPrefix) {
    req.url = '/';
  } else if (req.url.startsWith(`${fnPrefix}/`)) {
    req.url = req.url.slice(fnPrefix.length);
  }
  next();
});
app.use(express.static(PUBLIC_DIR));

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
