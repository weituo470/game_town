import { useLayoutEffect, useRef } from 'react';
import { createStationWorldMapper } from './stationWorldGeometry.js';

/** Wrap logical-space scenery only. Players and already mapped ring/sky stay out. */
export default function StationWorld({ children, maxEdge = 2, bendThreshold = 2, ...props }) {
  const group = useRef();
  const mapper = useRef();
  useLayoutEffect(() => {
    const owned = createStationWorldMapper(group.current, { maxEdge, bendThreshold, externalFrame:true, onWarning: message => console.warn(message) });
    mapper.current = owned;
    owned.sync();
    return () => { owned.dispose(); if (mapper.current === owned) mapper.current = null; };
  }, [maxEdge, bendThreshold]);
  // The renderer's updateMatrixWorld runs after every useFrame animation.
  // Html.getWorldPosition also goes through the adapter. Do not take a positive
  // R3F frame priority: that would disable auto-render without a compositor.
  return <group {...props} ref={group} name="station-logical-world">{children}</group>;
}
