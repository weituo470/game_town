import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditSources } from '../scripts/check-readability.mjs';

const studio = await readFile(new URL('../src/components/drone/AiDroneStudio.jsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/drone/ai-drone-studio.css', import.meta.url), 'utf8');
const baseCss = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('studio lazily imports the runtime compiler and never evaluates model code', () => {
  assert.match(studio, /await import\('\.\.\/\.\.\/\.\.\/shared\/aiDroneShow\.js'\)/);
  assert.doesNotMatch(studio, /import\s+[^\n]+from\s+['"][^'"]*aiDroneShow/);
  assert.doesNotMatch(studio, /\beval\s*\(|new Function\s*\(|dangerouslySetInnerHTML/);
  assert.match(studio, /validateAiDroneScore\(show\.score\)/);
  assert.match(studio, /onPlay\(current\.runtime\)/);
});

test('studio presents bounded labeled input, honest disabled status, cancellation and quota disclosure', () => {
  for (const expected of ['htmlFor="ai-drone-prompt"', 'maxLength={AI_DRONE_MAX_PROMPT}', 'aria-describedby="ai-drone-privacy"', 'aria-busy={busy}', '取消等待', 'DeepSeek', '每日 5 次', '同 IP', '失败或取消也可能扣次', '仅个人观演', '非真实无人机飞控', '不会自动重试', 'AI 编导暂未开放']) assert.ok(studio.includes(expected), expected);
  assert.match(studio, /disabled=\{busy \|\| checking \|\| !service\?\.enabled/);
  assert.equal((studio.match(/label: '/g) ?? []).length, 3);
  assert.doesNotMatch(studio, /setInterval|Math\.random|progressbar|百分之/);
});

test('failure and cancellation do not clear the last good preview or auto-retry generation', () => {
  assert.equal((studio.match(/client\.generate\(/g) ?? []).length, 1);
  assert.doesNotMatch(studio, /setCurrent\(null\)/);
  assert.match(studio, /flight\.current\?\.abort\(\)/);
  assert.match(studio, /回放不消耗生成额度/);
  assert.match(studio, /不保存模型密钥/);
});

test('studio is a dialog child, not a second modal or focus trap', () => {
  assert.doesNotMatch(studio, /role="dialog"|aria-modal|document\.addEventListener\('keydown'/);
  assert.match(studio, /onClick=\{onClose\}/);
});

test('quota can recover at Beijing midnight, on tab return and through a manual action without generating', () => {
  assert.match(studio, /usage\.resetAt - Date\.now\(\) \+ 100/);
  assert.match(studio, /\[usage\?\.resetAt\]/);
  assert.match(studio, /document\.addEventListener\('visibilitychange', refreshVisible\)/);
  assert.match(studio, /document\.removeEventListener\('visibilitychange', refreshVisible\)/);
  assert.match(studio, /document\.visibilityState === 'visible'/);
  assert.match(studio, /重新检查额度/);
  assert.match(studio, /onClick=\{\(\) => void refreshUsage\(true\)\}/);
  assert.match(studio, /return \(\) => clearTimeout\(timer\)/);
});

test('studio typography covers JSX classes, semantic tokens and mobile overrides', () => {
  const result = auditSources([
    { path: 'src/styles.css', content: baseCss },
    { path: 'src/components/drone/AiDroneStudio.jsx', content: studio },
    { path: 'src/components/drone/ai-drone-studio.css', content: css },
  ]);
  assert.deepEqual(result.issues, []);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /font-size: var\(--text-body, 1\.125rem\)/);
  assert.match(css, /font-size: var\(--text-control, 1rem\)/);
  assert.match(css, /font-size: var\(--text-meta, \.875rem\)/);
});
