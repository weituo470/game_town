import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARRIER_BATTLE_COUNTS, sampleCarrierBattle, sampleBattleDrone, sampleBattleShot } from '../../../shared/carrierBattle.js';
import { BARRAGE_COUNT, sampleBarrageRound, sampleBarrageMount } from '../../../shared/carrierBarrage.js';

// A compact, original -Z-facing unmanned aircraft. These are real shaded hulls,
// wings and nozzles, not lights standing in for three-dimensional vehicles.
const TOTAL_DRONES = CARRIER_BATTLE_COUNTS.attack + CARRIER_BATTLE_COUNTS.defense;
const SHOTS = CARRIER_BATTLE_COUNTS.shots;
const SPARKS_PER_HIT = 9;
const TRACERS_PER_SHOT = 3;
// Match the actual shared-town-sea mesh in town/TownWater.jsx (not deck Y=0).
const SEA_Y = -1.28;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const TEAM = Object.freeze({
  attack: { hull: '#8b6062', wing: '#c4a2a0', light: '#ff5149', exhaust: '#ff9a43' },
  defense: { hull: '#7899ae', wing: '#c1dce7', light: '#36d9ff', exhaust: '#65bfff' },
});

/** Downwash follows the four real sponsons in CarrierBattleHardware.jsx. */
export function sampleCarrierDownwash(timeMs, reducedMotion = false) {
  const state = sampleCarrierBattle(timeMs, { reducedMotion });
  const t = state.elapsed, { height, deploy, engine } = state.carrier;
  const strength = reducedMotion ? 0 : engine * smooth((t - 78000) / 3000)
    * (1 - smooth((t - 98000) / 3000)) / (1 + (height / 10) ** 2);
  const span = .45 + deploy * 6.25;
  const origins = [-1, 1].flatMap(side => [11, 29].map(z => [63 + side * (8.35 + span), SEA_Y, z]));
  return { strength, origins, height, elapsed: t };
}

function merged(parts) {
  const expanded = parts.map(part => part.index ? part.toNonIndexed() : part);
  const result = mergeGeometries(expanded, false);
  for (const part of new Set([...parts, ...expanded])) part.dispose();
  if (!result) throw new Error('Carrier battle aircraft geometry did not merge');
  return result;
}

function loftBody() {
  const rings = [[-1.62, .025, .025], [-1.06, .23, .11], [-.34, .42, .19], [.4, .39, .17], [1.04, .26, .1]];
  const vertices = [], indices = [], count = 10;
  rings.forEach(([z, rx, ry], ring) => {
    for (let i = 0; i <= count; i++) {
      const angle = i / count * Math.PI * 2;
      vertices.push(Math.cos(angle) * rx, Math.sin(angle) * ry, z);
      if (ring < rings.length - 1 && i < count) {
        const a = ring * (count + 1) + i, b = a + count + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  // Standard primitives carry UVs; supply these to preserve merge consistency.
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vertices.length / 3 * 2), 2));
  return geometry;
}

function wing(points, thickness = .055) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -.025, 0);
  return geometry;
}

function aircraftGeometry() {
  const pods = [-.28, .28].map(x => new THREE.CylinderGeometry(.145, .13, .62, 8)
    .rotateX(Math.PI / 2).translate(x, -.055, .83));
  // Non-indexed primitives make the merged body format uniform.
  const body = merged([loftBody(), ...pods]);
  const outline = [[.16, -.42], [.5, -.32], [1.78, .62], [1.59, .92], [.16, .62]];
  const fins = [-1, 1].map(side => wing([[.22 * side, .4], [.59 * side, .62], [.66 * side, 1.2], [.28 * side, 1.12]], .065)
    .rotateZ(side * .63).translate(0, .12, 0));
  const wings = merged([wing(outline), wing(outline.map(([x, z]) => [-x, z]).reverse()), ...fins]);
  const canopy = new THREE.SphereGeometry(1, 10, 6).scale(.19, .105, .35).translate(0, .15, -.42);
  const lamps = merged([
    ...[-1, 1].map(side => new THREE.BoxGeometry(.22, .045, .16).translate(side * 1.54, .04, .7)),
    ...[-1, 1].map(side => new THREE.CylinderGeometry(.102, .102, .035, 8).rotateX(Math.PI / 2).translate(side * .28, -.055, 1.15)),
    new THREE.BoxGeometry(.1, .035, .34).translate(0, .16, .3),
  ]);
  const exhaust = merged([-1, 1].map(side => new THREE.ConeGeometry(.115, .86, 8, 1, true)
    .rotateX(Math.PI / 2).translate(side * .28, -.055, 1.59)));
  return { body, wings, canopy, lamps, exhaust };
}

