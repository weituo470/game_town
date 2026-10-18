import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { ArrowLeft, Play, Pause, RotateCcw, Sparkles, Volume2, VolumeX, Move, Camera } from 'lucide-react';
import * as THREE from 'three';
import { CinemaEffects } from './WonderPrimitives.jsx';
import { CINEMA_SCENES, CINEMA_DURATION, advanceCinema, cinemaPhase, safeCinemaTime } from './cinemaTimeline.js';
import { appUrl } from '../../lib/appUrl.js';
import './wonder-cinema.css';

const SCENES = {
  orca: React.lazy(() => import('./OrcaExperience.jsx')),
  carrier: React.lazy(() => import('./CarrierExperience.jsx')),
  rocket: React.lazy(() => import('./RocketExperience.jsx')),
};
const ORBIT_TARGET = { orca: [0, 1, 0], carrier: [0, 20, 0], rocket: [0, 36, 0] };
class CinemaBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="cinema-load" role="alert"><h2>场景未能加载</h2><p>请返回小镇重试，或切换均衡画质。其他玩法不受影响。</p></div> : this.props.children; }
}
function World({ id, timeRef, pausedRef, reducedMotion, cameraMode, quality, onReady, uiTime, paused }) {
  const Scene = SCENES[id], { gl, invalidate } = useThree();
  const fps = useRef({ elapsed: 0, frames: 0 });
  useEffect(() => { onReady(); invalidate(); }, [onReady, invalidate]);
  useEffect(() => { invalidate(); }, [uiTime, paused, reducedMotion, cameraMode, quality, invalidate]);
  useFrame((_, dt) => {
    timeRef.current = advanceCinema(timeRef.current, dt, pausedRef.current, document.hidden);
    fps.current.elapsed += dt; fps.current.frames++;
    if (fps.current.elapsed > 2) {
      gl.domElement.dataset.renderFps = String(Math.round(fps.current.frames / fps.current.elapsed));
      fps.current = { elapsed: 0, frames: 0 };
    }
  }, -100);
  const scale = id === 'orca' ? 1 : 10;
  return <>
    <Environment files={appUrl('/wonders/coastal-sky.hdr')} background backgroundIntensity={.85} environmentIntensity={.85} backgroundRotation={[0, .5, 0]} environmentRotation={[0, .5, 0]}/>
    <fog attach="fog" args={['#a0b8bd', 180 * scale, 680 * scale]}/>
    <hemisphereLight args={['#bce3ff', '#4b5149', 1.05]}/>
    <directionalLight position={[-45 * scale, 60 * scale, -45 * scale]} intensity={3.2} color="#ffe6c1" castShadow shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]} shadow-bias={-.00015} shadow-normalBias={.08 * scale} shadow-camera-left={-38 * scale} shadow-camera-right={38 * scale} shadow-camera-top={65 * scale} shadow-camera-bottom={-38 * scale} shadow-camera-far={240 * scale}/>
    <directionalLight position={[20 * scale, 15 * scale, 45 * scale]} intensity={.7} color="#a9d5ec"/>
    <Scene timeRef={timeRef} reducedMotion={reducedMotion} cameraMode={cameraMode} quality={quality}/>
    {cameraMode === 'free' && <OrbitControls makeDefault target={ORBIT_TARGET[id]} minDistance={id === 'orca' ? 5 : 30} maxDistance={id === 'orca' ? 85 : 1000} maxPolarAngle={Math.PI * .48} enableDamping dampingFactor={.07}/>}
    <CinemaEffects quality={quality}/>
  </>;
}

// User-initiated local synthesized ambience. No autoplay or remote audio/API.
function useAmbience(id, timeRef, paused) {
  const [enabled, setEnabled] = useState(false), audio = useRef(null);
  const stop = useCallback(() => { const previous = audio.current; audio.current = null; previous?.ctx.close().catch(() => {}); setEnabled(false); }, []);
  useEffect(() => stop, [id, stop]);
  useEffect(() => { if (!enabled) return; const tick = setInterval(() => {
    const a = audio.current; if (!a) return;
    const t = timeRef.current, active = !paused;
    const roar = id === 'rocket' ? (t < 8 ? .035 : t < 45 ? .22 : .08) : id === 'carrier' ? (t > 7 && t < 25 ? .19 : .055) : .045;
    a.gain.gain.setTargetAtTime(active ? roar : 0, a.ctx.currentTime, .25);
    a.filter.frequency.setTargetAtTime(id === 'orca' ? 600 : id === 'rocket' ? 140 : 650, a.ctx.currentTime, .3);
  }, 120); return () => clearInterval(tick); }, [enabled, paused, id, timeRef]);
  const toggle = async () => {
    if (enabled) { stop(); return; }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext(); audio.current = { ctx };
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), data = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < data.length; i++) { previous = (previous + (Math.random() * 2 - 1) * .04) / 1.02; data[i] = previous * 3.5; }
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = buffer; source.loop = true; filter.type = 'lowpass'; filter.frequency.value = 400; gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(ctx.destination); source.start();
      audio.current = { ctx, gain, filter }; await ctx.resume(); setEnabled(true);
    } catch { stop(); }
  };
  return [enabled, toggle];
}

