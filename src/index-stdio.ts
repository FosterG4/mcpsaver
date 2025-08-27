#!/usr/bin/env node
import CodeReferenceOptimizerServer from './index.js';

async function main() {
  const server = new CodeReferenceOptimizerServer();
  await server.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
