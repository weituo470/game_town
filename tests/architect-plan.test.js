import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECT_PLOTS, ARCHITECT_KINDS, ARCHITECT_PALETTES, ARCHITECT_BUILDING_BOUNDS, validateArchitectPlan } from '../shared/architectPlan.js';
import { createArchitectWorld } from '../shared/architectWorld.js';
import { EMPTY_PLOTS, STREETS, TREE_POSITIONS, WORLD_LOCATIONS, FOUNTAIN } from '../shared/world.js';
import { NPC_PLANS } from '../shared/npcSimulation.js';
import { HOP_PLATFORMS } from '../src/minigames/outdoor.js';
import { createStreetPlan } from '../src/components/town/ExpandedGround.js';

const plan = () => ({ version: 1, name: '海风书屋', description: '给旅人一处阅读和休憩的地方。', plotId: ARCHITECT_PLOTS[0].id, kind: 'reading_room', palette: 'coastal', orientation: 0 });
test('architect plan is an exact finite additive schema, not executable geometry', () => {
  assert.deepEqual(validateArchitectPlan(plan()), plan());
  for (const extra of [{ x: 10 }, { url: 'https://example.com' }, { delete: true }, { code: 'x' }, { scale: 2 }]) assert.throws(() => validateArchitectPlan({ ...plan(), ...extra }));
  for (const value of [null, [], 'x', {}, { ...plan(), version: 2 }, { ...plan(), orientation: -0 }, { ...plan(), orientation: Infinity },
    { ...plan(), kind: '__proto__' }, { ...plan(), palette: 'constructor' }, { ...plan(), plotId: 'plot-1-2' },
    { ...plan(), name: '<script>' }, { ...plan(), name: 'https://x' }, { ...plan(), name: 'a\nb' },
    { ...plan(), description: 'x'.repeat(181) }, { ...plan(), name: '　' }]) assert.throws(() => validateArchitectPlan(value));
  assert.throws(() => validateArchitectPlan(plan(), { availablePlotIds: [] }));
  for (const kind of ARCHITECT_KINDS) for (const palette of Object.keys(ARCHITECT_PALETTES)) for (const orientation of [0, 90, 180, 270])
    assert.equal(validateArchitectPlan({ ...plan(), kind, palette, orientation }).kind, kind);
});
test('all twelve surveyed sites protect original plots, roads, fountain, scenery and resident routes', () => {
  assert.equal(ARCHITECT_PLOTS.length, 12); assert.ok(ARCHITECT_PLOTS.length <= 24);
  assert.equal(new Set(ARCHITECT_PLOTS.map(item => item.id)).size, 12);
  const b = ARCHITECT_BUILDING_BOUNDS.halfWidth, inEnvelope = (p, x, z, margin = 0) => Math.abs(p.x - x) < b + margin && Math.abs(p.z - z) < b + margin;
  for (const p of ARCHITECT_PLOTS) {
    const original = EMPTY_PLOTS.find(item => item.id === p.id);
    assert.equal(p.x, original.x); assert.equal(p.z, original.z);
    assert.ok(original.width >= b * 2 + 0.5 && original.depth >= b * 2 + 0.5);
    for (const road of STREETS) assert.ok(Math.abs(p.x - road.x) >= b + road.width / 2 || Math.abs(p.z - road.z) >= b + road.depth / 2, `${p.id} road`);
    for (const tree of TREE_POSITIONS) assert.ok(!inEnvelope(p, tree[0], tree[1], 0.55 * tree[2]), `${p.id} tree`);
    for (const lamp of createStreetPlan().lamps) assert.ok(!inEnvelope(p, lamp.x, lamp.z, 0.4), `${p.id} lamp`);
    for (const place of WORLD_LOCATIONS) assert.ok(Math.abs(p.x - place.x) >= b + 3.6 || Math.abs(p.z - place.z) >= b + 3.2);
    assert.ok(Math.hypot(p.x - FOUNTAIN.x, p.z - FOUNTAIN.z) > FOUNTAIN.plazaRadius + b * Math.SQRT2);
    for (const platform of HOP_PLATFORMS) assert.ok(!inEnvelope(p, platform.x, platform.z, platform.radius + 0.3));
    for (const route of Object.values(NPC_PLANS)) for (const segment of route.segments) for (let i = 0; i <= 100; i++) {
      const t = i / 100, x = segment.from.x + (segment.to.x - segment.from.x) * t, z = segment.from.z + (segment.to.z - segment.from.z) * t;
      assert.ok(!inEnvelope(p, x, z, 0.9), `${p.id} resident ${route.id}`);
    }
  }
});
test('world registry only appends valid unique immutable projects and never clears previous projects', () => {
  const world = createArchitectWorld(), first = { id: 'arch-1', day: '2026-10-20', source: 'autonomous', createdAt: 1, plan: plan() };
  assert.equal(world.append([first]), 1);
  assert.equal(world.solid(ARCHITECT_PLOTS[0].x, ARCHITECT_PLOTS[0].z), true);
  assert.equal(world.solid(NaN, 0), false);
  assert.equal(world.append([{ ...first, plan: { ...plan(), name: '篡改' } }]), 0);
  assert.equal(world.append([{ ...first, id: 'arch-2' }]), 0);
  assert.equal(world.append([]), 0); assert.equal(world.append(null), 0);
  assert.equal(world.projects()[0].plan.name, '海风书屋');
  assert.throws(() => { world.projects()[0].plan.name = '篡改'; });
});
