import * as THREE from 'three';
import { createAmbientBlackHoleClock, sampleAmbientBlackHoleNight } from '../../../shared/ambientBlackHole.js';
import { createBlackHoleVisual } from '../drone/blackHoleVisual.js';

// A true celestial bearing, 26 degrees ABOVE the horizon. Even the complete
// billboard's lowest corner stays above 10 degrees; never place it on water.
const SKY_DIRECTION = new THREE.Vector3(Math.sin(.65), Math.SQRT1_2 * .7, Math.cos(.65)).normalize();

/** Celestial scenery follows translation, never steals or changes the lens. */
export function placeAmbientBlackHole(group, camera, size) {
  // Downward diorama lenses have no real sky. Never fake a screen-space sky
  // sticker over the map just to make the event visible in overview/follow.
  if (!camera?.isPerspectiveCamera) return false;
  group.position.copy(camera.position).addScaledVector(SKY_DIRECTION, 230);
  group.scale.setScalar(100 / 320);
  group.quaternion.copy(camera.quaternion);
  return true;
}

/** Owns only this optional scenery. No inputs, camera writes or wall clock. */
export function createAmbientBlackHoleRuntime({ scene, gl,
  clock = createAmbientBlackHoleClock(), createVisual = createBlackHoleVisual,
  onAppearance = () => {},
}) {
  let visual = null, disposed = false, lastOpticalTime = -Infinity, lastEvent = 0, lastReducedMotion;
  let previousEnabled = false;
  const removeVisual = () => {
    if (!visual) return;
    scene.remove(visual.group); visual.dispose(); visual = null;
    lastOpticalTime = -Infinity;
  };
  return {
    frame({ delta = 0, camera, size, enabled = true, reducedMotion = false, worldTimeMs = 0 }) {
      if (disposed) return null;
      const night = sampleAmbientBlackHoleNight(worldTimeMs);
      const hasSky = camera?.isPerspectiveCamera === true;
      const clockEnabled = enabled && hasSky;
      // A day/preview transition ends rather than suspends the current sighting,
      // including a dawn that occurred while the tab or a modal was hidden.
      if (!night.eligible) clock.endEvent?.();
      // Never count the first frame after resuming: it may include background
      // suspension. Ordinary low frame rates still advance by real frame time.
      const deltaMs = previousEnabled && clockEnabled ? delta * 1000 : 0;
      previousEnabled = clockEnabled;
      const state = clock.advance(deltaMs, { enabled: clockEnabled, allowStart: night.eligible });
      const data = gl.domElement.dataset;
      data.skyBlackhole = !night.eligible ? 'daylight' : !hasSky ? 'no-sky' : !enabled ? 'suspended' : state.phase;
      data.skyBlackholeEvent = String(state.eventId);
      data.skyBlackholeElapsed = String(Math.floor(state.elapsedMs));
      if (!night.eligible || !hasSky || !state.active) {
        if (!night.eligible || !hasSky || state.phase === 'waiting') removeVisual();
        else visual?.setAmbientVisibility({ visible: false, opacity: 0 });
        return state;
      }
      if (!visual) {
        visual = createVisual({ ambient: true });
        visual.group.visible = false;
        visual.group.traverse(object => {
          object.userData.isSky = true;
          object.raycast = () => null;
          object.castShadow = object.receiveShadow = false;
        });
        scene.add(visual.group);
      }
      placeAmbientBlackHole(visual.group, camera, size);
      const opacity = state.opacity * night.opacity;
      visual.setAmbientVisibility({ visible: true, opacity, growth: 1 });
      if (lastEvent !== state.eventId) {
        lastEvent = state.eventId;
        onAppearance(state.eventId);
      }
      // Quantize the ambient effect clock to 20 Hz for stable animation updates.
      // Placement, player movement and fades still follow the scene frame rate.
      const opticalTime = Math.floor(state.elapsedMs / 50) * 50;
      if (lastOpticalTime !== opticalTime || lastReducedMotion !== reducedMotion) {
        visual.update(50000 + opticalTime * .3, reducedMotion, { visible: true, opacity, growth: 1 });
        lastOpticalTime = opticalTime;
        lastReducedMotion = reducedMotion;
      }
      // Compatibility render hook; the open-source mesh is drawn by the town.
      // No separate renderer or offscreen target is created by this effect.
      visual.render(gl);
      return state;
    },
    dispose() {
      if (disposed) return;
      disposed = true; removeVisual();
      for (const key of ['skyBlackhole', 'skyBlackholeEvent', 'skyBlackholeElapsed']) delete gl.domElement.dataset[key];
    },
  };
}
