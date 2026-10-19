import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiDroneLibrary, AI_DRONE_LIBRARY_KEY } from '../src/lib/aiDroneLibrary.js';

const score = () => ({ version: 1, title: '星海相遇', synopsis: '一场关于相遇的灯光演出。', seed: 10, scenes: ['ring', 'whale', 'flower', 'sphere'].map((shape, index) => ({ name: `第 ${index + 1} 幕`, description: '灯光渐次汇聚。', shape, color: '#f9d989', accent: '#83cfff', duration: 10, motion: 'breathe', transition: 'morph' })) });
const show = (id = 'show-1') => ({ id, createdAt: 1700000000000, mode: 'prompt', score: score() });
function memoryStorage(raw) {
  const values = new Map(raw === undefined ? [] : [[AI_DRONE_LIBRARY_KEY, raw]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
}

test('library saves only a validated score and allowlisted lightweight metadata, never credentials', () => {
  const storage = memoryStorage();
  const library = createAiDroneLibrary({ storage, now: () => 1700000000001 });
  const result = library.save({ ...show(), token: 'secret-token', apiKey: 'secret-key', provider: { private: 'secret-provider' }, prompt: 'private-prompt' });
  assert.equal(result.ok, true);
  const raw = storage.getItem(AI_DRONE_LIBRARY_KEY);
  assert.equal(raw.includes('secret'), false);
  assert.equal(raw.includes('private-prompt'), false);
  assert.deepEqual(Object.keys(result.entries[0]).sort(), ['createdAt', 'id', 'mode', 'savedAt', 'score']);
  assert.equal(Object.isFrozen(result.entries[0].score.scenes), true);
  assert.equal(library.read().entries[0].score.scenes[0].color, '#F9D989');
});

test('library keeps at most five shows, upserts existing IDs and deletes locally', () => {
  let now = 1700000000010;
  const storage = memoryStorage();
  const library = createAiDroneLibrary({ storage, now: () => now++ });
  for (let i = 1; i <= 6; i++) library.save(show(`show-${i}`));
  assert.deepEqual(library.read().entries.map(entry => entry.id), ['show-6', 'show-5', 'show-4', 'show-3', 'show-2']);
  library.save(show('show-4'));
  assert.deepEqual(library.read().entries.map(entry => entry.id), ['show-4', 'show-6', 'show-5', 'show-3', 'show-2']);
  assert.equal(library.remove('show-6').entries.length, 4);
  assert.equal(library.read().entries.some(entry => entry.id === 'show-6'), false);
});

test('malformed, oversized and wrong-version storage fail closed without throwing or automatic rewriting', () => {
  for (const raw of ['bad JSON', 'x'.repeat(205000), '{"version":2,"entries":[]}', '{"version":1,"entries":{}}', JSON.stringify({ version: 1, entries: Array.from({ length: 6 }, (_, i) => ({ ...show(`show-${i}`), savedAt: 1 })) })]) {
    const storage = memoryStorage(raw);
    const library = createAiDroneLibrary({ storage });
    assert.equal(library.read().corrupt, true);
    assert.deepEqual(library.read().entries, []);
    assert.equal(storage.getItem(AI_DRONE_LIBRARY_KEY), raw);
  }
});

test('invalid saved shapes are skipped but healthy neighboring entries remain available', () => {
  const bad = show('bad');
  bad.score.scenes[0].shape = 'javascript';
  const library = createAiDroneLibrary({ storage: memoryStorage(JSON.stringify({ version: 1, entries: [{ ...bad, savedAt: 1 }, { ...show('good'), savedAt: 2 }] })) });
  assert.equal(library.read().corrupt, true);
  assert.deepEqual(library.read().entries.map(entry => entry.id), ['good']);
});

test('invalid new score cannot overwrite the previous good library', () => {
  const storage = memoryStorage();
  const library = createAiDroneLibrary({ storage });
  library.save(show('good'));
  const before = storage.getItem(AI_DRONE_LIBRARY_KEY);
  assert.equal(library.save({ ...show('bad'), score: { run: 'evil' } }).ok, false);
  assert.equal(storage.getItem(AI_DRONE_LIBRARY_KEY), before);
});

test('storage errors remain safe and missing storage does not pretend to save', () => {
  const absent = createAiDroneLibrary({ storage: null });
  assert.equal(absent.read().available, false);
  assert.equal(absent.save(show()).ok, false);
  const blocked = createAiDroneLibrary({ storage: { getItem() { throw Error('private'); }, setItem() { throw Error('quota'); } } });
  assert.doesNotThrow(() => blocked.read());
  assert.equal(blocked.save(show()).ok, false);
  assert.equal(blocked.remove('show-1').ok, false);
});
