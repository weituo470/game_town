import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDroneFormations, DRONE_PALETTE } from '../shared/droneFormations.js';
import { createKidGokuArtwork, KID_GOKU_PARTS, KID_GOKU_EYES, isKidGokuEye } from '../shared/droneKidGoku.js';
import { createDroneFleet, updateDroneFleet, DRONE_CHAPTERS, DRONE_HIGHLIGHTS } from '../shared/droneShow.js';

const budgets = [760, 520, 480, 540, 420, 520, 340, 300, 216];
function points(formation, part) {
  const result = [];
  for (let i = 0; i < formation.parts.length; i++) if (formation.parts[i] === part) result.push({ x: formation.hero[i * 3], y: formation.hero[i * 3 + 1], z: formation.hero[i * 3 + 2], color: [...(formation.baseColors ?? formation.colors).subarray(i * 3, i * 3 + 3)] });
  return result;
}

test('kid Goku is nine authored light-path features with exact 4096/2048 budgets and unchanged permanent identities', () => {
  assert.deepEqual(KID_GOKU_PARTS, ['hair', 'face', 'eyes-smile', 'blue-vest', 'arms-wristbands', 'wide-trousers', 'white-sash', 'power-pole', 'boots-tail']);
  assert.deepEqual(createKidGokuArtwork().map(group => group.count), budgets);
  const full = createDroneFormations(), half = createDroneFormations(2048);
  for (let part = 0; part < 9; part++) { assert.equal(points(full, part).length, budgets[part]); assert.equal(points(half, part).length, budgets[part] / 2); }
  for (let i = 0; i < half.identities.length; i++) {
    assert.equal(half.identities[i], full.identities[i * 2]); assert.equal(half.parts[i], full.parts[i * 2]);
    for (const key of ['hero', 'colors', 'skyEye', 'phoenix']) assert.deepEqual(half[key].subarray(i * 3, i * 3 + 3), full[key].subarray(i * 6, i * 6 + 3));
  }
});

test('hair retains the left-swept tall spikes and low-luminance cool rim without a halo or illuminated black fill', () => {
  const f = createDroneFormations(), hair = points(f, 0);
  assert.ok(hair.filter(p => p.x < -10 && p.y > 99).length >= 20, 'the tall left-swept spike is retained');
  assert.equal(hair.filter(p => p.x > 10 && p.y > 98).length, 0, 'hair must not become a symmetric crown');
  assert.deepEqual(DRONE_PALETTE.hair, [.48, .67, .9], 'night-sky outline stays cool blue rather than white hair');
  assert.ok(hair.every(p => p.z > -1 && p.color[2] > p.color[0] * 1.7 && p.color[0] > 0 && p.color[0] <= .481));
  assert.ok(hair.every(p => p.y > 69), 'no full-body ring or aureole is hidden in the hair budget');
  assert.equal(hair.filter(p => p.x > -3 && p.x < 5 && p.y > 88 && p.y < 94).length, 0, 'the 8m × 6m central hair mass remains entirely unlit negative space');
});

test('two round eyes preserve dark pupil holes and separate catchlights at both fleet qualities', () => {
  for (const count of [4096, 2048]) {
    const f = createDroneFormations(count), eyePoints = points(f, 2);
    for (const [index, pupil] of [[0, { x: -2.52, y: 74.04 }], [1, { x: 3, y: 74.16 }]]) {
      const eye = KID_GOKU_EYES[index];
      const inside = eyePoints.filter(p => ((p.x - eye.x) / eye.rx) ** 2 + ((p.y - eye.y) / eye.ry) ** 2 <= 1.04);
      assert.ok(inside.length > count / 32, 'round eye has enough emitters to read on mobile');
      assert.ok(inside.some(p => p.y > eye.y + 2.5) && inside.some(p => p.y < eye.y - 2.5), 'both eyelids keep the large child-eye height');
      assert.equal(inside.filter(p => p.z < 5.5 && Math.hypot(p.x - pupil.x, p.y - pupil.y) < 1.56).length, 0, 'the 13px-radius white-free pupil is larger than the former 8px hole at both tiers');
      assert.equal(inside.filter(p => Math.hypot(p.x - pupil.x, p.y - pupil.y) < .96).length, 0, 'even catchlights leave the central 8px radius completely unlit');
      const glints = inside.filter(p => p.z > 5.7);
      assert.ok(glints.length >= 2 && glints.length <= 5, 'each tiny glint uses only 5 full-tier or 2–3 half-tier emitters');
      assert.ok(glints.every(p => p.x < pupil.x - .6 && p.y > pupil.y + .65), 'glint is on the upper-left edge, never the pupil centre');
      assert.ok(Math.max(...glints.map(p => p.x)) - Math.min(...glints.map(p => p.x)) < .25);
      assert.ok(Math.max(...glints.map(p => p.y)) - Math.min(...glints.map(p => p.y)) < .31);
      const fill = inside.filter(p => p.z > 5.34 && p.z < 5.36);
      assert.equal(new Set(fill.map(p => p.y.toFixed(3))).size, 3, 'only three sparse eye-white rows survive, rather than nine dense stripes');
      assert.ok(fill.length / inside.length < .23, 'interior white emitters cannot overwhelm the dark pupil or the round outer contour');
    }
    assert.equal(isKidGokuEye(2, 0, 70), false, 'the smile does not blink with the eyes');
    assert.equal(isKidGokuEye(0, -3.36, 74.52), false, 'hair must not enter the eye light mask');
  }
});

