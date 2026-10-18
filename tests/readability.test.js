import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSources } from '../scripts/check-readability.mjs';

const semanticRoot = `
:root {
  --text-body: 1.125rem;
  --text-control: 1rem;
  --text-meta: .875rem;
  --text-title: 2.5rem;
}
html { font-size: 100%; }
`;

function audit(css = '', jsx = '') {
  return auditSources([
    { path: 'src/styles.css', content: semanticRoot + css },
    { path: 'src/Fixture.jsx', content: jsx },
  ]);
}

function hasIssue(result, pattern) {
  assert.ok(result.issues.some(issue => pattern.test(issue.message)),
    `Expected ${pattern}; got ${JSON.stringify(result.issues)}`);
}

test('readability: semantic body, controls and true metadata pass without page scaling', () => {
  const result = audit(`
body, p { font-size: var(--text-body); }
button, input, [role="tab"] { font-size: var(--text-control); }
small { font-size: var(--text-meta); }
h1 { font-size: clamp(2rem, 4vw, 4rem); }
`, '<p>Body</p><button>Enter</button><small>Version</small>');
  assert.deepEqual(result.issues, []);
  assert.equal(result.stats.fontSizes, 5);
  assert.equal(result.stats.customVariableDeclarations, 4);
});

test('readability: exact 18 / 16 / 14 px floors are enforced on explicit sizes', () => {
  const result = audit('p { font-size: 17.9px; } button { font-size: 15.9px; } small { font-size: 13.9px; }');
  assert.equal(result.issues.length, 3);
  for (const floor of [18, 16, 14]) hasIssue(result, new RegExp(`低于 ${floor}px`));
  assert.deepEqual(audit('p { font-size: 18px; } button { font-size: 16px; } small { font-size: 14px; }').issues, []);
});

test('readability: rem, em and percent follow the default 16 px root baseline', () => {
  assert.deepEqual(audit('p { font-size: 1.125rem; } button { font-size: 1em; } small { font-size: 87.5%; }').issues, []);
  const result = audit('p { font-size: 1rem; } button { font-size: .875em; } small { font-size: 80%; }');
  assert.equal(result.issues.length, 3);
});

test('readability: font shorthand cannot conceal small CSS or JSX text', () => {
  const result = audit(`
p { font: italic 600 1rem/1.8 "Segoe UI", sans-serif; }
button { font: 700 var(--text-meta)/1.5 sans-serif; }
`, '<button style={{ font: "600 14px/1.5 sans-serif" }}>Enter</button>');
  assert.equal(result.issues.length, 3);
  assert.equal(result.stats.fontShorthands, 2);
  assert.equal(result.stats.inlineFonts, 1);
  for (const issue of result.issues) assert.match(issue.message, /font 简写/);
  assert.deepEqual(audit('p { font: 500 var(--text-body)/1.8 sans-serif; } button { font: inherit; }').issues, []);
});

test('readability: local and mobile semantic-variable overrides are checked conservatively', () => {
  const result = audit(`
.local { --text-body: 16px; }
@media (max-width: 390px) {
  :root { --text-control: .875rem; }
  p { font-size: var(--text-body); }
  button { font-size: var(--text-control); }
}
`);
  assert.equal(result.stats.mediaQueries, 1);
  hasIssue(result, /--text-body: 16px 未达到 18px/);
  hasIssue(result, /--text-control: .875rem 未达到 16px/);
  hasIssue(result, /p 为 16px/);
  hasIssue(result, /button 为 14px/);
});

test('readability: alias variables, nested fallbacks and cycles are handled', () => {
  assert.deepEqual(audit(`
:root { --text-reading: var(--text-body); }
p { font-size: var(--text-reading); }
button { font-size: var(--missing-control, var(--text-control)); }
`).issues, []);
  hasIssue(audit(':root { --text-loop: var(--text-loop); } p { font-size: var(--text-loop); }'), /无法静态确认/);
  hasIssue(audit('button { font-size: var(--missing-control, 12px); }'), /低于 16px/);
});

test('readability: all semantic floor variables and an explicit 100 percent root are required', () => {
  const result = auditSources([{ path: 'src/missing.css', content: 'body { font-size: 18px; }' }]);
  assert.equal(result.issues.length, 4);
  for (const variable of ['--text-body', '--text-control', '--text-meta']) hasIssue(result, new RegExp(variable));
  hasIssue(result, /缺少显式 html/);
  hasIssue(audit('html { font-size: 112.5%; }'), /html 根字号必须保持 100%/);
});

