import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('node_modules/tsx/dist/cli.mjs')) {
  console.error('請先執行 npm ci。'); process.exit(1);
}
const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server/index.ts'], {
    stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code || 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
