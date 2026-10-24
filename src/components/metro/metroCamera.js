import { METRO_ISLAND, metroFlightFloor } from '../../../shared/metro-island.js';

export const METRO_SHOTS = Object.freeze([
  { id: 'skyline', name: '城市天际线' },
  { id: 'avenue', name: '中央大道' },
  { id: 'waterfront', name: '滨海街区' },
]);

export function metroCameraFloor(position, clearance = 1.7) {
  return Math.max(position[1], 1.2, metroFlightFloor(position[0], position[2]) + clearance);
}

export function sampleMetroCamera(shot = 'skyline', aspect = 16 / 9) {
  const { x, z } = METRO_ISLAND;
  const shots = {
    skyline: { position: [x + 310, 205, z + 385], target: [x, 31, z] },
    avenue: { position: [x, 3.2, z + 90], target: [x, 33, z - 38] },
    waterfront: { position: [x - 173, 20, z + 145], target: [x + 5, 43, z - 12] },
  };
  const id = Object.hasOwn(shots, shot) ? shot : 'skyline', pose = shots[id];
  const narrow = Number.isFinite(aspect) && aspect > 0 && aspect < .8;
  const gain = narrow ? id === 'skyline' ? 1.85 : id === 'avenue' ? 1 : 1.4 : 1;
  return { position: pose.position.map((v, i) => pose.target[i] + (v - pose.target[i]) * gain), target: [...pose.target], fov: narrow ? 58 : id === 'avenue' ? 62 : 49, near: .08, far: 2800 };
}
