import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { staticCacheControl } from '../server/staticCache.js';

test('loading: immutable caching is limited to content-addressed build assets', () => {
  for (const path of ['/dist/assets/three-engine-Ab123_45.js', 'C:\\dist\\assets\\index-Bd6ZP5PH.css']) {
    assert.equal(staticCacheControl(path), 'public, max-age=31536000, immutable');
  }
  for (const path of ['/dist/index.html', '/dist/release.json', '/dist/assets/catalog.json']) {
    assert.equal(staticCacheControl(path), 'no-store');
  }
  for (const path of ['/dist/assets/main.js', '/dist/wonders/coastal-sky.hdr', '/dist/npc/ali.jpg']) {
    assert.equal(staticCacheControl(path), 'public, max-age=3600');
  }
});

test('loading: games and the NPC conversation directory are requested only when opened', () => {
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const [name, relativePath] of [['MiniGame', 'MiniGame'], ['NpcDirectory', 'NpcDirectory'], ['PixelControls', 'pixel/PixelControls']]) {
    assert.match(app, new RegExp(`const ${name} = React\\.lazy\\(\\(\\) => import\\('\\./components/${relativePath}\\.jsx'\\)\\)`));
    assert.doesNotMatch(app, new RegExp(`import ${name} from`));
  }
  assert.match(app, /if \(ready && !droneDeepLinkOpened\.current/);
  const town = fs.readFileSync(new URL('../src/components/Town.jsx', import.meta.url), 'utf8');
  assert.match(town, /\+\+readyFrames\.current === 2/);
  assert.match(town, /performanceMode=\{props\.viewMode === 'drone' \? 'drone' : props\.viewMode === 'pixel' \? 'pixel' : 'town'\}/);
  const pixelGate = fs.readFileSync(new URL('../src/components/pixel/PixelGate.jsx', import.meta.url), 'utf8');
  assert.match(pixelGate, /const PixelIsland = lazy\(\(\) => import\('\.\/PixelIsland\.jsx'\)\)/);
  assert.doesNotMatch(town, /import\s+PixelIsland\s+from|from\s+['"][^'"]*pixel-world/);
});
