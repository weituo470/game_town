import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { createStationSystemsModel, updateStationSystemsModel } from './StationSystemsModel.js';

/** Lives OUTSIDE StationWorld. Engineering hardware is already in world XYZ. */
export default function StationSystems({ physicsClock, timeRef }) {
  const mount = useRef(), owned = useRef();
  const { gl, invalidate } = useThree();
  useLayoutEffect(() => {
    // Allocate in committed setup, never during render/useMemo: StrictMode can
    // discard a render, or run setup -> cleanup -> setup with the same refs.
    // Each setup owns a NEW model and each cleanup frees only that exact model.
    const parent = mount.current;
    const model = createStationSystemsModel();
    owned.current = model; parent.add(model);
    updateStationSystemsModel(model, physicsClock?.current ?? 0, timeRef?.current ?? 0);
    const data = gl.domElement.dataset;
    data.stationPressureEnvelope = 'closed-geometric-shell';
    data.stationRoofHeight = String(model.userData.stats.roofHeight);
    data.stationInternalLights = String(model.userData.stats.pointLights);
    data.stationCoreAccess = 'not-open';
    invalidate();
    return () => {
      parent.remove(model);
      model.userData.dispose();
      if (owned.current !== model) return;
      owned.current = null;
      delete data.stationPressureEnvelope; delete data.stationRoofHeight;
      delete data.stationInternalLights; delete data.stationCoreAccess;
    };
  }, [gl, invalidate, physicsClock, timeRef]);
  useFrame(() => {
    updateStationSystemsModel(owned.current, physicsClock?.current ?? 0, timeRef?.current ?? 0);
  });
  return <group ref={mount} name="station engineering systems" userData={{ stationSpace: 'raw' }} dispose={null}/>;
}
