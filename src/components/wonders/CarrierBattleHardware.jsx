import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CARRIER_BATTLE_MOUNTS, sampleCarrierBattle } from '../../../shared/carrierBattle.js';
import { sampleBarrageMount } from '../../../shared/carrierBarrage.js';

// This assembly lives inside the existing carrier's lifting group. Coordinates
// remain the original town coordinates; only the owning hull adds lift height.
// Ten instanced batches render all moving panels, four turrets and four engines.
const COUNTS = { armour: 16, trim: 12, dark: 8, bases: 4, necks: 4, barrels: 20, turbines: 8, rings: 4, plumes: 8, markings: 8 };
const UP = new THREE.Vector3(0, 1, 0), FRONT = new THREE.Vector3(0, 0, -1);
const IDENTITY = new THREE.Quaternion();
const HORIZONTAL_RING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const ALONG_X = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
const ALONG_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

function createHardwareAssets() {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 20);
  const ring = new THREE.TorusGeometry(1, .105, 6, 32);
  const cone = new THREE.CylinderGeometry(.48, 1, 1, 24, 6, true);
  const metal = (color, roughness = .52, metalness = .7) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const materials = {
    armour: metal('#53636b'), trim: metal('#94a6ad'), dark: metal('#1b2b35', .65),
    bases: metal('#53636b'), necks: metal('#819099'), barrels: metal('#293b44', .35),
    turbines: new THREE.MeshStandardMaterial({ color: '#6dd8ff', emissive: '#3eacd9', emissiveIntensity: .2, metalness: .45, roughness: .3 }),
    rings: metal('#a4bac4', .28),
    plumes: new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } }, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `varying vec2 vUv; varying vec3 vNormal,vView; void main(){vUv=uv;
        vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);vView=-mv.xyz;
        vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform float uOpacity; varying vec2 vUv; varying vec3 vNormal,vView;
        void main(){float edge=pow(abs(dot(normalize(vNormal),normalize(vView))),.75);
        float falloff=pow(clamp(vUv.y,0.,1.),1.8);float alpha=uOpacity*falloff*edge;
        vec3 color=mix(vec3(.10,.34,.66),vec3(.66,.89,1.),pow(vUv.y,3.));
        gl_FragColor=vec4(color,alpha);}`,
    }),
    markings: metal('#d4ba64', .7, .25),
  };
  return { geometries: { armour: box, trim: box, dark: box, bases: cylinder, necks: cylinder, barrels: cylinder, turbines: cylinder, rings: ring, plumes: cone, markings: box }, materials,
    dispose() { new Set([box, cylinder, ring, cone]).forEach(item => item.dispose()); Object.values(materials).forEach(item => item.dispose()); } };
}

