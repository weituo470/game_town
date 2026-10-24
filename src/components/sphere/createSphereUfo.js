import * as THREE from 'three';
import { SPHERE_LANDMARK as S } from '../../../shared/sphere-landmark.js';
import { sampleSphereUfoShow } from '../../../shared/sphereUfoShow.js';

/** Original saucer, two eye beams and a sea-only comic crash. No textures,
 * downloads, secondary renderer, particle lights or gameplay damage. */
export function createSphereUfo() {
  const group = new THREE.Group(); group.name = 'SphereGuardianAndMischiefUfo';
  group.position.set(-S.x, 0, -S.z); group.visible = false;
  const saucer = new THREE.Group(); saucer.name = 'MischiefSaucer'; group.add(saucer);
  const shapes = new Set(), surfaces = new Set();
  const geometry = g => { shapes.add(g); return g; }, material = m => { surfaces.add(m); return m; };
  const metal = material(new THREE.MeshStandardMaterial({ color: '#465473', metalness: .85, roughness: .23, emissive: '#152e46', emissiveIntensity: .5 }));
  const dark = material(new THREE.MeshStandardMaterial({ color: '#10172e', metalness: .75, roughness: .32 }));
  const cyan = material(new THREE.MeshBasicMaterial({ color: '#59f9ff', toneMapped: false }));
  const pink = material(new THREE.MeshBasicMaterial({ color: '#e47dff', toneMapped: false }));
  const glass = material(new THREE.MeshStandardMaterial({ color: '#84ffe0', emissive: '#0f5e5a', emissiveIntensity: .6, transparent: true, opacity: .65, metalness: .35, roughness: .12, depthWrite: false }));
  const mesh = (parent, name, g, m, at = [0, 0, 0], scale = [1, 1, 1]) => {
    const o = new THREE.Mesh(g, m); o.name = name; o.position.set(...at); o.scale.set(...scale); o.frustumCulled = false; parent.add(o); return o;
  };
  const ball = geometry(new THREE.SphereGeometry(1, 32, 20));
  mesh(saucer, 'ArmouredFlyingDisc', ball, metal, [0, 0, 0], [7.5, 1.35, 7.5]);
  mesh(saucer, 'SaucerUnderbelly', ball, dark, [0, -.7, 0], [5.7, 1.25, 5.7]);
  mesh(saucer, 'MintGlassDome', ball, glass, [0, 1.15, 0], [3.4, 2.4, 3.4]);
  mesh(saucer, 'ComicPilot', ball, material(new THREE.MeshBasicMaterial({ color: '#a2e493' })), [0, 1.7, 0], [1.1, 1.4, 1.1]);
  for (const sign of [-1, 1]) mesh(saucer, 'PilotEye', ball, dark, [sign * .44, 2.1, .93], [.25, .43, .13]);
  const rim = mesh(saucer, 'CyanAntigravityRim', geometry(new THREE.TorusGeometry(6.8, .16, 8, 80)), cyan); rim.rotation.x = Math.PI / 2;
  const lamps = new THREE.InstancedMesh(geometry(new THREE.SphereGeometry(.28, 8, 6)), pink, 20); lamps.name = 'TwentyRimBeacons'; saucer.add(lamps);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < lamps.count; i++) { const a = i / lamps.count * Math.PI * 2; dummy.position.set(Math.sin(a) * 7.15, .15, Math.cos(a) * 7.15); dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix); }
  lamps.instanceMatrix.needsUpdate = true;
  const prankMaterial = material(new THREE.MeshBasicMaterial({ color: '#c567ff', transparent: true, opacity: .09, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const prank = mesh(saucer, 'HarmlessPrankSearchlight', geometry(new THREE.ConeGeometry(9, 20, 32, 1, true)), prankMaterial, [0, -10, 0]);
  const beamGeometry = geometry(new THREE.CylinderGeometry(1, 1, 1, 10));
  const beamCore = material(new THREE.MeshBasicMaterial({ color: '#f5ffe8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const beamGlow = material(new THREE.MeshBasicMaterial({ color: '#42dfff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const beams = [-1, 1].map((side, i) => ({
    core: mesh(group, `EyeLaserCore${i}`, beamGeometry, beamCore), halo: mesh(group, `EyeLaserHalo${i}`, beamGeometry, beamGlow),
    charge: mesh(group, `EyeCharge${i}`, ball, cyan),
  }));
  const impactMaterial = material(new THREE.MeshBasicMaterial({ color: '#ffb257', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const impact = mesh(group, 'LocalizedSaucerImpact', ball, impactMaterial);
  const fragments = new THREE.InstancedMesh(geometry(new THREE.IcosahedronGeometry(1, 0)), metal, 18); fragments.name = 'SaucerHotFragments'; group.add(fragments);
  const splashMaterial = material(new THREE.MeshBasicMaterial({ color: '#bdeeff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const splash = mesh(group, 'SeaCrashRipple', geometry(new THREE.TorusGeometry(1, .055, 6, 80)), splashMaterial); splash.rotation.x = -Math.PI / 2;
  const waterPositions = new Float32Array(96 * 3), waterGeometry = geometry(new THREE.BufferGeometry()); waterGeometry.setAttribute('position', new THREE.BufferAttribute(waterPositions, 3));
  const waterMaterial = material(new THREE.PointsMaterial({ color: '#d6f7ff', size: .65, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const water = new THREE.Points(waterGeometry, waterMaterial); water.name = 'SeaCrashSpray'; water.frustumCulled = false; group.add(water);
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(), start = new THREE.Vector3(), end = new THREE.Vector3();
  let disposed = false;
  function update(ms, reducedMotion = false) {
    if (disposed) return null;
    const s = sampleSphereUfoShow(ms, reducedMotion); group.visible = s.active;
    group.userData.phase = s.phase; saucer.visible = s.ufoVisible;
    saucer.position.set(...s.position); saucer.rotation.set(s.falling ? s.roll * .43 : 0, reducedMotion ? 0 : ms * .0012, s.roll);
    saucer.scale.setScalar(s.ufoVisible ? Math.max(.001, s.ufoOpacity) : .001);
    prank.visible = s.prank; lamps.visible = !s.falling || reducedMotion;
    for (const [i, beam] of beams.entries()) {
      start.fromArray(s.eyes[i]); end.fromArray(s.position); direction.copy(end).sub(start);
      const length = direction.length(); direction.normalize();
      for (const [part, radius] of [[beam.core, .13], [beam.halo, .48]]) {
        part.visible = s.laser > .001; part.position.copy(start).add(end).multiplyScalar(.5); part.quaternion.setFromUnitVectors(up, direction); part.scale.set(radius, length, radius);
      }
      beam.charge.visible = s.charge > .001; beam.charge.position.copy(start); beam.charge.scale.setScalar(.25 + s.charge * .9);
    }
    beamCore.opacity = s.laser * .9; beamGlow.opacity = s.laser * .24;
    impact.visible = s.hit > .001; impact.position.copy(end).add(direction.copy(start).sub(end).normalize().multiplyScalar(5.2)); impact.scale.setScalar(.5 + s.hit * 1.8); impactMaterial.opacity = s.hit * .45;
    fragments.visible = s.falling && !reducedMotion;
    if (fragments.visible) for (let i = 0; i < fragments.count; i++) {
      const age = Math.max(0, (ms - 119800) / 1000), a = i * 2.39996, r = (1 + i % 4) * age * .8;
      dummy.position.set(s.position[0] + Math.cos(a) * r, Math.max(.2, s.position[1] + Math.sin(a * 3) * age - age * age * .15), s.position[2] + Math.sin(a) * r);
      dummy.rotation.set(a + age, age * 2, a); dummy.scale.setScalar(.28 + i % 3 * .12); dummy.updateMatrix(); fragments.setMatrixAt(i, dummy.matrix);
    }
    fragments.instanceMatrix.needsUpdate = true;
    splash.visible = water.visible = s.splash;
    if (s.splash) {
      const age = s.splashAge, [x, y, z] = s.splashPosition; splash.position.set(x, y, z); splash.scale.setScalar(2 + age * 7); splashMaterial.opacity = Math.max(0, 1 - age / 3.7) * .7;
      for (let i = 0; i < 96; i++) { const a = i * 2.39996, speed = 3 + i % 7 * .65, r = speed * age; waterPositions.set([x + Math.cos(a) * r, y + Math.max(0, (5 + i % 5) * age - 4.8 * age * age), z + Math.sin(a) * r], i * 3); }
      waterGeometry.attributes.position.needsUpdate = true; waterMaterial.opacity = Math.max(0, 1 - age / 3.7) * .8;
    }
    return s;
  }
  function dispose() { if (disposed) return; disposed = true; lamps.dispose(); fragments.dispose(); for (const g of shapes) g.dispose(); for (const m of surfaces) m.dispose(); group.clear(); }
  return { group, update, dispose, statistics: { maxDrawCalls: 23, particleCount: 96, instancedFragments: 18 } };
}
