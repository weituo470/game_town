import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

// The component has no JSX expressions. Resolve its three ordinary imports to
// load the exact source in Node without adding a test loader or build dependency.
const source = fs.readFileSync(new URL('../src/components/town/SoftPenumbra.jsx', import.meta.url), 'utf8');
const loadable = source.replace(/from '([^']+)'/g, (_, name) => `from '${import.meta.resolve(name)}'`);
const { createPenumbraPatch, refreshShadowMaterials, installSoftPenumbra } = await import(
  `data:text/javascript;base64,${Buffer.from(loadable).toString('base64')}`
);

function fixture() {
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  const geometry = new THREE.BoxGeometry();
  scene.add(new THREE.Mesh(geometry, material));
  scene.add(new THREE.Mesh(geometry, [material, material]));
  let disposals = 0;
  material.addEventListener('dispose', () => { disposals++; });
  const program = { sentinel: 'composer program' };
  const programs = [program];
  let invalidations = 0;
  const gl = { shadowMap: { type: THREE.PCFSoftShadowMap }, info: { programs } };
  Object.defineProperty(gl, 'properties', { get() { throw new Error('must not edit private renderer properties'); } });
  return { scene, material, gl, programs, program, disposeCount: () => disposals, invalidations: () => invalidations, invalidate: () => { invalidations++; } };
}

test('soft penumbra: installed Three gets a single-exit PCSS branch with its original intensity', () => {
  const patch = createPenumbraPatch(THREE.ShaderChunk.shadowmap_pars_fragment);
  assert.ok(patch);
  assert.equal((patch.shader.match(/float PCSS \(/g) || []).length, 1);
  const start = patch.shader.indexOf('float getShadow(');
  const end = patch.shader.indexOf('vec2 cubeToUV', start);
  assert.ok(end > start, 'test must isolate getShadow rather than later shader functions');
  const getShadow = patch.shader.slice(start, end);
  assert.match(getShadow, /float shadow = 1\.0;/);
  assert.match(getShadow, /shadowCoord\.xyz \/= shadowCoord\.w;/);
  assert.match(getShadow, /shadowCoord\.z \+= shadowBias;/);
  assert.match(getShadow, /if \( frustumTest \) \{\s*shadow = PCSS\( shadowMap, shadowCoord \);\s*\}/);
  assert.match(getShadow, /return mix\( 1\.0, shadow, shadowIntensity \);/);
  assert.equal((getShadow.match(/\breturn\b/g) || []).length, 1);
  assert.doesNotMatch(getShadow, /SHADOWMAP_TYPE_|texture2DCompare|VSMShadow/);
  assert.equal(patch.rawDepth, false, 'Three r180 uses packed depth');
  assert.match(patch.shader, /unpackRGBAToDepth\( texture2D\( shadowMap, uv \+ offset \) \)/);
  assert.equal(createPenumbraPatch('unsupported shader'), null);
  for (const samples of [0, 1.5, 33, NaN]) assert.throws(() => createPenumbraPatch('x', { samples }), RangeError);
});

test('soft penumbra: nested braces and comments are matched, malformed layouts stay unchanged', () => {
  const original = `#ifdef USE_SHADOWMAP
float getShadow( sampler2D shadowMap ) {
  float shadow = 1.0;
  if ( frustumTest ) {
    /* comment containing } and { */
    if (sampleEnabled) { shadow = 0.2; } // }
  }
  return shadow;
}
#endif`;
  const patch = createPenumbraPatch(original);
  assert.ok(patch);
  assert.match(patch.shader, /shadow = PCSS\( shadowMap, shadowCoord \);/);
  assert.match(patch.shader, /return shadow;/, 'older no-intensity return is preserved');
  assert.doesNotMatch(patch.shader, /sampleEnabled/);
  const malformed = [
    original.replace('  }\n  return shadow;', '  return shadow;'),
    original.replace('/* comment containing } and { */', '/* never closed'),
    original.replace('float shadow = 1.0;', 'float shadow;'),
    original.replace('return shadow;', 'return unknownVisibility;'),
  ];
  for (const shader of malformed) {
    const saved = THREE.ShaderChunk.shadowmap_pars_fragment;
    assert.equal(createPenumbraPatch(shader), null, 'unsupported layout must not produce a partial patch');
    assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment, saved);
  }
});

test('soft penumbra: shared materials are disposed once without bypassing dispose listeners', () => {
  const f = fixture();
  let programReferencePresent = true;
  f.material.addEventListener('dispose', () => {
    assert.equal(programReferencePresent, true, 'Three can still see its program references at dispose time');
    programReferencePresent = false;
  });
  refreshShadowMaterials(f.scene);
  assert.equal(f.disposeCount(), 1);
  assert.equal(f.material.version, 1);
});

test('soft penumbra: StrictMode setup-cleanup-setup restores shader and preserves unrelated programs', () => {
  const f = fixture();
  const original = THREE.ShaderChunk.shadowmap_pars_fragment;
  const first = installSoftPenumbra(f.gl, f.scene, f.invalidate);
  assert.notEqual(THREE.ShaderChunk.shadowmap_pars_fragment, original);
  first();
  first();
  assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment, original);
  const second = installSoftPenumbra(f.gl, f.scene, f.invalidate);
  second();
  assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment, original);
  assert.equal(f.gl.shadowMap.type, THREE.PCFSoftShadowMap);
  assert.equal(f.disposeCount(), 4);
  assert.equal(f.invalidations(), 4);
  assert.strictEqual(f.gl.info.programs, f.programs);
  assert.deepEqual(f.programs, [f.program]);
});

test('soft penumbra: out-of-order owners do not leave an orphaned global patch', () => {
  const first = fixture(), second = fixture();
  const original = THREE.ShaderChunk.shadowmap_pars_fragment;
  const cleanA = installSoftPenumbra(first.gl, first.scene, first.invalidate);
  const patched = THREE.ShaderChunk.shadowmap_pars_fragment;
  const cleanB = installSoftPenumbra(second.gl, second.scene, second.invalidate);
  cleanA();
  assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment, patched);
  cleanB();
  assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment, original);
});

test('soft penumbra: raw-depth renderers restore shadow type only after their last owner', () => {
  const original = THREE.ShaderChunk.shadowmap_pars_fragment;
  const raw = '#ifdef USE_SHADOWMAP\n// sampler2DShadow\nfloat getShadow( sampler2D shadowMap ) { float shadow = 1.0; if ( frustumTest ) { shadow = 0.0; } return shadow; }\n#endif';
  const patch = createPenumbraPatch(raw);
  assert.equal(patch.rawDepth, true);
  assert.match(patch.shader, /texture2D\( shadowMap, uv \+ offset \)\.r/);
  assert.doesNotMatch(patch.shader, /unpackRGBAToDepth/);
  THREE.ShaderChunk.shadowmap_pars_fragment = raw;
  const f = fixture();
  let cleanA, cleanB;
  try {
    cleanA = installSoftPenumbra(f.gl, f.scene, f.invalidate);
    cleanB = installSoftPenumbra(f.gl, f.scene, f.invalidate);
    assert.equal(f.gl.shadowMap.type, THREE.BasicShadowMap);
    cleanA();
    assert.equal(f.gl.shadowMap.type, THREE.BasicShadowMap);
    cleanB();
    assert.equal(f.gl.shadowMap.type, THREE.PCFSoftShadowMap);
    assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment, raw);
  } finally {
    cleanA?.(); cleanB?.();
    THREE.ShaderChunk.shadowmap_pars_fragment = original;
  }
});
