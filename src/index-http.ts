#!/usr/bin/env node
import CodeReferenceOptimizerServer from './index.js';

const server = new CodeReferenceOptimizerServer();
const port = Number(process.env.PORT) || 8081;
server.runHttp(port).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
