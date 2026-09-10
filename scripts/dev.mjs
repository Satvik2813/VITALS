import { spawn } from 'node:child_process';
import { python, root } from './python.mjs';
import path from 'node:path';
import fs from 'node:fs';

// Load repo-root .env into process.env BEFORE spawning children so Turbopack
// (which snapshots env at boot) can inline NEXT_PUBLIC_* into client bundles.
// Next.js's own loadEnvConfig inside next.config.ts is too late for Turbopack.
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
const children = [
  spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'apps/api', '--host', '127.0.0.1', '--port', '8000'],
    { cwd: root, stdio: 'inherit' },
  ),
  spawn(
    process.execPath,
    [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', 'apps/web', '--hostname', '127.0.0.1'],
    { cwd: root, stdio: 'inherit' },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
