/** Procedural light paths; no downloaded textures or character meshes. */
import { createKidGokuArtwork } from './droneKidGoku.js';
export const FORMATION_COUNT = 4096;
export const DRONE_PALETTE = Object.freeze({
  gold: [1.85, 1.04, 0.35], paleGold: [1.9, 1.45, 0.78],
  jade: [0.27, 1.26, 1.12], white: [1.65, 1.78, 1.8],
  hair: [.48, .67, .9], hairShade: [.16, .24, .34],
  skin: [1.6, .93, .5], skinSoft: [1.15, .62, .31], skinShade: [.85, .35, .14], ink: [.7, .36, .18],
  eyeWhite: [1.65, 1.78, 1.8], paleWhite: [.8, 1.08, 1.3],
  blue: [.13, .77, 1.52], blueFill: [.09, .43, .94], blueShade: [.09, .25, .65],
  red: [1.7, .07, .025], redGlow: [1.9, .24, .055],
});

const TAU = Math.PI * 2;
function createArtwork() {
  const groups = createKidGokuArtwork();

  const positions = new Float32Array(FORMATION_COUNT * 3);
  const colors = new Float32Array(FORMATION_COUNT * 3);
  const parts = new Uint8Array(FORMATION_COUNT);
  let cursor = 0;
  for (let part = 0; part < groups.length; part++) {
    const group = groups[part];
    const measured = group.paths.map(path => {
      const lengths = [0];
      for (let j = 1; j < path.points.length; j++) lengths.push(lengths[j - 1] + Math.hypot(...path.points[j].map((v, axis) => v - path.points[j - 1][axis])));
      return { ...path, lengths, length: lengths[lengths.length - 1] };
    });
    const weights = measured.map(path => Math.sqrt(path.length) * path.weight);
    const sum = weights.reduce((a, b) => a + b, 0);
    let used = 0;
    measured.forEach((path, pathIndex) => {
      const quantity = pathIndex === measured.length - 1 ? group.count - used : Math.max(3, Math.floor(weights[pathIndex] / sum * group.count));
      used += quantity;
      let segment = 1;
      for (let j = 0; j < quantity; j++) {
        const distance = path.length * (j + 0.5) / quantity;
        while (segment < path.lengths.length - 1 && path.lengths[segment] < distance) segment++;
        const amount = (distance - path.lengths[segment - 1]) / Math.max(0.000001, path.lengths[segment] - path.lengths[segment - 1]);
        for (let axis = 0; axis < 3; axis++) {
          positions[cursor * 3 + axis] = path.points[segment - 1][axis] + (path.points[segment][axis] - path.points[segment - 1][axis]) * amount;
          colors[cursor * 3 + axis] = DRONE_PALETTE[path.color][axis];
        }
        parts[cursor++] = part;
      }
    });
  }
  if (cursor !== FORMATION_COUNT) throw new Error(`Drone artwork count mismatch: ${cursor}`);
  return { positions, colors, parts };
}

let artwork;
/** Cached source is private; callers receive independent stable buffers. */
export function createDroneFormations(count = FORMATION_COUNT) {
  if (!Number.isInteger(count) || count < 1 || count > FORMATION_COUNT) throw new RangeError(`Drone count must be 1–${FORMATION_COUNT}`);
  artwork ??= createArtwork();
  const hero = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const parts = new Uint8Array(count);
  const identities = new Uint16Array(count);
  const skyEye = new Float32Array(count * 3);
  const phoenix = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const identity = Math.floor(i * FORMATION_COUNT / count);
    // Odd permutation: every contiguous / half-resolution sample covers all features.
    const source = (identity * 997) % FORMATION_COUNT;
    identities[i] = identity;
    parts[i] = artwork.parts[source];
    for (let axis = 0; axis < 3; axis++) {
      hero[i * 3 + axis] = artwork.positions[source * 3 + axis];
      colors[i * 3 + axis] = artwork.colors[source * 3 + axis];
    }
    // Six concentric rings and 32 radial spokes form an overhead mandala. All
    // emitters share exactly the same altitude before the loss-of-power cue.
    // Its southern sea stage stays outside the island and its buildings.
    const eyeRing = Math.floor(identity / 512);
    const eyeAngle = identity < 3072 ? (identity % 512 + 0.5) / 512 * TAU
      : Math.floor((identity - 3072) / 32) / 32 * TAU;
    const eyeRadius = identity < 3072 ? 9 + eyeRing * 5
      : 9 + ((identity % 32 + 0.5) / 32) * 25;
    skyEye[i * 3] = Math.cos(eyeAngle) * eyeRadius;
    skyEye[i * 3 + 1] = 85.2;
    skyEye[i * 3 + 2] = 90 + Math.sin(eyeAngle) * eyeRadius;

    // A genuinely different second silhouette: twelve nested flame-feathers
    // on each wing, with two bright leading edges and a central rising tail.
    // Integer identity ranges retain all feathers at the 2048-point tier.
    const side = identity < 2048 ? -1 : 1;
    const local = identity % 2048;
    let px, py, pz;
    if (local < 1536) {
      const feather = Math.floor(local / 128);
      const a = (local % 128 + 0.5) / 128 * TAU;
      const travel = (1 - Math.cos(a)) * 0.5;
      const tipX = 21 + feather * 2.6;
      const tipY = 63 - feather * 2.7;
      const width = Math.sin(a) * (1.1 + feather * 0.07);
      px = side * (3 + (tipX - 3) * travel + width);
      py = 13 + (tipY - 13) * travel - width * 0.4;
      pz = 90 + Math.sin(travel * Math.PI) * (3 - feather * 0.3);
    } else if (local < 1792) {
      const u = (local - 1536 + 0.5) / 256;
      px = side * (3 + 47 * u);
      py = 13 + 47 * Math.sin(u * Math.PI * 0.78);
      pz = 89 - Math.sin(u * Math.PI) * 3;
    } else {
      const u = (local - 1792 + 0.5) / 256;
      px = side * (1.5 + Math.sin(u * Math.PI) * 3.5);
      py = 8 + 38 * u;
      pz = 91 + Math.sin(u * Math.PI) * 4;
    }
    phoenix[i * 3] = px; phoenix[i * 3 + 1] = py; phoenix[i * 3 + 2] = pz;
  }
  return { hero, colors, parts, identities, skyEye, phoenix };
}