export default function CarrierBattleHardware({ timeRef, reducedMotion = false }) {
  const assets = useMemo(createHardwareAssets, []);
  const meshes = useRef({});
  const work = useMemo(() => ({ object: new THREE.Object3D(), direction: new THREE.Vector3(), pivot: new THREE.Vector3(), axial: new THREE.Quaternion(), forward: new THREE.Quaternion(), radial: new THREE.Vector3() }), []);
  useEffect(() => () => assets.dispose(), [assets]);
  useFrame(() => {
    const time = timeRef?.current ?? 0;
    const state = sampleCarrierBattle(time, { reducedMotion });
    const { height, deploy, hangar, engine } = state.carrier;
    const cursor = Object.fromEntries(Object.keys(COUNTS).map(key => [key, 0]));
    const put = (kind, position, scale, rotation = IDENTITY) => {
      const mesh = meshes.current[kind];
      if (!mesh) return;
      work.object.position.set(...position); work.object.scale.set(...scale); work.object.quaternion.copy(rotation); work.object.updateMatrix();
      mesh.setMatrixAt(cursor[kind]++, work.object.matrix);
    };
    // Four articulated sponsons slide outward from the hull before lift. The
    // deck and island never change identity or get replaced by a second ship.
    const span = .45 + deploy * 6.25;
    for (const side of [-1, 1]) for (const z of [11, 29]) {
      const podX = 63 + side * (8.35 + span);
      put('armour', [63 + side * (8.35 + span / 2), -.55, z], [span, .85, 4.8]);
      put('armour', [podX, -.95, z], [3.2, 1.75, 5.4]);
      put('trim', [podX, -.02, z], [3.35, .13, 5.5]);
      put('dark', [podX, -.95, z + 2.72], [2.55, .8, .08]);
      put('turbines', [podX, -1.99, z], [1.28, .4, 1.28]);
      put('rings', [podX, -2.2, z], [1.35, 1.35, 1.35], HORIZONTAL_RING);
      const plumeLength = .01 + engine * 6.2;
      put('plumes', [podX, -2.3 - plumeLength / 2, z], [1.2, plumeLength, 1.2]);
      put('plumes', [podX, -2.3 - plumeLength * .34, z], [.52, plumeLength * .68, .52]);
      for (const dz of [-1.5, 1.5]) put('markings', [podX, .055, z + dz], [2.3, .025, .18]);
    }
    // The central opening is aligned with the shared defensive-drone spawn:
    // [63, carrier.height + .85, 13], heading out toward negative world Z.
    // The +Z director sees the bay from above. Two sliding roof leaves expose
    // the real launch aperture, rather than hiding its first aircraft beneath
    // a fixed roof and making them appear abruptly beyond the rear silhouette.
    for (const side of [-1, 1]) put('armour', [63 + side * (1.45 + hangar * 2.9), 1.8, 15.3], [2.9, .3, 4.6]);
    put('armour', [63, .9, 17.5], [5.6, 1.8, .25]);
    for (const side of [-1, 1]) {
      put('armour', [63 + side * 2.72, .9, 15.3], [.25, 1.8, 4.5]);
      put('armour', [63 + side * (1.3 + hangar * 2.6), .8, 13.02], [2.5, 1.6, .18]);
      put('trim', [63 + side * 2.57, 1.65, 13.0], [.14, .13, .18]);
      put('turbines', [63 + side * 2.75, 1.98, 15.3], [.035, 4.6, .035], ALONG_Z);
    }
    for (const z of [13, 17.6]) put('turbines', [63, 1.98, z], [.035, 5.5, .035], ALONG_X);
    for (let index = 0; index < CARRIER_BATTLE_MOUNTS.length; index++) {
      const turret = sampleBarrageMount(time, index, reducedMotion);
      const base = turret.base, pivot = turret.pivot;
      work.direction.set(...turret.target).sub(work.pivot.set(...pivot)).normalize();
      work.axial.setFromUnitVectors(UP, work.direction);
      work.forward.setFromUnitVectors(FRONT, work.direction);
      put('bases', [base[0], .45, base[2]], [.72, .9, .72]);
      put('necks', [base[0], 1.55, base[2]], [.37, 1.3, .37]);
      put('trim', [pivot[0] - work.direction.x * .25, pivot[1] - height - work.direction.y * .25, pivot[2] - work.direction.z * .25], [.95, .72, 1.0], work.forward);
      put('dark', [base[0], .95, base[2]], [.9, .12, .9]);
      // The center barrel terminates at exactly sampleBattleTurret().muzzle;
      // the FX layer starts its tracer at that same point, not an approximation.
      for (let barrel = 0; barrel < 5; barrel++) {
        const angle = barrel / 4 * Math.PI * 2 + turret.spin;
        work.radial.set(barrel === 4 ? 0 : Math.cos(angle) * .16, 0, barrel === 4 ? 0 : Math.sin(angle) * .16).applyQuaternion(work.axial);
        put('barrels', [pivot[0] + work.direction.x * .725 + work.radial.x, pivot[1] - height + work.direction.y * .725 + work.radial.y, pivot[2] + work.direction.z * .725 + work.radial.z], [.055, 1.45, .055], work.axial);
      }
    }
    assets.materials.turbines.emissiveIntensity = .15 + engine * 2.1;
    assets.materials.plumes.opacity = reducedMotion ? 0 : engine * .22;
    assets.materials.plumes.uniforms.uOpacity.value = assets.materials.plumes.opacity;
    for (const [kind, mesh] of Object.entries(meshes.current)) if (mesh) {
      mesh.count = cursor[kind]; mesh.instanceMatrix.needsUpdate = true;
    }
  }, -.16);
  return <group name="carrier-battle-hardware">{Object.keys(COUNTS).map(kind => <instancedMesh key={kind} name={`carrier-battle-${kind}`} ref={mesh => { meshes.current[kind] = mesh; if(mesh)mesh.count=0; }} args={[assets.geometries[kind], assets.materials[kind], COUNTS[kind]]} frustumCulled={false} castShadow={kind !== 'plumes' && kind !== 'turbines'} receiveShadow={kind !== 'plumes'}/>)}</group>;
}

// A permanent-looking maintenance cradle remains under the SAME departing
// vessel. It makes the unchanged server's deck/support footprint visible;
// spectators never get an invisible floor or a duplicate carrier at sea level.
export function CarrierBattleDock({timeRef,reducedMotion=false}) {
  const assets = useMemo(() => ({ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshStandardMaterial({ color: '#354950', roughness: .88, metalness: .25 }) }), []);
  const instances = useRef();
  useEffect(() => {
    const object = new THREE.Object3D();
    const entries = [
      [[63, -.2, 20], [18, .4, 30]],
      [[69.5, .42, 21], [3.4, .84, 7]], [[69, .32, 10], [4, .64, 4]], [[69, .32, 31], [4, .64, 4]],
      [[54.35, -.7, 20], [.7, 1.1, 30]], [[71.65, -.7, 20], [.7, 1.1, 30]],
    ];
    entries.forEach(([position, scale], index) => { object.position.set(...position); object.scale.set(...scale); object.updateMatrix(); instances.current?.setMatrixAt(index, object.matrix); });
    if (instances.current) { instances.current.instanceMatrix.needsUpdate = true; instances.current.computeBoundingSphere(); }
    return () => { assets.geometry.dispose(); assets.material.dispose(); };
  }, [assets]);
  useFrame(()=>{if(instances.current)instances.current.visible=sampleCarrierBattle(timeRef?.current??0,{reducedMotion}).carrier.height>.025;});
  return <instancedMesh name="carrier-battle-fixed-berth" ref={instances} args={[assets.geometry, assets.material, 6]} visible={false} castShadow receiveShadow/>;
}
