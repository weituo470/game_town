import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { ARCHITECT_PLOTS, ARCHITECT_PALETTES } from '../../../shared/architectPlan.js';
import { createArchitectBuilding, createArchitectResident } from './architectModels.js';
import './architect.css';

function Building({ project, onInspect, reducedMotion }) {
  const plot = ARCHITECT_PLOTS.find(item => item.id === project.plan.plotId);
  const mount = useRef(), elapsed = useRef(0);
  useLayoutEffect(() => {
    const host = mount.current;
    if (!host) return;
    const resource = createArchitectBuilding(project.plan, ARCHITECT_PALETTES[project.plan.palette]);
    host.add(resource.group);
    return () => { host.remove(resource.group); resource.dispose(); };
  }, [project.id]);
  const recentlyBuilt = Date.now() - Number(project.createdAt) < 30000;
  useFrame((_, delta) => {
    if (!mount.current) return;
    elapsed.current = Math.min(1, elapsed.current + Math.min(delta, .1) / 2);
    const progress = !recentlyBuilt || reducedMotion ? 1 : elapsed.current;
    mount.current.scale.y = .02 + .98 * progress * progress * (3 - 2 * progress);
  });
  if (!plot) return null;
  return <group ref={mount} position={[plot.x, .04, plot.z]} rotation={[0, project.plan.orientation * Math.PI / 180, 0]} onClick={event => { event.stopPropagation(); onInspect?.(); }}/>;
}

export default function ArchitectWorld({ projects = [], onInspect, reducedMotion, viewMode }) {
  const residentHost = useRef();
  useLayoutEffect(() => {
    const host = residentHost.current;
    if (!host) return;
    const resource = createArchitectResident();
    host.add(resource.group);
    return () => { host.remove(resource.group); resource.dispose(); };
  }, []);
  return <group name="append-only-engineering-layer">
    {projects.map(project => <Building key={project.id} project={project} onInspect={onInspect} reducedMotion={reducedMotion}/>)}
    <group position={[-6, 0, 23]} rotation={[0, -.35, 0]} onClick={event => { event.stopPropagation(); onInspect?.(); }}>
      <group ref={residentHost}/>
      {['follow', 'first-person'].includes(viewMode) && <Html position={[0, 2.7, 0]} center><button className="architect-map-label" onClick={onInspect}>筑一 · 建筑师 ↗</button></Html>}
    </group>
  </group>;
}
