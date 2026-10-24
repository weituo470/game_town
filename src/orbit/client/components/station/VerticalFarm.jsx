import { useLayoutEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { FARM_RACKS, FARM_SITES, FARM_UTILITIES } from '../../../shared/farmLayout.js';
import { FARM_CROPS } from '../../../shared/farmCrops.js';
import { stationPoseFrame, stationDeltaZ } from '../../../shared/ringStation.js';
import { useFrame, useThree } from '@react-three/fiber';
import { createVerticalFarmModel, updateVerticalFarmModel } from './VerticalFarmModel.js';

/** Must be mounted inside StationWorld. Source resources belong to each
 * committed effect; StrictMode cleanup never disposes a replacement model. */
export default function VerticalFarm({ farmStateRef, playerPoseRef, reducedMotion = false, onOpen }) {
  const mount = useRef(), owned = useRef();
  const { gl, invalidate } = useThree();
  useLayoutEffect(() => {
    const parent = mount.current, model = createVerticalFarmModel();
    owned.current = model; parent.add(model);
    updateVerticalFarmModel(model, farmStateRef?.current);
    gl.domElement.dataset.verticalFarm = 'three-halls-nine-crops-32m';
    invalidate();
    return () => {
      parent.remove(model); model.userData.dispose();
      if (owned.current !== model) return;
      owned.current = null; delete gl.domElement.dataset.verticalFarm;
    };
  }, [gl, invalidate, farmStateRef]);
  useFrame(() => { updateVerticalFarmModel(owned.current, farmStateRef?.current, reducedMotion); });
  const openTerminal = event => {
    const equipmentId = event.object?.userData.parts?.[event.instanceId]?.equipmentId;
    if (!(event.object?.userData.farmTerminal || equipmentId) || !onOpen) return;
    event.stopPropagation(); onOpen(equipmentId || null);
  };
  return <group ref={mount} name="vertical-farm" onClick={openTerminal} dispose={null}><NearbyCropLabel playerPoseRef={playerPoseRef}/></group>;
}

function NearbyCropLabel({ playerPoseRef }) {
  const [nearest, setNearest] = useState(null);
  const last = useRef(0), selected = useRef(null);
  useFrame((_, dt) => {
    last.current += dt; if (last.current < .25) return; last.current = 0;
    const pose = playerPoseRef?.current;
    let match = null, distance = 16;
    if (pose && (pose.y || 0) < 5) for (const rack of FARM_RACKS) {
      const d = Math.hypot(pose.x-rack.x, stationDeltaZ(pose.z,rack.z));
      if (d < distance) { distance = d; match = rack; }
    }
    if (pose && (pose.y || 0) < 5) for (const item of FARM_UTILITIES.filter(u=>['water','cooling','packing','treatment'].includes(u.role))) {
      const d = Math.hypot(pose.x-item.x, stationDeltaZ(pose.z,item.z));
      if (d < distance) { distance = d; match = item; }
    }
    if (selected.current !== match?.id) { selected.current = match?.id; setNearest(match); }
  });
  if (!nearest) return null;
  if (nearest.role) {
    const title={water:'净水缓冲 / 预处理',treatment:'隔离取样与废液接口',cooling:'风、冷凝水与废热接口',packing:'托盘接收 / 称重交接'}[nearest.role];
    const code={water:'TK / F',treatment:'F · 质量隔离',cooling:'HX',packing:'RC / QC'}[nearest.role];
    const at=stationPoseFrame({x:nearest.x+2,y:2.1,z:nearest.z}).position;
    return <group userData={{stationSpace:'raw'}}><Html center position={at} zIndexRange={[5,0]} style={{pointerEvents:'none'}}><div className="farm-crop-label"><strong>{title}</strong><span>H{nearest.hallIndex+1}-{code}</span><span>点击设备查看工艺与联锁</span></div></Html></group>;
  }
  const crop = FARM_CROPS[nearest.cropId], site = FARM_SITES[nearest.hallIndex];
  const at = stationPoseFrame({ x: nearest.x + (nearest.x < -54 ? 4.5 : -4.5), y: 2.1, z: nearest.z }).position;
  return <group userData={{ stationSpace: 'raw' }}><Html center position={at} zIndexRange={[5,0]} style={{pointerEvents:'none'}}><div className="farm-crop-label"><strong>{crop.name}</strong><span>{nearest.id.toUpperCase()} · {site.name} · {nearest.layers} 层</span><span>栽培面积 {nearest.areaM2.toFixed(0)} m²</span><span>独立A/B水肥 · 逐层补光</span><span>点击管线查看设备清单</span></div></Html></group>;
}
