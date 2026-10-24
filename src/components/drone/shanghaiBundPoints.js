// Original point choreography, not sampled movie footage or third-party models.
// Coordinates are in the existing music stage's authoring space. Every point
// remains an aircraft; no neon line geometry, textured building, or text overlay.
const GOLD = [1.5, 1.12, .48], IVORY = [1.5, 1.4, 1.12], JADE = [.3, 1.25, .95];
const CYAN = [.25, 1.12, 1.5], ROSE = [1.5, .55, .7];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = (n, s = 0) => { let x = Math.imul(n + s * 157 + 1, 0x45d9f3b); x = Math.imul(x ^ x >>> 16, 0x45d9f3b); return ((x ^ x >>> 16) >>> 0) / 4294967296; };
function line(pool, a, b, color = GOLD, spacing = 2) {
  const n = Math.max(1, Math.ceil(Math.hypot(...a.map((v, i) => v - b[i])) / (spacing * .65)));
  for (let i = 0; i < n; i++) pool.push([...a.map((v, axis) => lerp(v, b[axis], i / n)), ...color]);
}
function path(pool, coordinates, color = GOLD, spacing = 2) {
  for (let i = 1; i < coordinates.length; i++) line(pool, coordinates[i - 1], coordinates[i], color, spacing);
}
function ellipse(pool, x, y, z, rx, ry, color = GOLD, start = 0, end = Math.PI * 2) {
  const n = Math.ceil((end - start) * Math.max(rx, ry) / 1.04);
  for (let i = 0; i < n; i++) { const a = lerp(start, end, i / n); pool.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry, z, ...color]); }
}
function building(pool, x, w, h, roof = 'flat', color = GOLD) {
  const z = -24, bottom = 34, top = bottom + h;
  path(pool, [[x-w/2,bottom,z],[x-w/2,top,z],[x+w/2,top,z],[x+w/2,bottom,z],[x-w/2,bottom,z]], color);
  // Two visible sides, cornices, regular bays: a recognisable architecture,
  // rather than random floating window dots or interchangeable cuboids.
  path(pool, [[x-w/2,top,z],[x-w/2+5,top+2,z-9],[x+w/2+5,top+2,z-9],[x+w/2,top,z]], color);
  line(pool,[x+w/2,top,z],[x+w/2+5,top+2,z-9],color);
  line(pool,[x+w/2+5,top+2,z-9],[x+w/2+5,bottom,z-9],color);
  line(pool,[x-w/2,top-4,z+1],[x+w/2,top-4,z+1],IVORY);
  const bays = Math.max(3, Math.round(w/5));
  for (let i=1;i<bays;i++) {
    const px = x-w/2+i*w/bays;
    line(pool,[px,bottom+2,z+1],[px,bottom+15,z+1],IVORY,2.4);
    for(let y=bottom+21;y<top-7;y+=7) { line(pool,[px-1,y,z+1],[px+1,y,z+1],color,1.8); }
  }
  line(pool,[x-w/2,bottom+17,z+1],[x+w/2,bottom+17,z+1],IVORY);
  if (roof==='pyramid') path(pool,[[x-w/2,top,z],[x,top+15,z-5],[x+w/2,top,z]],JADE,1.5);
  if (roof==='dome') ellipse(pool,x,top,z,w*.38,10,IVORY,0,Math.PI);
}
const CITY = [], CLOCK = [], COUPLE = [], SHIP = [];
building(CITY,-62,22,31,'dome'); building(CITY,-35,24,40); building(CITY,-2,32,39); building(CITY,31,20,44,'pyramid'); building(CITY,60,25,32);
// Clock tower above the central colonnade, with an explicit dial and moving hands.
path(CITY,[[-11,73,-24],[-11,93,-24],[-8,99,-26],[5,99,-26],[9,93,-24],[9,73,-24]],IVORY,1.5);
path(CITY,[[-8,99,-26],[-2,106,-28],[5,99,-26]],GOLD,1.5);
ellipse(CLOCK,-1,89,-20,5.5,8,IVORY);
for(let i=0;i<12;i++){const a=i*Math.PI/6;line(CLOCK,[-1+Math.sin(a)*4.1,89+Math.cos(a)*5.9,-19],[-1+Math.sin(a)*5.4,89+Math.cos(a)*7.7,-19],GOLD,.9);}
// Two anonymous period silhouettes: fedora / long coat and flowing evening dress.
path(COUPLE,[[-48,44,-2],[-43,72,-2],[-34,78,-2],[-24,73,-2],[-17,44,-2],[-48,44,-2]],GOLD,1.4);
ellipse(COUPLE,-34,83,-2,6,9,IVORY);
path(COUPLE,[[-48,90,0],[-21,90,0],[-25,91,0],[-27,100,0],[-40,100,0],[-43,91,0]],GOLD,1.3);
path(COUPLE,[[-41,75,0],[-34,62,0],[-27,75,0]],IVORY,1.6);
line(COUPLE,[-34,62,0],[-34,45,0],IVORY);
ellipse(COUPLE,32,85,-1,7,11,ROSE);
path(COUPLE,[[27,76,0],[20,70,0],[26,59,0],[17,42,0],[43,42,0],[35,60,0],[41,70,0],[36,76,0]],ROSE,1.4);
path(COUPLE,[[26,74,0],[32,68,0],[37,74,0]],IVORY,1.3);
path(COUPLE,[[26,59,0],[35,60,0],[32,43,0]],IVORY);
// River steamer: waterline, pointed bow, wheelhouse and two stacks.
path(SHIP,[[-36,42,6],[-28,34,6],[28,34,6],[39,44,6],[-36,42,6]],IVORY,1.4);
path(SHIP,[[-24,43,4],[-24,52,4],[20,52,4],[20,44,4]],GOLD,1.5);
path(SHIP,[[-9,52,3],[-9,61,3],[12,61,3],[12,52,3]],IVORY,1.5);
for(const x of [-14,2]) path(SHIP,[[x,52,0],[x,69,0],[x+5,69,0],[x+5,52,0]],GOLD,1.4);
for(let x=-21;x<=24;x+=6)ellipse(SHIP,x,40,7,1.2,1.2,GOLD);

