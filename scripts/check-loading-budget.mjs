import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

// Run after vite build. Proves what is actually eager, not just source intent.
const dist = path.resolve(process.argv[2] || 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'));
const eager = new Set();
function visit(key) {
  if (eager.has(key)) return;
  assert.ok(manifest[key], `Unknown manifest entry: ${key}`);
  eager.add(key);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
visit('index.html');
for (const name of ['MiniGame', 'NpcDirectory', 'CharacterStudio', 'GptParkExperience', 'AiDroneStudio', 'TownAtlas', 'SphereLandmark', 'SphereControls', 'SphereCamera', 'OffshoreIsland', 'OffshoreControls', 'OffshoreCamera', 'WonderSchedule', 'PixelIsland', 'PixelControls']) {
  // Shared exports can make Rollup name a dynamic entry by its emitted chunk
  // instead of its original source path; check the same real dependency graph.
  const entry = Object.keys(manifest).find(key => key.endsWith(`/${name}.jsx`)
    || manifest[key].name === name && manifest[key].file.endsWith('.js'));
  assert.ok(entry, `${name} chunk exists`);
  assert.ok(!eager.has(entry), `${name} must stay out of the first scene's eager graph`);
}
// Vite may fold the compiler into its lazy importer instead of emitting an
// independent entry. If it is a manifest entry, it must not become eager.
for (const entry of Object.keys(manifest).filter(key => key === 'shared/aiDroneShow.js' || key.endsWith('/shared/aiDroneShow.js'))) {
  assert.ok(!eager.has(entry), 'AI drone compiler/geometry must stay outside the initial eager graph');
}
const chunks = [...eager].map(key => {
  const file = manifest[key].file;
  const bytes = fs.readFileSync(path.join(dist, file));
  return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
});
assert.ok(chunks.some(chunk => /three-engine-/.test(chunk.file)), 'Graphics engine must be separately cacheable');
const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
assert.ok(total < 1_900_000, `Initial JS exceeded the 1.9 MB guard: ${total}`);
console.log(JSON.stringify({ passed: true, eagerJs: chunks, totalBytes: total,
  totalGzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
  note: 'Transfer/parse budget only. This is not a measured network loading time or GPU FPS.' }, null, 2));
