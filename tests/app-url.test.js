import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import { Client } from '@colyseus/sdk';
import { appUrl } from '../src/lib/appUrl.js';

const BASE = '/game-town/';
const MODEL = '/api/game-characters/assets/12345678-1234-4123-8123-123456789abc.glb';
const require = createRequire(import.meta.url);
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

// Exercise real request functions with the build-time base dependency injected.
// This does not build dist or contact an external service.
async function clientModule(name) {
  const source = await readFile(new URL(`../src/lib/${name}.js`, import.meta.url), 'utf8');
  const transformed = await transformWithEsbuild(source, `${name}.js`, { format: 'cjs' });
  const module = { exports: {} };
  vm.runInNewContext(transformed.code, {
    module, exports: module.exports,
    require: id => id === './appUrl.js' ? { appUrl: path => appUrl(path, BASE) } : require(id),
    setTimeout, clearTimeout, AbortController, DOMException, Response, TextDecoder, URL,
  });
  return module.exports;
}

test('application URLs default to root in Node and retain an explicit deployment directory', () => {
  assert.equal(appUrl('/api/health'), '/api/health');
  assert.equal(appUrl('/npc/ali.jpg', './'), '/npc/ali.jpg');
  for (const path of ['/api/health', '/audio/npcs/cat-meow.mp3', '/wonders/coastal-sky.hdr', '/api/npc/speech/status?npcId=npc-ali']) {
    assert.equal(appUrl(path, BASE), `/game-town${path}`);
  }
  assert.equal(appUrl('/', '/nested/game-town/'), '/nested/game-town/');
});

test('application URL helper refuses origin replacement and base directory escapes', () => {
  for (const path of ['https://example.com/a', '//example.com/a', 'api/status', '/a/../b', '/%2e%2e/b', '/%2fexample.com', '/a\\b', '/%5cfoo', '/bad%']) {
    assert.throws(() => appUrl(path, BASE), TypeError);
  }
  for (const base of ['https://example.com/', '//example.com/', '/../', '/game-town', '/game-town/?x']) {
    assert.throws(() => appUrl('/api/health', base), TypeError);
  }
});

test('Vite base substitution works without a window or document global', async () => {
  const source = await readFile(new URL('../src/lib/appUrl.js', import.meta.url), 'utf8');
  const compiled = await transformWithEsbuild(source, 'appUrl.js', {
    format: 'cjs', define: { 'import.meta.env.BASE_URL': JSON.stringify(BASE) },
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled.code, { module, exports: module.exports });
  assert.equal(module.exports.appUrl('/npc/ali.jpg'), '/game-town/npc/ali.jpg');
});

test('NPC API and catalog URLs stay under the deployment directory', async () => {
  const { createNpcChatClient } = await clientModule('npcChatClient');
  const paths = [];
  const client = createNpcChatClient({ fetchImpl: async path => {
    paths.push(path);
    return response({ enabled: false, provider: 'DeepSeek', model: 'deepseek-flash', reason: 'disabled' });
  } });
  await client.status();
  assert.equal(paths[0], '/game-town/api/npc/chat/status');
  const { NPCS } = await clientModule('npcCatalog');
  assert.equal(NPCS.length, 16);
  for (const npc of NPCS) assert.match(npc.portrait, /^\/game-town\/npc\/[a-z]+\.svg$/);
});

test('image and character API calls are prefixed without relaxing private GLB validation', async () => {
  const image = await clientModule('gameImageClient');
  const imagePaths = [];
  const images = image.createGameImageClient({ fetchImpl: async path => {
    imagePaths.push(path);
    return response({ jobs: [], selectedAssetId: null });
  } });
  await images.mine();
  assert.equal(imagePaths[0], '/game-town/api/game-images/mine');
  assert.equal(image.gameImageAssetUrl('asset-1'), '/game-town/api/game-images/assets/asset-1');

  const character = await clientModule('gameCharacterClient');
  const characterPaths = [];
  const characters = character.createGameCharacterClient({ fetchImpl: async path => {
    characterPaths.push(path);
    return response({ jobs: [], selectedCharacter: null });
  } });
  await characters.mine();
  assert.equal(characterPaths[0], '/game-town/api/game-characters/mine');
  assert.equal(character.isPrivateCharacterUrl(MODEL), true);
  assert.equal(character.isPrivateCharacterUrl(`https://example.com${MODEL}`), false);
  assert.equal(character.isPrivateCharacterUrl(`/game-town${MODEL}`), false);

  const model = await clientModule('characterModel');
  let requested;
  await assert.rejects(model.fetchCharacterGlb(MODEL, { fetchImpl: async path => {
    requested = path;
    return new Response(null, { status: 404 });
  } }));
  assert.equal(requested, `/game-town${MODEL}`);
});

test('installed Colyseus SDK keeps the prefix on HTTP reconnect and WebSocket endpoints', () => {
  const client = new Client('https://www.shenliu.cc/game-town');
  assert.equal(client.getHttpEndpoint('/matchmake/reconnect/room-123'), 'https://www.shenliu.cc/game-town/matchmake/reconnect/room-123');
  assert.match(client.buildEndpoint({ processId: 'process-123', roomId: 'room-123' }, {}), /^wss:\/\/www\.shenliu\.cc\/game-town\/process-123\/room-123\?/);
});
