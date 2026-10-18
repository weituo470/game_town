import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import { auditSources } from '../scripts/check-readability.mjs';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../src/components/FlightStatus.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/components/flight-status.css', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'FlightStatus.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, require: name => name.endsWith('.css') ? {} : require(name) });
const { FlightStatusView } = module.exports;
function elements(node, list = []) {
  if (Array.isArray(node)) node.forEach(child => elements(child, list));
  else if (node?.props) { list.push(node); elements(node.props.children, list); }
  return list;
}

test('free flight HUD reports arbitrarily high altitude without a fictional capped meter', () => {
  for (const height of [0, 24, 240, 10000, NaN, Infinity]) {
    const html = renderToStaticMarkup(FlightStatusView({ pose: { height, thrusting: true } }));
    assert.match(html, /aria-label="飞行高度"/);
    assert.ok(html.includes(`${Number.isFinite(height) ? height.toFixed(1) : '0.0'} 米`));
    assert.ok(!html.includes('role="meter"'));
    assert.ok(!html.includes('aria-valuemax'));
    assert.ok(!html.includes('NaN') && !html.includes('Infinity'));
    assert.ok(html.includes('不设飞行高度上限'));
  }
});

test('hover button exposes real toggle state, keyboard shortcut and one action per click', () => {
  let calls = 0;
  for (const hovering of [false, true]) {
    const view = FlightStatusView({ pose: { height: 140, speed: 0, hovering }, onToggleHover: () => calls++ });
    const button = elements(view).find(item => item.type === 'button');
    assert.equal(button.props['aria-pressed'], hovering);
    assert.equal(button.props['aria-keyshortcuts'], 'H');
    assert.equal(button.props.type, 'button');
    button.props.onClick();
    const html = renderToStaticMarkup(view);
    assert.ok(html.includes(hovering ? '悬停中 · 高度已锁定' : '已落在高处'));
    assert.ok(html.includes(hovering ? '解除悬停' : '悬停'));
  }
  assert.equal(calls, 2);
});

test('flight help matches the active camera and does not replace ascent with automatic hovering', () => {
  const follow = renderToStaticMarkup(FlightStatusView({ pose: { height: 80, thrusting: true }, viewMode: 'follow' }));
  const close = renderToStaticMarkup(FlightStatusView({ pose: { height: 80, speed: -2 }, viewMode: 'first-person' }));
  assert.ok(follow.includes('按住鼠标右键环视'));
  assert.ok(follow.includes('引擎点火 · 上升中'));
  assert.ok(close.includes('引擎熄火 · 下落中'));
  assert.ok(close.includes('Esc 释放'));
  assert.ok(close.includes('未悬停时松开喷气下落'));
});

test('free flight controls obey semantic font floors and retain a visible keyboard focus indicator', () => {
  const root = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.deepEqual(auditSources([{ path: 'src/styles.css', content: root }, { path: 'src/components/FlightStatus.jsx', content: source }, { path: 'src/components/flight-status.css', content: css }]).issues, []);
  assert.match(css, /\.jetpack-hover-button\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*var\(--text-control\)/);
  assert.match(css, /\.jetpack-hover-button:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /\.jetpack-status p\s*\{[^}]*font-size:\s*var\(--text-body\)/);
});
