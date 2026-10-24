import * as THREE from 'three';
import { FOOTPRINT_SHOW, FOOTPRINT_EVENTS, FOOTPRINT_FINALE, footprintHash as hash, footprintWorldPoint, sampleFootprintCamera } from '../../../shared/footprintFireworksScore.js';

export const FOOTPRINT_PROGRAM = Object.freeze({
  ...FOOTPRINT_SHOW, subtitle: '二十九步 · 从远海走向小镇',
  description: '参照2008北京奥运《历史的足迹》的水平空心脚印。轮廓上的多束烟花同步升空，在顶点爆开，同一批火星显出横卧空中的足迹，再自然拖尾下落；二十九步从远海走向小镇。',
  palette: '#FFD38A', heroTime: 34200, highlightTime: 84500, heroLabel: '水平足迹', highlightLabel: '金雨礼赞',
  supportsAudio: true, soundtrackUrl: '/audio/footsteps-of-light.mp3', soundtrackTitle: '足迹 · 烟花实录与同步声景', soundtrackDurationMs: 104000,
  cinematic: true, authoredBy: '本会话直接编排', sceneCount: 6, note: '1分44秒 · 水平空心足迹 · 实录爆炸音效 · 可运镜回放与导出',
});
const CHAPTERS = Object.freeze([
  ['kindling', '海上引火', 0, 10000, '远海的第一道金线升空，留出期待与呼吸。'],
  ['first-steps', '足迹初现', 10000, 26800, '多束烟花在顶点爆开，显出横卧空中的空心脚印；火星从升空到散落保持连续。'],
  ['sky-walk', '跨越海天', 26800, 52000, '金色脚印沿海天纵深前行，旧足迹散作向下飘落的火星。'],
  ['arrival', '向光而行', 52000, 75000, '最后几步走向小镇，二十九步旅程完成，留下一息安静。'],
  ['golden-rain', '万千星雨', 75000, 95000, '两侧礼花错落升空，金色垂柳在高处展开，余烬如雨。'],
  ['blackout', '余烬归海', 95000, 104000, '最后的火星慢慢落下，镜头回到小镇。'],
].map(([id, label, start, end, description], sceneIndex) => Object.freeze({ id, label, name: label, start, end, description, sceneIndex })));
export function createFootprintRuntime() {
  const program = Object.freeze({ ...FOOTPRINT_PROGRAM, id: 'ai', sampleId: FOOTPRINT_SHOW.id, sampleVisual: 'spectacle-v2', shortTitle: FOOTPRINT_SHOW.title,
    chapters: CHAPTERS, returnStart: 95000, recoveryTime: 95000, recoveryLabel: '余烬归海', supportsFpv: false,
    note: '参照原作的水平空心轮廓，非官方奥运演出。烟花实录为CC0素材，经重新剪辑与同步编排；不是无人机编队，音效可静音。' });
  const sample = timeMs => {
    const elapsed = Number.isFinite(timeMs) ? Math.max(0, Math.min(program.duration, timeMs)) : 0;
    const chapter = CHAPTERS.find(c => elapsed < c.end) || CHAPTERS.at(-1), progress = Math.max(0, Math.min(1, (elapsed - chapter.start) / (chapter.end - chapter.start)));
    return { elapsed, seconds: elapsed / 1000, phase: chapter.id, label: chapter.label, description: chapter.description, progress, active: elapsed < program.duration,
      energy: 0, chapter, cue: chapter.id, cueLabel: chapter.label, cueDescription: chapter.description, cueProgress: progress, nextIn: 0, sceneIndex: chapter.sceneIndex };
  };
  return Object.freeze({ program, score: Object.freeze({ version: 'footprint-contour-pyro-v2', localOnly: true }), sample, camera: sampleFootprintCamera,
    update(fleet, timeMs) { fleet.sizes.fill(0); fleet.colors.fill(0); fleet.positions.set(fleet.bases); fleet.state = sample(timeMs); return fleet.state; },
    visualFactory: createFootprintFireworkVisual });
}

