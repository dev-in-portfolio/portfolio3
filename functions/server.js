import serverless from 'serverless-http';
import app from '../src/main.ts';
export const handler = serverless(app);
