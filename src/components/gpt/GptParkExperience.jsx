import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, Stars } from '@react-three/drei';
import { ArrowLeft, ArrowUpRight, Sun, Moon, Play, Pause, Sparkles, RotateCcw, Move, ChevronRight } from 'lucide-react';
import * as THREE from 'three';
import GptPark from '../town/GptPark.jsx';
import OrbitalSanctum from './OrbitalSanctum.jsx';
import LuminousCitadel from './LuminousCitadel.jsx';
import ParticleTransition from './ParticleTransition.jsx';
import { GPT_ROUND_MS, nextGptDesign, advanceRotation } from './rotation.js';
import { GPT_DESIGNS, gptDesign, designCamera } from './designs.js';
import { GPT_PARK } from '../../../shared/gpt-park.js';
import { CinemaEffects } from '../wonders/WonderPrimitives.jsx';
import { appUrl } from '../../lib/appUrl.js';
import { GPT_VIEWS, gptView, nextGptView } from './tour.js';
import './gpt-experience.css';

class ParkBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() { return this.state.failed ? <div className="gpt-load" role="alert"><h2>暂时无法显示 3D 园区</h2><p>请检查浏览器硬件加速后重试，或返回小镇。</p><button onClick={this.props.onClose}>返回小镇</button></div> : this.props.children; }
}

function CameraRig({ selected, designId, reset, reducedMotion, onInteract }) {
  const controls = useRef(), moving = useRef(true);
  const { camera, size } = useThree();
  const view = useMemo(() => ({ ...gptView(selected), ...designCamera(designId, gptView(selected)) }), [selected, designId]);
  const target = useMemo(() => new THREE.Vector3(...view.target), [view]);
  const position = useMemo(() => {
    const value = new THREE.Vector3(...view.position);
    if (size.width < 700 && ['heart', 'aerial'].includes(selected)) value.sub(target).multiplyScalar(1.4).add(target);
    return value;
  }, [view, size.width, selected, target]);
  useEffect(() => { moving.current = true; }, [selected, designId, reset, position]);
  useFrame((_, dt) => {
    if (!moving.current || !controls.current) return;
    const alpha = reducedMotion ? 1 : 1 - Math.exp(-Math.min(dt, .05) * 3.5);
    camera.position.lerp(position, alpha);
    controls.current.target.lerp(target, alpha);
    controls.current.update();
    if (camera.position.distanceTo(position) < .035 && controls.current.target.distanceTo(target) < .035) moving.current = false;
  });
  return <OrbitControls ref={controls} makeDefault minDistance={5} maxDistance={90} maxPolarAngle={Math.PI * .48} enablePan={false} enableDamping dampingFactor={.08} onStart={() => { moving.current = false; onInteract(); }}/ >;
}

function LightFestival({ start, timeRef, reducedMotion }) {
  const ring = useRef(), dust = useRef();
  const positions = useMemo(() => new Float32Array(Array.from({ length: 300 }, (_, i) => {
    const point = Math.floor(i / 3), angle = point * 2.39996;
    return i % 3 === 0 ? Math.cos(angle) * (6 + point % 8) : i % 3 === 1 ? 2 + (point % 15) * .6 : Math.sin(angle) * (6 + point % 8);
  })), []);
  useFrame(() => {
    const age = (timeRef.current - start) / 1000;
    const active = start >= 0 && age >= 0 && age < 6;
    ring.current.visible = active; dust.current.visible = active;
    if (!active) return;
    const progress = reducedMotion ? .45 : age / 6;
    ring.current.scale.setScalar(1 + progress * 12);
    ring.current.material.opacity = (1 - age / 6) * .75;
    dust.current.rotation.y = reducedMotion ? 0 : age * .18;
    dust.current.position.y = reducedMotion ? 0 : age * .5;
    dust.current.material.opacity = Math.sin(age / 6 * Math.PI);
  });
  return <>
    <mesh ref={ring} position={[0, .3, -1]} rotation={[-Math.PI / 2, 0, 0]} visible={false}><ringGeometry args={[1, 1.08, 96]}/><meshBasicMaterial color="#9fffd4" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide}/></mesh>
    <points ref={dust} visible={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]}/></bufferGeometry><pointsMaterial color="#d4ffe4" size={.14} transparent opacity={0} depthWrite={false}/></points>
  </>;
}

