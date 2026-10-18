import { AnimationClip, PropertyBinding } from 'three';
import { appUrl } from './appUrl.js';

export const CHARACTER_MODEL_LIMITS = Object.freeze({ maxBytes: 20 * 1024 * 1024, timeoutMs: 20000, nodes: 512, meshes: 128, animations: 32, skins: 32, images: 32 });
const URL_PATTERN = /^\/api\/game-characters\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.glb$/i;
const FACING = Object.freeze({ 'positive-z': 0, 'negative-z': Math.PI, 'positive-x': -Math.PI / 2, 'negative-x': Math.PI / 2 });
const EXTENSIONS = new Set(['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_emissive_strength']);
const fail = () => { throw new Error('角色模型格式或资源不符合安全限制'); };
const int = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const list = (v, limit) => { if (v === undefined) return []; if (!Array.isArray(v) || v.length > limit) fail(); return v; };
const ref = (v, items) => { if (!int(v, 0, items.length - 1)) fail(); };
const vector = (v, count) => { if (v !== undefined && (!Array.isArray(v) || v.length !== count || v.some(n => !Number.isFinite(n) || Math.abs(n) > 1e8))) fail(); };

export function validateCharacterAsset(asset) {
  if (!asset || Object.getPrototypeOf(asset) !== Object.prototype || Object.keys(asset).some(k => !['modelUrl', 'walkingUrl', 'facing'].includes(k))) fail();
  if (typeof asset.modelUrl !== 'string' || !URL_PATTERN.test(asset.modelUrl)) fail();
  if (asset.walkingUrl !== undefined && (typeof asset.walkingUrl !== 'string' || !URL_PATTERN.test(asset.walkingUrl))) fail();
  const facing = asset.facing ?? 'positive-z';
  if (!Object.hasOwn(FACING, facing)) fail();
  return Object.freeze({ modelUrl: asset.modelUrl, ...(asset.walkingUrl ? { walkingUrl: asset.walkingUrl } : {}), facing });
}

export function characterFacingRotation(facing = 'positive-z') {
  if (!Object.hasOwn(FACING, facing)) fail();
  return FACING[facing];
}

