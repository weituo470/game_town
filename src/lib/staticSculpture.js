import { Box3, Group, Vector3 } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const finiteVector = vector => [vector.x, vector.y, vector.z].every(Number.isFinite);

/**
 * Uniformly fit an already-oriented bounding box to a height, with its lowest
 * point at y=0 and the horizontal bounds centred at x=z=0. Does not mutate it.
 */
export function staticSculptureNormalization(bounds, targetHeight = 6) {
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) {
    throw new RangeError('Static sculpture targetHeight must be finite and positive.');
  }
  if (!bounds?.isBox3 || bounds.isEmpty() || !finiteVector(bounds.min) || !finiteVector(bounds.max)) {
    throw new RangeError('Static sculpture requires a finite, non-empty Box3.');
  }
  const size = bounds.getSize(new Vector3());
  if (!finiteVector(size) || size.y <= 0) {
    throw new RangeError('Static sculpture bounds must have a finite positive height.');
  }
  const center = bounds.getCenter(new Vector3());
  const scale = targetHeight / size.y;
  const position = [-center.x * scale, -bounds.min.y * scale, -center.z * scale];
  if (!Number.isFinite(scale) || scale <= 0 || !position.every(Number.isFinite)) {
    throw new RangeError('Static sculpture normalization exceeds finite transform limits.');
  }
  return Object.freeze({
    scale,
    position: Object.freeze(position),
    targetHeight,
    sourceSize: Object.freeze(size.toArray()),
  });
}

/**
 * Prepare an existing Three.js asset, never a generated placeholder.
 *
 * source must include every bone referenced by its SkinnedMeshes (pass the full
 * GLTF scene). Its local transform is retained; an external parent's transform
 * is intentionally not imported. yaw is a Y-axis rotation in radians, applied
 * before measuring the precise vertex bounds, including the current skin/morph
 * pose. No AnimationMixer is created, no clips start, and the pose is not reset.
 *
 * The returned scene is an identity-transform placement root. Put it inside the
 * caller's world-position group. model is an independent object/bone hierarchy,
 * but geometry, materials and textures remain shared with the source. Do not
 * dispose these shared resources while another clone or the source uses them;
 * their loader/cache owner retains resource-disposal responsibility.
 *
 * Cloned Skeletons are instance-owned. Their bone textures are not copied from
 * the source; a renderer may allocate them later. The caller must invoke the
 * returned dispose() after unmounting this instance. It disposes ONLY those
 * cloned skeleton bone textures, never shared geometry/material/image textures
 * or the source skeleton. In R3F, disable recursive disposal on this primitive
 * (dispose={null}) and keep shared-asset cleanup with the original loader owner.
 */
export function createStaticSculpture(source, { targetHeight = 6, yaw = 0 } = {}) {
  if (!source?.isObject3D || typeof source.traverse !== 'function') {
    throw new TypeError('Static sculpture requires an existing Three.js Object3D asset.');
  }
  if (!Number.isFinite(yaw)) throw new RangeError('Static sculpture yaw must be finite.');
  // Validate options before cloning any resource hierarchy.
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) {
    throw new RangeError('Static sculpture targetHeight must be finite and positive.');
  }
  const sourceObjects = new Set();
  source.traverse(object => sourceObjects.add(object));
  source.traverse(object => {
    if (object.isSkinnedMesh && (!object.skeleton || object.skeleton.bones.some(bone => !sourceObjects.has(bone)))) {
      throw new TypeError('Static sculpture source must contain every referenced skeleton bone.');
    }
  });

  const model = cloneSkeleton(source);
  const scene = new Group();
  scene.name = 'static-sculpture';
  const normalized = new Group();
  normalized.name = 'static-sculpture-normalization';
  const oriented = new Group();
  oriented.name = 'static-sculpture-orientation';
  oriented.rotation.y = yaw;
  oriented.add(model);
  normalized.add(oriented);
  scene.add(normalized);
  scene.updateMatrixWorld(true);

  const normalization = staticSculptureNormalization(new Box3().setFromObject(scene, true), targetHeight);
  normalized.scale.setScalar(normalization.scale);
  normalized.position.fromArray(normalization.position);
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene, true);
  // Detect invalid transformed vertex data rather than returning a broken asset.
  staticSculptureNormalization(bounds, targetHeight);
  const skeletons = new Set();
  model.traverse(object => { if (object.isSkinnedMesh) skeletons.add(object.skeleton); });
  const dispose = () => { for (const skeleton of skeletons) skeleton.dispose(); };
  return { scene, model, normalization, bounds, dispose };
}
