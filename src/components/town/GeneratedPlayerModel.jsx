import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { groundHeight } from '../../../shared/world.js';
import { AnimationMixer, Box3, LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { characterFacingRotation, fetchCharacterGlb, modelNormalization, prepareCharacterAnimations, validateCharacterAsset } from '../../lib/characterModel.js';

function disposeOwnedScenes(scenes) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  for (const scene of scenes) scene?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    if (node.skeleton?.boneTexture) textures.add(node.skeleton.boneTexture);
  });
  for (const texture of textures) { if (texture.source?.data?.close) images.add(texture.source.data); texture.dispose(); }
  for (const image of images) image.close();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

// No shared useGLTF cache: every instance owns its loaded GPU resources and rig.
export default function GeneratedPlayerModel({ poseRef, asset, fallback = null, reducedMotion = false, onStatus }) {
  const actor = useRef(), notify = useRef(onStatus);
  const [loaded, setLoaded] = useState(null);
  notify.current = onStatus;
  const checked = useMemo(() => {
    if (!asset) return { asset: null, key: 'empty' };
    try { const value = validateCharacterAsset(asset); return { asset: value, key: JSON.stringify(value) }; }
    catch { return { asset: null, key: 'invalid' }; }
  }, [asset]);
  const currentKey = useRef(checked.key);
  currentKey.current = checked.key;

  useEffect(() => {
    setLoaded(null);
    if (!checked.asset) { notify.current?.({ state: checked.key === 'invalid' ? 'error' : 'idle', ...(checked.key === 'invalid' ? { error: '角色资源地址不符合安全要求。' } : {}) }); return; }
    const controller = new AbortController(), owned = [];
    let cancelled = false, instance = null;
    const deadline = setTimeout(() => controller.abort(), 30000);
    const announce = value => { if (!cancelled && currentKey.current === checked.key) notify.current?.(value); };
    announce({ state: 'loading' });
    const manager = new LoadingManager();
    manager.setURLModifier(url => {
      // Embedded PNG/JPEG textures are converted to blob URLs by GLTFLoader.
      if (typeof url !== 'string' || !url.startsWith('blob:')) throw new Error('External model resource rejected');
      return url;
    });
    const loader = new GLTFLoader(manager);
    const parse = buffer => new Promise((resolve, reject) => {
      const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
      controller.signal.addEventListener('abort', aborted, { once: true });
      if (controller.signal.aborted) { aborted(); return; }
      loader.parse(buffer, '', gltf => {
        controller.signal.removeEventListener('abort', aborted);
        if (cancelled || controller.signal.aborted) { disposeOwnedScenes(gltf.scenes ?? [gltf.scene]); reject(new DOMException('Aborted', 'AbortError')); return; }
        owned.push(...(gltf.scenes ?? [gltf.scene]));
        resolve(gltf);
      }, error => { controller.signal.removeEventListener('abort', aborted); reject(error); });
    });
    (async () => {
      try {
        // Keep the two bounded loads sequential to reduce peak texture memory.
        const model = await parse(await fetchCharacterGlb(checked.asset.modelUrl, { signal: controller.signal }));
        const walking = checked.asset.walkingUrl ? await parse(await fetchCharacterGlb(checked.asset.walkingUrl, { signal: controller.signal })) : null;
        if (cancelled || controller.signal.aborted) return;
        const scene = cloneSkeleton(model.scene);
        owned.push(scene);
        scene.updateMatrixWorld(true);
        const normalization = modelNormalization(new Box3().setFromObject(scene, true));
        const clips = prepareCharacterAnimations(model, walking, scene);
        const mixer = new AnimationMixer(scene);
        const actions = { walk: mixer.clipAction(clips.walk), idle: clips.idle ? mixer.clipAction(clips.idle) : null };
        scene.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
        instance = { key: checked.key, scene, normalization, mixer, actions, active: null, facing: characterFacingRotation(checked.asset.facing) };
        clearTimeout(deadline);
        setLoaded(instance);
        announce({ state: 'ready' });
      } catch {
        clearTimeout(deadline);
        if (!cancelled) { disposeOwnedScenes(owned); owned.length = 0; announce({ state: 'error', error: '3D 角色未能完成安全加载或缺少可用行走骨骼动画，仍使用原角色。' }); }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      controller.abort();
      instance?.mixer.stopAllAction();
      if (instance) instance.mixer.uncacheRoot(instance.scene);
      disposeOwnedScenes(owned);
      owned.length = 0;
    };
  }, [checked.key]);

  useFrame((_, delta) => {
    if (!loaded || loaded.key !== currentKey.current || !actor.current) return;
    const pose = poseRef?.current ?? {};
    const height = Number.isFinite(pose.y) ? Math.max(0, pose.y) : 0;
    actor.current.position.set(Number.isFinite(pose.x) ? pose.x : 0, height, Number.isFinite(pose.z) ? pose.z : 0);
    if(pose.spaceMode&&pose.spaceMode!=='ground'&&Array.isArray(pose.orientation))actor.current.quaternion.fromArray(pose.orientation);else actor.current.rotation.set(0,Number.isFinite(pose.yaw)?pose.yaw:0,0);
    const next = reducedMotion || (pose.spaceMode==='orbit'?(pose.orbitY||0)>.015:height - groundHeight(pose.x, pose.z) > 0.015 && !pose.aboard) ? null : pose.moving ? 'walk' : loaded.actions.idle ? 'idle' : null;
    if (next !== loaded.active) {
      if (!next) loaded.mixer.stopAllAction(); // restore rest pose in the air
      else {
        const action = loaded.actions[next];
        action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(0.16).play();
        if (loaded.active) loaded.actions[loaded.active].fadeOut(0.16);
      }
      loaded.active = next;
    }
    loaded.mixer.update(Math.max(0, Math.min(delta, 0.05)));
  });

  if (!loaded || loaded.key !== checked.key) return fallback;
  return <group ref={actor} dispose={null}>
    <group rotation={[0, loaded.facing, 0]}>
      <group position={loaded.normalization.position} scale={loaded.normalization.scale}>
        <primitive object={loaded.scene} dispose={null} />
      </group>
    </group>
  </group>;
}
