import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTownServer } from '../server/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createTownServer();
const vite = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'inherit', windowsHide: true });
console.log(`联机服务 ${server.url} / 页面 http://127.0.0.1:5173`);
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (vite.exitCode === null) vite.kill();
  await server.close();
  process.exit(code);
}
vite.on('exit', code => void close(code || 0));
vite.on('error', error => { console.error(error.message); void close(1); });
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
