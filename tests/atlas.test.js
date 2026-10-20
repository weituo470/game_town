import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import * as outdoor from '../src/minigames/outdoor.js';
import * as wonders from '../shared/wonders.js';
import * as park from '../shared/deepseek-park.js';
import * as gpt from '../shared/gpt-park.js';
import * as sphere from '../shared/sphere-landmark.js';
import * as offshore from '../shared/offshore-island.js';
import * as world from '../shared/world.js';
import * as catalog from '../src/lib/catalog.js';
import { auditSources } from '../scripts/check-readability.mjs';

// Transformed relative imports belong to TownAtlas.jsx, not this test file.
const require = createRequire(new URL('../src/components/TownAtlas.jsx', import.meta.url));
const source = fs.readFileSync(new URL('../src/components/TownAtlas.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/components/atlas.css', import.meta.url), 'utf8');
const transformed = await transformWithEsbuild(source, 'TownAtlas.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const module = { exports: {} };
vm.runInNewContext(transformed.code, {
  module, exports: module.exports,
  require(id) {
    if (id === '../minigames/outdoor.js') return outdoor;
    if (id === '../../shared/wonders.js') return wonders;
    if (id === '../../shared/deepseek-park.js') return park;
    if (id === '../../shared/gpt-park.js') return gpt;
    if (id === '../../shared/sphere-landmark.js') return sphere;
    if (id === '../../shared/offshore-island.js') return offshore;
    if (id === '../../shared/world.js') return world;
    if (id === '../lib/catalog.js') return catalog;
    if (id === './atlas.css') return {};
    return require(id);
  },
});
const TownAtlas = module.exports.default;

function elements(node, result = []) {
  if (Array.isArray(node)) node.forEach(item => elements(item, result));
  else if (node && typeof node === 'object' && node.props) {
    result.push(node);
    elements(node.props.children, result);
  }
  return result;
}

test('atlas: renders shared streets, reserved plots and all existing buildings', () => {
  const html = renderToStaticMarkup(TownAtlas({ onTravel() {} }));
  assert.equal((html.match(/data-street=/g) ?? []).length, world.STREETS.length);
  assert.equal((html.match(/data-plot=/g) ?? []).length, world.EMPTY_PLOTS.length);
  assert.equal((html.match(/data-building=/g) ?? []).length, world.WORLD_LOCATIONS.length);
  const map = wonders.WONDER_MAP;
  assert.ok(html.includes(`viewBox="${map.centerX - map.width / 2} ${map.centerZ - map.depth / 2} ${map.width} ${map.depth}"`));
  assert.match(html, /北方朝上/);
  assert.match(html, /虚线区域暂未建房，可自由穿行/);
  assert.match(html, /面积扩大至原来的 9 倍/);
  for (const game of catalog.GAMES) assert.ok(html.includes(game.name));
});

test('atlas: every navigation button calls exactly one server-approved destination', () => {
  const calls = [];
  const buttons = elements(TownAtlas({ onTravel: id => calls.push(id) })).filter(node => node.type === 'button');
  const destinations = [offshore.OFFSHORE_ISLAND.id, sphere.SPHERE_LANDMARK.id, park.DEEPSEEK_PARK.id, gpt.GPT_PARK.id, ...wonders.WONDERS.map(w => w.id), 'center', ...world.DISTRICTS.map(item => item.id), ...catalog.GAMES.map(item => item.id)];
  assert.equal(buttons.length, destinations.length);
  for (const button of buttons) {
    assert.equal(button.props.type, 'button');
    button.props.onClick();
  }
  assert.deepEqual(calls, destinations);
  for (const id of calls) {
    const destination = world.getDestination(id);
    assert.ok(destination, `Unknown destination: ${id}`);
    assert.ok(world.isWalkable(destination.x, destination.z), `Blocked arrival: ${id}`);
  }
});

test('atlas: labels stay outside scalable SVG and all map markers stay within the drawing', () => {
  const nodes = elements(TownAtlas({ onTravel() {} }));
  const drawing = nodes.find(node => node.props.className === 'atlas-svg');
  assert.ok(drawing.props['aria-label']);
  assert.equal(elements(drawing).filter(node => node.type === 'text').length, 0);
  const markers = nodes.filter(node => node.props.className === 'atlas-number' || node.props.className === 'atlas-direction');
  assert.equal(markers.length, world.DISTRICTS.length + catalog.GAMES.length + 4);
  for (const marker of markers) {
    for (const axis of ['left', 'top']) {
      const coordinate = Number.parseFloat(marker.props.style[axis]);
      assert.ok(coordinate > 0 && coordinate < 100, `${axis}: ${coordinate}`);
    }
  }
  assert.match(css, /\.atlas-number, \.atlas-direction\s*\{[^}]*font-size:\s*var\(--text-control\)/);
  assert.match(css, /\.town-atlas button\s*\{[^}]*min-height:\s*48px/);
});

test('atlas: local font declarations meet the project readability regression guard', () => {
  const root = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const audit = auditSources([
    { path: 'src/styles.css', content: root },
    { path: 'src/components/atlas.css', content: css },
    { path: 'src/components/TownAtlas.jsx', content: source },
  ]);
  assert.deepEqual(audit.issues, []);
});

test('atlas: sphere observation is separate from arrival and its marker uses shared coordinates', () => {
  const calls = []; let tours = 0;
  const nodes = elements(TownAtlas({ onTravel: id => calls.push(id), onSphereTour: () => { tours += 1; } }));
  const section = nodes.find(node => node.props['aria-label'] === '球幕剧场导航');
  const buttons = elements(section).filter(node => node.type === 'button');
  assert.equal(buttons.length, 2);
  buttons[1].props.onClick(); assert.equal(tours, 1); assert.deepEqual(calls, []);
  buttons[0].props.onClick(); assert.deepEqual(calls, ['sphere']);
  const marker = nodes.find(node => node.props['data-theme-park-marker'] === 'sphere');
  const map = wonders.WONDER_MAP, landmark = sphere.SPHERE_LANDMARK;
  assert.equal(marker.props.children, '球');
  assert.equal(marker.props.style.left, `${(landmark.x - map.centerX + map.width / 2) / map.width * 100}%`);
  assert.equal(marker.props.style.top, `${(landmark.z - map.centerZ + map.depth / 2) / map.depth * 100}%`);
  assert.match(nodes.find(node => node.props.className === 'atlas-svg').props['aria-label'], /球幕剧场/);
});

test('atlas: offshore dock, bridge and ship share world coordinates and separate arrival from observation', () => {
  const calls = []; let tours = 0;
  const nodes = elements(TownAtlas({ onTravel: id => calls.push(id), onOffshoreTour: () => { tours++; } }));
  for (const [id, shared] of [['dock', offshore.OFFSHORE_DOCK], ['bridge', offshore.OFFSHORE_BRIDGE]]) {
    const node = nodes.find(n => n.props['data-offshore-ground'] === id);
    assert.equal(node.props.x, shared.x - shared.width / 2);
    assert.equal(node.props.y, shared.z - shared.depth / 2);
    assert.equal(node.props.width, shared.width); assert.equal(node.props.height, shared.depth);
  }
  const ship = nodes.find(n => Object.hasOwn(n.props, 'data-offshore-vessel'));
  assert.equal(ship.props.width, offshore.OFFSHORE_ISLAND.width);
  assert.equal(ship.props.height, offshore.OFFSHORE_ISLAND.length);
  const section = nodes.find(n => n.props['aria-label'] === '远海浮动岛导航');
  const buttons = elements(section).filter(n => n.type === 'button');
  assert.equal(buttons.length, 2);
  buttons[1].props.onClick(); assert.equal(tours, 1); assert.deepEqual(calls, []);
  buttons[0].props.onClick(); assert.deepEqual(calls, ['offshore']);
  const html = renderToStaticMarkup(section);
  assert.match(html, /普通字体/); assert.match(html, /非官方科普场景/);
  assert.match(html, /上海交通大学/);
});

test('atlas: GPT island and bridge share geometry and offer optional immersive entry', () => {
  const calls = [];
  let tours = 0;
  const nodes = elements(TownAtlas({ onTravel: id => calls.push(id), onGptTour: () => { tours += 1; } }));
  const island = nodes.find(node => node.props['data-theme-park'] === 'gpt');
  const bridge = nodes.find(node => node.props['data-park-bridge'] === 'gpt');
  assert.equal(island.props.x, gpt.GPT_PARK.x - gpt.GPT_PARK.width / 2);
  assert.equal(island.props.y, gpt.GPT_PARK.z - gpt.GPT_PARK.depth / 2);
  assert.equal(island.props.width, gpt.GPT_PARK.width);
  assert.equal(island.props.height, gpt.GPT_PARK.depth);
  assert.equal(bridge.props.x, gpt.GPT_BRIDGE.x - gpt.GPT_BRIDGE.width / 2);
  assert.equal(bridge.props.y, gpt.GPT_BRIDGE.z - gpt.GPT_BRIDGE.depth / 2);
  const travel = nodes.find(node => node.props['aria-label'] === '前往GPT 主题园区');
  const tour = nodes.find(node => node.props['aria-label'] === '沉浸游览 GPT 主题园区');
  travel.props.onClick();
  tour.props.onClick();
  assert.deepEqual(calls, ['gpt']);
  assert.equal(tours, 1);
  const html = renderToStaticMarkup(TownAtlas({ onTravel() {} }));
  assert.match(html, /GPT 主题园区/);
  assert.match(html, /翡翠步桥/);
  assert.doesNotMatch(html, /沉浸游览/);
});

test('atlas: DeepSeek circular island, all three connecting bridges and independent tour use the shared contract', () => {
  const calls = [];
  let tours = 0;
  const nodes = elements(TownAtlas({ onTravel: id => calls.push(id), onDeepSeekTour: () => { tours += 1; } }));
  const island = nodes.find(node => node.props['data-theme-park'] === park.DEEPSEEK_PARK.id);
  assert.equal(island.type, 'circle');
  assert.equal(island.props.cx, park.DEEPSEEK_PARK.x);
  assert.equal(island.props.cy, park.DEEPSEEK_PARK.z);
  assert.equal(island.props.r, park.DEEPSEEK_PARK.radius);
  const bridges = nodes.filter(node => node.props['data-park-bridge'] === park.DEEPSEEK_PARK.id);
  assert.equal(bridges.length, 3);
  assert.equal(bridges.length, park.PARK_BRIDGES.length);
  bridges.forEach((bridge, index) => {
    const shared = park.PARK_BRIDGES[index];
    assert.equal(bridge.type, 'rect');
    assert.equal(bridge.props.x, shared.x - shared.width / 2);
    assert.equal(bridge.props.y, shared.z - shared.depth / 2);
    assert.equal(bridge.props.width, shared.width);
    assert.equal(bridge.props.height, shared.depth);
  });
  const section = nodes.find(node => node.props['aria-label'] === 'DeepSeek 园区导航');
  const buttons = elements(section).filter(node => node.type === 'button');
  assert.equal(buttons.length, 2);
  buttons[0].props.onClick();
  assert.deepEqual(calls, ['deepseek']);
  assert.equal(tours, 0);
  buttons[1].props.onClick();
  assert.deepEqual(calls, ['deepseek'], 'the observation entry must not teleport the player');
  assert.equal(tours, 1);
  const marker = nodes.find(node => node.props['data-theme-park-marker'] === park.DEEPSEEK_PARK.id);
  assert.equal(marker.props.children, 'D');
  const map = wonders.WONDER_MAP;
  assert.equal(marker.props.style.left, `${(park.DEEPSEEK_PARK.x - map.centerX + map.width / 2) / map.width * 100}%`);
  assert.equal(marker.props.style.top, `${(park.DEEPSEEK_PARK.z - map.centerZ + map.depth / 2) / map.depth * 100}%`);
  assert.equal(elements(TownAtlas({ onTravel() {} })).filter(node => node.type === 'button' && node.props.onClick === undefined).length, 0);
});
