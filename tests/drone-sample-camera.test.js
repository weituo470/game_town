import test from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_SAMPLE_PROGRAMS, createDroneSampleRuntime } from '../shared/droneSamplePrograms.js';
import { createDroneSampleCamera } from '../shared/droneSampleCamera.js';

const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const normalized = vector => { const length = Math.hypot(...vector); return vector.map(value => value / length); };
const dot = (one, two) => one.reduce((sum, value, index) => sum + value * two[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function project(point, pose, aspect) {
  const forward = normalized(pose.target.map((value, index) => value - pose.position[index]));
  const right = normalized(cross(forward, [0, 1, 0])), up = cross(right, forward);
  const relative = point.map((value, index) => value - pose.position[index]), depth = dot(relative, forward);
  const halfHeight = depth * Math.tan(pose.fov * Math.PI / 360);
  return [dot(relative, right) / halfHeight / aspect, dot(relative, up) / halfHeight, depth];
}

test('sample rails are absolute-time deterministic, finite and continuous over the full shows', () => {
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id);
    for (const aspect of [16 / 9, 1, 390 / 844, .25, 4]) {
      let prior = runtime.camera(0, aspect);
      for (let time = 100; time <= entry.duration; time += 100) {
        const pose = runtime.camera(time, aspect);
        assert.deepEqual(pose, runtime.camera(time, aspect));
        assert.ok([...pose.position, ...pose.target, pose.fov, pose.near, pose.far].every(Number.isFinite));
        assert.ok(pose.position[1] > 10); assert.ok(pose.position[2] > 130);
        assert.ok(distance(pose.position, prior.position) < 4, `no fast lurch at ${entry.id}/${time}/${aspect}`);
        assert.ok(distance(pose.target, prior.target) < 3);
        prior = pose;
      }
      for (const chapter of runtime.program.chapters) {
        const before = runtime.camera(chapter.start - .01, aspect), after = runtime.camera(chapter.start, aspect);
        assert.ok(distance(before.position, after.position) < .005);
        assert.ok(distance(before.target, after.target) < .005);
      }
      const stable = runtime.camera(0, aspect, true);
      for (const time of [12000, entry.duration / 2, entry.duration - 12000, entry.duration]) assert.deepEqual(runtime.camera(time, aspect, true), stable);
    }
    assert.deepEqual(runtime.camera(NaN), runtime.camera(0));
    assert.deepEqual(runtime.camera(-1234), runtime.camera(0));
    assert.deepEqual(runtime.camera(entry.duration + 1), runtime.camera(entry.duration));
    assert.ok(runtime.camera(0, NaN).position.every(Number.isFinite));
  }
});

test('desktop and portrait rails keep full established formations in frame with visible margins', () => {
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id);
    for (const chapter of runtime.program.chapters.filter(item => Number.isInteger(item.sceneIndex))) {
      for (const time of [chapter.start + 5000, (chapter.start + chapter.end) / 2, chapter.end - 1000]) {
        for (const aspect of [16 / 9, 390 / 844]) for (const reduced of [false, true]) {
          const pose = runtime.camera(time, aspect, reduced);
          for (const x of [-59, 59]) for (const y of [33, 110]) for (const z of [-39, 23]) {
            const [px, py, depth] = project([x, y, z], pose, aspect);
            assert.ok(depth > pose.near && depth < pose.far);
            assert.ok(Math.abs(px) < .99, `horizontal crop ${entry.id}/${chapter.id}/${aspect}: ${px}`);
            assert.ok(Math.abs(py) < .94, `vertical crop ${entry.id}/${chapter.id}/${aspect}: ${py}`);
          }
        }
      }
    }
  }
});

test('camera compiler refuses missing programmes and clamps malformed editorial shot values', () => {
  assert.throws(() => createDroneSampleCamera(null, []), TypeError);
  const runtime = createDroneSampleRuntime('lanterns-home');
  const camera = createDroneSampleCamera(runtime.program, runtime.score.scenes, [{ yaw: Infinity, distance: NaN, height: -99999 }]);
  assert.ok(camera(17000).position.every(Number.isFinite));
  assert.ok(camera(17000).position[1] > 10);
});
