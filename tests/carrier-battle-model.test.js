import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import { CARRIER_BATTLE_COUNTS, CARRIER_BATTLE_MOUNTS, sampleCarrierBattle, sampleBattleTurret, sampleBattleShot, sampleBattleDrone } from '../shared/carrierBattle.js';
import { sampleCarrierBattleCamera } from '../src/components/drone/carrierBattleCamera.js';

const paths = ['src/components/wonders/CarrierExperience.jsx', 'src/components/wonders/CarrierBattleHardware.jsx'];
const compiled = new Map(await Promise.all(paths.map(async path => {
  const file = new URL(`../${path}`, import.meta.url);
  const source = fs.readFileSync(file, 'utf8').replace('const deckMap=createDeckTexture(), hullMap=createHullTexture();', 'const deckMap=new THREE.Texture(), hullMap=new THREE.Texture();');
  return [path, { code: (await transformWithEsbuild(source, path, { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code, require: createRequire(file) }];
})));

function renderBattle({ reducedMotion = false } = {}) {
  const frames = [], effects = [], cleanups = [];
  let lazyIndex = 0, hardware;
  const react = { ...React, useRef: initial => ({ current: initial }), useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    lazy: () => lazyIndex++ === 0 ? hardware.default : hardware.CarrierBattleDock };
  const evaluate = path => {
    const item = compiled.get(path), module = { exports: {} };
    vm.runInNewContext(item.code, { module, exports: module.exports, require(id) {
      if (id === 'react') return react;
      if (id === '@react-three/fiber') return { useFrame: (fn, priority = 0) => frames.push({ fn, priority }), useThree() { throw Error('battle hardware must not own a camera'); } };
      if (id === './WonderPrimitives.jsx') return { Ocean() { throw Error('battle must share the town sea'); } };
      return item.require(id);
    } }); return module.exports;
  };
  hardware = evaluate(paths[1]);
  const carrier = evaluate(paths[0]);
  const create = node => {
    if (!React.isValidElement(node)) return null;
    if (typeof node.type === 'function') return create(node.type(node.props));
    const p = node.props;
    let object;
    if (node.type === 'mesh') object = new THREE.Mesh(p.geometry, p.material);
    else if (node.type === 'instancedMesh') object = new THREE.InstancedMesh(...p.args);
    else if (node.type === 'group' || node.type === React.Suspense) object = new THREE.Group();
    else throw Error(`Unexpected scene element ${String(node.type)}`);
    object.name = p.name || '';
    if (p.position) object.position.set(...p.position);
    if (p.rotation) object.rotation.set(...p.rotation);
    if (p.scale) typeof p.scale === 'number' ? object.scale.setScalar(p.scale) : object.scale.set(...p.scale);
    if (p.visible !== undefined) object.visible = p.visible;
    if (p.ref) typeof p.ref === 'function' ? p.ref(object) : p.ref.current = object;
    React.Children.forEach(p.children, child => { const next = create(child); if (next) object.add(next); });
    return object;
  };
  const battleTimeRef = { current: 0 }, timeRef = { current: 80000 };
  const root = create(React.createElement(carrier.TownCarrier, { timeRef, battleTimeRef, reducedMotion }));
  effects.forEach(fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); });
  return { root, battleTimeRef, frame(time) { battleTimeRef.current = time; frames.sort((a, b) => a.priority - b.priority).forEach(({ fn }) => fn()); root.updateMatrixWorld(true); }, dispose() { cleanups.forEach(fn => fn()); } };
}
const close = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);

test('battle lifts the original carrier once, hides its independent jet and returns the same geometry to the harbour', () => {
  const app = renderBattle(), hull = app.root.getObjectByName('town-carrier-lifting-hull');
  const deck = app.root.getObjectByName('town-carrier-walkable-deck'), geometry = deck.geometry;
  for (const time of [0, 58000, 78000, 88000, 98000, 120000, 140000, 150000, 88000, 0]) {
    app.frame(time);
    const expected = sampleCarrierBattle(time).carrier.height;
    close(hull.position.y, expected);
    close(new THREE.Box3().setFromObject(deck).max.y, expected);
    assert.equal(deck.geometry, geometry, 'no ship clone or geometry swap');
    assert.equal(app.root.getObjectByName('town-carrier-active-aircraft').visible, false);
    const allDecks = []; app.root.traverse(node => { if (node.name === 'town-carrier-walkable-deck') allDecks.push(node); });
    assert.equal(allDecks.length, 1);
  }
  app.dispose();
});

