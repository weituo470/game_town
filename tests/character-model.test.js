import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, AnimationMixer, Bone, Box3, BufferAttribute, BufferGeometry, Group, MeshBasicMaterial, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Vector3, VectorKeyframeTrack } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTER_MODEL_LIMITS, characterFacingRotation, fetchCharacterGlb, modelNormalization, prepareCharacterAnimations, validateCharacterAsset, validateGlb } from '../src/lib/characterModel.js';

const MODEL = '/api/game-characters/assets/12345678-1234-4123-8123-123456789abc.glb';
const WALK = '/api/game-characters/assets/22345678-1234-4123-8123-123456789abc.glb';

function glb(json = { asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }, bin) {
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(padded);
  const binary = bin ? Buffer.alloc(Math.ceil(bin.length / 4) * 4) : null; bin?.copy(binary);
  const output = Buffer.alloc(20 + padded.length + (binary ? 8 + binary.length : 0));
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12); output.writeUInt32LE(0x4e4f534a, 16); padded.copy(output, 20);
  if (binary) { output.writeUInt32LE(binary.length, 20 + padded.length); output.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(output, 28 + padded.length); }
  return output;
}
function documentWithBuffer() {
  return { asset: { version: '2.0' }, buffers: [{ byteLength: 64 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 64 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
}
// Synthetic unit rig only; not an AI-generated or production character asset.
function rig(name = 'Hip') {
  const scene = new Group(), bone = new Bone(); bone.name = name;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 1]), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(12), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial()); mesh.add(bone); scene.add(mesh); mesh.bind(new Skeleton([bone]));
  return { scene, animations: [new AnimationClip('walk', 1, [new QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, 0.3, 0, 0, 0.9539392])])], bone };
}

