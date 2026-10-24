import { REALISTIC_ISLAND, islandHeight } from '../../../shared/realistic-island.js';

export const ISLAND_SHOTS = Object.freeze([
  { id: 'aerial', name: '全岛鸟瞰' }, { id: 'coast', name: '弧湾海岸' }, { id: 'trail', name: '林间步道' },
]);
// A scoped final-lens guard: orbiting this island must not put the viewer
// inside the land, and must not change the camera rules of other programmes.
export function islandCameraFloor(position, clearance = 1.8) {
  return Math.max(position[1], 1.2, islandHeight(position[0], position[2]) + clearance);
}
export function sampleIslandCamera(shot = 'aerial', aspect = 16 / 9) {
  const { x, z } = REALISTIC_ISLAND;
  const poses = {
    aerial: { position: [x + 155, 145, z + 192], target: [x, -7, z] },
    coast: { position: [x - 116, 22, z + 96], target: [x + 3, 16, z - 17] },
    trail: { position: [x - 57, 8, z + 45], target: [x + 2, 19, z - 16] },
  };
  const shotId = Object.hasOwn(poses, shot) ? shot : 'aerial';
  const pose = poses[shotId];
  const narrow = Number.isFinite(aspect) && aspect > 0 && aspect < .8;
  const gain = narrow ? shotId === 'aerial' ? 1.85 : 1.30 : 1;
  return { position: pose.position.map((v, i) => pose.target[i] + (v - pose.target[i]) * gain), target: [...pose.target], fov: narrow ? 56 : 48, near: .08, far: 1800 };
}
