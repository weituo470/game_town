import { Component, Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { RotateCcw, Rotate3D } from 'lucide-react';
import { ResidentModel } from './town/characters/Residents.jsx';
import SoftPenumbra from './town/SoftPenumbra';
import './characters.css';

class PortraitBoundary extends Component {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="character-fallback" role="status">
      <Rotate3D size={32} /><p>人物预览暂时无法打开，小镇仍可继续探索。</p>
      <button onClick={() => this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))}>重新加载人物</button>
    </div>;
    return <div key={this.state.attempt} className="character-canvas">{this.props.children}</div>;
  }
}

// A soft studio contact pool, not a second shadow-map pass. It stays beneath
// the soles while the tiny idle motion runs, and R3F owns/disposes its resources.
function ContactPool({ x }) {
  return <mesh position={[x, -0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[4.6, 3.5]} />
    <shaderMaterial transparent depthWrite={false} vertexShader={`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `} fragmentShader={`
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * vec2(4.6, 3.5);
        float broad = exp(-dot(p * vec2(0.9, 1.5), p * vec2(0.9, 1.5)) * 2.5);
        vec2 left = (p - vec2(-0.39, -0.09)) * vec2(2.3, 2.2);
        vec2 right = (p - vec2(0.39, -0.09)) * vec2(2.3, 2.2);
        float contact = max(exp(-dot(left, left) * 3.0), exp(-dot(right, right) * 3.0));
        gl_FragColor = vec4(0.16, 0.09, 0.05, broad * 0.36 + contact * 0.28);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `} />
  </mesh>;
}

function Studio({ selection, reducedMotion, angle, reset }) {
  const controls = useRef();
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    camera.zoom = Math.min(size.height / 5.25, size.width / (selection === 'duo' ? 5.5 : 3.4));
    camera.updateProjectionMatrix();
    const rotation = angle === 'back' ? Math.PI : angle === 'side' ? Math.PI / 2 : 0.3;
    camera.position.set(Math.sin(rotation) * 10, 3.65, Math.cos(rotation) * 10);
    camera.lookAt(0, 2.05, 0);
    if (controls.current) {
      controls.current.target.set(0, 2.05, 0);
      controls.current.update();
    }
    invalidate();
  }, [camera, size, selection, angle, reset, invalidate]);
  return <>
    <color attach="background" args={['#94705a']} />
    <fog attach="fog" args={['#94705a', 15, 38]} />
    <hemisphereLight args={['#fff6e8', '#8a6346', 1.8]} />
    <ambientLight intensity={0.45} />
    <directionalLight position={[-4, 7, 5]} intensity={2.5} color="#fff1dc" castShadow shadow-intensity={0.48}
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-5} shadow-camera-right={5}
      shadow-camera-top={6} shadow-camera-bottom={-5} shadow-camera-near={0.1} shadow-camera-far={25}
      shadow-bias={-0.0001} shadow-normalBias={0.012} />
    <directionalLight position={[4, 4, -4]} intensity={1.3} color="#e4edff" />
    <directionalLight position={[2, 1.8, 6]} intensity={0.7} color="#ffdfba" />
    <SoftPenumbra size={18} samples={8} focus={0.4} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}>
      <planeGeometry args={[120, 120]} /><meshStandardMaterial color="#71503e" roughness={1} />
    </mesh>
    {selection !== 'boy' && <ContactPool x={selection === 'duo' ? -1.3 : 0} />}
    {selection !== 'girl' && <ContactPool x={selection === 'duo' ? 1.3 : 0} />}
    {selection !== 'boy' && <ResidentModel kind="girl" position={[selection === 'duo' ? -1.3 : 0, 0, 0]} facing={selection === 'duo' ? 0.05 : 0} reducedMotion={reducedMotion} />}
    {selection !== 'girl' && <ResidentModel kind="boy" position={[selection === 'duo' ? 1.3 : 0, 0, 0]} facing={selection === 'duo' ? -0.1 : 0} reducedMotion={reducedMotion} />}
    <OrbitControls ref={controls} makeDefault enablePan={false} enableZoom minZoom={45} maxZoom={145}
      minPolarAngle={Math.PI * 0.25} maxPolarAngle={Math.PI * 0.56}
      enableDamping={!reducedMotion} dampingFactor={0.08} target={[0, 2.05, 0]} />
  </>;
}

export default function CharacterGallery({ reducedMotion = false }) {
  const [selection, setSelection] = useState('duo');
  const [angle, setAngle] = useState('front');
  const [reset, setReset] = useState(0);
  return <div className="character-gallery">
    <div className="character-toolbar">
      <div className="character-tabs" role="group" aria-label="选择查看人物">
        {[['duo', '双人合影'], ['girl', '暖暖'], ['boy', '阿蓝']].map(([id, label]) => <button key={id} aria-pressed={selection === id} onClick={() => { setSelection(id); setReset(value => value + 1); }}>{label}</button>)}
      </div>
      <button className="character-reset" onClick={() => { setAngle('front'); setReset(value => value + 1); }}><RotateCcw size={17} />复位</button>
    </div>
    <div className="character-viewport" aria-label={`${selection === 'duo' ? '暖暖与阿蓝' : selection === 'girl' ? '暖暖' : '阿蓝'}的立体模型，可拖动旋转或使用下方视角按钮查看。`}>
      <PortraitBoundary>
      <Canvas orthographic shadows dpr={[1, 1.75]} camera={{ position: [1.6, 3.65, 10], zoom: 80, near: 0.1, far: 80 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <Suspense fallback={null}><Studio selection={selection} angle={angle} reset={reset} reducedMotion={reducedMotion} /></Suspense>
      </Canvas>
      </PortraitBoundary>
    </div>
    <div className="character-view-controls">
      <span><Rotate3D size={18} />拖动旋转 · 滚轮缩放</span>
      <div role="group" aria-label="人物观察角度">{[['front', '正面'], ['side', '侧面'], ['back', '背面']].map(([id, label]) => <button key={id} aria-pressed={angle === id} onClick={() => { setAngle(id); setReset(value => value + 1); }}>{label}</button>)}</div>
    </div>
    <div className="character-caption">
      {selection !== 'boy' && <section><h3><span className="character-swatch warm" />暖暖</h3><p>绒球针织帽、奶油围巾，穿着姜黄色毛衣的小镇新朋友。</p></section>}
      {selection !== 'girl' && <section><h3><span className="character-swatch blue" />阿蓝</h3><p>蓝白棒球帽、柔软拼色上衣，喜欢在广场散步的小镇新朋友。</p></section>}
    </div>
  </div>;
}