test('private character asset DTO accepts UUID routes and copies only allowed fields', () => {
  const result = validateCharacterAsset({ modelUrl: MODEL, walkingUrl: WALK });
  assert.deepEqual(result, { modelUrl: MODEL, walkingUrl: WALK, facing: 'positive-z' });
  assert.ok(Object.isFrozen(result));
  for (const facing of ['positive-z', 'negative-z', 'positive-x', 'negative-x']) assert.ok(Number.isFinite(characterFacingRotation(facing)));
});
test('asset DTO rejects arbitrary URLs, query, traversal, misleading type and unknown metadata', () => {
  for (const modelUrl of ['https://example.com/a.glb', '//example.com/a.glb', `${MODEL}?token=1`, `${MODEL}#x`, MODEL.replace('assets/', 'assets/../'), 'data:model/gltf-binary,123', '/api/game-characters/assets/not-id.glb', 'constructor']) assert.throws(() => validateCharacterAsset({ modelUrl }));
  assert.throws(() => validateCharacterAsset({ modelUrl: MODEL, id: 'extra' }));
  assert.throws(() => validateCharacterAsset({ modelUrl: MODEL, facing: 'constructor' }));
  assert.throws(() => validateCharacterAsset({ modelUrl: MODEL, walkingUrl: null }));
});
test('GLB validator works on Node buffers, typed views and ArrayBuffer without requiring animations', () => {
  const input = glb(documentWithBuffer(), Buffer.alloc(64));
  for (const data of [input, new Uint8Array(input), input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)]) {
    const result = validateGlb(data); assert.equal(result.json.meshes.length, 1); assert.equal(result.binByteLength, 64); assert.equal(result.byteLength, input.length);
  }
});
test('GLB header, exact length, chunk types, JSON size and caller byte caps are enforced', () => {
  const input = glb();
  for (const offset of [0, 4, 8, 12, 16]) { const bad = Buffer.from(input); bad.writeUInt32LE(17, offset); assert.throws(() => validateGlb(bad)); }
  assert.throws(() => validateGlb(input.subarray(0, 10)));
  assert.throws(() => validateGlb(input, { maxBytes: 20 }));
  assert.throws(() => validateGlb(input, { maxBytes: CHARACTER_MODEL_LIMITS.maxBytes + 1 }));
  assert.throws(() => validateGlb(glb({ asset: { version: '1.0' } })));
});
test('all external or data URIs and executable/decoder extensions are rejected before parsing', () => {
  for (const extra of [{ buffers: [{ uri: 'https://bad/mesh.bin' }] }, { images: [{ uri: 'data:image/png;base64,aaa' }] }, { extras: { uri: 'file:///secret' } }, { extensionsUsed: ['KHR_draco_mesh_compression'] }, { nodes: [{ extensions: { EXT_mesh_gpu_instancing: {} } }] }, { shaders: [] }]) {
    assert.throws(() => validateGlb(glb({ asset: { version: '2.0' }, ...extra })));
  }
});
test('bounded node graph rejects cycles, multiple parents, invalid references and depth abuse', () => {
  for (const nodes of [[{ children: [0] }], [{ children: [1] }, { children: [0] }], [{ children: [2] }, { children: [2] }, {}], [{ mesh: 99 }], [{ children: [99] }], Array.from({ length: 513 }, () => ({}))]) assert.throws(() => validateGlb(glb({ asset: { version: '2.0' }, nodes })));
  let nested = {}; for (let i = 0; i < 40; i++) nested = { child: nested };
  assert.throws(() => validateGlb(glb({ asset: { version: '2.0' }, extras: nested })));
});
test('embedded buffer/accessor bounds and resource indices are checked', () => {
  const changes = [d => { d.bufferViews[0].byteOffset = 60; }, d => { d.accessors[0].count = 100; }, d => { d.accessors[0].bufferView = 2; }, d => { d.accessors[0].sparse = {}; }, d => { d.meshes[0].primitives[0].attributes.POSITION = 10; }, d => { d.nodes[0].translation = [0, 0]; }];
  for (const change of changes) { const doc = documentWithBuffer(); change(doc); assert.throws(() => validateGlb(glb(doc, Buffer.alloc(64)))); }
});
test('embedded PNG image dimension bombs are rejected; bounded header is accepted', () => {
  const image = Buffer.alloc(36); image.writeUInt32BE(0x89504e47, 0); image.writeUInt32BE(0x0d0a1a0a, 4); image.writeUInt32BE(13, 8); image.writeUInt32BE(0x49484452, 12); image.writeUInt32BE(128, 16); image.writeUInt32BE(128, 20);
  const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: image.length }], bufferViews: [{ buffer: 0, byteLength: image.length }], images: [{ bufferView: 0, mimeType: 'image/png' }] };
  assert.equal(validateGlb(glb(doc, image)).json.images.length, 1);
  image.writeUInt32BE(99999, 16); assert.throws(() => validateGlb(glb(doc, image)));
});
test('normalization centers the horizontal bounds and puts feet at 0 with height 2.1', () => {
  const result = modelNormalization(new Box3(new Vector3(-2, -1, -1), new Vector3(4, 9, 3)));
  assert.ok(Math.abs(result.scale - 0.21) < 1e-12); result.position.forEach((value, i) => assert.ok(Math.abs(value - [-0.21, 0.21, -0.21][i]) < 1e-12)); assert.equal(result.height, 2.1);
  for (const bounds of [new Box3(), new Box3(new Vector3(0, 0, 0), new Vector3(1, 0, 1)), new Box3(new Vector3(0, 0, 0), new Vector3(1000, 1, 1))]) assert.throws(() => modelNormalization(bounds));
});
test('base rig can be animation-free when explicit walking GLB contains generically named Animation', () => {
  const model = rig(), walking = rig(); model.animations = []; walking.animations[0].name = 'Animation';
  const cloned = cloneSkeleton(model.scene), clips = prepareCharacterAnimations(model, walking, cloned);
  assert.equal(clips.walk.name, 'walk'); assert.equal(clips.idle, null);
  assert.notEqual(cloned.children[0].skeleton.bones[0], model.bone);
  const mixer = new AnimationMixer(cloned); mixer.clipAction(clips.walk).play(); mixer.update(0.5);
  assert.notEqual(cloned.children[0].skeleton.bones[0].quaternion.x, 0);
  assert.equal(model.bone.quaternion.x, 0);
});
test('walk selection rejects unrigged models, missing walk, mismatched bones and malformed keyframes', () => {
  assert.throws(() => prepareCharacterAnimations({ scene: new Group(), animations: rig().animations }));
  const model = rig(); model.animations[0].name = 'Animation'; assert.throws(() => prepareCharacterAnimations(model));
  assert.throws(() => prepareCharacterAnimations(rig(), rig('OtherBone')));
  const invalid = rig(); invalid.animations[0].tracks[0].values[0] = NaN; assert.throws(() => prepareCharacterAnimations(invalid));
});
test('only bone rotation tracks survive; translation/scale cannot introduce root motion', () => {
  const model = rig();
  model.animations[0].tracks.push(new VectorKeyframeTrack('Hip.position', [0, 1], [0, 0, 0, 100, 100, 100]), new VectorKeyframeTrack('Hip.scale', [0, 1], [1, 1, 1, 99, 99, 99]));
  const clips = prepareCharacterAnimations(model);
  assert.equal(clips.walk.tracks.length, 1); assert.match(clips.walk.tracks[0].name, /\.quaternion$/);
  assert.equal(model.animations[0].tracks.length, 3);
});
test('safe fetch uses cookies/no redirects and validates the completed binary', async () => {
  let calls = 0;
  const actual = await fetchCharacterGlb(MODEL, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, MODEL); assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
    return new Response(glb(), { headers: { 'content-type': 'model/gltf-binary' } });
  } });
  assert.equal(calls, 1); assert.equal(validateGlb(actual).json.asset.version, '2.0');
});
test('fetch rejects wrong MIME, oversized response and malformed content without GLTFLoader', async () => {
  for (const response of [new Response(glb(), { headers: { 'content-type': 'text/html' } }), new Response(glb(), { headers: { 'content-type': 'model/gltf-binary', 'content-length': `${CHARACTER_MODEL_LIMITS.maxBytes + 1}` } }), new Response('bad', { headers: { 'content-type': 'application/octet-stream' } })]) await assert.rejects(fetchCharacterGlb(MODEL, { fetchImpl: async () => response }));
});
test('fetch timeout and external cancellation terminate even an uncooperative fetch', async () => {
  await assert.rejects(fetchCharacterGlb(MODEL, { fetchImpl: () => new Promise(() => {}), timeoutMs: 10 }), { name: 'AbortError' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchCharacterGlb(MODEL, { fetchImpl: () => new Promise(() => {}), signal: controller.signal }), { name: 'AbortError' });
});
