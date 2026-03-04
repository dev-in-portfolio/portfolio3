const serverless = require('serverless-http');
const { createApp } = require('../server/index');

const app = createApp();

exports.handler = serverless(app);