// This parser is deliberately browser-independent: the server runs the same checks
// before storing a provider GLB. No URL, external buffer, shader or script is loaded.
export function validateGlb(data, { maxBytes = CHARACTER_MODEL_LIMITS.maxBytes } = {}) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes || !int(maxBytes, 20, CHARACTER_MODEL_LIMITS.maxBytes) || bytes.byteLength < 20 || bytes.byteLength > maxBytes) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) fail();
  let offset = 12, json = null, bin = null;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail();
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 || offset + length > bytes.byteLength) fail();
    if (type === 0x4e4f534a && json === null && offset === 20 && length <= 2 * 1024 * 1024) {
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length))); } catch { fail(); }
    } else if (type === 0x004e4942 && json !== null && bin === null) bin = bytes.subarray(offset, offset + length);
    else fail();
    offset += length;
  }
  if (!json || Array.isArray(json) || typeof json !== 'object' || json.asset?.version !== '2.0') fail();
  let entries = 0;
  function inspect(value, depth = 0) {
    if (++entries > 150000 || depth > 32) fail();
    if (typeof value === 'number' && !Number.isFinite(value)) fail();
    if (typeof value === 'string' && value.length > 16384) fail();
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['uri', '__proto__', 'prototype', 'constructor', 'shaders', 'programs', 'techniques'].includes(key)) fail();
      if (key === 'extensions' && (!child || typeof child !== 'object' || Object.keys(child).some(ext => !EXTENSIONS.has(ext)))) fail();
      inspect(child, depth + 1);
    }
  }
  inspect(json);
  for (const name of [...list(json.extensionsUsed, 16), ...list(json.extensionsRequired, 16)]) if (!EXTENSIONS.has(name)) fail();
  const buffers = list(json.buffers, 1), views = list(json.bufferViews, 4096), accessors = list(json.accessors, 2048);
  const nodes = list(json.nodes, CHARACTER_MODEL_LIMITS.nodes), meshes = list(json.meshes, CHARACTER_MODEL_LIMITS.meshes);
  const skins = list(json.skins, CHARACTER_MODEL_LIMITS.skins), animations = list(json.animations, CHARACTER_MODEL_LIMITS.animations);
  const images = list(json.images, CHARACTER_MODEL_LIMITS.images), textures = list(json.textures, 64), samplers = list(json.samplers, 64), materials = list(json.materials, 128), scenes = list(json.scenes, 16);
  if (buffers.length) {
    if (!bin || !int(buffers[0]?.byteLength, 1, bin.byteLength) || bin.byteLength - buffers[0].byteLength > 3) fail();
  } else if (bin?.byteLength) fail();
  for (const b of views) {
    if (!b || b.buffer !== 0 || !buffers.length || !int(b.byteOffset ?? 0) || !int(b.byteLength, 1) || (b.byteOffset ?? 0) + b.byteLength > buffers[0].byteLength) fail();
    if (b.byteStride !== undefined && (!int(b.byteStride, 4, 252) || b.byteStride % 4)) fail();
  }
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  let accessorElements = 0;
  for (const a of accessors) {
    if (!a || a.sparse !== undefined || !Object.hasOwn(components, a.type) || !Object.hasOwn(sizes, a.componentType) || !int(a.count, 1, 1000000)) fail();
    accessorElements += a.count;
    if (accessorElements > 5000000) fail();
    ref(a.bufferView, views);
    const b = views[a.bufferView], elementBytes = components[a.type] * sizes[a.componentType], stride = b.byteStride ?? elementBytes;
    const start = a.byteOffset ?? 0;
    if (!int(start) || start % sizes[a.componentType] || stride < elementBytes || start + (a.count - 1) * stride + elementBytes > b.byteLength) fail();
    if (a.type.startsWith('MAT') && a.componentType !== 5126) fail();
    if (a.min) vector(a.min, components[a.type]);
    if (a.max) vector(a.max, components[a.type]);
  }
  const parents = new Map();
  nodes.forEach((n, index) => {
    if (!n || typeof n !== 'object') fail();
    for (const child of list(n.children, 512)) { ref(child, nodes); if (child === index || parents.has(child)) fail(); parents.set(child, index); }
    if (n.mesh !== undefined) ref(n.mesh, meshes);
    if (n.skin !== undefined) ref(n.skin, skins);
    vector(n.translation, 3); vector(n.rotation, 4); vector(n.scale, 3); vector(n.matrix, 16);
  });
  for (let i = 0; i < nodes.length; i++) { const seen = new Set([i]); let p = parents.get(i); while (p !== undefined) { if (seen.has(p)) fail(); seen.add(p); p = parents.get(p); } }
  for (const scene of scenes) for (const node of list(scene.nodes, 512)) ref(node, nodes);
  if (json.scene !== undefined) ref(json.scene, scenes);
  let primitiveCount = 0;
  for (const mesh of meshes) {
    for (const primitive of list(mesh?.primitives, 64)) {
      if (++primitiveCount > 512) fail();
      if (!primitive.attributes || typeof primitive.attributes !== 'object') fail();
      for (const a of Object.values(primitive.attributes)) ref(a, accessors);
      if (primitive.indices !== undefined) ref(primitive.indices, accessors);
      if (primitive.material !== undefined) ref(primitive.material, materials);
      if (primitive.mode !== undefined && !int(primitive.mode, 0, 6)) fail();
      for (const target of list(primitive.targets, 32)) for (const a of Object.values(target)) ref(a, accessors);
    }
  }
  for (const skin of skins) {
    const joints = list(skin?.joints, 256); if (!joints.length || new Set(joints).size !== joints.length) fail();
    for (const joint of joints) ref(joint, nodes);
    if (skin.skeleton !== undefined) ref(skin.skeleton, nodes);
    if (skin.inverseBindMatrices !== undefined) {
      ref(skin.inverseBindMatrices, accessors);
      const a = accessors[skin.inverseBindMatrices];
      if (a.type !== 'MAT4' || a.componentType !== 5126 || a.count < joints.length) fail();
    }
  }
  for (const animation of animations) {
    const tracks = list(animation?.samplers, 512);
    for (const sampler of tracks) {
      ref(sampler.input, accessors); ref(sampler.output, accessors);
      if (accessors[sampler.input].type !== 'SCALAR' || accessors[sampler.input].componentType !== 5126) fail();
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.interpolation ?? 'LINEAR')) fail();
    }
    for (const channel of list(animation.channels, 512)) {
      ref(channel.sampler, tracks); ref(channel.target?.node, nodes);
      if (!['translation', 'rotation', 'scale', 'weights'].includes(channel.target.path)) fail();
      const sampler = tracks[channel.sampler], input = accessors[sampler.input], output = accessors[sampler.output];
      if (output.componentType !== 5126) fail();
      if (channel.target.path !== 'weights' && (output.type !== (channel.target.path === 'rotation' ? 'VEC4' : 'VEC3') || output.count !== input.count * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1))) fail();
    }
  }
  let pixels = 0;
  for (const img of images) {
    if (!img || !['image/png', 'image/jpeg'].includes(img.mimeType)) fail();
    ref(img.bufferView, views);
    const b = views[img.bufferView], imageBytes = bin.subarray(b.byteOffset ?? 0, (b.byteOffset ?? 0) + b.byteLength);
    const [width, height] = embeddedImageSize(imageBytes, img.mimeType);
    pixels += width * height;
    if (!int(width, 1, 4096) || !int(height, 1, 4096) || pixels > 32 * 1024 * 1024) fail();
  }
  for (const texture of textures) { ref(texture.source, images); if (texture.sampler !== undefined) ref(texture.sampler, samplers); }
  return { json, byteLength: bytes.byteLength, binByteLength: bin?.byteLength ?? 0 };
}

