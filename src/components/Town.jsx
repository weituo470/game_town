import { Suspense, lazy, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, PerspectiveCamera, RoundedBox } from '@react-three/drei';
import DuskScenery from './DuskScenery';
import PlayerController from './town/PlayerController';
import SceneEffects, { GardenFireflies } from './town/SceneEffects';
import SoftPenumbra from './town/SoftPenumbra';
import TownResidents from './town/characters/Residents';
import LandmarkFountain from './town/landmarks/LandmarkFountain.jsx';
import TownSky from './town/TownSky.jsx';
import TownEnvironment from './town/TownEnvironment.jsx';
import WonderIslands from './town/WonderIslands.jsx';
import GptPark from './town/GptPark.jsx';
import GeneratedPlayerModel from './town/GeneratedPlayerModel.jsx';
import OutdoorScenery from './town/OutdoorScenery.jsx';
import JetpackRig from './town/JetpackRig.jsx';
import DroneShow, { DroneCamera } from './drone/DroneShow.jsx';
import AmbientBlackHole from './town/AmbientBlackHole.jsx';
import { FOUNTAIN } from '../../shared/world.js';
import './town.css';
const CarrierBattleScene = lazy(() => import('./drone/CarrierBattleScene.jsx'));
// The distant island must not block the first playable town frame or inflate
// the startup bundle. Its world/collision contract stays eagerly available.
const DeepSeekPark = lazy(() => import('./town/DeepSeekPark.jsx'));

function Box({ position, size, color, radius = 0, ...props }) {
  const safeRadius = Math.min(radius, Math.min(...size) / 2 - 0.001);
  if (safeRadius > 0) return <RoundedBox position={position} args={size} radius={safeRadius} smoothness={2} castShadow receiveShadow {...props}><meshStandardMaterial color={color} roughness={0.9} /></RoundedBox>;
  return <mesh position={position} castShadow receiveShadow {...props}><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>;
}

function Sphere({ position, size = 1, color, scale, ...props }) {
  return <mesh position={position} scale={scale} castShadow {...props}><sphereGeometry args={[size, 12, 10]} /><meshStandardMaterial color={color} roughness={0.85} /></mesh>;
}

function Cylinder({ position, radius = 0.2, topRadius, height = 1, color, segments = 12, ...props }) {
  return <mesh position={position} castShadow receiveShadow {...props}><cylinderGeometry args={[topRadius ?? radius, radius, height, segments]} /><meshStandardMaterial color={color} roughness={0.9} /></mesh>;
}

