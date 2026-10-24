import * as THREE from 'three';
import { DROPLET_SHIPS, sampleDoomsdayShip, sampleDropletHead } from '../../../shared/droneDroplet.js';
import { createHumanWarshipGeometry, createHumanWarshipEngineGeometry } from './humanWarshipGeometry.js';
export { createHumanWarshipGeometry } from './humanWarshipGeometry.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// Original procedural reflection atlas: no downloaded movie texture, network
// request, extra camera, or per-frame cubemap render. World-space reflection
// bends these distant galactic light bands continuously over a solid surface.
export function createDropletReflection(size = 256) {
  const faces = [];
  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
      let dx, dy, dz;
      if (face === 0) { dx = 1; dy = -v; dz = -u; }
      else if (face === 1) { dx = -1; dy = -v; dz = u; }
      else if (face === 2) { dx = u; dy = 1; dz = v; }
      else if (face === 3) { dx = u; dy = -1; dz = -v; }
      else if (face === 4) { dx = u; dy = -v; dz = 1; }
      else { dx = -u; dy = -v; dz = -1; }
      const length = Math.hypot(dx, dy, dz); dx /= length; dy /= length; dz /= length;
      const latitude = dy + .31 * dx + .16 * dz;
      const band = Math.exp(-latitude * latitude * 72);
      const thin = Math.exp(-Math.pow(latitude - .055, 2) * 6200);
      const longitude = Math.atan2(dz, dx);
      const dust = .72 + .28 * Math.sin(longitude * 23 + Math.sin(longitude * 7) * 2);
      // Near-black space between hard-edged sources is essential: uniformly
      // bright environments read as grey plastic, even at full metalness.
      // All features are directional, so the cube-face boundaries stay seamless.
      const key = Math.exp(-Math.pow((longitude - .72) / .53, 8) - Math.pow((dy - .50) / .22, 8));
      const rim = Math.exp(-Math.pow((longitude + 2.10) / .24, 8) - Math.pow((dy - .12) / .56, 8));
      const silverArc = Math.exp(-Math.pow(dy - .36 * dx + .18 * dz + .28, 2) * 1900);
      const darkRift = Math.exp(-Math.pow(latitude + .12, 2) * 700);
      const starlight = Math.pow(Math.max(0, Math.sin(longitude * 157) * Math.sin(dy * 311)), 30) * .32;
      const silverFill = Math.pow(Math.max(0, dz), 2) * .28;
      const light = clamp(.085 + .045 * (dy + 1) + band * .45 * dust + thin * .9
        + key * 1.1 + rim * .95 + silverArc * .7 + silverFill + starlight - darkRift * .09);
      const i = (y * size + x) * 4;
      data[i] = Math.round(light * 242); data[i + 1] = Math.round(light * 248); data[i + 2] = Math.round(light * 255); data[i + 3] = 255;
    }
    faces.push(new THREE.DataTexture(data, size, size, THREE.RGBAFormat));
  }
  const texture = new THREE.CubeTexture(faces);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Rounded leading +X head and an uninterrupted sharp -X tail; 3.5 base units. */
