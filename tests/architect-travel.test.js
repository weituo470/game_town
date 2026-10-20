import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as React from 'react';
import { transformWithEsbuild } from 'vite';
import { Client } from '@colyseus/sdk';
import { createTownServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { ARCHITECT_PLOTS } from '../shared/architectPlan.js';
import { appendArchitectProjects, getArchitectProjects } from '../shared/architectWorld.js';
import { getDestination, isWalkable } from '../shared/world.js';

const projects = ARCHITECT_PLOTS.map((plot, index) => ({
  id: `arch-navigation-fixture-${index}`, createdAt: 1, day: '2026-10-20', source: 'autonomous',
  plan: { version: 1, name: `海风亭${index + 1}`, description: '只追加的导航验收工程。', plotId: plot.id, kind: 'pavilion', palette: 'sage', orientation: (index % 4) * 90 },
}));
const idFor = project => `architect-project:${project.id}`;
function safePoint(point) {
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.z) && Number.isFinite(point.yaw));
  for (const dx of [-0.45, 0, 0.45]) for (const dz of [-0.45, 0, 0.45])
    assert.equal(isWalkable(point.x + dx, point.z + dz), true, `safe footprint at ${point.x},${point.z}`);
}
test('architect destinations reject unbuilt IDs, bare plot IDs and coordinate-like inputs', () => {
  for (const project of projects) assert.equal(getDestination(idFor(project)), null);
  for (const value of [null, undefined, {}, [], 3, 'architect-project:', 'architect-project:../../center',
    `architect-project:${'x'.repeat(101)}`, 'architect-project:plot-1-1', 'plot-1-1', 'architect-project:0,0']) assert.equal(getDestination(value), null);
  safePoint(getDestination('architect'));
  assert.deepEqual(getDestination('center'), { x: 0, z: 9.5, yaw: Math.PI });
});
test('all twelve built project destinations stay outside buildings with player clearance and cannot be redirected', () => {
  assert.equal(appendArchitectProjects(projects), 12);
  for (let index = 0; index < projects.length; index++) {
    const project = projects[index], plot = ARCHITECT_PLOTS[index], point = getDestination(idFor(project));
    safePoint(point);
    assert.ok(Math.abs(point.x - plot.x) >= 2.7 || Math.abs(point.z - plot.z) >= 2.7);
    assert.ok(Math.abs(Math.hypot(point.x - plot.x, point.z - plot.z) - 3.3) < 0.000001);
    assert.equal(point.yaw, Math.atan2(plot.x - point.x, plot.z - point.z));
    assert.equal(appendArchitectProjects([{ ...project, plan: { ...project.plan, plotId: ARCHITECT_PLOTS[(index + 1) % 12].id } }]), 0);
    assert.deepEqual(getDestination(idFor(project)), point);
  }
  assert.equal(appendArchitectProjects([]), 0);
  assert.equal(getArchitectProjects().length, 12);
  assert.equal(getDestination('architect-project:still-not-built'), null);
  safePoint(getDestination('architect'));
});

const panelFile = new URL('../src/components/architect/ArchitectPanel.jsx', import.meta.url);
const compiled = (await transformWithEsbuild(fs.readFileSync(panelFile, 'utf8'), panelFile.pathname, { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
const require = createRequire(panelFile);
function panelTree(onVisit) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require(id) {
    if (id === 'react') return { ...React, useEffect() {}, useState: value => [value, () => {}], useRef: value => ({ current: value }) };
    if (id.endsWith('architectClient.js')) return { architectClient: new Proxy({}, { get() { throw new Error('Navigation must not call a model or API'); } }) };
    if (id.endsWith('architectWorld.js')) return { appendArchitectProjects, getArchitectProjects };
    if (id.endsWith('.css')) return {};
    return require(id);
  } });
  const tree = module.exports.default({ status: { enabled: false, projects }, onStatus() {}, onVisit }), result = [];
  function visit(element) {
    if (Array.isArray(element)) element.forEach(visit);
    else if (React.isValidElement(element)) { result.push(element); visit(element.props.children); }
  }
  visit(tree); return result;
}
test('studio navigation uses only named travel callbacks and remains available while generation is disabled', () => {
  const calls = [], elements = panelTree(id => calls.push(id));
  const resident = elements.find(element => element.type === 'button' && element.props.children === '找到筑一 ↗');
  const visits = elements.filter(element => element.type === 'button' && element.props.children === '前往工程 ↗');
  assert.ok(resident); assert.equal(visits.length, 12);
  for (const button of [resident, ...visits]) {
    assert.equal(button.props.type, 'button'); assert.equal(button.props.disabled, false); button.props.onClick();
  }
  assert.deepEqual(calls, ['architect', ...projects.slice().reverse().map(idFor)]);
  assert.ok(panelTree().filter(element => element.type === 'button' && /^(找到筑一|前往工程)/.test(element.props.children)).every(button => button.props.disabled));
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await sleep(25); }
  assert.ok(check(), message);
}
test('real SDK travel accepts a built project ID, rejects unknown projects and cannot leave a ship', async () => {
  let room, providerCalls = 0;
  const server = await createTownServer({
    port: 0, secret: 'architect-navigation-test-secret-at-least-32-bytes',
    npcConfig: { enabled: false }, npcSpeechConfig: { enabled: false }, aiDroneConfig: { enabled: false },
    gameImageConfig: { enabled: false }, gameCharacterConfig: { enabled: false },
    architectConfig: { enabled: false }, architectSchedule: false,
    architectFetch: async () => { providerCalls++; throw new Error('Not a generation test'); },
  });
  const post = async (path, body) => {
    const response = await fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  try {
    const guest = await post('/api/guest', { name: '工程参观者' });
    const town = await post('/api/towns', { ...guest, protocolVersion: PROTOCOL_VERSION });
    room = await new Client(server.url).consumeSeatReservation(town.reservation);
    const notices = []; room.onMessage('notice', notice => notices.push(notice));
    const player = () => room.state?.players?.get(room.sessionId);
    await until(() => player(), 'replicated player');
    const targetId = idFor(projects[0]), target = getDestination(targetId);
    assert.ok(targetId.length > 24, 'exercise the extended but narrow architect ID contract');
    room.send('travel', { id: targetId });
    await until(() => player() && Math.hypot(player().x - target.x, player().z - target.z) < 0.001, 'server-authoritative building arrival');
    room.send('travel', { id: 'architect-project:not-built' });
    await until(() => notices.some(notice => notice.code === 'INVALID_TRAVEL'), 'unknown project rejected');
    assert.ok(Math.hypot(player().x - target.x, player().z - target.z) < 0.001);
    await sleep(550);
    room.send('travel', { id: 'architect' });
    await until(() => player()?.x === -6 && player()?.z === 25.5, 'server-authoritative resident arrival');
    await sleep(550);
    room.send('travel', { id: 'offshore' });
    room.send('offshore', { action: 'board', seq: 0 });
    await until(() => player()?.aboard, 'passenger boards using the existing ship flow');
    await sleep(550);
    room.send('travel', { id: targetId });
    await until(() => notices.some(notice => notice.code === 'OFFSHORE_ABOARD'), 'architect navigation respects the ship restriction');
    assert.equal(player().aboard, true);
    assert.notEqual(player().x, target.x);
    assert.equal(providerCalls, 0);
  } finally {
    await room?.leave().catch(() => {});
    await server.close();
  }
});
