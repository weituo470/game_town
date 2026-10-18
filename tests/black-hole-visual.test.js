import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BLACK_HOLE_VISUAL, createBlackHoleVisual, sampleBlackHoleEnvelope } from '../src/components/drone/blackHoleVisual.js';
import { BLACK_HOLE_SHADERS, BLACK_HOLE_SHADER_PROVENANCE, DEEPFLOW_SHADERS } from '../src/components/drone/deepflowBlackHoleShaders.js';

// The open-source edition intentionally replaces the unlicensed website
// replica. Tests assert the original placeholder and preserve lifecycle,
// reduced-motion, disposal and sky-only occlusion contracts instead.
test('original placeholder has three small asset-free shader blocks and no website optics', () => {
  assert.equal(BLACK_HOLE_SHADER_PROVENANCE, 'original-open-source-placeholder-v1');
  assert.equal(DEEPFLOW_SHADERS, BLACK_HOLE_SHADERS, 'legacy import name is only an alias');
  assert.deepEqual(Object.keys(BLACK_HOLE_SHADERS), ['vertex', 'skyVertex', 'fragment']);
  for (const shader of Object.values(BLACK_HOLE_SHADERS)) {
    assert.ok(shader.length < 3000);
    assert.match(shader, /void main/);
    assert.doesNotMatch(shader, /sampler2D|uWebsite|uRGBShift|towardCenter|getRGBShiftedColor|for\s*\(/);
  }
  assert.match(BLACK_HOLE_SHADERS.fragment, /float core/);
  assert.match(BLACK_HOLE_SHADERS.fragment, /float ring/);
  assert.match(BLACK_HOLE_SHADERS.fragment, /#include <colorspace_fragment>/);
});

test('one two-triangle scene mesh replaces all former offscreen scenes and particles', () => {
  const visual = createBlackHoleVisual();
  assert.deepEqual(visual.group.position.toArray(), [0, 130, -50]);
  assert.equal(visual.group.name, 'game-town-black-hole');
  assert.deepEqual(visual.group.children, [visual.mesh]);
  assert.equal(visual.mesh.geometry.index.count, 6);
  assert.equal(visual.mesh.geometry.parameters.width, 320);
  assert.equal(visual.mesh.geometry.parameters.height, 180);
  assert.equal(visual.material.fragmentShader, BLACK_HOLE_SHADERS.fragment);
  assert.equal(visual.material.vertexShader, BLACK_HOLE_SHADERS.vertex);
  assert.equal(visual.material.depthWrite, false);
  assert.equal(visual.material.depthTest, false);
  assert.equal(visual.material.blending, THREE.NormalBlending);
  assert.equal(visual.resources.length, 2);
  assert.equal(visual.targets, undefined);
  assert.equal(visual.backdrop, undefined);
  assert.equal(BLACK_HOLE_VISUAL.durationMs, 90000);
  visual.dispose();
});

test('show fades in, grows, fades out and closes at the unchanged ninety-second boundary', () => {
  assert.equal(sampleBlackHoleEnvelope(0).visible, false);
  assert.ok(sampleBlackHoleEnvelope(5000).opacity > .4);
  assert.ok(sampleBlackHoleEnvelope(12000).growth < sampleBlackHoleEnvelope(24000).growth);
  assert.equal(sampleBlackHoleEnvelope(65000).opacity, 1);
  assert.ok(sampleBlackHoleEnvelope(85000).opacity < .6);
  assert.equal(sampleBlackHoleEnvelope(90000).visible, false);
  const visual = createBlackHoleVisual();
  for (const reduced of [false, true]) for (const time of [0, 5000, 25000, 65000, 85000, 90000, 200000]) {
    visual.update(time, reduced);
    const state = sampleBlackHoleEnvelope(time, reduced);
    assert.equal(visual.material.uniforms.uOpacity.value, state.opacity);
    assert.equal(visual.material.uniforms.uTime.value, state.time);
    assert.equal(visual.mesh.scale.x, state.growth);
    assert.equal(visual.group.visible, state.visible);
  }
  visual.dispose();
});

test('seeking is deterministic and all shader state stays finite for invalid or huge inputs', () => {
  const visual = createBlackHoleVisual();
  const snapshot = () => [visual.group.visible, visual.mesh.scale.x, visual.material.uniforms.uTime.value, visual.material.uniforms.uOpacity.value];
  visual.update(45000); const before = snapshot();
  visual.update(85000); visual.update(45000); assert.deepEqual(snapshot(), before);
  assert.equal(visual.update(45000), false);
  for (const time of [undefined, null, NaN, Infinity, -Infinity, -1, Number.MAX_VALUE]) {
    visual.update(time);
    assert.ok(snapshot().slice(1).every(Number.isFinite));
    assert.ok(visual.material.uniforms.uTime.value >= 0 && visual.material.uniforms.uTime.value < 42);
    assert.equal(visual.group.visible, false);
  }
  visual.dispose();
});

test('reduced motion freezes the ring phase while visibility and opacity remain externally controllable', () => {
  const visual = createBlackHoleVisual({ ambient: true });
  visual.update(25000, true, { opacity: .6 });
  const phase = visual.material.uniforms.uTime.value;
  visual.render();
  assert.equal(visual.update(65000, true), false);
  assert.equal(visual.render(), false);
  assert.equal(visual.material.uniforms.uTime.value, phase);
  visual.setAmbientVisibility({ opacity: .9 });
  assert.equal(visual.material.uniforms.uOpacity.value, .9);
  assert.equal(visual.material.uniforms.uTime.value, phase);
  assert.equal(visual.render(), true);
  visual.dispose();
});

test('render compatibility hook never reads or mutates renderer state or starts an offscreen render', () => {
  const untouchedRenderer = new Proxy({}, { get() { throw new Error('renderer access is forbidden'); }, set() { throw new Error('renderer mutation is forbidden'); } });
  const visual = createBlackHoleVisual();
  assert.equal(visual.render(untouchedRenderer), false);
  visual.update(50000);
  assert.equal(visual.render(untouchedRenderer), true);
  assert.equal(visual.render(untouchedRenderer), false);
  visual.update(51000); assert.equal(visual.render(untouchedRenderer), true);
  visual.update(90000); assert.equal(visual.render(untouchedRenderer), false);
  visual.dispose(); assert.equal(visual.render(untouchedRenderer), false);
});

test('ambient dark core and glow share one sky-only surface without any fullscreen backdrop', () => {
  const visual = createBlackHoleVisual({ ambient: true });
  assert.equal(visual.mode, 'ambient');
  assert.equal(visual.group.name, 'game-town-ambient-black-hole');
  assert.equal(visual.group.children.length, 1);
  assert.equal(visual.mesh.material.depthTest, true);
  assert.equal(visual.mesh.material.depthWrite, false);
  assert.equal(visual.mesh.material.depthFunc, THREE.LessEqualDepth);
  assert.equal(visual.mesh.material.transparent, true);
  assert.equal(visual.mesh.userData.isSky, true);
  assert.equal(visual.mesh.renderOrder, -998);
  assert.ok(visual.mesh.renderOrder > -1000 && visual.mesh.renderOrder < 0);
  assert.match(visual.mesh.material.vertexShader, /gl_Position = projectionMatrix \* modelViewMatrix \* vec4\(position, 1\.0\);\s*gl_Position\.z = gl_Position\.w;/);
  assert.doesNotMatch(visual.mesh.material.fragmentShader, /gl_FragDepth/);
  for (const time of [0, 3000, 90000, 120000, 500000]) {
    visual.update(time);
    assert.equal(visual.group.visible, true, 'ambient lifetime is owned by the existing night/event clock');
    assert.equal(visual.material.uniforms.uOpacity.value, 1);
  }
  visual.dispose();
});

test('far-depth core and ring are occluded by town geometry in perspective and orthographic cameras', () => {
  const cameras = [new THREE.PerspectiveCamera(55, 16 / 9, .08, 420), new THREE.OrthographicCamera(-80, 80, 45, -45, .1, 420)];
  for (const camera of cameras) {
    camera.updateMatrixWorld();
    const project = (x, y, distance) => new THREE.Vector4(x, y, -distance).setW(1)
      .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    for (const proxyDistance of [80, 230]) {
      const clip = project(5, 3, proxyDistance);
      const oldXY = [clip.x / clip.w, clip.y / clip.w];
      const oldDepth = .5 * (clip.z / clip.w) + .5;
      clip.z = clip.w;
      const skyDepth = .5 * (clip.z / clip.w) + .5;
      assert.equal(skyDepth, 1);
      assert.deepEqual([clip.x / clip.w, clip.y / clip.w], oldXY);
      assert.equal(skyDepth <= 1, true, 'clear sky accepts the apparition');
      for (const surfaceDistance of [1, 70, 200, 350, 419]) {
        const surfaceClip = project(5, 3, surfaceDistance);
        const surfaceDepth = .5 * (surfaceClip.z / surfaceClip.w) + .5;
        assert.ok(surfaceDepth < 1);
        assert.equal(skyDepth <= surfaceDepth, false, 'every nearer opaque surface occludes both ring and dark core');
        if (surfaceDistance > proxyDistance) assert.ok(oldDepth < surfaceDepth);
      }
    }
  }
});

test('ambient visibility clamps invalid values and does not restart the absolute-time phase', () => {
  const visual = createBlackHoleVisual({ ambient: true });
  visual.update(120000); const time = visual.material.uniforms.uTime.value;
  assert.equal(visual.setAmbientVisibility({ opacity: .4, growth: .7 }), true);
  assert.equal(visual.material.uniforms.uOpacity.value, .4);
  assert.equal(visual.material.uniforms.uTime.value, time);
  assert.equal(visual.mesh.scale.x, .7);
  visual.setAmbientVisibility({ visible: false }); assert.equal(visual.group.visible, false);
  visual.update(150000, false, { visible: true, opacity: 0, growth: 1 }); assert.equal(visual.group.visible, false);
  visual.setAmbientVisibility({ opacity: .8 }); assert.equal(visual.group.visible, true);
  visual.setAmbientVisibility({ opacity: NaN, growth: Infinity });
  assert.equal(visual.material.uniforms.uOpacity.value, .8); assert.equal(visual.mesh.scale.x, 1);
  visual.setAmbientVisibility({ opacity: 4, growth: -2 });
  assert.equal(visual.material.uniforms.uOpacity.value, 1); assert.equal(visual.group.visible, false);
  visual.dispose(); assert.equal(visual.setAmbientVisibility({ opacity: 1 }), false);
  const show = createBlackHoleVisual(); assert.equal(show.setAmbientVisibility({ opacity: 1 }), false); show.dispose();
});

test('all original placeholder GPU resources dispose once and no mutable state leaks between instances', () => {
  const visual = createBlackHoleVisual(), other = createBlackHoleVisual();
  assert.notEqual(visual.material, other.material);
  assert.notEqual(visual.mesh.geometry, other.mesh.geometry);
  visual.update(50000); assert.equal(other.group.visible, false);
  let disposals = 0;
  for (const resource of visual.resources) resource.addEventListener('dispose', () => disposals++);
  visual.dispose(); visual.dispose();
  assert.equal(disposals, 2); assert.equal(visual.group.children.length, 0);
  assert.equal(visual.update(45000), false); other.dispose();
});
