import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['.git', 'node_modules', 'dist', '.data', 'coverage', 'qa', 'qa-artifacts']);
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const filename = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(filename) : [path.relative(root, filename).replaceAll('\\', '/')];
  });
}
let files;
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
} catch { files = []; }
if (!files.length) files = walk(root);
const problems = [];
for (const file of files) {
  if (/(^|\/)(node_modules|dist|\.data|\.openai|qa|qa-artifacts|deployment)\//.test(file) || /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example') || /\.local(?:\.|$)|\.(pem|key|p12|pfx|blend[0-9]*)$/.test(file)) {
    problems.push(`${file}: private or generated file`);
  }
  if (!/\.(?:js|jsx|mjs|json|md|txt|yml|yaml|html|css|svg)$/.test(file) && !['.env.example', 'LICENSE'].includes(file)) continue;
  const contents = fs.readFileSync(path.join(root, file), 'utf8');
  const lines = contents.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    // Narrow known credential formats; never echo the matching value.
    const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line);
    const providerToken = /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{32,})\b/.test(line);
    const localProfile = /[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+/i.test(line);
    if (privateKey || providerToken || localProfile) problems.push(`${file}:${index + 1}: ${localProfile ? 'personal workstation path' : 'possible credential'}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Open-source hygiene checks passed (${files.length} files). Pattern checks are not a guarantee of no secrets.`);
}
