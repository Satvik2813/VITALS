import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const python =
  process.env.PYTHON_PATH ||
  path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(python)) {
    console.error('Create .venv and install apps/api/requirements.txt first. See README.');
    process.exit(1);
  }
  const child = spawn(python, process.argv.slice(2), {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONPATH: path.join(root, 'apps/api') },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}
