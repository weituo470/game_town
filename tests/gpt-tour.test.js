import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { GPT_VIEWS, gptView, nextGptView } from '../src/components/gpt/tour.js';
import { GPT_DESIGNS, gptDesign, designCamera } from '../src/components/gpt/designs.js';
import { auditSources } from '../scripts/check-readability.mjs';

test('GPT tour: six finite, unique viewpoints cycle and unknown ids fall back safely', () => {
  assert.equal(GPT_VIEWS.length, 6);
  assert.equal(new Set(GPT_VIEWS.map(v => v.id)).size, 6);
  for (const view of GPT_VIEWS) {
    assert.ok([...view.position, ...view.target].every(Number.isFinite));
    assert.ok(view.position[1] > 0);
    assert.ok(view.name && view.description);
    assert.equal(gptView(view.id), view);
  }
  let id = 'heart';
  for (let i = 0; i < 6; i++) id = nextGptView(id);
  assert.equal(id, 'heart');
  assert.equal(gptView('bad').id, 'heart');
});

test('GPT tour: font regression covers variables, shorthand, overrides and mobile rules', () => {
  const files = ['src/styles.css', 'src/components/gpt/gpt-experience.css', 'src/components/gpt/GptParkExperience.jsx'];
  const result = auditSources(files.map(path => ({ path, content: fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') })));
  assert.deepEqual(result.issues, []);
  assert.ok(result.stats.mediaQueries >= 3);
  assert.ok(result.stats.customVariableUses > 10);
});

test('GPT tour: reduced motion, keyboard exit and accessible mobile selector are present', () => {
  const source = fs.readFileSync(new URL('../src/components/gpt/GptParkExperience.jsx', import.meta.url), 'utf8');
  assert.match(source, /useState\(reducedMotion\)/);
  assert.match(source, /event.key === 'Escape'/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /htmlFor="gpt-view"/);
  assert.match(source, /<select id="gpt-view"/);
  assert.doesNotMatch(source, /api\/(?:npc|chat)|getUserMedia|AudioContext/);
});

test('GPT PK: three distinct architectural candidates have valid cameras for every stop', () => {
  assert.deepEqual(GPT_DESIGNS.map(item => item.id), ['garden', 'orbit', 'citadel']);
  assert.equal(new Set(GPT_DESIGNS.map(item => item.name)).size, 3);
  for (const design of GPT_DESIGNS) for (const view of GPT_VIEWS) {
    const camera = designCamera(design.id, view);
    assert.ok([...camera.position, ...camera.target].every(Number.isFinite));
    assert.ok(camera.position[1] > camera.target[1]);
  }
  assert.equal(gptDesign('untrusted-id').id, 'garden');
  const source = fs.readFileSync(new URL('../src/components/gpt/GptParkExperience.jsx', import.meta.url), 'utf8');
  assert.match(source, /<OrbitalSanctum/);
  assert.match(source, /<LuminousCitadel/);
  assert.match(source, /aria-label="PK 园区方案"/);
  assert.match(source, /候选观景方案/);
  assert.match(source, /返回已建园区/);
});

test('GPT logo: official upstream SVG is byte-identical and preserves its original white geometry', () => {
  const logo = fs.readFileSync(new URL('../public/gpt/openai-blossom.svg', import.meta.url));
  assert.equal(createHash('sha256').update(logo).digest('hex'), 'b94ea61d860fae6f82f43571f36f17111fcf5d348e8e9cc22ae4b441c7560011');
  assert.match(logo.toString(), /viewBox="0 0 721 721"/);
  assert.match(logo.toString(), /fill="white"/);
  assert.doesNotMatch(logo.toString(), /<script|<foreignObject|onload=|javascript:/i);
});
