const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const rad = degrees => degrees * Math.PI / 180;

/** Bounded editorial camera rails. No accumulated lerp, random walk, player
 * camera mutation, cuts or passage through the fleet. Flat silhouettes stay
 * front-readable; only volumetric chapters use the wider small orbit. */
export function createDroneSampleCamera(program, scenes, shots = []) {
  if (!Number.isFinite(program?.duration) || !Number.isFinite(program?.returnStart)
    || !Array.isArray(scenes) || !scenes.length) throw new TypeError('样板运镜需要有效的节目。');
  const rail = [];
  const add = (time, yaw, height, radius, targetY, width = 146) => {
    rail.push(Object.freeze({ time, yaw: rad(clamp(yaw, -30, 30)), height: clamp(height, -8, 42), radius: clamp(radius, 168, 220), targetY: clamp(targetY, 4, 74), width }));
  };
  add(0, 8, 18, 174, 8, 140);
  add(2000, 8, 18, 174, 8, 140);
  add(12000, 4, 12, 185, 68);
  let cursor = 12000;
  scenes.forEach((scene, index) => {
    const volumetric = ['ring', 'sphere', 'galaxy', 'helix'].includes(scene.shape);
    const shot = shots[index] || {};
    const maxYaw = volumetric ? 28 : 13;
    // A slowly travelling side avoids reversing a wide orbit at each cut;
    // portrait fitting magnifies world-space camera travel considerably.
    const yaw = clamp(Number.isFinite(shot.yaw) ? shot.yaw : Math.sin(index * .47) * (volumetric ? 16 : 8), -maxYaw, maxYaw);
    const height = Number.isFinite(shot.height) ? shot.height : volumetric ? 24 : 10;
    const radius = Number.isFinite(shot.distance) ? shot.distance : volumetric ? 188 : 178;
    // Long settling time protects recognisable contours during morphs; the
    // slow counter-dolly in the second half creates depth, not a rollercoaster.
    add(cursor + 5000, yaw, height, radius, 70);
    add(cursor + scene.duration * 1000 - 1000, yaw + Math.cos(index * .47) * .8, height + (volumetric ? 3 : 1), radius + 4, 70);
    cursor += scene.duration * 1000;
  });
  add(program.returnStart + 4000, 3, 18, 190, 55, 150);
  add(program.duration - 2000, 8, 18, 174, 8, 140);
  add(program.duration, 8, 18, 174, 8, 140);
  Object.freeze(rail);
  return (timeMs = 0, aspect = 16 / 9, reducedMotion = false) => {
    const time = Number.isFinite(timeMs) ? clamp(timeMs, 0, program.duration) : 0;
    const safeAspect = Number.isFinite(aspect) ? clamp(aspect, .25, 4) : 16 / 9;
    let pose;
    if (reducedMotion) pose = { yaw: 0, height: 0, radius: 235, targetY: 55, width: 150 };
    else {
      let a = rail[0], b = rail.at(-1);
      for (let index = 1; index < rail.length; index++) if (time <= rail[index].time) { a = rail[index - 1]; b = rail[index]; break; }
      const p = smooth((time - a.time) / Math.max(1, b.time - a.time));
      pose = Object.fromEntries(['yaw', 'height', 'radius', 'targetY', 'width'].map(key => [key, mix(a[key], b[key], p)]));
    }
    const target = [0, pose.targetY, -8];
    const offset = [Math.sin(pose.yaw) * pose.radius, pose.height, Math.cos(pose.yaw) * pose.radius];
    const distance = Math.hypot(...offset);
    // Both dimensions are bounded: portrait receives extra distance, never a
    // crop or a stretched camera. 150 high also contains takeoff and landing.
    const needed = Math.max(pose.width / safeAspect, 150) / (2 * Math.tan(rad(25)));
    const scale = Math.max(1, needed / distance);
    const position = target.map((value, axis) => value + offset[axis] * scale);
    return { position, target, fov: 50, near: .1, far: Math.max(600, needed + 240) };
  };
}
