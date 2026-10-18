import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createNpcAnimalPlayer, getNpcAnimalCue, NPC_ANIMAL_CUES } from '../src/lib/npcAnimalPlayer.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

class FakeAudio {
  listeners = new Map();
  pauses = 0;
  loads = 0;
  plays = 0;
  constructor(url, result) { this.url = url; this.result = result; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  play() { this.plays += 1; return this.result ?? Promise.resolve(); }
  pause() { this.pauses += 1; }
  removeAttribute(name) { this.removed = name; }
  load() { this.loads += 1; }
  fire(name) { this.listeners.get(name)?.(); }
}

function fixture({ results = [], resolveUrl } = {}) {
  const audios = [], states = [];
  const player = createNpcAnimalPlayer({
    audioFactory: url => { const audio = new FakeAudio(url, results[audios.length]); audios.push(audio); return audio; },
    ...(resolveUrl ? { resolveUrl } : {}),
  });
  player.subscribe(state => states.push(state));
  return { player, audios, states };
}

test('animal cue allowlist contains exactly four existing bounded public MP3s', () => {
  assert.deepEqual(Object.keys(NPC_ANIMAL_CUES).sort(), ['npc-juya', 'npc-lituan', 'npc-maipao', 'npc-rongrong']);
  assert.ok(Object.isFrozen(NPC_ANIMAL_CUES));
  for (const cue of Object.values(NPC_ANIMAL_CUES)) {
    assert.ok(Object.isFrozen(cue));
    assert.match(cue.path, /^\/audio\/npcs\/[a-z-]+\.mp3$/);
    const info = statSync(new URL(`../public${cue.path}`, import.meta.url));
    assert.ok(info.isFile() && info.size > 256 && info.size < 256 * 1024);
  }
});

test('human, unknown and prototype identities cannot select arbitrary audio', async () => {
  const { player, audios } = fixture();
  for (const id of ['npc-ali', 'constructor', '__proto__', '../cat', 'https://attacker.test/a.mp3', undefined, {}, []]) {
    assert.equal(getNpcAnimalCue(id), null);
    assert.equal(await player.play(id), false);
  }
  assert.equal(audios.length, 0);
});

test('interaction invokes play synchronously without chat, speech status or reply identifiers', async () => {
  const pending = deferred();
  const { player, audios } = fixture({ results: [pending.promise] });
  const result = player.play('npc-juya');
  assert.equal(audios.length, 1);
  assert.equal(audios[0].plays, 1, 'Audio.play must run before a microtask or network round trip');
  assert.equal(audios[0].url, '/audio/npcs/cat-meow.mp3');
  assert.equal(player.getState().status, 'loading');
  pending.resolve();
  assert.equal(await result, true);
  assert.deepEqual(player.getState(), { npcId: 'npc-juya', status: 'playing', error: '' });
  assert.doesNotMatch(read('src/lib/npcAnimalPlayer.js'), /fetch\(|npcChatClient|loadSpeech|conversationId|requestId/);
});

test('animal URLs respect the public game-town subpath', async () => {
  const { player, audios } = fixture({ resolveUrl: path => `/game-town${path}` });
  await player.play('npc-lituan');
  assert.equal(audios[0].url, '/game-town/audio/npcs/red-panda-call.mp3');
  assert.match(read('src/lib/npcAnimalPlayer.js'), /resolveUrl = appUrl/);
});

test('opening another animal stops and releases the previous cue before the next play', async () => {
  const { player, audios } = fixture();
  await player.play('npc-juya');
  await player.play('npc-maipao');
  assert.equal(audios[0].pauses, 1);
  assert.equal(audios[0].removed, 'src');
  assert.equal(audios[0].loads, 1);
  assert.equal(audios[0].listeners.size, 0);
  assert.equal(audios[1].url, '/audio/npcs/dog-bark.mp3');
  assert.equal(player.getState().npcId, 'npc-maipao');
});

test('switching to a human stops animal audio without synthesizing anything', async () => {
  const { player, audios } = fixture();
  await player.play('npc-rongrong');
  assert.equal(await player.play('npc-ali'), false);
  assert.equal(audios.length, 1);
  assert.equal(audios[0].pauses, 1);
  assert.deepEqual(player.getState(), { npcId: null, status: 'idle', error: '' });
});

test('closing stops playback and reopening the same animal plays a fresh cue', async () => {
  const { player, audios } = fixture();
  await player.play('npc-rongrong');
  player.stop();
  await player.play('npc-rongrong');
  assert.equal(audios.length, 2);
  assert.equal(audios[0].pauses, 1);
  assert.equal(audios[1].plays, 1);
});

test('a natural end clears media handlers and reports a completed greeting', async () => {
  const { player, audios } = fixture();
  await player.play('npc-juya');
  audios[0].fire('ended');
  assert.deepEqual(player.getState(), { npcId: 'npc-juya', status: 'ended', error: '' });
  assert.equal(audios[0].listeners.size, 0);
  assert.equal(audios[0].pauses, 1);
});

test('a blocked autoplay has an honest gesture retry and no automatic retry', async () => {
  const blocked = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  const { player, audios } = fixture({ results: [Promise.reject(blocked)] });
  assert.equal(await player.play('npc-juya'), false);
  assert.equal(player.getState().status, 'blocked');
  assert.match(player.getState().error, /打个招呼/);
  assert.equal(audios.length, 1);
  await player.play('npc-juya');
  assert.equal(audios.length, 2);
  assert.equal(player.getState().status, 'playing');
});

test('late play failures cannot replace the state of a newly selected pet', async () => {
  const pending = deferred();
  const { player, audios } = fixture({ results: [pending.promise] });
  const old = player.play('npc-juya');
  await player.play('npc-lituan');
  pending.reject(new Error('old failure'));
  await old;
  assert.deepEqual(player.getState(), { npcId: 'npc-lituan', status: 'playing', error: '' });
  assert.equal(audios[0].listeners.size, 0);
});

test('decode and construction failures expose no provider details', async () => {
  const { player, audios } = fixture();
  await player.play('npc-maipao');
  audios[0].fire('error');
  assert.equal(player.getState().status, 'error');
  assert.equal(audios[0].listeners.size, 0);
  const invalid = createNpcAnimalPlayer({ audioFactory: () => { throw new Error('private decoder details'); } });
  assert.equal(await invalid.play('npc-maipao'), false);
  assert.doesNotMatch(invalid.getState().error, /private/);
});

test('React subscribe-cleanup cycles do not cancel an already user-started greeting', async () => {
  const { player, audios } = fixture();
  await player.play('npc-juya');
  const states = [];
  const unsubscribe = player.subscribe(state => states.push(state));
  unsubscribe();
  const again = player.subscribe(state => states.push(state));
  assert.equal(audios[0].pauses, 0);
  assert.equal(states.length, 2);
  assert.equal(states[1].status, 'playing');
  again();
});

test('dispose ends current audio and prevents future playback or late status updates', async () => {
  const pending = deferred();
  const { player, audios, states } = fixture({ results: [pending.promise] });
  const old = player.play('npc-juya');
  player.dispose();
  const length = states.length;
  pending.resolve();
  assert.equal(await old, false);
  assert.equal(await player.play('npc-maipao'), false);
  assert.equal(audios.length, 1);
  assert.equal(states.length, length);
  assert.equal(audios[0].pauses, 1);
});

test('pet UI is direct local audio while human chat behavior is preserved', () => {
  const app = read('src/App.jsx');
  const directory = read('src/components/NpcDirectory.jsx');
  assert.match(app, /inspectResidents = useCallback\(id => \{[^\n]*animalPlayer\.current\.play\(id\)/);
  assert.match(app, /closeModal = useCallback\(\(\) => \{ animalPlayer\.current\?\.stop\(\)/);
  assert.match(app, /modal\?\.type !== 'characters'\) animalPlayer\.current\?\.stop\(\)/);
  assert.match(app, /<NpcDirectory[^>]+animalPlayer=\{animalPlayer\.current\}/);
  assert.match(directory, /function openResident\(id\) \{\s*void animalPlayer\?\.play\(id\)/);
  assert.match(directory, /!animalCue && <NpcChat key=\{selected\.id\}/);
  assert.match(directory, /animalPlayer\?\.stop\(\); setSelectedId\(null\)/);
  assert.match(directory, /if \(animalCue\) void animalPlayer\?\.play\(selectedId\)/);
  assert.match(directory, /不调用 AI 或语音生成服务/);
  assert.doesNotMatch(directory, /npcChatClient|fetch\(/);
  assert.match(read('src/components/npc-directory.css'), /\.npc-animal-stop \{[^}]*min-height: 46px[^}]*font-size: var\(--text-control\)/);
  assert.match(read('src/components/npc-directory.css'), /\.npc-animal-status, \.npc-animal-note \{[^}]*font-size: var\(--text-body\)/);
});
