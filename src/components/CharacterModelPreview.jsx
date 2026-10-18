import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import GeneratedPlayerModel from './town/GeneratedPlayerModel.jsx';

class PreviewBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function CharacterModelPreview({ asset, onReadyChanged }) {
  const poseRef = useRef({ x: 0, y: 0, z: 0, yaw: 0, moving: true });
  const modelAsset = useMemo(() => ({ modelUrl: asset.modelUrl, walkingUrl: asset.walkingUrl, facing: asset.facing }), [asset.modelUrl, asset.walkingUrl, asset.facing]);
  const [status, setStatus] = useState({ state: 'loading' });
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  poseRef.current.moving = !reducedMotion;
  const onStatus = useCallback(next => { setStatus(next); onReadyChanged?.(next.state === 'ready'); }, [onReadyChanged]);
  const onError = useCallback(() => onStatus({ state: 'error', error: '浏览器暂时无法加载这个 3D 角色，请刷新后重试。' }), [onStatus]);
  return <div className="character-model-preview">
    <div className="character-model-canvas" role="img" aria-label="真实 3D 模型与行走动作预览，可拖动观察">
      <PreviewBoundary onError={onError}><Canvas camera={{ position: [3, 2.2, 4.5], fov: 38 }} dpr={[1, 1.5]} gl={{ antialias: true }} fallback={<span>当前浏览器不支持 3D 预览。</span>}>
        <color attach="background" args={['#e8ecdc']} /><ambientLight intensity={1.2} /><directionalLight position={[4, 6, 4]} intensity={2} /><hemisphereLight args={['#fff9e8', '#8b9c71', 1.2]} />
        <Suspense fallback={null}><GeneratedPlayerModel asset={modelAsset} poseRef={poseRef} fallback={null} reducedMotion={reducedMotion} onStatus={onStatus} /></Suspense>
        <OrbitControls target={[0, 1, 0]} minDistance={2.5} maxDistance={7} enablePan={false} />
      </Canvas></PreviewBoundary>
    </div>
    <p className={status.state === 'error' ? 'character-studio-error' : 'character-model-preview-status'} role="status">{status.state === 'ready' ? `真实模型与行走动作已加载。拖动查看，不是平面人物图。${reducedMotion ? '已按减少动态效果设置暂停动作预览。' : ''}` : status.state === 'error' ? status.error || '3D 预览失败，未使用图片替代。' : '正在加载真实 3D 模型与行走动作…'}</p>
  </div>;
}
