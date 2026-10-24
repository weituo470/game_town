import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createStationHabitat } from './StationHabitatModel.js';
import { createRingCityModel } from './RingCityModel.js';
import { stationHeroShot, stationTourShot, stationExteriorShot, stationGravityShot, advanceStationTour } from './stationCamera.js';

export function RingStationHabitat() {
  const habitat = useMemo(createStationHabitat, []);
  useEffect(() => () => habitat.userData.dispose?.(), [habitat]);
  return <primitive object={habitat} dispose={null}/>;
}


// New neighbourhoods remain in logical surface metres. The surrounding
// StationWorld maps their roads, buildings and real hit geometry exactly once.
export function RingCityDistricts() {
  const city = useMemo(createRingCityModel, []);
  const lifetimes = useRef(new WeakMap());
  const { gl } = useThree();
  useEffect(() => {
    // StrictMode replays setup -> cleanup -> setup before the next microtask.
    // Key by model, not one global token: replacing the model must still free
    // the old city's resources while a replay of this city cancels disposal.
    const lifetime = {};
    lifetimes.current.set(city, lifetime);
    const data = gl.domElement.dataset;
    data.ringCityBuildings = String(city.userData.stats.buildings);
    data.ringCityRoads = String(city.userData.stats.roads);
    return () => {
      delete data.ringCityBuildings; delete data.ringCityRoads;
      queueMicrotask(() => {
        if (lifetimes.current.get(city) !== lifetime) return;
        lifetimes.current.delete(city);
        city.userData.dispose?.();
      });
    };
  }, [city, gl]);
  return <primitive object={city} dispose={null}/>;
}

// Own only the explicit station view modes. All cinema/FPV and gameplay camera
// contracts stay independent. Camera.up is restored on *every* exit.
export function RingStationCamera({ viewMode, tourRef, physicsClock, reducedMotion, active }) {
  const { camera, gl } = useThree();
  const look = useRef(new THREE.Vector3());
  const enabled = viewMode === 'station' || viewMode === 'ring-tour' || viewMode === 'station-exterior' || viewMode === 'station-gravity';
  useEffect(() => {
    if (!enabled) return undefined;
    return () => { camera.up.set(0, 1, 0); camera.clearViewOffset(); };
  }, [camera, enabled, viewMode]);
  useFrame((_, delta) => {
    if (!enabled || !camera.isPerspectiveCamera) return;
    const progress = advanceStationTour(tourRef?.current, delta, { active: active && viewMode === 'ring-tour', reducedMotion });
    const shot = viewMode === 'station-exterior' ? stationExteriorShot(physicsClock?.current ?? 0, camera.aspect)
      : viewMode === 'station-gravity' ? stationGravityShot(camera.aspect)
        : viewMode === 'ring-tour' ? stationTourShot(progress, camera.aspect) : stationHeroShot(camera.aspect);
    camera.position.set(...shot.position);
    camera.up.set(...shot.up);
    look.current.set(...shot.target);
    camera.lookAt(look.current);
    camera.clearViewOffset();
    if (camera.fov !== shot.fov || camera.far !== shot.far || camera.zoom !== 1) {
      camera.fov = shot.fov; camera.far = shot.far; camera.zoom = 1;
      camera.updateProjectionMatrix();
    }
    // Small non-private telemetry makes local browser regression checks repeatable.
    gl.domElement.dataset.stationView = viewMode;
    gl.domElement.dataset.stationProgress = String(Math.round(progress * 10000) / 10000);
    gl.domElement.dataset.stationReferenceFrame = shot.referenceFrame || 'co-rotating';
    if (Number.isFinite(shot.phase)) gl.domElement.dataset.stationRotationPhase = String(shot.phase);
    else delete gl.domElement.dataset.stationRotationPhase;
  }, .5);
  useEffect(() => {
    if (!enabled) {
      delete gl.domElement.dataset.stationView; delete gl.domElement.dataset.stationProgress;
      delete gl.domElement.dataset.stationReferenceFrame; delete gl.domElement.dataset.stationRotationPhase;
    }
  }, [enabled, gl]);
  return null;
}
