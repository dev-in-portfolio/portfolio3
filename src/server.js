const path = require('path');
const fs = require('fs');
const express = require('express');
const { helmet, compression } = require('./middleware/security');
const causalityRoutes = require('./apps/causality/routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  const fnPrefix = "/.netlify/functions/server";
  if (req.url === fnPrefix) {
    req.url = "/";
  } else if (req.url.startsWith(`${fnPrefix}/`)) {
    req.url = req.url.slice(fnPrefix.length);
  }
  next();
});

app.set('view engine', 'ejs');

// Netlify function bundles change __dirname, so resolve paths defensively.
const candidateViews = [
  path.join(process.cwd(), 'src', 'views'),
  path.join(__dirname, 'views'),
];
const candidatePublic = [
  path.join(process.cwd(), 'public'),
  path.join(__dirname, '..', 'public'),
];
const viewsDir = candidateViews.find((p) => fs.existsSync(p)) || candidateViews[0];
const publicDir = candidatePublic.find((p) => fs.existsSync(p)) || candidatePublic[0];

app.set('views', viewsDir);
app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.render('index', { page: 'home' });
});

app.get('/history', (req, res) => {
  res.render('history', { page: 'history' });
});

app.get('/chain/:id', (req, res) => {
  res.render('chain', { page: 'chain', chainId: req.params.id });
});

app.use(causalityRoutes);

app.use((req, res) => {
  res.status(404).send('Not found');
});

if (require.main === module) app.listen(PORT, () => {
  console.log(`Causality running on http://localhost:${PORT}`);
});

module.exports = app;
