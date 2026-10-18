import { WONDER_CYCLE_MS, cycleWonderTime, sampleOrca } from './wonders.js';

// One shallow-water visual field, sampled from the very same world clock and
// whale poses as TownOrcaShow. No accumulated particles or client-side triggers.
export const LAGOON_WATER = Object.freeze({
  x: -64, z: 19, y: -.025, radiusX: 8.45, radiusZ: 7.45,
  segments: 72, rings: 40, maxDisplacement: .135,
  impactSlots: 4, impactLifetime: 6.2, waveSpeed: 1.75,
  edgeStart: .84, normalStep: .075,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (a, b, x) => { const p = clamp((x - a) / (b - a), 0, 1); return p * p * (3 - 2 * p); };

// Discover surface-contact events from sampleOrca, rather than copy its jump
// schedule into another timeline. The lower body meets water before its centre.
function contactEvents() {
  const events = [];
  for (let index = 0; index < 2; index++) {
    const contactY = LAGOON_WATER.y + (index === 0 ? .59 : .56) * .72;
    for (let end = 100; end <= 40000; end += 100) {
      const before = sampleOrca(end - 100, index), after = sampleOrca(end, index);
      if ((before.y > contactY) === (after.y > contactY)) continue;
      const landing = before.y > after.y;
      let lo = end - 100, hi = end;
      for (let pass = 0; pass < 18; pass++) {
        const mid = (lo + hi) / 2, above = sampleOrca(mid, index).y > contactY;
        if (above === (before.y > contactY)) lo = mid; else hi = mid;
      }
      const time = (lo + hi) / 2, pose = sampleOrca(time, index);
      events.push(Object.freeze({ time, index, landing, x: pose.x, z: pose.z, strength: landing ? .16 : .06 }));
    }
  }
  return Object.freeze(events.sort((a, b) => a.time - b.time));
}

export const LAGOON_CONTACTS = contactEvents();

export function createLagoonWaterState() {
  return { time: 0, motion: 1, whales: Array.from({ length: 2 }, () => [0, 0, 0, 0]), impacts: Array.from({ length: LAGOON_WATER.impactSlots }, () => [0, 0, 99, 0]) };
}

export function sampleLagoonWater(timeMs, reducedMotion = false, target = createLagoonWaterState()) {
  const time = cycleWonderTime(timeMs);
  target.time = reducedMotion ? 0 : time / 1000;
  target.motion = reducedMotion ? 0 : 1;
  for (let index = 0; index < 2; index++) {
    const pose = sampleOrca(time, index, reducedMotion), whale = target.whales[index];
    whale[0] = pose.x; whale[1] = pose.z; whale[2] = pose.yaw;
    whale[3] = reducedMotion ? 0 : 1 - smooth(-.08, .6, pose.y);
  }
  for (const event of target.impacts) { event[0] = 0; event[1] = 0; event[2] = 99; event[3] = 0; }
  if (reducedMotion) return target;
  let slot = 0;
  for (const event of LAGOON_CONTACTS) {
    const age = ((time - event.time + WONDER_CYCLE_MS) % WONDER_CYCLE_MS) / 1000;
    if (age >= LAGOON_WATER.impactLifetime) continue;
    // At most four contacts overlap: takeoff + landing for each of two whales.
    const out = target.impacts[slot++];
    if (!out) throw new Error('Lagoon contact capacity no longer matches sampleOrca');
    out[0] = event.x; out[1] = event.z; out[2] = age; out[3] = event.strength;
  }
  return target;
}

export function lagoonEdgeMask(x, z) {
  return 1 - smooth(LAGOON_WATER.edgeStart, 1, Math.hypot((x - LAGOON_WATER.x) / LAGOON_WATER.radiusX, (z - LAGOON_WATER.z) / LAGOON_WATER.radiusZ));
}

// CPU counterpart of the vertex field, useful for geometry/bounds regressions
// and for future objects that need to sit on the changing water surface.
export function sampleLagoonHeight(x, z, state) {
  if (!state.motion) return 0;
  const px = x - LAGOON_WATER.x, pz = z - LAGOON_WATER.z, t = state.time;
  let height = .018 * Math.sin(px * .86 + pz * .31 - t * Math.PI * 8 / 15)
    + .012 * Math.sin(px * .37 - pz * 1.11 + t * Math.PI * 2 / 3)
    + .007 * Math.sin(px * 1.8 + pz * .82 - t * Math.PI);
  for (const whale of state.whales) {
    const dx = x - whale[0], dz = z - whale[1];
    const along = dx * Math.sin(whale[2]) + dz * Math.cos(whale[2]);
    const across = dx * Math.cos(whale[2]) - dz * Math.sin(whale[2]);
    const wedge = Math.abs(across) - (along + .35) * .4;
    const envelope = smooth(-.5, .7, along) * (1 - smooth(4.5, 7, along));
    height += .043 * whale[3] * envelope * Math.exp(-wedge * wedge * 3.1)
      * Math.sin(wedge * 7.2 + along * .5 - t * 1.8);
  }
  for (const impact of state.impacts) {
    if (!impact[3]) continue;
    const radius = Math.hypot(x - impact[0], z - impact[1]), age = impact[2];
    const front = radius - LAGOON_WATER.waveSpeed * age;
    const decay = smooth(0, .16, age) * Math.exp(-age * .36) * (1 - smooth(5.1, LAGOON_WATER.impactLifetime, age));
    height += impact[3] * decay * Math.sin(front * 6.5) * Math.exp(-front * front / 2.3) / Math.sqrt(1 + radius * .3);
  }
  return clamp(height, -LAGOON_WATER.maxDisplacement, LAGOON_WATER.maxDisplacement) * lagoonEdgeMask(x, z);
}

export function sampleLagoonNormal(x, z, state) {
  const step = LAGOON_WATER.normalStep;
  const dx = (sampleLagoonHeight(x + step, z, state) - sampleLagoonHeight(x - step, z, state)) / (2 * step);
  const dz = (sampleLagoonHeight(x, z + step, state) - sampleLagoonHeight(x, z - step, state)) / (2 * step);
  const length = Math.hypot(dx, 1, dz);
  return [-dx / length, 1 / length, -dz / length];
}

export const LAGOON_WAVE_GLSL = `
  uniform float time, motion;
  uniform vec4 whales[2], impacts[${LAGOON_WATER.impactSlots}];
  float edgeMask(vec2 p){return 1.-smoothstep(${LAGOON_WATER.edgeStart},1.,length((p-vec2(-64.,19.))/vec2(8.45,7.45)));}
  float waterHeight(vec2 p){
    if(motion<.5)return 0.;
    vec2 q=p-vec2(-64.,19.);
    float h=.018*sin(q.x*.86+q.y*.31-time*${Math.PI * 8 / 15})
      +.012*sin(q.x*.37-q.y*1.11+time*${Math.PI * 2 / 3})
      +.007*sin(q.x*1.8+q.y*.82-time*${Math.PI});
    for(int i=0;i<2;i++){
      vec2 d=p-whales[i].xy;float a=whales[i].z;
      float along=dot(d,vec2(sin(a),cos(a))),across=dot(d,vec2(cos(a),-sin(a)));
      float wedge=abs(across)-(along+.35)*.4;
      float envelope=smoothstep(-.5,.7,along)*(1.-smoothstep(4.5,7.,along));
      h+=.043*whales[i].w*envelope*exp(-wedge*wedge*3.1)*sin(wedge*7.2+along*.5-time*1.8);
    }
    for(int i=0;i<${LAGOON_WATER.impactSlots};i++){
      if(impacts[i].w<=0.)continue;
      float r=length(p-impacts[i].xy),age=impacts[i].z,front=r-${LAGOON_WATER.waveSpeed}*age;
      float decay=smoothstep(0.,.16,age)*exp(-age*.36)*(1.-smoothstep(5.1,${LAGOON_WATER.impactLifetime},age));
      h+=impacts[i].w*decay*sin(front*6.5)*exp(-front*front/2.3)/sqrt(1.+r*.3);
    }
    return clamp(h,-${LAGOON_WATER.maxDisplacement},${LAGOON_WATER.maxDisplacement})*edgeMask(p);
  }
`;
