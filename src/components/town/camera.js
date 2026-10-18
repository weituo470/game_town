import { WORLD_SIZE, WORLD_BOUNDS, SPAWN } from '../../../shared/world.js';
import { WONDER_MAP, EXPLORATION_BOUNDS, inWonderGround, WONDERS, sampleRocket, sampleJet, sampleWonder } from '../../../shared/wonders.js';
import { onRiverPier } from '../../../shared/river.js';
import { inGptGround } from '../../../shared/gpt-park.js';
import { inParkGround } from '../../../shared/deepseek-park.js';
import { closeThirdPersonCamera } from './firstPerson.js';

// Both views keep the same heading, so switching cameras never changes WASD.
export const CAMERA_OFFSETS = Object.freeze({
  overview: Object.freeze([72, 90, 102]),
  follow: Object.freeze([24, 30, 34]),
});
export const OVERVIEW_TARGET = Object.freeze({ x: WONDER_MAP.centerX, y: 0.6, z: WONDER_MAP.centerZ });
export const FOLLOW_LOOK = Object.freeze({ yaw: Math.atan2(-24, 34), pitch: .38 - Math.atan2(30, Math.hypot(24, 34)) });

export function followCameraLens(aspect) {
  const portrait = Number.isFinite(aspect) && aspect > 0 && aspect < .75;
  return { distance: portrait ? 26 : 32, fov: portrait ? 58 : 50 };
}

export function followOrbitCamera(pose, yaw, pitch, options = {}) {
  return closeThirdPersonCamera(pose, yaw, pitch, { ...options, distance: followCameraLens(options.aspect).distance, targetHeight: 1.2, sweepStep: .32 });
}

// Grow only the exploration camera's frustum, in coarse steps. Ground-level
// precision and the independent cinematic/drone lens remain unchanged.
export function flightCameraFar(height) {
  const altitude = Number.isFinite(height) ? Math.max(0, height) : 0;
  return Math.max(420, Math.ceil((altitude + 360) / 420) * 420);
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const positive = value => Number.isFinite(value) && value > 0 ? value : 1;

export function projectedWorldSize() {
  const [x, y, z] = CAMERA_OFFSETS.follow;
  const groundDistance = Math.hypot(x, z);
  const distance = Math.hypot(x, y, z);
  return {
    width: WONDER_MAP.width * z / groundDistance + WONDER_MAP.depth * x / groundDistance,
    height: (WONDER_MAP.width * x + WONDER_MAP.depth * z) * y / (groundDistance * distance) + 15 * groundDistance / distance,
  };
}

export function overviewZoom(width, height) {
  const projected = projectedWorldSize();
  // UI gutters and a further 10% breathing room protect the complete ground
  // silhouette, including ten units of trees/buildings above its surface.
  return Math.min(Math.max(1, positive(width) - 36) / projected.width, Math.max(1, positive(height) - 110) / projected.height) * 0.9;
}

export function cameraZoom(viewMode, width, height) {
  if (viewMode === 'overview') return overviewZoom(width, height);
  if (viewMode === 'wonder') return positive(width) < 700 ? Math.max(7, positive(width) / 42) : Math.min(positive(width) / 72, positive(height) / 44);
  const safeWidth = positive(width), safeHeight = positive(height);
  return safeWidth < 700 ? Math.max(11, Math.min(17, safeWidth / 27)) : Math.min(safeWidth / 46, safeHeight / 32);
}

export function followTarget(pose, width) {
  const x = Number.isFinite(pose?.x) ? pose.x : SPAWN.x;
  const z = Number.isFinite(pose?.z) ? pose.z : SPAWN.z;
  const outsideTown = x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX || z < WORLD_BOUNDS.minZ || z > WORLD_BOUNDS.maxZ;
  const bounds = outsideTown && (inWonderGround(x, z) || inGptGround(x, z) || inParkGround(x, z) || onRiverPier(x, z) || pose?.jetpack) ? EXPLORATION_BOUNDS : WORLD_BOUNDS;
  return {
    x: clamp(x, bounds.minX, bounds.maxX),
    y: 1.2 + (Number.isFinite(pose?.y) ? Math.max(0, pose.y) : 0),
    z: clamp(z - (positive(width) < 700 ? 1.5 : 2.5), bounds.minZ, bounds.maxZ),
  };
}

export function cameraTarget(viewMode, pose, width, time = 0) {
  if (viewMode === 'wonder') {
    const w = WONDERS.find(item => Math.hypot(pose.x - item.x, pose.z - item.z) < 24);
    if (w?.id === 'carrier' && sampleWonder('carrier', time).active) { const jet = sampleJet(time); return { x: jet.x, y: jet.y + 1.5, z: jet.z }; }
    if (w) return { x: w.id === 'orca' ? -64 : w.x, y: w.id === 'rocket' ? 4.5 + Math.min(70, sampleRocket(time).height) : 1.5, z: w.id === 'rocket' ? -61 : w.z };
  }
  return viewMode === 'overview' ? { ...OVERVIEW_TARGET } : followTarget(pose, width);
}

// Observation changes only the lens within the existing town. Inward-looking
// harbour shots deliberately retain the town skyline and connecting bridges.
export function townWonderCamera(pose, time = 0, aspect = 1.6, reducedMotion = false) {
  const w = WONDERS.find(item => Math.hypot((pose?.x??0)-item.x,(pose?.z??0)-item.z)<24) || WONDERS[0];
  const portrait=Number.isFinite(aspect)&&aspect<.8;
  let position, target;
  if(w.id==='orca') { position=[-86,13,40];target=[-59,1.4,18]; }
  else if(w.id==='carrier') { position=[88,15,43];target=[61,2.2,18]; }
  else {
    const height=reducedMotion?0:Math.min(70,sampleRocket(time).height);
    position=[-25,15+height,-88];target=[0,6+height,-58];
  }
  if(portrait) {
    if(w.id==='rocket')position=position.map((v,i)=>target[i]+(v-target[i])*1.35);
    else {
      // Fit the entire original promenade/deck, not only its center. The actual
      // phone Canvas can be 390x736 (HUD excluded) or a full-height 390x844.
      // Center the site before dollying back; preserve the inward town skyline.
      const offset=position.map((v,i)=>v-target[i]);
      target=w.id==='carrier'?[63,2.2,20]:[-63,1.4,20];
      const distance=(w.id==='carrier'?1.9:2.25)*.53/Math.max(.25,aspect);
      position=target.map((v,i)=>v+offset[i]*distance);
    }
  }
  return {position,target,fov:portrait?55:50,id:w.id};
}
