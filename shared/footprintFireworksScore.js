// An original virtual homage, not Olympic footage or physical launch instructions.
export const FOOTPRINT_SHOW = Object.freeze({ id: 'footsteps-of-light', title: '足迹 · 向光而行', duration: 104000, firstStep: 10000, interval: 2100, stepCount: 29 });
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const v = clamp(n); return v * v * (3 - 2 * v); };
export function footprintRoute(index) {
  const i = Math.max(0, Math.min(28, index)), q = i / 28;
  return [-840 + 840 * q, 122, -240 + 210 * q];
}
export function footprintCenter(index) {
  const center = footprintRoute(index);
  center[2] += Math.round(index) % 2 ? 19 : -19;
  return center;
}
export const FOOTPRINT_EVENTS = Object.freeze(Array.from({ length: 29 }, (_, index) => Object.freeze({
  index, side: index % 2 ? 'right' : 'left', at: 10 + index * 2.1, center: Object.freeze(footprintCenter(index)), scale: .88 + index / 28 * .18,
})));
export const FOOTPRINT_FINALE = Object.freeze([
  [76, [-70, 132, -45], 21], [76.65, [70, 132, -45], 21],
  [79.2, [-45, 157, -65], 25], [79.85, [45, 157, -65], 25],
  [83, [0, 176, -80], 31], [86.5, [-78, 145, -45], 24],
  [87.15, [78, 145, -45], 24], [90, [0, 170, -60], 33],
].map(([at, center, radius]) => Object.freeze({ at, center: Object.freeze(center), radius })));
export function footprintHash(i, salt = 0) {
  let n = Math.imul(i + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d);
  n = Math.imul(n ^ n >>> 16, 0x45d9f3b); return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
// One closed, hollow perimeter with heel, medial arch and five toe scallops.
// The official 2008 site photo shows horizontal outlines, not filled foot soles.
const OUTLINE = [[-1,-20],[-5,-19],[-7,-16],[-8,-11],[-8,-5],[-7,1],[-9,8],[-9,14],
  [-8.5,18],[-6,22],[-3,22],[-2,18],[-2,16],[-1,20],[1,21],[3,20],[3,16],
  [4,15],[4.8,18.5],[6.6,18.5],[7.8,16.5],[7.5,13],[8,12],[9.4,14.4],[10.4,13.4],
  [10,10.8],[9,9],[10.4,10],[11,8.7],[9.5,6.5],[7,4],[4,-1],[3,-6],[4,-12],[3,-17]];
const cat = (a,b,c,d,t) => .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
const contour = [];
let perimeter = 0;
for(let i=0;i<=OUTLINE.length*24;i++) {
  const u=i/24,k=Math.floor(u)%OUTLINE.length,t=u-Math.floor(u),n=OUTLINE.length;
  const p=[0,1].map(axis=>cat(OUTLINE[(k+n-1)%n][axis],OUTLINE[k][axis],OUTLINE[(k+1)%n][axis],OUTLINE[(k+2)%n][axis],t));
  if(contour.length)perimeter+=Math.hypot(p[0]-contour.at(-1).p[0],p[1]-contour.at(-1).p[1]);
  contour.push({p,d:perimeter});
}
export function sampleFootprintPoint(index, side = 'left', count = 64) {
  const distance=((index%count)+.5)/count*perimeter;
  let k=1;while(k<contour.length-1&&contour[k].d<distance)k++;
  const a=contour[k-1],b=contour[k],t=(distance-a.d)/Math.max(.00001,b.d-a.d);
  const x=a.p[0]+(b.p[0]-a.p[0])*t,y=a.p[1]+(b.p[1]-a.p[1])*t;
  return [side==='right'?-x:x,y,0];
}
export function footprintWorldPoint(event, index, count = 64) {
  const p=sampleFootprintPoint(index,event.side,count),s=event.scale*1.65;
  return [event.center[0]+s*(p[1]*.9701425-p[0]*.2425356),event.center[1],event.center[2]+s*(p[1]*.2425356+p[0]*.9701425)];
}
// CPU mirror of the shader, used to prove ascent -> burst -> fallout continuity.
export function sampleFootprintParticle(origin, velocity, age, launch=1.85) {
  const u=clamp((age+launch)/launch),t=Math.max(0,age),travel=(1-Math.exp(-t*1.6))/1.6;
  return age<0 ? [origin[0]+Math.sin(u*Math.PI)*.65,3+(origin[1]-3)*Math.sin(u*Math.PI/2),origin[2]+(1-u)*2]
    : [origin[0]+velocity[0]*travel,origin[1]+velocity[1]*travel-t*t,origin[2]+velocity[2]*travel];
}
export function sampleFootprintCamera(timeMs = 0, aspect = 16 / 9, reducedMotion = false) {
  const t = Number.isFinite(timeMs) ? Math.max(0, Math.min(104, timeMs / 1000)) : 0;
  const q = smooth((t - 5) / 7), step = Math.max(0, Math.min(28, (t - 10) / 2.1));
  const center = footprintRoute(step), closing = smooth((t - 95) / 9);
  let target = [center[0] - 25, 116, center[2]], position = [center[0] + 22, 30, center[2] + 210];
  if (t < 12) { const opening = [-826, 90, -220]; target = opening.map((v, i) => v + (target[i] - v) * q); }
  if (t >= 72) { const p = smooth((t - 72) / 5); target = target.map((v, i) => v + ([0, 132, -50][i] - v) * p); position = position.map((v, i) => v + ([10, 127, 235][i] - v) * p); }
  position = position.map((v, i) => v + ([20, 45, 128][i] - v) * closing); target = target.map((v, i) => v + ([0, 20, -8][i] - v) * closing);
  if (reducedMotion) { target = [-120, 120, -125]; position = [-90, 135, 360]; }
  const ratio = Number.isFinite(aspect) ? Math.max(.25, Math.min(4, aspect)) : 16 / 9;
  const distance = Math.hypot(...position.map((v, i) => v - target[i]));
  const field = t < 73 ? (ratio<.9?120:185) : 235, minimum = Math.max(field / ratio, t < 73 ? 105 : 190) / (2 * Math.tan(23 * Math.PI / 180));
  const scale = Math.max(1, minimum / distance);
  position = position.map((v, i) => target[i] + (v - target[i]) * scale);
  position[1]=Math.max(12,position[1]);
  return { position, target, fov: 46, near: .1, far: Math.max(1200, minimum + 800) };
}