function from(pool, id, out) { const p=pool[((id%pool.length)+pool.length)%pool.length];for(let k=0;k<6;k++)out[k]=p[k]; }
function tide(id,s,out,large=false) {
  const q=hash(id,2),row=id%5,x=(q-.5)*166,phase=x*.047+s*.68+row*.74;
  out[0]=x;out[1]=35+row*3+Math.sin(phase)*(large?9:3.2);out[2]=4-row*7+Math.cos(phase)*3;
  const foam=Math.pow(Math.max(0,Math.sin(phase)),6);
  out[3]=lerp(CYAN[0],IVORY[0],foam);out[4]=lerp(CYAN[1],IVORY[1],foam);out[5]=lerp(CYAN[2],IVORY[2],foam);
  if(large&&q>.65){const a=(q-.65)/.35*Math.PI*1.5;out[0]=35+Math.cos(a)*24;out[1]=53+Math.sin(a)*26;out[2]=-1-row*3;}
}
function skyline(id,s,out) {
  if(id%11<2){from(CLOCK,id,out);if(id%7===0){const a=s*.045+id*.2;out[0]=-1+Math.sin(a)*hash(id,8)*4.8;out[1]=89+Math.cos(a)*hash(id,8)*7;out[2]=-18;}}
  else from(CITY,id,out);
}
export const BUND_THEMES=Object.freeze(['bund-tide','bund-skyline','bund-duet','bund-storm','bund-finale','bund-harbor']);
export function sampleShanghaiBundPoint(theme,id,seconds,reducedMotion,out) {
  if(!BUND_THEMES.includes(theme))return false;
  const s=reducedMotion?0:seconds,r=hash(id,13);
  if(theme==='bund-tide') {
    if(r<.78)tide(id,s,out,true);else{skyline(id,s,out);out[2]-=24;for(let k=3;k<6;k++)out[k]*=.5;}
  } else if(theme==='bund-duet') {
    if(r<.65){from(COUPLE,id,out);out[0]+=Math.sin(s*.18)*1.8;}
    else if(r<.86){const a=hash(id,15)*Math.PI*2;out[0]=Math.cos(a+s*.16)*55;out[1]=66+Math.sin(a)*26;out[2]=Math.sin(a+s*.16)*17;for(let k=0;k<3;k++)out[k+3]=(id%2?GOLD:ROSE)[k];}
    else{skyline(id,s,out);out[2]-=36;for(let k=3;k<6;k++)out[k]*=.38;}
  } else if(theme==='bund-storm') {
    if(r<.4){skyline(id,s,out);out[3]*=.65;out[4]*=.43;out[5]*=.5;}
    else{const q=hash(id,16),h=(hash(id,17)+s*.19)%1;out[0]=(q-.5)*160+Math.sin(s*.21)*h*10;out[1]=42+h*63;out[2]=-12-h*20;out[3]=id%5? .3:1.5;out[4]=id%5? .62:.35;out[5]=id%5?1.4:.3;}
  } else if(theme==='bund-harbor') {
    if(r<.48){from(SHIP,id,out);out[0]+=Math.sin(s*.09)*12;out[1]+=Math.sin(s*.6)*.8;}
    else if(r<.77)tide(id,s,out);
    else{const a=hash(id,18)*Math.PI*2;out[0]=46+Math.cos(a)*13;out[1]=88+Math.sin(a)*18;out[2]=-42;for(let k=0;k<3;k++)out[k+3]=IVORY[k];}
  } else {
    if(r<.74)skyline(id,s,out);
    else if(theme==='bund-finale'&&r>.9){const a=hash(id,20)*Math.PI;out[0]=Math.cos(a)*80;out[1]=59+Math.sin(a)*47;out[2]=-45;for(let k=0;k<3;k++)out[k+3]=id%3?GOLD[k]:ROSE[k];}
    else tide(id,s,out);
  }
  out[0]=clamp(out[0],-88,88);out[1]=clamp(out[1],28,108);
  return true;
}
