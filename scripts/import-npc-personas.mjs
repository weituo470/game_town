import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPCS } from '../src/lib/npcCatalog.js';
import { NPC_PLANS } from '../shared/npcSimulation.js';

// Deliberate allowlist: never copy the full source configs into the app. This
// exporter reads authored content as data; it does not execute source scripts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clean = (value, max = 800) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid public persona text');
  return value.trim();
};
const list = values => {
  if (!Array.isArray(values) || values.length > 10) throw new Error('Invalid personality list');
  return values.map(value => clean(value, 200));
};

// Adapt invitations that otherwise claim unimplemented picking, borrowing,
// purchases or exhibition entrances. The original voice remains the reference.
const greetings = {
  'npc-ali': '欢迎，先不用急。我看看，你是在找一样物件，还是想认识小镇里的朋友？',
  'npc-huaya': '你好，我是花芽。你喜欢开得热闹的花，还是留着一点树影的角落？',
  'npc-nuannuan': '你好，我是暖暖。不用先知道所有针法，今天聊一小步就够了。',
  'npc-beidong': '北冬，维护步道的。散步不必赶，累了就在这里停。',
  'npc-juya': '橘芽。这里的小向导。走大路，等同伴。喵。',
  'npc-lituan': '来啦。找木块？还是，找木块的用处？',
  'npc-lanyue': '你好，我是蓝跃！你今天想走得快一点，还是多看一点？',
  'npc-maipao': '汪，搭档！先看牌。再出发。',
  'npc-lanjian': '你好，我是蓝笺。你愿意说说，今天在小镇看见了什么吗？',
  'npc-chengsu': '欢迎！我是橙酥。聊聊你喜欢的口感吧，不喜欢也没关系。',
  'npc-rongrong': '坐一会儿？我是绒绒。你喜欢安静的故事吗？',
  'npc-yubai': '欢迎。先别急着选最好看的颜色，聊聊今天最想用的那个。',
  'npc-miaomu': '我叫苗木，照看菜园。先看这一垄，叶子每天都有一点变化。',
  'npc-dengcheng': '站这里会晃眼吗？我叫灯橙，正好需要一个新的观察位置。',
  'npc-xiaotai': '我叫小苔，记录小镇很小的变化。你今天看见了什么？先不用猜答案。',
  'npc-alan': '你好，我是阿蓝！先聊聊你想认识什么，再一起看看小镇；不确定的地方，我先确认。',
};

export function createPublicPersona(config, npc) {
  if (config.id !== npc.id || config.nickname !== npc.name || !Object.hasOwn(NPC_PLANS, npc.id)) throw new Error(`Persona mismatch: ${npc.id}`);
  const plan = NPC_PLANS[npc.id];
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    species: npc.species,
    publicBackstory: clean(config.backstory.publicSummary),
    personality: {
      strengths: list(config.personality.strengths),
      flaws: list(config.personality.flaws),
      likes: list(config.personality.likes),
      dislikes: list(config.personality.dislikes),
      wish: clean(config.personality.coreWish),
      voice: clean(config.personality.voice),
    },
    relationships: config.relationships.map(relation => {
      const friend = NPCS.find(item => item.id === relation.targetId);
      if (!friend) throw new Error(`Unknown relationship: ${npc.id}`);
      return { name: friend.name, role: friend.role, kind: clean(relation.kind), detail: clean(relation.detail) };
    }),
    routine: {
      work: plan.activityLabel,
      walk: plan.walkLabel,
      break: plan.restingActivityLabel,
      location: plan.locationLabel,
    },
    greetingExample: clean(greetings[npc.id]),
  };
}

// Imported tests can exercise the allowlist without touching the user's source
// folder or overwriting generated data. The CLI output path is always fixed.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !process.argv[2]?.trim()) {
    console.error('Usage: node scripts/import-npc-personas.mjs <source-directory>');
    process.exit(2);
  }
  const source = path.resolve(process.argv[2]);
  if (!(await fs.stat(source)).isDirectory()) throw new Error('Source must be a directory.');
  const personas = [];
  for (const npc of NPCS) {
    const file = path.join(source, `${npc.name}.json`);
    if (path.dirname(file) !== source) throw new Error('Unsafe persona filename');
    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    personas.push(createPublicPersona(config, npc));
  }
  if (personas.length !== 16 || new Set(personas.map(item => item.id)).size !== 16) throw new Error('Expected all 16 unique NPC personas');
  const destination = path.join(root, 'server/data');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'npc-personas.json'), `${JSON.stringify({ schemaVersion: 1, personas }, null, 2)}\n`, 'utf8');
  console.log(`Imported ${personas.length} public NPC personas into server-only data; source files unchanged.`);
}