function ParkWorld({ selected, designId, reset, night, paused, reducedMotion, showStart, timeRef, onReady, onInteract, onSelect }) {
  const { gl, size } = useThree(), fps = useRef({ elapsed: 0, frames: 0 });
  const design = gptDesign(designId);
  useEffect(() => { onReady(); }, [onReady]);
  useFrame((_, dt) => {
    if (!paused && !document.hidden) timeRef.current += Math.min(dt, .05) * 1000;
    fps.current.elapsed += dt; fps.current.frames++;
    if (fps.current.elapsed > 2) {
      gl.domElement.dataset.renderFps = String(Math.round(fps.current.frames / fps.current.elapsed));
      fps.current = { elapsed: 0, frames: 0 };
    }
  }, -100);
  return <>
    <color attach="background" args={[night ? design.dark : design.dawn]}/>
    <fog attach="fog" args={[night ? design.dark : design.dawn, 70, 200]}/>
    <Environment files={appUrl('/wonders/coastal-sky.hdr')} environmentIntensity={night ? .5 : .75}/>
    <hemisphereLight args={[night ? '#d1fff0' : '#e8fff1', '#284a44', night ? .8 : 1]}/>
    <directionalLight position={[-22, 35, 15]} color={night ? '#e8fff6' : '#ffedce'} intensity={night ? 2 : 2.3} castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={25} shadow-camera-bottom={-25} shadow-camera-far={100} shadow-bias={-.0003} shadow-normalBias={.06}/>
    <directionalLight position={[18, 12, -18]} color={design.light} intensity={night ? 2 : .7}/>
    <mesh position={[0, -1.5, 0]} rotation={[-Math.PI/2, 0, 0]} receiveShadow><planeGeometry args={[500,500]}/><meshStandardMaterial color={night ? design.sea : '#5e9694'} roughness={.23} metalness={.55}/></mesh>
    {night && <Stars radius={100} depth={40} count={700} factor={2} saturation={0} fade speed={0}/>}
    {designId === 'garden' && <group position={[-GPT_PARK.x, 0, -GPT_PARK.z]}><GptPark timeRef={timeRef} reducedMotion={reducedMotion} viewMode="overview" onSelect={onSelect}/></group>}
    {designId === 'orbit' && <OrbitalSanctum timeRef={timeRef} reducedMotion={reducedMotion} onSelect={onSelect}/>}
    {designId === 'citadel' && <LuminousCitadel timeRef={timeRef} reducedMotion={reducedMotion} onSelect={onSelect}/>}
    <LightFestival start={showStart} timeRef={timeRef} reducedMotion={reducedMotion}/>
    <CameraRig selected={selected} designId={designId} reset={reset} reducedMotion={reducedMotion} onInteract={onInteract}/>
    <CinemaEffects quality={size.width < 700 ? 'balanced' : 'high'}/>
  </>;
}