function AvatarVisual({ poseRef, reducedMotion, name = '', color = '#ec815d', self = false, bodyVisible = true }) {
  const player = useRef();
  const body = useRef();
  const leftLeg = useRef();
  const rightLeg = useRef();
  const leftArm = useRef();
  const rightArm = useRef();
  const groundRing = useRef();
  const walkTime = useRef(0);

  useFrame((_, frameDelta) => {
    const pose = poseRef.current;
    const moving = !!pose.moving;
    const height = Number.isFinite(pose.y) ? Math.max(0, pose.y) : 0;
    const airborne = height > 0.015;
    if (moving) walkTime.current += Math.min(frameDelta, 0.04) * 12;
    if (player.current) {
      player.current.position.set(pose.x, height, pose.z);
      player.current.rotation.y = pose.yaw;
    }
    const swing = moving && !airborne && !reducedMotion ? Math.sin(walkTime.current) * 0.52 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = airborne ? -0.28 : swing;
    if (rightLeg.current) rightLeg.current.rotation.x = airborne ? 0.28 : -swing;
    if (leftArm.current) leftArm.current.rotation.x = pose.activity === 'fishing' ? -0.7 : airborne ? -0.7 : -swing * 0.8;
    if (rightArm.current) rightArm.current.rotation.x = pose.activity === 'fishing' ? pose.fishingPhase === 'casting' ? -0.5-Math.sin(Math.min(1,pose.fishingTime/0.65)*Math.PI)*0.8 : -0.85 : airborne ? -0.7 : swing * 0.8;
    if (body.current) body.current.position.y = moving && !airborne && !reducedMotion ? Math.abs(Math.sin(walkTime.current)) * 0.045 : 0;
    if (groundRing.current) {
      groundRing.current.position.y = 0.09 - height;
      groundRing.current.material.opacity = Math.max(0.4, 0.85 - height * 0.2);
    }
  });

  return <group ref={player} position={[poseRef.current.x, 0, poseRef.current.z]}>
    <JetpackRig poseRef={poseRef} reducedMotion={reducedMotion}/>
    <mesh ref={groundRing} position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.43, 0.5, 32]} /><meshBasicMaterial color={self ? '#fff9e8' : color} transparent opacity={0.85} /></mesh>
    {bodyVisible && <group ref={body}>
      <group ref={leftLeg} position={[-0.17, 0.63, 0]}>
        <Box position={[0, -0.2, 0]} size={[0.24, 0.46, 0.28]} color="#526a68" radius={0.07} />
        <Box position={[0, -0.43, 0.08]} size={[0.28, 0.18, 0.42]} color="#fff1d3" radius={0.06} />
      </group>
      <group ref={rightLeg} position={[0.17, 0.63, 0]}>
        <Box position={[0, -0.2, 0]} size={[0.24, 0.46, 0.28]} color="#526a68" radius={0.07} />
        <Box position={[0, -0.43, 0.08]} size={[0.28, 0.18, 0.42]} color="#fff1d3" radius={0.06} />
      </group>
      <Box position={[0, 0.97, 0]} size={[0.7, 0.75, 0.4]} color={color} radius={0.17} />
      <Box position={[0, 1.1, -0.3]} size={[0.44, 0.54, 0.25]} color="#d4ab68" radius={0.09} />
      <Box position={[0, 1.02, -0.45]} size={[0.32, 0.2, 0.06]} color="#e7c187" radius={0.03} />
      <group ref={leftArm} position={[-0.43, 1.2, 0]}>
        <Box position={[0, -0.12, 0]} size={[0.22, 0.35, 0.26]} color={color} radius={0.07} />
        <Sphere position={[0, -0.36, 0]} size={0.12} color="#f5cfac" scale={[0.9, 1.4, 0.9]} />
      </group>
      <group ref={rightArm} position={[0.43, 1.2, 0]}>
        <Box position={[0, -0.12, 0]} size={[0.22, 0.35, 0.26]} color={color} radius={0.07} />
        <Sphere position={[0, -0.36, 0]} size={0.12} color="#f5cfac" scale={[0.9, 1.4, 0.9]} />
      </group>
      <Cylinder position={[0, 1.4, 0]} radius={0.13} height={0.2} color="#efc5a1" />
      <Sphere position={[0, 1.74, 0.02]} size={0.38} scale={[1, 1.06, 0.92]} color="#f4c9a6" />
      <Sphere position={[0, 1.94, -0.06]} size={0.36} scale={[1.05, 0.65, 1]} color="#574638" />
      <Sphere position={[-0.2, 1.84, 0.2]} size={0.2} scale={[1, 0.65, 0.55]} color="#574638" />
      <Sphere position={[-0.35, 1.71, 0]} size={0.09} color="#f4c9a6" />
      <Sphere position={[0.35, 1.71, 0]} size={0.09} color="#f4c9a6" />
      <Sphere position={[-0.13, 1.74, 0.34]} size={0.04} scale={[0.85, 1.1, 0.65]} color="#4d4239" />
      <Sphere position={[0.13, 1.74, 0.34]} size={0.04} scale={[0.85, 1.1, 0.65]} color="#4d4239" />
      <Sphere position={[0, 1.63, 0.37]} size={0.055} scale={[1, 0.5, 0.5]} color="#dc967e" />
    </group>}
    {name && <Html center position={[0, 2.65, 0]} zIndexRange={[6, 0]} className="town-label-anchor" style={{ pointerEvents: 'none' }}>
      <div className={`town-player-name ${self ? 'is-self' : 'is-remote'}`} role="img" aria-label={self ? `${name} · 你` : name} title={name}>
        <span className="town-player-color" style={{ backgroundColor: color }} aria-hidden="true" />
        <span>{name}{self ? ' · 你' : ''}</span>
      </div>
    </Html>}
  </group>;
}

const LocalCharacterContext = createContext(null);