const VERTEX = /* glsl */`
attribute vec3 aVelocity; attribute vec3 aTiming; attribute float aSize; attribute vec3 color;
attribute float aLaunch; attribute float aFlightGain;
uniform float uTime; uniform float uViewportHeight;
varying vec3 vColor; varying float vAlpha;
void main(){
 float age=uTime-aTiming.x-aTiming.z; float t=max(0.,age);
 float u=clamp((age+aLaunch)/aLaunch,0.,1.);
 float travel=(1.-exp(-1.6*t))/1.6;
 vec3 ascending=vec3(position.x+sin(u*3.14159265)*.65,3.+(position.y-3.)*sin(u*1.57079633),position.z+(1.-u)*2.);
 vec3 falling=position+aVelocity*travel;falling.y-=t*t;
 // Both branches meet at the identical apex. Sparks already exist inside the
 // ascending comet; they spread locally on burst, never switch from a stencil.
 vec3 world=age<0.?ascending:falling;
 vec4 view=modelViewMatrix*vec4(world,1.);
 gl_Position=projectionMatrix*view;
 float perspective=step(.5,abs(projectionMatrix[2][3]));
 gl_PointSize=clamp(aSize*uViewportHeight*projectionMatrix[1][1]*.5*mix(1.,1./max(1.,-view.z),perspective),3.2,9.);
 float live=smoothstep(0.,.14,age+aLaunch)*(1.-smoothstep(aTiming.y-.8,aTiming.y,age))*smoothstep(15.,25.,world.y);
 float burst=smoothstep(0.,.10,age);
 float power=mix(aFlightGain,1.,burst);
 float glow=mix(.65+u*.35,exp(-t*.47),burst);
 float flash=smoothstep(0.,.025,t)*exp(-t*7.)*.5;
 float shimmer=.91+.09*sin(t*17.+position.x*13.+position.y*7.);
 vAlpha=live*power*(glow+flash)*shimmer*exp(-aTiming.z*8.);
 vColor=mix(color*1.6,vec3(1.9,1.65,1.1),flash);
}`;
const FRAGMENT = /* glsl */`
varying vec3 vColor; varying float vAlpha;
void main(){float r=length(gl_PointCoord*2.-1.); if(r>1.||vAlpha<.002)discard;
 float core=1.-smoothstep(.08,.76,r); float halo=exp(-r*r*7.)*.30;
 gl_FragColor=vec4(mix(vColor,vec3(1.3,1.13,.78),core*.25),(core+halo)*vAlpha);
 #include <colorspace_fragment>
}`;
const ROCKET_VERTEX = /* glsl */`
attribute vec3 aTiming; attribute float aSize; attribute vec3 color;
uniform float uTime; uniform float uViewportHeight;
varying vec3 vColor; varying float vAlpha;
void main(){float age=uTime-aTiming.x-aTiming.z;float p=clamp(age/aTiming.y,0.,1.);
 vec3 world=vec3(position.x+sin(p*2.)*2.,4.+(position.y-4.)*(1.-pow(1.-p,1.2)),position.z+9.*(1.-p));
 vec4 view=modelViewMatrix*vec4(world,1.);gl_Position=projectionMatrix*view;
 float perspective=step(.5,abs(projectionMatrix[2][3]));
 gl_PointSize=clamp(aSize*uViewportHeight*projectionMatrix[1][1]*.5*mix(1.,1./max(1.,-view.z),perspective),1.4,6.);
 vAlpha=step(0.,age)*(1.-step(aTiming.y,age))*(1.-aTiming.z*2.);vColor=color;
}`;