export default function GptParkExperience({ onClose, onEnterTown, reducedMotion = false }) {
  const [designId, setDesignId] = useState(() => gptDesign(new URLSearchParams(window.location.search).get('scheme')).id);
  const [rotating, setRotating] = useState(!reducedMotion), [remaining, setRemaining] = useState(GPT_ROUND_MS / 1000);
  const [transition, setTransition] = useState(null);
  const [selected, setSelected] = useState('heart'), [night, setNight] = useState(true);
  const [paused, setPaused] = useState(reducedMotion), [auto, setAuto] = useState(false);
  const [reset, setReset] = useState(0), [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [showStart, setShowStart] = useState(-1);
  const root = useRef(), timeRef = useRef(0);
  const activeDesign = useRef(designId), flight = useRef(null), queued = useRef(null), sequence = useRef(0), dwell = useRef(GPT_ROUND_MS);
  const view = gptView(selected);
  const design = gptDesign(designId);
  const selectDesign = useCallback(id => {
    const target = gptDesign(id);
    // One transition at a time; retain only the most recent click during a flight.
    if (flight.current) { queued.current = target.id === flight.current.toId ? null : target.id; return; }
    if (target.id === activeDesign.current) return;
    const next = { token: ++sequence.current, fromId: activeDesign.current, toId: target.id, fromColor: gptDesign(activeDesign.current).accent, toColor: target.accent };
    flight.current = next; setTransition(next); setAuto(false); setShowStart(-1);
    dwell.current = GPT_ROUND_MS; setRemaining(GPT_ROUND_MS / 1000);
  }, []);
  const commitDesign = useCallback(token => {
    const current = flight.current;
    if (!current || current.token !== token || current.committed) return;
    current.committed = true; activeDesign.current = current.toId;
    setDesignId(current.toId); setSelected('heart'); setReset(n => n + 1);
    const url = new URL(window.location.href); url.searchParams.set('scheme', current.toId); history.replaceState(history.state, '', url);
  }, []);
  const completeTransition = useCallback(token => {
    if (flight.current?.token !== token) return;
    commitDesign(token); flight.current = null; setTransition(null);
    const next = queued.current; queued.current = null;
    if (next) selectDesign(next);
  }, [commitDesign, selectDesign]);
  const markReady = useCallback(() => setReady(true), []);
  const markFailed = useCallback(() => setFailed(true), []);
  const interrupt = useCallback(() => { setAuto(false); dwell.current = GPT_ROUND_MS; setRemaining(GPT_ROUND_MS / 1000); }, []);
  const selectView = useCallback(id => { if (flight.current) return; setSelected(gptView(id).id); setReset(n => n + 1); setAuto(false); dwell.current = GPT_ROUND_MS; setRemaining(GPT_ROUND_MS / 1000); }, []);
  useEffect(() => {
    if (!rotating || paused || !ready || failed || transition) return;
    let frame, previous = performance.now(), seconds = Math.ceil(dwell.current / 1000);
    const tick = now => {
      const step = advanceRotation(dwell.current, now - previous, { hidden: document.hidden, transitioning: Boolean(flight.current) });
      previous = now; dwell.current = step.remainingMs;
      const nextSeconds = Math.ceil(step.remainingMs / 1000);
      if (nextSeconds !== seconds) { seconds = nextSeconds; setRemaining(seconds); }
      if (step.advance) { selectDesign(nextGptDesign(activeDesign.current)); return; }
      frame = requestAnimationFrame(tick);
    };
    const visible = () => { previous = performance.now(); };
    document.addEventListener('visibilitychange', visible);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visible); };
  }, [rotating, paused, ready, failed, transition, selectDesign]);
  useEffect(() => { if (reducedMotion) { setRotating(false); setAuto(false); setPaused(true); } }, [reducedMotion]);
  useEffect(() => {
    if (!auto || paused) return;
    const interval = setInterval(() => { if (!document.hidden && !flight.current) setSelected(id => nextGptView(id)); }, 8000);
    return () => clearInterval(interval);
  }, [auto, paused]);
  useEffect(() => {
    const previous = document.activeElement, oldOverflow = document.body.style.overflow, oldTitle = document.title;
    document.body.style.overflow = 'hidden'; document.title = 'GPT 主题园区 · 灵感无限'; root.current?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = [...root.current.querySelectorAll('button:not(:disabled),select')].filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1), outside = !root.current.contains(document.activeElement) || document.activeElement === root.current;
      if (event.shiftKey && (outside || document.activeElement === first)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (outside || document.activeElement === last)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); document.body.style.overflow = oldOverflow; document.title = oldTitle; previous?.focus?.(); };
  }, [onClose]);
  return <section ref={root} tabIndex={-1} className="gpt-experience" data-transitioning={Boolean(transition)} style={{ '--gpt-accent': design.accent, '--gpt-muted': design.muted }} role="dialog" aria-modal="true" aria-labelledby="gpt-title">
    <div className="gpt-stage" aria-label="可拖动环绕、滚轮缩放的 GPT 三维主题园区">
      <ParkBoundary onClose={onClose} onError={markFailed}><Suspense fallback={null}><Canvas shadows dpr={[1,1.5]} camera={{ position: [23,12,29], fov: 45, near: .1, far: 300 }} gl={{ antialias: true, powerPreference: 'high-performance' }}><ParkWorld selected={selected} designId={designId} reset={reset} night={night} paused={paused} reducedMotion={reducedMotion} showStart={showStart} timeRef={timeRef} onReady={markReady} onInteract={interrupt} onSelect={selectView}/></Canvas></Suspense></ParkBoundary>
      {!ready && !failed && <div className="gpt-load" role="status">正在点亮灵感之环…</div>}
      <ParticleTransition transition={transition} reducedMotion={reducedMotion} onCommit={commitDesign} onComplete={completeTransition}/>
    </div>
    <div className="gpt-vignette"/>
    <header className="gpt-top">
      <div className="gpt-brand"><img className="gpt-symbol" src={appUrl('/gpt/openai-blossom.svg')} alt="OpenAI 标志"/><div><span className="gpt-kicker">GPT PARK / PK COLLECTION</span><h1 id="gpt-title">GPT 主题园区</h1></div></div>
      <div className="gpt-top-actions"><span className="gpt-status"><i/>{design.code} 方案 · {night ? '夜景' : '晨光'}</span><button onClick={onClose} aria-label="返回小镇"><ArrowLeft size={18}/>返回小镇</button></div>
    </header>
    <nav className="gpt-designs" aria-label="PK 园区方案">{GPT_DESIGNS.map(item => <button key={item.id} aria-pressed={designId === item.id} onClick={() => selectDesign(item.id)}><span>{item.code}</span>{item.name}</button>)}</nav>
    <div className="gpt-choice gpt-rotation"><button aria-pressed={rotating} onClick={() => { setRotating(v => !v); if (!rotating) { setAuto(false); setPaused(false); } }}>{rotating ? <Pause size={18}/> : <Play size={18}/>}{rotating ? '暂停轮换' : '开始轮流出战'}</button><span>{transition ? `星尘转场 · ${gptDesign(transition.toId).name}` : rotating ? `${paused ? '动态已暂停' : `${remaining} 秒后`} · 下一站 ${gptDesign(nextGptDesign(designId)).name}` : 'A → B → C · 三园轮流出战'}</span><div className="gpt-round-track" aria-hidden="true"><i style={{ width: `${(1 - remaining * 1000 / GPT_ROUND_MS) * 100}%` }}/></div></div>
    <div className="gpt-caption" aria-live="polite"><span className="gpt-kicker">{design.code} / {selected === 'heart' ? design.en : view.en}</span><h2>{selected === 'heart' ? design.name : view.name}<span> / </span></h2><p>{selected === 'heart' ? design.tagline : view.description}</p><button className="gpt-festival" onClick={() => { setShowStart(timeRef.current); setPaused(false); }}><Sparkles size={18}/>点亮灵感<ArrowUpRight size={18}/></button></div>
    <aside className="gpt-tools" aria-label="园区观景控制">
      <button aria-pressed={!night} onClick={() => setNight(v => !v)}>{night ? <Sun size={19}/> : <Moon size={19}/>}<span>{night ? '切换晨光' : '切换夜景'}</span></button>
      <button aria-pressed={auto} onClick={() => { setAuto(!auto); if (!auto) { setPaused(false); setRotating(false); } }}><Play size={19}/><span>{auto ? '停止导览' : '景点导览'}</span></button>
      <button aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? <Play size={19}/> : <Pause size={19}/>}<span>{paused ? '继续动态' : '暂停动态'}</span></button>
      <button onClick={() => { setReset(n => n + 1); setAuto(false); }}><RotateCcw size={19}/><span>重置镜头</span></button>
    </aside>
    <footer className="gpt-bottom">
      <div className="gpt-bottom-line"><span className="gpt-instruction"><Move size={16}/>拖动环绕 · 滚轮 / 双指缩放</span><span className="gpt-disclaimer">{designId !== 'garden' && '候选观景方案 · '}原创致敬 · 非官方园区</span></div>
      <nav className="gpt-destinations" aria-label="GPT 园区景点">{GPT_VIEWS.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => selectView(item.id)}><span>{item.number}</span>{item.name}{selected === item.id && <ChevronRight size={16}/>}</button>)}</nav>
      <div className="gpt-mobile-select"><label htmlFor="gpt-view">探索景点</label><select id="gpt-view" value={selected} onChange={event => selectView(event.target.value)}>{GPT_VIEWS.map(item => <option key={item.id} value={item.id}>{item.number} · {item.name}</option>)}</select></div>
      {onEnterTown && <button className="gpt-walk" onClick={onEnterTown}>{designId === 'garden' ? '走进园区' : '返回已建园区'}<ArrowUpRight size={18}/></button>}
    </footer>
  </section>;
}