function LocalGeneratedActor({ asset, onStatus, ...props }) {
  const [modelState, setModelState] = useState('loading');
  const reportStatus = useCallback(status => {
    setModelState(status.state);
    onStatus?.(status);
  }, [onStatus]);
  return <>
    {/* The existing name and ground ring remain, including during a jump. */}
    <AvatarVisual {...props} bodyVisible={modelState !== 'ready'} />
    <GeneratedPlayerModel asset={asset} poseRef={props.poseRef} reducedMotion={props.reducedMotion} fallback={null} onStatus={reportStatus} />
  </>;
}

// PlayerController shares this stable component with remote players. A private
// generated character must never leak into their appearance or room messages.
function PlayerModel(props) {
  const character = useContext(LocalCharacterContext);
  if (!props.self || !character?.asset) return <AvatarVisual {...props} />;
  return <LocalGeneratedActor key={character.key} {...props} asset={character.asset} onStatus={character.onStatus} />;
}

function Scene({ onReady, ...props }) {
  const ready = useRef(onReady);
  const readyFrames = useRef(0);
  const playerPoseRef = useRef(null);
  const droneFleetRef = useRef(null);
  const carrierBattle = props.viewMode === 'drone' && props.droneFpv?.program === 'carrier-battle';
  // A deep-linked show starts after a real scene frame, not while materials
  // are compiling. Slow first loads must not silently skip the opening beat.
  useFrame(() => { if (++readyFrames.current === 2) ready.current?.(); });
  return <>
    {!props.outdoorSelected && ['follow', 'first-person', 'wonder', 'drone'].includes(props.viewMode) && <PerspectiveCamera makeDefault fov={58} near={0.08} far={420} position={[0, 2.3, 15.1]} />}
    <TownSky timeRef={props.timeRef} reducedMotion={props.reducedMotion} viewMode={props.viewMode} playerPoseRef={playerPoseRef} outdoorSelected={props.outdoorSelected} />
    <Suspense fallback={null}><TownEnvironment timeRef={props.timeRef}/></Suspense>
    <DuskScenery timeRef={props.timeRef} reducedMotion={props.reducedMotion} completedIds={props.completedIds} overview={props.viewMode !== 'follow'} />
    <LandmarkFountain position={[FOUNTAIN.x, 0, FOUNTAIN.z]} reducedMotion={props.reducedMotion} />
    <WonderIslands timeRef={props.npcTimeRef} battleTimeRef={carrierBattle ? props.droneTimeRef : null} lightTimeRef={props.timeRef} reducedMotion={props.reducedMotion} playerPoseRef={playerPoseRef} onNearestWonder={props.onNearestWonder} viewMode={props.viewMode}/>
    <GptPark timeRef={props.npcTimeRef} reducedMotion={props.reducedMotion} viewMode={props.viewMode} onSelect={props.active?props.onGptSelect:undefined}/>
    <Suspense fallback={null}><DeepSeekPark timeRef={props.npcTimeRef} reducedMotion={props.reducedMotion} onSelect={props.active ? props.onDeepSeekSelect : undefined}/></Suspense>
    <SoftPenumbra size={18} samples={8} focus={0.4} />
    <GardenFireflies timeRef={props.timeRef} reducedMotion={props.reducedMotion} />
    <OutdoorScenery runtimeRef={props.outdoorRef} onStart={props.onOutdoorStart} playing={props.outdoorSelected} active={props.active} reducedMotion={props.reducedMotion}/>
    <TownResidents reducedMotion={props.reducedMotion} onInspect={props.onInspectResidents} timeRef={props.npcTimeRef} playerPoseRef={playerPoseRef} onNearestNpc={props.onNearestNpc} nearestNpcId={props.nearestNpcId} viewMode={props.viewMode} active={props.active && !props.outdoorSelected} />
    <PlayerController Model={PlayerModel} {...props} playerPoseRef={playerPoseRef} />
    {carrierBattle ? <Suspense fallback={null}><CarrierBattleScene timeRef={props.droneTimeRef} reducedMotion={props.reducedMotion}/></Suspense> : <DroneShow aiRuntime={props.viewMode === 'drone' ? props.droneFpv?.aiRuntime : undefined} program={props.viewMode === 'drone' ? props.droneFpv?.program || 'avatar' : 'avatar'} timeRef={props.droneTimeRef || props.npcTimeRef} reducedMotion={props.reducedMotion} fleetRef={droneFleetRef} onSeatsReady={props.droneFpv?.onSeatsReady} firstPersonSeatId={props.viewMode==='drone'&&props.droneFpv?.view==='fpv'&&!props.reducedMotion?props.droneFpv?.seatId??'':null}/>}
    {props.viewMode === 'drone' && <DroneCamera timeRef={props.droneTimeRef} reducedMotion={props.reducedMotion} fleetRef={droneFleetRef} {...props.droneFpv}/>}
    <AmbientBlackHole enabled={props.active && !props.outdoorSelected && ['overview', 'follow', 'first-person'].includes(props.viewMode)} timeRef={props.timeRef} reducedMotion={props.reducedMotion} onAppearance={props.onSkyAppearance} />
    <SceneEffects performanceMode={props.viewMode === 'drone' ? 'drone' : 'town'} faithfulBlackHole={props.viewMode === 'drone' && props.droneFpv?.program === 'blackhole'} />
  </>;
}

