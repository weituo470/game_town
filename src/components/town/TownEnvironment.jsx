import { Component } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { sampleDayNight } from '../../../shared/dayNight.js';
import { appUrl } from '../../lib/appUrl.js';

// HDR reflections are optional. Suspense handles loading, but only a local
// error boundary prevents a failed fetch/decode from removing the entire Town.
class OptionalEnvironmentBoundary extends Component {
  state = { failed: false };
  warned = false;
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    if (this.warned) return;
    this.warned = true;
    console.warn('[TownEnvironment] 可选 HDR 反射贴图加载失败，已跳过环境反射；原有天空、灯光和小镇场景继续运行。', error);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

// Shared material reflections only: TownSky remains the sole visible sky and
// directional light owner. Night preview also dims metallic/clearcoat surfaces.
export default function TownEnvironment({ timeRef }) {
  useFrame(({ scene }) => { scene.environmentIntensity = .12 + sampleDayNight(timeRef?.current ?? 0).daylight * .38; });
  return <OptionalEnvironmentBoundary><Environment files={appUrl('/wonders/coastal-sky.hdr')} background={false} environmentIntensity={.5}/></OptionalEnvironmentBoundary>;
}