test('four real barrel endpoints match the same world-space muzzle used by every interception tracer', () => {
  const app = renderBattle(), matrix = new THREE.Matrix4(), end = new THREE.Vector3();
  const barrels = app.root.getObjectByName('carrier-battle-barrels');
  for (const time of [0, 22100, 30900, 45150, 56000, 88000, 104000, 125000]) {
    app.frame(time);
    for (let mount = 0; mount < CARRIER_BATTLE_MOUNTS.length; mount++) {
      barrels.getMatrixAt(mount * 5 + 4, matrix);
      end.set(0, .5, 0).applyMatrix4(matrix).applyMatrix4(barrels.matrixWorld);
      const pose = sampleBattleTurret(time, mount);
      end.toArray().forEach((value, axis) => close(value, pose.muzzle[axis]));
      for (let shot = 0; shot < CARRIER_BATTLE_COUNTS.shots; shot++) {
        const sampled = sampleBattleShot(time, shot);
        if (sampled.visible && sampled.mountId === mount) sampled.start.forEach((value, axis) => close(value, pose.muzzle[axis]));
      }
    }
  }
  app.dispose();
});

test('fixed berth stays at sea-level ground, hardware remains instanced and reduced motion never lifts', () => {
  const app = renderBattle(), matrix = new THREE.Matrix4();
  assert.ok(app.root.getObjectByName('carrier-battle-hardware').children.every(mesh => mesh.count === 0), 'uninitialized matrices cannot briefly render at the world origin');
  app.frame(110000);
  const dock = app.root.getObjectByName('carrier-battle-fixed-berth'); dock.getMatrixAt(0, matrix);
  const top = new THREE.Vector3(0, .5, 0).applyMatrix4(matrix).applyMatrix4(dock.matrixWorld); close(top.y, 0);
  assert.equal(dock.visible, true);
  const hardware = app.root.getObjectByName('carrier-battle-hardware');
  assert.equal(hardware.children.length, 10); assert.ok(hardware.children.every(node => node.isInstancedMesh));
  assert.ok(hardware.children.every(node => node.count <= node.instanceMatrix.count));
  app.frame(150000); assert.equal(dock.visible, false); app.dispose();
  const calm = renderBattle({ reducedMotion: true });
  for (const time of [0, 58000, 88000, 110000, 145000]) { calm.frame(time); close(calm.root.getObjectByName('town-carrier-lifting-hull').position.y, 0); }
  assert.equal(calm.root.getObjectByName('carrier-battle-plumes').material.opacity, 0); calm.dispose();
});

test('sliding roof reveals both real launch lanes in their first 100–300ms from desktop and phone director views', () => {
  const app = renderBattle(), ray = new THREE.Raycaster(), origin = new THREE.Vector3(), direction = new THREE.Vector3();
  const armour = app.root.getObjectByName('carrier-battle-armour');
  const hitsAt = (time, id, aspect) => {
    app.frame(time);
    const pose = sampleCarrierBattleCamera(time, aspect), drone = sampleBattleDrone(time, id, 'defense');
    origin.set(...pose.position); direction.set(...drone.position).sub(origin);
    ray.set(origin, direction.clone().normalize()); ray.far = direction.length() - .05;
    armour.computeBoundingSphere();
    return ray.intersectObject(armour, false);
  };
  // Establish that this is a genuine opening, not a permanently missing roof.
  assert.ok(hitsAt(96000, 0, 1.6).some(hit => hit.instanceId === 8 || hit.instanceId === 9));
  for (const aspect of [1440 / 900, 390 / 844]) for (const id of [0, 1]) for (const age of [100, 200, 300]) {
    const time = 98000 + id * 360 + age;
    assert.equal(hitsAt(time, id, aspect).length, 0, `roof or bay panel hides the initial launch: aspect=${aspect}, lane=${id}, age=${age}`);
    assert.ok(armour.count <= armour.instanceMatrix.count);
  }
  app.dispose();
});