/** All sparks are authored once. Playback, pause, seek and resize change uniforms only. */
export function createFootprintBuffers(fleetCount = 4096) {
  const density = fleetCount < 4096 ? .56 : 1, positions = [], velocity = [], timing = [], colors = [], sizes = [], launchDuration=[], flightGain=[];
  const rockets = [], rocketTiming = [], rocketColors = [], rocketSizes = [];
  const put = (p, v, at, life, delay, color, size, ascent=1.85,gain=1) => { positions.push(...p); velocity.push(...v); timing.push(at, life, delay); colors.push(...color); sizes.push(size);launchDuration.push(ascent);flightGain.push(gain); };
  const launch = (center, at, lane = 0) => {
    for (let j = 0; j < 22; j++) { rockets.push(center[0] + lane, center[1], center[2]); rocketTiming.push(at - 1.85, 1.85, j * .009); rocketColors.push(1,.62,.19); rocketSizes.push(.7 * (1 - j / 28)); }
  };
  // Opening comet: a subdued invitation, not a large flash.
  launch([-840, 78, -240], 5.8);
  for (const event of FOOTPRINT_EVENTS) {
    const n = Math.round(64 * density);
    for (let i = 0; i < n; i++) {
      const origin=footprintWorldPoint(event,i,n),seed=i+event.index*941;
      const at=event.at+hash(seed,6)*.09;
      // Each perimeter shell rises as one compact comet. Its four existing
      // branches separate at the apex into a small, physically local burst.
      for(let branch=0;branch<4;branch++) {
        const a=hash(seed*7+branch,2)*Math.PI*2,speed=branch===0?.25:1.3+hash(seed,branch+3)*2;
        const vel=[Math.cos(a)*speed,(hash(seed*7+branch,4)-.25)*2.2,Math.sin(a)*speed];
        const c=[1,.67+hash(seed,7)*.19,.25+hash(seed,8)*.13];
        for(let tail=0;tail<6;tail++)put(origin,vel,at,5.7+hash(seed,1)*.5,tail*.045,c,tail?.40:.88,1.85,1/4);
      }
    }
  }
  for (let e = 0; e < FOOTPRINT_FINALE.length; e++) {
    const event = FOOTPRINT_FINALE[e], n = Math.round(390 * density); launch(event.center, event.at);
    for (let i = 0; i < n; i++) {
      const q = (i + .5) / n, y = 1 - 2 * q, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
      const speed = event.radius * (.75 + hash(i, e) * .25)*2.2, v = [Math.cos(a) * r * speed, y * speed * .74 + 5, Math.sin(a) * r * speed * .65];
      for (let tail = 0; tail < 3; tail++) put(event.center, v, event.at, 7.8, tail * .09, [1,.65 + .2 * hash(i, 14),.22], tail ? .42 : .8,1.85,1/n);
    }
  }
  return { position: new Float32Array(positions), velocity: new Float32Array(velocity), timing: new Float32Array(timing), color: new Float32Array(colors), size: new Float32Array(sizes),launchDuration:new Float32Array(launchDuration),flightGain:new Float32Array(flightGain),
    rocketPosition: new Float32Array(rockets), rocketTiming: new Float32Array(rocketTiming), rocketColor: new Float32Array(rocketColors), rocketSize: new Float32Array(rocketSizes) };
}
export function createFootprintFireworkVisual(count = 4096) {
  const data = createFootprintBuffers(count), group = new THREE.Group(); group.name = 'FootstepsOfLightPyrotechnics';group.userData.choreography='horizontal-hollow-continuous-v2';
  const uniforms = { uTime: { value: 0 }, uViewportHeight: { value: 720 } }, resources = [];
  const add = (vertexShader, attributes, name) => {
    const geometry = new THREE.BufferGeometry(); for (const [key, values, size] of attributes) geometry.setAttribute(key, new THREE.BufferAttribute(values, size));
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: FRAGMENT, uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const points = new THREE.Points(geometry, material); points.name = name; points.frustumCulled = false; points.renderOrder = 5; group.add(points); resources.push(geometry, material);
  };
  add(VERTEX, [['position',data.position,3],['aVelocity',data.velocity,3],['aTiming',data.timing,3],['color',data.color,3],['aSize',data.size,1],['aLaunch',data.launchDuration,1],['aFlightGain',data.flightGain,1]], 'GoldenFootprintEmbers');
  add(ROCKET_VERTEX, [['position',data.rocketPosition,3],['aTiming',data.rocketTiming,3],['color',data.rocketColor,3],['aSize',data.rocketSize,1]], 'RisingFireworkComets');
  let disposed = false; group.visible = false;
  return { group, stats: Object.freeze({ sparkPoints: data.size.length, rocketPoints: data.rocketSize.length, drawCalls: 2 }),
    update(timeMs, reducedMotion = false, height = 720) { if (disposed) return false; const t = Number.isFinite(timeMs) ? Math.max(0,timeMs / 1000) : 0;
      uniforms.uTime.value = t; uniforms.uViewportHeight.value = Number.isFinite(height) ? Math.max(1,height) : 720; group.visible = !reducedMotion && t >= 3 && t < 99; return group.visible; },
    dispose() { if (disposed) return; disposed = true; group.visible = false; resources.forEach(r => r.dispose()); group.clear(); } };
}
