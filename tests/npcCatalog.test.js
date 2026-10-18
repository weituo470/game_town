import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NPCS, NPC_MAP } from '../src/lib/npcCatalog.js';
import { PORTRAITS, renderNpcPortrait } from '../scripts/generate-npc-portraits.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTRAIT_IDS = PORTRAITS.map(([id]) => `npc-${id}`);

test('catalog has all 16 stable residents including the existing two', () => {
  assert.equal(NPCS.length, 16);
  assert.equal(new Set(NPCS.map(npc => npc.id)).size, 16);
  assert.equal(new Set(NPCS.map(npc => npc.name)).size, 16);
  assert.deepEqual(Object.keys(NPC_MAP).sort(), PORTRAIT_IDS.toSorted());
  assert.equal(NPC_MAP['npc-nuannuan'].name, '暖暖');
  assert.equal(NPC_MAP['npc-alan'].name, '阿蓝');
  assert.equal(NPC_MAP.__proto__, undefined);
  assert.equal(NPC_MAP.constructor, undefined);
  for (const npc of NPCS) assert.equal(NPC_MAP[npc.id], npc);
});

test('catalog ships only allowlisted public fields and no quest state or secrets', () => {
  const keys = ['description', 'dialogue', 'id', 'locationHint', 'name', 'portrait', 'role', 'species'];
  for (const npc of NPCS) {
    assert.deepEqual(Object.keys(npc).sort(), keys);
    assert.deepEqual(Object.keys(npc.dialogue).sort(), ['greeting', 'topics']);
    assert.deepEqual(npc.dialogue.topics.map(topic => topic.id), ['self', 'place']);
    for (const topic of npc.dialogue.topics) {
      assert.deepEqual(Object.keys(topic).sort(), ['id', 'label', 'text']);
      assert.ok(topic.text.length > 5);
    }
    assert.ok(npc.dialogue.greeting.length > 5);
    assert.ok(npc.description.length > 5);
    assert.ok(Object.isFrozen(npc));
    assert.ok(Object.isFrozen(npc.dialogue));
    assert.ok(Object.isFrozen(npc.dialogue.topics));
  }
});

for (const npc of NPCS) {
  test(`${npc.name} uses a deterministic original SVG with no embedded or remote artwork`, async () => {
    assert.match(npc.portrait, /^\/npc\/[a-z]+\.svg$/);
    const contents = fs.readFileSync(path.join(root, 'public', npc.portrait.slice(1)), 'utf8');
    assert.equal(contents, renderNpcPortrait(PORTRAITS.find(([id]) => npc.id === `npc-${id}`)));
    assert.match(contents, /viewBox="0 0 256 256"/);
    assert.ok(contents.includes(`<title id="portrait-title">${npc.name} · 原创示意头像</title>`));
    assert.match(contents, /SPDX-License-Identifier: MIT/);
    assert.doesNotMatch(contents, /<image|<script|<foreignObject|\b(?:href|src)=|data:|font-family|@import/i);
    assert.ok(Buffer.byteLength(contents) < 4000);
    const { info } = await sharp(Buffer.from(contents)).png().toBuffer({ resolveWithObject: true });
    assert.equal(info.format, 'png');
    assert.equal(info.width, 256); assert.equal(info.height, 256);
  });
}

test('open-source portraits exclude the original JPEGs and remain sixteen distinct illustrations', () => {
  const files = fs.readdirSync(path.join(root, 'public/npc')).sort();
  assert.deepEqual(files, PORTRAITS.map(([id]) => `${id}.svg`).sort());
  assert.equal(new Set(PORTRAITS.map(renderNpcPortrait)).size, 16);
  const source = fs.readFileSync(path.join(root, 'src/components/NpcDirectory.jsx'), 'utf8');
  assert.match(source, /原创几何示意头像 · 开源版/);
  assert.match(source, /不包含原参考图片/);
  assert.doesNotMatch(source, /保留原图标识|的原始角色参考图/);
});

test('directory distinguishes authored locations from implemented public-space activities', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/NpcDirectory.jsx'), 'utf8');
  assert.match(source, /activity\?\.activityLabel/);
  assert.match(source, /activity\?\.locationLabel/);
  assert.match(source, /职业场所和委托任务尚未开放/);
  assert.match(source, /角色设定中的/);
  assert.match(source, /不会接取任务、购买物品或发放金币/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|fetch\(|localStorage|onReward|onQuestComplete/);
});