export default function Town({ suspended = false, active = true, inputRef, destination = null, onNearest, onReady, reducedMotion = false, completedIds = [], network = null, onInspectResidents, viewMode = 'overview', onStartExploring, onLookStatus, timeRef, npcTimeRef, droneTimeRef, droneFpv, onNearestNpc, nearestNpcId, characterAsset = null, onNearestWonder, outdoorRef, outdoorSelected, onOutdoorStart, onNearestOutdoor, flightRef, onFlyingChange, onGptSelect, onDeepSeekSelect, onSkyAppearance }) {
  const [characterStatus, setCharacterStatus] = useState(null);
  const characterKey = characterAsset ? `${characterAsset.modelUrl}|${characterAsset.walkingUrl}|${characterAsset.facing}` : '';
  const localCharacter = useMemo(() => ({ asset: characterAsset, key: characterKey, onStatus: status => setCharacterStatus({ ...status, key: characterKey }) }), [characterAsset, characterKey]);
  const modelState = characterStatus?.key === characterKey ? characterStatus.state : 'loading';
  const showCharacterStatus = characterAsset && ['loading', 'error'].includes(modelState);
  return <><div className="town-canvas" role="img" aria-label="可探索的 3D 游戏小镇，地图长宽扩大三倍。十字主街连接中央大喷泉，环街和支路通往四个新区、待建空地及气球靶场、鬼屋探险、节奏舞台和机关工坊。西侧虎鲸湾、东侧航母港与北侧火箭发射场用步桥连接，可从奇观时刻表前往。西北方 DeepSeek 蓝鲸岛与东北方 GPT 园区同样可步行和飞行到达。16 位居民会在街区活动，靠近按 F 交流。使用方向键开始跟随探索，或查看全镇总览。">
    <Canvas orthographic shadows frameloop={!suspended && (active || viewMode === 'drone' || network?.status === 'connected') ? 'always' : 'demand'} dpr={[1, 1.5]} camera={{ position: [72, 90, 102], zoom: 6, near: 0.1, far: 420 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
      <LocalCharacterContext.Provider value={localCharacter}>
      <Scene active={active} inputRef={inputRef} destination={destination} onNearest={onNearest} onReady={onReady} reducedMotion={reducedMotion} completedIds={completedIds} network={network} onInspectResidents={onInspectResidents} viewMode={viewMode} onStartExploring={onStartExploring} onLookStatus={onLookStatus} timeRef={timeRef} npcTimeRef={npcTimeRef} droneTimeRef={droneTimeRef} droneFpv={droneFpv} onNearestNpc={onNearestNpc} nearestNpcId={nearestNpcId} onNearestWonder={onNearestWonder} outdoorRef={outdoorRef} outdoorSelected={outdoorSelected} onOutdoorStart={onOutdoorStart} onNearestOutdoor={onNearestOutdoor} flightRef={flightRef} onFlyingChange={onFlyingChange} onGptSelect={onGptSelect} onDeepSeekSelect={onDeepSeekSelect} onSkyAppearance={onSkyAppearance}/>
      </LocalCharacterContext.Provider>
    </Canvas>
  </div>{showCharacterStatus && <p className={`generated-character-status ${modelState === 'error' ? 'is-error' : ''}`} role="status">{modelState === 'error' ? '3D 角色未能加载，暂用默认人物。请在“我的角色”中重新预览。' : '正在加载 3D 角色，暂用默认人物…'}</p>}</>;
}
