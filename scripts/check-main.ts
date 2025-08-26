import { spawn } from 'node:child_process';

async function main() {
  const child = spawn('node', ['dist/index.cjs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let sawBanner = false;

  const onData = (buf: Buffer) => {
    const s = buf.toString();
    if (s.includes('Code Reference Optimizer MCP server running on stdio')) {
      sawBanner = true;
      cleanup(0);
    }
  };

  const cleanup = (code: number) => {
    try { child.kill(); } catch {}
    process.exit(code);
  };

  child.stderr.on('data', onData);
  child.stdout.on('data', onData);

  child.on('error', (e) => {
    console.error('Failed to start main:', e);
    cleanup(1);
  });

  // Failsafe timeout
  setTimeout(() => {
    if (!sawBanner) {
      console.error('Main did not print readiness banner in time.');
      cleanup(1);
    }
  }, 2000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});