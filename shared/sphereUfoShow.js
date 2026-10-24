import { SPHERE_LANDMARK as S } from './sphere-landmark.js';

export const SPHERE_UFO_SCORE = Object.freeze({ enter: 110000, prank: 114000, lock: 116000, charge: 117000,
  fire: 118500, hit: 119200, fall: 119800, splash: 127800, victory: 130000, end: 140000 });
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const window = (a, b, x, edge = 800) => smooth(a, a + edge, x) * (1 - smooth(b - edge, b, x));
export const sphereLocalToWorld = ([x, y, z], yaw = S.faceYaw) => [S.x + x * Math.cos(yaw) + z * Math.sin(yaw), y, S.z - x * Math.sin(yaw) + z * Math.cos(yaw)];
const hover = ms => { const t = (ms - SPHERE_UFO_SCORE.prank) / 1000; return [-19 + Math.sin(t * 1.3) * 5, 50 + Math.sin(t * 1.8) * 2.2, 61 + Math.cos(t * 1.05) * 5]; };
const HIT_LOCAL = hover(SPHERE_UFO_SCORE.fall);

/** A pure absolute-time score: seeks, pause and late joins cannot replay hits. */
export function sampleSphereUfoShow(value = 0, reducedMotion = false) {
  const ms = Number.isFinite(value) ? Math.max(0, value) : 0, t = ms / 1000, C = SPHERE_UFO_SCORE;
  const active = ms < 150000;
  const ufoVisible = ms >= C.enter && ms < C.splash;
  let local = hover(ms), roll = 0;
  if (ms < C.prank) {
    const q = smooth(C.enter, C.prank, ms), endpoint = hover(C.prank);
    local = [-100, 76, 150].map((v, i) => mix(v, endpoint[i], q)); roll = Math.sin(q * Math.PI) * -.32;
  } else if (ms >= C.fall) {
    const q = clamp((ms - C.fall) / (C.splash - C.fall));
    local = [HIT_LOCAL[0] - 96 * q, mix(HIT_LOCAL[1], .25, q * q), HIT_LOCAL[2] + 65 * q];
    roll = q * 18;
  } else roll = Math.sin(t * 2.1) * .15;
  if (reducedMotion) { local = ms < C.fall ? [-19, 50, 64] : [-100, 12, 115]; roll = 0; }
  const position = sphereLocalToWorld(local);
  const stageYaw = Math.atan2(-S.x, 42 - S.z);
  const track = smooth(C.enter, C.lock, ms) * (1 - smooth(C.splash, C.victory + 2000, ms));
  const targetYaw = S.faceYaw + Math.atan2(local[0], local[2]);
  const yaw = mix(stageYaw + (reducedMotion ? 0 : Math.sin(t * .25) * .035), targetYaw, track);
  const awe = window(36000, 68000, ms, 2500), fear = window(87000, 95000, ms, 1000);
  const annoyed = window(C.prank, C.fall + 700, ms, 1000), pleased = window(C.victory, C.end, ms, 1600);
  const charge = window(C.charge, C.hit + 1100, ms, 700);
  const laser = reducedMotion ? 0 : window(C.fire, C.fall + 500, ms, 140);
  const hit = reducedMotion ? 0 : window(C.hit, C.hit + 1300, ms, 240);
  const face = { leftOpen: 1 - annoyed * .48 - pleased * .65, rightOpen: 1 - annoyed * .48 - pleased * .32,
    gazeX: 0, gazeY: .075 + awe * .035 - fear * .065,
    leftBrowLift: .025 + awe * .08 - annoyed * .07, rightBrowLift: .025 + awe * .08 - annoyed * .07,
    leftBrowTilt: -annoyed * .05, rightBrowTilt: annoyed * .05,
    mouthWidth: .16 - awe * .065 + pleased * .04 - annoyed * .03, mouthHeight: .023 + awe * .09 + fear * .08,
    smile: .75 - awe * .65 - fear * .65 - annoyed * .75 + pleased * .2, roundness: .1 + Math.max(awe, fear) * .85,
    laugh: pleased * .7, blush: .12 + pleased * .4, sleepy: 0, cheeky: pleased * .8 };
  const base = [1, .69, .018], dragon = [.16, .67, 1], alert = [1, .24, .035], power = [.2, .95, 1];
  const tint = base.map((v, i) => mix(mix(mix(v, dragon[i], awe * .8), alert[i], annoyed * .7), power[i], charge * .12));
  const eyes = [-1, 1].map(side => {
    const azimuth = side * .29, latitude = .23 + face.gazeY;
    const r = S.radius + .12, x = Math.sin(azimuth) * Math.cos(latitude) * r, z = Math.cos(azimuth) * Math.cos(latitude) * r;
    return sphereLocalToWorld([x, S.centerY + Math.sin(latitude) * r, z], yaw);
  });
  const splashAge = (ms - C.splash) / 1000;
  return { active, ms, yaw, face, tint, charge, laser, hit, eyes, position, local, roll,
    ufoVisible, ufoOpacity: ufoVisible ? smooth(C.enter, C.enter + 1200, ms) * (1 - smooth(C.splash - 600, C.splash, ms)) : 0,
    prank: !reducedMotion && ms >= C.prank && ms < C.lock, falling: ms >= C.fall && ms < C.splash,
    splash: !reducedMotion && splashAge >= 0 && splashAge < 3.7,
    splashAge: Math.max(0, splashAge), splashPosition: sphereLocalToWorld([HIT_LOCAL[0] - 96, .25, HIT_LOCAL[2] + 65]),
    phase: ms < 36000 ? 'watching' : ms < 68000 ? 'dragon-awe' : ms < 87000 ? 'hero-cheer' : ms < 95000 ? 'worried' : ms < C.enter ? 'relieved'
      : ms < C.prank ? 'intruder' : ms < C.charge ? 'annoyed' : ms < C.fire ? 'charging' : ms < C.hit ? 'laser' : ms < C.fall ? 'hit' : ms < C.splash ? 'falling' : ms < C.victory ? 'splash' : 'victory' };
}
