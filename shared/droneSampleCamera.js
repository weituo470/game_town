const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const smooth = n => { const t = clamp(n, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// [seconds, camera xyz, target xyz, minimum horizontal field, vertical field]
// Establish the town, move in for the creature, hold the stunt, reveal fireworks.
const RAILS = {
  'phoenix-rebirth': [
    [0,[16,29,104],[0,6,-6],96,80], [4,[16,29,104],[0,6,-6],96,80],
    [12,[16,73,170],[0,63,-10],128,112], [22,[24,92,188],[0,82,-10],150,124],
    [36,[-18,98,174],[0,76,-10],152,128], [46,[-26,93,182],[0,70,-10],152,124],
    [55,[12,74,192],[0,56,-10],148,136], [65,[12,74,192],[0,56,-10],148,136],
    [76,[18,96,226],[0,78,-10],198,168], [88,[8,98,234],[0,80,-10],206,174],
    [94,[6,79,211],[0,62,-8],160,142], [106,[16,31,108],[0,8,-6],96,80],
    [108,[16,31,108],[0,8,-6],96,80],
  ],
  'tidal-whale': [
    [0,[18,30,108],[0,6,-5],96,82], [4,[18,30,108],[0,6,-5],96,82],
    [14,[-28,73,180],[0,64,-10],144,110], [26,[-44,91,182],[0,78,-10],160,122],
    [40,[22,93,182],[0,81,-10],164,130], [54,[28,100,210],[0,86,-10],192,154],
    [66,[8,105,221],[0,80,-10],202,160], [78,[-14,95,194],[0,76,-10],170,140],
    [90,[10,102,238],[0,80,-10],212,176], [98,[8,85,212],[0,64,-10],170,144],
    [110,[18,30,108],[0,8,-5],96,82], [112,[18,30,108],[0,8,-5],96,82],
  ],
  'gravity-gate': [
    [0,[12,29,105],[0,6,-6],96,80], [4,[12,29,105],[0,6,-6],96,80],
    [14,[28,87,184],[0,70,-10],150,128], [28,[-28,102,186],[0,76,-10],166,146],
    [40,[10,96,192],[0,70,-10],166,148], [46,[10,84,203],[0,56,-10],166,152],
    [61,[10,84,203],[0,56,-10],166,152], [72,[14,100,228],[0,80,-10],202,172],
    [84,[4,98,234],[0,78,-10],210,172], [88,[8,79,208],[0,59,-10],164,140],
    [98,[12,29,105],[0,8,-6],96,80], [100,[12,29,105],[0,8,-6],96,80],
  ],
};
for (const rail of Object.values(RAILS)) for (const shot of rail) { Object.freeze(shot[1]); Object.freeze(shot[2]); Object.freeze(shot); }
Object.values(RAILS).forEach(Object.freeze); Object.freeze(RAILS);

/** Absolute-time rails. No player-camera mutation, shake, cuts or drone flythrough. */
export function createDroneShortCamera(program) {
  if (!program || !Number.isFinite(program.duration) || !RAILS[program.sampleId]) throw new TypeError('短秀运镜需要已登记的节目。');
  const rail = RAILS[program.sampleId];
  return (timeMs = 0, aspect = 16 / 9, reducedMotion = false) => {
    const seconds = Number.isFinite(timeMs) ? clamp(timeMs / 1000, 0, program.duration / 1000) : 0;
    const ratio = Number.isFinite(aspect) ? clamp(aspect, .25, 4) : 16 / 9;
    let a = rail[0], b = rail.at(-1), p = 0;
    if (reducedMotion) a = b = [0,[0,87,264],[0,66,-10],220,184];
    else {
      for (let i = 1; i < rail.length; i++) if (seconds <= rail[i][0]) { a = rail[i - 1]; b = rail[i]; break; }
      p = smooth((seconds - a[0]) / Math.max(.001, b[0] - a[0]));
    }
    const target = a[2].map((v, i) => mix(v, b[2][i], p));
    const position = a[1].map((v, i) => mix(v, b[1][i], p));
    const fov = 46, tangent = Math.tan(fov * Math.PI / 360);
    const horizontalField = mix(a[3], b[3], p), verticalField = mix(a[4], b[4], p);
    const distance = Math.hypot(...position.map((v, i) => v - target[i]));
    const minimumDistance = Math.max(horizontalField / ratio, verticalField) / (2 * tangent);
    const scale = Math.max(1, minimumDistance / distance);
    for (let i = 0; i < 3; i++) position[i] = target[i] + (position[i] - target[i]) * scale;
    return { position, target, fov, near: .1, far: Math.max(800, minimumDistance + 360) };
  };
}