function embeddedImageSize(bytes, mime) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    if (bytes.length < 33 || v.getUint32(0) !== 0x89504e47 || v.getUint32(4) !== 0x0d0a1a0a || v.getUint32(8) !== 13 || v.getUint32(12) !== 0x49484452) fail();
    return [v.getUint32(16), v.getUint32(20)];
  }
  if (bytes.length < 4 || v.getUint16(0) !== 0xffd8) fail();
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p++] !== 0xff) fail();
    while (bytes[p] === 0xff) p++;
    const marker = bytes[p++];
    if (p + 2 > bytes.length || marker === 0xda || marker === 0xd9) fail();
    const length = v.getUint16(p);
    if (length < 2 || p + length > bytes.length) fail();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) { if (length < 8) fail(); return [v.getUint16(p + 5), v.getUint16(p + 3)]; }
    p += length;
  }
  fail();
}

export function modelNormalization(bounds, targetHeight = 2.1) {
  const min = bounds?.min, max = bounds?.max;
  if (!min || !max || ![min.x, min.y, min.z, max.x, max.y, max.z, targetHeight].every(Number.isFinite) || targetHeight <= 0 || targetHeight > 3) fail();
  const height = max.y - min.y, width = max.x - min.x, depth = max.z - min.z;
  if (height < 0.0001 || height > 100000 || width <= 0 || depth <= 0 || width / height > 5 || depth / height > 5) fail();
  const scale = targetHeight / height;
  return { scale, position: [-(min.x + max.x) / 2 * scale, -min.y * scale, -(min.z + max.z) / 2 * scale], height: targetHeight };
}

// Rotation-only, bone-bound tracks: imported root translation/scale cannot move
// the game controller, shift the model off its collider, or scale its physics.
export function prepareCharacterAnimations(modelGltf, walkingGltf = null, targetScene = modelGltf?.scene) {
  const bones = new Map(); let skinned = 0;
  targetScene?.traverse(node => {
    if (!node.isSkinnedMesh || !node.skeleton?.bones.length || !node.geometry?.attributes.skinIndex || !node.geometry?.attributes.skinWeight) return;
    skinned++;
    for (const bone of node.skeleton.bones) { if (!bone.name || (bones.has(bone.name) && bones.get(bone.name) !== bone)) fail(); bones.set(bone.name, bone); }
  });
  if (!skinned) fail();
  function convert(clip, source, name) {
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 120 || !Array.isArray(clip.tracks) || clip.tracks.length > 512) fail();
    const tracks = [];
    for (const track of clip.tracks) {
      let parsed; try { parsed = PropertyBinding.parseTrackName(track.name); } catch { fail(); }
      if (parsed.propertyName !== 'quaternion' || parsed.objectName || parsed.propertyIndex !== undefined) continue;
      const sourceNode = PropertyBinding.findNode(source.scene, parsed.nodeName);
      if (sourceNode && !sourceNode.isBone) continue;
      const bone = sourceNode?.name && bones.get(sourceNode.name);
      if (!bone) fail();
      if (!track.times || track.times.length < 2 || track.times.length > 12000 || !track.values || ![4, 12].includes(track.values.length / track.times.length)) fail();
      for (let i = 0; i < track.times.length; i++) if (!Number.isFinite(track.times[i]) || track.times[i] < 0 || track.times[i] > 120 || (i && track.times[i] <= track.times[i - 1])) fail();
      if (Array.from(track.values).some(v => !Number.isFinite(v) || Math.abs(v) > 10000)) fail();
      const copy = track.clone(); copy.name = `${bone.uuid}.quaternion`; tracks.push(copy);
    }
    if (!tracks.length) fail();
    return new AnimationClip(name, clip.duration, tracks);
  }
  const source = walkingGltf ?? modelGltf;
  const sourceClips = source?.animations ?? [];
  const walkClip = sourceClips.find(clip => /walk|locomotion/i.test(clip.name)) ?? (walkingGltf ? sourceClips[0] : null);
  const walk = convert(walkClip, source, 'walk');
  const idleClip = modelGltf.animations?.find(clip => /idle/i.test(clip.name));
  const idle = idleClip ? convert(idleClip, modelGltf, 'idle') : null;
  return { walk, idle };
}

export async function fetchCharacterGlb(url, { signal, fetchImpl = globalThis.fetch, timeoutMs = CHARACTER_MODEL_LIMITS.timeoutMs } = {}) {
  if (typeof url !== 'string' || !URL_PATTERN.test(url) || !int(timeoutMs, 1, 30000)) fail();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timer, reader;
  const work = async () => {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetchImpl(appUrl(url), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!response.ok || !response.body?.getReader || !['model/gltf-binary', 'application/octet-stream'].includes((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase())) fail();
    const length = Number(response.headers.get('content-length'));
    if (!Number.isFinite(length) || length < 0 || length > CHARACTER_MODEL_LIMITS.maxBytes) fail();
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) break;
      size += value.byteLength;
      if (size > CHARACTER_MODEL_LIMITS.maxBytes) fail();
      chunks.push(value);
    }
    const buffer = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    validateGlb(buffer);
    return buffer.buffer;
  };
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      const cancel = () => reject(new DOMException('Aborted', 'AbortError'));
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) cancel();
      timer = setTimeout(abort, timeoutMs);
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); void reader?.cancel().catch(() => {}); }
}
