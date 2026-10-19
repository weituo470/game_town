// Original, deterministic virtual pyrotechnics. Every point is allocated once;
// renderers advance only an absolute-time uniform (including arbitrary seeks).
export const DRONE_FIREWORKS_BUDGET = Object.freeze({ sparks: 8000, rockets: 512, drawCalls: 2 });
const TAU = Math.PI * 2;
const GOLD = [1, .68, .23], IVORY = [1, .91, .68], EMBER = [1, .31, .075];
const BLUE = [.19, .62, 1], ICE = [.63, .94, 1], VIOLET = [.62, .37, 1];
const cue = (at, origin, style, color, count, life = 4.3, radius = 21, launch = 1.8) => Object.freeze({
  at, origin: Object.freeze(origin), style, color: Object.freeze([...color]), count, life, radius, launch,
});
const PROGRAMS = Object.freeze({
  'phoenix-rebirth': Object.freeze({ end: 94, cues: Object.freeze([
    cue(46.8, [-60, 92, -25], 'peony', EMBER, 140, 3.8, 16),
    cue(47.4, [60, 92, -25], 'peony', EMBER, 140, 3.8, 16),
    cue(70.3, [-46, 105, -24], 'chrysanthemum', GOLD, 180, 4, 22),
    cue(71.0, [46, 105, -24], 'chrysanthemum', GOLD, 180, 4, 22),
    cue(74.0, [0, 124, -35], 'peony', IVORY, 280, 5.2, 20),
    cue(79.7, [-64, 108, -29], 'willow', GOLD, 200, 6, 17),
    cue(80.4, [64, 108, -29], 'willow', GOLD, 200, 6, 17),
    cue(82.0, [0, 123, -38], 'willow', IVORY, 280, 6.3, 22),
    cue(86.5, [-47, 120, -29], 'chrysanthemum', EMBER, 180, 4.4, 22),
    cue(87.0, [47, 120, -29], 'chrysanthemum', EMBER, 180, 4.4, 22),
    cue(90.0, [0, 124, -35], 'peony', GOLD, 280, 3.6, 20),
  ]) }),
  'tidal-whale': Object.freeze({ end: 108, cues: Object.freeze([
    // No early spectacle distracts from the call and answer. The reunion's
    // distant blooms stay behind and outside the five persistent silhouettes.
    cue(78.4, [-125, 118, -95], 'peony', BLUE, 160, 4, 14),
    cue(79.0, [125, 118, -95], 'peony', BLUE, 160, 4, 14),
    cue(85.0, [-126, 93, -100], 'crown', ICE, 220, 5, 25),
    cue(85.4, [126, 93, -100], 'crown', ICE, 220, 5, 25),
    cue(88.0, [-118, 145, -118], 'willow', GOLD, 240, 6, 18),
    cue(88.6, [118, 145, -118], 'willow', GOLD, 240, 6, 18),
    cue(91.5, [0, 169, -125], 'peony', ICE, 280, 5.3, 15),
    cue(96.0, [-128, 127, -110], 'crown', BLUE, 200, 5, 18),
    cue(96.5, [128, 127, -110], 'crown', BLUE, 200, 5, 18),
    cue(100.0, [-53, 158, -125], 'willow', ICE, 200, 6, 14),
    cue(100.3, [53, 158, -125], 'willow', GOLD, 200, 6, 14),
  ]) }),
  'gravity-gate': Object.freeze({ end: 86, cues: Object.freeze([
    cue(60.0, [-64, 36, -24], 'reverse', VIOLET, 180, 5.6, 22),
    cue(60.4, [64, 36, -24], 'reverse', ICE, 180, 5.6, 22),
    cue(64.0, [-67, 49, -30], 'reverse', ICE, 190, 5.5, 22),
    cue(64.4, [67, 49, -30], 'reverse', VIOLET, 190, 5.5, 22),
    cue(70.0, [0, 123, -40], 'peony', IVORY, 300, 5.4, 21),
    cue(76.0, [-62, 112, -34], 'chrysanthemum', VIOLET, 240, 5.3, 18),
    cue(76.0, [62, 112, -34], 'chrysanthemum', ICE, 240, 5.3, 18),
    cue(78.0, [-42, 123, -40], 'peony', ICE, 260, 5.3, 20),
    cue(78.0, [42, 123, -40], 'peony', VIOLET, 260, 5.3, 20),
    cue(82.0, [0, 129, -40], 'willow', GOLD, 260, 3.7, 19),
  ]) }),
});
const hash = (i, salt = 0) => { let n = Math.imul(i + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d); n = Math.imul(n ^ n >>> 16, 0x45d9f3b); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
export function getDroneFireworkCues(sampleId) {
  const program = PROGRAMS[sampleId];
  if (!program) throw new RangeError(`Unknown drone spectacle: ${sampleId}`);
  return program;
}

/** Three separated points per spark, not a line/ribbon/tube or feedback buffer. */
export function createDroneFireworkBuffers(sampleId, fleetCount = 4096) {
  const program = getDroneFireworkCues(sampleId), density = fleetCount < 4096 ? .64 : 1;
  const counts = program.cues.map(item => Math.max(48, Math.floor(item.count * density)));
  const count = counts.reduce((sum, value) => sum + value * 3, 0);
  if (count > DRONE_FIREWORKS_BUDGET.sparks) throw new RangeError('Firework particle budget exceeded');
  const origin = new Float32Array(count * 3), velocity = new Float32Array(count * 3), timing = new Float32Array(count * 3);
  const motion = new Float32Array(count * 3), color = new Float32Array(count * 3), seed = new Float32Array(count);
  let cursor = 0;
  program.cues.forEach((item, eventIndex) => {
    for (let j = 0; j < counts[eventIndex]; j++) {
      const identity = j + eventIndex * 997, azimuth = j * 2.399963229728653 + hash(eventIndex, 3) * TAU;
      let vertical = 1 - 2 * (j + .5) / counts[eventIndex], radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      let speed = item.radius * (.70 + hash(identity, 4) * .3), gravity = 5.3, drag = .36;
      if (item.style === 'peony') speed *= j % 3 === 0 ? .53 : 1;
      if (item.style === 'willow') { vertical = .22 + hash(identity, 5) * .78; radial = Math.sqrt(1 - vertical * vertical); speed *= .76; gravity = 5.1; drag = .52; }
      if (item.style === 'crown') { vertical = .24 + hash(identity, 6) * .60; radial = Math.sqrt(1 - vertical * vertical); speed *= .86; gravity = 6.5; drag = .47; }
      if (item.style === 'reverse') { vertical = .58 + hash(identity, 7) * .40; radial = Math.sqrt(1 - vertical * vertical); speed *= .54; gravity = -2.0; drag = .40; }
      const vx = Math.cos(azimuth) * radial * speed, vy = vertical * speed, vz = Math.sin(azimuth) * radial * speed * .56;
      const life = Math.min(item.life * (.80 + hash(identity, 8) * .20), program.end - item.at - .15);
      for (let tail = 0; tail < 3; tail++) {
        const index = cursor++, offset = index * 3;
        origin.set([item.origin[0] * .9, item.origin[1], item.origin[2]], offset); velocity.set([vx * .9, vy, vz], offset);
        timing.set([item.at, life, tail * .095], offset);
        motion.set([gravity, drag, (tail === 0 ? 1 : .64) * (.82 + hash(identity, 9) * .36)], offset);
        const warmth = .87 + hash(identity, 10) * .13;
        color.set(item.color.map(channel => channel * warmth), offset);
        seed[index] = hash(identity, 11);
      }
    }
  });
  const rocketCount = program.cues.length * 17;
  if (rocketCount > DRONE_FIREWORKS_BUDGET.rockets) throw new RangeError('Firework rocket budget exceeded');
  const rocketOrigin = new Float32Array(rocketCount * 3), rocketTiming = new Float32Array(rocketCount * 3), rocketColor = new Float32Array(rocketCount * 3);
  program.cues.forEach((item, index) => {
    for (let point = 0; point < 17; point++) {
      const offset = (index * 17 + point) * 3;
      rocketOrigin.set([item.origin[0] * .9, item.origin[1], item.origin[2]], offset);
      rocketTiming.set([item.at - item.launch, item.launch, point / 16], offset);
      rocketColor.set(item.style === 'reverse' ? ICE : IVORY, offset);
    }
  });
  return Object.freeze({ sampleId, start: Math.min(...program.cues.map(item => item.at - item.launch)), end: program.end, count, origin, velocity, timing, motion, color, seed,
    rocketCount, rocketOrigin, rocketTiming, rocketColor });
}

// CPU reference for deterministic tests and framing diagnostics; production
// does not run this loop. Keep the same equations as the GPU vertex shader.
export function sampleFireworkParticle(buffers, index, timeMs, out = new Float64Array(4)) {
  if (!Number.isInteger(index) || index < 0 || index >= buffers.count) throw new RangeError('Invalid firework point');
  const offset = index * 3, seconds = Number.isFinite(timeMs) ? Math.max(0, timeMs / 1000) : 0;
  const age = seconds - buffers.timing[offset], t = age - buffers.timing[offset + 2], life = buffers.timing[offset + 1];
  const drag = buffers.motion[offset + 1], travel = (1 - Math.exp(-drag * Math.max(0, t))) / drag;
  out[0] = buffers.origin[offset] + buffers.velocity[offset] * travel;
  out[1] = buffers.origin[offset + 1] + buffers.velocity[offset + 1] * travel - .5 * buffers.motion[offset] * Math.max(0, t) ** 2;
  out[2] = buffers.origin[offset + 2] + buffers.velocity[offset + 2] * travel;
  const phase = Math.max(0, Math.min(1, age / life));
  const skyFade = Math.max(0, Math.min(1, (out[1] - 35) / 5));
  out[3] = t < 0 || age >= life || seconds >= buffers.end ? 0 : Math.min(1, (1 - phase) ** .62 * Math.min(1, t * 18) * (buffers.timing[offset + 2] === 0 ? 1 : .62) * skyFade * 1.24);
  return out;
}

export function sampleFireworkRocket(buffers, index, timeMs, out = new Float64Array(4)) {
  if (!Number.isInteger(index) || index < 0 || index >= buffers.rocketCount) throw new RangeError('Invalid firework rocket');
  const offset = index * 3, seconds = Number.isFinite(timeMs) ? Math.max(0, timeMs / 1000) : 0;
  const age = seconds - buffers.rocketTiming[offset], duration = buffers.rocketTiming[offset + 1], tail = buffers.rocketTiming[offset + 2];
  const fraction = Math.max(0, Math.min(1, (age - tail * .42) / duration));
  out[0] = buffers.rocketOrigin[offset] - (1 - fraction) * buffers.rocketOrigin[offset] * .12;
  out[1] = 5 + (buffers.rocketOrigin[offset + 1] - 5) * (1 - (1 - fraction) ** 1.5);
  out[2] = buffers.rocketOrigin[offset + 2] + (1 - fraction) * 12;
  out[3] = age <= tail * .42 || age >= duration || seconds >= buffers.end ? 0 : (1 - tail) ** 1.7;
  return out;
}
