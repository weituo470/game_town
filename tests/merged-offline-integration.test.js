import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as React from 'react';
import { transformWithEsbuild } from 'vite';
import * as world from '../shared/world.js';
import { DRONE_PROGRAMS, DRONE_PROGRAM_MENU, getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';
import { createDroneFleet, updateDroneFleet, DRONE_DRAGON, DRONE_STUNT } from '../shared/droneShow.js';
import { DROPLET_SHIPS, DROPLET_SCORE } from '../shared/droneDroplet.js';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import { createDropletBattleVisual } from '../src/components/drone/dropletBattleVisual.js';

test('merged public catalogue adds the carrier while preserving ambient-only black-hole boundaries', () => {
  assert.deepEqual(DRONE_PROGRAM_MENU.map(item => item.id).sort(), ['avatar', 'carrier-battle', 'droplet']);
  assert.equal(DRONE_PROGRAMS.length, 4);
  assert.equal(getDroneProgram('blackhole').ambientOnly, true);
  assert.equal(getDroneProgram('blackhole').supportsAudio, false);
  assert.equal(getDroneProgram('blackhole').duration, 90000);
  for (const item of DRONE_PROGRAM_MENU) {
    assert.equal(item.duration, 150000);
    assert.notEqual(item.ambientOnly, true);
    assert.doesNotMatch(item.description, /黑洞|片尾|彩蛋|自动接续/);
  }
  assert.equal(sampleDroneProgram(getDroneProgram('avatar').dragonTime, 'avatar').phase, 'dragon');
  assert.equal(getDroneProgram('avatar').recoveryTime, DRONE_STUNT.brakeStart);
});

test('all three public shows end normally without restoring the removed automatic black-hole finale', () => {
  for (const program of DRONE_PROGRAM_MENU) {
    let now = 0;
    const clock = createDroneShowClock({ now: () => now });
    clock.start({ program: program.id, speed: 2, view: 'fpv' });
    assert.equal(clock.snapshot().view, program.supportsFpv ? 'fpv' : 'cinematic');
    now = 75000;
    const state = clock.update();
    assert.equal(state.program, program.id); assert.equal(state.ended, true); assert.equal(state.paused, true);
    assert.equal(state.encoreFrom, null);
    assert.equal(clock.playEncore().program, program.id);
    now += 3600000;
    assert.equal(clock.update().program, program.id);
    clock.close(); assert.equal(clock.snapshot().active, false);
  }
});

test('offline dragon and four-batch fall coexist with the online fast mirror probe and delayed 216-ship explosions', () => {
  assert.equal(DRONE_STUNT.batchCount, 4);
  assert.equal(new Set(DRONE_STUNT.batchStarts).size, 4);
  assert.ok(DRONE_STUNT.batchStarts.every(time => time < DRONE_STUNT.brakeStart));
  assert.equal(sampleDroneProgram(DRONE_DRAGON.formed + 4000, 'avatar').phase, 'dragon');
  assert.equal(DROPLET_SHIPS.length, 216);
  assert.ok(DROPLET_SCORE.passHalfWidth * 2 / DROPLET_SCORE.passSeconds > 1000);
  for (const ship of DROPLET_SHIPS) {
    const delay = ship.explodeTime - ship.hitTime;
    assert.equal(delay, 13.64);
    assert.ok(ship.explodeTime * 1000 > DROPLET_SCORE.lastHit + 1200);
  }
  const visual = createDropletBattleVisual();
  try {
    assert.equal(visual.hull.count, 216); assert.equal(visual.mirror.material.metalness, 1);
    assert.ok(visual.mirror.material.roughness <= .005);
    visual.update(52000); assert.equal(visual.mirror.visible, true);
  } finally { visual.dispose(); }
});

test('switching the shared fleet through all merged programmes restores dragon geometry and identities exactly', () => {
  const fleet = createDroneFleet(2048), reference = createDroneFleet(2048), identities = fleet.identities.slice();
  for (const program of ['avatar', 'droplet', 'carrier-battle', 'blackhole', 'droplet']) {
    updateDroneProgram(fleet, 52000, { program });
    assert.deepEqual(fleet.identities, identities);
    assert.ok(fleet.positions.every(Number.isFinite));
    assert.ok(fleet.colors.every(Number.isFinite));
  }
  updateDroneProgram(fleet, 48000, { program: 'avatar' }); updateDroneFleet(reference, 48000);
  assert.deepEqual(fleet.positions, reference.positions);
  assert.deepEqual(fleet.colors, reference.colors);
  assert.deepEqual(fleet.sizes, reference.sizes);
});

const townFile = new URL('../src/components/Town.jsx', import.meta.url);
const { code: townCode } = await transformWithEsbuild(fs.readFileSync(townFile, 'utf8'), 'Town.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const realRequire = createRequire(townFile);
const componentNamespace = name => new Proxy({ __esModule: true, default: name }, { get(target, key) { return key in target ? target[key] : `${name}:${String(key)}`; } });
function elements(node, found = []) {
  if (Array.isArray(node)) node.forEach(child => elements(child, found));
  else if (React.isValidElement(node)) { found.push(node); elements(node.props.children, found); }
  return found;
}
function townTree(overrides = {}) {
  const hooks = { ...React, useRef: value => ({ current: value }), useState: value => [value, () => {}],
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
    lazy: loader => ({ $$typeof: Symbol.for('react.lazy'), loader,
      modulePath: loader.toString().match(/\bimport\(\s*["']([^"']+)["']\s*\)/)?.[1] }),
  };
  const module = { exports: {} };
  vm.runInNewContext(townCode, { module, exports: module.exports, require(id) {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return realRequire(id);
    if (id === '@react-three/fiber') return { Canvas: 'Canvas', useFrame() {} };
    if (id === '@react-three/drei') return { Html: 'Html', PerspectiveCamera: 'PerspectiveCamera', RoundedBox: 'RoundedBox' };
    if (id === '../../shared/world.js') return world;
    if (id === './drone/DroneShow.jsx') return { __esModule: true, default: id, DroneCamera: `${id}:DroneCamera` };
    if (id.endsWith('.css')) return {};
    return componentNamespace(id);
  } });
  const npcTimeRef = { current: 74000 }, droneTimeRef = { current: 88000 }, timeRef = { current: 90000 };
  const props = { active: true, viewMode: 'follow', npcTimeRef, droneTimeRef, timeRef, onSkyAppearance() {}, ...overrides };
  const tree = elements(module.exports.default(props));
  const scene = tree.find(node => typeof node.type === 'function' && node.props.npcTimeRef === npcTimeRef);
  assert.ok(scene);
  return { props, tree, nodes: elements(scene.type(scene.props)), npcTimeRef, droneTimeRef, timeRef };
}

test('merged Town keeps ambient sky enabled only for ordinary exploration, with one Canvas and unchanged input owner', () => {
  for (const mode of ['overview', 'follow', 'first-person', 'wonder', 'drone']) {
    for (const active of [true, false]) for (const reducedMotion of [true, false]) {
      const selections = [], onDeepSeekSelect = id => selections.push(id);
      const h = townTree({ viewMode: mode, active, reducedMotion, onDeepSeekSelect, droneFpv: { program: 'droplet' } });
      assert.equal(h.tree.filter(node => node.type === 'Canvas').length, 1);
      assert.equal(h.nodes.filter(node => node.type === './town/PlayerController').length, 1);
      const ambient = h.nodes.find(node => node.type === './town/AmbientBlackHole.jsx');
      assert.equal(ambient.props.enabled, active && ['overview', 'follow', 'first-person'].includes(mode));
      assert.equal(ambient.props.onAppearance, h.props.onSkyAppearance);
      assert.equal(ambient.props.timeRef, h.timeRef, 'black hole follows the actual sky and local preview, not NPC or show time');
      assert.equal(h.nodes.filter(node => node.type === './town/TownSky.jsx').length, 1);
      const parks = h.nodes.filter(node => node.type?.modulePath === './town/DeepSeekPark.jsx');
      assert.equal(parks.length, 1, 'the same deferred island stays in every town view');
      const park = parks[0];
      assert.equal(park.type.$$typeof, Symbol.for('react.lazy'));
      assert.equal(park.props.timeRef, h.npcTimeRef, 'park animations use the shared resident clock, never show or preview time');
      assert.equal(park.props.reducedMotion, reducedMotion);
      assert.equal(park.props.onSelect, active ? onDeepSeekSelect : undefined, 'inactive views cannot open the observation experience');
      if (active) { park.props.onSelect('whale'); assert.deepEqual(selections, ['whale']); }
      else assert.deepEqual(selections, []);
      const boundary = h.nodes.find(node => node.type === React.Suspense && elements(node.props.children).includes(park));
      assert.ok(boundary, 'island loading has its own Suspense boundary');
      assert.equal(boundary.props.fallback, null, 'island loading never replaces the shared town with a loading surface');
    }
  }
  const outdoor = townTree({ outdoorSelected: 'fishing' });
  assert.equal(outdoor.nodes.find(node => node.type === './town/AmbientBlackHole.jsx').props.enabled, false);
});

test('carrier and mirror-droplet render paths share the town without duplicating show geometry or hijacking shared clocks', () => {
  for (const program of ['avatar', 'droplet', 'carrier-battle', 'blackhole']) {
    const h = townTree({ viewMode: 'drone', active: false, droneFpv: { program } });
    const carrier = program === 'carrier-battle';
    const lazy = h.nodes.filter(node => node.type?.$$typeof === Symbol.for('react.lazy'));
    assert.equal(lazy.length, carrier ? 3 : 2);
    assert.deepEqual(lazy.map(node => node.type.modulePath).sort(),
      (carrier ? ['./town/DeepSeekPark.jsx', './town/SphereLandmark.jsx', './drone/CarrierBattleScene.jsx'] : ['./town/DeepSeekPark.jsx', './town/SphereLandmark.jsx']).sort());
    const sphere = lazy.find(node => node.type.modulePath === './town/SphereLandmark.jsx');
    assert.equal(sphere.props.timeRef, h.npcTimeRef);
    assert.equal(sphere.props.onSelect, undefined, 'cinematic input never opens the sphere viewer');
    const carrierScenes = lazy.filter(node => node.type.modulePath === './drone/CarrierBattleScene.jsx');
    assert.equal(carrierScenes.length, carrier ? 1 : 0, 'only the carrier programme may mount carrier battle geometry');
    if (carrier) assert.equal(carrierScenes[0].props.timeRef, h.droneTimeRef);
    const park = lazy.find(node => node.type.modulePath === './town/DeepSeekPark.jsx');
    assert.equal(park.props.timeRef, h.npcTimeRef);
    assert.equal(park.props.onSelect, undefined, 'cinematic input never opens the park tour');
    const formations = h.nodes.filter(node => node.type === './drone/DroneShow.jsx');
    assert.equal(formations.length, carrier ? 0 : 1);
    if (!carrier) { assert.equal(formations[0].props.program, program); assert.equal(formations[0].props.timeRef, h.droneTimeRef); }
    const harbour = h.nodes.find(node => node.type === './town/WonderIslands.jsx');
    assert.equal(harbour.props.battleTimeRef, carrier ? h.droneTimeRef : null);
    assert.equal(harbour.props.timeRef, h.npcTimeRef); assert.equal(harbour.props.lightTimeRef, h.timeRef);
    assert.equal(h.nodes.find(node => node.type === './town/AmbientBlackHole.jsx').props.enabled, false);
    const effects = h.nodes.find(node => node.type === './town/SceneEffects');
    assert.equal(effects.props.performanceMode, 'drone');
    assert.equal(effects.props.faithfulBlackHole, program === 'blackhole');
    assert.equal(h.nodes.filter(node => node.type === './drone/DroneShow.jsx:DroneCamera').length, 1);
  }
});
