import test from 'node:test';
import assert from 'node:assert/strict';
import { SPAWN } from '../shared/world.js';
import {
  FIRST_PERSON_EYE_HEIGHT,
  LOOK_SENSITIVITY,
  firstPersonInput,
  clampLookPitch,
  lookDirection,
  firstPersonEye,
} from '../src/components/town/firstPerson.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
const closeVector = (actual, expected) => Object.entries(expected).forEach(([axis, value]) => close(actual[axis], value));

test('first-person constants describe human eye level and a fixed pointer sensitivity', () => {
  assert.equal(FIRST_PERSON_EYE_HEIGHT, 1.7);
  assert.equal(LOOK_SENSITIVITY, 0.0022);
});

test('heading zero moves forwards along -Z and strafes right along +X', () => {
  closeVector(firstPersonInput(1, 0, 0), { x: 0, z: -1 });
  closeVector(firstPersonInput(-1, 0, 0), { x: 0, z: 1 });
  closeVector(firstPersonInput(0, 1, 0), { x: 1, z: 0 });
  closeVector(firstPersonInput(0, -1, 0), { x: -1, z: 0 });
});

test('a positive ninety-degree heading rotates forward to +X and right to +Z', () => {
  closeVector(firstPersonInput(1, 0, Math.PI / 2), { x: 1, z: 0 });
  closeVector(firstPersonInput(0, 1, Math.PI / 2), { x: 0, z: 1 });
  closeVector(firstPersonInput(1, 0, -Math.PI / 2), { x: -1, z: 0 });
});

test('diagonal movement is unit speed at every sampled heading', () => {
  for (const yaw of [0, 0.65, Math.PI / 2, Math.PI, -Math.PI, 100]) {
    for (const forward of [-1, 1]) for (const right of [-1, 1]) {
      const input = firstPersonInput(forward, right, yaw);
      close(Math.hypot(input.x, input.z), 1);
    }
  }
  closeVector(firstPersonInput(1, 1, 0), { x: Math.SQRT1_2, z: -Math.SQRT1_2 });
});

test('small analog inputs retain their magnitude rather than accelerating to full speed', () => {
  const input = firstPersonInput(0.3, 0.4, 1.2);
  close(Math.hypot(input.x, input.z), 0.5);
  closeVector(firstPersonInput(0, 0, 2), { x: 0, z: 0 });
});

test('oversized input axes are bounded and invalid axes cannot contaminate movement', () => {
  closeVector(firstPersonInput(Number.MAX_VALUE, Number.MAX_VALUE, 0), { x: Math.SQRT1_2, z: -Math.SQRT1_2 });
  for (const value of [NaN, Infinity, -Infinity, undefined, null, '1', {}, []]) {
    closeVector(firstPersonInput(value, value, value), { x: 0, z: 0 });
    closeVector(firstPersonInput(1, value, value), { x: 0, z: -1 });
  }
});

test('pitch is limited short of either pole and invalid values return a level view', () => {
  const limit = Math.PI / 2 - 0.12;
  close(clampLookPitch(100), limit);
  close(clampLookPitch(-100), -limit);
  close(clampLookPitch(0.3), 0.3);
  for (const value of [NaN, Infinity, -Infinity, undefined, null, '1']) {
    assert.equal(clampLookPitch(value), 0);
  }
});

test('look direction follows the same clockwise heading convention as movement', () => {
  closeVector(lookDirection(0, 0), { x: 0, y: 0, z: -1 });
  closeVector(lookDirection(Math.PI / 2, 0), { x: 1, y: 0, z: 0 });
  closeVector(lookDirection(Math.PI, 0), { x: 0, y: 0, z: 1 });
  closeVector(lookDirection(-Math.PI / 2, 0), { x: -1, y: 0, z: 0 });
});

test('positive pitch looks up while extreme pitch never reverses horizontal heading', () => {
  for (const yaw of [0, 0.65, Math.PI / 2, Math.PI, -Math.PI]) {
    const level = lookDirection(yaw, 0);
    for (const pitch of [-100, -0.4, 0, 0.4, 100]) {
      const direction = lookDirection(yaw, pitch);
      close(Math.hypot(direction.x, direction.y, direction.z), 1);
      assert.ok(direction.x * level.x + direction.z * level.z > 0);
      assert.ok(Math.hypot(direction.x, direction.z) >= Math.sin(0.12) - 1e-12);
      if (pitch !== 0) assert.equal(Math.sign(direction.y), Math.sign(pitch));
    }
  }
});

test('invalid look angles fall back to a finite forward unit vector', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, null, '1', {}]) {
    closeVector(lookDirection(value, value), { x: 0, y: 0, z: -1 });
  }
  const extreme = lookDirection(Number.MAX_VALUE, Number.MAX_VALUE);
  close(Math.hypot(extreme.x, extreme.y, extreme.z), 1);
});

test('eye position follows jump height without mutating the source pose', () => {
  const pose = Object.freeze({ x: -12.5, y: 1.5, z: 27.5, yaw: 0.7 });
  assert.deepEqual(firstPersonEye(pose), { x: -12.5, y: 3.2, z: 27.5 });
  assert.deepEqual(pose, { x: -12.5, y: 1.5, z: 27.5, yaw: 0.7 });
  for (const y of [-2, NaN, Infinity, '1']) assert.equal(firstPersonEye({ y }).y, 1.7);
});

test('missing or invalid eye coordinates fall back independently to the spawn position', () => {
  for (const pose of [undefined, null, {}, { x: NaN, z: Infinity }, { x: '3', z: null }]) {
    assert.deepEqual(firstPersonEye(pose), { x: SPAWN.x, y: 1.7, z: SPAWN.z });
  }
  assert.deepEqual(firstPersonEye({ x: 4, z: NaN }), { x: 4, y: 1.7, z: SPAWN.z });
  assert.deepEqual(firstPersonEye({ x: Infinity, z: -8 }), { x: SPAWN.x, y: 1.7, z: -8 });
});