test('blue sleeveless gi, wide legs, white waist bow and red wrists remain distinct from skin and the red/gold pole', () => {
  const f = createDroneFormations(), vest = points(f, 3), legs = points(f, 5), sash = points(f, 6), arms = points(f, 4), pole = points(f, 7);
  assert.ok(vest.filter(p => p.color[2] > p.color[0] * 5).length > vest.length * .8);
  assert.ok(legs.every(p => p.color[2] > p.color[0] * 5));
  assert.ok(sash.every(p => p.color[0] >= .79 && p.color[1] >= 1 && p.z > 4));
  assert.ok(sash.filter(p => p.x < -3 && p.y < 48).length > 15 && sash.filter(p => p.x > 2 && p.y < 48).length > 15, 'two white bow loops hang from the waist');
  const wrists = arms.filter(p => p.color[0] > p.color[1] * 6);
  assert.ok(wrists.some(p => p.x < -12) && wrists.some(p => p.x > 18), 'both wristbands glow red');
  assert.ok(pole.filter(p => p.color[0] > p.color[1] * 6).length > 80 && pole.filter(p => p.color[1] > .8).length > 80, 'pole retains red core and gold rails/caps');
  assert.ok(pole.every(p => p.x > 18 && p.y >= 24 && p.y <= 101));
  assert.ok(arms.some(p => p.x > 25 && p.y > 57 && p.y < 63 && p.z > 6), 'gripping fingers layer in front of the pole');
  assert.ok(points(f, 8).some(p => p.x < -25 && p.z < 0), 'curled monkey tail is behind the child, not a detached halo');
  const luminance = color => color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
  assert.ok(luminance(DRONE_PALETTE.hair) < luminance(DRONE_PALETTE.eyeWhite) * .4, 'brightened outline remains below 40% of eye-white luminance');
});

test('new face/hair/pole move as one pose and sash motion is coherent rather than old random ribbon shimmer', () => {
  const f = createDroneFleet(); updateDroneFleet(f, 74000);
  let dy;
  for (let i = 0; i < f.count; i++) {
    const k = i * 3, part = f.parts[i];
    if (part === 6) continue;
    assert.equal(f.positions[k], f.hero[k]); assert.equal(f.positions[k + 2], f.hero[k + 2]);
    const delta = f.positions[k + 1] - f.hero[k + 1];
    if (dy === undefined) dy = delta;
    assert.ok(Math.abs(delta - dy) < .00001, 'all body parts share one breathing offset');
  }
  updateDroneFleet(f, 74000, { reducedMotion: true }); assert.deepEqual(f.positions, f.hero);
  assert.doesNotMatch([...DRONE_CHAPTERS, ...DRONE_HIGHLIGHTS].map(cue => cue.description).join(' '), /冠冕|甲胄|披帛|天神|金玉法相/);
});

test('kid Goku geometry is lightweight procedural source rather than an embedded bitmap or heavy mesh payload', () => {
  const source = fs.readFileSync(new URL('../shared/droneKidGoku.js', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(source) < 18000);
  assert.doesNotMatch(source, /data:image|base64|TextureLoader|ImageBitmap|fetch\(|WebGLRenderer/);
  assert.ok(createKidGokuArtwork().every(group => group.paths.every(path => path.points.length > 1 && path.points.every(point => point.every(Number.isFinite)))));
});
