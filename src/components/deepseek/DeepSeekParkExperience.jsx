import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, ArrowUpRight, Moon, Sun, Pause, Play } from 'lucide-react';
import DeepSeekPark from '../town/DeepSeekPark.jsx';
import { DEEPSEEK_VIEWS, deepSeekView } from './tour.js';
import './deepseek-experience.css';

export function CameraTour({ selected, reducedMotion }) {
  const controls = useRef(), moving = useRef(true);
  const { camera, size } = useThree();
  const view = deepSeekView(selected);
  const target = useMemo(() => new THREE.Vector3(...view.target).add(new THREE.Vector3(0, -.335, 0)), [view]);
  const position = useMemo(() => {
    const eye = new THREE.Vector3(...view.position).add(new THREE.Vector3(0, -.335, 0));
    if (size.width < 700) eye.sub(target).multiplyScalar(1.25).add(target);
    return eye;
  }, [view, target, size.width]);
  useEffect(() => { moving.current = true; }, [position]);
  useFrame((_, delta) => {
    if (!moving.current || !controls.current) return;
    const alpha = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .05) * 4);
    camera.position.lerp(position, alpha);
    controls.current.target.lerp(target, alpha);
    controls.current.update();
    if (camera.position.distanceTo(position) < .04 && controls.current.target.distanceTo(target) < .04) moving.current = false;
  });
  return <OrbitControls ref={controls} makeDefault minDistance={12} maxDistance={230} maxPolarAngle={Math.PI * .485} enablePan={false} enableDamping dampingFactor={.08} onStart={() => { moving.current = false; }}/ >;
}

export function ParkClock({ timeRef, paused, reducedMotion }) {
  useFrame((_, delta) => {
    if (!paused && !reducedMotion && !document.hidden) timeRef.current += Math.min(Math.max(delta, 0), .05) * 1000;
  }, -100);
  return null;
}

export default function DeepSeekParkExperience({ onClose, onEnterTown, reducedMotion = false }) {
  const root = useRef(null), [selected, setSelected] = useState('whale'), [night, setNight] = useState(true), [paused, setPaused] = useState(reducedMotion);
  const timeRef = useRef(0);
  useEffect(() => {
    const previous = document.activeElement, oldOverflow = document.body.style.overflow, title = document.title;
    document.body.style.overflow = 'hidden'; document.title = 'DeepSeek 主题园区 · 深度求索'; root.current?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const buttons = [...root.current.querySelectorAll('button:not([disabled]),select')].filter(element => element.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (active === first || active === root.current || !root.current.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || active === root.current || !root.current.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = oldOverflow; document.title = title; (previous?.isConnected && previous !== document.body && previous !== document.documentElement ? previous : document.querySelector('[data-town-atlas-entry]'))?.focus(); };
  }, [onClose]);
  return <section ref={root} className="deepseek-experience" role="dialog" aria-modal="true" aria-label="DeepSeek 主题园区" tabIndex={-1}>
    <div className="deepseek-canvas" role="img" aria-label="蓝色鲸雕塑、六座专家塔、层析塔与数据喷泉组成的 DeepSeek 园区，可拖动环视">
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [47, 27, 57], fov: 48, near: .15, far: 650 }} gl={{ antialias: true, toneMappingExposure: 1.22 }}>
        <color attach="background" args={[night ? '#060d1c' : '#9abbd5']}/>
        <fogExp2 attach="fog" args={[night ? '#24405f' : '#9abbd5', .0042]}/>
        <hemisphereLight args={['#bcd6ff', '#3a4a5e', night ? 2.2 : 2.5]}/>
        <directionalLight position={[-62, 44, 62]} intensity={night ? 2.9 : 3.4} color="#ffd7a8" castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-75} shadow-camera-right={75} shadow-camera-top={75} shadow-camera-bottom={-75} shadow-camera-far={220} shadow-normalBias={.04}/>
        <directionalLight position={[70, 34, -78]} intensity={2} color="#74a8ff"/>
        <pointLight position={[0, 9, 0]} color="#8ec6ff" intensity={220} distance={80} decay={2}/>
        {night && <Stars radius={230} depth={35} count={800} factor={2} saturation={.1} fade speed={0}/>}
        <ParkClock timeRef={timeRef} paused={paused} reducedMotion={reducedMotion}/>
        <DeepSeekPark inTown={false} timeRef={timeRef} reducedMotion={reducedMotion} paused={paused}/>
        <CameraTour selected={selected} reducedMotion={reducedMotion}/>
      </Canvas>
    </div>
    <header className="deepseek-header">
      <div><span className="deepseek-eyebrow">DEEPSEEK PARK / 深度求索</span><h1>DeepSeek 主题园区</h1><p>鲸园 · 六座专家塔 · 层析塔 · 数据喷泉</p></div>
      <button onClick={onClose}><ArrowLeft size={20} aria-hidden="true"/>返回小镇</button>
    </header>
    <div className="deepseek-tools" role="group" aria-label="园区观景设置">
      <button aria-pressed={night} onClick={() => setNight(value => !value)}>{night ? <Sun size={18}/> : <Moon size={18}/>}切换{night ? '白天' : '夜景'}</button>
      <button aria-pressed={paused || reducedMotion} disabled={reducedMotion} onClick={() => setPaused(value => !value)}>{paused || reducedMotion ? <Play size={18}/> : <Pause size={18}/>} {reducedMotion ? '已减少动态' : paused ? '继续动态' : '暂停动态'}</button>
    </div>
    <footer className="deepseek-footer">
      <p>拖动环视 · 滚轮／双指缩放<span>原创致敬 · 非官方园区</span></p>
      <nav aria-label="DeepSeek 园区景点">{DEEPSEEK_VIEWS.map(view => <button key={view.id} aria-pressed={selected === view.id} onClick={() => setSelected(view.id)}>{view.name}</button>)}</nav>
      <button className="deepseek-enter" onClick={onEnterTown}>走进园区 · 自由探索<ArrowUpRight size={20} aria-hidden="true"/></button>
    </footer>
  </section>;
}
