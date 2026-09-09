import { spawn } from 'node:child_process';
import { python, root } from './python.mjs';
import path from 'node:path';
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