export function createMirrorDropletGeometry() {
  const profile = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const radius = t <= .72 ? .72 * Math.pow(Math.sin(t / .72 * Math.PI / 2), 1.65)
      : .72 * Math.sqrt(Math.max(0, 1 - Math.pow((t - .72) / .28, 2)));
    profile.push(new THREE.Vector2(radius, t * 3.5 - 1.75));
  }
  const geometry = new THREE.LatheGeometry(profile, 96);
  geometry.rotateZ(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function instanced(geometry, material, count, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

/** A handful of batched meshes, never one React component/light per spacecraft. */
export function createDropletBattleVisual({ backdrop = true } = {}) {
  const group = new THREE.Group(); group.name = 'MirrorDropletAndHumanFleet';
  // The stage dissolves the finite coastal ground beneath the aerial story;
  // it fades away before landing, keeping the town and its camera intact.
  const horizonGeometry = new THREE.PlaneGeometry(2600, 2600);
  const horizonMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: 'varying vec2 starUv; void main(){ starUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 starUv; uniform float uOpacity;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){ vec2 grid=starUv*500.0, cell=floor(grid), local=fract(grid)-.5;
        float star=pow(max(0.0,1.0-length(local)*3.5),6.0)*step(.985,hash(cell));
        vec3 color=vec3(.018,.028,.060)+star*vec3(.33,.43,.55);
        gl_FragColor=vec4(color,uOpacity);
        #include <colorspace_fragment>
      }` });
  const horizon = new THREE.Mesh(horizonGeometry, horizonMaterial); horizon.rotation.x = -Math.PI / 2;
  horizon.position.set(0, 44, -50); horizon.name = 'DissolvingStellarStage'; horizon.frustumCulled = false;
  group.add(horizon);
  const reflection = createDropletReflection();
  const mirrorGeometry = createMirrorDropletGeometry();
  const mirrorMaterial = new THREE.MeshPhysicalMaterial({ color: '#f3f7ff', metalness: 1, roughness: .004,
    envMap: reflection, envMapIntensity: 2.05, clearcoat: 1, clearcoatRoughness: .003, fog: false });
  const mirror = new THREE.Mesh(mirrorGeometry, mirrorMaterial); mirror.name = 'SolidMirrorDroplet'; mirror.frustumCulled = false;
  group.add(mirror);
  const hullGeometry = createHumanWarshipGeometry();
  hullGeometry.scale(1.55, 1.55, 1.55);
  const hullMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .68, roughness: .32,
    envMap: reflection, envMapIntensity: 1.1, emissive: '#57778c', emissiveIntensity: .3, fog: false });
  const hull = instanced(hullGeometry, hullMaterial, DROPLET_SHIPS.length, '216HumanWarships'); group.add(hull);
  const engineGeometry = createHumanWarshipEngineGeometry();
  engineGeometry.scale(1.55, 1.55, 1.55);
  const engineMaterial = new THREE.MeshBasicMaterial({ color: '#50caff', vertexColors: true, fog: false, toneMapped: false });
  const engines = instanced(engineGeometry, engineMaterial, DROPLET_SHIPS.length, 'WarshipEnginesAndBridge'); group.add(engines);
  const blastGeometry = new THREE.IcosahedronGeometry(1, 2);
  const blastMaterial = new THREE.ShaderMaterial({ transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: `varying vec3 vFire; varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
      void main(){ vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);
        vFire=instanceColor; vNormal=normalize(normalMatrix*normal); vView=-mv.xyz; vLocal=position;
        gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vFire; varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
      void main(){ float front=max(0.0,dot(normalize(vNormal),normalize(vView)));
        float noise=.76+.24*sin(vLocal.x*17.0+sin(vLocal.y*11.0))*sin(vLocal.z*15.0-vLocal.y*8.0);
        float alpha=smoothstep(.04,.7,front)*noise*.85;
        float heat=max(vFire.r,max(vFire.g,vFire.b));
        vec3 glow=mix(vFire,vec3(1.9,1.65,1.2)*heat,pow(front,5.0)*.8);
        gl_FragColor=vec4(glow,alpha);
        #include <colorspace_fragment>
      }` });
  const blasts = instanced(blastGeometry, blastMaterial, DROPLET_SHIPS.length, 'DelayedReactorExplosions'); blasts.renderOrder = 2; group.add(blasts);
  const ringGeometry = new THREE.TorusGeometry(1, .018, 4, 40);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffc17b', transparent: true, opacity: .7,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const rings = instanced(ringGeometry, ringMaterial, DROPLET_SHIPS.length, 'ReactorShockRings'); rings.renderOrder = 2; group.add(rings);
  const debrisGeometry = new THREE.BoxGeometry(1.2, .35, .7);
  const debrisMaterial = new THREE.MeshStandardMaterial({ color: '#71869c', metalness: .65, roughness: .4,
    emissive: '#b55c22', emissiveIntensity: .3, fog: false });
  const debris = instanced(debrisGeometry, debrisMaterial, DROPLET_SHIPS.length * 6, 'ExpandingWarshipDebris'); group.add(debris);
  const wakePositions = new Float32Array(36 * 3), wakeColors = new Float32Array(36 * 3);
  const wakeGeometry = new THREE.BufferGeometry();
  wakeGeometry.setAttribute('position', new THREE.BufferAttribute(wakePositions, 3).setUsage(THREE.DynamicDrawUsage));
  wakeGeometry.setAttribute('color', new THREE.BufferAttribute(wakeColors, 3).setUsage(THREE.DynamicDrawUsage));
  const wakeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .55,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const wake = new THREE.Line(wakeGeometry, wakeMaterial); wake.name = 'ShortMotionWakeNotLaser'; wake.frustumCulled = false; wake.renderOrder = 3; group.add(wake);
  const object = new THREE.Object3D(), color = new THREE.Color(), head = new Float64Array(8), oldHead = new Float64Array(8), state = new Float32Array(8);
  const direction = new THREE.Vector3(), forward = new THREE.Vector3(1, 0, 0);
  let lastTime = NaN, lastReduced;
  function update(timeMs, reducedMotion = false) {
    if (timeMs === lastTime && reducedMotion === lastReduced) return false;
    lastTime = timeMs; lastReduced = reducedMotion;
    const s = Math.max(0, timeMs / 1000);
    horizonMaterial.uniforms.uOpacity.value = smooth((s - 26) / 10) * (1 - smooth((s - 114) / 8));
    horizon.visible = backdrop && s >= 26 && s < 122;
    sampleDropletHead(timeMs, head, { reducedMotion });
    mirror.visible = s >= 44 && s < 114;
    mirror.position.set(head[0], head[1], head[2]);
    direction.set(head[5], head[6], head[7]).normalize();
    if (direction.lengthSq() < .1) direction.set(Math.cos(head[3]), Math.sin(head[3]), 0);
    mirror.quaternion.setFromUnitVectors(forward, direction);
    mirror.scale.setScalar(head[4] * smooth((s - 44) / 2) * (1 - smooth((s - 112) / 2)));
    hull.visible = engines.visible = s >= 36 && s < 114;
    blasts.visible = rings.visible = debris.visible = !reducedMotion && s >= 64 && s < 114;
    for (let i = 0; i < DROPLET_SHIPS.length; i++) {
      const ship = DROPLET_SHIPS[i]; sampleDoomsdayShip(i, timeMs, state, { reducedMotion });
      const scale = state[3] * state[4];
      object.position.set(state[0], state[1], state[2]); object.rotation.set(0, 0, 0); object.scale.setScalar(scale); object.updateMatrix();
      hull.setMatrixAt(i, object.matrix); engines.setMatrixAt(i, object.matrix);
      color.setRGB(1 + state[5] * 2, 1 - state[5] * .5, 1 - state[5] * .8); hull.setColorAt(i, color);
      const age = s - ship.explodeTime;
      const blast = !reducedMotion && age >= 0 && age < 1.5;
      const fade = blast ? Math.pow(1 - age / 1.5, 1.7) : 0;
      object.position.set(...ship.position); object.scale.setScalar(blast ? (1.2 + age * 9) : 0); object.updateMatrix(); blasts.setMatrixAt(i, object.matrix);
      color.setRGB(fade * 2.8, fade * Math.max(.18, 1.5 - age), fade * Math.max(.04, .75 - age)); blasts.setColorAt(i, color);
      object.rotation.set(.75, .2, i * .27); object.scale.setScalar(blast ? 2 + age * 17 : 0); object.updateMatrix(); rings.setMatrixAt(i, object.matrix);
      color.setRGB(fade, fade, fade); rings.setColorAt(i, color);
      for (let j = 0; j < 6; j++) {
        const angle = i * 2.399 + j * 1.047, active = !reducedMotion && age >= 0 && age < 8;
        const spread = active ? 2 + age * (3.8 + j * .35) : 0;
        object.position.set(ship.position[0] + Math.cos(angle) * spread, ship.position[1] + Math.sin(angle) * spread * .7, ship.position[2] + Math.sin(angle * 1.7) * spread);
        object.rotation.set(age * .7 + j, angle + age * .4, age * .3);
        object.scale.setScalar(active ? (1 + j * .13) * (1 - smooth((age - 5) / 3)) : 0); object.updateMatrix(); debris.setMatrixAt(i * 6 + j, object.matrix);
      }
    }
    for (const mesh of [hull, engines, blasts, rings, debris]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    wake.visible = !reducedMotion && s >= 64 && s < 104;
    if (wake.visible) {
      for (let i = 0; i < 36; i++) {
        sampleDropletHead(timeMs - i * 1.8, oldHead);
        const k = i * 3, brightness = (1 - i / 36) * .8;
        wakePositions[k] = oldHead[0]; wakePositions[k + 1] = oldHead[1]; wakePositions[k + 2] = oldHead[2];
        wakeColors[k] = brightness; wakeColors[k + 1] = brightness; wakeColors[k + 2] = brightness;
      }
      wakeGeometry.attributes.position.needsUpdate = true; wakeGeometry.attributes.color.needsUpdate = true;
    }
    return true;
  }
  function dispose() {
    for (const mesh of [hull, engines, blasts, rings, debris]) mesh.dispose();
    for (const resource of [horizonGeometry, horizonMaterial, mirrorGeometry, mirrorMaterial, hullGeometry, hullMaterial, engineGeometry, engineMaterial, blastGeometry, blastMaterial, ringGeometry, ringMaterial, debrisGeometry, debrisMaterial, wakeGeometry, wakeMaterial]) resource.dispose();
    reflection.images.forEach(face => face.dispose()); reflection.dispose(); group.clear();
  }
  update(0);
  return { group, update, dispose, mirror, hull, blasts, debris };
}