/**
 * Allocate only after React commits. 13 render batches, regardless of aircraft
 * and impact count; no offscreen renderer, environment replacement or new sea.
 */
export function createCarrierBattleVisual() {
  const group = new THREE.Group();
  group.name = 'CarrierBattleAirspace';
  const resources = new Set(), meshes = {};
  const own = resource => { resources.add(resource); return resource; };
  const geometry = aircraftGeometry(); Object.values(geometry).forEach(own);
  function instances(name, geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, own(material), count);
    mesh.name = name; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Small airborne objects don't need another full shadow-render pass.
    mesh.castShadow = false; mesh.receiveShadow = false;
    meshes[name] = mesh; group.add(mesh);
    return mesh;
  }
  const body = instances('battle-drone-bodies', geometry.body,
    new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: .62, roughness: .4, emissive: '#172630', emissiveIntensity: .3 }), TOTAL_DRONES);
  const wings = instances('battle-drone-wings', geometry.wings,
    new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: .52, roughness: .46, side: THREE.DoubleSide, emissive: '#263640', emissiveIntensity: .24 }), TOTAL_DRONES);
  const canopy = instances('battle-drone-canopies', geometry.canopy,
    new THREE.MeshStandardMaterial({ color: '#071723', metalness: .7, roughness: .18, emissive: '#0b2434', emissiveIntensity: .35 }), TOTAL_DRONES);
  const lamps = instances('battle-drone-team-lights', geometry.lamps,
    new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), TOTAL_DRONES);
  const exhaust = instances('battle-drone-exhausts', geometry.exhaust,
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), TOTAL_DRONES);

  const tracerGeometry = own(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true));
  const tracers = instances('battle-short-tracers', tracerGeometry,
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .88, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), SHOTS * TRACERS_PER_SHOT);
  // A separate fixed-capacity visual barrage: authored short rounds, not an
  // extra targeting system or hundreds of independent React/particle objects.
  // The original hit events remain the only source of impacts and outcomes.
  const barrage = instances('battle-ciws-barrage', tracerGeometry,
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .82, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), BARRAGE_COUNT);
  const sparks = instances('battle-hit-sparks', own(new THREE.IcosahedronGeometry(1, 0)),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .78, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), SHOTS * SPARKS_PER_HIT + 4);
  const smoke = instances('battle-small-hit-smoke', own(new THREE.IcosahedronGeometry(1, 1)),
    new THREE.MeshBasicMaterial({ color: '#73818a', transparent: true, opacity: .19, depthWrite: false, toneMapped: true }), SHOTS * 2);
  const rings = instances('battle-sea-impact-rings', own(new THREE.TorusGeometry(1, .035, 4, 28).rotateX(Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: '#a4d9df', transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), SHOTS);
  // Fine tubular rings, never opaque discs. Three rings phase out before each
  // restart, giving a continuous outward wash without a popping reset edge.
  const downwashRings = instances('battle-engine-downwash-rings', own(new THREE.TorusGeometry(1, .012, 4, 40).rotateX(Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: '#b2d7df', transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 12);
  const mist = instances('battle-engine-sea-mist', own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
    new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `varying vec2 vMistUv; varying float vMistAlpha;
        void main(){ vMistUv=uv; vMistAlpha=instanceColor.r;
          gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vMistUv; varying float vMistAlpha;
        void main(){vec2 p=(vMistUv-.5)*2.; float r2=dot(p,p);
          float soft=exp(-r2*3.8)*(1.-smoothstep(.6,1.0,r2));
          if(soft*vMistAlpha<.0001) discard;
          gl_FragColor=vec4(vec3(.45,.58,.62),soft*vMistAlpha*.12);
          #include <colorspace_fragment>
        }` }), 16);

  const trailPositions = new Float32Array(TOTAL_DRONES * 6), trailColors = new Float32Array(TOTAL_DRONES * 6);
  const trailGeometry = own(new THREE.BufferGeometry());
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3).setUsage(THREE.DynamicDrawUsage));
  const trailMaterial = own(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .25,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial);
  trails.name = 'battle-restrained-flight-trails'; trails.frustumCulled = false;
  group.add(trails); meshes[trails.name] = trails;

  // A pair of harbour floodlights illuminate steel without changing the town's
  // global night/exposure/environment or creating a second island/ocean scene.
  const fillTarget = new THREE.Object3D(); fillTarget.position.set(63, 17, 20); group.add(fillTarget);
  const key = new THREE.SpotLight('#d5e6ff', 8200, 180, .7, .85, 2);
  key.name = 'battle-harbour-key'; key.position.set(24, 72, 69); key.target = fillTarget;
  const rim = new THREE.SpotLight('#89bacf', 5900, 160, .75, .8, 2);
  rim.name = 'battle-harbour-rim'; rim.position.set(112, 66, -9); rim.target = fillTarget;
  key.castShadow = false; rim.castShadow = false; group.add(key, rim);

  const matrix = new THREE.Matrix4(), rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  const quaternion = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  const vector = new THREE.Vector3(), tail = new THREE.Vector3(), color = new THREE.Color();
  const teamColors = Object.fromEntries(Object.entries(TEAM).map(([name, values]) => [name,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, new THREE.Color(value)]))]));
  const gold = new THREE.Color('#ffd18b'), red = new THREE.Color('#ff6652'), cyan = new THREE.Color('#57ddff');
  const barrageGold = new THREE.Color('#ffe8ac');
  const droneMeshes = [body, wings, canopy, lamps, exhaust];
  let disposed = false, lastTime = NaN, lastReduced = null;
  function place(mesh, index, x, y, z, sx = 0, sy = sx, sz = sx) {
    position.set(x, y, z); scale.set(sx, sy, sz); quaternion.identity();
    matrix.compose(position, quaternion, scale); mesh.setMatrixAt(index, matrix);
  }
  function update(timeMs = 0, reducedMotion = false) {
    if (disposed) return false;
    const time = Number.isFinite(timeMs) ? timeMs : 0;
    if (time === lastTime && reducedMotion === lastReduced) return false;
    const state = sampleCarrierBattle(time, { reducedMotion });
    let visibleAircraft = 0, visibleShots = 0, visibleHits = 0, visibleRings = 0, visibleSmoke = 0;
    const activeMuzzles = [null, null, null, null];
    for (let i = 0; i < TOTAL_DRONES; i++) {
      const team = i < CARRIER_BATTLE_COUNTS.attack ? 'attack' : 'defense';
      const index = team === 'attack' ? i : i - CARRIER_BATTLE_COUNTS.attack;
      const sample = sampleBattleDrone(time, index, team, reducedMotion);
      const opacity = sample.visible ? clamp(sample.opacity ?? 1) : 0;
      const size = (sample.scale ?? 1) * Math.sqrt(opacity);
      rotation.set(sample.pitch || 0, sample.yaw || 0, sample.bank || 0, 'YXZ'); quaternion.setFromEuler(rotation);
      position.fromArray(sample.position); scale.set(size * (team === 'attack' ? 1.02 : .88), size, size);
      matrix.compose(position, quaternion, scale);
      for (const mesh of droneMeshes) mesh.setMatrixAt(i, matrix);
      body.setColorAt(i, teamColors[team].hull); wings.setColorAt(i, teamColors[team].wing);
      lamps.setColorAt(i, color.copy(teamColors[team].light).multiplyScalar(.85 + opacity * .35));
      exhaust.setColorAt(i, color.copy(teamColors[team].exhaust).multiplyScalar(reducedMotion ? .35 : .8));
      if (size > .01) visibleAircraft++;

      // Absolute-time wing-tip condensation: seeking never draws a connecting
      // line from a stale earlier frame, and each trace is at most 2.6 metres.
      const previous = sampleBattleDrone(Math.max(0, time - 140), index, team, reducedMotion);
      vector.fromArray(sample.position).sub(tail.fromArray(previous.position));
      const distance = vector.length(), length = Math.min(2.6, distance);
      const showTrail = !reducedMotion && sample.visible && previous.visible && opacity > .5 && distance > .08;
      if (distance > .001) vector.multiplyScalar(length / distance);
      const offset = i * 6;
      for (let axis = 0; axis < 3; axis++) {
        trailPositions[offset + axis] = sample.position[axis];
        trailPositions[offset + 3 + axis] = sample.position[axis] - (showTrail ? vector.getComponent(axis) : 0);
        trailColors[offset + axis] = showTrail ? [teamColors[team].light.r, teamColors[team].light.g, teamColors[team].light.b][axis] * .45 : 0;
        trailColors[offset + 3 + axis] = 0;
      }
    }

    for (let i = 0; i < SHOTS; i++) {
      const shot = sampleBattleShot(time, i, reducedMotion);
      const progress = clamp(shot.progress ?? 0), opacity = clamp(shot.opacity ?? 1);
      const show = !reducedMotion && shot.visible && opacity > .005;
      const a = shot.start || [0, 0, 0], b = shot.end || a;
      vector.fromArray(b).sub(tail.fromArray(a));
      const wholeLength = vector.length();
      if (wholeLength > .001) vector.divideScalar(wholeLength);
      quaternion.setFromUnitVectors(UP, vector.lengthSq() > .5 ? vector : UP);
      const shotColor = shot.kind === 'intercept' ? gold : shot.team === 'attack' ? red : cyan;
      for (let train = 0; train < TRACERS_PER_SHOT; train++) {
        const segmentProgress = clamp(progress - train * .16);
        const segmentVisible = show && (train === 0 || shot.kind === 'intercept') && segmentProgress > 0;
        const segmentLength = segmentVisible ? Math.min(shot.kind === 'intercept' ? 4.4 : 2.8, wholeLength * segmentProgress) : 0;
        position.fromArray(a).addScaledVector(vector, wholeLength * segmentProgress - segmentLength * .5);
        const radius = segmentVisible ? shot.kind === 'intercept' ? .045 : .065 : 0;
        scale.set(radius, segmentLength, radius); matrix.compose(position, quaternion, scale);
        tracers.setMatrixAt(i * TRACERS_PER_SHOT + train, matrix);
        tracers.setColorAt(i * TRACERS_PER_SHOT + train, color.copy(shotColor).multiplyScalar(segmentVisible ? opacity * (1.15 - train * .12) : 0));
        if (segmentVisible && segmentLength > .01) visibleShots++;
      }
      if (show && shot.kind === 'intercept' && shot.mountId >= 0 && shot.mountId < 4) {
        activeMuzzles[shot.mountId] = [...a, vector.x, vector.y, vector.z, opacity];
      }

      const hit = shot.impact || b, age = Number.isFinite(shot.impactAge) ? shot.impactAge : -1;
      const hitVisible = !reducedMotion && age >= 0 && age < .8;
      if (hitVisible) visibleHits++;
      for (let spark = 0; spark < SPARKS_PER_HIT; spark++) {
        const id = i * SPARKS_PER_HIT + spark;
        if (!hitVisible) {
          place(sparks, id, hit[0], hit[1], hit[2]);
          sparks.setColorAt(id, color.setRGB(0, 0, 0));
          continue;
        }
        const t = age, angle = spark * 2.399963229728653 + i * .71;
        const vertical = mix(-.38, .9, ((spark * 5 + i * 3) % 11) / 10);
        const spread = spark === 0 ? 0 : (2.1 + spark * .26) * t;
        const fade = (1 - t / .8) ** 2;
        const radius = spark === 0 ? .5 * Math.max(0, 1 - t / .17) : (.07 + spark * .006) * fade;
        place(sparks, id, hit[0] + Math.cos(angle) * spread, hit[1] + vertical * spread - 2.3 * t * t,
          hit[2] + Math.sin(angle) * spread, radius);
        sparks.setColorAt(id, color.copy(spark % 3 ? gold : shotColor).multiplyScalar(.65 + fade));
      }
      for (let puff = 0; puff < 2; puff++) {
        const smokeAge = age - puff * .14;
        const showSmoke = !reducedMotion && age >= 0 && smokeAge > 0 && smokeAge < 1.7;
        if (showSmoke) visibleSmoke++;
        const size = showSmoke ? (.24 + smokeAge * .6) * Math.sin(Math.PI * smokeAge / 1.7) : 0;
        place(smoke, i * 2 + puff, hit[0] + smokeAge * .35 * (puff ? 1 : -1), hit[1] + Math.max(0, smokeAge) * .8,
          hit[2] + puff * .3, size, size * .8, size);
      }
      // Small, delayed water rings where debris would actually reach the sea;
      // no fake splashes on the island or inside the carrier's deck footprint.
      const overDeck = hit[0] > 53.8 && hit[0] < 72.2 && hit[2] > 4.8 && hit[2] < 35.2;
      const seaAge = age - Math.sqrt(Math.max(0, 2 * (hit[1] - SEA_Y) / 9.81));
      const seaHit = !reducedMotion && age >= 0 && hit[0] > 49 && !overDeck && seaAge >= 0 && seaAge < 1.6;
      const ringSize = seaHit ? .25 + seaAge * 2 : 0;
      place(rings, i, hit[0], SEA_Y + .03, hit[2], ringSize, 1, ringSize);
      rings.setColorAt(i, color.setRGB(1, 1, 1).multiplyScalar(seaHit ? 1 - seaAge / 1.6 : 0));
      if (seaHit) visibleRings++;
    }
    let visibleBarrage = 0;
    for (let i = 0; i < BARRAGE_COUNT; i++) {
      const round = sampleBarrageRound(time, i, reducedMotion);
      const strength = round.visible ? clamp(round.opacity) : 0;
      if (strength <= .001) {
        place(barrage, i, 0, 0, 0);
        barrage.setColorAt(i, color.setRGB(0, 0, 0));
        continue;
      }
      tail.fromArray(round.tail); vector.fromArray(round.head).sub(tail);
      const length = vector.length();
      vector.multiplyScalar(1 / Math.max(.00001, length));
      quaternion.setFromUnitVectors(UP, vector);
      position.copy(tail).addScaledVector(vector, length * .5);
      const radius = .047 * (.8 + strength * .2);
      scale.set(radius, length, radius); matrix.compose(position, quaternion, scale);
      barrage.setMatrixAt(i, matrix);
      barrage.setColorAt(i, color.copy(barrageGold).multiplyScalar(strength * (i % 4 === 0 ? 1.25 : .88)));
      visibleBarrage++;
    }
    // Sustained small muzzle glows show the four firing sources without
    // pulsing exposure, screen shake or full-screen/high-contrast flashing.
    for (let mount = 0; mount < 4; mount++) {
      const sampled = sampleBarrageMount(time, mount, reducedMotion);
      if (!sampled.firing) continue;
      vector.fromArray(sampled.target).sub(tail.fromArray(sampled.origin)).normalize();
      activeMuzzles[mount] = [...sampled.origin, vector.x, vector.y, vector.z, .65 + sampled.strength * .35];
    }
    let visibleMuzzles = 0;
    for (let i = 0; i < 4; i++) {
      const muzzle = activeMuzzles[i], index = SHOTS * SPARKS_PER_HIT + i;
      if (!muzzle) { place(sparks, index, 0, 0, 0); sparks.setColorAt(index, color.setRGB(0, 0, 0)); continue; }
      vector.set(muzzle[3], muzzle[4], muzzle[5]);
      position.set(muzzle[0], muzzle[1], muzzle[2]).addScaledVector(vector, .2);
      quaternion.setFromUnitVectors(UP, vector); scale.set(.17, .45, .17);
      matrix.compose(position, quaternion, scale); sparks.setMatrixAt(index, matrix);
      sparks.setColorAt(index, color.copy(gold).multiplyScalar(.75 * muzzle[6]));
      visibleMuzzles++;
    }
    const downwash = sampleCarrierDownwash(time, reducedMotion);
    for (let engine = 0; engine < 4; engine++) {
      const origin = downwash.origins[engine];
      for (let ring = 0; ring < 3; ring++) {
        const phase = (((downwash.elapsed - 78000) / 4200 + ring / 3 + engine * .08) % 1 + 1) % 1;
        const alpha = Math.sin(phase * Math.PI) ** 2 * downwash.strength;
        const radius = 1.25 + phase * 5.2;
        place(downwashRings, engine * 3 + ring, origin[0], SEA_Y + .035, origin[2], radius, 1, radius * .88);
        downwashRings.setColorAt(engine * 3 + ring, color.setRGB(alpha, alpha, alpha));
      }
      for (let puff = 0; puff < 4; puff++) {
        const angle = puff / 4 * Math.PI * 2 + downwash.elapsed / 1000 * .13 + engine;
        const phase = (((downwash.elapsed - 78000) / 6000 + puff / 4 + engine * .09) % 1 + 1) % 1;
        const radius = .7 + phase * 2.6, alpha = Math.sin(phase * Math.PI) ** 2 * downwash.strength;
        place(mist, engine * 4 + puff, origin[0] + Math.cos(angle) * radius, SEA_Y + .09 + phase * .18,
          origin[2] + Math.sin(angle) * radius, 3.6 + phase * 3.2, 1, 2.8 + phase * 2.2);
        mist.setColorAt(engine * 4 + puff, color.setRGB(alpha, alpha, alpha));
      }
    }
    for (const mesh of [body, wings, canopy, lamps, exhaust, tracers, barrage, sparks, smoke, rings, downwashRings, mist]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const mesh of droneMeshes) mesh.visible = visibleAircraft > 0;
    trails.visible = !reducedMotion && visibleAircraft > 0;
    tracers.visible = visibleShots > 0; sparks.visible = visibleHits > 0 || visibleMuzzles > 0;
    barrage.visible = visibleBarrage > 0;
    smoke.visible = visibleSmoke > 0; rings.visible = visibleRings > 0;
    downwashRings.visible = mist.visible = downwash.strength > .0001;
    trailGeometry.attributes.position.needsUpdate = true; trailGeometry.attributes.color.needsUpdate = true;
    group.userData.battle = { elapsed: state.elapsed ?? time, phase: state.phase, aircraft: visibleAircraft,
      shots: visibleShots, hits: visibleHits, seaRings: visibleRings, muzzleLights: visibleMuzzles,
      downwash: downwash.strength, barrageRounds: visibleBarrage, renderBatches: 13 };
    lastTime = time; lastReduced = reducedMotion;
    return true;
  }
  update(0);
  return {
    group, meshes, update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of Object.values(meshes)) if (mesh.isInstancedMesh) mesh.dispose();
      for (const resource of resources) resource.dispose();
      key.dispose(); rim.dispose(); group.clear();
    },
  };
}