test('readability: local selectors inherit floor from JSX roles and target classes only', () => {
  const result = audit(`
.reading { font-size: 16px; }
.action { font-size: 14px; }
.reading .meta { font-size: 14px; }
.reading, .meta { font-size: 16px; }
`, '<p className="reading">Body<span className="meta">Short date</span></p><div role="button" className="action">Enter</div>');
  assert.equal(result.issues.length, 3, 'ancestor reading class must not make short descendant metadata body text');
  hasIssue(result, /\.reading 为 16px，低于 18px/);
  hasIssue(result, /\.action 为 14px，低于 16px/);
});

test('readability: inline numeric, string and quoted property font sizes respect tag floors', () => {
  const result = audit('', `<p style={{ fontSize: 16 }}>Body</p>
<button style={{ fontSize: '14px' }}>Enter</button>
<span style={{ 'font-size': '12px' }}>Metadata</span>`);
  assert.equal(result.issues.length, 3);
  assert.equal(result.stats.inlineFonts, 3);
  assert.deepEqual(audit('', '<p style={{ fontSize: "var(--text-body)" }}>Body</p>').issues, []);
});

test('readability: responsive utility classes and arbitrary values cannot reduce text', () => {
  const result = audit('', `<p className="text-lg md:text-base">Body</p>
<button className="text-base sm:hover:text-sm">Enter</button>
<span className="text-[12px]">Metadata</span>`);
  assert.equal(result.issues.length, 3);
  assert.equal(result.stats.utilityClasses, 5);
  hasIssue(result, /工具类 text-base.*低于 18px/);
  hasIssue(result, /工具类 text-sm.*低于 16px/);
  hasIssue(result, /工具类 text-\[12px\].*低于 14px/);
});

test('readability: clamp lower bounds, min and max are validated without viewport guesses', () => {
  assert.deepEqual(audit('p { font-size: clamp(18px, 2vw, 24px); } button { font-size: max(16px, 2vw); }').issues, []);
  hasIssue(audit('p { font-size: clamp(16px, 2vw, 24px); }'), /低于 18px/);
  hasIssue(audit('button { font-size: min(1rem, .75rem); }'), /低于 16px/);
  hasIssue(audit('p { font-size: calc(1rem + 2px); }'), /无法静态确认/);
});

test('readability: unrelated font tokens are rejected in favor of semantic size tokens', () => {
  const result = audit(':root { --font-small: 18px; } p { font-size: var(--font-small); }');
  hasIssue(result, /使用未统一的字号变量 --font-small/);
});

test('readability: CSS zoom and whole-page scale cannot hide a size regression', () => {
  for (const css of ['body { zoom: .9; }', 'main { transform: scale(.9); }', '#root { scale: .9; }']) {
    assert.equal(audit(css).issues.length, 1, css);
  }
  assert.deepEqual(audit('body { zoom: 1; } main { transform: scale(1); } .decoration { transform: scale(.8); }').issues, []);
});

test('readability: comments are ignored while useful source line numbers are preserved', () => {
  const css = `${semanticRoot}\n/* p { font-size: 8px; }\n   a multi-line note */\np { font-size: 16px; }`;
  const result = auditSources([{ path: 'src/comments.css', content: css }]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].file, 'src/comments.css');
  assert.equal(result.issues[0].line, css.split('\n').findIndex(line => line === 'p { font-size: 16px; }') + 1);
});

test('readability: current source tree retains compliant static font floors', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const collect = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(file);
    return /\.(?:css|jsx|tsx|js|ts)$/.test(file)
      ? [{ path: path.relative(root, file).replaceAll('\\', '/'), content: fs.readFileSync(file, 'utf8') }]
      : [];
  });
  const result = auditSources(collect(path.join(root, 'src')));
  assert.deepEqual(result.issues, [], JSON.stringify(result.issues, null, 2));
  assert.ok(result.stats.mediaQueries > 0, 'responsive CSS remains part of the audit');
  assert.ok(result.stats.customVariableUses > 0, 'semantic size tokens remain in use');
});
