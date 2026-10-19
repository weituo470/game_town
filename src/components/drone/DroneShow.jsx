import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DRONE_COUNT, createDroneFleet } from '../../../shared/droneShow.js';
import { getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../../../shared/dronePrograms.js';
import { DRONE_VERTEX_SHADER, DRONE_FRAGMENT_SHADER, AI_DRONE_VERTEX_SHADER, AI_DRONE_FRAGMENT_SHADER, AI_DRONE_LIGHT_PROFILE, PAD_VERTEX_SHADER, PAD_FRAGMENT_SHADER } from './droneShaders.js';
import { sampleDroneCamera } from './droneCamera.js';
import { sampleDropletCamera } from './dropletCamera.js';
import { sampleCarrierBattleCamera } from './carrierBattleCamera.js';
import { sampleDroneFirstPerson, selectDroneSeats } from './droneFirstPerson.js';
import FirstPersonLook from '../town/FirstPersonLook.jsx';
import { clampLookPitch } from '../town/firstPerson.js';
import { createFleetUpdateGate, getSceneRenderRatio } from './dronePerformance.js';
import { createDropletBattleVisual } from './dropletBattleVisual.js';
import { createBlackHoleVisual } from './blackHoleVisual.js';
import { sampleBlackHoleCamera } from './blackHoleCamera.js';

const ZERO_TIME = { current: 0 };
const PAD_LOCATIONS = [[-26, -24], [26, -24], [-26, 24], [26, 24]];
const TRAIL_STRIDE = 8;

function createPadGeometry() {
  const positions = [], uvs = [];
  for (const [x, z] of PAD_LOCATIONS) {
    const corners = [[-3.8, -3.8, 0, 0], [3.8, -3.8, 1, 0], [3.8, 3.8, 1, 1], [-3.8, 3.8, 0, 1]];
    for (const index of [0, 2, 1, 0, 3, 2]) {
      const corner = corners[index];
      positions.push(x + corner[0], 0.49, z + corner[1]);
      uvs.push(corner[2], corner[3]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

// Assets are allocated after commit, not during a potentially discarded React
// render. Each StrictMode setup owns and disposes its own independent buffers.
function createDroneVisual(count, gl, program = 'avatar', aiRuntime) {
  const aiParticles = program === 'ai';
  const group = new THREE.Group();
  group.name = program === 'blackhole' ? 'BlackHoleSkyApparition' : program === 'droplet' ? 'DoomsdayDroneFleet' : 'LawOfHeavenDroneFleet';
  const fleet = createDroneFleet(count);
  const seats = selectDroneSeats(fleet);
  updateDroneProgram(fleet, 0, { program, aiRuntime });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(fleet.positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(fleet.colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(fleet.sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.boundingSphere = program === 'droplet'
    ? new THREE.Sphere(new THREE.Vector3(0, 110, -35), 240)
    : new THREE.Sphere(new THREE.Vector3(0, 58, 50), 220);
  const pointRange = gl.getContext().getParameter(gl.getContext().ALIASED_POINT_SIZE_RANGE);
  const uniforms = {
    uViewportHeight: { value: 720 },
    // V2 uses thousands of surface lights, not sparse V1 contours. A smaller
    // minimum sprite keeps gaps between beads without changing old programmes.
    uMinPointSize: { value: aiRuntime?.score?.version === 2 ? 3.6 : AI_DRONE_LIGHT_PROFILE.minPixels },
    uMaxPointSize: { value: Math.min(aiParticles ? AI_DRONE_LIGHT_PROFILE.maxPixels : 80, pointRange?.[1] || 64) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: aiParticles ? AI_DRONE_VERTEX_SHADER : DRONE_VERTEX_SHADER,
    fragmentShader: aiParticles ? AI_DRONE_FRAGMENT_SHADER : DRONE_FRAGMENT_SHADER,
    uniforms, transparent: true, blending: aiParticles ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthTest: true, depthWrite: false, toneMapped: false, fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = '4096IndependentLights';
  points.frustumCulled = false;
  points.renderOrder = 4;
  group.add(points);

  // A contour remains a constellation even while it moves. AI gets no line
  // buffers, per-frame trail loop, or trail draw call; legacy shows are unchanged.
  const trailCount = aiParticles ? 0 : Math.ceil(count / TRAIL_STRIDE);
  const trailPositions = new Float32Array(trailCount * 6);
  const trailColors = new Float32Array(trailCount * 6);
  const previous = new Float32Array(trailCount * 3);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3).setUsage(THREE.DynamicDrawUsage));
  const trailMaterial = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.30,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
  });
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial);
  trails.name = 'SubtleFlightTrails';
  trails.frustumCulled = false;
  trails.renderOrder = 3;
  trails.visible = !aiParticles;
  if (!aiParticles) group.add(trails);

  const baseGeometry = new THREE.BoxGeometry(7.8, 0.35, 7.8);
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: '#12262d', metalness: 0.65, roughness: 0.47,
    emissive: '#16343c', emissiveIntensity: 0.08,
  });
  const bases = new THREE.InstancedMesh(baseGeometry, baseMaterial, 4);
  const matrix = new THREE.Matrix4();
  PAD_LOCATIONS.forEach(([x, z], i) => bases.setMatrixAt(i, matrix.makeTranslation(x, 0.285, z)));
  bases.instanceMatrix.needsUpdate = true;
  group.add(bases);
  const padGeometry = createPadGeometry();
  const padUniforms = { uTime: { value: 0 }, uActivity: { value: 0 }, uReducedMotion: { value: 0 } };
  const padMaterial = new THREE.ShaderMaterial({
    vertexShader: PAD_VERTEX_SHADER, fragmentShader: PAD_FRAGMENT_SHADER,
    uniforms: padUniforms, transparent: true, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: false,
  });
  const pads = new THREE.Mesh(padGeometry, padMaterial);
  pads.renderOrder = 2;
  group.add(pads);

  const battle = program === 'droplet' ? createDropletBattleVisual() : null;
  if (battle) group.add(battle.group);
  const spectacle = program === 'ai' && aiRuntime?.program?.sampleVisual === 'spectacle-v2' ? aiRuntime.visualFactory?.(count) : null;
  if (spectacle) group.add(spectacle.group);
  const blackHole = program === 'blackhole' ? createBlackHoleVisual() : null;
  if (blackHole) {
    group.add(blackHole.group);
    points.visible = trails.visible = bases.visible = pads.visible = false;
  }

  let previousTime = NaN;
  const needsFleetUpdate = createFleetUpdateGate();
  return {
    group, fleet, seats,
    // The original website optical passes share the existing WebGL context.
    // Run even on a paused frame so a resize can refresh its render targets.
    render() { return blackHole?.render(gl) ?? false; },
    update(timeMs, reducedMotion, viewportHeight, firstPersonSeatId = null) {
      const safeTime = Number.isFinite(timeMs) ? timeMs : 0;
      // The composer may render below device DPR. Match its actual pixel
      // buffer so adaptive resolution does not enlarge the aircraft lights.
      uniforms.uViewportHeight.value = viewportHeight;
      spectacle?.update(safeTime, reducedMotion, viewportHeight);
      if (!needsFleetUpdate(safeTime, reducedMotion, firstPersonSeatId)) {
        trails.visible = false;
        return false;
      }
      updateDroneProgram(fleet, safeTime, { reducedMotion, program, aiRuntime });
      battle?.update(safeTime, reducedMotion);
      if (blackHole) {
        blackHole.update(safeTime, reducedMotion);
        previousTime = safeTime;
        return true;
      }
      const hiddenIndex=firstPersonSeatId===null?-1:(seats.find(seat=>seat.id===firstPersonSeatId)||seats[0])?.index;
      // The onboard lens must not stare into its own emitter. The trajectory
      // remains untouched and the light is restored by the next fleet update.
      if (hiddenIndex>=0) fleet.sizes[hiddenIndex]=0;
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      const state = sampleDroneProgram(safeTime, program, aiRuntime);
      padUniforms.uTime.value = state.seconds;
      padUniforms.uActivity.value = ['lighting', 'ascent', 'returning', 'landing'].includes(state.phase) ? 1 : 0.18;
      padUniforms.uReducedMotion.value = reducedMotion ? 1 : 0;

      const elapsed = safeTime - previousTime;
      const hasContinuousFrame = elapsed > 0 && elapsed < 220 && !reducedMotion;
      trails.visible = !aiParticles && hasContinuousFrame && state.active;
      const trailLength = hasContinuousFrame ? Math.min(7, 160 / elapsed) : 0;
      for (let i = 0; i < trailCount; i++) {
        const source = Math.min(count - 1, i * TRAIL_STRIDE) * 3;
        const target = i * 6, prior = i * 3;
        const dx = fleet.positions[source] - previous[prior];
        const dy = fleet.positions[source + 1] - previous[prior + 1];
        const dz = fleet.positions[source + 2] - previous[prior + 2];
        const distance = Math.hypot(dx, dy, dz);
        const length = Math.min(trailLength, 2.2 / Math.max(0.0001, distance));
        const strength = hasContinuousFrame && source/3!==hiddenIndex ? Math.min(0.5, distance * 3) : 0;
        for (let axis = 0; axis < 3; axis++) {
          const value = fleet.positions[source + axis];
          trailPositions[target + axis] = value;
          trailPositions[target + 3 + axis] = value - (value - previous[prior + axis]) * length;
          trailColors[target + axis] = fleet.colors[source + axis] * strength;
          trailColors[target + 3 + axis] = 0;
          previous[prior + axis] = value;
        }
      }
      if (trails.visible) {
        trailGeometry.attributes.position.needsUpdate = true;
        trailGeometry.attributes.color.needsUpdate = true;
      }
      previousTime = safeTime;
      return true;
    },
    dispose() {
      battle?.dispose();
      spectacle?.dispose();
      blackHole?.dispose();
      bases.dispose();
      for (const item of [geometry, material, trailGeometry, trailMaterial, baseGeometry, baseMaterial, padGeometry, padMaterial]) item.dispose();
      group.clear();
    },
  };
}

/** A deterministic world-space show. It never moves the player's camera. */
export default function DroneShow({ timeRef = ZERO_TIME, reducedMotion = false, quality = 'high', fleetRef, onSeatsReady, firstPersonSeatId = null, program = 'avatar', aiRuntime }) {
  const host = useRef();
  const visual = useRef();
  const telemetryFrame = useRef(0);
  const gl = useThree(state => state.gl);
  // Keep permanent identities and the legacy quality tiers. The AI compiler's
  // spacing mask, not a second count reduction, determines which lamps are lit.
  const count = quality === 'low' ? Math.min(2048, DRONE_COUNT) : DRONE_COUNT;
  useLayoutEffect(() => {
    const parent = host.current;
    const asset = createDroneVisual(count, gl, program, aiRuntime);
    visual.current = asset;
    if(fleetRef)fleetRef.current=asset.fleet;
    onSeatsReady?.(asset.seats);
    parent.add(asset.group);
    return () => {
      parent.remove(asset.group);
      asset.dispose();
      if (visual.current === asset) visual.current = null;
      if (fleetRef?.current===asset.fleet) fleetRef.current=null;
    };
  }, [count, gl, fleetRef, onSeatsReady, program, aiRuntime]);
  useFrame(state => {
    const measure = Boolean(state.gl.domElement?.dataset) && typeof performance !== 'undefined' && telemetryFrame.current++ % 90 === 0;
    const start = measure ? performance.now() : 0;
    const updated = visual.current?.update(timeRef.current, reducedMotion, state.size.height * getSceneRenderRatio(state.gl),firstPersonSeatId);
    visual.current?.render();
    if (measure) {
      state.gl.domElement.dataset.droneCpuMs = (performance.now() - start).toFixed(3);
      state.gl.domElement.dataset.droneFleetUpdate = updated ? 'sampled' : 'cached';
      state.gl.domElement.dataset.droneProgram = program;
    }
  }, -.2);
  return <group ref={host} name="DroneShow" dispose={null} />;
}

/** Only mount while player camera control is explicitly disabled by the host. */
export function DroneCamera({ timeRef = ZERO_TIME, reducedMotion = false, view = 'cinematic', fleetRef, seatId = '', lookInputRef, recenterRef, telemetryRef, onLookStatus, program = 'avatar', aiRuntime }) {
  const camera = useThree(state => state.camera);
  const look=useRef({yaw:0,pitch:0}),keys=useRef({}),seatsCache=useRef(null);
  const recentered=useRef(recenterRef?.current??0);
  const fpv=view==='fpv'&&!reducedMotion&&getDroneProgram(program,aiRuntime).supportsFpv;
  function stopLook(){keys.current={};if(lookInputRef)lookInputRef.current={};}
  useEffect(()=>{look.current={yaw:0,pitch:0};stopLook();},[view,seatId]);
  useEffect(()=>{
    if(!fpv)return;
    const keydown=event=>{
      if(document.hidden||event.ctrlKey||event.altKey||event.metaKey||event.target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName))return;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)){event.preventDefault();keys.current[event.code]=true;}
    };
    const keyup=event=>{delete keys.current[event.code];};
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',stopLook);document.addEventListener('visibilitychange',stopLook);
    return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',stopLook);document.removeEventListener('visibilitychange',stopLook);stopLook();};
  },[fpv]);
  useLayoutEffect(() => {
    if (!camera.isPerspectiveCamera) return undefined;
    const saved = { fov: camera.fov, far: camera.far, near: camera.near };
    camera.fov = 50;
    camera.far = Math.max(600, camera.far);
    camera.near = 0.1;
    camera.updateProjectionMatrix();
    return () => {
      Object.assign(camera, saved);
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  // A negative priority orders the camera ahead of sky uniforms without taking
  // over R3F's render loop (positive priorities would disable automatic render).
  useFrame((state,delta) => {
    if (!state.camera.isPerspectiveCamera) return;
    const aspect = Math.max(0.25, state.size.width / Math.max(1, state.size.height));
    let pose;
    const fleet=fleetRef?.current;
    if(fpv&&fleet){
      if(seatsCache.current?.fleet!==fleet)seatsCache.current={fleet,seats:selectDroneSeats(fleet)};
      const seat=seatsCache.current.seats.find(item=>item.id===seatId)||seatsCache.current.seats[0];
      if(!seat)return;
      if(recenterRef&&recentered.current!==recenterRef.current){recentered.current=recenterRef.current;look.current={yaw:0,pitch:0};stopLook();}
      const touch=lookInputRef?.current||{},k=keys.current,dt=Math.min(.05,Math.max(0,delta));
      look.current.yaw+=((k.ArrowRight||touch.right?1:0)-(k.ArrowLeft||touch.left?1:0))*dt*.85;
      look.current.pitch=clampLookPitch(look.current.pitch+((k.ArrowUp||touch.up?1:0)-(k.ArrowDown||touch.down?1:0))*dt*.7);
      pose=sampleDroneFirstPerson(fleet,seat.index,{...look.current,aspect,reducedMotion});
      if(telemetryRef&&pose)Object.assign(telemetryRef.current,{altitude:pose.altitude,identity:pose.identity,seatId:seat.id});
    }else pose=program==='ai'&&aiRuntime?aiRuntime.camera(timeRef.current,aspect,reducedMotion):program==='carrier-battle'?sampleCarrierBattleCamera(timeRef.current,aspect,reducedMotion):program==='blackhole'?sampleBlackHoleCamera(timeRef.current,aspect,reducedMotion):program==='droplet'?sampleDropletCamera(timeRef.current,aspect,reducedMotion):sampleDroneCamera(timeRef.current,aspect,reducedMotion);
    if(!pose)return;
    if(state.camera.fov!==pose.fov||state.camera.far!==pose.far||state.camera.near!==pose.near){state.camera.fov=pose.fov;state.camera.far=pose.far;state.camera.near=pose.near;state.camera.updateProjectionMatrix();}
    state.camera.position.set(...pose.position);
    state.camera.lookAt(...pose.target);
    state.camera.updateMatrixWorld();
  }, -0.1);
  return fpv ? <FirstPersonLook enabled active lookRef={look} onStatus={onLookStatus} onStop={stopLook}/> : null;
}