export default function WonderCinema({ initialId = 'orca', onClose, reducedMotion: initialReduced = false }) {
  const [id, setId] = useState(SCENES[initialId] ? initialId : 'orca');
  const [paused, setPaused] = useState(initialReduced), [reducedMotion, setReducedMotion] = useState(initialReduced);
  const [cameraMode, setCameraMode] = useState('director'), [quality, setQuality] = useState(() => window.innerWidth < 700 ? 'balanced' : 'high');
  const [ready, setReady] = useState(false), [time, setTime] = useState(0);
  const timeRef = useRef(0), pausedRef = useRef(paused), rootRef = useRef(null);
  pausedRef.current = paused;
  const scene = CINEMA_SCENES.find(s => s.id === id), phase = cinemaPhase(id, time);
  const [sound, toggleSound] = useAmbience(id, timeRef, paused);
  const markReady = useCallback(() => setReady(true), []);
  useEffect(() => { const interval = setInterval(() => { setTime(timeRef.current); if (timeRef.current >= CINEMA_DURATION) setPaused(true); }, 100); return () => clearInterval(interval); }, []);
  const seek = value => { timeRef.current = safeCinemaTime(value); setTime(timeRef.current); };
  const changeScene = value => { if (value === id) return; setId(value); seek(0); setReady(false); setCameraMode('director'); setPaused(reducedMotion); };
  useEffect(() => {
    const previous = document.activeElement, oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; rootRef.current?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...rootRef.current.querySelectorAll('button:not([disabled]),input,select')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1), outside = !rootRef.current.contains(document.activeElement);
      if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === rootRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (outside || document.activeElement === last || document.activeElement === rootRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keyboard); previous?.focus?.(); };
  }, [onClose]);
  return <section className={`wonder-cinema cinema-${id}`} role="dialog" aria-modal="true" aria-label="三大奇观沉浸体验" ref={rootRef} tabIndex={-1}>
    <div className="cinema-stage" role="img" aria-label={`${scene.title}，实时三维场景，当前${phase}。可以暂停、选择演出时间或自由环视。`}>
      <CinemaBoundary key={quality}>
        <Canvas shadows frameloop={paused ? 'demand' : 'always'} dpr={quality === 'high' ? [1, 1.75] : [1, 1.25]} camera={{ fov: 48, position: [24, 12, 30], near: .1, far: 6000 }} gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: .95 }}>
          <Suspense fallback={null}><World key={id} id={id} uiTime={time} paused={paused} timeRef={timeRef} pausedRef={pausedRef} reducedMotion={reducedMotion} cameraMode={cameraMode} quality={quality} onReady={markReady}/></Suspense>
        </Canvas>
      </CinemaBoundary>
    </div>
    {!ready && <div className="cinema-load" role="status"><span className="cinema-spinner"/><p>正在进入奇观现场…</p></div>}
    <div className="cinema-shade" aria-hidden="true"/>
    <header className="cinema-top"><button onClick={onClose} className="cinema-back"><ArrowLeft size={20}/>返回小镇</button><nav aria-label="选择奇观">{CINEMA_SCENES.map((item, i) => <button key={item.id} onClick={() => changeScene(item.id)} aria-pressed={id === item.id}><span>0{i + 1}</span>{['虎鲸湾', '航母港', '发射场'][i]}</button>)}</nav><span className="cinema-brand">PLAYTOWN / WONDERS</span></header>
    <div className="cinema-heading"><span className="cinema-eyebrow">{scene.chapter} <i/> REALTIME 3D</span><h1>{scene.title}</h1><p>{scene.subtitle}</p></div>
    <div className="cinema-state"><span className="cinema-live-dot"/><span>{reducedMotion ? '静态观赏' : paused ? '已暂停' : '正在上演'} / {phase}</span></div>
    <footer className="cinema-bottom">
      <div className="cinema-director"><span>{cameraMode === 'director' ? '导演镜头' : '拖动画面环视 · 滚轮缩放'}</span><button onClick={() => { seek(scene.cue); setPaused(false); setReducedMotion(false); setCameraMode('director'); }}><Sparkles size={18}/>{scene.cueLabel}</button></div>
      <div className="cinema-playline"><button className="cinema-play" aria-label={paused ? '播放演出' : '暂停演出'} onClick={() => { if (time >= 60) seek(0); setReducedMotion(false); setPaused(!paused); }}>{paused ? <Play size={21}/> : <Pause size={21}/>}</button><button aria-label="重播演出" onClick={() => { seek(0); setPaused(false); setReducedMotion(false); setCameraMode('director'); }}><RotateCcw size={19}/></button><label className="cinema-scrub"><span className="sr-only">演出时间</span><input type="range" aria-label="演出时间" min="0" max="60" step="0.1" value={time} onChange={e => seek(Number(e.target.value))}/></label><output className="cinema-time">{String(Math.floor(time)).padStart(2, '0')} / 60s</output></div>
      <div className="cinema-options"><span className="cinema-caption">独立观赏 · 不改变同房演出</span><div><button aria-pressed={cameraMode === 'free'} onClick={() => setCameraMode(m => m === 'free' ? 'director' : 'free')}>{cameraMode === 'free' ? <Camera size={18}/> : <Move size={18}/>}<span>{cameraMode === 'free' ? '导演镜头' : '自由环视'}</span></button><button aria-pressed={sound} onClick={toggleSound}>{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>}<span>环境音</span></button><label className="cinema-quality"><span className="sr-only">画面质量</span><select aria-label="画面质量" value={quality} onChange={e => setQuality(e.target.value)}><option value="high">高画质</option><option value="balanced">均衡</option></select></label><label className="cinema-still"><input type="checkbox" checked={reducedMotion} onChange={e => { setReducedMotion(e.target.checked); setPaused(e.target.checked); }}/><span>减少动态</span></label></div></div>
    </footer>
  </section>;
}
